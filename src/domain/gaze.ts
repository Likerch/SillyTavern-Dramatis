// Gaze: how A sees B as an object of appetite (docs/model.md §4.5 «Желанность и взгляд», research D2–D3, Nussbaum).
// Gaze drifts toward the object with corruption, culture, justifications and heat; back toward the person with
// warm stance events, agency the character has to acknowledge, anchors and remorse. Want and stance stay apart.
import type { Rng } from '../shared/contracts';
import { toScale5 } from './appetites';
import type { AffectionOnset, Gaze, Scale5, Stance } from './model';

/** Objectification rank: person 0 … prey 4. «Mate» (a species drive) sits with «prize». */
export const GAZE_RANK: Readonly<Record<Gaze, number>> = {
    person: 0,
    mate: 1,
    prize: 1,
    instrument: 2,
    property: 3,
    prey: 4,
};

const TOWARD_OBJECT: Readonly<Record<Gaze, Gaze>> = {
    person: 'prize',
    prize: 'instrument',
    mate: 'property',
    instrument: 'property',
    property: 'prey',
    prey: 'prey',
};

const TOWARD_PERSON: Readonly<Record<Gaze, Gaze>> = {
    prey: 'property',
    property: 'instrument',
    instrument: 'prize',
    prize: 'person',
    mate: 'person',
    person: 'person',
};

/** Displays of the target's agency the character has to acknowledge (beaten in a duel, saved, outwitted). */
export type Agency = 'duel-defeat' | 'saved-life' | 'outwitted';

export interface GazeEvents {
    /** Corruption just crossed 5 (the «gaze-shift» unlock): one step toward the object for out-group targets. */
    corruptionCrossed?: boolean;
    /** The target is outside the character's own people. */
    outGroup?: boolean;
    /** The culture's ready gaze for out-group targets («a captive is property»). */
    cultureGaze?: Gaze;
    /** A justification became active toward the target's class. */
    newJustification?: boolean;
    /** A stance-raising event toward the target. */
    stanceRose?: boolean;
    agency?: Agency;
    /** An anchor (touchstone) stands for the target. */
    anchor?: boolean;
    /** A successful remorse roll. */
    remorse?: boolean;
}

/**
 * Durable gaze shift after story events: each objectifying event is one step toward the object, each humanizing
 * one a step back; they cancel out. A culture's script applies to out-group targets unless something humanized
 * the target this time.
 */
export function shiftGaze(gaze: Gaze, events: GazeEvents): Gaze {
    const toObject = (events.corruptionCrossed && events.outGroup ? 1 : 0) + (events.newJustification ? 1 : 0);
    const toPerson =
        (events.stanceRose ? 1 : 0) + (events.agency ? 1 : 0) + (events.anchor ? 1 : 0) + (events.remorse ? 1 : 0);
    let next = gaze;
    const net = toPerson - toObject;
    for (let i = 0; i < Math.abs(net); i++) next = net > 0 ? TOWARD_PERSON[next] : TOWARD_OBJECT[next];
    const script = events.cultureGaze;
    if (events.outGroup && script && toPerson === 0 && GAZE_RANK[script] > GAZE_RANK[next]) next = script;
    return next;
}

/** The gaze of the moment: at «obsessed» anyone is an instrument, or prey when disliked (D3). Not stored. */
export function hotGaze(gaze: Gaze, pressure: number, stance: number): Gaze {
    if (pressure < 5 || GAZE_RANK[gaze] >= GAZE_RANK.instrument) return gaze;
    return stance < 0 ? 'prey' : 'instrument';
}

/* ------------------------------------------------------------------ want × stance */

export const QUADRANTS = [
    'enemy',
    'stranger',
    'friend',
    'exploit',
    'deal',
    'courtship',
    'predator',
    'acquirer',
    'possessive-love',
] as const;
export type Quadrant = (typeof QUADRANTS)[number];

/** Want 0–1 / 2–3 / 4–5 × stance hostile / neutral / warm (§4.5 table) as an id for the renderer. */
export function quadrant(want: number, stance: number): Quadrant {
    const row = want >= 4 ? 2 : want >= 2 ? 1 : 0;
    const col = stance < 0 ? 0 : stance > 0 ? 2 : 1;
    return QUADRANTS[row * 3 + col] as Quadrant;
}

/* ------------------------------------------------------------------ hard rules (D2) */

/** Satisfaction lowers want (satiation) by at least 1. It never touches stance: there is no stance parameter. */
export function sateWant(want: number, amount: number): Scale5 {
    return toScale5(want - Math.max(1, amount));
}

/** Drift guard (§8): stance may rise only through a stance event; otherwise the rise is rolled back. */
export function guardStanceRise(prev: Stance, next: Stance, stanceEvent: boolean): Stance {
    return next > prev && !stanceEvent ? prev : next;
}

/** Chance that a stance event toward a wanted target turns into warmth, by the appetite's affection onset. */
export const AFFECTION_CHANCE: Readonly<Record<AffectionOnset, number>> = {
    never: 0,
    rare: 0.15,
    possible: 0.5,
    common: 0.85,
};

/**
 * Affection can be born but not by itself (§4.5): only through a stance event and only if the appetite allows it.
 * Familiarity from repeated encounters is not a stance event.
 */
export function affectionStarts(onset: AffectionOnset, stanceEvent: boolean, rng: Rng): boolean {
    if (!stanceEvent || onset === 'never') return false;
    return rng() < AFFECTION_CHANCE[onset];
}
