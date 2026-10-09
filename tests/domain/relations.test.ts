import { describe, expect, it } from 'vitest';
import {
    DOWN_NEED,
    MAX_REASONS,
    MAX_STACKS,
    addReason,
    applyStanceEvents,
    capReasons,
    boundsFor,
    netStanceChange,
    onSceneEnd,
    progressReady,
    relationContext,
    stackFactor,
    stepStance,
} from '../../src/domain/relations';
import type { RelationContext, StanceEvent } from '../../src/domain/relations';
import { PLAYER_ID } from '../../src/domain/model';
import type { Stance, Tie } from '../../src/domain/model';

function tie(fields: Partial<Tie> = {}): Tie {
    return {
        target: PLAYER_ID,
        stance: 0,
        reasons: [],
        evaluations: [],
        intent: 'none',
        debts: [],
        encounters: [],
        beliefs: [],
        ...fields,
    };
}

function ctx(fields: Partial<RelationContext> = {}): RelationContext {
    return { scene: 1, inertia: 'high', bounds: {}, agreeableness: 0, baseStance: 0, ...fields };
}

const up = (text: string, extra: Partial<StanceEvent> = {}): StanceEvent => ({ text, delta: 1, ...extra });
const down = (text: string, extra: Partial<StanceEvent> = {}): StanceEvent => ({ text, delta: -1, ...extra });

describe('helpers', () => {
    it('diminishes repeats by 0.9 per stack', () => {
        expect(stackFactor(0)).toBe(1);
        expect(stackFactor(1)).toBeCloseTo(0.9);
        expect(stackFactor(2)).toBeCloseTo(0.81);
        expect(stackFactor(-3)).toBe(1);
    });

    it('steps on the ladder only', () => {
        expect(stepStance(0, 1)).toBe(1);
        expect(stepStance(3, 1)).toBe(3);
        expect(stepStance(-3, -1)).toBe(-3);
    });

    it('sums net stance change', () => {
        expect(
            netStanceChange([
                { kind: 'step', target: 'a', scene: 1, from: 0, to: 1 },
                { kind: 'pending', target: 'a', scene: 1 },
                { kind: 'drift', target: 'a', scene: 1, from: 1, to: 0 },
                { kind: 'step', target: 'a', scene: 2, from: 0, to: -1 },
            ]),
        ).toBe(-1);
    });
});

describe('boundsFor', () => {
    const bounds = [
        { target: 'imperials', max: 0 as Stance },
        { target: 'Чужаки', max: 1 as Stance, min: -2 as Stance },
        { target: '*', min: -3 as Stance, max: 2 as Stance },
        { target: 'sota', min: 2 as Stance },
    ];

    it('uses the strictest class bound', () => {
        expect(boundsFor(bounds, PLAYER_ID, ['imperials', 'чужаки'])).toEqual({ min: -2, max: 0 });
    });

    it('falls back to the wildcard', () => {
        expect(boundsFor(bounds, 'bram', [])).toEqual({ min: -3, max: 2 });
    });

    it('prefers a bound naming the target', () => {
        expect(boundsFor(bounds, 'sota', [])).toEqual({ min: 2, max: 2 });
        expect(boundsFor(bounds, 'SOTA', [])).toEqual({ min: 2, max: 2 });
    });

    it('lets the ceiling win when floor and ceiling cross', () => {
        expect(boundsFor([{ target: 'x', min: 2, max: -1 }], 'x')).toEqual({ min: -1, max: -1 });
    });

    it('returns nothing when no bound matches', () => {
        expect(boundsFor(bounds.slice(0, 2), 'bram', ['carters'])).toEqual({});
        expect(boundsFor([], 'bram')).toEqual({});
    });
});

describe('relationContext', () => {
    it('reads agreeableness and bounds from the core', () => {
        const c = relationContext({
            core: { stanceBounds: [{ target: 'imperials', max: 0 }], temperament: { agreeableness: -2 } },
            targetId: PLAYER_ID,
            targetClasses: ['imperials'],
            scene: 4,
            inertia: 'medium',
            baseStance: -2,
        });
        expect(c).toEqual({ scene: 4, inertia: 'medium', bounds: { max: 0 }, agreeableness: -2, baseStance: -2 });
        const plain = relationContext({
            core: { stanceBounds: [], temperament: {} },
            targetId: 'x',
            scene: 1,
            inertia: 'high',
            baseStance: 0,
        });
        expect(plain.agreeableness).toBe(0);
    });
});

