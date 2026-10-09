import { describe, expect, it } from 'vitest';
import {
    CHOICE_STRAIN,
    KEY_STRAIN,
    MAX_CHOICES,
    PROPOSAL_LAPSE,
    STAGE_STRAIN,
    STRAIN_DECAY,
    applyArcStage,
    arcCardLine,
    arcGains,
    arcMoves,
    arcStepValid,
    arcsPending,
    choiceCardLine,
    effectiveStrain,
    emptyArc,
    nextStage,
    parseArcStep,
    progressArcs,
    revertArcStage,
    validSuccessor,
} from '../../src/domain/arcs';
import type { ArcStep } from '../../src/domain/arcs';
import type { CharacterProfile, ChatState, PassCharacterNote, PassSummary } from '../../src/domain/model';
import { chat, liveState, profile } from './cast-fixtures';

function ilvaProfile(patch: Partial<CharacterProfile['core']> = {}): CharacterProfile {
    const base = profile('ilva', 'Ильва', { gender: 'female', lod: 'portrait' });
    return {
        ...base,
        core: {
            ...base.core,
            wound: {
                ghost: 'the husband hanged',
                lie: 'imperials cannot be trusted in anything',
                triggers: [],
                coping: 'overcompensate',
            },
            need: 'to let someone help her',
            ...patch,
        },
    };
}

function setup(patch: Partial<CharacterProfile['core']> = {}) {
    const ilva = ilvaProfile(patch);
    const bram = profile('bram', 'Брам', { gender: 'male', lod: 'draft' });
    const profiles = [ilva, bram];
    const state = chat({ ilva: liveState(ilva), bram: liveState(bram) }, { turn: 4 });
    return { profiles, state };
}

function summary(turn: number, characters: Record<string, PassCharacterNote>, messageIndex = 9): PassSummary {
    return { turn, messageIndex, present: Object.keys(characters), characters, steps: [], drift: [] };
}

/** Runs one committed turn through the arcs. */
function turnOf(
    state: ChatState,
    profiles: CharacterProfile[],
    notes: Record<string, PassCharacterNote>,
    lang: 'en' | 'ru' = 'en',
) {
    const next = { ...state, turn: state.turn + 1 };
    next.lastPass = summary(next.turn, notes);
    return progressArcs(next, profiles, next.lastPass, { lang });
}

const key: PassCharacterNote = { key: 'protection of her daughter' };
const toNeed: PassCharacterNote = {
    choice: { text: 'let the courier carry the letters', kept: 'her daughter', gave: 'her pride', toward: 'need' },
};
const toLie: PassCharacterNote = {
    choice: { text: 'burned the courier’s pass', kept: 'her grudge', gave: 'the town’s safety', toward: 'lie' },
};

describe('arc rules', () => {
    it('counts key events, choices and the strain the code saw', () => {
        expect(arcGains(key)).toEqual({ strain: KEY_STRAIN, lean: 0, evidence: 1 });
        expect(arcGains(toNeed)).toEqual({ strain: CHOICE_STRAIN, lean: 1, evidence: 1 });
        expect(arcGains({ strain: ['temptation', 'break', 'lapse'] })).toEqual({ strain: 2, lean: -0.5, evidence: 0 });
        expect(arcGains({})).toEqual({ strain: 0, lean: 0, evidence: 0 });
    });

    it('steps in order, needs evidence to see the truth and a lean to end the arc', () => {
        const ripe = { strain: STAGE_STRAIN, lean: 0, evidence: 0 };
        expect(nextStage('intact', { ...ripe, strain: STAGE_STRAIN - 0.1 })).toBeNull();
        expect(nextStage('intact', ripe)).toBe('cracking');
        expect(nextStage('cracking', ripe)).toBeNull();
        expect(nextStage('cracking', { ...ripe, evidence: 1 })).toBe('glimpsed');
        expect(nextStage('glimpsed', ripe)).toBeNull();
        expect(nextStage('glimpsed', { ...ripe, lean: 1 })).toBe('embraced');
        expect(nextStage('glimpsed', { ...ripe, lean: -1.5 })).toBe('rejected');
        expect(nextStage('embraced', { ...ripe, lean: 3 })).toBeNull();
        expect(validSuccessor('intact', 'cracking')).toBe(true);
        expect(validSuccessor('intact', 'glimpsed')).toBe(false);
        expect(validSuccessor('glimpsed', 'rejected')).toBe(true);
        expect(validSuccessor('rejected', 'embraced')).toBe(false);
    });

    it('lets strain decay while nothing presses', () => {
        expect(effectiveStrain({ strain: 2, turn: 5 }, 5)).toBe(2);
        expect(effectiveStrain({ strain: 2, turn: 5 }, 9)).toBeCloseTo(2 - 4 * STRAIN_DECAY);
        expect(effectiveStrain({ strain: 1, turn: 0 }, 100)).toBe(0);
    });

    it('never moves locked characters, sketches or groups', () => {
        expect(arcMoves(ilvaProfile())).toBe(true);
        expect(arcMoves(ilvaProfile({ arcLock: true }))).toBe(false);
        expect(arcMoves({ ...ilvaProfile(), lod: 'sketch' })).toBe(false);
        expect(arcMoves({ ...ilvaProfile(), kind: 'group' })).toBe(false);
    });
});

