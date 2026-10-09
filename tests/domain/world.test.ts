import { describe, expect, it } from 'vitest';
import { PLAYER_ID } from '../../src/domain/model';
import type {
    Agenda,
    CharacterProfile,
    CharacterState,
    ChatState,
    Front,
    OffscreenAttempt,
    Rumour,
    Scheme,
} from '../../src/domain/model';
import { emptyAgenda, normalizeAgenda } from '../../src/domain/profile-defaults';
import {
    COMPLICATIONS,
    DEFAULT_INTENTION_SEGMENTS,
    MAX_ATTEMPTS,
    MAX_LOG,
    MAX_ODDS,
    MIN_ODDS,
    actsOffscreen,
    addBelief,
    appendLog,
    attemptOdds,
    chooseAction,
    frontStep,
    matureAgendas,
    offscreenBrief,
    offscreenSatiation,
    prepareAgenda,
    resolveAction,
    rollOutcome,
    socialIndex,
    wantOnLearning,
    worldTick,
} from '../../src/domain/world';
import type { WorldTickContext } from '../../src/domain/world';
import { always, appState, appetite, seeded, seq } from './appetites-fixtures';
import { chat, liveState, profile, tie } from './cast-fixtures';

/* ------------------------------------------------------------------ fixtures */

function front(filled: number, patch: Partial<Front> = {}): Front {
    return {
        impulse: 'control of the port',
        steps: ['buys up debts', 'pressures the captain', 'burns the warehouse'],
        doom: 'the port is theirs',
        clock: { segments: 6, filled },
        ...patch,
    };
}

function agenda(patch: Partial<Agenda> = {}): Agenda {
    return { ...emptyAgenda(), ...patch };
}

function absent(p: CharacterProfile, patch: Partial<CharacterState> = {}): CharacterState {
    return liveState(p, { present: false, lastSeenTurn: 0, knowsPlayer: false, ...patch });
}

/** The port: a guild with a front, the captain, Ильва with a clocked intention, Грукк with an appetite, Мира. */
function port() {
    const guild = profile('guild', 'Гильдия', {
        kind: 'group',
        lod: 'draft',
        agenda: agenda({ resources: ['money', 'dockhands'], front: front(0) }),
    });
    const captain = profile('captain', 'Капитан', {
        lod: 'portrait',
        agenda: agenda({
            goals: [
                { id: 'g1', text: 'keep his ship', kind: 'external', priority: 1 },
                { id: 'g2', text: 'pay the crew', kind: 'external', priority: 2 },
            ],
        }),
        ties: [tie('guild', -2)],
    });
    const ilva = profile('ilva', 'Ильва', {
        lod: 'portrait',
        agenda: agenda({
            goals: [
                { id: 'g1', text: 'raise the tax by Friday', kind: 'external', priority: 1 },
                { id: 'g2', text: 'keep Сота safe', kind: 'external', priority: 2 },
            ],
            intentions: [
                {
                    id: 'i1',
                    goalId: 'g1',
                    text: 'raise the tax by Friday',
                    nextStep: 'sell the barley',
                    dropIf: [],
                    clock: { segments: 4, filled: 1 },
                },
            ],
        }),
        ties: [tie('tessa', 1)],
    });
    const grukk = profile('grukk', 'Грукк', {
        appetites: [
            appetite({
                id: 'plunder',
                kind: 'plunder',
                label: 'добыча',
                sources: ['culture'],
                drift: 'opportunity',
                baseline: 4,
            }),
        ],
    });
    const mira = profile('mira', 'Мира');
    const tessa = profile('tessa', 'Тесса', {
        appetites: [
            appetite({
                id: 'mate',
                kind: 'flesh',
                target: { mode: 'player' },
                baseline: 4,
                drift: 'opportunity',
                style: 'duelist',
            }),
        ],
        ties: [tie('ilva', 1)],
    });
    const profiles = [guild, captain, ilva, grukk, mira, tessa];
    const characters: Record<string, CharacterState> = {
        guild: absent(guild),
        captain: absent(captain),
        ilva: absent(ilva),
        grukk: absent(grukk, { appetites: { plunder: appState({ pressure: 4 }) } }),
        mira: liveState(mira),
        tessa: absent(tessa, { appetites: { mate: appState({ pressure: 3 }) } }),
    };
    return { profiles, state: chat(characters, { turn: 20, scene: 2 }) };
}

function ctx(rng: WorldTickContext['rng'], patch: Partial<WorldTickContext> = {}): WorldTickContext {
    return { rng, presentIds: ['mira'], mode: 'balanced', strength: 'author', playerName: 'Курьер', ...patch };
}

/** Only these characters act (the others are present). */
function only(state: ChatState, ids: string[]): string[] {
    return Object.keys(state.characters).filter((id) => !ids.includes(id));
}

/* ------------------------------------------------------------------ who acts */

