// Scheme clocks (docs/model.md §5.7 «Замысел», docs/research/appetites.md D5, CK3 hostile schemes).
// A scheme is a coarse method that needs preparation: a clock of 4–8 segments, secrecy with breaches,
// and an attempt scene whose outcome depends on the world state at that moment, not on plot convenience.
import type { Rng } from '../shared/contracts';
import type { Scheme } from './model';
import { clamp, clamp01 } from './util';

export const MIN_SEGMENTS = 4;
export const MAX_SEGMENTS = 8;
/** Breaches that burn a scheme. */
export const MAX_BREACHES = 5;
/** Finished schemes (done, failed, exposed) a chat keeps: the latest ones, for the sheet and the story. */
export const MAX_FINISHED_SCHEMES = 30;
/** Accomplices add at most this much progress per interval. */
export const ACCOMPLICE_CAP = 3;
/** Attempt odds bounds (CK3 caps success at 85%). */
export const MIN_ATTEMPT = 0.05;
export const MAX_ATTEMPT = 0.85;

export interface StartSchemeInput {
    id: string;
    owner: string;
    target: string;
    appetite?: string;
    /** Ladder step of the method (0–8). */
    method: number;
    /** Short English description of the plan («cut her wagon off at the ford at dusk»). */
    text: string;
    /** Target's capacity to resist, 0–3. */
    inertia: number;
    /** Strength of the target's guardians, 0–3. */
    guardians: number;
    accomplices?: string[];
    /** 0–100; default from method and accomplices. */
    secrecy?: number;
    turn: number;
}

/** Segments by how hard the target is: 4 for the helpless and unguarded, 8 for the formidable and guarded. */
export function schemeSegments(inertia: number, guardians: number): number {
    const hardness = clamp(inertia, 0, 3) + clamp(guardians, 0, 3);
    return clamp(MIN_SEGMENTS + Math.ceil((hardness * 2) / 3), MIN_SEGMENTS, MAX_SEGMENTS);
}

/** Default secrecy: every accomplice is another mouth; quiet methods (deceit) are easier to hide than force. */
export function defaultSecrecy(method: number, accomplices: number): number {
    return clamp(80 - 10 * accomplices + (method <= 5 ? 10 : 0), 10, 95);
}

export function startScheme(input: StartSchemeInput): Scheme {
    const accomplices = [...(input.accomplices ?? [])];
    const scheme: Scheme = {
        id: input.id,
        owner: input.owner,
        target: input.target,
        method: clamp(Math.round(input.method), 0, 8),
        text: input.text,
        clock: { segments: schemeSegments(input.inertia, input.guardians), filled: 0 },
        secrecy: clamp(Math.round(input.secrecy ?? defaultSecrecy(input.method, accomplices.length)), 0, 100),
        breaches: 0,
        accomplices,
        state: 'running',
        startedTurn: input.turn,
    };
    if (input.appetite !== undefined) scheme.appetite = input.appetite;
    return scheme;
}

export interface SchemeTickInput {
    /** The interval offered a chance to advance (the target passed by, the guard was drunk). */
    opportunity: boolean;
    /** Accomplices working this interval (default: all of them). */
    accomplices?: number;
    /** Someone close to the target helps (a servant, a spouse). */
    insider?: boolean;
    /** The target is guarded or paranoid this interval. */
    guarded?: boolean;
    /** Someone stumbled on it in a dramatic way: exposed at once. */
    discovered?: boolean;
    /** Off-screen intervals covered by this tick (default 1). */
    intervals?: number;
}

export type SchemeNote = 'progress' | 'breach' | 'exposed' | 'ready';

export interface SchemeTick {
    scheme: Scheme;
    progressed: number;
    breaches: number;
    notes: SchemeNote[];
}

/** Breach chance per interval: one tenth of the missing secrecy, in percent (CK3). */
export function breachChance(secrecy: number): number {
    return clamp01((100 - clamp(secrecy, 0, 100)) / 1000);
}

/**
 * Advances a running scheme: per interval +1 with opportunity, +1 per accomplice (capped), +1 insider,
 * −1 guarded (never below 0); each interval may breach. 5 breaches or a dramatic discovery → exposed;
 * a full clock → ready. Other states are returned unchanged.
 */
