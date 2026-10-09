// Shared fixtures for the appetites-layer tests (not a test file itself).
import type { Rng } from '../../src/shared/contracts';
import type { Appetite, AppetiteState, Core } from '../../src/domain/model';

/** Mulberry32: a small deterministic rng. */
export function seeded(seed: number): Rng {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Returns the given values in order, then repeats the last one. */
export function seq(...values: number[]): Rng {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

export const always =
    (value: number): Rng =>
    () =>
        value;

export function appetite(fields: Partial<Appetite> = {}): Appetite {
    return {
        id: 'drink',
        kind: 'drink',
        sources: ['individual'],
        target: { mode: 'thing' },
        baseline: 3,
        liking: 1,
        triggers: [],
        satisfiers: [],
        drift: 'daily',
        tolerance: 0,
        dependence: 0,
        sensitization: 0,
        endorsement: 'torn',
        vow: 'none',
        visibility: 'open',
        style: 'buyer',
        affectionOnset: 'never',
        ...fields,
    };
}

export function appState(fields: Partial<AppetiteState> = {}): AppetiteState {
    return {
        pressure: 2,
        tolerance: 0,
        dependence: 0,
        sensitization: 0,
        lastSated: -1,
        edgeCount: 0,
        withdrawal: false,
        ...fields,
    };
}

export type BrakeCore = Pick<Core, 'values' | 'temperament' | 'redLines' | 'dark'>;

export function core(fields: Partial<BrakeCore> = {}): BrakeCore {
    return {
        values: { top: [] },
        temperament: {},
        redLines: { never: [], would: [] },
        ...fields,
    };
}
