import { describe, expect, it } from 'vitest';
import {
    SCENE_SKIP_HOURS,
    baseStanceOf,
    dayDiff,
    elapsedHours,
    endScene,
    isNewScene,
    parseDate,
    parseTime,
    samePlace,
    sceneBreak,
} from '../../src/domain/scene';
import { PLAYER_ID } from '../../src/domain/model';
import type { CharacterProfile, CharacterState, ChatState, Core, Tie } from '../../src/domain/model';

describe('parseTime', () => {
    it('reads clock times', () => {
        expect(parseTime('14:30')).toBe(14.5);
        expect(parseTime('Вечер, 19.45')).toBe(19.75);
        expect(parseTime('2:30 pm')).toBe(14.5);
        expect(parseTime('12:15 a.m.')).toBe(0.25);
        expect(parseTime('12:00 PM')).toBe(12);
        expect(parseTime('7 AM')).toBe(7);
        expect(parseTime('9 p.m.')).toBe(21);
        expect(parseTime('24:00')).toBe(0);
        expect(parseTime('25:00')).toBeUndefined();
        expect(parseTime('10:75')).toBeUndefined();
    });

    it('reads time-of-day words in both languages', () => {
        const cases: Record<string, number> = {
            Midnight: 0,
            полночь: 0,
            'late night': 2,
            'глубокая ночь': 2,
            'Поздняя ночь': 2,
            'before dawn': 5,
            рассвет: 6,
            'Early morning': 7,
            'раннее утро': 7,
            'late morning': 11,
            Morning: 9,
            утро: 9,
            Noon: 12,
            полдень: 12,
            afternoon: 15,
            'после полудня': 15,
            день: 15,
            днём: 15,
            'late afternoon': 17,
            'ближе к вечеру': 17,
            Evening: 19,
            вечер: 19,
            сумерки: 19,
            'поздний вечер': 22,
            Night: 23,
            ночь: 23,
        };
        for (const [text, hour] of Object.entries(cases)) expect([text, parseTime(text)]).toEqual([text, hour]);
    });

    it('returns undefined for unknown text', () => {
        expect(parseTime('soon')).toBeUndefined();
        expect(parseTime('')).toBeUndefined();
        expect(parseTime(undefined)).toBeUndefined();
    });
});

describe('parseDate', () => {
    it('reads numeric dates', () => {
        expect(parseDate('1024-05-12')).toEqual({ kind: 'calendar', y: 1024, m: 5, d: 12 });
        expect(parseDate('12.05.1024')).toEqual({ kind: 'calendar', y: 1024, m: 5, d: 12 });
        expect(parseDate('12/05')).toEqual({ kind: 'calendar', m: 5, d: 12 });
        expect(parseDate('40.13.1024')).toBeUndefined();
    });

    it('reads month names in both languages', () => {
        expect(parseDate('12 мая 1024')).toEqual({ kind: 'calendar', y: 1024, m: 5, d: 12 });
        expect(parseDate('Понедельник, 3 декабря')).toEqual({ kind: 'calendar', m: 12, d: 3 });
        expect(parseDate('May 12, 1024')).toEqual({ kind: 'calendar', y: 1024, m: 5, d: 12 });
        expect(parseDate('Monday 1 Sept')).toEqual({ kind: 'calendar', m: 9, d: 1 });
        expect(parseDate('5 янв')).toEqual({ kind: 'calendar', m: 1, d: 5 });
        expect(parseDate('в марте')).toBeUndefined();
        expect(parseDate('market day')).toBeUndefined();
    });

    it('reads day counts', () => {
        expect(parseDate('Day 3')).toEqual({ kind: 'count', n: 3 });
        expect(parseDate('День 12')).toEqual({ kind: 'count', n: 12 });
        expect(parseDate('3rd day')).toEqual({ kind: 'count', n: 3 });
        expect(parseDate('3-й день')).toEqual({ kind: 'count', n: 3 });
    });

    it('returns undefined for unknown text', () => {
        expect(parseDate('Monday')).toBeUndefined();
        expect(parseDate(undefined)).toBeUndefined();
    });

    it('measures days between dates', () => {
        expect(dayDiff({ kind: 'count', n: 3 }, { kind: 'count', n: 5 })).toBe(2);
        expect(dayDiff({ kind: 'calendar', m: 5, d: 31 }, { kind: 'calendar', m: 6, d: 1 })).toBe(1);
        expect(dayDiff({ kind: 'calendar', y: 1024, m: 12, d: 31 }, { kind: 'calendar', y: 1025, m: 1, d: 1 })).toBe(1);
        expect(dayDiff({ kind: 'calendar', y: 1024, m: 5, d: 1 }, { kind: 'calendar', m: 5, d: 3 })).toBe(2);
        expect(dayDiff({ kind: 'count', n: 3 }, { kind: 'calendar', m: 5, d: 3 })).toBeUndefined();
    });
});

