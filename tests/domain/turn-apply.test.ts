import { describe, expect, it } from 'vitest';
import { PLAYER_ID } from '../../src/domain/model';
import type { CharacterProfile, ChatState } from '../../src/domain/model';
import { emptyProfile } from '../../src/domain/profile-defaults';
import {
    ACT_EFFECTS,
    DEFAULT_LEVERS,
    actDelta,
    applyArcProposal,
    applyTurnPass,
    arcProposalValid,
    commitTurn,
    detectDrift,
    leversFor,
    makeResolver,
    parseArcProposal,
    schemeText,
} from '../../src/domain/turn-apply';
import type { TurnContext, TurnInput, TurnLevers } from '../../src/domain/turn-apply';
import { ACTS } from '../../src/domain/turn-prompt';
import { always, appetite, seeded } from './appetites-fixtures';
import { TAVERN_PRESENT, chat, liveState, reason, tavern, tie } from './cast-fixtures';
import { beekeeper, entry, event, ford, turnPass } from './turn-fixtures';

function ctx(patch: Partial<TurnContext> = {}, levers: Partial<TurnLevers> = {}): TurnContext {
    return { rng: seeded(7), levers: { ...DEFAULT_LEVERS, ...levers }, messageIndex: 3, ...patch };
}

function tavernInput(patch: Partial<TurnInput> = {}): TurnInput {
    const { profiles, state } = tavern();
    return { state, profiles, present: TAVERN_PRESENT, playerName: 'Курьер', ...patch };
}

describe('the act table', () => {
    it('scales a moderate act by intensity and moves nothing for wanting', () => {
        expect(actDelta('pay', 3)).toBe(0.4);
        expect(actDelta('help', 3)).toBe(0.5);
        expect(actDelta('harm', 5)).toBe(-1.25);
        expect(actDelta('insult', 1)).toBeCloseTo(-0.167, 3);
        for (const act of ['seduce', 'indulge', 'satisfy-appetite', 'other'] as const) expect(actDelta(act, 5)).toBe(0);
        expect(Object.keys(ACT_EFFECTS).sort()).toEqual([...ACTS].sort());
    });

    it('is positive for help, save, gift, pay, respect and negative for harm, insult, threat, betray, lie, defy', () => {
        for (const act of ['help', 'save', 'gift', 'pay', 'respect'] as const)
            expect(actDelta(act, 3)).toBeGreaterThan(0);
        for (const act of ['harm', 'insult', 'threat', 'betray', 'lie', 'defy'] as const)
            expect(actDelta(act, 3)).toBeLessThan(0);
        expect(ACT_EFFECTS.save.permanent).toBe(true);
        expect(ACT_EFFECTS.betray.permanent).toBe(true);
    });
});

describe('levers and names', () => {
    it('takes valid chat overrides over the settings', () => {
        const levers = leversFor({ ...DEFAULT_LEVERS, mode: 'economy' }, { inertia: 'low', driftResponse: 'bogus' });
        expect(levers.mode).toBe('economy');
        expect(levers.inertia).toBe('low');
        expect(levers.driftResponse).toBe('correct');
    });

    it('resolves sheet ids, PLAYER, the player name and story names', () => {
        const { profiles } = tavern();
        const resolve = makeResolver(profiles, 'Курьер');
        expect(resolve('ilva')).toBe('ilva');
        expect(resolve('[bram]')).toBe('bram');
        expect(resolve('PLAYER')).toBe(PLAYER_ID);
        expect(resolve('курьер')).toBe(PLAYER_ID);
        expect(resolve('Ильвы')).toBe('ilva');
        expect(resolve('')).toBeNull();
        expect(resolve('Незнакомец')).toBeNull();
    });
});

