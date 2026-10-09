// Appetite pressure dynamics (docs/model.md §5.7 «Как меняется напор», docs/research/appetites.md D1).
// One tick per scene or per in-world time step. Pressure is *wanting*, not liking (Berridge & Robinson):
// it grows with time, cues and stress, falls with satisfaction, and never feeds stance.
import type { DramatisSettings } from '../shared/contracts';
import { PRESSURE_WORDS } from './model';
import type { Appetite, AppetiteKind, AppetiteState, Scale3, Scale5 } from './model';

export type AppetiteStrength = DramatisSettings['appetiteStrength'];
export type PressureWord = (typeof PRESSURE_WORDS)[number];

/** Kinds that stress and negative mood feed (coping appetites: CK3, Marlatt, Koob). */
export const COPING_KINDS: readonly AppetiteKind[] = ['drink', 'food', 'substance', 'thrill', 'luxury'];

/** Opportunity (0–1) at or above which a chance counts as «good». */
export const GOOD_OPPORTUNITY = 0.6;

/** Cues add at most this much pressure per scene. */
export const CUE_CAP = 2;

/** A satisfaction at or above this pressure is «on edge» (feeds sensitization and tolerance). */
export const EDGE_PRESSURE = 4;

/** Edge satisfactions for +1 tolerance and for +1 sensitization (the counter resets after the latter). */
export const EDGES_FOR_TOLERANCE = 2;
export const EDGES_FOR_SENSITIZATION = 3;

/** Days without satisfaction before withdrawal starts, by dependence. */
export const WITHDRAWAL_DAYS: Readonly<Record<1 | 2 | 3, number>> = { 1: 3, 2: 2, 3: 1 };

/** Turns without satisfaction before withdrawal starts when the story gives no in-world time. */
export const WITHDRAWAL_TURNS = 40;

/** Tolerance fades by 1 per this many days without satisfaction (weeks of abstinence). */
export const TOLERANCE_FADE_DAYS = 14;

/* ------------------------------------------------------------------ small helpers */

export function clampInt(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.round(value)));
}

export function toScale5(value: number): Scale5 {
    return clampInt(value, 0, 5) as Scale5;
}

export function toScale3(value: number): Scale3 {
    return clampInt(value, 0, 3) as Scale3;
}

/** The «appetite strength» lever as a shift of baseline and drift (§14). */
export function strengthShift(strength: AppetiteStrength): number {
    return strength === 'muted' ? -1 : strength === 'sharp' ? 1 : 0;
}

/** Baseline after the lever. A baseline of 0 stays 0: the lever never wakes a dormant appetite. */
export function effectiveBaseline(baseline: number, strength: AppetiteStrength): Scale5 {
    if (baseline <= 0) return 0;
    return toScale5(baseline + strengthShift(strength));
}

/** How pressure grows by itself for a kind when the author did not say (§5.7 point 1). */
export function defaultDrift(kind: AppetiteKind): Appetite['drift'] {
    switch (kind) {
        case 'hunger':
        case 'food':
        case 'drink':
        case 'substance':
            return 'daily';
        case 'other':
            return 'none';
        default:
            return 'opportunity';
    }
}

/* ------------------------------------------------------------------ the tick */

export interface AppetiteEvents {
    /** Cues met this scene (true = one). */
    cue?: boolean | number;
    /** The scene was idle or ruminating after a cue: elaboration (Kavanagh). Busy scenes pass false. */
    idleAfterCue?: boolean;
    /** The appetite was satisfied this scene. `full` = the act that brings pressure to 0. */
    satisfied?: { amount: number; full?: boolean };
    /** Stress, anger or a negative mood this scene. */
    stress?: boolean;
    intoxicated?: boolean;
    /** Another appetite of the same character is at 4+ (an amplifier). */
    otherAppetiteHigh?: boolean;
    hoursPassed?: number;
    daysPassed?: number;
    /** The appetite's season (heat, festival, moon) is on. */
    seasonActive?: boolean;
    /** At a lapse: an anchor or coping support is present, so the abstainer recommits instead of bingeing. */
    support?: boolean;
}

