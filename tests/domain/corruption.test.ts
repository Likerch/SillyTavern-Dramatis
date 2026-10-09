import { describe, expect, it } from 'vitest';
import {
    BRANDS,
    GIFTS,
    addStain,
    applyRemorse,
    coarseProfile,
    corruptionApplies,
    crossThreshold,
    crossedThresholds,
    rawStains,
    recover,
    remorse,
    remorseDice,
    stainMultiplier,
    unlocked,
} from '../../src/domain/corruption';
import type { CorruptionState, RemorseContext } from '../../src/domain/corruption';
import { always, seeded } from './appetites-fixtures';

function state(fields: Partial<CorruptionState> = {}): CorruptionState {
    return { level: 0, stains: 0, gifts: [], brands: [], ...fields };
}

const alone: RemorseContext = { anchorPresent: false, justificationsActive: false, cultureEndorses: false };
const success = always(0.9); // d10 = 10
const failure = always(0); // d10 = 1

describe('thresholds', () => {
    it('unlocks behaviour ids at 3/5/7/10', () => {
        expect(unlocked(2)).toEqual([]);
        expect(unlocked(5)).toEqual(['euphemisms', 'gaze-shift']);
        expect(unlocked(10)).toEqual(['euphemisms', 'gaze-shift', 'identity', 'lost']);
    });

    it('reports thresholds crossed upward only', () => {
        expect(crossedThresholds(2, 5)).toEqual([3, 5]);
        expect(crossedThresholds(5, 6)).toEqual([]);
        expect(crossedThresholds(7, 3)).toEqual([]);
    });
});

describe('the lever', () => {
    it('tracks nobody, the coarse and the vowed, or everyone', () => {
        expect(corruptionApplies('off', { coarse: true, vow: true })).toBe(false);
        expect(corruptionApplies('coarse', { coarse: false, vow: false })).toBe(false);
        expect(corruptionApplies('coarse', { coarse: false, vow: true })).toBe(true);
        expect(corruptionApplies('coarse', { coarse: true, vow: false })).toBe(true);
        expect(corruptionApplies('all', { coarse: false, vow: false })).toBe(true);
    });

    it('reads coarse styles and vows off the appetites', () => {
        expect(coarseProfile([{ style: 'raider', vow: 'none' }])).toEqual({ coarse: true, vow: false });
        expect(coarseProfile([{ style: 'siren', vow: 'moderate' }])).toEqual({ coarse: false, vow: true });
        expect(coarseProfile([], true)).toEqual({ coarse: true, vow: false });
    });
});

describe('stains', () => {
    it('diminishes with the level: full, half, quarter', () => {
        expect(stainMultiplier(2)).toBe(1);
        expect(stainMultiplier(3)).toBe(0.5);
        expect(stainMultiplier(6)).toBe(0.5);
        expect(stainMultiplier(7)).toBe(0.25);
    });

    it('stains coarse acts against a person or someone not disliked', () => {
        expect(rawStains({ step: 5, gaze: 'person', stance: -2 })).toEqual({ base: 1, catalyst: 0 });
        expect(rawStains({ step: 7, gaze: 'prey', stance: 0 })).toEqual({ base: 2, catalyst: 0 });
        expect(rawStains({ step: 8, gaze: 'prey', stance: -2 })).toEqual({ base: 0, catalyst: 0 });
        expect(rawStains({ step: 4, gaze: 'person', stance: 2 })).toEqual({ base: 0, catalyst: 0 });
        expect(rawStains({})).toEqual({ base: 0, catalyst: 0 });
    });

    it('stains broken vows by weight and catalysts by 2', () => {
        expect(rawStains({ brokeVow: 'moderate' }).base).toBe(1);
        expect(rawStains({ brokeVow: 'abstinent' }).base).toBe(2);
        expect(rawStains({ brokeVow: 'red-line' }).base).toBe(3);
        expect(rawStains({ catalyst: true })).toEqual({ base: 0, catalyst: 2 });
    });

    it('adds diminished stains, keeps the catalyst whole and asks for a check', () => {
        const r = addStain(state({ level: 4 }), { step: 7, stance: 1, catalyst: true }, { lever: 'all' });
        expect(r.added).toBe(3);
        expect(r.state.stains).toBe(3);
        expect(r.check).toBe(true);
        const later = addStain(state({ level: 8, stains: 1 }), { step: 5, gaze: 'person' }, { lever: 'all' });
        expect(later).toMatchObject({ added: 0.25, check: false });
        expect(later.state.stains).toBe(1.25);
    });

    it('does nothing when the lever does not track the character or the act is clean', () => {
        const s = state();
        expect(addStain(s, { step: 8, stance: 2 }, { lever: 'off' }).state).toBe(s);
        expect(addStain(s, { step: 8, stance: 2 }, { lever: 'coarse' }).added).toBe(0);
        expect(addStain(s, { step: 8, stance: 2 }, { lever: 'coarse', coarse: true }).added).toBe(2);
        expect(addStain(s, { step: 2 }, { lever: 'all' }).state).toBe(s);
    });
});