describe('applyTurnPass — the generous tip (§5.6)', () => {
    const pass = turnPass({
        events: [event('PLAYER', 'ilva', 'pay', 'left a generous tip', { witnesses: ['bram', 'sota'], intensity: 4 })],
        characters: [
            entry('ilva', {
                emotion: { type: 'suspicion', intensity: 3, target: 'PLAYER', cause: 'an imperial buying favour' },
                doing: 'pockets the coin without a word',
            }),
            entry('bram', { playerRole: 'means' }),
            entry('sota', {
                emotion: { type: 'curiosity', intensity: 3, target: 'PLAYER', cause: 'a stranger with money' },
                playerRole: 'target',
            }),
            entry('carters', { relevant: false }),
        ],
    });

    it('gives Ильва a reason and suspicion, but no stance step', () => {
        const result = applyTurnPass(tavernInput(), pass, ctx());
        const ilva = result.state.characters.ilva!;
        const toPlayer = ilva.ties[PLAYER_ID]!;
        expect(toPlayer.stance).toBe(-2);
        const added = toPlayer.reasons.find((item) => item.text === 'left a generous tip');
        expect(added).toMatchObject({ delta: 0.533, scenesLeft: 2, sourceMessage: 3 });
        expect(toPlayer.progress?.dir).toBe(1);
        expect(ilva.emotion).toMatchObject({ type: 'suspicion', target: PLAYER_ID });
        expect(ilva.mood.octant).toBe('hostile');
        expect(ilva.scene.doing).toBe('pockets the coin without a word');
        expect(result.events.some((line) => line.kind === 'reason' && line.character === 'ilva')).toBe(true);
        expect(result.events.some((line) => line.kind === 'stance')).toBe(false);
        expect(result.proposals).toEqual([]);
    });

    it('computes the next turn: bands, moves, turn counter, last seen', () => {
        const result = applyTurnPass(tavernInput(), pass, ctx());
        expect(result.state.turn).toBe(1);
        expect(result.state.next?.turn).toBe(1);
        expect(result.state.next?.bands).toMatchObject({ bram: 'business', carters: 'background', fenn: 'background' });
        expect(result.state.next?.bands?.sota).toBe('focus');
        expect(Object.keys(result.state.next?.moves ?? {}).length).toBeGreaterThan(0);
        expect(result.state.characters.carters!.scene.attention).toBe('background');
        expect(result.state.characters.bram!.lastSeenTurn).toBe(1);
        expect(result.state.log.length).toBe(result.events.length);
    });

    it('keeps the input state untouched', () => {
        const input = tavernInput();
        const before = structuredClone(input.state);
        applyTurnPass(input, pass, ctx());
        expect(input.state).toEqual(before);
    });

    it('a character the exchange did not touch does not react (relevance gate)', () => {
        const insult = turnPass({
            events: [event('PLAYER', 'bram', 'insult', 'called him a drunk')],
            characters: [
                entry('bram', {
                    relevant: false,
                    emotion: { type: 'anger', intensity: 4, target: 'PLAYER', cause: 'x' },
                }),
            ],
        });
        const untouched = applyTurnPass(tavernInput(), insult, ctx());
        expect(untouched.state.characters.bram!.ties[PLAYER_ID]!.reasons).toHaveLength(1);
        expect(untouched.state.characters.bram!.emotion).toBeUndefined();
        const touched = applyTurnPass(
            tavernInput(),
            {
                ...insult,
                characters: [entry('bram', { emotion: { type: 'anger', intensity: 4, target: 'PLAYER', cause: 'x' } })],
            },
            ctx(),
        );
        const bram = touched.state.characters.bram!;
        expect(bram.ties[PLAYER_ID]!.reasons.some((item) => item.text === 'called him a drunk' && item.delta < 0)).toBe(
            true,
        );
        expect(bram.mood.octant).toBe('hostile');
    });

    it('a witnessed act against someone dear counts half', () => {
        const result = applyTurnPass(
            tavernInput(),
            turnPass({
                events: [event('PLAYER', 'sota', 'insult', 'mocked Сота', { witnesses: ['ilva'] })],
                characters: [entry('ilva'), entry('sota')],
            }),
            ctx(),
        );
        const reasonOnIlva = result.state.characters.ilva!.ties[PLAYER_ID]!.reasons.find(
            (item) => item.text === 'mocked Сота',
        );
        expect(reasonOnIlva?.delta).toBe(-0.25);
        const onSota = result.state.characters.sota!.ties[PLAYER_ID]!.reasons.find(
            (item) => item.text === 'mocked Сота',
        );
        expect(onSota?.delta).toBe(-0.5);
    });

    it('a severe act steps down at once and logs the step', () => {
        const result = applyTurnPass(
            tavernInput(),
            turnPass({
                events: [event('PLAYER', 'bram', 'harm', 'broke his nose', { intensity: 5 })],
                characters: [entry('bram')],
            }),
            ctx({ uiLang: 'ru' }),
        );
        expect(result.state.characters.bram!.ties[PLAYER_ID]!.stance).toBe(-1);
        const step = result.events.find((line) => line.kind === 'stance');
        expect(step?.text).toContain('Брам → Курьер');
        expect(step?.messageIndex).toBe(3);
    });
});