export interface AppetiteTickContext {
    turn: number;
    strength: AppetiteStrength;
    /** Override of WITHDRAWAL_TURNS. */
    withdrawalTurns?: number;
}

export type AppetiteNote =
    | 'binge'
    | 'drift'
    | 'season'
    | 'decay'
    | 'tolerance-fade'
    | 'cue'
    | 'elaboration'
    | 'stress'
    | 'sated'
    | 'edge'
    | 'tolerance-up'
    | 'sensitized'
    | 'lapse'
    | 'recommit'
    | 'withdrawal'
    | 'withdrawal-end';

export interface AppetiteTick {
    state: AppetiteState;
    /** Change to apply to the character's self-control reserve (withdrawal onset −1). */
    selfControlDelta: number;
    /** Relief mode in withdrawal: short horizon, readiness for coarse methods (method urgency +1). */
    mode: 'normal' | 'relief';
    /** What happened, in order, for the story log. */
    notes: AppetiteNote[];
}

function cueCount(cue: AppetiteEvents['cue']): number {
    if (cue === true) return 1;
    if (typeof cue === 'number' && cue > 0) return Math.floor(cue);
    return 0;
}

function elapsedDays(events: AppetiteEvents): number {
    const days = Math.max(0, events.daysPassed ?? 0) + Math.max(0, events.hoursPassed ?? 0) / 24;
    return Math.floor(days);
}

/** Daily drift per day: strong appetites climb twice as fast. */
function driftRate(baseline: number): number {
    return baseline >= 4 ? 2 : 1;
}

/**
 * Advances one appetite by one tick (§5.7 points 1–8). Order: pending binge, time (drift / decay / tolerance fade),
 * cue, elaboration, stress, satisfaction (edges, lapse), withdrawal. Returns a new state; the input is untouched.
 */