describe('actsOffscreen', () => {
    const present = new Set(['mira']);

    it('lets important absent characters and factions with fronts act', () => {
        const { profiles, state } = port();
        const by = (id: string) => profiles.find((p) => p.id === id)!;
        expect(actsOffscreen(by('guild'), state.characters.guild!, present)).toBe(true);
        expect(actsOffscreen(by('captain'), state.characters.captain!, present)).toBe(true);
        expect(actsOffscreen(by('ilva'), state.characters.ilva!, present)).toBe(true);
        // A sketch with nothing on its agenda stays in the background.
        expect(actsOffscreen(by('grukk'), state.characters.grukk!, present)).toBe(false);
    });

    it('skips the present, finished fronts and factions without fronts or clocks', () => {
        const { profiles, state } = port();
        const by = (id: string) => profiles.find((p) => p.id === id)!;
        expect(actsOffscreen(by('ilva'), state.characters.ilva!, new Set(['ilva']))).toBe(false);
        const done = { ...state.characters.guild!, agenda: agenda({ front: front(6, { done: true }) }) };
        expect(actsOffscreen(by('guild'), done, present)).toBe(false);
        const idle = {
            ...state.characters.guild!,
            agenda: agenda({ goals: [{ id: 'g', text: 'grow', kind: 'external', priority: 1 }] }),
        };
        expect(actsOffscreen(by('guild'), idle, present)).toBe(false);
    });

    it('lets a sketch with a clocked intention act', () => {
        const sketch = profile('cart', 'Возчик');
        const character = absent(sketch, {
            agenda: agenda({
                intentions: [
                    { id: 'i', text: 'sell the load', nextStep: '', dropIf: [], clock: { segments: 4, filled: 0 } },
                ],
            }),
        });
        expect(actsOffscreen(sketch, character, present)).toBe(true);
    });
});

describe('prepareAgenda and chooseAction', () => {
    it('promotes goals into intentions and gives every intention a clock', () => {
        const prepared = prepareAgenda(
            agenda({ goals: [{ id: 'g1', text: 'keep his ship', kind: 'external', priority: 1 }] }),
        );
        expect(prepared.intentions).toEqual([
            {
                id: 'i-g1',
                goalId: 'g1',
                text: 'keep his ship',
                nextStep: '',
                dropIf: [],
                clock: { segments: DEFAULT_INTENTION_SEGMENTS, filled: 0 },
            },
        ]);
    });

    it('maps the front clock onto its escalation steps', () => {
        expect(frontStep(front(0))).toBe('buys up debts');
        expect(frontStep(front(1))).toBe('buys up debts');
        expect(frontStep(front(2))).toBe('pressures the captain');
        expect(frontStep(front(5))).toBe('burns the warehouse');
        expect(frontStep(front(6))).toBe('burns the warehouse');
        expect(frontStep(front(3, { steps: [] }))).toBe('control of the port');
    });

    it('draws the front or an intention by weight (front 2, first 1.5, second 1)', () => {
        const a = agenda({
            front: front(2),
            intentions: [
                { id: 'a', text: 'first', nextStep: 'do the first', dropIf: [], clock: { segments: 4, filled: 0 } },
                { id: 'b', text: 'second', nextStep: '', dropIf: [], clock: { segments: 4, filled: 0 } },
            ],
        });
        // Total weight 4.5: [0, 2) front, [2, 3.5) first, [3.5, 4.5) second.
        expect(chooseAction(a, always(0.1))).toMatchObject({ source: 'front', attempt: 'pressures the captain' });
        expect(chooseAction(a, always(0.6))).toMatchObject({
            source: 'intention',
            intention: 'a',
            goal: 'first',
            attempt: 'do the first',
        });
        expect(chooseAction(a, always(0.9))).toMatchObject({ intention: 'b', attempt: 'second' });
    });

    it('has nothing to do when every clock is full or missing', () => {
        expect(chooseAction(agenda(), always(0))).toBeNull();
        expect(chooseAction(agenda({ front: front(6) }), always(0))).toBeNull();
        expect(
            chooseAction(agenda({ intentions: [{ id: 'a', text: 'x', nextStep: '', dropIf: [] }] }), always(0)),
        ).toBeNull();
    });
});

/* ------------------------------------------------------------------ the roll */

describe('odds and outcomes', () => {
    it('rises with resources and momentum, falls with leverage, stays bounded', () => {
        expect(attemptOdds({ resources: 0, leverage: 0, progress: 0 }).success).toBe(0.4);
        expect(attemptOdds({ resources: 2, leverage: 0, progress: 0 }).success).toBe(0.52);
        expect(attemptOdds({ resources: 0, leverage: 2, progress: 0 }).success).toBe(0.32);
        expect(attemptOdds({ resources: 0, leverage: 0, progress: 1 }).success).toBe(0.55);
        expect(attemptOdds({ resources: 0, leverage: 0, progress: 0, group: true }).success).toBe(0.45);
        expect(attemptOdds({ resources: 99, leverage: 0, progress: 1, group: true }).success).toBe(MAX_ODDS);
        expect(attemptOdds({ resources: 0, leverage: 99, progress: 0 }).success).toBe(0.28);
        expect(attemptOdds({ resources: -5, leverage: 3, progress: -1 }).success).toBeGreaterThanOrEqual(MIN_ODDS);
    });

    it('splits one roll into success, partial and failure', () => {
        const odds = { success: 0.5, partial: 0.25 };
        expect(rollOutcome(odds, always(0.49))).toBe('success');
        expect(rollOutcome(odds, always(0.5))).toBe('partial');
        expect(rollOutcome(odds, always(0.74))).toBe('partial');
        expect(rollOutcome(odds, always(0.75))).toBe('failure');
    });

    it('advances 1–2 on success by the mode, 1 with a price on a partial, maybe −1 on a failure', () => {
        const action = { source: 'intention' as const, goal: 'g', attempt: 'a', clock: { segments: 4, filled: 2 } };
        const odds = { resources: 0, leverage: 0, progress: 0 };
        expect(resolveAction(action, odds, 'balanced', seq(0.1, 0.3))).toEqual({
            outcome: 'success',
            advance: 2,
            chance: 0.4,
        });
        expect(resolveAction(action, odds, 'balanced', seq(0.1, 0.5)).advance).toBe(1);
        expect(resolveAction(action, odds, 'economy', seq(0.1, 0.7)).advance).toBe(2);
        expect(resolveAction(action, odds, 'cinema', seq(0.1, 0.3)).advance).toBe(1);
        expect(resolveAction(action, odds, 'balanced', seq(0.5, 0.0))).toEqual({
            outcome: 'partial',
            advance: 1,
            complication: 'cost',
            chance: 0.4,
        });
        expect(resolveAction(action, odds, 'balanced', seq(0.5, 0.99)).complication).toBe('trail');
        expect(resolveAction(action, odds, 'balanced', seq(0.9, 0.1))).toEqual({
            outcome: 'failure',
            advance: -1,
            setback: true,
            chance: 0.4,
        });
        expect(resolveAction(action, odds, 'balanced', seq(0.9, 0.5))).toMatchObject({ advance: 0, setback: false });
        // An empty clock cannot lose ground (and no setback roll is made).
        const fresh = { ...action, clock: { segments: 4, filled: 0 } };
        expect(resolveAction(fresh, odds, 'balanced', seq(0.9, 0.0))).toMatchObject({ advance: 0, setback: false });
    });

    it('lands close to its odds over many seeded rolls', () => {
        const rng = seeded(42);
        const odds = attemptOdds({ resources: 2, leverage: 1, progress: 0.5 });
        const counts = { success: 0, partial: 0, failure: 0 };
        for (let i = 0; i < 4000; i++) counts[rollOutcome(odds, rng)] += 1;
        expect(counts.success / 4000).toBeCloseTo(odds.success, 1);
        expect(counts.partial / 4000).toBeCloseTo(0.25, 1);
    });
});