describe('applyTurnPass — arcs (§5.2.5, §9)', () => {
    function bounded(arcLock = false): TurnInput {
        const input = tavernInput();
        const ilva = input.profiles.find((profile) => profile.id === 'ilva')!;
        ilva.core = { ...ilva.core, stanceBounds: [{ target: PLAYER_ID, max: -2 }], arcLock };
        return input;
    }
    const rescue = turnPass({
        events: [
            event('PLAYER', 'sota', 'save', 'pulled Сота out of the burning stable', {
                witnesses: ['ilva'],
                intensity: 5,
            }),
        ],
        characters: [entry('ilva', { keyMatched: 'protection of her daughter' }), entry('sota')],
    });

    it('holds a key event at the author bound and proposes the step', () => {
        const result = applyTurnPass(bounded(), rescue, ctx());
        expect(result.state.characters.ilva!.ties[PLAYER_ID]!.stance).toBe(-2);
        expect(result.proposals).toEqual([
            expect.objectContaining({ character: 'ilva', target: PLAYER_ID, dir: 1, from: -2, to: -1, turn: 1 }),
        ]);
        expect(result.events.some((line) => line.kind === 'arc')).toBe(true);

        const proposal = parseArcProposal(JSON.parse(JSON.stringify(result.proposals[0])))!;
        expect(arcProposalValid(result.state, proposal)).toBe(true);
        const applied = applyArcProposal(result.state, proposal, {
            profiles: bounded().profiles,
            playerName: 'Курьер',
        });
        expect(applied.applied).toBe(true);
        expect(applied.state.characters.ilva!.ties[PLAYER_ID]!.stance).toBe(-1);
        expect(applied.state.characters.ilva!.ties[PLAYER_ID]!.progress).toBeUndefined();
        expect(applied.events[0]?.kind).toBe('arc');
        expect(arcProposalValid(applied.state, proposal)).toBe(false);
        expect(applyArcProposal(applied.state, proposal).applied).toBe(false);
    });

    it('never proposes for a character the author locked', () => {
        const result = applyTurnPass(bounded(true), rescue, ctx());
        expect(result.proposals).toEqual([]);
    });

    it('rejects malformed payloads', () => {
        expect(parseArcProposal(null)).toBeNull();
        expect(parseArcProposal({ character: 'a', target: 'b', from: 5, to: 1, dir: 1 })).toBeNull();
        expect(parseArcProposal({ character: 'a', target: 'b', from: 0, to: 1, dir: 2 })).toBeNull();
    });
});

describe('applyTurnPass — intentions and feelings', () => {
    function withIntention(): TurnInput {
        const input = tavernInput();
        const ilva = input.state.characters.ilva!;
        ilva.agenda = {
            ...ilva.agenda,
            goals: [{ id: 'tax', text: 'raise the garrison tax by Friday', kind: 'external', priority: 1 }],
            intentions: [
                {
                    id: 'i-tax',
                    goalId: 'tax',
                    text: 'raise the garrison tax',
                    nextStep: '',
                    dropIf: [],
                    clock: { segments: 6, filled: 2 },
                },
            ],
        };
        return input;
    }

    it('advances clocks, ends achieved intentions and takes up new ones', () => {
        const advanced = applyTurnPass(
            withIntention(),
            turnPass({ characters: [entry('ilva', { intentions: [{ id: 'i-tax', status: 'advanced' }] })] }),
            ctx(),
        );
        expect(advanced.state.characters.ilva!.agenda.intentions[0]!.clock).toEqual({ segments: 6, filled: 3 });

        const done = applyTurnPass(
            withIntention(),
            turnPass({
                characters: [
                    entry('ilva', {
                        intentions: [{ id: 'i-tax', status: 'achieved' }],
                        newIntention: { text: 'find out what the courier wants', nextStep: 'ask Брам to follow him' },
                    }),
                ],
            }),
            ctx({ uiLang: 'ru' }),
        );
        const agenda = done.state.characters.ilva!.agenda;
        expect(agenda.goals).toEqual([]);
        expect(agenda.intentions.map((item) => item.text)).toEqual(['find out what the courier wants']);
        expect(done.events.filter((line) => line.kind === 'intention').map((line) => line.text)).toEqual([
            'Ильва: взялась за «find out what the courier wants»',
            'Ильва: добилась своего — «raise the garrison tax»',
        ]);
    });

    it('lets an emotion fade and the mood return to the baseline', () => {
        const angry = applyTurnPass(
            tavernInput(),
            turnPass({
                characters: [
                    entry('sota', { emotion: { type: 'anger', intensity: 3, target: 'bram', cause: 'he cheated' } }),
                ],
            }),
            ctx(),
        );
        const sota = angry.state.characters.sota!;
        expect(sota.emotion).toMatchObject({ type: 'anger', target: 'bram', until: 3 });
        expect(sota.mood.octant).toBe('hostile');
        let state = angry.state;
        for (let i = 0; i < 3; i++) {
            state = applyTurnPass({ ...tavernInput(), state }, turnPass(), ctx()).state;
        }
        expect(state.characters.sota!.emotion).toBeUndefined();
        expect(state.characters.sota!.mood).toEqual(tavern().profiles[2]!.core.baselineMood);
    });
});