export function tickScheme(scheme: Scheme, input: SchemeTickInput, rng: Rng): SchemeTick {
    const notes: SchemeNote[] = [];
    if (scheme.state !== 'running') return { scheme, progressed: 0, breaches: 0, notes };
    if (input.discovered) {
        return { scheme: { ...scheme, state: 'exposed' }, progressed: 0, breaches: 0, notes: ['exposed'] };
    }
    const helpers = clamp(input.accomplices ?? scheme.accomplices.length, 0, ACCOMPLICE_CAP);
    const perInterval = Math.max(
        0,
        (input.opportunity ? 1 : 0) + helpers + (input.insider ? 1 : 0) - (input.guarded ? 1 : 0),
    );
    const intervals = Math.max(1, Math.floor(input.intervals ?? 1));
    let filled = scheme.clock.filled;
    let breaches = scheme.breaches;
    let newBreaches = 0;
    let state: Scheme['state'] = 'running';
    const chance = breachChance(scheme.secrecy);
    for (let i = 0; i < intervals && state === 'running'; i++) {
        filled = Math.min(scheme.clock.segments, filled + perInterval);
        if (rng() < chance) {
            breaches += 1;
            newBreaches += 1;
        }
        if (breaches >= MAX_BREACHES) state = 'exposed';
        else if (filled >= scheme.clock.segments) state = 'ready';
    }
    const progressed = filled - scheme.clock.filled;
    if (progressed > 0) notes.push('progress');
    if (newBreaches > 0) notes.push('breach');
    if (state === 'exposed') notes.push('exposed');
    if (state === 'ready') notes.push('ready');
    return {
        scheme: { ...scheme, clock: { ...scheme.clock, filled }, breaches, state },
        progressed,
        breaches: newBreaches,
        notes,
    };
}

export interface AttemptInput {
    /** Guardians at the scene, 0–3 (the hero's sword, a chaperone, a jealous rival). */
    guardians: number;
    /** The target's allies at hand, 0–3. */
    allies?: number;
    /** The target's caution, 0–3 (the player's vigilance). */
    caution: number;
    /** The schemer's capability, 0–3. */
    capability: number;
    /** Accomplices taking part (default: all of the scheme's). */
    accomplices?: number;
    /** The target was warned (a breach reached them, a rumour). */
    warned?: boolean;
}

export type AttemptReason = 'success' | 'guarded' | 'caution' | 'warned' | 'outmatched' | 'rushed' | 'caught';

export interface AttemptResult {
    scheme: Scheme;
    outcome: 'done' | 'failed' | 'exposed';
    reason: AttemptReason;
    /** Success odds the roll was made against. */
    chance: number;
}

/**
 * The attempt scene (§5.7 «Полные часы — сцена-попытка»). Odds come from the world: capability and helpers
 * against guardians, allies, caution and warnings; rushing an unfinished clock costs 0.1 per missing segment.
 * A failure can expose the scheme (lower secrecy, guardians on the spot).
 */
export function resolveAttempt(scheme: Scheme, world: AttemptInput, rng: Rng): AttemptResult {
    const helpers = clamp(world.accomplices ?? scheme.accomplices.length, 0, 2);
    const missing = Math.max(0, scheme.clock.segments - scheme.clock.filled);
    const penalties: [AttemptReason, number][] = [
        ['guarded', 0.12 * (clamp(world.guardians, 0, 3) + clamp(world.allies ?? 0, 0, 3))],
        ['caution', 0.1 * clamp(world.caution, 0, 3)],
        ['warned', world.warned ? 0.2 : 0],
        ['rushed', 0.1 * missing],
        ['warned', 0.03 * scheme.breaches],
    ];
    const bonus = 0.1 * (clamp(world.capability, 0, 3) + helpers);
    const chance = clamp(0.6 + bonus - penalties.reduce((sum, [, p]) => sum + p, 0), MIN_ATTEMPT, MAX_ATTEMPT);

    if (rng() < chance) {
        return { scheme: { ...scheme, state: 'done' }, outcome: 'done', reason: 'success', chance };
    }
    const exposure = clamp01((100 - scheme.secrecy) / 100 + (world.guardians > 0 ? 0.2 : 0));
    if (rng() < exposure) {
        return { scheme: { ...scheme, state: 'exposed' }, outcome: 'exposed', reason: 'caught', chance };
    }
    // The biggest penalty names the failure; with none, the target was simply stronger.
    const [reason, worst] = penalties.reduce((a, b) => (b[1] > a[1] ? b : a));
    return {
        scheme: { ...scheme, state: 'failed' },
        outcome: 'failed',
        reason: worst > 0 ? reason : 'outmatched',
        chance,
    };
}

/** Drops the oldest finished schemes beyond MAX_FINISHED_SCHEMES; running and ready ones always stay. */
export function pruneSchemes(schemes: Scheme[]): Scheme[] {
    const finished = schemes.filter((scheme) => scheme.state !== 'running' && scheme.state !== 'ready');
    if (finished.length <= MAX_FINISHED_SCHEMES) return schemes;
    const drop = new Set(finished.slice(0, finished.length - MAX_FINISHED_SCHEMES));
    return schemes.filter((scheme) => !drop.has(scheme));
}
