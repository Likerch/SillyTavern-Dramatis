// Restraints and the method ceiling (docs/model.md §5.7 «Сдержки», docs/research/appetites.md D4, D5 step 2).
// Brakes add up per method step; the heat of pressure erodes them. A step is allowed when the push (pressure,
// +1 in withdrawal) beats the brakes and no hard brake holds. The ceiling is the highest step reachable by
// climbing the ladder, never above the structural cap that stance, gaze, culture and dark traits set.
import { ACT_STEP, COARSE_STEP, MAX_STEP, stepOf } from './methods';
import type { Appetite, Core, Gaze, Justification } from './model';
import { clamp, normalizeText } from './util';

export type GroupNorm = 'forbid' | 'neutral' | 'endorse';

export interface RestraintInput {
    core: Pick<Core, 'values' | 'temperament' | 'redLines' | 'dark'>;
    appetite: Pick<Appetite, 'kind' | 'endorsement' | 'vow' | 'visibility' | 'style'>;
    pressure: number;
    withdrawal?: boolean;
    intoxicated?: boolean;
    /** Self-control reserve 0–3. */
    selfControl: number;
    /** Stance toward the target (0 for things). */
    stance: number;
    /** How the target is seen; absent = a thing (any ale). */
    gaze?: Gaze;
    /** The target is outside the character's own people (dark traits and culture scripts act on the out-group). */
    outGroup?: boolean;
    /** Justifications active toward the target's class right now (each −1 to values). */
    justifications?: readonly Justification[] | number;
    /** Perceived risk 0–3: exposure, revenge, law, the chief, a god. */
    fear: number;
    /** Being caught means death: a hard brake. */
    mortalFear?: boolean;
    /** Protectors of the target 0–3 (a jealous claimant counts, rivalry.ts). 3 = overpowering: a hard brake. */
    guardians: number;
    /** Witnesses, daylight, a crowd 0–3. */
    witnesses?: number;
    /** Onlookers indulge in the same: they push instead of restraining (Hofmann). */
    witnessesIndulge?: boolean;
    groupNorm?: GroupNorm;
    corruption?: number;
    /** Steps the character's red lines forbid, resolved by the reader (plus method ids written in redLines.never). */
    forbiddenSteps?: readonly number[];
}

export interface BrakeBreakdown {
    step: number;
    values: number;
    fear: number;
    guardian: number;
    /** Negative when the group endorses: it pushes. */
    group: number;
    regard: number;
    selfControl: number;
    total: number;
    /** Holds at any pressure: mortal fear, a red line, an overpowering guardian. */
    hard: boolean;
    /** The push the brakes are measured against (pressure, +1 in withdrawal). */
    drive: number;
    allowed: boolean;
}

/** Hot-state erosion (Loewenstein): pressure plus withdrawal. */
export function heat(input: Pick<RestraintInput, 'pressure' | 'withdrawal'>): number {
    return clamp(Math.round(input.pressure) + (input.withdrawal ? 1 : 0), 0, 6);
}

function justificationCount(value: RestraintInput['justifications']): number {
    if (value === undefined) return 0;
    return typeof value === 'number' ? Math.max(0, Math.round(value)) : value.length;
}

/** Steps forbidden by red lines: explicit ones plus method ids («force», «deceive») written in redLines.never. */
export function forbiddenSteps(input: Pick<RestraintInput, 'core' | 'forbiddenSteps'>): number[] {
    const steps = new Set<number>(input.forbiddenSteps ?? []);
    for (const line of input.core.redLines.never) {
        const step = stepOf(normalizeText(line));
        if (step !== undefined) steps.add(step);
    }
    return [...steps].filter((step) => step >= ACT_STEP).sort((a, b) => a - b);
}

function wouldSteps(core: RestraintInput['core']): Set<number> {
    const steps = new Set<number>();
    for (const line of core.redLines.would) {
        const step = stepOf(normalizeText(line));
        if (step !== undefined) steps.add(step);
    }
    return steps;
}

/**
 * Inner brake of values and opposed traits against one method step (SIS1-like, Pendragon counter-traits):
 * benevolence/universalism/conformity/tradition and honesty/agreeableness/emotionality, a vow, endorsement,
 * the honest style. Steps 0–2 do not act on anyone and cost no values.
 */
export function valuesConflict(
    core: RestraintInput['core'],
    appetite: RestraintInput['appetite'],
    step: number,
): number {
    if (step < ACT_STEP) return 0;
    let conflict = 0;
    core.values.top.forEach((value, index) => {
        const weight = index === 0 ? 2 : 1;
        if (value === 'benevolence' && step >= 5) conflict += weight;
        if (value === 'universalism' && step >= 6) conflict += weight;
        if ((value === 'conformity' || value === 'tradition') && step >= 7) conflict += weight;
    });
    const t = core.temperament;
    if ((t.honesty ?? 0) > 0 && step >= 5) conflict += t.honesty ?? 0;
    if ((t.agreeableness ?? 0) > 0 && step >= 7) conflict += t.agreeableness ?? 0;
    if ((t.emotionality ?? 0) > 0 && step >= 6) conflict += 1;
    if (wouldSteps(core).has(step)) conflict -= 1;
    if (appetite.vow === 'abstinent') conflict += 2;
    if (appetite.endorsement === 'fighting') conflict += 1;
    if (appetite.endorsement === 'proud') conflict -= 1;
    if (appetite.style === 'honest' && step >= 4) conflict += 1;
    return Math.max(0, conflict);
}

