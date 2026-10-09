// Corruption 0–10 with stains, remorse, thresholds, gifts and brands (docs/model.md §5.7 «Разложение»,
// docs/research/appetites.md D6: V5 humanity and stains, Pathfinder corruptions, CoC diminishing gains).
// Stains are pending moral damage; remorse at a chapter end either clears them or costs a level.
import type { DramatisSettings, Rng } from '../shared/contracts';
import { COARSE_STEP } from './methods';
import type { Appetite, CharacterState, Gaze, Style } from './model';
import { clamp } from './util';

export type CorruptionLever = DramatisSettings['corruption'];
export type CorruptionState = CharacterState['corruption'];

export const MAX_CORRUPTION = 10;
/** Thresholds that unlock behaviour (not a personality rewrite). */
export const THRESHOLDS = [3, 5, 7, 10] as const;
export type Threshold = (typeof THRESHOLDS)[number];
export type GiftThreshold = Exclude<Threshold, 10>;

export type Unlock = 'euphemisms' | 'gaze-shift' | 'identity' | 'lost';
export const UNLOCKS: Readonly<Record<Threshold, Unlock>> = {
    3: 'euphemisms',
    5: 'gaze-shift',
    7: 'identity',
    10: 'lost',
};

/** Gift and brand ids per threshold (Pathfinder manifestations); prose lives in i18n. */
export const GIFTS: Readonly<Record<GiftThreshold, string>> = { 3: 'confidence', 5: 'pack-standing', 7: 'dread' };
export const BRANDS: Readonly<Record<GiftThreshold, string>> = { 3: 'mark', 5: 'compulsion', 7: 'lost-anchor' };

/** Styles whose usual methods are coarse (step ≥ 5): the «coarse» lever tracks these characters. */
export const COARSE_STYLES: readonly Style[] = ['insider', 'spider', 'raider', 'shadow', 'shepherd'];

/** Behaviours unlocked at a level. */
export function unlocked(level: number): Unlock[] {
    return THRESHOLDS.filter((t) => level >= t).map((t) => UNLOCKS[t]);
}

/** Thresholds passed going from one level to another (upward only). */
export function crossedThresholds(from: number, to: number): Threshold[] {
    return THRESHOLDS.filter((t) => from < t && to >= t);
}

/* ------------------------------------------------------------------ the lever */

/** Who the «corruption» lever tracks: off → nobody; coarse → characters with coarse methods or a vow; all. */
export function corruptionApplies(lever: CorruptionLever, who: { coarse: boolean; vow: boolean }): boolean {
    if (lever === 'off') return false;
    if (lever === 'coarse') return who.coarse || who.vow;
    return true;
}

/** Reads «coarse methods or a vow» off a character's appetites (plus a story flag for coarse acts done). */
export function coarseProfile(
    appetites: readonly Pick<Appetite, 'style' | 'vow'>[],
    actedCoarse = false,
): { coarse: boolean; vow: boolean } {
    return {
        coarse: actedCoarse || appetites.some((a) => COARSE_STYLES.includes(a.style)),
        vow: appetites.some((a) => a.vow !== 'none'),
    };
}

/* ------------------------------------------------------------------ stains */

export interface StainAct {
    /** Ladder step of the act (0–8). */
    step?: number;
    /** How the actor saw the target. */
    gaze?: Gaze;
    /** The actor's stance toward the target. */
    stance?: number;
    /** A broken vow: the appetite's vow, or a red line (a conviction). */
    brokeVow?: 'moderate' | 'abstinent' | 'red-line';
    /** First of its kind: first captive, first kill for an appetite, first betrayal of an anchor. */
    catalyst?: boolean;
}

/** Full below 3, half at 3–6, a quarter above: the first fall is the deepest (CoC). */
export function stainMultiplier(level: number): number {
    if (level < 3) return 1;
    return level <= 6 ? 0.5 : 0.25;
}

/** Stains before diminishing; the catalyst part is reported separately (it never diminishes). */
export function rawStains(act: StainAct): { base: number; catalyst: number } {
    let base = 0;
    const step = act.step ?? 0;
    // A coarse act stains only against someone seen as a person or not disliked: prey of a hater is «already gone».
    if (step >= COARSE_STEP && (act.gaze === 'person' || (act.stance ?? 0) >= 0)) base += step >= 7 ? 2 : 1;
    if (act.brokeVow === 'moderate') base += 1;
    if (act.brokeVow === 'abstinent') base += 2;
    if (act.brokeVow === 'red-line') base += 3;
    return { base, catalyst: act.catalyst ? 2 : 0 };
}

export interface StainResult {
    state: CorruptionState;
    added: number;
    /** A catalyst forces a remorse check now, not at the chapter end. */
    check: boolean;
}

/** Adds the stains of one act (no-op when the lever does not track this character). */
export function addStain(
    state: CorruptionState,
    act: StainAct,
    ctx: { lever: CorruptionLever; coarse?: boolean; vow?: boolean },
): StainResult {
    if (!corruptionApplies(ctx.lever, { coarse: ctx.coarse ?? false, vow: ctx.vow ?? false })) {
        return { state, added: 0, check: false };
    }
    const { base, catalyst } = rawStains(act);
    const added = base * stainMultiplier(state.level) + catalyst;
    if (added <= 0) return { state, added: 0, check: false };
    return { state: { ...state, stains: state.stains + added }, added, check: catalyst > 0 };
}