export function tickAppetite(
    appetite: Appetite,
    state: AppetiteState,
    events: AppetiteEvents,
    ctx: AppetiteTickContext,
): AppetiteTick {
    const notes: AppetiteNote[] = [];
    let pressure: number = state.pressure;
    let tolerance: number = state.tolerance;
    let sensitization: number = state.sensitization;
    let edgeCount = state.edgeCount;
    let withdrawal = state.withdrawal;
    let lastSated = state.lastSated;
    let lapsed = false;
    let selfControlDelta = 0;

    const b = effectiveBaseline(appetite.baseline, ctx.strength);
    const days = elapsedDays(events);
    const cues = cueCount(events.cue);
    const prevUnsated = state.daysUnsated ?? 0;
    let daysUnsated = prevUnsated + days;

    // 1. Abstinence violation effect: an unsupported lapse turns into a binge one tick later (Marlatt).
    const binge = state.lapsed === true;
    if (binge) {
        pressure = 5;
        notes.push('binge');
    }

    // 2. Time: daily kinds (and seasonal ones in season) climb; the rest cool down without cues.
    const inSeason = appetite.drift === 'seasonal' && events.seasonActive === true;
    const drifting = appetite.drift === 'daily' || inSeason;
    if (drifting && days > 0 && b > 0) {
        pressure += days * driftRate(b);
        notes.push('drift');
    }
    if (inSeason && pressure < b) {
        pressure = b;
        notes.push('season');
    }
    if (!drifting && days > 0 && cues === 0 && pressure > 0) {
        pressure -= days;
        notes.push('decay');
    }
    const fades = Math.floor(daysUnsated / TOLERANCE_FADE_DAYS) - Math.floor(prevUnsated / TOLERANCE_FADE_DAYS);
    if (fades > 0 && tolerance > 0) {
        tolerance = Math.max(0, tolerance - fades);
        notes.push('tolerance-fade');
    }

    // 3. Cue: +1, +1 more when sensitized or amplified; capped per scene.
    if (cues > 0) {
        const amplified =
            sensitization >= 2 ||
            events.stress === true ||
            events.intoxicated === true ||
            events.otherAppetiteHigh === true;
        pressure += Math.min(CUE_CAP, cues + (amplified ? 1 : 0));
        notes.push('cue');
    }

    // 4. Elaboration: idle rumination after a cue (busy scenes compete for working memory).
    if (events.idleAfterCue) {
        pressure += 1;
        notes.push('elaboration');
    }

    // 5. Stress feeds the coping kinds.
    if (events.stress && COPING_KINDS.includes(appetite.kind)) {
        pressure += 1;
        notes.push('stress');
    }

    pressure = clampInt(pressure, 0, 5);

    // 6. Satisfaction: minus the dose after tolerance; edges build sensitization and tolerance.
    const sated = events.satisfied;
    if (sated) {
        const before = pressure;
        if (sated.full) {
            pressure = 0;
        } else {
            pressure -= Math.max(1, Math.round(sated.amount) - tolerance);
            // Special hunger: only the «full» act reaches zero (V5 slaking floor).
            if (appetite.kind === 'hunger') pressure = Math.max(Math.min(before, 1), pressure);
        }
        pressure = Math.max(0, pressure);
        lastSated = ctx.turn;
        daysUnsated = 0;
        notes.push('sated');
        if (withdrawal) {
            withdrawal = false;
            notes.push('withdrawal-end');
        }
        if (before >= EDGE_PRESSURE) {
            edgeCount += 1;
            notes.push('edge');
            if (edgeCount === EDGES_FOR_TOLERANCE && tolerance < 3) {
                tolerance += 1;
                notes.push('tolerance-up');
            }
            if (edgeCount >= EDGES_FOR_SENSITIZATION) {
                edgeCount = 0;
                if (sensitization < 3) {
                    sensitization += 1;
                    notes.push('sensitized');
                }
            }
        }
        // A lapse of the abstinent: support → recommit, else «already failed» → binge next tick.
        // Satisfying during the binge itself does not re-trigger the effect.
        if (appetite.vow === 'abstinent' && !binge) {
            notes.push('lapse');
            if (events.support) {
                pressure = 1;
                notes.push('recommit');
            } else {
                lapsed = true;
            }
        }
    }

    // 7. Withdrawal: dependence plus a long time unsated sets a pressure floor and costs self-control.
    const dependence = state.dependence;
    if (!sated && dependence > 0 && !withdrawal) {
        const turnsSince = ctx.turn - lastSated;
        const dayLimit = WITHDRAWAL_DAYS[dependence as 1 | 2 | 3];
        if (daysUnsated >= dayLimit || turnsSince >= (ctx.withdrawalTurns ?? WITHDRAWAL_TURNS)) {
            withdrawal = true;
            selfControlDelta = -1;
            notes.push('withdrawal');
        }
    }
    if (withdrawal) pressure = Math.max(pressure, Math.min(5, dependence + 2));

    return {
        state: {
            ...state,
            pressure: toScale5(pressure),
            tolerance: toScale3(tolerance),
            sensitization: toScale3(sensitization),
            lastSated,
            edgeCount,
            withdrawal,
            lapsed,
            daysUnsated,
        },
        selfControlDelta,
        mode: withdrawal ? 'relief' : 'normal',
        notes,
    };
}

/* ------------------------------------------------------------------ words and the act gate */

/** Pressure as a word for the prompt (§4.5 ladder); the model never sees the number. */
export function pressureWord(pressure: number): PressureWord {
    return PRESSURE_WORDS[clampInt(pressure, 0, 5)] as PressureWord;
}

/**
 * Wanting is not yet doing (Hofmann: resisted desires are enacted ~17% of the time). The appetite acts this scene
 * only at «preoccupied» or above, or at «present» with a good chance; otherwise it shows as background.
 */
export function actGate(pressure: number, opportunity: number | boolean): boolean {
    if (pressure >= 3) return true;
    const good = typeof opportunity === 'boolean' ? opportunity : opportunity >= GOOD_OPPORTUNITY;
    return pressure >= 2 && good;
}
