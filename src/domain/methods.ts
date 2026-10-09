// The method ladder and how a character picks a method (docs/model.md §5.7 «Лестница способов»,
// docs/research/appetites.md D5). The step is a measure of coercion; the ceiling comes from brakes.ts.
// Choice = the lowest step with acceptable odds at the current urgency, bent by the character's style.
import type { Rng } from '../shared/contracts';
import { actGate } from './appetites';
import type { Core, Style } from './model';
import { clamp, clamp01 } from './util';

/** Ladder step ids (0–8) for the renderer; prose lives in i18n. */
export const METHODS = [
    'abstain',
    'substitute',
    'wait',
    'court',
    'trade',
    'deceive',
    'impair',
    'coerce',
    'force',
] as const;
export type MethodId = (typeof METHODS)[number];

export const MAX_STEP = 8;
/** First consensual step (court). Steps below are not acting on the target. */
export const ACT_STEP = 3;
/** First coarse step (deceive): stains, fear and guardians start to matter. */
export const COARSE_STEP = 5;

/** Acceptable success odds by urgency (pressure, +1 in withdrawal): «obsessed» acts on long shots. */
export const ACCEPT_ODDS: readonly number[] = [1, 1, 0.7, 0.5, 0.35, 0.2];

/** How often a character follows their style this time (variety against a monoculture of methods). */
export const STYLE_ADHERENCE = 0.8;

/** Preferred steps get this much slack on the odds threshold. */
export const STYLE_SLACK = 0.15;

/** Steps each style reaches for first, in order (V5 predator types, D5). */
export const STYLE_PREFS: Readonly<Record<Style, readonly number[]>> = {
    siren: [3, 5],
    buyer: [4],
    insider: [5],
    spider: [5, 8],
    raider: [8, 7],
    shadow: [6, 8],
    shepherd: [4, 7],
    duelist: [3],
    honest: [3],
};

export function methodId(step: number): MethodId {
    return METHODS[clamp(Math.round(step), 0, MAX_STEP)] as MethodId;
}

export function stepOf(id: string): number | undefined {
    const index = (METHODS as readonly string[]).indexOf(id.trim().toLowerCase());
    return index < 0 ? undefined : index;
}

/** Patient characters build schemes instead of waiting: schemers, or conscientious ones. */
export function isPatient(core: Pick<Core, 'dark' | 'temperament'>): boolean {
    return core.dark?.schemer === true || (core.temperament.conscientiousness ?? 0) >= 1;
}

/* ------------------------------------------------------------------ opportunity */

export interface OpportunityInput {
    /** V: what the target is worth to the actor, 0–5 (want, or the value of a thing). */
    value: number;
    /** I: the target's capacity to resist, 0 (helpless) … 3 (formidable). */
    inertia: number;
    /** V: the target is in sight / noticed (0–1). */
    visible: boolean | number;
    /** A: the target can be reached now (0–1). */
    access: number;
    /** Protectors, witnesses, a claimant rival: 0–3. */
    guardians: number;
    /** The actor's own capability (skills, tools), 0–3. */
    capability: number;
    accomplices?: number;
    /** Ways out afterwards (0–1). */
    escape: boolean | number;
}

function unit(value: boolean | number, ifFalse: number): number {
    if (typeof value === 'boolean') return value ? 1 : ifFalse;
    return clamp01(value);
}

/**
 * Routine activity theory: a motivated actor, a suitable target (VIVA) and no capable guardian. 0–1.
 * value × power balance × visibility × access × guardian absence × escape.
 */
export function opportunity(input: OpportunityInput): number {
    const value = 0.5 + 0.1 * clamp(input.value, 0, 5);
    const power = clamp(
        0.5 + 0.15 * (clamp(input.capability, 0, 3) + 0.5 * clamp(input.accomplices ?? 0, 0, 4) - input.inertia),
        0.05,
        1,
    );
    const visible = unit(input.visible, 0.3);
    const access = clamp01(input.access);
    const guard = clamp(1 - 0.3 * clamp(input.guardians, 0, 3), 0.05, 1);
    const escape = unit(input.escape, 0.5);
    return clamp01(value * power * visible * access * guard * escape);
}

