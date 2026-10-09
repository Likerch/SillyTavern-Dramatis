// Stance changes with reasons and inertia (docs/model.md §4.3, §5.2). Pure rules over one Tie:
// the turn pass proposes events, these functions decide whether the stance actually moves.
//
// Inertia in short:
// - net change ≤ 1 step per scene (low inertia: 2);
// - a step up needs a key event or agreeing events (high: two reasons in different scenes, medium: two reasons,
//   low: one reason worth a full step);
// - a step down is easier (one −1 event), slower for forgiving characters (agreeableness ≥ +1 needs a second one);
// - repeats of the same reason weigh ×0.9 per repeat (RimWorld), so affection can't be farmed;
// - author bounds are never crossed except by an arc event, which is reported for the Inbox;
// - one event never moves more than one step (Versu: no silent flips);
// - temporary reasons expire and the stance drifts back to its base when nothing holds it away.
import type { Core, Level5, Reason, Stance, StanceBound, StanceProgress, Tie } from './model';
import type { DramatisSettings } from '../shared/contracts';
import { clamp, normalizeText, round3, uniqueId } from './util';

export type Inertia = DramatisSettings['inertia'];

export interface StanceBounds {
    min?: Stance;
    max?: Stance;
}

/** One event the turn pass found, aimed at this tie. */
export interface StanceEvent {
    /** Story words («ты сорвал ей поставку»). */
    text: string;
    /** Proposed stance contribution: ±1 for a real step, fractions for small things. */
    delta: number;
    /** Matches one of the character's keys: may step up at once. */
    key?: boolean;
    /** Never fades (a scar, a debt). */
    permanent?: boolean;
    /** Scenes before it fades (default 3). */
    scenes?: number;
    sourceMessage?: number;
    /** An arc event: may cross the author's bounds (the crossing is reported for the Inbox). */
    arc?: boolean;
}

export interface RelationContext {
    /** Current scene counter. */
    scene: number;
    inertia: Inertia;
    /** Author bounds resolved for this target (boundsFor). */
    bounds: StanceBounds;
    agreeableness: Level5;
    baseStance: Stance;
}

export type StanceChangeKind =
    | 'reason-added'
    | 'reason-stacked'
    | 'reason-expired'
    /** Delta beyond one step was asked for: treated as one step. */
    | 'clamped'
    /** Not enough agreeing events yet: kept as progress. */
    | 'pending'
    | 'held-cap'
    | 'held-bound'
    | 'step'
    /** A step across an author bound made by an arc event: route to the Inbox. */
    | 'arc-crossing'
    | 'drift';

/** Structured log line (no prose): callers turn these into StateEvents. */
export interface StanceChange {
    kind: StanceChangeKind;
    target: string;
    scene: number;
    /** Reason id. */
    reason?: string;
    text?: string;
    /** Effective delta of the reason, or the asked delta for 'clamped'. */
    delta?: number;
    from?: Stance;
    to?: Stance;
}

export interface ReasonInput {
    text: string;
    delta: number;
    /** null = permanent. */
    scenesLeft: number | null;
    key?: boolean;
    sourceMessage?: number;
}

export const STACK_FACTOR = 0.9;
/** Repeats beyond this add nothing but refresh the reason's duration. */
export const MAX_STACKS = 10;
export const DEFAULT_REASON_SCENES = 3;
/** Keeps progress short: old items fall off when a direction keeps being blocked. */
const MAX_PROGRESS_ITEMS = 8;

/** Max net steps in one scene. */
export const SCENE_CAP: Record<Inertia, number> = { high: 1, medium: 1, low: 2 };

/** What a step down needs, by agreeableness: unforgiving people fall on less, forgiving ones need two events. */
export const DOWN_NEED: Record<Level5, { sum: number; events: number }> = {
    [-2]: { sum: 0.5, events: 1 },
    [-1]: { sum: 0.75, events: 1 },
    0: { sum: 1, events: 1 },
    1: { sum: 1, events: 2 },
    2: { sum: 1, events: 2 },
};

/** A single event this heavy steps down at once, whatever the temperament. */
const SEVERE_DOWN = 2;

/** Effective weight of a repeat: the n-th repeat counts delta × 0.9ⁿ. */
export function stackFactor(stacks: number): number {
    return STACK_FACTOR ** Math.max(0, stacks);
}

/** One step from `stance` in `dir`, staying on the ladder. */
export function stepStance(stance: Stance, dir: 1 | -1): Stance {
    return clamp(stance + dir, -3, 3) as Stance;
}

/**
 * Author bounds toward one target. Specific beats general: a bound naming the target id wins over class bounds,
 * class bounds over '*'. Several bounds on one level combine to the strictest. If floor and ceiling still cross,
 * the ceiling wins (it is the anti-sycophancy guard).
 */