/* ------------------------------------------------------------------ the tick: actions */

describe('worldTick — off-screen actions', () => {
    it('gives exactly one action to every important absent character and none to the present', () => {
        const { profiles, state } = port();
        state.characters.mira!.agenda = agenda({
            intentions: [{ id: 'm', text: 'sell silk', nextStep: '', dropIf: [], clock: { segments: 4, filled: 0 } }],
        });
        const { state: next, brief, events } = worldTick(state, profiles, ctx(always(0.2)));
        expect(brief.attempts.map((a) => a.id).sort()).toEqual(['captain', 'guild', 'ilva']);
        for (const id of ['captain', 'guild', 'ilva']) expect(next.characters[id]!.offscreen).toHaveLength(1);
        expect(next.characters.mira!.offscreen).toBeUndefined();
        expect(next.characters.mira!.agenda.intentions[0]!.clock).toEqual({ segments: 4, filled: 0 });
        expect(events.filter((e) => e.line === 'attempt.success')).toHaveLength(3);
        expect(events.every((e) => e.kind.startsWith('world.') && e.turn === 20)).toBe(true);
    });

    it('records the attempt: goal, step, outcome and the clock', () => {
        const { profiles, state } = port();
        const { state: next } = worldTick(state, profiles, ctx(always(0.2)));
        // Ильва: one option, success (0.4375) and a double step (0.2 < 0.4): 1 → 3.
        expect(next.characters.ilva!.offscreen).toEqual([
            {
                turn: 20,
                goal: 'raise the tax by Friday',
                attempt: 'sell the barley',
                outcome: 'success',
                advanced: 2,
                clock: { segments: 4, filled: 3 },
                source: 'intention',
                chance: 0.438,
            },
        ]);
        expect(next.characters.ilva!.agenda.intentions[0]!.clock).toEqual({ segments: 4, filled: 3 });
        // The guild works its front: 0 → 2, the next step is now «pressures the captain».
        expect(next.characters.guild!.agenda.front!.clock.filled).toBe(2);
        expect(next.characters.guild!.offscreen![0]).toMatchObject({ source: 'front', attempt: 'buys up debts' });
        // The captain got intentions from his goals and a default clock.
        expect(next.characters.captain!.agenda.intentions.map((i) => i.goalId)).toEqual(['g1', 'g2']);
        expect(next.characters.captain!.agenda.intentions[0]!.clock).toEqual({ segments: 4, filled: 2 });
    });

    it('marks a partial success with its price and a failure without progress', () => {
        const { profiles, state } = port();
        const partial = worldTick(state, profiles, ctx(always(0.6), { presentIds: only(state, ['ilva']) }));
        const attempt = partial.state.characters.ilva!.offscreen![0]!;
        expect(attempt).toMatchObject({ outcome: 'partial', advanced: 1, complication: COMPLICATIONS.balked });
        expect(partial.events.find((e) => e.line === 'attempt.partial')).toMatchObject({
            character: 'ilva',
            params: { name: 'Ильва', attempt: 'sell the barley', complication: 'balked' },
        });
        const failed = worldTick(state, profiles, ctx(always(0.95), { presentIds: only(state, ['ilva']) }));
        expect(failed.state.characters.ilva!.offscreen![0]).toMatchObject({ outcome: 'failure', advanced: 0 });
        expect(failed.events.map((e) => e.line)).toContain('attempt.failure');
        const setback = worldTick(state, profiles, ctx(seq(0.95, 0.1), { presentIds: only(state, ['ilva']) }));
        expect(setback.state.characters.ilva!.offscreen![0]).toMatchObject({
            outcome: 'failure',
            advanced: -1,
            complication: 'lost ground',
            clock: { segments: 4, filled: 0 },
        });
        expect(setback.events.map((e) => e.line)).toContain('attempt.setback');
    });

    it('keeps the last attempts only', () => {
        const { profiles, state } = port();
        let current = state;
        const ids = only(state, ['guild']);
        for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
            current = worldTick({ ...current, turn: 20 + i }, profiles, ctx(always(0.95), { presentIds: ids })).state;
        }
        const attempts = current.characters.guild!.offscreen!;
        expect(attempts).toHaveLength(MAX_ATTEMPTS);
        expect(attempts[0]!.turn).toBe(22);
    });

    it('achieves an intention whose clock fills and moves on to the next goal', () => {
        const { profiles, state } = port();
        state.characters.ilva!.agenda.intentions[0]!.clock = { segments: 4, filled: 3 };
        const {
            state: next,
            events,
            brief,
        } = worldTick(state, profiles, ctx(always(0.2), { presentIds: only(state, ['ilva']) }));
        const a = next.characters.ilva!.agenda;
        expect(a.goals.map((g) => g.id)).toEqual(['g2']);
        expect(a.intentions.map((i) => i.goalId)).toEqual(['g2']);
        expect(brief.achieved).toEqual([{ id: 'ilva', name: 'Ильва', intention: 'raise the tax by Friday' }]);
        expect(events.map((e) => e.line)).toEqual(['attempt.success', 'intention.done']);
    });

    it('completes intentions that filled on-screen before choosing the next action', () => {
        const { profiles, state } = port();
        state.characters.ilva!.agenda.intentions[0]!.clock = { segments: 4, filled: 4 };
        const { state: next, events } = worldTick(
            state,
            profiles,
            ctx(always(0.95), { presentIds: only(state, ['ilva']) }),
        );
        expect(events.map((e) => e.line)).toEqual(['intention.done', 'attempt.failure']);
        expect(next.characters.ilva!.offscreen![0]!.goal).toBe('keep Сота safe');
    });

    it('does not touch the input state', () => {
        const { profiles, state } = port();
        const copy = structuredClone(state);
        worldTick(state, profiles, ctx(always(0.2), { hours: 30 }));
        expect(state).toEqual(copy);
    });
});

