// Who cares about the player right now (docs/model.md §5.4; research E3). Relevance is computed, not given:
// the player matters to a character only through its intention, its tie, its needs, its appetite or its duty —
// and the urgency of its own business pulls attention away.
import type { AttentionBand, Stance } from './model';
import type { DramatisSettings } from '../shared/contracts';
import { clamp, clamp01 } from './util';

export type Gravity = DramatisSettings['playerGravity'];

/** The player's role in the character's current intention. */
export type PlayerRole = 'none' | 'means' | 'obstacle' | 'target' | 'threat';

export interface RelevanceInput {
    roleInIntention: PlayerRole;
    /** Stance toward the player. */
    stance: Stance;
    openDebts: number;
    grudges: number;
    /** 0–1: needs and attachment pulling toward company (relatedness × anxiety). */
    needPull: number;
    /** 0–5: desirability of the player as an object of appetite (§4.5). */
    want: number;
    /** 0–5: pressure of that appetite. */
    pressure: number;
    /** The player spoke to them directly. */
    addressed: boolean;
    near: boolean;
    /** Their role obliges them to deal with the player (innkeeper serves a guest, guard checks papers). */
    roleDuty: boolean;
    /** 0–1: how close their own agenda clock is to mattering now. */
    agendaUrgency: number;
    /** 0–10. */
    proactivity: number;
    /** Their tactic toward the player is to ignore him (see tacticIgnores). */
    ignores?: boolean;
}

export const ROLE_WEIGHT: Record<PlayerRole, number> = { none: 0, means: 0.5, obstacle: 0.6, target: 1, threat: 1 };

/** Band thresholds by player gravity: higher gravity makes the player matter more easily. */
export const BAND_THRESHOLDS: Record<Gravity, { business: number; focus: number }> = {
    low: { business: 0.35, focus: 0.65 },
    medium: { business: 0.3, focus: 0.58 },
    high: { business: 0.25, focus: 0.5 },
};

/** Floor for an addressed or duty-bound character: 'business' under any gravity. */
export const BUSINESS_FLOOR = Math.max(...Object.values(BAND_THRESHOLDS).map((t) => t.business));

export const DEFAULT_FOCUS_BUDGET = 2;

/**
 * The relevance terms, each 0–1:
 * - goal   = ROLE_WEIGHT[role]                                  (means .5, obstacle .6, target/threat 1)
 * - tie    = 0.6 × |stance| / 3                                 (strong feelings either way)
 * - ledger = 0.5 × min(1, (openDebts + grudges) / 3)            (unsettled accounts)
 * - need   = 0.5 × needPull
 * - desire = want/5 × (0.5 + 0.5 × pressure/5)                 (appetite, sharpened by pressure)
 * - near 0.15, addressed 0.3
 */
export function relevanceTerms(input: RelevanceInput): number[] {
    const count = (n: number): number => (Number.isFinite(n) ? Math.max(0, n) : 0);
    return [
        ROLE_WEIGHT[input.roleInIntention] ?? 0,
        (0.6 * Math.abs(clamp(input.stance, -3, 3))) / 3,
        0.5 * Math.min(1, (count(input.openDebts) + count(input.grudges)) / 3),
        0.5 * clamp01(input.needPull),
        clamp01(input.want / 5) * (0.5 + 0.5 * clamp01(input.pressure / 5)),
        input.near ? 0.15 : 0,
        input.addressed ? 0.3 : 0,
    ];
}

/**
 * Player relevance 0–1:
 *   positive = 1 − Π(1 − termᵢ)                (noisy-OR: any reason can make him care, none pushes past 1)
 *   score    = positive − agendaUrgency × proactivity / 10
 * Being addressed or bound by duty floors the score at 'business' — except a character at stance ≤ −2 whose tactic
 * is to ignore the player: snubbing him is how that hostility shows (§5.4).
 */
export function playerRelevance(input: RelevanceInput): number {
    const positive = 1 - relevanceTerms(input).reduce((p, t) => p * (1 - clamp01(t)), 1);
    const proactivity = Number.isFinite(input.proactivity) ? clamp(input.proactivity, 0, 10) : 0;
    const busy = clamp01(input.agendaUrgency) * (proactivity / 10);
    let score = clamp01(positive - busy);
    const snubs = input.stance <= -2 && input.ignores === true;
    if ((input.addressed || input.roleDuty) && !snubs) score = Math.max(score, BUSINESS_FLOOR);
    return Math.round(score * 1000) / 1000;
}

export function bandOf(score: number, gravity: Gravity = 'low'): AttentionBand {
    const t = BAND_THRESHOLDS[gravity] ?? BAND_THRESHOLDS.low;
    if (score >= t.focus) return 'focus';
    if (score >= t.business) return 'business';
    return 'background';
}

export interface BandCandidate {
    id: string;
    score: number;
    /** A strong reason (a scheme ready to spring, a duel accepted) keeps focus beyond the budget. */
    strong?: boolean;
}

export interface BandAllocation {
    id: string;
    score: number;
    band: AttentionBand;
    /** Was focus, demoted to business by the budget. */
    demoted?: boolean;
}

/**
 * Bands for everyone present, with at most `focusBudget` in focus (strong ones exempt). Extra focus is demoted
 * to business, lowest score first; equal scores keep the earlier one. Output keeps input order.
 */
export function allocateBands(
    list: BandCandidate[],
    options: { focusBudget?: number; gravity?: Gravity } = {},
): BandAllocation[] {
    const budget = Math.max(0, Math.floor(options.focusBudget ?? DEFAULT_FOCUS_BUDGET));
    const result: BandAllocation[] = list.map((c) => ({
        id: c.id,
        score: c.score,
        band: bandOf(c.score, options.gravity),
    }));
    const focus = result
        .map((r, index) => ({ r, index, strong: list[index]!.strong === true }))
        .filter((x) => x.r.band === 'focus' && !x.strong)
        .sort((a, b) => b.r.score - a.r.score || a.index - b.index);
    const strongCount = result.filter((r, i) => r.band === 'focus' && list[i]!.strong === true).length;
    const room = Math.max(0, budget - strongCount);
    for (const x of focus.slice(room)) {
        result[x.index] = { ...x.r, band: 'business', demoted: true };
    }
    return result;
}

/** Help or hinder comes from the stance, not the band: hostile in focus pursues, hostile in background ignores. */
export function directionOf(stance: Stance): 'help' | 'hinder' | 'neutral' {
    if (stance >= 1) return 'help';
    if (stance <= -1) return 'hinder';
    return 'neutral';
}

const IGNORE_TACTIC = /ignor|snub|cold shoulder|silent treatment|silence|игнор|молч|не замеча|в упор не|отворачива/i;

/** Whether one of the character's tactics is to ignore / snub (English or Russian words). */
export function tacticIgnores(tactics: string[]): boolean {
    return tactics.some((t) => typeof t === 'string' && IGNORE_TACTIC.test(t));
}