describe('applyTurnPass — appetites (§5.7)', () => {
    it('starts the goblin scheme when nothing would work now', () => {
        const { profiles, state, present } = ford();
        const result = applyTurnPass(
            { state, profiles, present, playerName: 'Курьер' },
            turnPass(),
            ctx({ uiLang: 'ru' }),
        );
        expect(result.state.schemes).toEqual([
            expect.objectContaining({
                owner: 'grukk',
                target: 'mira',
                appetite: 'plunder',
                method: 5,
                state: 'running',
                startedTurn: 1,
                text: 'plans to trick Мира',
            }),
        ]);
        expect(result.state.next?.appetites?.grukk).toEqual([
            expect.objectContaining({ appetite: 'plunder', target: 'mira', method: 5 }),
        ]);
        expect(result.events.map((line) => line.text)).toContain('Грукк: начал замысел — plans to trick Мира');
        // The next turn ticks the scheme instead of starting another one.
        const again = applyTurnPass(
            { state: result.state, profiles, present, playerName: 'Курьер' },
            turnPass(),
            ctx(),
        );
        expect(again.state.schemes).toHaveLength(1);
        expect(again.state.next?.appetites?.grukk?.[0]?.method).toBe(5);
    });

    it('acts now when the target is alone and unguarded', () => {
        const { profiles, state } = ford();
        const result = applyTurnPass(
            { state, profiles, present: ['grukk', 'mira'], playerName: 'Курьер' },
            turnPass(),
            ctx({ rng: always(0.1) }),
        );
        expect(result.state.schemes).toEqual([]);
        const now = result.state.next?.appetites?.grukk?.[0];
        expect(now?.target).toBe('mira');
        expect(now?.method).toBeGreaterThanOrEqual(7);
    });

    it('the abstainer lapses without support and binges next turn', () => {
        const { profiles, state } = beekeeper();
        const flags = {
            id: 'drink',
            cue: true,
            idleAfterCue: false,
            satisfied: 2,
            full: false,
            refusedBy: '',
            stress: false,
            intoxicated: false,
        };
        const lapse = applyTurnPass(
            { state, profiles, present: ['yan', 'innkeeper'], playerName: 'Курьер' },
            turnPass({ characters: [entry('yan', { appetites: [flags] })] }),
            ctx({ uiLang: 'ru' }),
        );
        const yan = lapse.state.characters.yan!;
        expect(yan.appetites.drink).toMatchObject({ lapsed: true, lastSated: 1, sceneCue: 2 });
        expect(yan.corruption.stains).toBe(2);
        expect(lapse.events.map((line) => line.text)).toEqual(['Ян: сорвался — брага', 'Ян: пятно на совести (брага)']);

        const binge = applyTurnPass(
            { state: lapse.state, profiles, present: ['yan', 'innkeeper'], playerName: 'Курьер' },
            turnPass(),
            ctx({ uiLang: 'ru' }),
        );
        expect(binge.state.characters.yan!.appetites.drink).toMatchObject({ pressure: 5, lapsed: false });
        expect(binge.events.map((line) => line.text)).toContain('Ян: срыв перешёл в запой — брага');
        expect(binge.state.next?.appetites?.yan?.[0]).toMatchObject({
            appetite: 'drink',
            methodText: expect.any(String),
        });
    });

    it('the abstainer recommits when an anchor is near, and cues stop adding after two per scene', () => {
        const { profiles, state } = beekeeper();
        const flags = {
            id: 'drink',
            cue: true,
            idleAfterCue: false,
            satisfied: 2,
            full: false,
            refusedBy: '',
            stress: false,
            intoxicated: false,
        };
        const held = applyTurnPass(
            { state, profiles, present: ['yan', 'mila'], playerName: 'Курьер' },
            turnPass({ characters: [entry('yan', { appetites: [flags] })] }),
            ctx(),
        );
        expect(held.state.characters.yan!.appetites.drink).toMatchObject({ pressure: 1, lapsed: false });
        expect(held.events.some((line) => line.kind === 'appetite' && line.text.includes('holds on again'))).toBe(true);

        const cueOnly = { ...flags, satisfied: 0 };
        const after = applyTurnPass(
            { state: held.state, profiles, present: ['yan', 'mila'], playerName: 'Курьер' },
            turnPass({ characters: [entry('yan', { appetites: [cueOnly] })] }),
            ctx(),
        );
        expect(after.state.characters.yan!.appetites.drink!.pressure).toBe(1);
    });

    it('keeps only the budgeted number of hunters on the player', () => {
        const girls = ['kira', 'serafina', 'tessa'].map((id) => {
            const base = emptyProfile(id, { id });
            const profile: CharacterProfile = {
                ...base,
                appetites: [
                    appetite({ id: 'mate', kind: 'flesh', target: { mode: 'player' }, style: 'siren', baseline: 3 }),
                ],
                ties: [tie(PLAYER_ID, 1, { want: 4, gaze: 'mate', appetite: 'mate' })],
            };
            return profile;
        });
        const characters: ChatState['characters'] = {};
        for (const girl of girls) {
            characters[girl.id] = liveState(girl, {
                appetites: {
                    mate: {
                        pressure: 3,
                        tolerance: 0,
                        dependence: 0,
                        sensitization: 0,
                        lastSated: -1,
                        edgeCount: 0,
                        withdrawal: false,
                    },
                },
            });
        }
        const input: TurnInput = {
            state: chat(characters),
            profiles: girls,
            present: girls.map((g) => g.id),
            playerName: 'Герой',
        };
        const first = applyTurnPass(input, turnPass(), ctx({}, { huntersPerScene: 1 }));
        const hunting = (state: ChatState) =>
            Object.entries(state.next?.appetites ?? {})
                .filter(([, nows]) => nows.some((now) => now.target === PLAYER_ID))
                .map(([id]) => id);
        expect(hunting(first.state)).toHaveLength(1);
        const waiting = Object.values(first.state.next?.appetites ?? {})
            .flat()
            .filter((now) => now.target === undefined);
        expect(waiting).toHaveLength(2);
        expect(waiting.every((now) => now.method === 2)).toBe(true);
        const second = applyTurnPass(
            { ...input, state: first.state },
            turnPass(),
            ctx({ rng: seeded(99) }, { huntersPerScene: 1 }),
        );
        expect(hunting(second.state)).toEqual(hunting(first.state));
    });

    it('a refusal makes the next attempt coarser', () => {
        const { profiles, state, present } = ford();
        const grukk = state.characters.grukk!;
        state.next = { turn: 0, appetites: { grukk: [{ appetite: 'plunder', target: 'mira', method: 3 }] } };
        grukk.appetites.plunder!.pressure = 4;
        const result = applyTurnPass(
            { state, profiles, present, playerName: 'Курьер' },
            turnPass({
                characters: [
                    entry('grukk', {
                        appetites: [
                            {
                                id: 'plunder',
                                cue: false,
                                idleAfterCue: false,
                                satisfied: 0,
                                full: false,
                                refusedBy: 'Мира',
                                stress: false,
                                intoxicated: false,
                            },
                        ],
                    }),
                ],
            }),
            ctx(),
        );
        // A raider escalates two steps at a time (§5.7 «Эскалация»).
        expect(result.state.characters.grukk!.ties.mira!.escalation).toEqual({ step: 5, failures: 1 });
    });
});

