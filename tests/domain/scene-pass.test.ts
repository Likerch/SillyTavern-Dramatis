import { describe, expect, it } from 'vitest';
import { PLAYER_ID } from '../../src/domain/model';
import type { CharacterProfile } from '../../src/domain/model';
import { emptyProfile } from '../../src/domain/profile-defaults';
import { CHAPTER_HOURS, breakHours, isChapterEnd, runScenePass } from '../../src/domain/scene-pass';
import type { ScenePassContext } from '../../src/domain/scene-pass';
import { always, appetite } from './appetites-fixtures';
import { chat, liveState, reason, tavern, tie } from './cast-fixtures';

function ctx(patch: Partial<ScenePassContext> = {}): ScenePassContext {
    return { rng: always(0.99), levers: { appetiteStrength: 'author', corruption: 'all' }, reason: 'place', ...patch };
}

describe('chapter ends', () => {
    it('a new day or a long skip ends a chapter', () => {
        expect(isChapterEnd('date', undefined)).toBe(true);
        expect(isChapterEnd('time', CHAPTER_HOURS)).toBe(true);
        expect(isChapterEnd('place', 2)).toBe(false);
        expect(isChapterEnd('ended', undefined)).toBe(false);
        expect(breakHours('date', undefined)).toBe(24);
        expect(breakHours('place', undefined)).toBe(0);
        expect(breakHours('time', 5)).toBe(5);
    });
});

describe('runScenePass', () => {
    it('ends the scene: reasons expire, stances drift home, moods relax, emotions clear', () => {
        const { profiles, state } = tavern();
        const bram = state.characters.bram!;
        bram.ties[PLAYER_ID] = tie(PLAYER_ID, -1, { reasons: [reason('a passing slight', -1, 1)], base: 0 });
        bram.mood = { octant: 'anxious' };
        bram.emotion = { type: 'fear', intensity: 3, target: PLAYER_ID, cause: 'x', until: 9 };
        const result = runScenePass(
            { state, profiles, present: ['bram'], playerName: 'Курьер' },
            ctx({ uiLang: 'ru' }),
        );
        const after = result.state.characters.bram!;
        expect(after.ties[PLAYER_ID]!.reasons).toEqual([]);
        expect(after.ties[PLAYER_ID]!.stance).toBe(0);
        expect(after.emotion).toBeUndefined();
        expect(after.mood).toEqual(profiles[1]!.core.baselineMood);
        expect(result.state.scene).toBe(1);
        expect(result.chapterEnd).toBe(false);
        expect(result.events.map((line) => line.text)).toEqual([
            'Брам → Курьер: причины остыли, снова Нейтрален',
            'Сцена закончилась',
        ]);
        expect(state.scene).toBe(0);
    });

    it('lets time pass for appetites and resets the per-scene cue counter', () => {
        const base = emptyProfile('Ян', { id: 'yan' });
        const yan: CharacterProfile = { ...base, appetites: [appetite({ id: 'drink', dependence: 2, baseline: 2 })] };
        const state = chat({
            yan: liveState(yan, {
                appetites: {
                    drink: {
                        pressure: 1,
                        tolerance: 0,
                        dependence: 2,
                        sensitization: 0,
                        lastSated: 0,
                        edgeCount: 0,
                        withdrawal: false,
                        sceneCue: 2,
                    },
                },
            }),
        });
        const result = runScenePass({ state, profiles: [yan], present: [] }, ctx({ reason: 'time', hours: 48 }));
        const drink = result.state.characters.yan!.appetites.drink!;
        expect(drink.withdrawal).toBe(true);
        expect(drink.pressure).toBeGreaterThanOrEqual(4);
        expect(drink.sceneCue).toBeUndefined();
        expect(result.chapterEnd).toBe(true);
        expect(result.hours).toBe(48);
        expect(result.events.some((line) => line.kind === 'appetite')).toBe(true);
        // Rest at the chapter end restores self-control even after withdrawal set in.
        expect(result.state.characters.yan!.selfControl).toBe(3);
    });

    it('rolls remorse at a chapter end: success washes the stains', () => {
        const { profiles, state } = tavern();
        state.characters.bram!.corruption = { level: 2, stains: 2, gifts: [], brands: [] };
        const washed = runScenePass({ state, profiles, present: [] }, ctx({ reason: 'date' }));
        expect(washed.state.characters.bram!.corruption).toMatchObject({ level: 2, stains: 0 });
        expect(washed.events.some((line) => line.kind === 'corruption' && line.text.includes('remorse'))).toBe(true);
        const failed = runScenePass({ state, profiles, present: [] }, ctx({ reason: 'date', rng: always(0) }));
        expect(failed.state.characters.bram!.corruption).toMatchObject({ level: 3, stains: 0, brands: ['mark'] });
    });

    it('a clean chapter with an anchor near and nothing fed lets corruption recover a step', () => {
        const { profiles, state } = tavern();
        const bram = profiles.find((profile) => profile.id === 'bram')!;
        bram.core = { ...bram.core, anchors: ['sota'] };
        state.characters.bram!.corruption = { level: 3, stains: 0, gifts: [], brands: [] };
        const result = runScenePass({ state, profiles, present: ['bram', 'sota'] }, ctx({ reason: 'time', hours: 12 }));
        expect(result.state.characters.bram!.corruption.level).toBe(2);
        const short = runScenePass({ state, profiles, present: ['bram', 'sota'] }, ctx({ reason: 'place' }));
        expect(short.state.characters.bram!.corruption.level).toBe(3);
    });

    it('the sequel step: focus characters take up their next goal', () => {
        const { profiles, state } = tavern();
        state.characters.sota!.agenda = {
            ...state.characters.sota!.agenda,
            goals: [{ id: 'leave', text: 'get out of this town', kind: 'external', priority: 1 }],
            intentions: [],
        };
        state.next = { turn: 0, bands: { sota: 'focus', bram: 'business' } };
        const result = runScenePass({ state, profiles, present: ['sota'] }, ctx());
        expect(result.state.characters.sota!.agenda.intentions.map((item) => item.goalId)).toEqual(['leave']);
        expect(result.events.some((line) => line.kind === 'intention' && line.character === 'sota')).toBe(true);
    });
});