/* ------------------------------------------------------------------ odds per step */

export interface OddsInput {
    /** General opportunity (opportunity()). */
    opportunity: number;
    /** Target's openness to consensual steps (court, trade), 0–1; default 0.5. */
    receptive?: number;
    /** The actor's means to pay or offer, 0–1; default 0.5. */
    means?: number;
    /** The actor holds a hook on the target (a secret, a debt): coercion works better. */
    leverage?: boolean;
    /** Known per-step odds (e.g. after a refusal court is 0.1). */
    odds?: Partial<Record<number, number>>;
}

/** Success odds of one step, 0–1. Steps 0–2 always «work»: they do not act on the target. */
export function stepOdds(step: number, input: OddsInput): number {
    const known = input.odds?.[step];
    if (known !== undefined) return clamp01(known);
    const opp = clamp01(input.opportunity);
    const receptive = clamp01(input.receptive ?? 0.5);
    switch (step) {
        case 0:
        case 1:
        case 2:
            return 1;
        case 3:
            return receptive;
        case 4:
            return clamp01(0.2 + 0.5 * clamp01(input.means ?? 0.5) + 0.2 * receptive);
        case 5:
            return clamp01(0.2 + 0.7 * opp);
        case 6:
            return clamp01(0.1 + 0.8 * opp);
        case 7:
            return clamp01(0.1 + 0.7 * opp + (input.leverage ? 0.2 : 0));
        default:
            return opp;
    }
}

/* ------------------------------------------------------------------ escalation */

export interface Escalation {
    /** Lowest step of the next attempt. */
    step: number;
    failures: number;
}

/**
 * A refusal or a failure at «preoccupied» or above makes the next attempt one step coarser (raiders: two).
 * Success clears it. The ceiling still applies at choice time (chooseMethod reports frustration).
 */
export function escalate(
    prev: Escalation | undefined,
    tried: number,
    outcome: 'success' | 'refused' | 'failed',
    pressure: number,
    style?: Style,
): Escalation | undefined {
    if (outcome === 'success') return undefined;
    const failures = (prev?.failures ?? 0) + 1;
    const base = Math.max(tried, prev?.step ?? ACT_STEP);
    if (pressure < 3) return { step: base, failures };
    return { step: Math.min(MAX_STEP, tried + (style === 'raider' ? 2 : 1)), failures };
}

/* ------------------------------------------------------------------ choice */

export interface MethodInput extends OddsInput {
    pressure: number;
    /** Highest step the character will go to (brakes.ts ceiling()). */
    ceiling: number;
    style: Style;
    withdrawal?: boolean;
    /** Patience trait or a schemer (isPatient()). */
    patient?: boolean;
    /** Lowest step of this attempt after earlier refusals (Escalation.step). */
    minStep?: number;
    /** A substitute (another drink, another target) is at hand. */
    substitute?: boolean;
}

export type MethodMode = 'now' | 'scheme' | 'wait' | 'substitute' | 'frustrated';

export type MethodReason =
    /** Not enacted: pressure too low for the chance at hand (Hofmann). */
    | 'gate'
    /** The lowest step with acceptable odds. */
    | 'odds'
    /** The style's preferred step. */
    | 'style'
    /** Poor odds now, a patient character prepares a clock. */
    | 'scheme'
    /** Poor odds and no scheme: waits for a chance or positions. */
    | 'no-odds'
    /** Too urgent to wait: takes a substitute. */
    | 'urgent'
    /** What would work lies above the ceiling. */
    | 'above-ceiling';

export interface MethodChoice {
    step: number;
    method: MethodId;
    mode: MethodMode;
    reason: MethodReason;
    /** Success odds of the chosen step (acting modes). */
    odds?: number;
    /** Covert use of the own circle (insider). */
    secret?: boolean;
    /** A formal challenge: the winner claims (duelist, treated as step 3). */
    duel?: boolean;
    /** Stress to add (frustration, abstaining while preoccupied). */
    stress?: number;
    /** The step that would work but lies above the ceiling: a corruption moment («cross the line?»). */
    temptation?: boolean;
    needed?: number;
}