/* ------------------------------------------------------------------ the tick: fronts */

describe('worldTick — fronts and doom', () => {
    function doomed() {
        const { profiles, state } = port();
        const guild = profiles.find((p) => p.id === 'guild')!;
        guild.agenda.front = front(5, {
            consequences: [
                { kind: 'reputation', among: 'порт', delta: -1, label: 'прихвостень гильдии' },
                { kind: 'stance', who: 'captain', target: PLAYER_ID, delta: -1, text: 'ты не остановил поджог' },
            ],
        });
        state.characters.guild!.agenda = structuredClone(guild.agenda);
        return { profiles, state };
    }

    it('brings the doom when the clock fills: log line, front done, consequences applied', () => {
        const { profiles, state } = doomed();
        const {
            state: next,
            events,
            brief,
        } = worldTick(state, profiles, ctx(always(0.2), { presentIds: only(state, ['guild']) }));
        const f = next.characters.guild!.agenda.front!;
        expect(f.done).toBe(true);
        expect(f.clock).toEqual({ segments: 6, filled: 6 });
        expect(brief.dooms).toEqual([{ id: 'guild', name: 'Гильдия', doom: 'the port is theirs' }]);
        expect(events.map((e) => e.line)).toEqual([
            'attempt.success',
            'front.doom',
            'consequence.reputation',
            'consequence.stance',
        ]);
        expect(next.reputation).toEqual([
            {
                among: 'порт',
                label: 'прихвостень гильдии',
                stance: -1,
                weaknesses: [],
                reasons: ['the port is theirs'],
            },
        ]);
        const toPlayer = next.characters.captain!.ties[PLAYER_ID]!;
        expect(toPlayer.stance).toBe(-1);
        expect(toPlayer.reasons[0]).toMatchObject({
            text: 'ты не остановил поджог',
            delta: -1,
            scenesLeft: null,
            key: true,
        });
        expect(brief.touched).toEqual(expect.arrayContaining(['guild', 'captain']));
    });

    it('never acts on a finished front again', () => {
        const { profiles, state } = doomed();
        const first = worldTick(state, profiles, ctx(always(0.2), { presentIds: only(state, ['guild']) })).state;
        const second = worldTick(first, profiles, ctx(always(0.2), { presentIds: only(state, ['guild']) }));
        expect(second.brief.attempts).toEqual([]);
        expect(second.brief.dooms).toEqual([]);
    });

    it('fires a front filled on-screen even while its owner is present', () => {
        const { profiles, state } = doomed();
        state.characters.guild!.agenda.front!.clock.filled = 6;
        const { state: next, brief } = worldTick(
            state,
            profiles,
            ctx(always(0.2), { presentIds: Object.keys(state.characters) }),
        );
        expect(brief.dooms).toHaveLength(1);
        expect(brief.attempts).toEqual([]);
        expect(next.characters.guild!.agenda.front!.done).toBe(true);
    });
});

/* ------------------------------------------------------------------ the tick: appetites */

