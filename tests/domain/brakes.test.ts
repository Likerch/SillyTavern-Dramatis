import { describe, expect, it } from 'vitest';
import {
    GAZE_CAP,
    brakeTotal,
    ceiling,
    ceilingDetail,
    feedsCruelty,
    forbiddenSteps,
    heat,
    structuralCap,
    valuesConflict,
} from '../../src/domain/brakes';
import type { RestraintInput } from '../../src/domain/brakes';
import { core } from './appetites-fixtures';

const plain = { kind: 'drink', endorsement: 'torn', vow: 'none', visibility: 'open', style: 'buyer' } as const;

function restraint(fields: Partial<RestraintInput> = {}): RestraintInput {
    return {
        core: core(),
        appetite: plain,
        pressure: 3,
        selfControl: 0,
        stance: 0,
        fear: 0,
        guardians: 0,
        ...fields,
    };
}

describe('heat and red lines', () => {
    it('adds withdrawal to pressure', () => {
        expect(heat({ pressure: 4, withdrawal: true })).toBe(5);
        expect(heat({ pressure: 2 })).toBe(2);
    });

    it('reads method ids from redLines.never and explicit steps, ignoring prose and low steps', () => {
        const c = core({ redLines: { never: ['Force', 'никогда не лжёт', 'deceive', 'wait'], would: [] } });
        expect(forbiddenSteps({ core: c })).toEqual([5, 8]);
        expect(forbiddenSteps({ core: core(), forbiddenSteps: [7, 1] })).toEqual([7]);
    });
});

describe('valuesConflict', () => {
    it('costs nothing below court', () => {
        expect(valuesConflict(core({ values: { top: ['benevolence'] } }), { ...plain, vow: 'abstinent' }, 2)).toBe(0);
    });

    it('weights the first value double and matches values to coercion levels', () => {
        const c = core({ values: { top: ['benevolence', 'universalism', 'tradition'] } });
        expect(valuesConflict(c, plain, 4)).toBe(0);
        expect(valuesConflict(c, plain, 5)).toBe(2);
        expect(valuesConflict(c, plain, 6)).toBe(3);
        expect(valuesConflict(c, plain, 7)).toBe(4);
        expect(valuesConflict(core({ values: { top: ['power', 'conformity'] } }), plain, 7)).toBe(1);
    });

    it('adds opposed traits: honesty against deceit, agreeableness against coercion, empathy against impairing', () => {
        const c = core({ temperament: { honesty: 2, agreeableness: 1, emotionality: 2 } });
        expect(valuesConflict(c, plain, 5)).toBe(2);
        expect(valuesConflict(c, plain, 6)).toBe(3);
        expect(valuesConflict(c, plain, 7)).toBe(4);
        expect(valuesConflict(core({ temperament: { honesty: -2 } }), plain, 5)).toBe(0);
    });

    it('counts vows, endorsement, the honest style and red lines the character «would» cross', () => {
        expect(valuesConflict(core(), { ...plain, vow: 'abstinent' }, 3)).toBe(2);
        expect(valuesConflict(core(), { ...plain, endorsement: 'fighting' }, 3)).toBe(1);
        expect(valuesConflict(core({ temperament: { honesty: 1 } }), { ...plain, endorsement: 'proud' }, 5)).toBe(0);
        expect(valuesConflict(core(), { ...plain, style: 'honest' }, 4)).toBe(1);
        expect(valuesConflict(core(), { ...plain, style: 'honest' }, 3)).toBe(0);
        const would = core({ temperament: { honesty: 2 }, redLines: { never: [], would: ['deceive'] } });
        expect(valuesConflict(would, plain, 5)).toBe(1);
    });
});

