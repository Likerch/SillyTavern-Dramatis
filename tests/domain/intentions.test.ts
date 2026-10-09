import { describe, expect, it } from 'vitest';
import {
    MAX_INTENTIONS,
    SWITCH_MARGIN,
    advanceClock,
    advanceIntention,
    clockFull,
    goalsByPriority,
    promote,
    reconsider,
} from '../../src/domain/intentions';
import type { Agenda, Goal, Intention } from '../../src/domain/model';

function goal(id: string, priority: number): Goal {
    return { id, text: `goal ${id}`, kind: 'external', priority };
}

function intention(id: string, goalId?: string): Intention {
    return { id, text: `do ${id}`, nextStep: 'step', dropIf: [], ...(goalId ? { goalId } : {}) };
}

function agenda(fields: Partial<Agenda> = {}): Agenda {
    return {
        goals: [goal('tax', 1), goal('letters', 2), goal('daughter', 1), goal('roof', 3)],
        intentions: [intention('i-tax', 'tax'), intention('i-letters', 'letters')],
        resources: [],
        leverage: [],
        secrets: [],
        ...fields,
    };
}

describe('reconsider', () => {
    it('keeps intentions without a trigger', () => {
        const a = agenda();
        const r = reconsider(a, {}, 'single');
        expect(r.agenda.intentions).toEqual(a.intentions);
        expect(r.changes).toEqual([]);
    });

    it('ends an achieved intention, removes its goal and promotes the next by priority', () => {
        const a = agenda();
        const r = reconsider(a, { 'i-tax': { achieved: true } }, 'single');
        expect(r.agenda.goals.map((g) => g.id)).toEqual(['letters', 'daughter', 'roof']);
        expect(r.agenda.intentions.map((i) => i.id)).toEqual(['i-letters', 'i-daughter']);
        expect(r.agenda.intentions[1]).toEqual({
            id: 'i-daughter',
            goalId: 'daughter',
            text: 'goal daughter',
            nextStep: '',
            dropIf: [],
        });
        expect(r.changes).toEqual([
            { kind: 'achieved', intention: 'i-tax', goal: 'tax' },
            { kind: 'promoted', intention: 'i-daughter', goal: 'daughter' },
        ]);
        expect(a.intentions).toHaveLength(2);
    });

    it('ends an impossible intention the same way', () => {
        const r = reconsider(agenda(), { 'i-letters': { impossible: true } }, 'open');
        expect(r.changes[0]).toEqual({ kind: 'impossible', intention: 'i-letters', goal: 'letters' });
        expect(r.agenda.goals.some((g) => g.id === 'letters')).toBe(false);
    });

    it('drops on a drop condition but keeps the goal (not re-promoted now)', () => {
        const r = reconsider(agenda(), { 'i-tax': { dropIfMatched: true } }, 'single');
        expect(r.agenda.goals.some((g) => g.id === 'tax')).toBe(true);
        expect(r.agenda.intentions.map((i) => i.goalId)).toEqual(['letters', 'daughter']);
        expect(r.changes[0]!.kind).toBe('dropped');
    });

    it('switches on a better option by commitment margin', () => {
        const signals = { 'i-tax': { betterOption: { text: 'sell the inn', margin: 0.3 } } };
        expect(reconsider(agenda(), signals, 'single').changes).toEqual([]);
        const open = reconsider(agenda(), signals, 'open');
        expect(open.agenda.intentions.map((i) => i.id)).toEqual(['i-option', 'i-letters']);
        expect(open.agenda.intentions[0]).toEqual({ id: 'i-option', text: 'sell the inn', nextStep: '', dropIf: [] });
        expect(open.changes).toEqual([{ kind: 'switched', intention: 'i-tax', goal: 'tax', replacedBy: 'i-option' }]);
        const strong = { 'i-tax': { betterOption: { text: 'flee', margin: SWITCH_MARGIN.single, goalId: 'roof' } } };
        const single = reconsider(agenda(), strong, 'single');
        expect(single.agenda.intentions[0]).toMatchObject({ id: 'i-roof', goalId: 'roof', text: 'flee' });
    });

    it('carries the next step and drop conditions of the option', () => {
        const r = reconsider(
            agenda(),
            { 'i-tax': { betterOption: { text: 'x', margin: 0.9, nextStep: 'go', dropIf: ['caught'] } } },
            'single',
        );
        expect(r.agenda.intentions[0]).toMatchObject({ nextStep: 'go', dropIf: ['caught'] });
    });

    it('ignores weak, empty or duplicate options', () => {
        const a = agenda();
        expect(reconsider(a, { 'i-tax': { betterOption: { text: ' ', margin: 1 } } }, 'open').changes).toEqual([]);
        expect(reconsider(a, { 'i-tax': { betterOption: { text: 'x', margin: Number.NaN } } }, 'open').changes).toEqual(
            [],
        );
        const dup = { 'i-tax': { betterOption: { text: 'x', margin: 1, goalId: 'letters' } } };
        expect(reconsider(a, dup, 'open').agenda.intentions).toEqual(a.intentions);
    });

    it('trims intentions beyond the limit', () => {
        const a = agenda({ intentions: [intention('a'), intention('b'), intention('c', 'roof')] });
        const r = reconsider(a, {}, 'single');
        expect(r.agenda.intentions.map((i) => i.id)).toEqual(['a', 'b']);
        expect(r.changes).toEqual([{ kind: 'trimmed', intention: 'c', goal: 'roof' }]);
    });

    it('keeps ids unique when promoting', () => {
        const a = agenda({ intentions: [intention('i-daughter')], goals: [goal('daughter', 1)] });
        const r = reconsider(a, {}, 'single');
        expect(r.agenda.intentions.map((i) => i.id)).toEqual(['i-daughter', 'i-daughter-2']);
    });

    it('handles an empty agenda', () => {
        const r = reconsider(agenda({ goals: [], intentions: [] }), {}, 'open');
        expect(r.agenda.intentions).toEqual([]);
        expect(r.changes).toEqual([]);
    });
});