describe('worldTick — appetites off-screen', () => {
    it('sates an absent character by chance: Грукк came back with loot', () => {
        const { profiles, state } = port();
        const grukk = profiles.find((p) => p.id === 'grukk')!;
        expect(offscreenSatiation(grukk.appetites[0]!, appState({ pressure: 4 }), grukk)).toBe(0.5);
        const {
            state: next,
            events,
            brief,
        } = worldTick(state, profiles, ctx(always(0.2), { presentIds: only(state, ['grukk']) }));
        expect(next.characters.grukk!.appetites.plunder).toMatchObject({ pressure: 1, lastSated: 20, edgeCount: 1 });
        expect(brief.sated).toEqual([{ id: 'grukk', name: 'Грукк', appetite: 'plunder' }]);
        expect(events.find((e) => e.line === 'appetite.sated')).toMatchObject({
            character: 'grukk',
            params: { name: 'Грукк', appetite: 'добыча', kind: 'plunder' },
        });
        // Sated for a while: without cues an opportunity appetite does not climb back by itself.
        const later = worldTick(next, profiles, ctx(always(0.2), { presentIds: only(state, ['grukk']), hours: 48 }));
        expect(later.state.characters.grukk!.appetites.plunder!.pressure).toBe(0);
    });

    it('lets time work on absent appetites when the chance does not come', () => {
        const { profiles, state } = port();
        const grukk = profiles.find((p) => p.id === 'grukk')!;
        grukk.appetites.push(appetite({ id: 'drink', kind: 'drink', baseline: 3, drift: 'daily' }));
        state.characters.grukk!.appetites.drink = appState({ pressure: 1 });
        const { state: next } = worldTick(
            state,
            profiles,
            ctx(always(0.99), { presentIds: only(state, ['grukk']), hours: 48 }),
        );
        expect(next.characters.grukk!.appetites.drink).toMatchObject({ pressure: 3, daysUnsated: 2 });
        // Without cues an opportunity appetite cools down day by day.
        expect(next.characters.grukk!.appetites.plunder!.pressure).toBe(2);
    });

    it('never sates off-screen what is aimed at the player, below «present», and rarely under a vow', () => {
        const { profiles } = port();
        const tessa = profiles.find((p) => p.id === 'tessa')!;
        expect(offscreenSatiation(tessa.appetites[0]!, appState({ pressure: 5 }), tessa)).toBe(0);
        const drink = appetite({ drift: 'daily' });
        expect(offscreenSatiation(drink, appState({ pressure: 1 }), tessa)).toBe(0);
        expect(offscreenSatiation(drink, appState({ pressure: 2 }), tessa)).toBe(0.35);
        expect(offscreenSatiation(drink, appState({ pressure: 3 }), tessa)).toBe(0.7);
        expect(offscreenSatiation({ ...drink, vow: 'abstinent' }, appState({ pressure: 3 }), tessa)).toBeCloseTo(0.21);
        expect(offscreenSatiation({ ...drink, vow: 'moderate' }, appState({ pressure: 3 }), tessa)).toBeCloseTo(0.49);
    });

    it('leaves the appetites of present characters to the turn pass', () => {
        const { profiles, state } = port();
        const { state: next } = worldTick(state, profiles, ctx(always(0.2), { presentIds: ['grukk'] }));
        expect(next.characters.grukk!.appetites.plunder!.pressure).toBe(4);
    });
});

/* ------------------------------------------------------------------ the tick: schemes */

function scheme(patch: Partial<Scheme> = {}): Scheme {
    return {
        id: 's1',
        owner: 'grukk',
        target: 'mira',
        appetite: 'plunder',
        method: 8,
        text: 'cut her wagon off at the ford at dusk',
        clock: { segments: 5, filled: 1 },
        secrecy: 0,
        breaches: 4,
        accomplices: [],
        state: 'running',
        startedTurn: 5,
        ...patch,
    };
}

describe('worldTick — schemes off-screen', () => {
    it('a breach too many exposes the scheme and starts a rumour about the schemer', () => {
        const { profiles, state } = port();
        state.schemes = [scheme()];
        const { state: next, events, brief } = worldTick(state, profiles, ctx(always(0.05)));
        expect(next.schemes[0]).toMatchObject({ state: 'exposed', breaches: 5 });
        expect(brief.exposed).toEqual([
            {
                scheme: 's1',
                owner: 'grukk',
                name: 'Грукк',
                text: 'cut her wagon off at the ford at dusk',
                rumour: 'scheme-s1',
            },
        ]);
        const rumour = next.rumours.find((r) => r.id === 'scheme-s1')!;
        expect(rumour).toMatchObject({
            text: 'Грукк schemes against Мира: cut her wagon off at the ford at dusk',
            about: 'grukk',
            origin: 'Грукк',
            reached: ['Грукк'],
            turn: 20,
        });
        expect(events.map((e) => e.line)).toContain('scheme.exposed');
    });

    it('logs a breach that does not expose yet, and a scheme that gets ready', () => {
        const { profiles, state } = port();
        state.schemes = [scheme({ breaches: 0, clock: { segments: 5, filled: 4 }, accomplices: ['snikt'] })];
        // Opportunity (0.05 < 0.25: the target is near the player) and a breach (0.05 < 0.1).
        const { state: next, events } = worldTick(state, profiles, ctx(always(0.05)));
        expect(next.schemes[0]).toMatchObject({ state: 'ready', breaches: 1, clock: { filled: 5 } });
        expect(events.map((e) => e.line)).toEqual(expect.arrayContaining(['scheme.breach', 'scheme.ready']));
    });

    it('attempts a ready scheme off-screen when the target is far from the player; success sates the appetite', () => {
        const { profiles, state } = port();
        state.schemes = [scheme({ state: 'ready', clock: { segments: 5, filled: 5 }, secrecy: 80 })];
        const { state: next, events, brief } = worldTick(state, profiles, ctx(always(0.1), { presentIds: [] }));
        expect(next.schemes[0]!.state).toBe('done');
        expect(events.map((e) => e.line)).toEqual(expect.arrayContaining(['scheme.done', 'appetite.sated']));
        expect(brief.sated).toEqual([{ id: 'grukk', name: 'Грукк', appetite: 'plunder' }]);
    });

    it('waits with a ready scheme against someone near the player (an on-screen attempt)', () => {
        const { profiles, state } = port();
        state.schemes = [scheme({ state: 'ready', clock: { segments: 5, filled: 5 } })];
        const { state: next } = worldTick(state, profiles, ctx(always(0.1)));
        expect(next.schemes[0]!.state).toBe('ready');
    });

    it('records a failed off-screen attempt', () => {
        const { profiles, state } = port();
        state.schemes = [scheme({ state: 'ready', clock: { segments: 5, filled: 5 }, secrecy: 100 })];
        // Roll 0.99 fails; exposure (0 + guardians 0.2) is not rolled under.
        const { state: next, events } = worldTick(state, profiles, ctx(always(0.99), { presentIds: [] }));
        expect(next.schemes[0]!.state).toBe('failed');
        expect(events.map((e) => e.line)).toContain('scheme.failed');
    });

    it('never carries out a sexual scheme against a minor, nor sates a minor’s sexual appetite (content boundary)', () => {
        const { profiles, state } = port();
        const grukk = profiles.find((p) => p.id === 'grukk')!;
        grukk.appetites = grukk.appetites.map((item) => ({ ...item, kind: 'flesh' as const }));
        profiles.find((p) => p.id === 'mira')!.minor = true;
        state.schemes = [scheme({ state: 'ready', clock: { segments: 5, filled: 5 }, secrecy: 80 })];
        // The rolls that carry it out otherwise (see «attempts a ready scheme off-screen»).
        const { state: next, events, brief } = worldTick(state, profiles, ctx(always(0.1), { presentIds: [] }));
        expect(next.schemes[0]!.state).toBe('failed');
        expect(events.map((e) => e.line)).not.toContain('scheme.done');
        expect(brief.exposed).toEqual([]);

        const holder = port();
        const minor = holder.profiles.find((p) => p.id === 'grukk')!;
        minor.minor = true;
        minor.appetites = minor.appetites.map((item) => ({ ...item, kind: 'flesh' as const }));
        const tick = worldTick(holder.state, holder.profiles, ctx(always(0.2), { presentIds: [] }));
        expect(tick.brief.sated).toEqual([]);
        expect(tick.state.characters.grukk!.appetites.plunder).toEqual(
            holder.state.characters.grukk!.appetites.plunder,
        );
    });

    it('leaves schemes of present owners alone', () => {
        const { profiles, state } = port();
        state.schemes = [scheme()];
        const { state: next } = worldTick(state, profiles, ctx(always(0.05), { presentIds: ['grukk'] }));
        expect(next.schemes[0]).toEqual(state.schemes[0]);
    });
});

