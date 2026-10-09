// Pieces of the engine view that need no services: the effective cast of a chat (card characters + the chat's extras),
// the freshness of the passes' results (`state.next`) and the static attention bands used before the turn pass
// (stage 2) computes them — docs/model.md §5.4 from what the stored state already says.
import { allocateBands, playerRelevance, tacticIgnores, DEFAULT_FOCUS_BUDGET } from '../../domain/attention';
import type { Gravity, PlayerRole, RelevanceInput } from '../../domain/attention';
import { PLAYER_ID } from '../../domain/model';
import type {
    Agenda,
    AttentionBand,
    CardProfiles,
    CharacterProfile,
    CharacterState,
    ChatState,
    NextTurn,
    Tie,
    TieIntent,
} from '../../domain/model';

/** Card characters, then the chat's extras whose ids the card does not use. */
export function effectiveProfiles(card: CardProfiles, state: ChatState): CharacterProfile[] {
    const out: CharacterProfile[] = [];
    const seen = new Set<string>();
    for (const profile of [...card.characters, ...(state.extras ?? [])]) {
        if (!profile || typeof profile.id !== 'string' || seen.has(profile.id)) continue;
        seen.add(profile.id);
        out.push(profile);
    }
    return out;
}

/** What the passes prepared for this turn: `state.next` when it was computed after the current committed turn. */
export function freshNext(state: ChatState): NextTurn | undefined {
    const next = state.next;
    return next && next.turn === state.turn ? next : undefined;
}

/** Roles whose duty is to deal with a visitor (an innkeeper serves a guest, a guard checks papers), EN and RU stems. */
const DUTY_EN =
    /\b(inn ?keeper|tavern ?keeper|barkeep(?:er)?|bartender|barmaid|landlady|landlord|guard(?:sman|s)?|sentry|sentinel|watchman|gatekeeper|gate guard|merchant|trader|vendor|peddler|shop ?keeper|shopkeep|storekeeper|servant|maid|butler|footman|steward|clerk|scribe|receptionist|healer|physician|doctor|medic|nurse|waiter|waitress|porter|ferryman|customs officer|attendant)\b/i;
const DUTY_RU =
    /(?:^|[^\p{L}])(трактирщ|корчмар|кабатчи|бармен|буфетчи|страж|часово|охранни|караульн|привратни|торговк|торговец|торговц|купец|купц|купчих|лавочни|продав|слуг|служанк|горничн|дворецк|лакей|писар|клерк|лекар|целител|врач|санитар|официант|подавальщ|носильщ|перевозчик|таможенн)/iu;

export function hasRoleDuty(role: string | undefined): boolean {
    if (!role?.trim()) return false;
    return DUTY_EN.test(role) || DUTY_RU.test(role);
}

/** 0–1: how full the most advanced intention clock is. */
export function agendaUrgency(agenda: Agenda | undefined): number {
    let best = 0;
    for (const intention of agenda?.intentions ?? []) {
        const clock = intention.clock;
        if (!clock || !(clock.segments > 0)) continue;
        best = Math.max(best, Math.min(1, Math.max(0, clock.filled) / clock.segments));
    }
    return best;
}

/** The player's role in what the character means to do with him (the tie's intent). */
const INTENT_ROLE: Record<TieIntent, PlayerRole> = {
    none: 'none',
    avoid: 'none',
    recruit: 'target',
    extract: 'means',
    use: 'means',
    avenge: 'target',
    protect: 'target',
    seduce: 'target',
    court: 'target',
};

/** Live tie toward the player, else the profile's base tie. */
export function playerTie(profile: CharacterProfile, live: CharacterState | undefined): Tie | undefined {
    return live?.ties[PLAYER_ID] ?? profile.ties.find((tie) => tie.target === PLAYER_ID);
}

/** Pressure of the appetite behind the tie's want (or of the strongest appetite aimed at people). */
function wantPressure(profile: CharacterProfile, live: CharacterState | undefined, tie: Tie | undefined): number {
    if (!tie?.want) return 0;
    const pressureOf = (id: string, baseline: number) => live?.appetites[id]?.pressure ?? baseline;
    if (tie.appetite) {
        const appetite = profile.appetites.find((item) => item.id === tie.appetite);
        return appetite ? pressureOf(appetite.id, appetite.baseline) : (live?.appetites[tie.appetite]?.pressure ?? 0);
    }
    return Math.max(
        0,
        ...profile.appetites
            .filter((appetite) => appetite.target.mode !== 'thing')
            .map((appetite) => pressureOf(appetite.id, appetite.baseline)),
    );
}

/** Relevance inputs of one present character from the stored state (no turn pass yet). */
export function relevanceInput(
    profile: CharacterProfile,
    live: CharacterState | undefined,
    scene: { addressed: boolean; near: boolean },
): RelevanceInput {
    const tie = playerTie(profile, live);
    return {
        roleInIntention: INTENT_ROLE[tie?.intent ?? 'none'] ?? 'none',
        stance: tie?.stance ?? 0,
        openDebts: tie?.debts?.length ?? 0,
        grudges: 0,
        needPull: 0,
        want: tie?.want ?? 0,
        pressure: wantPressure(profile, live, tie),
        addressed: scene.addressed,
        near: scene.near,
        roleDuty: hasRoleDuty(profile.role),
        agendaUrgency: agendaUrgency(live?.agenda ?? profile.agenda),
        proactivity: profile.core?.proactivity ?? 0,
        ignores: tacticIgnores(profile.core?.tactics ?? []),
    };
}

export interface BandOptions {
    gravity: Gravity;
    /** Ids the player's last message names. */
    addressed: ReadonlySet<string>;
}

/** Focus budget by gravity: 2, and 3 when the player's pull is high. */
export function focusBudget(gravity: Gravity): number {
    return gravity === 'high' ? DEFAULT_FOCUS_BUDGET + 1 : DEFAULT_FOCUS_BUDGET;
}

/** Bands computed from the stored state alone (playerRelevance + allocateBands). */
export function staticBands(
    present: readonly string[],
    byId: ReadonlyMap<string, CharacterProfile>,
    state: ChatState,
    options: BandOptions,
): Record<string, AttentionBand> {
    const candidates = present
        .filter((id) => byId.has(id))
        .map((id) => {
            const input = relevanceInput(byId.get(id)!, state.characters[id], {
                addressed: options.addressed.has(id),
                near: true,
            });
            return { id, score: playerRelevance(input) };
        });
    const out: Record<string, AttentionBand> = {};
    for (const item of allocateBands(candidates, {
        focusBudget: focusBudget(options.gravity),
        gravity: options.gravity,
    })) {
        out[item.id] = item.band;
    }
    return out;
}

/** The turn pass's bands when fresh (`state.next.turn === state.turn`), static ones for everyone it did not cover. */
export function sceneBands(
    present: readonly string[],
    byId: ReadonlyMap<string, CharacterProfile>,
    state: ChatState,
    options: BandOptions,
): Record<string, AttentionBand> {
    const fresh = freshNext(state)?.bands;
    const missing = fresh ? present.filter((id) => !fresh[id]) : present;
    const out = missing.length ? staticBands(missing, byId, state, options) : {};
    if (fresh) for (const id of present) if (fresh[id]) out[id] = fresh[id];
    return out;
}