describe('applyTurnPass — corruption', () => {
    it('stains a coarse act against someone not disliked, per the lever', () => {
        const input = tavernInput();
        input.state.characters.bram!.ties.sota = tie('sota', 1);
        const lie = turnPass({ events: [event('bram', 'sota', 'lie', 'lied to Сота about the debt')] });
        const all = applyTurnPass(input, lie, ctx());
        expect(all.state.characters.bram!.corruption.stains).toBe(1);
        expect(all.events.some((line) => line.kind === 'corruption')).toBe(true);
        const off = applyTurnPass(input, lie, ctx({}, { corruption: 'off' }));
        expect(off.state.characters.bram!.corruption.stains).toBe(0);
    });

    it('a first betrayal of an anchor forces remorse now', () => {
        const input = tavernInput();
        const bram = input.profiles.find((profile) => profile.id === 'bram')!;
        bram.core = { ...bram.core, anchors: ['sota'] };
        input.state.characters.bram!.corruption = { level: 4, stains: 0, gifts: [], brands: [] };
        const result = applyTurnPass(
            input,
            turnPass({ events: [event('bram', 'sota', 'betray', 'sold Сота out to the garrison')] }),
            ctx({ rng: always(0) }),
        );
        const corruption = result.state.characters.bram!.corruption;
        expect(corruption.stains).toBe(0);
        expect(corruption.level).toBe(5);
        expect(corruption.brands).toContain('compulsion');
    });
});

