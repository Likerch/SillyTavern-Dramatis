import { describe, expect, it } from 'vitest';
import { MOOD_FACTOR, initiativeWeight, rollInitiative, suggestMove } from '../../src/domain/initiative';
import type { InitiativeCandidate } from '../../src/domain/initiative';
import { PLAYER_ID } from '../../src/domain/model';

function cand(id: string, fields: Partial<InitiativeCandidate> = {}): InitiativeCandidate {
    return {
        id,
        proactivity: 5,
        urgency: 0.5,
        pressure: 0,
        mood: 'dependent',
        band: 'background',
        ties: [],
        ...fields,
    };
}

/** Returns the given values in turn (then repeats the last). */
function seq(...values: number[]): () => number {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)]!;
}

/** Small seeded PRNG (mulberry32) for distribution checks. */
function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('initiativeWeight', () => {
    it('follows the formula', () => {
        expect(initiativeWeight(cand('a', { proactivity: 10, urgency: 0.5, pressure: 0, mood: 'dependent' }))).toBe(1);
        expect(initiativeWeight(cand('a', { proactivity: 5, urgency: 1, pressure: 5, mood: 'hostile' }))).toBeCloseTo(
            0.5 * 1.5 * 2 * 1.4,
        );
        expect(initiativeWeight(cand('a', { proactivity: 0 }))).toBe(0);
    });

    it('raises active moods and lowers flat ones', () => {
        const base = initiativeWeight(cand('a', { mood: 'dependent' }));
        for (const mood of ['hostile', 'exuberant', 'anxious'] as const) {
            expect(initiativeWeight(cand('a', { mood }))).toBeGreaterThan(base);
        }
        for (const mood of ['bored', 'docile'] as const)
            expect(initiativeWeight(cand('a', { mood }))).toBeLessThan(base);
        expect(MOOD_FACTOR.relaxed).toBeLessThan(1);
    });

    it('clamps garbage', () => {
        const w = initiativeWeight(cand('a', { proactivity: 99, urgency: 7, pressure: Number.NaN }));
        expect(w).toBe(1.5);
        expect(initiativeWeight(cand('a', { proactivity: Number.NaN }))).toBe(0);
        expect(initiativeWeight(cand('a', { mood: 'weird' as never, proactivity: 10, urgency: 0.5 }))).toBe(1);
    });
});

describe('suggestMove', () => {
    const present = new Set(['ilva', 'bram', 'sota']);

    it('prefers an intent toward another present NPC', () => {
        const ilva = cand('ilva', {
            band: 'focus',
            ties: [
                { target: PLAYER_ID, intent: 'extract', stance: -2 },
                { target: 'bram', intent: 'use', stance: 1 },
                { target: 'sota', intent: 'protect', stance: 3 },
                { target: 'absent', intent: 'avenge', stance: -3 },
            ],
        });
        expect(suggestMove(ilva, present)).toEqual({ id: 'ilva', move: 'initiate', target: 'sota' });
    });

    it('maps intents to moves', () => {
        const avenge = cand('a', { ties: [{ target: 'bram', intent: 'avenge', stance: -3 }] });
        expect(suggestMove(avenge, present).move).toBe('obstruct');
        const avoid = cand('a', { ties: [{ target: 'bram', intent: 'avoid', stance: -1 }] });
        expect(suggestMove(avoid, present)).toEqual({ id: 'a', move: 'leave', target: 'bram' });
    });

    it('breaks ties by stance strength and want', () => {
        const c = cand('a', {
            ties: [
                { target: 'bram', intent: 'use', stance: 1 },
                { target: 'sota', intent: 'use', stance: -2 },
            ],
        });
        expect(suggestMove(c, present).target).toBe('sota');
        const w = cand('a', {
            ties: [
                { target: 'bram', intent: 'court', stance: 1, want: 2 },
                { target: 'sota', intent: 'court', stance: 1, want: 4 },
            ],
        });
        expect(suggestMove(w, present).target).toBe('sota');
        const noWant = cand('a', {
            ties: [
                { target: 'bram', intent: 'court', stance: 1 },
                { target: 'sota', intent: 'court', stance: 1 },
            ],
        });
        expect(suggestMove(noWant, present).target).toBe('bram');
    });

    it('ignores ties to itself, absent characters and the none intent', () => {
        const c = cand('bram', {
            ties: [
                { target: 'bram', intent: 'use', stance: 1 },
                { target: 'ghost', intent: 'use', stance: 1 },
                { target: 'sota', intent: 'none', stance: 2 },
            ],
        });
        expect(suggestMove(c, present)).toEqual({ id: 'bram', move: 'own' });
    });

    it('turns to the player only in focus or with want ≥ 3', () => {
        expect(suggestMove(cand('a', { band: 'business' }), present).move).toBe('own');
        expect(suggestMove(cand('a', { band: 'focus' }), present)).toEqual({
            id: 'a',
            move: 'initiate',
            target: PLAYER_ID,
        });
        const hunter = cand('a', { ties: [{ target: PLAYER_ID, intent: 'none', stance: -1, want: 4 }] });
        expect(suggestMove(hunter, present)).toEqual({ id: 'a', move: 'obstruct', target: PLAYER_ID });
        const mild = cand('a', { ties: [{ target: PLAYER_ID, intent: 'seduce', stance: 1, want: 2 }] });
        expect(suggestMove(mild, present).move).toBe('own');
        const avoider = cand('a', { band: 'focus', ties: [{ target: PLAYER_ID, intent: 'avoid', stance: 0 }] });
        expect(suggestMove(avoider, present)).toEqual({ id: 'a', move: 'leave', target: PLAYER_ID });
    });

    it('leaves when business is elsewhere or bored with nothing to do', () => {
        expect(suggestMove(cand('a', { elsewhere: true }), present)).toEqual({ id: 'a', move: 'leave' });
        expect(suggestMove(cand('a', { mood: 'bored', urgency: 0.1 }), present).move).toBe('leave');
        expect(suggestMove(cand('a', { mood: 'bored', urgency: 0.8 }), present).move).toBe('own');
    });
});

