// The examples of docs/model.md §4.6, §5.6, §5.7 and §6.2: the tavern (Ильва, Брам, Сота, Фенн, the carters) with
// the player as an imperial courier, and the goblin raid at the ford (Грукк, Мира).
import { PLAYER_ID } from '../../src/domain/model';
import type { CharacterProfile, CharacterState, ChatState, Reason, Tie } from '../../src/domain/model';
import { emptyProfile, emptyTie } from '../../src/domain/profile-defaults';

export function reason(text: string, delta: number, scenesLeft: number | null = null, id = text): Reason {
    return { id, text, delta, scenesLeft, stacks: 1 };
}

export function tie(target: string, stance: Tie['stance'], patch: Partial<Tie> = {}): Tie {
    return { ...emptyTie(target, stance), ...patch };
}

export function profile(id: string, name: string, patch: Partial<CharacterProfile> = {}): CharacterProfile {
    return { ...emptyProfile(name, { id }), ...patch };
}

export function liveState(profileOf: CharacterProfile, patch: Partial<CharacterState> = {}): CharacterState {
    const ties: Record<string, Tie> = {};
    for (const item of profileOf.ties) ties[item.target] = item;
    return {
        id: profileOf.id,
        ties,
        mood: profileOf.core.baselineMood,
        scene: { attention: 'background' },
        appetites: {},
        agenda: profileOf.agenda,
        stress: 0,
        corruption: { level: 0, stains: 0, gifts: [], brands: [] },
        arcStage: 'intact',
        present: true,
        lastSeenTurn: 0,
        selfControl: 3,
        knowsPlayer: true,
        ...patch,
    };
}

export function chat(characters: Record<string, CharacterState> = {}, patch: Partial<ChatState> = {}): ChatState {
    return {
        schema: 1,
        card: 'card.png',
        worldTone: 'indifferent',
        extras: [],
        characters,
        rules: [],
        reputation: [],
        rumours: [],
        schemes: [],
        turn: 0,
        scene: 0,
        greeting: 0,
        log: [],
        ...patch,
    };
}

/* ------------------------------------------------------------------ the tavern */

export function tavern(): { profiles: CharacterProfile[]; state: ChatState } {
    const base = emptyProfile('Ильва', { id: 'ilva' });
    const ilva: CharacterProfile = {
        ...base,
        gender: 'female',
        role: 'innkeeper',
        core: {
            ...base.core,
            concept: "a rebel's widow who keeps the inn to spite the occupiers",
            values: { top: ['benevolence', 'self-direction', 'tradition'], sacrifice: 'security' },
            signatures: ['if she is ordered about, does it slowly and badly'],
            tactics: ['bluntness', 'silence', 'refusing small favours'],
            baselineMood: { octant: 'hostile', label: 'grim watchfulness' },
            proactivity: 6,
            keys: ['protection of her daughter', 'honest payment of the town debts'],
        },
        agenda: { ...base.agenda, secrets: ['passes letters to the rebels'] },
        ties: [
            tie(PLAYER_ID, -2, {
                reasons: [
                    reason('an imperial', -2),
                    reason('the Empire hanged her husband', -1),
                    reason('paid generously', 1, 2),
                ],
                behaviour: 'takes his coin, gives nothing back, never says his name',
            }),
            tie('bram', 1, { reasons: [reason('useful, but drinks', 1)] }),
            tie('sota', 3, { reasons: [reason('her daughter', 3)], intent: 'protect' }),
        ],
        starts: [
            {
                greeting: 0,
                present: true,
                doing: "counting the week's takings",
                goal: 'must raise the garrison tax by Friday',
            },
        ],
    };
    const bram = profile('bram', 'Брам', {
        gender: 'male',
        ties: [
            tie(PLAYER_ID, 0, {
                reasons: [reason('sees a purse', 0)],
                behaviour: 'will offer "protection" at a steep price',
            }),
        ],
        starts: [
            { greeting: 0, present: true, doing: 'dicing with the carters', goal: 'wants paid work before winter' },
        ],
    });
    const sota = profile('sota', 'Сота', {
        gender: 'female',
        ties: [
            tie(PLAYER_ID, 1, {
                reasons: [reason('curious about the stranger', 1)],
                behaviour: 'hides her interest from her mother',
            }),
        ],
        starts: [
            { greeting: 0, present: true, doing: 'wiping tables, listening', goal: 'wants a way out of this town' },
        ],
    });
    const fenn = profile('fenn', 'Фенн', { starts: [{ greeting: 0, present: true, doing: 'asleep' }] });
    const carters = profile('carters', 'the carters', {
        kind: 'group',
        starts: [{ greeting: 0, present: true, doing: 'dice' }],
    });
    const profiles = [ilva, bram, sota, fenn, carters];
    const characters: Record<string, CharacterState> = {};
    for (const item of profiles) {
        const start = item.starts[0];
        characters[item.id] = liveState(item, {
            scene: { attention: 'background', doing: start?.doing, goal: start?.goal },
        });
    }
    return { profiles, state: chat(characters, { card: 'tavern.png' }) };
}