describe('progressArcs', () => {
    it('cracks the lie after two key events, proposes the step once and logs nothing for plain keys', () => {
        const { profiles, state } = setup();
        const first = turnOf(state, profiles, { ilva: key });
        expect(first.steps).toEqual([]);
        expect(first.state.characters.ilva!.arc).toMatchObject({ strain: 2, evidence: 1, turn: 5 });
        const second = turnOf(first.state, profiles, { ilva: key });
        expect(second.steps).toEqual([
            {
                character: 'ilva',
                from: 'intact',
                to: 'cracking',
                turn: 6,
                reason: 'protection of her daughter',
                messageIndex: 9,
            },
        ]);
        expect(second.state.characters.ilva!.arc!.proposed).toEqual({ to: 'cracking', turn: 6 });
        expect(second.events).toEqual([]);
        // Still waiting in the Inbox: not proposed again.
        expect(turnOf(second.state, profiles, { ilva: key }).steps).toEqual([]);
    });

    it('proposes again once the proposal lapsed', () => {
        const { profiles, state } = setup();
        state.characters.ilva!.arc = { ...emptyArc(10), strain: 5, proposed: { to: 'cracking', turn: 10 } };
        state.turn = 10 + PROPOSAL_LAPSE;
        expect(turnOf(state, profiles, { ilva: key }).steps).toHaveLength(1);
    });

    it('processes a committed turn once', () => {
        const { profiles, state } = setup();
        const first = turnOf(state, profiles, { ilva: toNeed });
        const again = progressArcs(first.state, profiles, first.state.lastPass!, { lang: 'en' });
        expect(again.changed).toEqual([]);
        expect(again.state.characters.ilva!.arc!.choices).toHaveLength(1);
        expect(arcsPending(first.state, profiles, first.state.lastPass)).toBe(false);
    });

    it('keeps revealed choices as permanent memories with a log line in story words', () => {
        const { profiles, state } = setup();
        const result = turnOf(state, profiles, { ilva: toNeed }, 'ru');
        const arc = result.state.characters.ilva!.arc!;
        expect(arc.choices).toEqual([{ ...toNeed.choice, turn: 5, messageIndex: 9 }]);
        expect(arc.lean).toBe(1);
        expect(result.events).toEqual([
            {
                turn: 5,
                kind: 'arc',
                character: 'ilva',
                messageIndex: 9,
                text: 'Ильва выбрала «her daughter», а не «her pride»: let the courier carry the letters',
            },
        ]);
        expect(result.state.log.at(-1)?.text).toContain('выбрала');
        const plain = turnOf(state, profiles, { ilva: { choice: { ...toNeed.choice!, kept: '' } } }, 'en');
        expect(plain.events[0]!.text).toBe('Ильва made a hard choice: let the courier carry the letters');
    });

    it('keeps at most MAX_CHOICES memories', () => {
        const { profiles, state } = setup();
        let current = state;
        for (let i = 0; i < MAX_CHOICES + 2; i++) current = turnOf(current, profiles, { ilva: toNeed }).state;
        expect(current.characters.ilva!.arc!.choices).toHaveLength(MAX_CHOICES);
    });

    it('records the choices of a locked villain but never moves the arc', () => {
        const { profiles, state } = setup({ arcLock: true });
        const result = turnOf(state, profiles, { ilva: { ...key, ...toLie } });
        const arc = result.state.characters.ilva!.arc!;
        expect(arc.choices).toHaveLength(1);
        expect(arc.strain).toBe(0);
        expect(result.steps).toEqual([]);
        // Strain alone is nothing for a locked character: no write.
        expect(arcsPending({ ...state, turn: 5 }, profiles, summary(5, { ilva: key }))).toBe(false);
    });

    it('ignores groups, unknown ids and characters without a live state', () => {
        const { profiles, state } = setup();
        const guards = { ...profile('guards', 'стража', { lod: 'portrait' }), kind: 'group' as const };
        const result = turnOf(state, [...profiles, guards], { guards: key, ghost: key, bram: {} });
        expect(result.changed).toEqual([]);
    });

    it('decays strain between pressed turns', () => {
        const { profiles, state } = setup();
        const first = turnOf(state, profiles, { ilva: key });
        const later = { ...first.state, turn: first.state.turn + 10 };
        const second = turnOf(later, profiles, { ilva: { strain: ['temptation'] } });
        expect(second.state.characters.ilva!.arc!.strain).toBeCloseTo(2 - 10 * STRAIN_DECAY + 0.5);
    });

    it('ends embraced or rejected by where the choices leaned', () => {
        const { profiles, state } = setup();
        state.characters.ilva!.arcStage = 'glimpsed';
        state.characters.ilva!.arc = { ...emptyArc(state.turn), strain: 2, lean: 0 };
        const toward = turnOf(state, profiles, { ilva: toNeed });
        expect(toward.steps[0]).toMatchObject({ from: 'glimpsed', to: 'embraced' });
        const away = turnOf(state, profiles, { ilva: toLie });
        expect(away.steps[0]).toMatchObject({ from: 'glimpsed', to: 'rejected', reason: 'burned the courier’s pass' });
    });

    it('says only «under strain» when nothing named pressed', () => {
        const { profiles, state } = setup();
        state.characters.ilva!.arc = { ...emptyArc(state.turn), strain: 2.5 };
        const result = turnOf(state, profiles, { ilva: { strain: ['break'] } }, 'ru');
        expect(result.steps[0]).toMatchObject({ to: 'cracking', reason: 'под давлением' });
    });
});