describe('applyTurnPass — drift (§8)', () => {
    it('a DES label warmer than the stance gives a correction for the next card', () => {
        const result = applyTurnPass(
            tavernInput({ desLabels: { ilva: 'Подруга' } }),
            turnPass(),
            ctx({ cardLang: 'en' }),
        );
        const lines = result.state.next?.corrections?.ilva ?? [];
        expect(lines[0]).toContain('still hostile toward Курьер');
        expect(lines[0]).toContain('nothing has earned warmth');
        expect(result.state.characters.ilva!.ties[PLAYER_ID]!.stance).toBe(-2);
        expect(result.events.some((line) => line.kind === 'drift' && line.character === 'ilva')).toBe(true);
    });

    it('does not call earned warmth drift', () => {
        const input = tavernInput({ desLabels: { ilva: 'Friend' } });
        const kind = turnPass({
            events: [event('PLAYER', 'ilva', 'help', 'paid off her debt to the garrison')],
            characters: [
                entry('ilva', {
                    drift: {
                        warmthWithoutCause: true,
                        appetiteBecameLove: false,
                        dependenceVanished: false,
                        actedAgainstValues: false,
                    },
                }),
            ],
        });
        expect(detectDrift(input, kind)).toEqual([]);
        expect(applyTurnPass(input, kind, ctx()).state.next?.corrections).toBeUndefined();
        expect(detectDrift(input, turnPass())).toHaveLength(1);
    });

    it('stress mode builds stress and breaks in the coping style', () => {
        const input = tavernInput({ desLabels: { ilva: 'Lover' } });
        const ilva = input.profiles.find((profile) => profile.id === 'ilva')!;
        ilva.core = {
            ...ilva.core,
            wound: { ghost: 'husband hanged', lie: 'never trust them', triggers: [], coping: 'overcompensate' },
        };
        input.state.characters.ilva!.stress = 40;
        const flags = entry('ilva', {
            relevant: false,
            drift: {
                warmthWithoutCause: true,
                appetiteBecameLove: false,
                dependenceVanished: false,
                actedAgainstValues: false,
            },
        });
        const result = applyTurnPass(
            input,
            turnPass({ characters: [flags] }),
            ctx({ cardLang: 'en' }, { driftResponse: 'stress' }),
        );
        expect(result.state.characters.ilva!.stress).toBe(30);
        expect(result.state.next?.moves?.ilva).toEqual({ move: 'obstruct', target: PLAYER_ID, text: 'lashes out' });
        expect(result.notes).toContainEqual({ kind: 'break', character: 'ilva', break: 'lash-out' });
        expect(result.state.next?.corrections).toBeUndefined();
    });

    it('redo mode leaves a note for the feature and still corrects the card', () => {
        const result = applyTurnPass(
            tavernInput({ desLabels: { ilva: 'Друг' } }),
            turnPass(),
            ctx({}, { driftResponse: 'redo' }),
        );
        expect(result.notes).toContainEqual(expect.objectContaining({ kind: 'redo', character: 'ilva' }));
        expect(result.state.next?.corrections?.ilva?.length).toBeGreaterThan(0);
    });
});