/* ------------------------------------------------------------------ the tick: rumours */

function tavernRumour(patch: Partial<Rumour> = {}): Rumour {
    return {
        id: 'r1',
        text: 'курьер не платит налог',
        about: PLAYER_ID,
        origin: 'Трактир',
        carriers: [],
        reached: ['трактир'],
        turn: 3,
        ...patch,
    };
}

describe('worldTick — rumours and who knows the player', () => {
    it('builds the talk graph from groups, places and non-hostile ties', () => {
        const { profiles, state } = port();
        state.characters.grukk!.ties.guild = tie('guild', 2);
        state.characters.captain!.ties.ilva = tie('ilva', -3);
        const index = socialIndex(state, profiles, { presentIds: ['ilva'], place: 'Трактир' });
        expect(index.nodesOf.get('ilva')).toEqual(['Ильва', 'Трактир']);
        expect(index.nodesOf.get('grukk')).toEqual(['Грукк', 'Гильдия']);
        // The captain is hostile to the guild: not a member, and no talk either.
        expect(index.nodesOf.get('captain')).toEqual(['Капитан']);
        expect(index.graph['Капитан']).toBeUndefined();
        expect(index.graph['Ильва']).toEqual(expect.arrayContaining(['Тесса', 'Трактир']));
        expect(index.canon.get('tessa')).toBe('Тесса');
        expect(index.canon.get('трактир')).toBe('Трактир');
    });

    it('spreads one hop per tick; desire toward the player wakes only with knowledge', () => {
        const { profiles, state } = port();
        state.rumours = [tavernRumour()];
        // Nobody acts off-screen in this test.
        state.characters.guild!.agenda = agenda();
        state.characters.captain!.agenda = agenda();
        const quiet = (rng: WorldTickContext['rng']) => ctx(rng, { presentIds: ['ilva'], place: 'Трактир' });

        const first = worldTick(state, profiles, quiet(always(0.2)));
        expect(first.state.rumours[0]!.reached).toEqual(['Трактир', 'Ильва']);
        expect(first.brief.spread).toEqual([{ tick: 1, rumour: 'r1', group: 'Ильва', distorted: false }]);
        // Ильва (present) heard it: a belief on her tie to the player.
        expect(first.state.characters.ilva!.ties[PLAYER_ID]!.beliefs).toEqual([
            { claim: 'курьер не платит налог', source: 'heard', confidence: 0.5 },
        ]);
        // Тесса has not heard yet: no knowledge, no tie, no want.
        const tessa1 = first.state.characters.tessa!;
        expect(tessa1.knowsPlayer).toBe(false);
        expect(tessa1.ties[PLAYER_ID]).toBeUndefined();
        expect(first.events.map((e) => e.line)).toContain('rumour.spread');
        expect(first.events.map((e) => e.line)).not.toContain('player.learned');

        const second = worldTick(first.state, profiles, quiet(always(0.2)));
        const tessa2 = second.state.characters.tessa!;
        expect(tessa2.knowsPlayer).toBe(true);
        expect(second.brief.learned).toEqual(['tessa']);
        expect(tessa2.ties[PLAYER_ID]).toMatchObject({
            stance: 0,
            want: 5,
            appetite: 'mate',
            beliefs: [{ claim: 'курьер не платит налог', source: 'heard', confidence: 0.5 }],
        });
        expect(second.events.find((e) => e.line === 'player.learned')).toMatchObject({
            character: 'tessa',
            params: { name: 'Тесса', rumour: 'курьер не платит налог' },
        });
    });

    it('meets the player with the reputation of the hearer’s groups', () => {
        const { profiles, state } = port();
        state.characters.tessa!.ties.guild = tie('guild', 1);
        state.reputation = [{ among: 'Гильдия', label: 'вор', stance: -1, weaknesses: [], reasons: [] }];
        state.rumours = [tavernRumour({ reached: ['Гильдия'] })];
        const { state: next } = worldTick(
            state,
            profiles,
            ctx(always(0.99), { presentIds: ['mira', 'guild', 'captain', 'ilva'] }),
        );
        expect(next.characters.tessa!.knowsPlayer).toBe(true);
        expect(next.characters.tessa!.ties[PLAYER_ID]).toMatchObject({ stance: -1, base: -1 });
    });

    it('marks false retellings in beliefs', () => {
        const { profiles, state } = port();
        state.rumours = [tavernRumour({ false: true })];
        const { state: next } = worldTick(
            state,
            profiles,
            ctx(always(0.2), { presentIds: ['ilva', 'mira', 'guild', 'captain'], place: 'Трактир' }),
        );
        expect(next.characters.ilva!.ties[PLAYER_ID]!.beliefs[0]).toMatchObject({ false: true });
    });

    it('lets characters hear about other characters only over existing ties', () => {
        const { profiles, state } = port();
        state.characters.tessa!.ties.grukk = tie('grukk', 0);
        state.characters.ilva!.ties.grukk = undefined as never;
        delete state.characters.ilva!.ties.grukk;
        state.rumours = [tavernRumour({ id: 'r2', about: 'grukk', text: 'Грукк ворует', reached: ['Ильва'] })];
        const { state: next } = worldTick(
            state,
            profiles,
            ctx(always(0.2), { presentIds: ['mira', 'guild', 'captain'] }),
        );
        expect(next.characters.tessa!.ties.grukk!.beliefs).toHaveLength(1);
        expect(next.characters.ilva!.ties.grukk).toBeUndefined();
    });

    it('everyone in the scene knows the player', () => {
        const { profiles, state } = port();
        state.characters.mira!.knowsPlayer = false;
        const { state: next, brief } = worldTick(
            state,
            profiles,
            ctx(always(0.99), { presentIds: ['mira', 'guild', 'captain', 'ilva'] }),
        );
        expect(next.characters.mira!.knowsPlayer).toBe(true);
        expect(brief.touched).toContain('mira');
    });

    it('wakes no want toward the player for minors or appetites aimed elsewhere', () => {
        const { profiles, state } = port();
        const tessa = profiles.find((p) => p.id === 'tessa')!;
        expect(wantOnLearning(tessa, state.characters.tessa!, [])).toEqual({ want: 5, appetite: 'mate' });
        expect(wantOnLearning({ ...tessa, minor: true }, state.characters.tessa!, [])).toBeNull();
        const grukk = profiles.find((p) => p.id === 'grukk')!;
        expect(wantOnLearning(grukk, state.characters.grukk!, [])).toBeNull();
    });

    it('keeps beliefs unique and short', () => {
        let t = tie(PLAYER_ID, 0);
        for (let i = 0; i < 12; i++) t = addBelief(t, { claim: `claim ${i}`, source: 'heard', confidence: 0.5 });
        expect(t.beliefs).toHaveLength(8);
        expect(addBelief(t, { claim: 'Claim 11!', source: 'heard', confidence: 0.5 })).toBe(t);
    });
});