export function boundsFor(bounds: StanceBound[], targetId: string, targetClasses: string[] = []): StanceBounds {
    const id = normalizeText(targetId);
    const classes = new Set(targetClasses.map(normalizeText));
    const level = (b: StanceBound): number => {
        const t = normalizeText(b.target);
        if (b.target === targetId || (t !== '' && t === id)) return 2;
        if (classes.has(t)) return 1;
        if (b.target.trim() === '*') return 0;
        return -1;
    };
    const result: StanceBounds = {};
    for (const field of ['min', 'max'] as const) {
        let bestLevel = -1;
        let value: Stance | undefined;
        for (const bound of bounds) {
            const v = bound[field];
            const lv = level(bound);
            if (v === undefined || lv < 0 || lv < bestLevel) continue;
            if (lv > bestLevel || value === undefined) {
                bestLevel = lv;
                value = v;
            } else {
                value = (field === 'min' ? Math.max(value, v) : Math.min(value, v)) as Stance;
            }
        }
        if (value !== undefined) result[field] = value;
    }
    if (result.min !== undefined && result.max !== undefined && result.min > result.max) result.min = result.max;
    return result;
}

/** Builds the context for one tie from the character's core and the levers. */
export function relationContext(input: {
    core: Pick<Core, 'stanceBounds' | 'temperament'>;
    targetId: string;
    targetClasses?: string[];
    scene: number;
    inertia: Inertia;
    baseStance: Stance;
}): RelationContext {
    return {
        scene: input.scene,
        inertia: input.inertia,
        bounds: boundsFor(input.core.stanceBounds, input.targetId, input.targetClasses),
        agreeableness: input.core.temperament.agreeableness ?? 0,
        baseStance: input.baseStance,
    };
}

function nextReasonId(tie: Tie, scene: number): string {
    return uniqueId(
        `r${scene}`,
        tie.reasons.map((r) => r.id),
    );
}

/**
 * Adds a reason, merging a repeat (same normalised text, same sign) into the existing one: stacks + 1, and the
 * repeat adds delta × 0.9^stacks. Duration refreshes (permanent wins). Returns the effective delta of this call.
 */
export function addReason(
    tie: Tie,
    input: ReasonInput,
    ctx: { scene: number },
): { tie: Tie; reason: Reason; effective: number; stacked: boolean } {
    const delta = clamp(Number.isFinite(input.delta) ? input.delta : 0, -3, 3);
    const norm = normalizeText(input.text);
    const index = tie.reasons.findIndex(
        (r) => normalizeText(r.text) === norm && Math.sign(r.delta) === Math.sign(delta) && delta !== 0,
    );
    if (index < 0) {
        const reason: Reason = {
            id: nextReasonId(tie, ctx.scene),
            text: input.text.trim(),
            delta: round3(delta),
            scenesLeft: input.scenesLeft,
            stacks: 0,
            scene: ctx.scene,
        };
        if (input.key) reason.key = true;
        if (input.sourceMessage !== undefined) reason.sourceMessage = input.sourceMessage;
        return { tie: { ...tie, reasons: [...tie.reasons, reason] }, reason, effective: reason.delta, stacked: false };
    }
    const old = tie.reasons[index]!;
    const stacks = Math.min(MAX_STACKS, old.stacks + 1);
    const effective = old.stacks >= MAX_STACKS ? 0 : round3(delta * stackFactor(stacks));
    const scenesLeft =
        old.scenesLeft === null || input.scenesLeft === null ? null : Math.max(old.scenesLeft, input.scenesLeft);
    const reason: Reason = { ...old, delta: round3(old.delta + effective), stacks, scenesLeft };
    if (input.key) reason.key = true;
    if (input.sourceMessage !== undefined) reason.sourceMessage = input.sourceMessage;
    const reasons = tie.reasons.slice();
    reasons[index] = reason;
    return { tie: { ...tie, reasons }, reason, effective, stacked: true };
}

/** Whether the progress items add up to one step under the given rules. */
export function progressReady(progress: StanceProgress, inertia: Inertia, agreeableness: Level5): boolean {
    const items = progress.items;
    if (items.some((i) => i.key)) return true;
    const sum = items.reduce((s, i) => s + Math.abs(i.delta), 0);
    const reasons = new Set(items.map((i) => i.reason)).size;
    if (progress.dir > 0) {
        if (sum < 1 - 1e-9) return false;
        if (inertia === 'low') return true;
        if (reasons < 2) return false;
        return inertia === 'medium' || new Set(items.map((i) => i.scene)).size >= 2;
    }
    if (items.some((i) => Math.abs(i.delta) >= SEVERE_DOWN)) return true;
    const need = DOWN_NEED[agreeableness] ?? DOWN_NEED[0];
    return sum >= need.sum - 1e-9 && reasons >= need.events;
}

function outOfBounds(next: Stance, dir: 1 | -1, bounds: StanceBounds): boolean {
    if (dir > 0) return bounds.max !== undefined && next > bounds.max;
    return bounds.min !== undefined && next < bounds.min;
}

/**
 * Applies the turn's events to one tie: records reasons, accumulates progress and makes at most the allowed steps.
 * Events with zero/garbage delta or empty text are ignored.
 */