describe('elapsedHours', () => {
    it('counts hours within a day', () => {
        expect(elapsedHours({ time: '14:00' }, { time: '15:30' })).toBe(1.5);
        expect(elapsedHours({ time: 'Morning' }, { time: 'вечер' })).toBe(10);
    });

    it('wraps past midnight without dates', () => {
        expect(elapsedHours({ time: '23:00' }, { time: '01:00' })).toBe(2);
    });

    it('uses dates for whole days', () => {
        expect(elapsedHours({ date: '12 мая', time: '20:00' }, { date: '13 мая', time: '08:00' })).toBe(12);
        expect(elapsedHours({ date: 'Day 1' }, { date: 'Day 3' })).toBe(48);
        expect(elapsedHours({ date: 'Day 3' }, { date: 'Day 1' })).toBeUndefined();
    });

    it('treats an earlier time on the same date as a correction', () => {
        expect(elapsedHours({ date: 'Monday', time: '15:00' }, { date: 'Monday', time: '14:00' })).toBeUndefined();
        expect(elapsedHours({ date: 'Monday', time: '14:00' }, { date: 'Monday', time: '15:00' })).toBe(1);
    });

    it('gives up on unknown parts', () => {
        expect(elapsedHours({ time: 'soon' }, { time: '14:00' })).toBeUndefined();
        expect(elapsedHours({ date: 'Monday', time: '10:00' }, { date: 'Tuesday', time: '11:00' })).toBeUndefined();
        expect(elapsedHours({}, {})).toBeUndefined();
    });
});

describe('scene breaks', () => {
    it('breaks on a place change but not on punctuation or a sub-place', () => {
        expect(sceneBreak({ place: 'Трактир «Рог»' }, { place: 'Площадь' })).toEqual({ reason: 'place' });
        expect(isNewScene({ place: 'Трактир «Рог», зал' }, { place: 'трактир рог — зал' })).toBe(false);
        expect(isNewScene({ place: 'Tavern' }, { place: 'Tavern, kitchen' })).toBe(false);
        expect(samePlace('Tavern', 'Taverna')).toBe(false);
        expect(samePlace('', 'Tavern')).toBe(false);
    });

    it('ignores missing values', () => {
        expect(isNewScene({}, { place: 'Площадь', time: '14:00' })).toBe(false);
        expect(isNewScene({ place: 'Площадь' }, { place: ' ' })).toBe(false);
    });

    it('breaks on a time skip', () => {
        expect(sceneBreak({ time: '14:00' }, { time: '18:30' })).toEqual({ reason: 'time', hours: 4.5 });
        expect(isNewScene({ time: '14:00' }, { time: '16:00' })).toBe(false);
        expect(isNewScene({ time: '14:00' }, { time: '16:00' }, { hours: 2 })).toBe(true);
        expect(isNewScene({ time: '14:00' }, { time: '14:00' })).toBe(false);
        expect(SCENE_SKIP_HOURS).toBe(3);
    });

    it('reports a day change and keeps hours on a place change', () => {
        expect(sceneBreak({ date: 'Day 1', time: 'утро' }, { date: 'Day 2', time: 'утро' })).toEqual({
            reason: 'date',
            hours: 24,
        });
        expect(sceneBreak({ place: 'A', time: '10:00' }, { place: 'B', time: '11:00' })).toEqual({
            reason: 'place',
            hours: 1,
        });
    });

    it('treats different unparseable dates as a new day', () => {
        expect(sceneBreak({ date: 'Monday' }, { date: 'Tuesday' })).toEqual({ reason: 'date' });
        expect(sceneBreak({ date: 'Day 3' }, { date: '12 мая' })).toEqual({ reason: 'date' });
        expect(sceneBreak({ date: 'Day 3' }, { date: 'Day 1' })).toBeNull();
        expect(sceneBreak({ date: 'Monday' }, { date: 'monday' })).toBeNull();
    });
});

/* ------------------------------------------------------------------ endScene */

function tie(target: string, fields: Partial<Tie> = {}): Tie {
    return {
        target,
        stance: 0,
        reasons: [],
        evaluations: [],
        intent: 'none',
        debts: [],
        encounters: [],
        beliefs: [],
        ...fields,
    };
}

function profile(id: string, fields: Partial<CharacterProfile> = {}): CharacterProfile {
    return {
        id,
        name: id,
        aliases: [],
        kind: 'character',
        lod: 'draft',
        core: { baselineMood: { octant: 'hostile', label: 'мрачная настороженность' } } as Core,
        appetites: [],
        agenda: { goals: [], intentions: [], resources: [], leverage: [], secrets: [] },
        ties: [],
        starts: [],
        meta: {},
        ...fields,
    };
}

