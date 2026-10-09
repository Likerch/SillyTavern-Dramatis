// Group, species and world appetite rules → individuals (docs/model.md §4.5 «Влечения групп и правила мира»,
// decisions В17; docs/research/appetites.md D7, D9.1). One rule makes a varied crowd, not clones: each individual
// draws its own strength (with real zeros), style and target; the player is one target among many unless the
// scenario names him, and even then only those who know of him want him. A per-scene budget keeps the world
// from orbiting the player again through appetite.
import type { DramatisSettings, Rng } from '../shared/contracts';
import { defaultDrift, effectiveBaseline, toScale5 } from './appetites';
import type { AppetiteStrength } from './appetites';
import { PLAYER_ID } from './model';
import type { Appetite, AppetiteKind, AppetiteRule, Scale5, Style } from './model';
import { clamp } from './util';

/** Kinds the content boundary keeps away from minors, as holders and as targets (Maestro rule, §5.7). */
export const SEXUAL_KINDS: readonly AppetiteKind[] = ['flesh', 'dominance'];

/** Style when a rule gives no weights. */
export const DEFAULT_STYLE: Style = 'honest';

/** Want at which a character can actively hunt a target. */
export const HUNT_WANT = 2;

export type IntensityBand = 'zero' | 'low' | 'mid' | 'high';

export interface RuleIndividual {
    id: string;
    /** Has seen the player or heard of him (decision В17: desirability spreads with knowledge). */
    knowsPlayer: boolean;
    minor?: boolean;
}

export interface RuleCandidate {
    id: string;
    minor?: boolean;
}

export interface DrawContext {
    /** Everyone who fits the rule's class, NPCs and the player alike (ignored for player and thing targets). */
    candidates?: readonly RuleCandidate[];
    strength?: AppetiteStrength;
}

export interface DrawnAppetite {
    appetite: Appetite;
    band: IntensityBand;
    /** Starting pressure. */
    pressure: Scale5;
    /** Who it points at: every fitting candidate, the player (if known), or nobody (things). */
    targets: string[];
}

/** Picks a key by weight (weights need not sum to 1); undefined when nothing has weight. */
export function pickWeighted<T extends string>(weights: Partial<Record<T, number>>, rng: Rng): T | undefined {
    const entries = (Object.entries(weights) as [T, number | undefined][]).filter(
        (entry): entry is [T, number] => typeof entry[1] === 'number' && entry[1] > 0,
    );
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    if (total <= 0) return undefined;
    let roll = rng() * total;
    for (const [key, w] of entries) {
        roll -= w;
        if (roll < 0) return key;
    }
    return entries[entries.length - 1]?.[0];
}

/** Strength band from the rule's distribution; «zero» is real: sated, taken, busy, not interested now. */
export function drawBand(intensity: AppetiteRule['intensity'], rng: Rng): IntensityBand {
    return pickWeighted<IntensityBand>(intensity, rng) ?? 'zero';
}

/** Baseline of a band: zero 0, low 1, mid 2–3, high 4–5. */
export function bandBaseline(band: IntensityBand, rng: Rng): Scale5 {
    switch (band) {
        case 'zero':
            return 0;
        case 'low':
            return 1;
        case 'mid':
            return rng() < 0.5 ? 2 : 3;
        default:
            return rng() < 0.5 ? 4 : 5;
    }
}

function isSexual(kind: AppetiteKind): boolean {
    return SEXUAL_KINDS.includes(kind);
}

/**
 * The content boundary at the point of action (Maestro rule, §5.7): a sexual appetite of a minor, or aimed at a
 * minor, never acts — whatever the stored data says (a character flagged a minor after the reading, a hand edit).
 */
export function sexualBarred(
    kind: AppetiteKind,
    holder: { minor?: boolean } | undefined,
    target?: { minor?: boolean } | undefined,
): boolean {
    return isSexual(kind) && (holder?.minor === true || target?.minor === true);
}

/**
 * Draws one individual's appetite from a rule: band and baseline (the lever shifts non-zero ones), style by the
 * rule's weights, affection onset, and targets — a class spreads over every fitting candidate (NPCs included),
 * a player rule reaches only an individual who knows the player. Minors neither hold nor receive sexual appetites:
 * returns null for a minor holder.
 */