describe('addReason', () => {
    it('adds a new reason with a scene-based id', () => {
        const t = tie();
        const r = addReason(
            t,
            { text: ' paid well ', delta: 1, scenesLeft: 2, key: true, sourceMessage: 7 },
            { scene: 3 },
        );
        expect(r.stacked).toBe(false);
        expect(r.effective).toBe(1);
        expect(r.reason).toEqual({
            id: 'r3',
            text: 'paid well',
            delta: 1,
            scenesLeft: 2,
            stacks: 0,
            scene: 3,
            key: true,
            sourceMessage: 7,
        });
        expect(t.reasons).toEqual([]);
        const second = addReason(r.tie, { text: 'other', delta: -0.5, scenesLeft: null }, { scene: 3 });
        expect(second.reason.id).toBe('r3-2');
    });

    it('merges repeats with diminishing returns', () => {
        let t = tie();
        t = addReason(t, { text: 'Комплимент!', delta: 0.5, scenesLeft: 2 }, { scene: 1 }).tie;
        const r = addReason(t, { text: 'комплимент', delta: 0.5, scenesLeft: 3, sourceMessage: 9 }, { scene: 2 });
        expect(r.stacked).toBe(true);
        expect(r.effective).toBeCloseTo(0.45);
        expect(r.reason.delta).toBeCloseTo(0.95);
        expect(r.reason.stacks).toBe(1);
        expect(r.reason.scenesLeft).toBe(3);
        expect(r.reason.sourceMessage).toBe(9);
        expect(r.reason.scene).toBe(1);
        expect(r.tie.reasons).toHaveLength(1);
        const third = addReason(r.tie, { text: 'комплимент', delta: 0.5, scenesLeft: 1, key: true }, { scene: 3 });
        expect(third.effective).toBeCloseTo(0.405);
        expect(third.reason.scenesLeft).toBe(3);
        expect(third.reason.key).toBe(true);
    });

    it('keeps permanence when either side is permanent', () => {
        let t = tie();
        t = addReason(t, { text: 'debt', delta: -1, scenesLeft: null }, { scene: 1 }).tie;
        const r = addReason(t, { text: 'debt', delta: -1, scenesLeft: 2 }, { scene: 2 });
        expect(r.reason.scenesLeft).toBeNull();
    });

    it('does not merge opposite signs', () => {
        let t = tie();
        t = addReason(t, { text: 'talked', delta: 0.5, scenesLeft: 2 }, { scene: 1 }).tie;
        const r = addReason(t, { text: 'talked', delta: -0.5, scenesLeft: 2 }, { scene: 1 });
        expect(r.stacked).toBe(false);
        expect(r.tie.reasons).toHaveLength(2);
    });

    it('stops adding weight at the stack limit', () => {
        let t = tie();
        for (let i = 0; i <= MAX_STACKS; i++)
            t = addReason(t, { text: 'gift', delta: 1, scenesLeft: 2 }, { scene: 1 }).tie;
        expect(t.reasons[0]!.stacks).toBe(MAX_STACKS);
        const before = t.reasons[0]!.delta;
        const r = addReason(t, { text: 'gift', delta: 1, scenesLeft: 5 }, { scene: 2 });
        expect(r.effective).toBe(0);
        expect(r.reason.delta).toBe(before);
        expect(r.reason.scenesLeft).toBe(5);
    });

    it('clamps garbage deltas', () => {
        const r = addReason(tie(), { text: 'x', delta: Number.NaN, scenesLeft: 1 }, { scene: 1 });
        expect(r.reason.delta).toBe(0);
        const big = addReason(tie(), { text: 'x', delta: 9, scenesLeft: 1 }, { scene: 1 });
        expect(big.reason.delta).toBe(3);
    });
});

