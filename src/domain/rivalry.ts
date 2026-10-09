// Rivalry over one target (docs/model.md §5.7 «Соперничество», docs/research/appetites.md D7 «Rivalry»).
// Claims grow interest → claimed → owned; rivals either join forces or feud; a jealous claimant becomes a
// guardian of the target against everyone else.
import type { AppetiteRule, Claim } from './model';
import { clamp } from './util';

/** Want at which a pursuer counts as a rival (D7). */
export const RIVAL_WANT = 3;

export const CLAIMS: readonly Claim[] = ['none', 'interest', 'claimed', 'owned'];

export interface Pursuit {
    /** Pursuer id (character id). */
    id: string;
    /** Target id (character id or PLAYER_ID). */
    target: string;
    want: number;
    claim: Claim;
    /** Default 'exclusive'. */
    exclusivity?: AppetiteRule['exclusivity'];
    /** The pursuer's group (pack or tribe members hunt together). */
    group?: string;
    groupMode?: AppetiteRule['groupMode'];
}

export interface ClaimInput {
    want: number;
    /** Other pursuers of the same target (want ≥ RIVAL_WANT). */
    rivals: number;
    /** The target is now in the pursuer's hands (married, captured, bought, won in a duel). */
    acquired?: boolean;
    /** The target was taken away or freed. */
    lost?: boolean;
}

/**
 * Next claim (§5.7): acquiring → owned; losing → interest while want stays high, else none; owned stays owned;
 * want 2+ → interest; interest with want 3+ and a rival (or want 4+ alone) → claimed; fading want steps it back.
 */
export function advanceClaim(claim: Claim, input: ClaimInput): Claim {
    const want = clamp(input.want, 0, 5);
    if (input.acquired) return 'owned';
    if (input.lost) return want >= RIVAL_WANT ? 'interest' : 'none';
    if (claim === 'owned') return 'owned';
    if (claim === 'claimed') return want >= 2 ? 'claimed' : want >= 1 ? 'interest' : 'none';
    if (claim === 'interest') {
        if (want >= 4 || (want >= RIVAL_WANT && input.rivals > 0)) return 'claimed';
        return want >= 1 ? 'interest' : 'none';
    }
    return want >= 2 ? 'interest' : 'none';
}

/** Others who want the same target enough to be rivals. */
export function rivalsOf(pursuit: Pursuit, all: readonly Pursuit[]): Pursuit[] {
    return all.filter(
        (other) => other.id !== pursuit.id && other.target === pursuit.target && other.want >= RIVAL_WANT,
    );
}

export type RivalRelation = 'coalition' | 'feud' | 'tolerate';

/**
 * How two rivals over one target get along: pack mates and friends join forces (CK3 agents); sharers tolerate
 * each other; an exclusive claim staked by either side, or bad blood, means a feud.
 * `stance` = the worse of their stances toward each other (−3…+3).
 */
export function rivalRelation(a: Pursuit, b: Pursuit, stance: number): RivalRelation {
    const packMates =
        a.group !== undefined && a.group === b.group && (a.groupMode === 'pack' || a.groupMode === 'tribe');
    if (packMates || stance >= 1) return 'coalition';
    if (stance <= -1) return 'feud';
    const sharing = (a.exclusivity ?? 'exclusive') !== 'exclusive' && (b.exclusivity ?? 'exclusive') !== 'exclusive';
    if (sharing) return 'tolerate';
    const staked = (p: Pursuit) => p.claim === 'claimed' || p.claim === 'owned';
    return staked(a) || staked(b) ? 'feud' : 'tolerate';
}

/**
 * A claimant's guardian strength against another pursuer (0–2): claimed 1, owned 2. Only exclusive claims guard,
 * and never against a coalition partner.
 */
export function guardStrength(claimant: Pursuit, relation: RivalRelation): number {
    if (relation === 'coalition' || (claimant.exclusivity ?? 'exclusive') !== 'exclusive') return 0;
    return claimant.claim === 'owned' ? 2 : claimant.claim === 'claimed' ? 1 : 0;
}

export interface RivalryPair {
    a: string;
    b: string;
    relation: RivalRelation;
}

export interface RivalryReport {
    target: string;
    /** Pursuers with want ≥ RIVAL_WANT, strongest first. */
    rivals: string[];
    /** Claims after this round (advanceClaim with the rival count). */
    claims: Record<string, Claim>;
    pairs: RivalryPair[];
    /** Guardians each rival meets from the others' claims (capped at 3, feeds opportunity/brakes). */
    guards: Record<string, number>;
}

/**
 * One rivalry round over a target: who competes, how claims grow, who pairs up or feuds and how much the
 * claimants guard the target from the rest. `stanceBetween(a, b)` gives a's stance toward b.
 */
export function analyzeRivalry(
    target: string,
    pursuits: readonly Pursuit[],
    stanceBetween: (a: string, b: string) => number,
): RivalryReport {
    const onTarget = pursuits.filter((p) => p.target === target);
    const rivals = onTarget.filter((p) => p.want >= RIVAL_WANT).sort((x, y) => y.want - x.want);
    const claims: Record<string, Claim> = {};
    const advanced = onTarget.map((p) => {
        const claim = advanceClaim(p.claim, { want: p.want, rivals: rivalsOf(p, onTarget).length });
        claims[p.id] = claim;
        return { ...p, claim };
    });
    const ranked = rivals.flatMap((r) => advanced.filter((p) => p.id === r.id));

    const pairs: RivalryPair[] = [];
    const guards: Record<string, number> = {};
    for (const r of rivals) guards[r.id] = 0;
    ranked.forEach((a, i) => {
        for (const b of ranked.slice(i + 1)) {
            const stance = Math.min(stanceBetween(a.id, b.id), stanceBetween(b.id, a.id));
            const relation = rivalRelation(a, b, stance);
            pairs.push({ a: a.id, b: b.id, relation });
            guards[b.id] = (guards[b.id] ?? 0) + guardStrength(a, relation);
            guards[a.id] = (guards[a.id] ?? 0) + guardStrength(b, relation);
        }
    });
    for (const id of Object.keys(guards)) guards[id] = Math.min(3, guards[id] ?? 0);
    return { target, rivals: rivals.map((r) => r.id), claims, pairs, guards };
}
