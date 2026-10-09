// Every change the sheet makes, as calls on the EngineApi (the engine saves, emits and rebuilds the view).
//
// Provenance follows docs/model.md §7: an edit by the user marks its field `{ origin: 'user', locked: true }`, so a
// re-read of the author's intent never overwrites it (it lists a difference instead). The mark goes on the same
// "unit" the intent reading writes ('core.values', 'ties.@player', 'appetites.drink', 'agenda.front', 'rules.<id>'),
// so an edit of one sub-field (a tie's stance) protects the unit the reader would replace as a whole.
//
// Card characters live in the card profiles (`updateProfiles`); characters created in this chat (`state.extras`)
// live in the chat state (`updateState`). The live state of a character (mood, scene, current stances…) is always in
// the chat state.
import { PLAYER_ID } from '../../domain/model';
import type {
    AppetiteRule,
    CardProfiles,
    CharacterProfile,
    CharacterState,
    ChatState,
    FieldMeta,
    Origin,
    Reason,
    Stance,
    StateEvent,
    Tie,
} from '../../domain/model';
import {
    emptyProfile,
    emptyTie,
    getPath,
    isDict,
    isLocked,
    metaAt,
    setMeta,
    setPath,
} from '../../domain/profile-defaults';
import { ensureCharacterState } from '../../domain/state-init';
import type { EngineApi, EngineView } from '../engine/api';
import type { IntentDiffEntry } from './types';

interface MetaHolder {
    meta: Record<string, FieldMeta>;
}

/** Heads whose second segment names the unit the intent reading writes as a whole. */
const UNIT_HEADS = new Set(['core', 'agenda', 'ties', 'appetites', 'rules']);

/** Prefix of the reason a user's stance decision adds to a live tie. */
export const USER_REASON = 'user';

/** The meta of a user edit (§7: «твоя правка закрепляется сама»). */
export function userMeta(): FieldMeta {
    return { origin: 'user', locked: true };
}

/** The provenance unit of a path: 'ties.@player.stance' → 'ties.@player', 'core.wound.lie' → 'core.wound'. */
export function metaUnit(path: string): string {
    const parts = path.split('.').filter(Boolean);
    const head = parts[0] ?? '';
    if (UNIT_HEADS.has(head) && parts.length >= 2) return `${head}.${parts[1]}`;
    return head;
}

export function isExtra(view: EngineView | null, id: string): boolean {
    return !!view?.state.extras.some((profile) => profile.id === id);
}

/** Value at `path` replaced by `updater(current)`, the unit marked as the user's. */
function userEdit<T extends MetaHolder>(holder: T, path: string, updater: (current: unknown) => unknown): T {
    const next = setPath(holder, path, updater(getPath(holder, path)));
    return setMeta(next, metaUnit(path), userMeta());
}

/** The lock of a unit flipped; the origin (and quotes) stay. Fields without meta count as generated. */
function flipLock<T extends MetaHolder>(holder: T, unit: string): T {
    const own = holder.meta[unit] ?? metaAt(holder, unit);
    const meta: FieldMeta = own ? { ...own } : { origin: 'generated' };
    if (isLocked(holder, unit)) delete meta.locked;
    else meta.locked = true;
    return setMeta(holder, unit, meta);
}

/** Changes one profile wherever it lives (the card's characters or this chat's extras). */
export function updateProfile(
    engine: EngineApi,
    id: string,
    change: (profile: CharacterProfile) => CharacterProfile,
): Promise<boolean> {
    if (isExtra(engine.view(), id)) {
        return engine.updateState((state) => {
            state.extras = state.extras.map((profile) => (profile.id === id ? change(profile) : profile));
        });
    }
    return engine.updateProfiles((card) => ({
        ...card,
        characters: card.characters.map((profile) => (profile.id === id ? change(profile) : profile)),
    }));
}

/** A user edit of a profile field (value from the current one: no lost update when the view was stale). */
export function editProfile(
    engine: EngineApi,
    id: string,
    path: string,
    updater: (current: unknown) => unknown,
): Promise<boolean> {
    return updateProfile(engine, id, (profile) => userEdit(profile, path, updater));
}

export function toggleProfileLock(engine: EngineApi, id: string, unit: string): Promise<boolean> {
    return updateProfile(engine, id, (profile) => flipLock(profile, unit));
}

/** A user edit of a card-level field (worldTone, invariants, reputation, rules.<id>). */
export function editCard(engine: EngineApi, path: string, updater: (current: unknown) => unknown): Promise<boolean> {
    return engine.updateProfiles((card) => userEdit(card, path, updater));
}

export function toggleCardLock(engine: EngineApi, unit: string): Promise<boolean> {
    return engine.updateProfiles((card) => flipLock(card, unit));
}