/* ------------------------------------------------------------------ for Maestro */

describe('matureAgendas', () => {
    it('lists clocks at segments − 1 or full, fronts and near-doom weighing most', () => {
        const { profiles, state } = port();
        state.characters.guild!.agenda.front = front(5);
        state.characters.ilva!.agenda.intentions[0]!.clock = { segments: 4, filled: 3 };
        state.characters.captain!.agenda = agenda({
            front: front(4, { impulse: 'a new harbour master', doom: 'he rules the docks' }),
            intentions: [
                { id: 'x', text: 'keep his ship', nextStep: '', dropIf: [], clock: { segments: 4, filled: 4 } },
            ],
        });
        state.schemes = [
            scheme({ state: 'ready', clock: { segments: 5, filled: 5 } }),
            scheme({ id: 's2', clock: { segments: 5, filled: 2 } }),
        ];
        expect(matureAgendas(state, profiles)).toEqual([
            {
                text: 'Гильдия: burns the warehouse (control of the port) — if nobody intervenes: the port is theirs',
                weight: 2.5,
            },
            { text: 'Грукк: scheme against Мира — cut her wagon off at the ford at dusk', weight: 2.5 },
            { text: 'Капитан: keep his ship', weight: 2 },
            { text: 'Ильва: sell the barley (raise the tax by Friday)', weight: 1.5 },
        ]);
    });

    it('skips finished fronts and closed schemes', () => {
        const { profiles, state } = port();
        state.characters.guild!.agenda.front = front(6, { done: true });
        state.schemes = [scheme({ state: 'exposed', clock: { segments: 5, filled: 5 } })];
        expect(matureAgendas(state, profiles)).toEqual([]);
    });

    it('names the player in schemes against him', () => {
        const { profiles, state } = port();
        state.schemes = [scheme({ target: PLAYER_ID, clock: { segments: 5, filled: 4 } })];
        expect(matureAgendas(state, profiles, { playerName: 'Курьер' })).toEqual([
            { text: 'Грукк: scheme against Курьер — cut her wagon off at the ford at dusk', weight: 2 },
        ]);
    });
});