/** All brakes against one method step, after justifications, dark traits, heat and intoxication (D4). */
export function brakeTotal(input: RestraintInput & { step: number }): BrakeBreakdown {
    const step = clamp(Math.round(input.step), 0, MAX_STEP);
    const h = heat(input);
    const dark = input.core.dark ?? {};
    const acting = step >= ACT_STEP;
    const coarse = step >= COARSE_STEP;

    let values = acting
        ? valuesConflict(input.core, input.appetite, step) - justificationCount(input.justifications)
        : 0;
    if (dark.ruthless && input.outGroup) values = 0;
    if (dark.entitled) values -= 1;

    let fear = coarse ? clamp(input.fear, 0, 3) : 0;

    const witnesses = input.witnessesIndulge ? -1 : clamp(input.witnesses ?? 0, 0, 3);
    const hiding = input.appetite.visibility !== 'open';
    let guardian = coarse ? clamp(input.guardians, 0, 3) + witnesses : acting && hiding ? witnesses : 0;

    const norm = input.groupNorm ?? 'neutral';
    const group = acting ? (norm === 'forbid' ? 2 : norm === 'endorse' ? -2 : 0) : 0;

    let regard = 0;
    if (coarse && input.stance > 0) {
        regard = input.stance + (step >= 7 ? 1 : 0) - ((input.corruption ?? 0) >= 5 ? 1 : 0);
    }

    const restrains = coarse || (acting && input.appetite.vow === 'abstinent');
    let selfControl = restrains ? clamp(input.selfControl, 0, 3) : 0;

    // Heat: «driving» weakens values and fear, «obsessed» more so and self-control stops working.
    // Schemers keep their fear longer: cold calculation.
    if (h >= 5) {
        values -= 2;
        fear -= dark.schemer ? 1 : 2;
        selfControl = 0;
    } else if (h >= 4) {
        values -= 1;
        fear -= dark.schemer ? 0 : 1;
    }
    if (input.intoxicated) {
        values -= 1;
        fear -= 1;
        regard -= 1;
        selfControl -= 1;
        if (guardian > 0) guardian -= 1;
    }
    values = Math.max(0, values);
    fear = Math.max(0, fear);
    regard = Math.max(0, regard);
    selfControl = Math.max(0, selfControl);

    const total = Math.max(0, values + fear + guardian + group + regard + selfControl);
    const hard =
        forbiddenSteps(input).includes(step) ||
        (coarse && input.mortalFear === true) ||
        (coarse && input.guardians >= 3);
    const allowed = step < ACT_STEP || (!hard && total < h);
    return { step, values, fear, guardian, group, regard, selfControl, total, hard, drive: h, allowed };
}

/* ------------------------------------------------------------------ the ceiling */

/** Base cap of a gaze (D5 step 2): a person is courted or bought, prey is taken. */
export const GAZE_CAP: Readonly<Record<Gaze, number>> = {
    person: 4,
    mate: 5,
    prize: 5,
    instrument: 6,
    property: 7,
    prey: 7,
};

/**
 * The cap before brakes: stance × gaze × culture × dark traits × corruption.
 * Warm stance + «person» → ≤ 4; neutral + «instrument» → 5–6; hostile + «property»/«prey» + endorsing culture → 8.
 */
export function structuralCap(input: RestraintInput): number {
    let cap: number;
    if (input.gaze === undefined) {
        cap = MAX_STEP;
    } else {
        cap = GAZE_CAP[input.gaze];
        if (input.stance > 0) cap = Math.min(cap, input.gaze === 'person' ? 4 : 5);
        else if (input.stance === 0) cap = Math.min(cap, 6);
        else if (input.gaze === 'person') cap = 5;
        if (input.stance <= -3) cap += 1;
        if (input.groupNorm === 'endorse' && input.stance <= 0) cap += 1;
        if (input.core.dark?.ruthless && input.outGroup) cap += 1;
    }
    if (input.groupNorm === 'forbid') cap -= 1;
    if ((input.corruption ?? 0) >= 5) cap += 1;
    if (input.appetite.style === 'honest') cap = Math.min(cap, ACT_STEP);
    const forbidden = forbiddenSteps(input)[0];
    if (forbidden !== undefined) cap = Math.min(cap, forbidden - 1);
    return clamp(cap, ACT_STEP - 1, MAX_STEP);
}

export interface CeilingDetail {
    /** Highest step the character will go to now (2 = will only wait, substitute or abstain). */
    step: number;
    /** Cap from stance, gaze, culture, dark traits and corruption. */
    cap: number;
    /** The first step the brakes stopped, with the breakdown (absent when the cap stopped the climb). */
    blocked?: BrakeBreakdown;
}

/** Climbs the ladder from court up to the structural cap and stops at the first step the brakes hold. */
export function ceilingDetail(input: RestraintInput): CeilingDetail {
    const cap = structuralCap(input);
    let step = ACT_STEP - 1;
    for (let next = ACT_STEP; next <= cap; next++) {
        const brakes = brakeTotal({ ...input, step: next });
        if (!brakes.allowed) return { step, cap, blocked: brakes };
        step = next;
    }
    return { step, cap };
}

/** Max ladder step 0–8 the character will go to (see ceilingDetail). */
export function ceiling(input: RestraintInput): number {
    return ceilingDetail(input).step;
}

/**
 * Sadism is its own appetite, not a missing brake (Buckels et al.): a sadist's coarse act toward a target also
 * feeds their cruelty appetite. True when the act counts as a cruelty satisfier.
 */
export function feedsCruelty(core: Pick<Core, 'dark'>, step: number): boolean {
    return core.dark?.sadist === true && step >= 6;
}