describe('applyTurnPass — reputation (§11)', () => {
    function gate(): TurnInput {
        const guards: CharacterProfile = { ...emptyProfile('стража гарнизона', { id: 'guards' }), kind: 'group' };
        const hans = emptyProfile('Ганс', { id: 'hans' });
        const state = chat(
            { guards: liveState(guards, { knowsPlayer: false }), hans: liveState(hans) },
            { place: 'ворота' },
        );
        state.reputation = [{ among: '*', label: 'a stranger', stance: 0, weaknesses: [], reasons: [] }];
        return { state, profiles: [guards, hans], present: ['guards', 'hans'], playerName: 'Курьер' };
    }

    it('witnessed deeds move the reputation of the group and the place, weaknesses and rumours spread', () => {
        const result = applyTurnPass(
            gate(),
            turnPass({
                events: [
                    event('PLAYER', 'hans', 'harm', 'knocked the gate guard down', {
                        witnesses: ['стража гарнизона'],
                        intensity: 5,
                    }),
                ],
                playerDeeds: [
                    { text: 'drank the guards under the table', weakness: 'drinks', witnesses: ['guards'], place: '' },
                ],
            }),
            ctx({ uiLang: 'ru' }),
        );
        const among = (name: string) => result.state.reputation.find((item) => item.among === name);
        expect(among('стража гарнизона')).toMatchObject({ stance: -1, weaknesses: ['drinks'] });
        expect(among('ворота')).toMatchObject({ stance: -1 });
        expect(result.state.rumours).toEqual([
            expect.objectContaining({
                text: 'drank the guards under the table',
                about: PLAYER_ID,
                carriers: ['guards'],
                reached: ['стража гарнизона', 'ворота'],
                turn: 1,
            }),
        ]);
        expect(result.state.characters.guards!.knowsPlayer).toBe(true);
        expect(result.events.filter((line) => line.kind === 'reputation').length).toBeGreaterThan(0);
        expect(result.events.some((line) => line.kind === 'rumour')).toBe(true);
    });

    it('a private act moves no reputation; a repeated deed joins the old rumour', () => {
        const input = gate();
        const once = applyTurnPass(
            input,
            turnPass({
                events: [event('PLAYER', 'hans', 'insult', 'cursed the guard')],
                playerDeeds: [{ text: 'cursed the guard', weakness: '', witnesses: ['hans'], place: 'ворота' }],
            }),
            ctx(),
        );
        expect(once.state.reputation.map((item) => item.among)).toEqual(['*']);
        const twice = applyTurnPass(
            { ...input, state: once.state },
            turnPass({
                playerDeeds: [{ text: 'Cursed the guard!', weakness: '', witnesses: ['guards'], place: 'ворота' }],
            }),
            ctx(),
        );
        expect(twice.state.rumours).toHaveLength(1);
        expect(twice.state.rumours[0]!.carriers).toEqual(['hans', 'guards']);
    });
});

describe('commitTurn — scene breaks', () => {
    function inScene(): TurnInput {
        const input = tavernInput();
        input.state.place = 'трактир';
        input.state.time = '18:00';
        input.state.characters.bram!.ties[PLAYER_ID]!.reasons.push(reason('a passing slight', -0.4, 1, 'slight'));
        return input;
    }

    it('a new place ends the old scene before the reply is applied', () => {
        const result = commitTurn({ ...inScene(), mark: { place: 'конюшня', time: '18:30' } }, turnPass(), ctx());
        expect(result.sceneBreak).toBe('before');
        expect(result.state.scene).toBe(1);
        expect(result.state.place).toBe('конюшня');
        expect(result.state.time).toBe('18:30');
        expect(result.state.characters.bram!.ties[PLAYER_ID]!.reasons.some((item) => item.id === 'slight')).toBe(false);
        expect(result.state.turn).toBe(1);
        expect(result.chapterEnd).toBe(false);
    });

    it('the same scene goes on; an ended scene closes after the reply', () => {
        const same = commitTurn({ ...inScene(), mark: { place: 'Трактир', time: '18:20' } }, turnPass(), ctx());
        expect(same.sceneBreak).toBeNull();
        expect(same.state.scene).toBe(0);
        const ended = commitTurn(inScene(), turnPass({ sceneEnded: true }), ctx());
        expect(ended.sceneBreak).toBe('after');
        expect(ended.state.scene).toBe(1);
    });

    it('a long time skip or a new day ends a chapter', () => {
        const skip = commitTurn(inScene(), turnPass({ timeSkipHours: 10 }), ctx());
        expect(skip.sceneBreak).toBe('before');
        expect(skip.chapterEnd).toBe(true);
        const day = commitTurn(
            { ...inScene(), state: { ...inScene().state, date: 'Monday' }, mark: { date: 'Tuesday' } },
            null,
            ctx(),
        );
        expect(day.chapterEnd).toBe(true);
        expect(day.state.date).toBe('Tuesday');
    });
});

describe('schemeText', () => {
    it('describes the plan in plain English', () => {
        expect(schemeText(8, 'Мира')).toBe('plans to seize Мира');
        expect(schemeText(2, 'Мира')).toBe('plans to trick Мира');
    });
});