describe('progressReady', () => {
    const item = (reason: string, scene: number, delta: number, key = false) => ({
        reason,
        scene,
        delta,
        ...(key ? { key } : {}),
    });

    it('needs two reasons in two scenes on high inertia', () => {
        expect(progressReady({ dir: 1, items: [item('a', 1, 1)] }, 'high', 0)).toBe(false);
        expect(progressReady({ dir: 1, items: [item('a', 1, 1), item('b', 1, 1)] }, 'high', 0)).toBe(false);
        expect(progressReady({ dir: 1, items: [item('a', 1, 1), item('a', 2, 0.9)] }, 'high', 0)).toBe(false);
        expect(progressReady({ dir: 1, items: [item('a', 1, 1), item('b', 2, 1)] }, 'high', 0)).toBe(true);
        expect(progressReady({ dir: 1, items: [item('a', 1, 0.3), item('b', 2, 0.3)] }, 'high', 0)).toBe(false);
    });

    it('needs two reasons on medium and one full step on low', () => {
        expect(progressReady({ dir: 1, items: [item('a', 1, 1), item('b', 1, 1)] }, 'medium', 0)).toBe(true);
        expect(progressReady({ dir: 1, items: [item('a', 1, 1)] }, 'medium', 0)).toBe(false);
        expect(progressReady({ dir: 1, items: [item('a', 1, 1)] }, 'low', 0)).toBe(true);
        expect(progressReady({ dir: 1, items: [item('a', 1, 0.5)] }, 'low', 0)).toBe(false);
        expect(progressReady({ dir: 1, items: [item('a', 1, 0.5), item('b', 1, 0.5)] }, 'low', 0)).toBe(true);
    });

    it('lets a key event through at once', () => {
        expect(progressReady({ dir: 1, items: [item('a', 1, 0.5, true)] }, 'high', 0)).toBe(true);
        expect(progressReady({ dir: -1, items: [item('a', 1, -0.2, true)] }, 'high', 2)).toBe(true);
    });

    it('steps down by temperament', () => {
        expect(progressReady({ dir: -1, items: [item('a', 1, -1)] }, 'high', 0)).toBe(true);
        expect(progressReady({ dir: -1, items: [item('a', 1, -1)] }, 'high', 1)).toBe(false);
        expect(progressReady({ dir: -1, items: [item('a', 1, -1), item('b', 1, -0.2)] }, 'high', 1)).toBe(true);
        expect(progressReady({ dir: -1, items: [item('a', 1, -2)] }, 'high', 2)).toBe(true);
        expect(progressReady({ dir: -1, items: [item('a', 1, -0.5)] }, 'high', -2)).toBe(true);
        expect(progressReady({ dir: -1, items: [item('a', 1, -0.5)] }, 'high', -1)).toBe(false);
        expect(progressReady({ dir: -1, items: [item('a', 1, -0.75)] }, 'high', -1)).toBe(true);
        expect(DOWN_NEED[2].events).toBe(2);
    });
});

describe('applyStanceEvents: rising', () => {
    it('keeps a single up-event as a reason only (§5.6 tips)', () => {
        const start = tie({ stance: -2 });
        const r = applyStanceEvents(start, [up('заплатил щедро', { scenes: 2 })], ctx({ baseStance: -2 }));
        expect(r.tie.stance).toBe(-2);
        expect(r.tie.reasons[0]).toMatchObject({ text: 'заплатил щедро', delta: 1, scenesLeft: 2 });
        expect(r.changes.map((c) => c.kind)).toEqual(['reason-added', 'pending']);
        expect(r.tie.progress?.items).toHaveLength(1);
        expect(start.reasons).toEqual([]);
    });

    it('steps up after agreeing events in two scenes (high)', () => {
        let t = applyStanceEvents(tie(), [up('helped with crates')], ctx({ scene: 1 })).tie;
        t = onSceneEnd(t, { scene: 1, baseStance: 0 }).tie;
        const r = applyStanceEvents(t, [up('defended her son')], ctx({ scene: 2 }));
        expect(r.tie.stance).toBe(1);
        expect(r.changes.at(-1)).toMatchObject({ kind: 'step', from: 0, to: 1, text: 'defended her son' });
        expect(r.tie.progress).toBeUndefined();
        expect(r.tie.moved).toEqual({ scene: 2, delta: 1 });
    });

    it('does not count a repeated reason as a second event', () => {
        let t = applyStanceEvents(tie(), [up('compliment')], ctx({ scene: 1 })).tie;
        t = onSceneEnd(t, { scene: 1, baseStance: 0 }).tie;
        const r = applyStanceEvents(t, [up('Compliment.')], ctx({ scene: 2 }));
        expect(r.tie.stance).toBe(0);
        expect(r.changes.map((c) => c.kind)).toEqual(['reason-stacked', 'pending']);
    });

    it('steps up at once on a key event', () => {
        const r = applyStanceEvents(
            tie({ stance: -2 }),
            [up('saved her daughter', { key: true, permanent: true })],
            ctx(),
        );
        expect(r.tie.stance).toBe(-1);
        expect(r.tie.reasons[0]).toMatchObject({ scenesLeft: null, key: true });
    });

    it('caps net movement at one step per scene on high inertia', () => {
        const r = applyStanceEvents(
            tie(),
            [up('a', { key: true }), up('b', { key: true }), up('c', { key: true })],
            ctx({ scene: 5 }),
        );
        expect(r.tie.stance).toBe(1);
        expect(r.changes.filter((c) => c.kind === 'held-cap')).toHaveLength(2);
        // The blocked progress is kept and can step in a later scene.
        expect(r.tie.progress?.items.length).toBe(2);
        const later = applyStanceEvents(r.tie, [up('d', { delta: 0.1 })], ctx({ scene: 6 }));
        expect(later.tie.stance).toBe(2);
    });

    it('allows two steps per scene on low inertia', () => {
        const r = applyStanceEvents(tie(), [up('a'), up('b'), up('c')], ctx({ inertia: 'low' }));
        expect(r.tie.stance).toBe(2);
        expect(r.changes.filter((c) => c.kind === 'step')).toHaveLength(2);
        expect(r.changes.filter((c) => c.kind === 'held-cap')).toHaveLength(1);
    });

    it('needs two reasons in the same scene on medium inertia', () => {
        const r = applyStanceEvents(tie(), [up('a'), up('b')], ctx({ inertia: 'medium' }));
        expect(r.tie.stance).toBe(1);
        expect(r.changes.map((c) => c.kind)).toEqual(['reason-added', 'pending', 'reason-added', 'step']);
    });

    it('lets a step down then up within the cap (net movement)', () => {
        const r = applyStanceEvents(tie(), [down('insult'), up('apology', { key: true })], ctx());
        expect(r.tie.stance).toBe(0);
        expect(r.tie.moved).toEqual({ scene: 1, delta: 0 });
    });
});