describe('remorse', () => {
    it('has nothing to roll without stains', () => {
        expect(remorse(4, 0, alone, failure)).toMatchObject({
            level: 4,
            success: true,
            rolled: false,
            reason: 'clean',
        });
    });

    it('counts dice: 10 − level − stains, ± anchor, justifications, culture, bonus; at least 1', () => {
        expect(remorseDice(2, 1, alone)).toBe(7);
        expect(remorseDice(2, 1.75, alone)).toBe(7);
        expect(remorseDice(2, 1, { ...alone, anchorPresent: true, bonusDice: 2 })).toBe(10);
        expect(remorseDice(2, 1, { ...alone, justificationsActive: true, cultureEndorses: true })).toBe(5);
        expect(remorseDice(2, 1, { ...alone, justificationsActive: 3 })).toBe(4);
        expect(remorseDice(9, 5, { ...alone, justificationsActive: 4 })).toBe(1);
    });

    it('clears stains on success and costs a level on failure', () => {
        expect(remorse(3, 2, alone, success)).toMatchObject({
            level: 3,
            stains: 0,
            success: true,
            rolled: true,
            dice: 5,
        });
        expect(remorse(3, 2, alone, failure)).toMatchObject({ level: 4, stains: 0, success: false, rolled: true });
        expect(remorse(9, 1, { ...alone, anchorPresent: true }, failure).level).toBe(10);
    });

    it('allows remorse at 7+ only with an anchor and none when lost', () => {
        expect(remorse(7, 1, alone, success)).toMatchObject({ level: 8, rolled: false, reason: 'no-anchor' });
        expect(remorse(7, 1, { ...alone, anchorPresent: true }, success)).toMatchObject({ level: 7, success: true });
        expect(remorse(10, 2, { ...alone, anchorPresent: true }, success)).toMatchObject({
            level: 10,
            stains: 0,
            reason: 'lost',
        });
    });

    it('succeeds more often with more dice (seeded)', () => {
        const rng = seeded(5);
        let few = 0;
        let many = 0;
        for (let i = 0; i < 500; i++) {
            if (remorse(6, 3, alone, rng).success) few++;
            if (remorse(1, 1, alone, rng).success) many++;
        }
        // One die succeeds half the time; eight dice almost always.
        expect(few / 500).toBeGreaterThan(0.4);
        expect(few / 500).toBeLessThan(0.6);
        expect(many / 500).toBeGreaterThan(0.98);
    });

    it('spends refused-gift dice from the stored state', () => {
        const { state: next, result } = applyRemorse(state({ level: 2, stains: 1, bonusDice: 2 }), alone, success);
        expect(result.dice).toBe(9);
        expect(next).toEqual({ level: 2, stains: 0, gifts: [], brands: [] });
        const clean = applyRemorse(state({ bonusDice: 1 }), alone, success).state;
        expect(clean.bonusDice).toBe(1);
    });
});

describe('gifts, brands and recovery', () => {
    it('always brands; a refused gift earns a remorse die', () => {
        const taken = crossThreshold(state(), 5, true);
        expect(taken).toMatchObject({ gifts: [GIFTS[5]], brands: [BRANDS[5]] });
        const refused = crossThreshold(state({ brands: [BRANDS[3]] }), 3, false);
        expect(refused).toMatchObject({ gifts: [], brands: ['mark'], bonusDice: 1 });
        expect(crossThreshold(taken, 5, true)).toMatchObject({ gifts: ['pack-standing'], brands: ['compulsion'] });
    });

    it('recovers −1 per clean chapter with two supports', () => {
        expect(recover(state({ level: 4 }), { abstinence: true, anchor: true }).level).toBe(3);
        expect(recover(state({ level: 4 }), { abstinence: true }).level).toBe(4);
        expect(recover(state({ level: 4, stains: 1 }), { abstinence: true, anchor: true }).level).toBe(4);
        expect(recover(state({ level: 0 }), { abstinence: true, anchor: true }).level).toBe(0);
    });

    it('needs a world event to come back from «lost»', () => {
        expect(recover(state({ level: 10 }), { abstinence: true, anchor: true, restitution: true }).level).toBe(10);
        expect(recover(state({ level: 10 }), { worldEvent: true }).level).toBe(9);
    });
});