describe('applying a stage step', () => {
    const step: ArcStep = {
        character: 'ilva',
        from: 'intact',
        to: 'cracking',
        turn: 6,
        reason: 'a key',
        messageIndex: 9,
    };

    it('moves the stage, starts the strain over and logs it', () => {
        const { profiles, state } = setup();
        state.characters.ilva!.arc = {
            ...emptyArc(6),
            strain: 4,
            lean: 1,
            evidence: 2,
            proposed: { to: 'cracking', turn: 6 },
        };
        const result = applyArcStage(state, step, { lang: 'ru', profiles });
        expect(result.applied).toBe(true);
        const live = result.state.characters.ilva!;
        expect(live.arcStage).toBe('cracking');
        expect(live.arc).toMatchObject({ strain: 0, evidence: 0, lean: 1 });
        expect(live.arc!.proposed).toBeUndefined();
        expect(result.events[0]!.text).toBe('Ильва: дуга сдвинулась — ложь цела → трещина (a key)');
        expect(arcStepValid(result.state, step)).toBe(false);
        expect(applyArcStage(result.state, step, { lang: 'en' }).applied).toBe(false);
    });

    it('starts an arc record when there was none and undoes the step', () => {
        const { state } = setup();
        const result = applyArcStage(state, step, { lang: 'en' });
        expect(result.state.characters.ilva!.arc).toMatchObject({ strain: 0, choices: [] });
        expect(result.events[0]!.text).toBe('ilva: the arc moves — the lie holds → cracking (a key)');
        const undone = revertArcStage(result.state, 'ilva', 'intact', 'cracking');
        expect(undone.reverted).toBe(true);
        expect(undone.state.characters.ilva!.arcStage).toBe('intact');
        expect(revertArcStage(undone.state, 'ilva', 'intact', 'cracking').reverted).toBe(false);
        expect(revertArcStage(state, 'nobody', 'intact', 'cracking').reverted).toBe(false);
    });

    it('parses Inbox payloads', () => {
        expect(parseArcStep({ ...step, chatId: 'c' })).toEqual(step);
        expect(parseArcStep({ character: 'ilva', from: 'intact', to: 'embraced' })).toBeNull();
        expect(parseArcStep({ character: '', from: 'intact', to: 'cracking' })).toBeNull();
        expect(parseArcStep({ character: 'ilva', from: 'x', to: 'cracking' })).toBeNull();
        expect(parseArcStep(null)).toBeNull();
        expect(parseArcStep({ character: 'ilva', from: 'glimpsed', to: 'rejected' })).toEqual({
            character: 'ilva',
            from: 'glimpsed',
            to: 'rejected',
            turn: 0,
            reason: '',
        });
    });
});