describe('brakeTotal', () => {
    it('always allows steps 0–2', () => {
        const b = brakeTotal({ ...restraint({ pressure: 0, selfControl: 3 }), step: 2 });
        expect(b.allowed).toBe(true);
        expect(b.total).toBe(0);
    });

    it('needs some push for consensual steps', () => {
        expect(brakeTotal({ ...restraint({ pressure: 0 }), step: 3 }).allowed).toBe(false);
        expect(brakeTotal({ ...restraint({ pressure: 1 }), step: 3 }).allowed).toBe(true);
    });

    it('applies fear, guardians, regard and self-control only to coarse steps', () => {
        const r = restraint({ fear: 2, guardians: 1, witnesses: 1, stance: 2, selfControl: 2, pressure: 3 });
        const court = brakeTotal({ ...r, step: 4 });
        expect(court).toMatchObject({ fear: 0, guardian: 0, regard: 0, selfControl: 0, total: 0, allowed: true });
        const deceit = brakeTotal({ ...r, step: 5 });
        expect(deceit).toMatchObject({ fear: 2, guardian: 2, regard: 2, selfControl: 2, total: 8, allowed: false });
        expect(brakeTotal({ ...r, step: 7 }).regard).toBe(3);
    });

    it('lets hidden appetites fear witnesses even when consensual', () => {
        const r = restraint({ appetite: { ...plain, visibility: 'secret' }, witnesses: 2 });
        expect(brakeTotal({ ...r, step: 3 }).guardian).toBe(2);
        expect(brakeTotal({ ...restraint({ witnesses: 2 }), step: 3 }).guardian).toBe(0);
    });

    it('turns indulging onlookers into a push (Hofmann)', () => {
        const b = brakeTotal({ ...restraint({ witnesses: 3, witnessesIndulge: true }), step: 5 });
        expect(b.guardian).toBe(-1);
    });

    it('counts the group norm both ways', () => {
        expect(brakeTotal({ ...restraint({ groupNorm: 'forbid' }), step: 3 }).group).toBe(2);
        expect(brakeTotal({ ...restraint({ groupNorm: 'endorse' }), step: 8 }).group).toBe(-2);
        expect(brakeTotal({ ...restraint({ groupNorm: 'forbid' }), step: 2 }).group).toBe(0);
    });

    it('lets corruption erode regard', () => {
        expect(brakeTotal({ ...restraint({ stance: 2, corruption: 5 }), step: 6 }).regard).toBe(1);
    });

    it('restrains the abstinent from the first indulgence', () => {
        const r = restraint({ appetite: { ...plain, vow: 'abstinent' }, selfControl: 2, pressure: 2 });
        const b = brakeTotal({ ...r, step: 3 });
        expect(b).toMatchObject({ values: 2, selfControl: 2, allowed: false });
    });

    it('lowers values by each active justification', () => {
        const c = core({ values: { top: ['benevolence'] }, temperament: { honesty: 1 } });
        expect(
            brakeTotal({ ...restraint({ core: c, justifications: ['blame', 'dehumanization'] }), step: 5 }).values,
        ).toBe(1);
        expect(brakeTotal({ ...restraint({ core: c, justifications: 3 }), step: 5 }).values).toBe(0);
    });

    it('applies dark traits: ruthless toward the out-group, entitled everywhere', () => {
        const c = core({ values: { top: ['benevolence'] }, dark: { ruthless: true } });
        expect(brakeTotal({ ...restraint({ core: c, outGroup: true }), step: 6 }).values).toBe(0);
        expect(brakeTotal({ ...restraint({ core: c }), step: 6 }).values).toBe(2);
        const entitled = core({ values: { top: ['benevolence'] }, dark: { entitled: true } });
        expect(brakeTotal({ ...restraint({ core: entitled }), step: 6 }).values).toBe(1);
    });

    it('erodes values and fear with heat; at obsessed self-control stops working', () => {
        const c = core({ values: { top: ['benevolence'] } });
        const r = restraint({ core: c, fear: 2, selfControl: 2 });
        expect(brakeTotal({ ...r, pressure: 4, step: 5 })).toMatchObject({ values: 1, fear: 1, selfControl: 2 });
        expect(brakeTotal({ ...r, pressure: 5, step: 5 })).toMatchObject({ values: 0, fear: 0, selfControl: 0 });
        expect(brakeTotal({ ...r, pressure: 4, withdrawal: true, step: 5 })).toMatchObject({
            values: 0,
            selfControl: 0,
        });
    });

    it('keeps a schemer afraid longer', () => {
        const c = core({ dark: { schemer: true } });
        expect(brakeTotal({ ...restraint({ core: c, fear: 2, pressure: 4 }), step: 5 }).fear).toBe(2);
        expect(brakeTotal({ ...restraint({ core: c, fear: 2, pressure: 5 }), step: 5 }).fear).toBe(1);
    });

    it('weakens every brake when intoxicated', () => {
        const c = core({ values: { top: ['benevolence'] } });
        const r = restraint({
            core: c,
            fear: 1,
            guardians: 1,
            stance: 1,
            selfControl: 1,
            intoxicated: true,
            pressure: 2,
        });
        expect(brakeTotal({ ...r, step: 5 })).toMatchObject({
            values: 1,
            fear: 0,
            guardian: 0,
            regard: 0,
            selfControl: 0,
        });
    });

    it('holds hard brakes at any pressure', () => {
        const red = restraint({ core: core({ redLines: { never: ['force'], would: [] } }), pressure: 5 });
        expect(brakeTotal({ ...red, step: 8 })).toMatchObject({ hard: true, allowed: false });
        expect(brakeTotal({ ...red, step: 7 }).hard).toBe(false);
        expect(brakeTotal({ ...restraint({ mortalFear: true, pressure: 5 }), step: 5 }).hard).toBe(true);
        expect(brakeTotal({ ...restraint({ mortalFear: true, pressure: 5 }), step: 4 }).hard).toBe(false);
        expect(brakeTotal({ ...restraint({ guardians: 3, pressure: 5 }), step: 6 }).allowed).toBe(false);
    });
});

