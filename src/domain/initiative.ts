// Who acts on their own this turn (docs/model.md §5.5). The engine rolls, not the model: the model cannot pick the
// convenient outcome. Chance grows with proactivity, agenda urgency, appetite pressure and an active mood; the picked
// characters prefer business with other present NPCs and turn to the player only when he is their focus or prey.
import type { AttentionBand, Move, MoodOctant, Stance, TieIntent } from './model';
import { PLAYER_ID } from './model';
import type { Rng } from '../shared/contracts';
import { clamp, clamp01 } from './util';

export interface InitiativeTie {
    target: string;
    intent: TieIntent;
    stance: Stance;
    /** Desirability 0–5 (§4.5). */
    want?: number;
}

export interface InitiativeCandidate {
    id: string;
    /** 0–10. */
    proactivity: number;
    /** 0–1: urgency of the own agenda. */
    urgency: number;
    /** 0–5: strongest appetite pressure now. */
    pressure: number;
    mood: MoodOctant;
    /** Attention band toward the player. */
    band: AttentionBand;
    ties: InitiativeTie[];
    /** The next step of their intention lies elsewhere. */
    elsewhere?: boolean;
}

export interface InitiativePick {
    id: string;
    move: Move;
    /** Character id or PLAYER_ID; absent for own business and leaving. */
    target?: string;
    weight: number;
}

/** Active moods make a character act, flat ones keep it still. */
export const MOOD_FACTOR: Record<MoodOctant, number> = {
    hostile: 1.4,
    exuberant: 1.3,
    anxious: 1.2,
    dependent: 1,
    disdainful: 1,
    relaxed: 0.9,
    docile: 0.7,
    bored: 0.7,
};

/** Desirability from which the player is worth an unprompted move. */
export const WANT_TO_ACT = 3;

/** Which NPC intents come first when several present characters are candidates. */
const INTENT_ORDER: Record<TieIntent, number> = {
    avenge: 0,
    protect: 1,
    extract: 2,
    recruit: 3,
    use: 4,
    seduce: 5,
    court: 6,
    avoid: 7,
    none: 99,
};

/** weight = proactivity/10 × (0.5 + urgency) × (1 + pressure/5) × mood factor. */
export function initiativeWeight(c: InitiativeCandidate): number {
    const proactivity = clamp(Number.isFinite(c.proactivity) ? c.proactivity : 0, 0, 10) / 10;
    const pressure = clamp(Number.isFinite(c.pressure) ? c.pressure : 0, 0, 5);
    return proactivity * (0.5 + clamp01(c.urgency)) * (1 + pressure / 5) * (MOOD_FACTOR[c.mood] ?? 1);
}

function moveForIntent(intent: TieIntent, stance: Stance): Move {
    if (intent === 'avoid') return 'leave';
    if (intent === 'avenge') return 'obstruct';
    if (intent === 'none' && stance <= -1) return 'obstruct';
    return 'initiate';
}

/**
 * The move a picked character makes: an NPC with whom it has an intent (most pressing intent, then strongest stance
 * and want); otherwise the player when he is its focus or its want toward him ≥ 3; otherwise its own business —
 * or leaving when its business is elsewhere or it is bored with nothing to press.
 */
export function suggestMove(c: InitiativeCandidate, present: ReadonlySet<string>): Omit<InitiativePick, 'weight'> {
    const npc = c.ties
        .filter((t) => t.target !== PLAYER_ID && t.target !== c.id && present.has(t.target) && t.intent !== 'none')
        .sort(
            (a, b) =>
                (INTENT_ORDER[a.intent] ?? 99) - (INTENT_ORDER[b.intent] ?? 99) ||
                Math.abs(b.stance) - Math.abs(a.stance) ||
                (b.want ?? 0) - (a.want ?? 0),
        )[0];
    if (npc) return { id: c.id, move: moveForIntent(npc.intent, npc.stance), target: npc.target };

    const player = c.ties.find((t) => t.target === PLAYER_ID);
    if (c.band === 'focus' || (player?.want ?? 0) >= WANT_TO_ACT) {
        return { id: c.id, move: moveForIntent(player?.intent ?? 'none', player?.stance ?? 0), target: PLAYER_ID };
    }
    if (c.elsewhere || (c.mood === 'bored' && clamp01(c.urgency) < 0.3)) return { id: c.id, move: 'leave' };
    return { id: c.id, move: 'own' };
}

/**
 * Rolls up to `max` (1–2) distinct actors by weight, without replacement. Characters with zero weight never act.
 * `present` defaults to the candidates themselves (NPC targets must be present).
 */
export function rollInitiative(
    chars: InitiativeCandidate[],
    rng: Rng,
    options: { max?: number; present?: string[] } = {},
): InitiativePick[] {
    const max = clamp(Math.floor(options.max ?? 1), 0, 2);
    const present = new Set(options.present ?? chars.map((c) => c.id));
    const pool = chars.map((c) => ({ c, w: initiativeWeight(c) })).filter((x) => x.w > 0);
    const picks: InitiativePick[] = [];
    while (picks.length < max && pool.length > 0) {
        const total = pool.reduce((s, x) => s + x.w, 0);
        let roll = clamp01(rng()) * total;
        let index = pool.length - 1;
        for (let i = 0; i < pool.length; i++) {
            roll -= pool[i]!.w;
            if (roll < 0) {
                index = i;
                break;
            }
        }
        const [chosen] = pool.splice(index, 1);
        picks.push({ ...suggestMove(chosen!.c, present), weight: Math.round(chosen!.w * 1000) / 1000 });
    }
    return picks;
}