describe('the arc in the motive card', () => {
    it('shows nothing while the lie holds, then the stage in story words', () => {
        const ilva = ilvaProfile();
        expect(arcCardLine(ilva, { arcStage: 'intact' }, 'en')).toBe('');
        expect(arcCardLine(ilva, undefined, 'en')).toBe('');
        expect(arcCardLine(ilva, { arcStage: 'cracking' }, 'en')).toBe(
            'the old belief ("imperials cannot be trusted in anything") is cracking — doubts show under pressure',
        );
        expect(arcCardLine(ilva, { arcStage: 'glimpsed' }, 'ru')).toBe(
            'увидела, что «imperials cannot be trusted in anything» — неправда; разрывается между старым и новым',
        );
        expect(arcCardLine(ilva, { arcStage: 'embraced' }, 'en')).toContain('(to let someone help her)');
        expect(arcCardLine({ ...ilva, gender: 'male' }, { arcStage: 'rejected' }, 'ru')).toBe(
            'держится за «imperials cannot be trusted in anything» крепче прежнего — правду отверг',
        );
        const plain = { ...ilva, core: { ...ilva.core, wound: undefined, need: undefined } };
        expect(arcCardLine(plain, { arcStage: 'rejected' }, 'en')).toBe(
            'clings to the old belief harder than ever — has turned away from the truth',
        );
        expect(arcCardLine(plain, { arcStage: 'cracking' }, 'ru')).toBe(
            'старая вера дала трещину — под давлением проступают сомнения',
        );
        expect(arcCardLine(plain, { arcStage: 'glimpsed' }, 'en')).toContain('the old belief lies');
        expect(arcCardLine(plain, { arcStage: 'embraced' }, 'ru')).toBe(
            'отпустила старую веру — теперь действует из того, что нужно на деле',
        );
    });

    it('shows the latest choice', () => {
        expect(choiceCardLine(undefined, 'en')).toBe('');
        const arc = {
            ...emptyArc(),
            choices: [
                { ...toLie.choice!, turn: 1 },
                { ...toNeed.choice!, turn: 2 },
            ],
        };
        expect(choiceCardLine({ arc }, 'en')).toBe('her daughter over her pride — let the courier carry the letters');
        expect(choiceCardLine({ arc }, 'ru')).toBe(
            '«her daughter», а не «her pride» — let the courier carry the letters',
        );
        const plain = { ...emptyArc(), choices: [{ ...toNeed.choice!, gave: '', turn: 2 }] };
        expect(choiceCardLine({ arc: plain }, 'en')).toBe('let the courier carry the letters');
    });
});