/* ------------------------------------------------------------------ remorse */

export interface RemorseContext {
    /** An anchor (touchstone) is near: +1 die; at 7+ remorse is possible only with one. */
    anchorPresent: boolean;
    /** Active justifications toward the victims: −1 die each (true = one). */
    justificationsActive: boolean | number;
    /** The group endorses what was done: −1 die. */
    cultureEndorses: boolean;
    /** Extra dice from refused gifts. */
    bonusDice?: number;
}

export type RemorseReason = 'clean' | 'lost' | 'no-anchor' | 'rolled';

export interface RemorseResult {
    level: number;
    stains: number;
    success: boolean;
    dice: number;
    rolled: boolean;
    reason: RemorseReason;
}

/** Dice of a remorse roll: 10 − level − stains (min 1), ± anchor, justifications, culture, bonus; min 1. */
export function remorseDice(level: number, stains: number, ctx: RemorseContext): number {
    const justifications =
        typeof ctx.justificationsActive === 'number'
            ? Math.max(0, Math.round(ctx.justificationsActive))
            : ctx.justificationsActive
              ? 1
              : 0;
    const base = Math.max(1, 10 - Math.round(level) - Math.floor(stains));
    const dice =
        base + (ctx.anchorPresent ? 1 : 0) - justifications - (ctx.cultureEndorses ? 1 : 0) + (ctx.bonusDice ?? 0);
    return Math.max(1, dice);
}

/**
 * Chapter-end remorse (V5): any d10 of 6+ succeeds and clears the stains; a failure clears them too and costs
 * a level. No stains — nothing to roll. Lost (10) stays lost. At 7+ without an anchor there are no dice: failure.
 */
export function remorse(level: number, stains: number, ctx: RemorseContext, rng: Rng): RemorseResult {
    const lvl = clamp(Math.round(level), 0, MAX_CORRUPTION);
    if (stains <= 0) return { level: lvl, stains: 0, success: true, dice: 0, rolled: false, reason: 'clean' };
    if (lvl >= MAX_CORRUPTION) {
        return { level: MAX_CORRUPTION, stains: 0, success: false, dice: 0, rolled: false, reason: 'lost' };
    }
    if (lvl >= 7 && !ctx.anchorPresent) {
        return { level: lvl + 1, stains: 0, success: false, dice: 0, rolled: false, reason: 'no-anchor' };
    }
    const dice = remorseDice(lvl, stains, ctx);
    let success = false;
    for (let i = 0; i < dice; i++) {
        if (Math.floor(rng() * 10) + 1 >= 6) success = true;
    }
    return {
        level: success ? lvl : Math.min(MAX_CORRUPTION, lvl + 1),
        stains: 0,
        success,
        dice,
        rolled: true,
        reason: 'rolled',
    };
}

/** remorse() on the stored state: spends the bonus dice and returns the new state. */
export function applyRemorse(
    state: CorruptionState,
    ctx: Omit<RemorseContext, 'bonusDice'>,
    rng: Rng,
): { state: CorruptionState; result: RemorseResult } {
    const result = remorse(state.level, state.stains, { ...ctx, bonusDice: state.bonusDice ?? 0 }, rng);
    const next: CorruptionState = { ...state, level: result.level, stains: result.stains };
    if (result.rolled) delete next.bonusDice;
    return { state: next, result };
}

/* ------------------------------------------------------------------ gifts and brands */

/**
 * A threshold reached: the brand always comes; the gift is a temptation the character may refuse,
 * and refusing earns a die for the next remorse roll (Pathfinder «vile corruption»).
 */
export function crossThreshold(state: CorruptionState, threshold: GiftThreshold, acceptGift: boolean): CorruptionState {
    const brand = BRANDS[threshold];
    const gift = GIFTS[threshold];
    const brands = state.brands.includes(brand) ? [...state.brands] : [...state.brands, brand];
    if (acceptGift) {
        const gifts = state.gifts.includes(gift) ? [...state.gifts] : [...state.gifts, gift];
        return { ...state, gifts, brands };
    }
    return { ...state, gifts: [...state.gifts], brands, bonusDice: (state.bonusDice ?? 0) + 1 };
}

/* ------------------------------------------------------------------ recovery */

export interface RecoveryInput {
    abstinence?: boolean;
    /** Accepting responsibility (the opposite of the justifications). */
    responsibility?: boolean;
    restitution?: boolean;
    anchor?: boolean;
    /** A world-scale event: the only way back from «lost». */
    worldEvent?: boolean;
}

/**
 * Slow way back (§5.7): at most −1 per chapter, only after a clean chapter (no stains) with at least two of
 * abstinence, responsibility, restitution, an anchor. Sensitization is untouched: relapse risk lives on.
 */
export function recover(state: CorruptionState, input: RecoveryInput): CorruptionState {
    if (state.level <= 0 || state.stains > 0) return state;
    if (state.level >= MAX_CORRUPTION && !input.worldEvent) return state;
    const factors = [input.abstinence, input.responsibility, input.restitution, input.anchor].filter(Boolean).length;
    if (factors < 2 && !input.worldEvent) return state;
    return { ...state, level: state.level - 1 };
}
