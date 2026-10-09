// When the world moves by itself (docs/model.md §11 «Тик мира», §12 «Мир»; research B13 faction turns): every N
// committed turns (Maestro's offscreen pace: 15 balanced, 10 cinema, 30 economy), on a scene change, and on a time
// skip by the DES clock — the longer the skip, the more ticks (one per 8 in-world hours, at most 3). The first turns of
// a chat never tick: the story has not started moving yet. Pure: the readings come from the world module.
import type { Mode } from '../shared/contracts';
import { elapsedHours, sceneBreak } from './scene';
import type { SceneBreak, SceneMark } from './scene';

/** Committed turns between interval ticks, by mode. */
export const TICK_INTERVAL: Readonly<Record<Mode, number>> = { economy: 30, balanced: 15, cinema: 10 };

/** No tick while the chat has this many committed turns or fewer. */
export const WARMUP_TURNS = 3;

/** One tick per this many in-world hours of a time skip. */
export const HOURS_PER_TICK = 8;

/** Ticks one reading can trigger at most. */
export const MAX_TICKS = 3;

/** A date that changed but cannot be counted ("Monday" → "Tuesday") counts as a day. */
export const UNCOUNTED_DAY_HOURS = 24;

/** The world as seen at one moment: the committed turn counter and the DES scene. */
export interface WorldReading {
    turn: number;
    mark: SceneMark;
}

export interface TicksDueContext {
    mode: Mode;
    /** Interval override in turns (settings); 0 or absent = by mode. */
    interval?: number;
    /** Scene-break threshold in hours (default: scene.SCENE_SKIP_HOURS). */
    sceneHours?: number;
}

export type TickReason = 'none' | 'warmup' | 'interval' | 'scene' | 'time';

export interface TicksDue {
    ticks: number;
    /** Why (the strongest cause when several apply). */
    reason: TickReason;
    /** In-world hours since the previous reading, when they could be computed. */
    hours?: number;
    /** The scene break, when there was one. */
    sceneBreak?: SceneBreak;
}

/** Turns between interval ticks: the override when positive, else the mode's pace. */
export function tickInterval(mode: Mode, override?: number): number {
    if (override !== undefined && Number.isFinite(override) && override >= 1) return Math.round(override);
    return TICK_INTERVAL[mode] ?? TICK_INTERVAL.balanced;
}

/**
 * Ticks due between the reading of the last tick (`prev`) and now (`next`). A time skip gives one tick per 8 hours
 * (at least one for any scene break), the interval one tick; they do not add up — the larger wins — and never exceed
 * three. Nothing during the first three turns of a chat.
 */
export function ticksDue(prev: WorldReading, next: WorldReading, ctx: TicksDueContext): TicksDue {
    const known = elapsedHours(prev.mark, next.mark);
    const hoursPart = known !== undefined ? { hours: known } : {};
    if (next.turn <= WARMUP_TURNS) return { ticks: 0, reason: 'warmup', ...hoursPart };

    const brk = sceneBreak(prev.mark, next.mark, ctx.sceneHours !== undefined ? { hours: ctx.sceneHours } : {});
    let ticks = 0;
    let reason: TickReason = 'none';
    let hours = known;
    if (brk) {
        if (brk.hours === undefined && brk.reason === 'date') hours = UNCOUNTED_DAY_HOURS;
        const skip = Math.floor((hours ?? 0) / HOURS_PER_TICK);
        ticks = Math.max(1, Math.min(MAX_TICKS, skip));
        reason = skip >= 1 ? 'time' : 'scene';
    }
    const elapsedTurns = next.turn - prev.turn;
    if (ticks === 0 && elapsedTurns >= tickInterval(ctx.mode, ctx.interval)) {
        ticks = 1;
        reason = 'interval';
    }
    const result: TicksDue = { ticks: Math.min(MAX_TICKS, ticks), reason };
    if (hours !== undefined) result.hours = hours;
    if (brk) result.sceneBreak = brk;
    return result;
}
