import { describe, expect, it } from 'vitest';
import { PLAYER_ID } from '../../src/domain/model';
import type { Appetite, CardProfiles, CharacterProfile, Tie } from '../../src/domain/model';
import {
    CHAT_STATE_SCHEMA,
    FULL_SELF_CONTROL,
    createCharacterState,
    ensureCharacterState,
    initChatState,
    startFor,
    startingReputation,
} from '../../src/domain/state-init';

function tie(target: string, overrides: Partial<Tie> = {}): Tie {
    return {
        target,
        stance: -1,
        reasons: [{ id: 'r1', text: 'сорвал поставку', delta: -1, scenesLeft: null, stacks: 1 }],
        evaluations: [],
        intent: 'none',
        debts: [],
        encounters: [],
        beliefs: [],
        ...overrides,
    };
}

function appetite(id: string, overrides: Partial<Appetite> = {}): Appetite {
    return {
        id,
        kind: 'drink',
        sources: ['individual'],
        target: { mode: 'thing' },
        baseline: 3,
        liking: 1,
        triggers: ['запах браги'],
        satisfiers: [{ what: 'кружка', amount: 2 }],
        drift: 'daily',
        tolerance: 1,
        dependence: 2,
        sensitization: 0,
        endorsement: 'torn',
        vow: 'none',
        visibility: 'open',
        style: 'honest',
        affectionOnset: 'never',
        ...overrides,
    };
}

function profile(id: string, overrides: Partial<CharacterProfile> = {}): CharacterProfile {
    return {
        id,
        name: id,
        aliases: [],
        kind: 'character',
        lod: 'draft',
        core: {
            concept: 'трактирщица',
            values: { top: ['security'] },
            temperament: {},
            drives: { high: [], low: [] },
            arcLock: false,
            signatures: [],
            tactics: [],
            commitment: 'open',
            proactivity: 5,
            baselineMood: { octant: 'relaxed', label: 'спокойная деловитость' },
            stanceBounds: [],
            redLines: { never: [], would: [] },
            keys: [],
            justifications: [],
            corruption: 2,
            anchors: [],
        },
        appetites: [],
        agenda: {
            goals: [{ id: 'g1', text: 'хочет выкупить трактир', kind: 'external', priority: 1 }],
            intentions: [{ id: 'i1', goalId: 'g1', text: 'копит', nextStep: 'продать вино', dropIf: [] }],
            resources: [],
            leverage: [],
            secrets: [],
        },
        ties: [],
        starts: [],
        meta: {},
        ...overrides,
    };
}

function cardProfiles(characters: CharacterProfile[], overrides: Partial<CardProfiles> = {}): CardProfiles {
    return {
        schema: 1,
        card: 'tavern.png',
        worldTone: 'hostile',
        invariants: [],
        characters,
        rules: [],
        reputation: [],
        meta: {},
        ...overrides,
    };
}

describe('startFor', () => {
    it('prefers the exact greeting over the «any greeting» start', () => {
        const p = profile('a', {
            starts: [
                { greeting: -1, present: false, doing: 'спит' },
                { greeting: 2, present: true, doing: 'протирает стойку' },
            ],
        });
        expect(startFor(p, 2)?.doing).toBe('протирает стойку');
        expect(startFor(p, 0)?.doing).toBe('спит');
        expect(startFor(profile('b'), 0)).toBeUndefined();
    });
});

describe('createCharacterState', () => {
    it('copies ties by target, agenda, mood and appetites without sharing objects', () => {
        const p = profile('marta', {
            ties: [tie(PLAYER_ID, { stance: -2 }), tie('bram', { stance: 2 })],
            appetites: [appetite('drink')],
            starts: [{ greeting: 0, present: true, doing: 'наливает', goal: 'выручка' }],
        });
        const state = createCharacterState(p, 0);

        expect(Object.keys(state.ties)).toEqual([PLAYER_ID, 'bram']);
        expect(state.ties[PLAYER_ID]?.stance).toBe(-2);
        expect(state.ties[PLAYER_ID]).not.toBe(p.ties[0]);
        state.ties[PLAYER_ID]!.reasons.push({ id: 'x', text: 'x', delta: 1, scenesLeft: 1, stacks: 1 });
        expect(p.ties[0]!.reasons).toHaveLength(1);

        expect(state.agenda).toEqual(p.agenda);
        expect(state.agenda).not.toBe(p.agenda);
        state.agenda.goals.pop();
        expect(p.agenda.goals).toHaveLength(1);

        expect(state.mood).toEqual({ octant: 'relaxed', label: 'спокойная деловитость' });
        expect(state.mood).not.toBe(p.core.baselineMood);

        expect(state.appetites.drink).toEqual({
            pressure: 3,
            tolerance: 1,
            dependence: 2,
            sensitization: 0,
            lastSated: -1,
            edgeCount: 0,
            withdrawal: false,
        });
    });

    it('starts the scene from the greeting and fills the counters', () => {
        const p = profile('marta', { starts: [{ greeting: 0, present: true, doing: 'наливает', goal: 'выручка' }] });
        const state = createCharacterState(p, 0);
        expect(state.scene).toEqual({ attention: 'background', doing: 'наливает', goal: 'выручка' });
        expect(state.present).toBe(true);
        expect(state.lastSeenTurn).toBe(0);
        expect(state.stress).toBe(0);
        expect(state.corruption).toEqual({ level: 2, stains: 0, gifts: [], brands: [] });
        expect(state.arcStage).toBe('intact');
        expect(state.selfControl).toBe(FULL_SELF_CONTROL);
        expect(state.emotion).toBeUndefined();
    });

    it('is absent without a start and knows the player only through a tie', () => {
        const stranger = createCharacterState(profile('a'), 1);
        expect(stranger.present).toBe(false);
        expect(stranger.lastSeenTurn).toBe(-1);
        expect(stranger.scene).toEqual({ attention: 'background' });
        expect(stranger.knowsPlayer).toBe(false);

        const acquainted = createCharacterState(profile('b', { ties: [tie(PLAYER_ID)] }), 1);
        expect(acquainted.knowsPlayer).toBe(true);
    });
});