describe('applyStanceEvents: falling', () => {
    it('steps down on one −1 event', () => {
        const r = applyStanceEvents(tie({ stance: 1 }), [down('сорвал поставку')], ctx());
        expect(r.tie.stance).toBe(0);
        expect(r.changes.at(-1)).toMatchObject({ kind: 'step', from: 1, to: 0 });
    });

    it('makes forgiving characters fall slower', () => {
        const c = ctx({ agreeableness: 1 });
        const once = applyStanceEvents(tie({ stance: 1 }), [down('lied')], c);
        expect(once.tie.stance).toBe(1);
        const twice = applyStanceEvents(once.tie, [down('lied again', { delta: -0.5 })], c);
        expect(twice.tie.stance).toBe(0);
    });

    it('drops at once on a severe event even for forgiving characters', () => {
        const r = applyStanceEvents(tie({ stance: 2 }), [{ text: 'betrayal', delta: -3 }], ctx({ agreeableness: 2 }));
        expect(r.tie.stance).toBe(1);
        expect(r.changes[0]).toMatchObject({ kind: 'clamped', delta: -3 });
        expect(r.tie.reasons[0]!.delta).toBe(-3);
    });

    it('accumulates small slights', () => {
        let t = tie();
        const c = ctx();
        t = applyStanceEvents(t, [down('rude', { delta: -0.5 })], c).tie;
        expect(t.stance).toBe(0);
        t = applyStanceEvents(t, [down('mocked', { delta: -0.5 })], c).tie;
        expect(t.stance).toBe(-1);
    });

    it('resets progress when direction flips', () => {
        let t = applyStanceEvents(tie(), [up('helped')], ctx({ scene: 1 })).tie;
        t = applyStanceEvents(t, [down('mocked', { delta: -0.5 })], ctx({ scene: 1 })).tie;
        expect(t.progress?.dir).toBe(-1);
        expect(t.progress?.items).toHaveLength(1);
        const r = applyStanceEvents(t, [up('gift')], ctx({ scene: 2 }));
        expect(r.tie.stance).toBe(0);
        expect(r.tie.progress?.items.map((i) => i.reason)).toEqual([r.tie.reasons.at(-1)!.id]);
    });
});

