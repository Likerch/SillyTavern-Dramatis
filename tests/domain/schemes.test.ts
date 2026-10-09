import { describe, expect, it } from 'vitest';
import {
    MAX_ATTEMPT,
    MIN_ATTEMPT,
    breachChance,
    defaultSecrecy,
    resolveAttempt,
    schemeSegments,
    startScheme,
    tickScheme,
} from '../../src/domain/schemes';
import type { AttemptInput, StartSchemeInput } from '../../src/domain/schemes';
import type { Scheme } from '../../src/domain/model';
import { always, seeded, seq } from './appetites-fixtures';

const never = always(0.999);

function start(fields: Partial<StartSchemeInput> = {}): Scheme {
    return startScheme({
        id: 's1',
        owner: 'grukk',
        target: 'mira',
        method: 8,
        text: 'cut her wagon off at the ford at dusk',
        inertia: 1,
        guardians: 0,
        turn: 5,
        ...fields,
    });
}

const calm: AttemptInput = { guardians: 0, caution: 0, capability: 1 };

describe('startScheme', () => {
    it('sizes the clock 4–8 by inertia and guardians', () => {
        expect(schemeSegments(0, 0)).toBe(4);
        expect(schemeSegments(1, 0)).toBe(5);
        expect(schemeSegments(1, 1)).toBe(6);
        expect(schemeSegments(2, 2)).toBe(7);
        expect(schemeSegments(3, 3)).toBe(8);
        expect(schemeSegments(9, 9)).toBe(8);
        expect(schemeSegments(-2, -2)).toBe(4);
    });

    it('derives secrecy from the method and the number of mouths', () => {
        expect(defaultSecrecy(5, 0)).toBe(90);
        expect(defaultSecrecy(8, 2)).toBe(60);
        expect(defaultSecrecy(8, 20)).toBe(10);
    });

    it('builds a running scheme', () => {
        const s = start({ accomplices: ['snikt'], appetite: 'plunder' });
        expect(s).toMatchObject({
            id: 's1',
            owner: 'grukk',
            target: 'mira',
            method: 8,
            clock: { segments: 5, filled: 0 },
            secrecy: 70,
            breaches: 0,
            accomplices: ['snikt'],
            state: 'running',
            startedTurn: 5,
            appetite: 'plunder',
        });
        expect(start()).not.toHaveProperty('appetite');
        expect(start({ secrecy: 150, method: 11 })).toMatchObject({ secrecy: 100, method: 8 });
    });
});

describe('tickScheme', () => {
    it('advances +1 with opportunity, +1 per accomplice, +1 insider, −1 guarded', () => {
        const s = start({ accomplices: ['a', 'b'], inertia: 3, guardians: 3 });
        expect(tickScheme(s, { opportunity: true }, never).progressed).toBe(3);
        expect(tickScheme(s, { opportunity: true, insider: true, guarded: true }, never).progressed).toBe(3);
        expect(tickScheme(s, { opportunity: false, accomplices: 0, guarded: true }, never).progressed).toBe(0);
        expect(tickScheme(s, { opportunity: true, accomplices: 10 }, never).progressed).toBe(4);
    });

    it('covers several intervals and turns ready when full', () => {
        const r = tickScheme(start(), { opportunity: true, intervals: 9 }, never);
        expect(r.scheme.clock.filled).toBe(5);
        expect(r.scheme.state).toBe('ready');
        expect(r.notes).toEqual(['progress', 'ready']);
    });

    it('breaches by chance and burns at 5 breaches', () => {
        const r = tickScheme(start({ secrecy: 0 }), { opportunity: false, intervals: 3 }, always(0));
        expect(r.breaches).toBe(3);
        expect(r.scheme.state).toBe('running');
        expect(r.notes).toEqual(['breach']);
        const burnt = tickScheme({ ...r.scheme, breaches: 4 }, { opportunity: true }, always(0));
        expect(burnt.scheme.state).toBe('exposed');
        expect(burnt.notes).toEqual(['progress', 'breach', 'exposed']);
    });

    it('is exposed at once by a dramatic discovery', () => {
        const r = tickScheme(start(), { opportunity: true, discovered: true }, never);
        expect(r.scheme.state).toBe('exposed');
        expect(r.progressed).toBe(0);
    });

    it('leaves finished schemes alone and does not mutate the input', () => {
        const ready: Scheme = { ...start(), state: 'ready' };
        expect(tickScheme(ready, { opportunity: true }, never).scheme).toBe(ready);
        const s = start();
        const copy = structuredClone(s);
        tickScheme(s, { opportunity: true }, always(0));
        expect(s).toEqual(copy);
    });

    it('uses one tenth of the missing secrecy as the breach chance', () => {
        expect(breachChance(70)).toBeCloseTo(0.03, 5);
        expect(breachChance(0)).toBeCloseTo(0.1, 5);
        expect(breachChance(100)).toBe(0);
    });

    it('rarely breaches a quiet scheme (seeded)', () => {
        const rng = seeded(3);
        let breaches = 0;
        for (let i = 0; i < 1000; i++)
            breaches += tickScheme(start({ secrecy: 70 }), { opportunity: true }, rng).breaches;
        expect(breaches).toBeGreaterThan(10);
        expect(breaches).toBeLessThan(55);
    });
});

describe('resolveAttempt', () => {
    const ready: Scheme = { ...start(), clock: { segments: 5, filled: 5 }, state: 'ready' };

    it('succeeds on a good roll', () => {
        const r = resolveAttempt(ready, calm, always(0));
        expect(r).toMatchObject({ outcome: 'done', reason: 'success' });
        expect(r.scheme.state).toBe('done');
        expect(r.chance).toBeCloseTo(0.7, 5);
    });

    it('can be exposed on a failure', () => {
        const r = resolveAttempt(ready, { ...calm, guardians: 2 }, seq(0.99, 0));
        expect(r).toMatchObject({ outcome: 'exposed', reason: 'caught' });
        expect(r.scheme.state).toBe('exposed');
    });

    it('names the biggest obstacle on a quiet failure', () => {
        expect(resolveAttempt({ ...ready, secrecy: 100 }, { ...calm, guardians: 2 }, seq(0.99, 0.99)).reason).toBe(
            'guarded',
        );
        expect(resolveAttempt(ready, { ...calm, caution: 3 }, seq(0.99, 0.99)).reason).toBe('caution');
        expect(resolveAttempt(ready, { ...calm, warned: true }, seq(0.99, 0.99)).reason).toBe('warned');
        expect(resolveAttempt(ready, calm, seq(0.99, 0.99))).toMatchObject({ outcome: 'failed', reason: 'outmatched' });
    });

    it('penalizes rushing an unfinished clock', () => {
        const running = start();
        const r = resolveAttempt(running, calm, seq(0.99, 0.99));
        expect(r.reason).toBe('rushed');
        expect(r.chance).toBeCloseTo(0.2, 5);
    });

    it('keeps the odds within bounds', () => {
        const best = resolveAttempt(ready, { guardians: 0, caution: 0, capability: 3, accomplices: 5 }, never);
        expect(best.chance).toBe(MAX_ATTEMPT);
        const worst = resolveAttempt(
            { ...start(), breaches: 4 },
            { guardians: 3, allies: 3, caution: 3, capability: 0, warned: true },
            never,
        );
        expect(worst.chance).toBe(MIN_ATTEMPT);
    });

    it('counts the scheme’s own accomplices by default', () => {
        const helped = { ...ready, accomplices: ['a', 'b', 'c'] };
        expect(resolveAttempt(helped, calm, always(0)).chance).toBeCloseTo(0.85, 5);
    });
});