describe('startingReputation', () => {
    it('takes seeds of this greeting or of every start, the specific one winning per group', () => {
        const reputation = startingReputation(
            [
                { among: 'стража', label: 'чужак', stance: -1, greeting: -1 },
                { among: 'стража', label: 'беглый каторжник', stance: -2, greeting: 1 },
                { among: 'долина', label: 'герой', stance: 2, greeting: 0 },
                { among: '*', label: 'приезжий', stance: 0, greeting: -1 },
            ],
            1,
        );
        expect(reputation).toEqual([
            { among: 'стража', label: 'беглый каторжник', stance: -2, weaknesses: [], reasons: [] },
            { among: '*', label: 'приезжий', stance: 0, weaknesses: [], reasons: [] },
        ]);
    });

    it('keeps a specific seed when the «every start» one comes later', () => {
        const reputation = startingReputation(
            [
                { among: 'стража', label: 'беглец', stance: -2, greeting: 0 },
                { among: 'стража', label: 'чужак', stance: -1, greeting: -1 },
            ],
            0,
        );
        expect(reputation.map((item) => item.label)).toEqual(['беглец']);
    });
});

describe('initChatState', () => {
    it('builds the whole chat state for the greeting', () => {
        const profiles = cardProfiles(
            [profile('marta', { starts: [{ greeting: 1, present: true }] }), profile('guards', { kind: 'group' })],
            {
                rules: [
                    {
                        id: 'r1',
                        holders: 'ламии',
                        kind: 'flesh',
                        source: 'species',
                        target: { mode: 'player' },
                        intensity: { zero: 0.2, low: 0.3, mid: 0.3, high: 0.2 },
                        styles: { siren: 1 },
                        choosiness: 2,
                        exclusivity: 'shared',
                        affectionOnset: 'possible',
                        groupMode: 'pack',
                    },
                ],
                reputation: [{ among: 'стража', label: 'чужак', stance: -1, greeting: -1 }],
            },
        );
        const state = initChatState(profiles, 1, 'tavern.png');

        expect(state.schema).toBe(CHAT_STATE_SCHEMA);
        expect(state.card).toBe('tavern.png');
        expect(state.worldTone).toBe('hostile');
        expect(state.greeting).toBe(1);
        expect(Object.keys(state.characters)).toEqual(['marta', 'guards']);
        expect(state.characters.marta?.present).toBe(true);
        expect(state.characters.guards?.present).toBe(false);
        expect(state.rules).toEqual(profiles.rules);
        expect(state.rules).not.toBe(profiles.rules);
        expect(state.reputation).toHaveLength(1);
        expect(state).toMatchObject({ extras: [], rumours: [], schemes: [], log: [], turn: 0, scene: 0 });
        expect(state.place).toBeUndefined();
    });

    it('gives an empty cast for empty profiles', () => {
        const state = initChatState(cardProfiles([]), 0, 'x.png');
        expect(state.characters).toEqual({});
        expect(state.reputation).toEqual([]);
    });
});

describe('ensureCharacterState', () => {
    it('creates a missing state with the chat greeting and keeps existing ones', () => {
        const state = initChatState(cardProfiles([profile('marta')]), 2, 'x.png');
        const existing = state.characters.marta!;
        existing.stress = 3;
        expect(ensureCharacterState(state, profile('marta'))).toBe(existing);
        expect(existing.stress).toBe(3);

        state.turn = 7;
        const late = profile('bram', { starts: [{ greeting: 2, present: true, doing: 'входит' }] });
        const created = ensureCharacterState(state, late);
        expect(state.characters.bram).toBe(created);
        expect(created.present).toBe(true);
        expect(created.lastSeenTurn).toBe(7);
        expect(created.scene.doing).toBe('входит');
    });
});