export function drawFromRule(
    rule: AppetiteRule,
    individual: RuleIndividual,
    rng: Rng,
    ctx: DrawContext = {},
): DrawnAppetite | null {
    if (individual.minor && isSexual(rule.kind)) return null;
    const band = drawBand(rule.intensity, rng);
    const raw = bandBaseline(band, rng);
    const baseline = band === 'zero' ? 0 : effectiveBaseline(raw, ctx.strength ?? 'author');
    const style = pickWeighted<Style>(rule.styles, rng) ?? DEFAULT_STYLE;

    let targets: string[] = [];
    if (rule.target.mode === 'class') {
        targets = (ctx.candidates ?? [])
            .filter((c) => c.id !== individual.id && !(c.minor && isSexual(rule.kind)))
            .map((c) => c.id);
    } else if (rule.target.mode === 'player' && individual.knowsPlayer) {
        targets = [PLAYER_ID];
    }

    const pressure = baseline === 0 ? 0 : toScale5(baseline - (rng() < 0.5 ? 1 : 0));
    const appetite: Appetite = {
        id: rule.id,
        kind: rule.kind,
        sources: [rule.source],
        target: { ...rule.target },
        baseline,
        liking: 0,
        triggers: [],
        satisfiers: [],
        drift: defaultDrift(rule.kind),
        tolerance: 0,
        dependence: 0,
        sensitization: 0,
        // A species nature or a group custom is owned; a curse or a siege is suffered.
        endorsement: rule.source === 'species' || rule.source === 'culture' ? 'proud' : 'torn',
        vow: 'none',
        visibility: 'open',
        style,
        affectionOnset: rule.affectionOnset,
        rule: rule.id,
    };
    if (rule.label !== undefined) appetite.label = rule.label;
    return { appetite, band, pressure, targets };
}

/* ------------------------------------------------------------------ desirability */

export interface DesireSource {
    kind: AppetiteKind;
    /** Minimum target value that triggers pursuit, 0–5 (rules); absent = 0. */
    choosiness?: number;
}

export interface DesireTarget {
    /** How the kind/rule values this target, 0–5 (strength, novelty of kind, status, «essence»). */
    value: number;
    /** The individual's own taste for this target, −2…+2. */
    taste?: number;
    /** New to the actor. */
    novelty?: boolean;
    minor?: boolean;
}

export interface DesireContext {
    /** Current pressure of the appetite. */
    pressure: number;
    /** Fitting targets around (scarcity). */
    available: number;
}

/** Choosiness falls when targets are scarce (sex-ratio logic, D7): one target −2, two or three −1. */
export function effectiveChoosiness(choosiness: number, available: number): number {
    const drop = available <= 1 ? 2 : available <= 3 ? 1 : 0;
    return Math.max(0, choosiness - drop);
}

/**
 * Want toward one target, 0–5 (§4.5): valuation × taste × novelty × scarcity × pressure. Below the (scarcity-
 * lowered) choosiness there is no pursuit at all. Never derived from stance. Minors get 0 for sexual kinds.
 */
export function desirability(source: DesireSource, target: DesireTarget, ctx: DesireContext): Scale5 {
    if (target.minor && isSexual(source.kind)) return 0;
    const taste = clamp(target.taste ?? 0, -2, 2);
    const value = clamp(target.value, 0, 5);
    if (value + taste < effectiveChoosiness(source.choosiness ?? 0, ctx.available)) return 0;
    const scarcity = ctx.available >= 8 ? 0.9 : 1 + 0.1 * Math.max(0, 4 - Math.max(1, ctx.available));
    const pressure = 0.5 + 0.125 * clamp(ctx.pressure, 0, 5);
    const want = value * (1 + 0.25 * taste) * (target.novelty ? 1.2 : 1) * scarcity * pressure;
    return toScale5(want);
}

/* ------------------------------------------------------------------ the hunters' budget */

export interface HuntCandidate {
    id: string;
    /** Want toward the player. */
    want: number;
    pressure: number;
    /** Has other fitting targets around (other travellers, captives, a rival's mate). */
    alternatives?: boolean;
}

export interface HuntOptions {
    /** The «hunters per scene» lever; 0 = as the author wrote. */
    perScene: DramatisSettings['huntersPerScene'];
    /** The rule names the player as its target. */
    ruleTargetsPlayer?: boolean;
    /** The author says «everyone wants him». */
    authorSaysAll?: boolean;
}

export interface HuntBudget {
    limit: number;
    hunters: string[];
    /** Wanted the player but did not get a slot: turn to other targets or wait for their chance. */
    deferred: { id: string; to: 'other-target' | 'wait' }[];
}

/** How many may actively hunt the player in one scene: the lever, or the author's 2 (3 when «all» is written). */
export function huntLimit(options: HuntOptions): number {
    if (options.perScene > 0) return options.perScene;
    return options.ruleTargetsPlayer && options.authorSaysAll ? 3 : 2;
}

/**
 * Picks this scene's hunters among characters wanting the player (want ≥ 2): a weighted draw by (want + pressure)²
 * so the keenest usually lead but the roster varies scene to scene. The rest turn elsewhere or wait.
 */
export function huntersBudget(candidates: readonly HuntCandidate[], options: HuntOptions, rng: Rng): HuntBudget {
    const limit = huntLimit(options);
    const pool = candidates.filter((c) => c.want >= HUNT_WANT);
    const hunters: string[] = [];
    while (hunters.length < limit && pool.length > 0) {
        const weights: Record<string, number> = {};
        for (const c of pool) weights[c.id] = (c.want + c.pressure) ** 2;
        const id = pickWeighted(weights, rng);
        const index = pool.findIndex((c) => c.id === id);
        const [picked] = index < 0 ? [] : pool.splice(index, 1);
        if (!picked) break;
        hunters.push(picked.id);
    }
    return {
        limit,
        hunters,
        deferred: pool.map((c) => ({ id: c.id, to: c.alternatives ? 'other-target' : 'wait' })),
    };
}