describe('applyTurnPass — schemes, gaze and rivalry in the scene', () => {
    function running(patch: Partial<ChatState['schemes'][number]> = {}): ChatState['schemes'][number] {
        return {
            id: 's1',
            owner: 'grukk',
            target: 'mira',
            appetite: 'plunder',
            method: 8,
            text: 'cut off her wagon at the ford at dusk',
            clock: { segments: 5, filled: 4 },
            secrecy: 90,
            breaches: 0,
            accomplices: [],
            state: 'running',
            startedTurn: 0,
            ...patch,
        };
    }

    it('a running scheme ticks while owner and target share the scene, and springs when ready', () => {
        const { profiles, state } = ford();
        state.schemes = [running()];
        const result = applyTurnPass(
            { state, profiles, present: ['grukk', 'mira'], playerName: 'Курьер' },
            turnPass(),
            ctx({ rng: always(0.9), uiLang: 'ru' }),
        );
        expect(result.state.schemes[0]).toMatchObject({ state: 'ready', clock: { segments: 5, filled: 5 } });
        expect(result.events.map((line) => line.text)).toContain(
            'Грукк: замысел готов — cut off her wagon at the ford at dusk',
        );
        expect(result.state.next?.appetites?.grukk?.[0]).toMatchObject({
            target: 'mira',
            method: 8,
            methodText: 'cut off her wagon at the ford at dusk',
        });
    });

    it('an exposed scheme becomes a lasting reason for its target', () => {
        const { profiles, state } = ford();
        state.schemes = [running({ secrecy: 0, breaches: 4, clock: { segments: 8, filled: 1 } })];
        const result = applyTurnPass(
            { state, profiles, present: ['grukk', 'mira'], playerName: 'Курьер' },
            turnPass(),
            ctx({ rng: always(0) }),
        );
        expect(result.state.schemes[0]!.state).toBe('exposed');
        expect(result.notes).toContainEqual({ kind: 'scheme-exposed', character: 'grukk', scheme: 's1' });
        const reasonOnMira = result.state.characters.mira!.ties.grukk!.reasons.find((item) =>
            item.text.startsWith('uncovered a scheme'),
        );
        expect(reasonOnMira).toMatchObject({ delta: -1, scenesLeft: null });
    });

    it('a saved life turns the gaze toward the person', () => {
        const { profiles, state } = ford();
        const result = applyTurnPass(
            { state, profiles, present: ['grukk', 'mira'], playerName: 'Курьер' },
            turnPass({
                events: [event('mira', 'grukk', 'save', 'pulled Грукк out of the river')],
                characters: [entry('grukk')],
            }),
            ctx({ uiLang: 'ru' }),
        );
        expect(result.state.characters.grukk!.ties.mira!.gaze).toBe('instrument');
        expect(result.events.some((line) => line.kind === 'gaze' && line.text === 'Грукк иначе смотрит на Мира')).toBe(
            true,
        );
    });

    it('two who want the same target stake claims against each other', () => {
        const { profiles, state } = ford();
        const rival: CharacterProfile = {
            ...emptyProfile('Скрат', { id: 'skrat' }),
            appetites: [appetite({ id: 'plunder', kind: 'plunder', target: { mode: 'class', class: 'lowlanders' } })],
            ties: [tie('mira', -1, { want: 4, gaze: 'property', appetite: 'plunder' }), tie('grukk', -2)],
        };
        state.characters.grukk!.ties.skrat = tie('skrat', -2);
        state.characters.skrat = liveState(rival);
        state.characters.grukk!.ties.mira = { ...state.characters.grukk!.ties.mira!, claim: 'interest' };
        const result = applyTurnPass(
            { state, profiles: [...profiles, rival], present: ['grukk', 'mira', 'skrat'], playerName: 'Курьер' },
            turnPass({ newNames: ['Ганс'] }),
            ctx({ uiLang: 'ru' }),
        );
        expect(result.state.characters.grukk!.ties.mira!.claim).toBe('claimed');
        expect(result.events.some((line) => line.kind === 'claim' && line.character === 'grukk')).toBe(true);
        expect(result.notes).toContainEqual({ kind: 'new-names', names: ['Ганс'] });
    });

    it('a stance step up toward a wanted target also softens the gaze', () => {
        const input = tavernInput();
        const sota = input.state.characters.sota!;
        sota.ties.bram = tie('bram', 0, { want: 3, gaze: 'prize' });
        const result = applyTurnPass(
            input,
            turnPass({
                events: [event('bram', 'sota', 'save', 'dragged Сота away from the brawl', { intensity: 4 })],
                characters: [entry('sota', { keyMatched: 'someone who stands up for her' })],
            }),
            ctx(),
        );
        expect(result.state.characters.sota!.ties.bram!.stance).toBe(1);
        expect(result.state.characters.sota!.ties.bram!.gaze).toBe('person');
    });
});