export function applyStanceEvents(
    tie: Tie,
    events: StanceEvent[],
    ctx: RelationContext,
): { tie: Tie; changes: StanceChange[] } {
    let cur: Tie = tie;
    const changes: StanceChange[] = [];
    const base = { target: tie.target, scene: ctx.scene };
    for (const event of events) {
        if (!Number.isFinite(event.delta) || event.delta === 0) continue;
        if (typeof event.text !== 'string' || !event.text.trim()) continue;
        if (Math.abs(event.delta) > 1) changes.push({ ...base, kind: 'clamped', text: event.text, delta: event.delta });
        const scenesLeft = event.permanent ? null : reasonScenes(event.scenes);
        const added = addReason(
            cur,
            { text: event.text, delta: event.delta, scenesLeft, key: event.key, sourceMessage: event.sourceMessage },
            ctx,
        );
        cur = added.tie;
        changes.push({
            ...base,
            kind: added.stacked ? 'reason-stacked' : 'reason-added',
            reason: added.reason.id,
            text: added.reason.text,
            delta: added.effective,
        });
        if (added.effective === 0) continue;

        const dir: 1 | -1 = added.effective > 0 ? 1 : -1;
        const prev = cur.progress?.dir === dir ? cur.progress.items : [];
        const item = {
            reason: added.reason.id,
            scene: ctx.scene,
            delta: added.effective,
            ...(event.key ? { key: true } : {}),
        };
        const progress: StanceProgress = { dir, items: [...prev, item].slice(-MAX_PROGRESS_ITEMS) };
        cur = { ...cur, progress };
        const ref = { reason: added.reason.id, text: added.reason.text };

        if (!progressReady(progress, ctx.inertia, ctx.agreeableness)) {
            changes.push({ ...base, ...ref, kind: 'pending', delta: added.effective });
            continue;
        }
        const next = stepStance(cur.stance, dir);
        if (next === cur.stance) {
            // Already at the end of the ladder: nothing left to accumulate toward.
            cur = withoutProgress(cur);
            continue;
        }
        const moved = cur.moved?.scene === ctx.scene ? cur.moved.delta : 0;
        if (Math.abs(moved + dir) > SCENE_CAP[ctx.inertia]) {
            changes.push({ ...base, ...ref, kind: 'held-cap', from: cur.stance });
            continue;
        }
        const crossing = outOfBounds(next, dir, ctx.bounds);
        if (crossing && !event.arc) {
            changes.push({ ...base, ...ref, kind: 'held-bound', from: cur.stance });
            continue;
        }
        changes.push({ ...base, ...ref, kind: crossing ? 'arc-crossing' : 'step', from: cur.stance, to: next });
        cur = withoutProgress({ ...cur, stance: next, moved: { scene: ctx.scene, delta: moved + dir } });
    }
    return { tie: cur, changes };
}

function reasonScenes(scenes: number | undefined): number {
    const value = scenes !== undefined && Number.isFinite(scenes) ? scenes : DEFAULT_REASON_SCENES;
    return Math.max(1, Math.round(value));
}

function withoutProgress(tie: Tie): Tie {
    const next = { ...tie };
    delete next.progress;
    return next;
}

/**
 * Scene end for one tie: temporary reasons tick down and expire, the per-scene cap resets, and the stance drifts one
 * step toward its base unless live reasons pointing away from the base still justify the distance
 * (Σ|delta| of away-pointing reasons ≥ distance − 0.5, i.e. rounded).
 */
export function onSceneEnd(
    tie: Tie,
    ctx: Pick<RelationContext, 'scene' | 'baseStance'>,
): { tie: Tie; changes: StanceChange[] } {
    const changes: StanceChange[] = [];
    const base = { target: tie.target, scene: ctx.scene };
    const reasons: Reason[] = [];
    for (const reason of tie.reasons) {
        if (reason.scenesLeft === null) {
            reasons.push(reason);
            continue;
        }
        const left = reason.scenesLeft - 1;
        if (left > 0) {
            reasons.push({ ...reason, scenesLeft: left });
            continue;
        }
        changes.push({ ...base, kind: 'reason-expired', reason: reason.id, text: reason.text, delta: reason.delta });
    }
    const alive = new Set(reasons.map((r) => r.id));
    const items = tie.progress?.items.filter((i) => alive.has(i.reason)) ?? [];
    let next: Tie = { ...tie, reasons };
    delete next.moved;
    delete next.progress;
    if (tie.progress && items.length > 0) next.progress = { dir: tie.progress.dir, items };

    const distance = next.stance - ctx.baseStance;
    if (distance !== 0) {
        const away = Math.sign(distance);
        const hold = reasons.filter((r) => Math.sign(r.delta) === away).reduce((s, r) => s + Math.abs(r.delta), 0);
        if (hold < Math.abs(distance) - 0.5) {
            const to = stepStance(next.stance, away > 0 ? -1 : 1);
            changes.push({ ...base, kind: 'drift', from: next.stance, to });
            next = { ...next, stance: to };
        }
    }
    return { tie: next, changes };
}

/** Net stance movement in a change log (steps, arc crossings and drift). */
export function netStanceChange(changes: StanceChange[]): number {
    return changes.reduce((s, c) => (c.from !== undefined && c.to !== undefined ? s + (c.to - c.from) : s), 0);
}
