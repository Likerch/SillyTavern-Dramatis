// The first chat state of a chat (docs/model.md §4.4, §15): what the story starts from, copied from the card-level
// profiles for the greeting the chat began with. Pure: the copies share nothing with the profiles, so story passes
// can change the state without touching the card file.
import { PLAYER_ID } from './model';
import type {
    AppetiteState,
    CardProfiles,
    CharacterProfile,
    CharacterState,
    ChatState,
    Reputation,
    ReputationSeed,
    Tie,
} from './model';

/** Schema of the chat state document this code writes. */
export const CHAT_STATE_SCHEMA = 1;

/** Full self-control reserve (docs/model.md §5.7 «Сдержки»). */
export const FULL_SELF_CONTROL = 3;

function copy<T>(value: T): T {
    return structuredClone(value);
}

/** The start of a profile for a greeting: the exact greeting first, then the «any greeting» one (-1). */
export function startFor(profile: CharacterProfile, greeting: number): CharacterProfile['starts'][number] | undefined {
    return (
        profile.starts.find((start) => start.greeting === greeting) ??
        profile.starts.find((start) => start.greeting === -1)
    );
}

/** A fresh live state of one character for a chat that began with `greeting`. */
export function createCharacterState(profile: CharacterProfile, greeting: number): CharacterState {
    const ties: Record<string, Tie> = {};
    for (const tie of profile.ties) ties[tie.target] = copy(tie);

    const appetites: Record<string, AppetiteState> = {};
    for (const appetite of profile.appetites) {
        appetites[appetite.id] = {
            pressure: appetite.baseline,
            tolerance: appetite.tolerance,
            dependence: appetite.dependence,
            sensitization: appetite.sensitization,
            lastSated: -1,
            edgeCount: 0,
            withdrawal: false,
        };
    }

    const start = startFor(profile, greeting);
    const present = start?.present === true;
    const scene: CharacterState['scene'] = { attention: 'background' };
    if (start?.doing) scene.doing = start.doing;
    if (start?.goal) scene.goal = start.goal;

    return {
        id: profile.id,
        ties,
        mood: copy(profile.core.baselineMood),
        scene,
        appetites,
        agenda: copy(profile.agenda),
        stress: 0,
        corruption: { level: profile.core.corruption, stains: 0, gifts: [], brands: [] },
        arcStage: 'intact',
        present,
        lastSeenTurn: present ? 0 : -1,
        selfControl: FULL_SELF_CONTROL,
        knowsPlayer: Object.hasOwn(ties, PLAYER_ID),
    };
}

/** Reputation of the player at the start: per group, the seed of this greeting wins over the «every start» one. */
export function startingReputation(seeds: readonly ReputationSeed[], greeting: number): Reputation[] {
    const chosen = new Map<string, ReputationSeed>();
    for (const seed of seeds) {
        if (seed.greeting !== greeting && seed.greeting !== -1) continue;
        const previous = chosen.get(seed.among);
        if (!previous || (previous.greeting === -1 && seed.greeting === greeting)) chosen.set(seed.among, seed);
    }
    return [...chosen.values()].map((seed) => ({
        among: seed.among,
        label: seed.label,
        stance: seed.stance,
        weaknesses: [],
        reasons: [],
    }));
}

/**
 * The state a chat starts with: every profile of the card (characters and groups) gets its live state, the world
 * rules and tone are copied, the player's reputation is seeded for this greeting, counters start at zero.
 */
export function initChatState(profiles: CardProfiles, greeting: number, chatCardKey: string): ChatState {
    const characters: Record<string, CharacterState> = {};
    for (const profile of profiles.characters) characters[profile.id] = createCharacterState(profile, greeting);
    return {
        schema: CHAT_STATE_SCHEMA,
        card: chatCardKey,
        worldTone: profiles.worldTone,
        extras: [],
        characters,
        rules: copy(profiles.rules),
        reputation: startingReputation(profiles.reputation, greeting),
        rumours: [],
        schemes: [],
        turn: 0,
        scene: 0,
        greeting,
        log: [],
    };
}

/**
 * The live state of a character, created from the profile when the chat has none yet (a profile added after the chat
 * started, or a generated NPC). Existing states are returned untouched.
 */
export function ensureCharacterState(state: ChatState, profile: CharacterProfile): CharacterState {
    const existing = state.characters[profile.id];
    if (existing) return existing;
    const created = createCharacterState(profile, state.greeting);
    if (created.present) created.lastSeenTurn = state.turn;
    state.characters[profile.id] = created;
    return created;
}