/** Changes the live state of a character (created from its profile when the chat has none yet). */
export function editCharState(
    engine: EngineApi,
    id: string,
    mutate: (live: CharacterState, state: ChatState) => void,
): Promise<boolean> {
    return engine.updateState((state, view) => {
        let live = state.characters[id];
        if (!live) {
            const profile = view.byId.get(id);
            if (!profile) return;
            live = ensureCharacterState(state, profile);
        }
        mutate(live, state);
    });
}

/** The world tone: the card's (marked as the user's) and this chat's. */
export async function setWorldTone(engine: EngineApi, tone: CardProfiles['worldTone']): Promise<boolean> {
    const card = await editCard(engine, 'worldTone', () => tone);
    if (!card) return false;
    return engine.updateState((state) => {
        state.worldTone = tone;
    });
}

/* ------------------------------------------------------------------ ties */

function isTie(value: unknown): value is Tie {
    return isDict(value) && typeof value.target === 'string' && Array.isArray(value.reasons);
}

/**
 * A field of a tie the story also keeps (intent, want, gaze, claim, lists): written to the profile's tie (the user's
 * design) and to the live tie of this chat when it has one, so the change shows now and in new chats.
 */
export async function editTieField(
    engine: EngineApi,
    id: string,
    target: string,
    field: keyof Tie,
    value: unknown,
): Promise<boolean> {
    const set = (tie: Tie): Tie => {
        const next = { ...tie } as Record<string, unknown>;
        if (value === undefined) delete next[field];
        else next[field] = value;
        return next as unknown as Tie;
    };
    const saved = await editProfile(engine, id, `ties.${target}`, (tie) => set(isTie(tie) ? tie : emptyTie(target)));
    if (!saved) return false;
    if (!engine.view()?.state.characters[id]?.ties[target]) return true;
    return engine.updateState((state) => {
        const live = state.characters[id];
        const tie = live?.ties[target];
        if (live && tie) live.ties[target] = set(tie);
    });
}

/** A new tie in the profile and in the live state (so the chat sees it at once). */
export async function addTie(engine: EngineApi, id: string, target: string): Promise<boolean> {
    const saved = await editProfile(engine, id, `ties.${target}`, (tie) => (isTie(tie) ? tie : emptyTie(target)));
    if (!saved) return false;
    if (!engine.view()?.state.characters[id]) return true;
    return editCharState(engine, id, (live) => {
        live.ties[target] ??= emptyTie(target);
    });
}

/** Removes a tie from the profile (marked as the user's choice) and from the live state. */
export async function removeTie(engine: EngineApi, id: string, target: string): Promise<boolean> {
    const saved = await editProfile(engine, id, `ties.${target}`, () => undefined);
    if (!saved) return false;
    if (!engine.view()?.state.characters[id]?.ties[target]) return true;
    return engine.updateState((state) => {
        const live = state.characters[id];
        if (live) delete live.ties[target];
    });
}

/**
 * The user decides the current stance of a live tie: the stance moves and a permanent reason «по твоему решению»
 * (origin 'user') carries the difference, so the stance does not drift back at the scene end (relations.onSceneEnd).
 * Repeated decisions fold into that one reason; a decision that undoes it removes it.
 */
export function setCurrentStance(
    engine: EngineApi,
    id: string,
    target: string,
    stance: Stance,
    reasonText: string,
    logText?: string,
): Promise<boolean> {
    const view = engine.view();
    const before = view?.state.characters[id]?.ties[target]?.stance;
    if (logText && before !== stance) {
        const event: StateEvent = { turn: view?.state.turn ?? 0, character: id, kind: 'user', text: logText };
        engine.log([event]);
    }
    return engine.updateState((state, current) => {
        const profile = current.byId.get(id);
        let live = state.characters[id];
        if (!live) {
            if (!profile) return;
            live = ensureCharacterState(state, profile);
        }
        const base = profile?.ties.find((tie) => tie.target === target);
        const tie: Tie = live.ties[target] ?? (base ? structuredClone(base) : emptyTie(target));
        const delta = stance - tie.stance;
        if (delta === 0) return;
        const reasons = tie.reasons.slice();
        const at = reasons.findIndex((reason) => isUserReason(reason));
        if (at >= 0) {
            const merged = Math.round((reasons[at]!.delta + delta) * 1000) / 1000;
            if (merged === 0) reasons.splice(at, 1);
            else reasons[at] = { ...reasons[at]!, text: reasonText, delta: merged, scenesLeft: null };
        } else {
            const ids = new Set(reasons.map((reason) => reason.id));
            let n = 1;
            while (ids.has(`${USER_REASON}-${n}`)) n++;
            const reason: Reason & { origin: Origin } = {
                id: `${USER_REASON}-${n}`,
                text: reasonText,
                delta,
                scenesLeft: null,
                stacks: 1,
                scene: state.scene,
                origin: 'user',
            };
            reasons.push(reason);
        }
        const next: Tie = { ...tie, stance, reasons };
        delete next.progress;
        live.ties[target] = next;
    });
}