function choice(step: number, mode: MethodMode, reason: MethodReason, extra: Partial<MethodChoice> = {}): MethodChoice {
    return { step, method: methodId(step), mode, reason, ...extra };
}

function decorate(result: MethodChoice, style: Style): MethodChoice {
    if (style === 'insider' && result.step >= COARSE_STEP) result.secret = true;
    if (style === 'duelist' && result.step === ACT_STEP) result.duel = true;
    return result;
}

/**
 * Picks the method for this scene (§5.7 «Как выбирается способ»):
 * 1. gate (actGate); 2. candidates from the escalation floor up to the ceiling, style preferences first;
 * 3. the first with acceptable odds acts now; 4. otherwise a patient character schemes (step ≥ 5),
 * an urgent one substitutes, the rest wait; 5. if only a step above the ceiling would work — frustration.
 */
export function chooseMethod(input: MethodInput, rng: Rng): MethodChoice {
    const style = input.style;
    const urgency = clamp(Math.round(input.pressure) + (input.withdrawal ? 1 : 0), 0, 5);
    if (!actGate(urgency, input.opportunity)) return choice(0, 'wait', 'gate');

    const ceiling = clamp(Math.round(style === 'honest' ? Math.min(input.ceiling, ACT_STEP) : input.ceiling), 0, 8);
    const floor = clamp(Math.round(input.minStep ?? ACT_STEP), ACT_STEP, MAX_STEP);
    const threshold = ACCEPT_ODDS[urgency] ?? 1;
    const follow = rng() < STYLE_ADHERENCE;
    const prefs = follow ? STYLE_PREFS[style] : [];
    const odds = (step: number) => stepOdds(step, input);

    if (floor > ceiling) return frustrated(input, urgency, floor);

    // Spiders always lay the trap first: wait → deceive → snap shut, via a clock (D5).
    if (follow && style === 'spider' && ceiling >= 5) {
        const trap = ceiling >= 8 ? 8 : Math.max(5, floor);
        if (urgency >= 5 && odds(trap) >= threshold) return choice(trap, 'now', 'style', { odds: odds(trap) });
        return choice(trap, 'scheme', 'style');
    }

    const range: number[] = [];
    for (let step = floor; step <= ceiling; step++) {
        // Shadows avoid confrontation: no open coercion.
        if (style === 'shadow' && step === 7) continue;
        range.push(step);
    }
    const ordered = [...prefs.filter((step) => range.includes(step)), ...range.filter((step) => !prefs.includes(step))];
    for (const step of ordered) {
        const preferred = prefs.includes(step);
        const p = odds(step);
        if (p >= threshold - (preferred ? STYLE_SLACK : 0)) {
            return decorate(choice(step, 'now', preferred ? 'style' : 'odds', { odds: p }), style);
        }
    }

    // Nothing works now. Patient characters prepare the lowest coarse step within reach.
    const schemeStep = range.find((step) => step >= COARSE_STEP);
    if (schemeStep !== undefined && input.patient) return decorate(choice(schemeStep, 'scheme', 'scheme'), style);

    // Would a step above the ceiling work? Then it is frustration, not mere waiting.
    for (let step = ceiling + 1; step <= MAX_STEP; step++) {
        if (odds(step) >= threshold) return frustrated(input, urgency, step);
    }

    if (urgency >= 4 && input.substitute) return choice(1, 'substitute', 'urgent');
    return choice(2, 'wait', 'no-odds');
}

function frustrated(input: MethodInput, urgency: number, needed: number): MethodChoice {
    const step = input.substitute ? 1 : 0;
    return choice(step, 'frustrated', 'above-ceiling', {
        stress: 1,
        temptation: urgency >= 4,
        needed: Math.min(MAX_STEP, needed),
    });
}

/** Abstaining (step 0) while «preoccupied» or above costs stress (§5.7 ladder, step 0). */
export function abstainStress(pressure: number): number {
    return pressure >= 3 ? 1 : 0;
}