describe('applyStanceEvents: bounds and clamps', () => {
    it('never crosses an author ceiling', () => {
        const r = applyStanceEvents(tie({ stance: 0 }), [up('saved', { key: true })], ctx({ bounds: { max: 0 } }));
        expect(r.tie.stance).toBe(0);
        expect(r.changes.at(-1)).toMatchObject({ kind: 'held-bound', from: 0 });
    });

    it('never crosses an author floor', () => {
        const r = applyStanceEvents(tie({ stance: 2 }), [down('slight')], ctx({ bounds: { min: 2 } }));
        expect(r.tie.stance).toBe(2);
        expect(r.changes.at(-1)!.kind).toBe('held-bound');
    });

    it('lets an arc event cross and reports it', () => {
        const r = applyStanceEvents(
            tie({ stance: 0 }),
            [up('chose him over the Empire', { key: true, arc: true, permanent: true })],
            ctx({ bounds: { max: 0 } }),
        );
        expect(r.tie.stance).toBe(1);
        expect(r.changes.at(-1)).toMatchObject({ kind: 'arc-crossing', from: 0, to: 1 });
    });

    it('lets a stance outside bounds move back inside', () => {
        const r = applyStanceEvents(tie({ stance: 2 }), [down('insult')], ctx({ bounds: { max: 0 } }));
        expect(r.tie.stance).toBe(1);
        expect(r.changes.at(-1)!.kind).toBe('step');
    });

    it('clamps a multi-step jump to one step', () => {
        const r = applyStanceEvents(tie({ stance: -3 }), [{ text: 'saved my life', delta: 5, key: true }], ctx());
        expect(r.tie.stance).toBe(-2);
        expect(r.changes[0]).toMatchObject({ kind: 'clamped', delta: 5 });
    });

    it('stops at the end of the ladder and clears progress', () => {
        const r = applyStanceEvents(tie({ stance: 3 }), [up('more help', { key: true })], ctx());
        expect(r.tie.stance).toBe(3);
        expect(r.tie.progress).toBeUndefined();
        expect(r.changes.map((c) => c.kind)).toEqual(['reason-added']);
    });

    it('ignores empty and zero events', () => {
        const start = tie();
        const r = applyStanceEvents(
            start,
            [
                { text: 'nothing', delta: 0 },
                { text: '  ', delta: 1 },
                { text: 'nan', delta: Number.NaN },
                { text: undefined as unknown as string, delta: 1 },
            ],
            ctx(),
        );
        expect(r.tie).toBe(start);
        expect(r.changes).toEqual([]);
    });

    it('records a maxed-out repeat without progress', () => {
        let t = tie();
        for (let i = 0; i <= MAX_STACKS; i++)
            t = addReason(t, { text: 'gift', delta: 0.1, scenesLeft: 2 }, { scene: 1 }).tie;
        const r = applyStanceEvents(t, [up('gift', { delta: 0.1 })], ctx());
        expect(r.changes.map((c) => c.kind)).toEqual(['reason-stacked']);
        expect(r.tie.progress).toBeUndefined();
    });

    it('uses default and rounded durations', () => {
        const r = applyStanceEvents(
            tie(),
            [up('a', { delta: 0.2 }), up('b', { delta: 0.2, scenes: 0 }), up('c', { delta: 0.2, scenes: 4.6 })],
            ctx(),
        );
        expect(r.tie.reasons.map((x) => x.scenesLeft)).toEqual([3, 1, 5]);
    });
});

