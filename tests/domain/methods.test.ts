import { describe, expect, it } from 'vitest';
import {
    METHODS,
    abstainStress,
    chooseMethod,
    escalate,
    isPatient,
    methodId,
    opportunity,
    stepOdds,
    stepOf,
} from '../../src/domain/methods';
import type { MethodInput, OpportunityInput } from '../../src/domain/methods';
import { always, seeded } from './appetites-fixtures';

const keepStyle = always(0);
const ignoreStyle = always(0.99);

function input(fields: Partial<MethodInput> = {}): MethodInput {
    return { pressure: 3, ceiling: 8, style: 'buyer', opportunity: 0.5, ...fields };
}

describe('ladder ids', () => {
    it('names the nine steps', () => {
        expect(METHODS).toHaveLength(9);
        expect(methodId(0)).toBe('abstain');
        expect(methodId(5)).toBe('deceive');
        expect(methodId(8)).toBe('force');
        expect(methodId(12)).toBe('force');
        expect(methodId(-1)).toBe('abstain');
        expect(stepOf(' Force ')).toBe(8);
        expect(stepOf('trade')).toBe(4);
        expect(stepOf('никогда')).toBeUndefined();
    });

    it('reads patience from schemers and conscientious characters', () => {
        expect(isPatient({ dark: { schemer: true }, temperament: {} })).toBe(true);
        expect(isPatient({ temperament: { conscientiousness: 1 } })).toBe(true);
        expect(isPatient({ temperament: { conscientiousness: -1 } })).toBe(false);
    });

    it('charges stress for abstaining while preoccupied', () => {
        expect(abstainStress(3)).toBe(1);
        expect(abstainStress(2)).toBe(0);
    });
});

describe('opportunity', () => {
    const ideal: OpportunityInput = {
        value: 5,
        inertia: 0,
        visible: true,
        access: 1,
        guardians: 0,
        capability: 3,
        escape: true,
    };

    it('is high for a helpless, visible, reachable, unguarded target with a way out', () => {
        expect(opportunity(ideal)).toBeCloseTo(0.95, 2);
    });

    it('drops with guardians, inertia, invisibility, no access and no escape', () => {
        const base = opportunity(ideal);
        expect(opportunity({ ...ideal, guardians: 2 })).toBeLessThan(base);
        expect(opportunity({ ...ideal, inertia: 3, capability: 0 })).toBeLessThan(0.1);
        expect(opportunity({ ...ideal, visible: false })).toBeCloseTo(base * 0.3, 5);
        expect(opportunity({ ...ideal, access: 0 })).toBe(0);
        expect(opportunity({ ...ideal, escape: false })).toBeCloseTo(base * 0.5, 5);
        expect(opportunity({ ...ideal, escape: 0.2, visible: 0.5 })).toBeCloseTo(base * 0.1, 5);
    });

    it('lets accomplices tip the balance of power', () => {
        const weak = { ...ideal, capability: 0, inertia: 2 };
        expect(opportunity({ ...weak, accomplices: 4 })).toBeGreaterThan(opportunity(weak));
    });

    it('stays within 0–1 on garbage', () => {
        const value = opportunity({ ...ideal, value: 99, access: 7, guardians: -5 });
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
    });
});

describe('stepOdds', () => {
    it('lets steps 0–2 always work and derives the rest', () => {
        expect(stepOdds(0, { opportunity: 0 })).toBe(1);
        expect(stepOdds(2, { opportunity: 0 })).toBe(1);
        expect(stepOdds(3, { opportunity: 0 })).toBe(0.5);
        expect(stepOdds(3, { opportunity: 0, receptive: 0.9 })).toBe(0.9);
        expect(stepOdds(4, { opportunity: 0 })).toBeCloseTo(0.55, 5);
        expect(stepOdds(4, { opportunity: 0, means: 1, receptive: 1 })).toBeCloseTo(0.9, 5);
        expect(stepOdds(5, { opportunity: 1 })).toBeCloseTo(0.9, 5);
        expect(stepOdds(6, { opportunity: 0.5 })).toBeCloseTo(0.5, 5);
        expect(stepOdds(7, { opportunity: 0.5 })).toBeCloseTo(0.45, 5);
        expect(stepOdds(7, { opportunity: 0.5, leverage: true })).toBeCloseTo(0.65, 5);
        expect(stepOdds(8, { opportunity: 0.4 })).toBe(0.4);
    });

    it('honours known odds', () => {
        expect(stepOdds(3, { opportunity: 1, odds: { 3: 0.1 } })).toBe(0.1);
        expect(stepOdds(8, { opportunity: 0, odds: { 8: 3 } })).toBe(1);
    });
});