describe('structuralCap', () => {
    it('follows the stance × gaze table', () => {
        expect(structuralCap(restraint({ stance: 2, gaze: 'person' }))).toBe(4);
        expect(structuralCap(restraint({ stance: 1, gaze: 'mate' }))).toBe(5);
        expect(structuralCap(restraint({ stance: 1, gaze: 'prey' }))).toBe(5);
        expect(structuralCap(restraint({ stance: 0, gaze: 'instrument' }))).toBe(6);
        expect(structuralCap(restraint({ stance: 0, gaze: 'prey' }))).toBe(6);
        expect(structuralCap(restraint({ stance: 0, gaze: 'prize' }))).toBe(5);
        expect(structuralCap(restraint({ stance: -1, gaze: 'person' }))).toBe(5);
        expect(structuralCap(restraint({ stance: -2, gaze: 'property' }))).toBe(7);
        expect(structuralCap(restraint({ stance: -2, gaze: 'property', groupNorm: 'endorse' }))).toBe(8);
        expect(structuralCap(restraint({ stance: -3, gaze: 'prey' }))).toBe(8);
        expect(GAZE_CAP.person).toBe(4);
    });

    it('caps things only by the ladder, the culture and the red lines', () => {
        expect(structuralCap(restraint())).toBe(8);
        expect(structuralCap(restraint({ groupNorm: 'forbid' }))).toBe(7);
        expect(structuralCap(restraint({ forbiddenSteps: [6] }))).toBe(5);
    });

    it('adds a step for ruthless out-group targets and for corruption 5+', () => {
        const ruthless = core({ dark: { ruthless: true } });
        expect(structuralCap(restraint({ core: ruthless, outGroup: true, gaze: 'instrument', stance: -1 }))).toBe(7);
        expect(structuralCap(restraint({ stance: 1, gaze: 'person', corruption: 5 }))).toBe(5);
    });

    it('keeps the honest at court, never below waiting', () => {
        expect(structuralCap(restraint({ appetite: { ...plain, style: 'honest' }, gaze: 'prey', stance: -3 }))).toBe(3);
        expect(structuralCap(restraint({ forbiddenSteps: [3] }))).toBe(2);
    });
});

describe('ceiling: the worked examples of §5.7', () => {
    const seraphina = restraint({
        core: core({ values: { top: ['tradition', 'hedonism'] } }),
        appetite: { kind: 'flesh', endorsement: 'proud', vow: 'none', visibility: 'open', style: 'siren' },
        stance: 1,
        gaze: 'mate',
        pressure: 3,
        selfControl: 2,
        fear: 1,
    });

    it('a courting lamia stops at trade while preoccupied and reaches deceit when driven', () => {
        const detail = ceilingDetail(seraphina);
        expect(detail.step).toBe(4);
        expect(detail.cap).toBe(5);
        expect(detail.blocked?.step).toBe(5);
        expect(ceiling({ ...seraphina, pressure: 4 })).toBe(5);
    });

    it('a goblin raider with an endorsing tribe goes up to force', () => {
        const grukk = restraint({
            core: core({ values: { top: ['power'] }, temperament: { honesty: -1 }, dark: { ruthless: true } }),
            appetite: { kind: 'plunder', endorsement: 'proud', vow: 'none', visibility: 'open', style: 'raider' },
            stance: -2,
            gaze: 'property',
            outGroup: true,
            groupNorm: 'endorse',
            pressure: 4,
            selfControl: 1,
            fear: 2,
        });
        expect(ceilingDetail(grukk)).toEqual({ step: 8, cap: 8 });
    });

    it('an abstinent drinker holds at «present» and breaks in a binge', () => {
        const yan = restraint({
            core: core({ values: { top: ['security', 'benevolence'] } }),
            appetite: {
                kind: 'drink',
                endorsement: 'fighting',
                vow: 'abstinent',
                visibility: 'hidden',
                style: 'buyer',
            },
            pressure: 2,
            selfControl: 2,
            fear: 2,
        });
        expect(ceiling(yan)).toBe(2);
        expect(ceiling({ ...yan, pressure: 5 })).toBeGreaterThanOrEqual(4);
    });
});

describe('feedsCruelty', () => {
    it('treats a sadist’s harsh act as feeding cruelty, not as a missing brake', () => {
        expect(feedsCruelty({ dark: { sadist: true } }, 6)).toBe(true);
        expect(feedsCruelty({ dark: { sadist: true } }, 5)).toBe(false);
        expect(feedsCruelty({}, 8)).toBe(false);
    });
});