describe('onSceneEnd', () => {
    it('ticks reasons down and expires them', () => {
        const t = tie({
            reasons: [
                { id: 'a', text: 'tips', delta: 0.5, scenesLeft: 1, stacks: 0 },
                { id: 'b', text: 'debt', delta: -1, scenesLeft: null, stacks: 0 },
                { id: 'c', text: 'rude', delta: -0.3, scenesLeft: 3, stacks: 0 },
            ],
            progress: { dir: 1, items: [{ reason: 'a', scene: 1, delta: 0.5 }] },
            moved: { scene: 1, delta: 1 },
        });
        const r = onSceneEnd(t, { scene: 1, baseStance: 0 });
        expect(r.tie.reasons.map((x) => [x.id, x.scenesLeft])).toEqual([
            ['b', null],
            ['c', 2],
        ]);
        expect(r.tie.progress).toBeUndefined();
        expect(r.tie.moved).toBeUndefined();
        expect(r.changes).toEqual([
            { kind: 'reason-expired', target: PLAYER_ID, scene: 1, reason: 'a', text: 'tips', delta: 0.5 },
        ]);
        expect(t.reasons).toHaveLength(3);
    });

    it('keeps progress items whose reasons live on', () => {
        const t = tie({
            reasons: [{ id: 'a', text: 'helped', delta: 1, scenesLeft: 3, stacks: 0 }],
            progress: { dir: 1, items: [{ reason: 'a', scene: 1, delta: 1 }] },
        });
        expect(onSceneEnd(t, { scene: 1, baseStance: 0 }).tie.progress?.items).toHaveLength(1);
    });

    it('drifts one step toward the base when nothing holds the stance', () => {
        const r = onSceneEnd(tie({ stance: 2 }), { scene: 3, baseStance: -1 });
        expect(r.tie.stance).toBe(1);
        expect(r.changes).toEqual([{ kind: 'drift', target: PLAYER_ID, scene: 3, from: 2, to: 1 }]);
        expect(onSceneEnd(tie({ stance: -3 }), { scene: 3, baseStance: 0 }).tie.stance).toBe(-2);
    });

    it('holds the stance while live reasons justify it', () => {
        const held = tie({
            stance: -1,
            reasons: [
                { id: 'base', text: 'imperial', delta: -2, scenesLeft: null, stacks: 0 },
                { id: 'k', text: 'saved her daughter', delta: 1, scenesLeft: null, stacks: 0, key: true },
            ],
        });
        expect(onSceneEnd(held, { scene: 2, baseStance: -2 }).tie.stance).toBe(-1);
        const temp = tie({ stance: 1, reasons: [{ id: 't', text: 'helped', delta: 1, scenesLeft: 2, stacks: 0 }] });
        const first = onSceneEnd(temp, { scene: 1, baseStance: 0 });
        expect(first.tie.stance).toBe(1);
        const second = onSceneEnd(first.tie, { scene: 2, baseStance: 0 });
        expect(second.tie.stance).toBe(0);
        expect(second.changes.map((c) => c.kind)).toEqual(['reason-expired', 'drift']);
    });

    it('relaxes a two-step distance one step at a time', () => {
        const t = tie({ stance: 2, reasons: [{ id: 'p', text: 'key', delta: 1, scenesLeft: null, stacks: 0 }] });
        const once = onSceneEnd(t, { scene: 1, baseStance: 0 });
        expect(once.tie.stance).toBe(1);
        expect(onSceneEnd(once.tie, { scene: 2, baseStance: 0 }).tie.stance).toBe(1);
    });

    it('stays at the base', () => {
        const r = onSceneEnd(tie({ stance: -2 }), { scene: 1, baseStance: -2 });
        expect(r.tie.stance).toBe(-2);
        expect(r.changes).toEqual([]);
    });

    it('expires reasons with bad durations', () => {
        const t = tie({ reasons: [{ id: 'x', text: 'x', delta: 1, scenesLeft: 0, stacks: 0 }] });
        expect(onSceneEnd(t, { scene: 1, baseStance: 0 }).tie.reasons).toEqual([]);
    });
});

describe('capReasons', () => {
    it('keeps a long story’s tie bounded: the oldest permanent reasons of one direction merge, sums intact', () => {
        const reasons = Array.from({ length: MAX_REASONS + 4 }, (_, i) => ({
            id: `r${i}`,
            text: `deed ${i}`,
            delta: i % 2 ? -0.5 : 0.25,
            scenesLeft: null,
            stacks: 0,
            scene: i,
            ...(i === 0 ? { key: true } : {}),
        }));
        const before = tie({
            stance: -1,
            reasons,
            progress: { dir: -1, items: [{ reason: 'r3', scene: 3, delta: -0.5 }] },
        });
        const sum = (sign: number) =>
            before.reasons.filter((r) => Math.sign(r.delta) === sign).reduce((total, r) => total + r.delta, 0);
        const after = capReasons(before);
        expect(after.reasons).toHaveLength(MAX_REASONS);
        const total = (sign: number) =>
            after.reasons.filter((r) => Math.sign(r.delta) === sign).reduce((t, r) => t + r.delta, 0);
        expect(total(1)).toBeCloseTo(sum(1));
        expect(total(-1)).toBeCloseTo(sum(-1));
        // A key reason is never merged away; progress points at the reason that absorbed its own.
        expect(after.reasons.some((r) => r.id === 'r0' && r.key)).toBe(true);
        const ids = new Set(after.reasons.map((r) => r.id));
        expect(after.progress!.items.every((item) => ids.has(item.reason))).toBe(true);
        expect(capReasons(after)).toBe(after);
    });

    it('applies on every event', () => {
        let current = tie();
        for (let i = 0; i < MAX_REASONS + 10; i++) {
            current = applyStanceEvents(current, [down(`betrayal ${i}`, { permanent: true })], ctx({ scene: i })).tie;
        }
        expect(current.reasons.length).toBeLessThanOrEqual(MAX_REASONS);
    });
});