export const TAVERN_BANDS = {
    ilva: 'business',
    bram: 'business',
    sota: 'focus',
    carters: 'background',
    fenn: 'background',
} as const;

export const TAVERN_PRESENT = ['ilva', 'bram', 'sota', 'carters', 'fenn'];

/* ------------------------------------------------------------------ the raid at the ford */

export function raid(): { profiles: CharacterProfile[]; state: ChatState } {
    const base = emptyProfile('Грукк', { id: 'grukk' });
    const grukk: CharacterProfile = {
        ...base,
        gender: 'male',
        species: 'goblin',
        appetites: [
            {
                id: 'plunder',
                kind: 'plunder',
                sources: ['culture'],
                target: { mode: 'class', class: 'lowlanders' },
                baseline: 3,
                liking: 1,
                triggers: ['unguarded goods'],
                satisfiers: [{ what: 'a captive', amount: 4 }],
                drift: 'opportunity',
                tolerance: 0,
                dependence: 0,
                sensitization: 0,
                endorsement: 'proud',
                vow: 'none',
                visibility: 'open',
                style: 'raider',
                affectionOnset: 'rare',
                excuse: 'whoever leaves goods unguarded has given them away',
                restraints: ["the chief's ban on raids near the road"],
            },
        ],
        ties: [
            tie('mira', -1, {
                reasons: [reason('a soft lowlander', -1)],
                want: 4,
                gaze: 'property',
                appetite: 'plunder',
            }),
            tie(PLAYER_ID, -1, { reasons: [reason('a guard with a sword', -1)] }),
        ],
        starts: [
            { greeting: 0, present: true, doing: 'loitering by the carts', goal: 'learn when the caravan leaves' },
        ],
    };
    const mira = profile('mira', 'Мира', {
        gender: 'female',
        role: 'merchant',
        starts: [{ greeting: 0, present: true, doing: 'checking her wagon' }],
    });
    const characters: Record<string, CharacterState> = {
        grukk: liveState(grukk, {
            scene: { attention: 'business', doing: 'loitering by the carts', goal: 'learn when the caravan leaves' },
            appetites: {
                plunder: {
                    pressure: 4,
                    tolerance: 0,
                    dependence: 0,
                    sensitization: 0,
                    lastSated: -1,
                    edgeCount: 0,
                    withdrawal: false,
                },
            },
        }),
        mira: liveState(mira, { scene: { attention: 'background', doing: 'checking her wagon' } }),
    };
    const state = chat(characters, {
        card: 'ford.png',
        schemes: [
            {
                id: 's1',
                owner: 'grukk',
                target: 'mira',
                appetite: 'plunder',
                method: 8,
                text: 'asks the carters when the caravan leaves, plans to cut off her wagon at the ford at dusk',
                clock: { segments: 5, filled: 3 },
                secrecy: 70,
                breaches: 0,
                accomplices: [],
                state: 'running',
                startedTurn: 0,
            },
        ],
    });
    return { profiles: [grukk, mira], state };
}