function character(id: string, fields: Partial<CharacterState> = {}): CharacterState {
    return {
        id,
        ties: {},
        mood: { octant: 'anxious' },
        scene: { attention: 'focus', doing: 'counting coins', move: 'own', moveTarget: PLAYER_ID },
        appetites: {
            drink: {
                pressure: 3,
                tolerance: 0,
                dependence: 0,
                sensitization: 0,
                lastSated: -1,
                edgeCount: 0,
                withdrawal: false,
            },
        },
        agenda: { goals: [], intentions: [], resources: [], leverage: [], secrets: [] },
        stress: 0,
        corruption: { level: 0, stains: 0, gifts: [], brands: [] },
        arcStage: 'intact',
        present: true,
        lastSeenTurn: 5,
        selfControl: 3,
        knowsPlayer: true,
        ...fields,
    };
}

function chat(characters: CharacterState[], fields: Partial<ChatState> = {}): ChatState {
    return {
        schema: 1,
        card: 'card.png',
        worldTone: 'indifferent',
        extras: [],
        characters: Object.fromEntries(characters.map((c) => [c.id, c])),
        rules: [],
        reputation: [],
        rumours: [],
        schemes: [],
        turn: 12,
        scene: 4,
        greeting: 0,
        log: [],
        ...fields,
    };
}

describe('baseStanceOf', () => {
    it('prefers the tie base, then the profile tie, then neutral', () => {
        const p = profile('ilva', { ties: [tie(PLAYER_ID, { stance: -2 })] });
        expect(baseStanceOf(p, { target: PLAYER_ID, base: 1 })).toBe(1);
        expect(baseStanceOf(p, { target: PLAYER_ID })).toBe(-2);
        expect(baseStanceOf(p, { target: 'bram' })).toBe(0);
        expect(baseStanceOf(undefined, { target: 'bram' })).toBe(0);
    });
});

describe('endScene', () => {
    const ilvaProfile = profile('ilva', { ties: [tie(PLAYER_ID, { stance: -2 })] });

    it('ticks ties, relaxes moods, clears emotions and resets scene fields', () => {
        const ilva = character('ilva', {
            ties: {
                [PLAYER_ID]: tie(PLAYER_ID, {
                    stance: -1,
                    reasons: [{ id: 'r1', text: 'заплатил щедро', delta: 1, scenesLeft: 1, stacks: 0 }],
                    moved: { scene: 4, delta: 1 },
                }),
            },
            emotion: { type: 'suspicion', intensity: 3, target: PLAYER_ID, cause: 'tips', until: 20 },
        });
        const state = chat([ilva]);
        const r = endScene(state, { profiles: [ilvaProfile] });
        const next = r.state.characters.ilva!;
        expect(r.state.scene).toBe(5);
        expect(next.ties[PLAYER_ID]!.stance).toBe(-2);
        expect(next.ties[PLAYER_ID]!.reasons).toEqual([]);
        expect(next.ties[PLAYER_ID]!.moved).toBeUndefined();
        expect(next.mood).toEqual({ octant: 'hostile', label: 'мрачная настороженность' });
        expect(next.emotion).toBeUndefined();
        expect('emotion' in next).toBe(false);
        expect(next.scene).toEqual({ attention: 'background' });
        expect(next.appetites).toBe(ilva.appetites);
        expect(next.present).toBe(true);
        expect(r.changes).toEqual([
            {
                kind: 'reason-expired',
                target: PLAYER_ID,
                scene: 4,
                reason: 'r1',
                text: 'заплатил щедро',
                delta: 1,
                character: 'ilva',
            },
            { kind: 'drift', target: PLAYER_ID, scene: 4, from: -1, to: -2, character: 'ilva' },
            { kind: 'mood-relaxed', character: 'ilva', scene: 4, from: 'anxious', to: 'hostile' },
            { kind: 'emotion-cleared', character: 'ilva', scene: 4, emotion: 'suspicion' },
        ]);
        expect(state.scene).toBe(4);
        expect(state.characters.ilva!.emotion).toBeDefined();
    });

    it('uses chat extras as profiles and keeps the mood of unknown characters', () => {
        const extra = profile('stranger', { core: { baselineMood: { octant: 'bored' } } as Core });
        const r = endScene(chat([character('stranger'), character('ghost')], { extras: [extra] }), { profiles: [] });
        expect(r.state.characters.stranger!.mood).toEqual({ octant: 'bored' });
        expect(r.state.characters.ghost!.mood).toEqual({ octant: 'anxious' });
        expect(r.changes.filter((c) => c.kind === 'mood-relaxed')).toHaveLength(1);
    });

    it('lets the appetite rules reset per-scene fields', () => {
        const r = endScene(chat([character('bram')]), {
            profiles: [],
            appetiteSceneEnd: (id, key, a) => ({ ...a, pressure: id === 'bram' && key === 'drink' ? 2 : a.pressure }),
        });
        expect(r.state.characters.bram!.appetites.drink!.pressure).toBe(2);
    });

    it('handles an empty chat', () => {
        const r = endScene(chat([]), { profiles: [] });
        expect(r.state.scene).toBe(5);
        expect(r.changes).toEqual([]);
    });
});