describe('rollInitiative', () => {
    const chars = [
        cand('ilva', { proactivity: 6, urgency: 0.6 }),
        cand('bram', { proactivity: 4 }),
        cand('sota', { proactivity: 3 }),
        cand('fenn', { proactivity: 0 }),
    ];

    it('picks by weight with the rng', () => {
        // weights: ilva 0.66, bram 0.4, sota 0.3 → total 1.36
        expect(rollInitiative(chars, seq(0), { max: 1 }).map((p) => p.id)).toEqual(['ilva']);
        expect(rollInitiative(chars, seq(0.5), { max: 1 }).map((p) => p.id)).toEqual(['bram']);
        expect(rollInitiative(chars, seq(0.99), { max: 1 }).map((p) => p.id)).toEqual(['sota']);
    });

    it('picks distinct characters without replacement', () => {
        const picks = rollInitiative(chars, seq(0, 0), { max: 2 });
        expect(picks.map((p) => p.id)).toEqual(['ilva', 'bram']);
        expect(picks[0]).toEqual({ id: 'ilva', move: 'own', weight: 0.66 });
    });

    it('never picks zero-weight characters and caps max at 2', () => {
        const picks = rollInitiative(chars, seq(0.99, 0.99, 0.99), { max: 5 });
        expect(picks).toHaveLength(2);
        expect(picks.map((p) => p.id)).not.toContain('fenn');
        expect(rollInitiative([cand('x', { proactivity: 0 })], seq(0.5), { max: 2 })).toEqual([]);
        expect(rollInitiative(chars, seq(0.5), { max: 0 })).toEqual([]);
        expect(rollInitiative([], seq(0.5))).toEqual([]);
    });

    it('survives an rng returning 1 or garbage', () => {
        expect(rollInitiative(chars, seq(1), { max: 1 })[0]!.id).toBe('sota');
        expect(rollInitiative(chars, seq(Number.NaN), { max: 1 })[0]!.id).toBe('ilva');
    });

    it('is deterministic with a seeded rng and follows the weights', () => {
        const a = rollInitiative(chars, seeded(42), { max: 2 });
        const b = rollInitiative(chars, seeded(42), { max: 2 });
        expect(a).toEqual(b);
        const rng = seeded(7);
        const counts: Record<string, number> = {};
        for (let i = 0; i < 3000; i++) {
            const id = rollInitiative(chars, rng, { max: 1 })[0]!.id;
            counts[id] = (counts[id] ?? 0) + 1;
        }
        expect(counts.ilva!).toBeGreaterThan(counts.bram!);
        expect(counts.bram!).toBeGreaterThan(counts.sota!);
        expect(counts.fenn).toBeUndefined();
    });

    it('uses the present list for NPC targets', () => {
        const c = [cand('ilva', { ties: [{ target: 'brother', intent: 'recruit', stance: 2 }] })];
        expect(rollInitiative(c, seq(0))[0]!.move).toBe('own');
        expect(rollInitiative(c, seq(0), { present: ['ilva', 'brother'] })[0]).toMatchObject({
            move: 'initiate',
            target: 'brother',
        });
    });
});