describe('escalate', () => {
    it('raises the next attempt by one step after a refusal while preoccupied', () => {
        expect(escalate(undefined, 3, 'refused', 3)).toEqual({ step: 4, failures: 1 });
        expect(escalate({ step: 4, failures: 1 }, 4, 'failed', 4)).toEqual({ step: 5, failures: 2 });
    });

    it('lets raiders jump two steps and caps at 8', () => {
        expect(escalate(undefined, 5, 'failed', 4, 'raider')).toEqual({ step: 7, failures: 1 });
        expect(escalate(undefined, 8, 'failed', 5)).toEqual({ step: 8, failures: 1 });
    });

    it('does not escalate at low pressure and clears on success', () => {
        expect(escalate(undefined, 3, 'refused', 2)).toEqual({ step: 3, failures: 1 });
        expect(escalate({ step: 5, failures: 2 }, 3, 'refused', 2)).toEqual({ step: 5, failures: 3 });
        expect(escalate({ step: 5, failures: 2 }, 5, 'success', 5)).toBeUndefined();
    });
});

describe('chooseMethod: gate and plain choice', () => {
    it('keeps the appetite in thoughts below the gate', () => {
        const r = chooseMethod(input({ pressure: 1, opportunity: 1 }), ignoreStyle);
        expect(r).toMatchObject({ step: 0, method: 'abstain', mode: 'wait', reason: 'gate' });
        expect(chooseMethod(input({ pressure: 2, opportunity: 0.3 }), ignoreStyle).reason).toBe('gate');
    });

    it('acts at «present» when the chance is good', () => {
        const r = chooseMethod(input({ pressure: 2, opportunity: 0.7, receptive: 0.8 }), ignoreStyle);
        expect(r).toMatchObject({ step: 3, mode: 'now', reason: 'odds' });
    });

    it('lets withdrawal raise urgency past the gate', () => {
        const r = chooseMethod(input({ pressure: 2, withdrawal: true, opportunity: 0 }), ignoreStyle);
        expect(r.reason).not.toBe('gate');
    });

    it('takes the lowest step with acceptable odds', () => {
        expect(chooseMethod(input({ receptive: 0.6 }), ignoreStyle)).toMatchObject({ step: 3, method: 'court' });
        const r = chooseMethod(input({ receptive: 0.1, means: 0.1, opportunity: 0.5 }), ignoreStyle);
        expect(r).toMatchObject({ step: 5, method: 'deceive', mode: 'now', reason: 'odds' });
        expect(r.odds).toBeCloseTo(0.55, 5);
    });

    it('accepts longer shots when more urgent', () => {
        const odds = { 3: 0.25, 4: 0.25, 5: 0.25, 6: 0.25, 7: 0.25, 8: 0.25 };
        expect(chooseMethod(input({ pressure: 3, odds }), ignoreStyle).mode).toBe('wait');
        expect(chooseMethod(input({ pressure: 5, odds }), ignoreStyle)).toMatchObject({ step: 3, mode: 'now' });
    });

    it('starts from the escalation floor and never goes above the ceiling', () => {
        expect(chooseMethod(input({ receptive: 1, minStep: 4, means: 1 }), ignoreStyle).step).toBe(4);
        const capped = chooseMethod(input({ ceiling: 4, receptive: 0, means: 0, opportunity: 0.4 }), ignoreStyle);
        expect(capped.step).toBeLessThanOrEqual(4);
    });
});

describe('chooseMethod: when nothing works', () => {
    const hopeless = { receptive: 0, means: 0, opportunity: 0 };

    it('schemes when patient and a coarse step is within the ceiling', () => {
        const r = chooseMethod(input({ ...hopeless, patient: true }), ignoreStyle);
        expect(r).toMatchObject({ step: 5, mode: 'scheme', reason: 'scheme' });
    });

    it('waits when impatient, substitutes when too urgent to wait', () => {
        expect(chooseMethod(input(hopeless), ignoreStyle)).toMatchObject({ step: 2, mode: 'wait', reason: 'no-odds' });
        const urgent = chooseMethod(input({ ...hopeless, pressure: 4, substitute: true }), ignoreStyle);
        expect(urgent).toMatchObject({ step: 1, mode: 'substitute', reason: 'urgent' });
    });

    it('is frustrated when only a step above the ceiling would work', () => {
        const r = chooseMethod(
            input({ pressure: 4, ceiling: 4, receptive: 0, means: 0, opportunity: 0.9 }),
            ignoreStyle,
        );
        expect(r).toMatchObject({
            mode: 'frustrated',
            reason: 'above-ceiling',
            stress: 1,
            temptation: true,
            needed: 5,
        });
        expect(r.step).toBe(0);
    });

    it('is frustrated when escalation passed the ceiling, displacing onto a substitute', () => {
        const r = chooseMethod(input({ pressure: 3, ceiling: 4, minStep: 5, substitute: true }), ignoreStyle);
        expect(r).toMatchObject({ step: 1, mode: 'frustrated', temptation: false, needed: 5 });
    });
});