describe('promote and priorities', () => {
    it('orders goals by priority, stable', () => {
        expect(goalsByPriority([goal('a', 2), goal('b', 1), goal('c', 2), goal('d', 1)]).map((g) => g.id)).toEqual([
            'b',
            'd',
            'a',
            'c',
        ]);
    });

    it('fills up to the limit and skips pursued goals', () => {
        const r = promote(agenda({ intentions: [intention('i-tax', 'tax')] }));
        expect(r.agenda.intentions).toHaveLength(MAX_INTENTIONS);
        expect(r.agenda.intentions[1]!.goalId).toBe('daughter');
        expect(promote(agenda({ intentions: [] }), new Set(['tax'])).agenda.intentions.map((i) => i.goalId)).toEqual([
            'daughter',
            'letters',
        ]);
    });
});

describe('clocks', () => {
    it('advances within bounds', () => {
        expect(advanceClock({ segments: 6, filled: 2 }, 1)).toEqual({ segments: 6, filled: 3 });
        expect(advanceClock({ segments: 6, filled: 5 }, 4)).toEqual({ segments: 6, filled: 6 });
        expect(advanceClock({ segments: 6, filled: 1 }, -3)).toEqual({ segments: 6, filled: 0 });
        expect(advanceClock({ segments: 4, filled: 1 }, Number.NaN)).toEqual({ segments: 4, filled: 1 });
    });

    it('knows when a clock is full', () => {
        expect(clockFull({ segments: 4, filled: 4 })).toBe(true);
        expect(clockFull({ segments: 4, filled: 3 })).toBe(false);
        expect(clockFull({ segments: 0, filled: 0 })).toBe(false);
    });

    it('advances an intention clock', () => {
        const a = agenda({ intentions: [{ ...intention('i-tax', 'tax'), clock: { segments: 6, filled: 2 } }] });
        const r = advanceIntention(a, 'i-tax', 2);
        expect(r.intentions[0]!.clock).toEqual({ segments: 6, filled: 4 });
        expect(a.intentions[0]!.clock!.filled).toBe(2);
        expect(advanceIntention(a, 'nope', 1)).toBe(a);
        const noClock = agenda();
        expect(advanceIntention(noClock, 'i-tax', 1)).toBe(noClock);
    });
});