describe('offscreenBrief', () => {
    function attempt(turn: number, patch: Partial<OffscreenAttempt> = {}): OffscreenAttempt {
        return {
            turn,
            goal: 'carry off the merchant’s goods',
            attempt: 'ask the carters when the caravan leaves',
            outcome: 'success',
            advanced: 1,
            clock: { segments: 5, filled: 2 },
            source: 'intention',
            chance: 0.5,
            ...patch,
        };
    }

    it('tells goals, the front, what they tried since last seen and how it went', () => {
        const { profiles, state } = port();
        const grukk = profiles.find((p) => p.id === 'grukk')!;
        const g = state.characters.grukk!;
        g.lastSeenTurn = 5;
        g.agenda = agenda({
            intentions: [
                {
                    id: 'i',
                    text: 'carry off the merchant’s goods',
                    nextStep: '',
                    dropIf: [],
                    clock: { segments: 5, filled: 3 },
                },
            ],
            front: front(2, { impulse: 'the band wants the ford', steps: [], doom: 'no caravan passes' }),
        });
        g.offscreen = [
            attempt(4, { attempt: 'old news' }),
            attempt(8),
            attempt(9, {
                outcome: 'partial',
                complication: 'it cost more than planned',
                clock: { segments: 5, filled: 3 },
            }),
            attempt(10, { outcome: 'failure', complication: 'lost ground', attempt: 'scout the ford' }),
        ];
        g.appetites.plunder = appState({ pressure: 1, lastSated: 9 });
        state.schemes = [scheme({ clock: { segments: 5, filled: 2 } })];
        expect(offscreenBrief(state, grukk, { profiles })).toBe(
            'Грукк — Wants: carry off the merchant’s goods. ' +
                'Agenda: the band wants the ford (2/6), next: the band wants the ford; if nobody intervenes: no caravan passes. ' +
                'Since last seen: tried to ask the carters when the caravan leaves — succeeded (2/5); ' +
                'tried to ask the carters when the caravan leaves — partly succeeded, but it cost more than planned (3/5); ' +
                'tried to scout the ford — failed and lost ground (2/5). ' +
                'Sated off-screen: добыча. ' +
                'Scheming against Мира: cut her wagon off at the ford at dusk (2/5).',
        );
    });

    it('falls back to goals, tells a doom that came, withdrawal and exposed schemes', () => {
        const { profiles, state } = port();
        const captain = profiles.find((p) => p.id === 'captain')!;
        captain.appetites = [appetite({ id: 'drink', kind: 'drink' })];
        const c = state.characters.captain!;
        c.agenda = { ...c.agenda, front: front(6, { done: true }) };
        c.appetites.drink = appState({ withdrawal: true });
        state.schemes = [scheme({ owner: 'captain', target: PLAYER_ID, state: 'exposed' })];
        expect(offscreenBrief(state, captain, { profiles, playerName: 'Курьер' })).toBe(
            'Капитан — Wants: keep his ship; pay the crew. Their agenda came to pass: the port is theirs. ' +
                'In withdrawal: drink. Their scheme against Курьер was exposed: cut her wagon off at the ford at dusk.',
        );
    });

    it('is null when there is nothing to tell or no state', () => {
        const { profiles, state } = port();
        expect(
            offscreenBrief(
                state,
                profiles.find((p) => p.id === 'mira')!,
            ),
        ).toBeNull();
        expect(offscreenBrief(state, profile('ghost', 'Призрак'))).toBeNull();
    });
});

/* ------------------------------------------------------------------ the log and the profile normaliser */

describe('appendLog', () => {
    it('appends lines without their localization fields and keeps the last MAX_LOG', () => {
        const state = chat(
            {},
            { log: Array.from({ length: MAX_LOG }, (_, i) => ({ turn: i, kind: 'x', text: `${i}` })) },
        );
        const next = appendLog(state, [
            {
                turn: 400,
                kind: 'world.front',
                text: 'doom',
                character: 'guild',
                line: 'front.doom',
                params: {},
            } as never,
        ]);
        expect(next.log).toHaveLength(MAX_LOG);
        expect(next.log.at(-1)).toEqual({ turn: 400, kind: 'world.front', text: 'doom', character: 'guild' });
        expect(appendLog(state, [])).toBe(state);
    });
});

describe('front consequences in profiles', () => {
    it('survive normalisation, garbage dropped', () => {
        const a = normalizeAgenda({
            front: {
                impulse: 'control of the port',
                steps: ['buys up debts'],
                doom: 'the port is theirs',
                clock: { segments: 6, filled: 2 },
                done: true,
                consequences: [
                    { kind: 'stance', target: PLAYER_ID, delta: -1, who: 'captain' },
                    { kind: 'reputation', among: 'порт', delta: '-2', label: 'вор' },
                    { kind: 'stance', target: '', delta: 1 },
                    { kind: 'reputation', among: 'x', delta: 0 },
                    { kind: 'other', target: 'x', delta: 1 },
                    'garbage',
                ],
            },
        });
        expect(a.front).toEqual({
            impulse: 'control of the port',
            steps: ['buys up debts'],
            doom: 'the port is theirs',
            clock: { segments: 6, filled: 2 },
            done: true,
            consequences: [
                { kind: 'stance', who: 'captain', target: PLAYER_ID, delta: -1 },
                { kind: 'reputation', among: 'порт', delta: -2, label: 'вор' },
            ],
        });
        expect(normalizeAgenda({ front: { impulse: 'x', consequences: [] } }).front).toEqual({
            impulse: 'x',
            steps: [],
            doom: '',
            clock: { segments: 6, filled: 0 },
        });
    });
});