describe('chooseMethod: styles', () => {
    it('siren courts even on weaker odds', () => {
        const r = chooseMethod(input({ style: 'siren', receptive: 0.4 }), keepStyle);
        expect(r).toMatchObject({ step: 3, reason: 'style' });
        expect(chooseMethod(input({ style: 'siren', receptive: 0.4 }), ignoreStyle).step).not.toBe(3);
    });

    it('buyer trades first', () => {
        expect(chooseMethod(input({ style: 'buyer', receptive: 0.9, means: 0.9 }), keepStyle).step).toBe(4);
    });

    it('raider goes for force fast', () => {
        const r = chooseMethod(input({ style: 'raider', opportunity: 0.6, receptive: 0.9 }), keepStyle);
        expect(r).toMatchObject({ step: 8, method: 'force', mode: 'now' });
    });

    it('insider deceives in secret', () => {
        expect(chooseMethod(input({ style: 'insider', opportunity: 0.5 }), keepStyle)).toMatchObject({
            step: 5,
            secret: true,
        });
        const scheme = chooseMethod(
            input({ style: 'insider', opportunity: 0, receptive: 0, means: 0, patient: true }),
            keepStyle,
        );
        expect(scheme).toMatchObject({ mode: 'scheme', secret: true });
    });

    it('duelist issues a formal challenge', () => {
        expect(chooseMethod(input({ style: 'duelist', receptive: 0.5 }), keepStyle)).toMatchObject({
            step: 3,
            duel: true,
        });
    });

    it('shadow impairs and never coerces openly', () => {
        expect(chooseMethod(input({ style: 'shadow', opportunity: 0.5, receptive: 0, means: 0 }), keepStyle).step).toBe(
            6,
        );
        const r = chooseMethod(
            input({ style: 'shadow', ceiling: 7, minStep: 7, odds: { 7: 1 }, receptive: 0 }),
            keepStyle,
        );
        expect(r.step).not.toBe(7);
    });

    it('shepherd trades, then turns to hooks', () => {
        const r = chooseMethod(input({ style: 'shepherd', means: 0, receptive: 0, odds: { 7: 0.5 } }), keepStyle);
        expect(r.step).toBe(7);
    });

    it('honest never goes above court and is frustrated instead', () => {
        expect(chooseMethod(input({ style: 'honest', receptive: 0.6 }), keepStyle)).toMatchObject({ step: 3 });
        const r = chooseMethod(input({ style: 'honest', pressure: 4, receptive: 0, opportunity: 0.9 }), keepStyle);
        expect(r).toMatchObject({ mode: 'frustrated', needed: 4 });
    });

    it('spider lays a trap through a scheme, or springs it when desperate', () => {
        expect(chooseMethod(input({ style: 'spider', receptive: 1 }), keepStyle)).toMatchObject({
            step: 8,
            mode: 'scheme',
            reason: 'style',
        });
        expect(chooseMethod(input({ style: 'spider', ceiling: 6 }), keepStyle)).toMatchObject({
            step: 5,
            mode: 'scheme',
        });
        expect(chooseMethod(input({ style: 'spider', ceiling: 6, minStep: 6 }), keepStyle).step).toBe(6);
        expect(chooseMethod(input({ style: 'spider', pressure: 5, opportunity: 0.5 }), keepStyle)).toMatchObject({
            step: 8,
            mode: 'now',
        });
        expect(chooseMethod(input({ style: 'spider', ceiling: 4, receptive: 1 }), keepStyle).mode).toBe('now');
    });

    it('sometimes acts off-style (variety), deterministically with a seeded rng', () => {
        const rng = seeded(11);
        const steps = new Set<number>();
        for (let i = 0; i < 50; i++) {
            steps.add(chooseMethod(input({ style: 'raider', opportunity: 0.6, receptive: 0.9 }), rng).step);
        }
        expect(steps).toEqual(new Set([3, 8]));
    });
});