/** A reason the user added through a stance decision. */
export function isUserReason(reason: Reason): boolean {
    return (reason as Reason & { origin?: Origin }).origin === 'user' || reason.id.startsWith(`${USER_REASON}-`);
}

export function removeLiveReason(engine: EngineApi, id: string, target: string, reasonId: string): Promise<boolean> {
    return engine.updateState((state) => {
        const tie = state.characters[id]?.ties[target];
        if (tie) tie.reasons = tie.reasons.filter((reason) => reason.id !== reasonId);
    });
}

/* ------------------------------------------------------------------ characters */

/** Adds a character or a group to the card (a sketch, its name and kind marked as the user's). Returns the id. */
export async function addCharacter(
    engine: EngineApi,
    name: string,
    kind: CharacterProfile['kind'],
): Promise<string | null> {
    let id: string | null = null;
    const saved = await engine.updateProfiles((card, view) => {
        const taken = [...card.characters.map((profile) => profile.id), ...(view?.state.extras ?? []).map((p) => p.id)];
        let profile = emptyProfile(name, { taken, kind, lod: 'sketch' });
        profile = setMeta(setMeta(profile, 'name', userMeta()), 'kind', userMeta());
        id = profile.id;
        return { ...card, characters: [...card.characters, profile] };
    });
    return saved ? id : null;
}

/** Removes a character from the card (or this chat's extras) and its live state in this chat. */
export async function deleteCharacter(engine: EngineApi, id: string): Promise<boolean> {
    if (isExtra(engine.view(), id)) {
        return engine.updateState((state) => {
            state.extras = state.extras.filter((profile) => profile.id !== id);
            delete state.characters[id];
            state.schemes = state.schemes.filter((scheme) => scheme.owner !== id);
        });
    }
    const saved = await engine.updateProfiles((card) => ({
        ...card,
        characters: card.characters.filter((profile) => profile.id !== id),
    }));
    if (!saved) return false;
    if (!engine.view()?.state.characters[id]) return true;
    return engine.updateState((state) => {
        delete state.characters[id];
    });
}

/* ------------------------------------------------------------------ rules */

export function saveCardRule(engine: EngineApi, rule: AppetiteRule): Promise<boolean> {
    return editCard(engine, `rules.${rule.id}`, () => rule);
}

export function removeCardRule(engine: EngineApi, ruleId: string): Promise<boolean> {
    return editCard(engine, `rules.${ruleId}`, () => undefined);
}

export function saveChatRule(engine: EngineApi, rule: AppetiteRule): Promise<boolean> {
    return engine.updateState((state) => {
        const at = state.rules.findIndex((other) => other.id === rule.id);
        if (at >= 0) state.rules[at] = rule;
        else state.rules.push(rule);
    });
}

export function removeChatRule(engine: EngineApi, ruleId: string): Promise<boolean> {
    return engine.updateState((state) => {
        state.rules = state.rules.filter((rule) => rule.id !== ruleId);
    });
}

/* ------------------------------------------------------------------ the author's value back (re-read diff) */

/** Drops the meta of a path and everything below it, then marks the path as the author's (unlocked). */
function authorAgain<T extends MetaHolder>(holder: T, path: string): T {
    const meta: Record<string, FieldMeta> = {};
    for (const [key, value] of Object.entries(holder.meta)) {
        if (key === path || key.startsWith(`${path}.`)) continue;
        meta[key] = value;
    }
    meta[path] = { origin: 'author' };
    return { ...holder, meta };
}

/**
 * «Взять авторское»: the value the new reading proposed replaces the user's (or the locked) one, and the field goes
 * back to the author, unlocked. Card-level entries change the card; others the character's profile.
 */
export function takeAuthor(engine: EngineApi, entry: IntentDiffEntry): Promise<boolean> {
    const value = entry.after === undefined ? undefined : structuredClone(entry.after);
    const apply = <T extends MetaHolder>(holder: T): T => authorAgain(setPath(holder, entry.path, value), entry.path);
    if (entry.character) return updateProfile(engine, entry.character, apply);
    return engine.updateProfiles((card) => apply(card));
}

/** Display name of a tie target or character id (the player under his persona name). */
export function nameOf(view: EngineView, id: string): string {
    if (id === PLAYER_ID) return view.playerName;
    return view.byId.get(id)?.name ?? id;
}
