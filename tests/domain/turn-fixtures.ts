// Builders for turn pass answers and the cast of the turn tests (not a test file itself).
import { PLAYER_ID } from '../../src/domain/model';
import type { Appetite, CharacterProfile, ChatState } from '../../src/domain/model';
import { emptyProfile } from '../../src/domain/profile-defaults';
import type { TurnCharacterOut, TurnEventOut, TurnPass } from '../../src/domain/turn-prompt';
import { emptyTurnPass } from '../../src/domain/turn-prompt';
import { appetite } from './appetites-fixtures';
import { chat, liveState, raid, tie } from './cast-fixtures';

export function entry(id: string, patch: Partial<TurnCharacterOut> = {}): TurnCharacterOut {
    return {
        id,
        relevant: true,
        emotion: null,
        doing: '',
        sceneGoal: '',
        obstacle: '',
        playerRole: 'none',
        addressedByPlayer: false,
        intentions: [],
        appetites: [],
        keyMatched: '',
        drift: {
            warmthWithoutCause: false,
            appetiteBecameLove: false,
            dependenceVanished: false,
            actedAgainstValues: false,
        },
        newIntention: null,
        ...patch,
    };
}

export function event(
    actor: string,
    target: string,
    act: TurnEventOut['act'],
    text: string,
    patch: Partial<TurnEventOut> = {},
): TurnEventOut {
    return { actor, target, act, text, witnesses: [], intensity: 3, ...patch };
}

export function turnPass(patch: Partial<TurnPass> = {}): TurnPass {
    return { ...emptyTurnPass(), ...patch };
}

/** The raid at the ford, set up so that Грукк cannot act now and prepares a scheme against Мира (§5.7). */
export function ford(): { profiles: CharacterProfile[]; state: ChatState; present: string[] } {
    const { profiles, state } = raid();
    const grukk = profiles.find((profile) => profile.id === 'grukk')!;
    grukk.core = { ...grukk.core, dark: { schemer: true } };
    const mira = profiles.find((profile) => profile.id === 'mira')!;
    mira.ties = [tie('grukk', -2), tie(PLAYER_ID, 0)];
    const guard = (id: string, name: string) =>
        ({ ...emptyProfile(name, { id }), ties: [tie('mira', 2, { intent: 'protect' })] }) as CharacterProfile;
    const olaf = guard('olaf', 'Олаф');
    const ingrid = guard('ingrid', 'Ингрид');
    const carters = { ...emptyProfile('возчики', { id: 'carters' }), kind: 'group' as const };
    const fenn = emptyProfile('Фенн', { id: 'fenn' });
    const all = [...profiles, olaf, ingrid, carters, fenn];
    state.schemes = [];
    state.characters.grukk = { ...state.characters.grukk!, selfControl: 0 };
    state.characters.mira = liveState(mira);
    for (const profile of [olaf, ingrid, carters, fenn]) state.characters[profile.id] = liveState(profile);
    return { profiles: all, state, present: ['grukk', 'mira', 'olaf', 'ingrid', 'carters', 'fenn'] };
}

/** Бортник Ян «завязал» полгода назад (§5.7 «Зависимость»); his daughter Мила keeps him straight. */
export function beekeeper(): { profiles: CharacterProfile[]; state: ChatState } {
    const base = emptyProfile('Ян', { id: 'yan' });
    const drink: Appetite = appetite({
        id: 'drink',
        label: 'брага',
        baseline: 4,
        sensitization: 3,
        vow: 'abstinent',
        endorsement: 'fighting',
        triggers: ['the smell of brew'],
        satisfiers: [{ what: 'a mug', amount: 2 }],
    });
    const yan: CharacterProfile = {
        ...base,
        gender: 'male',
        appetites: [drink],
        core: { ...base.core, anchors: ['mila'] },
    };
    const mila = emptyProfile('Мила', { id: 'mila' });
    const innkeeper = emptyProfile('Корчмарь', { id: 'innkeeper' });
    const state = chat({
        yan: liveState(yan, {
            appetites: {
                drink: {
                    pressure: 2,
                    tolerance: 0,
                    dependence: 0,
                    sensitization: 3,
                    lastSated: -1,
                    edgeCount: 0,
                    withdrawal: false,
                },
            },
        }),
        mila: liveState(mila),
        innkeeper: liveState(innkeeper),
    });
    return { profiles: [yan, mila, innkeeper], state };
}
