// The engine: the one place that holds the current card profiles + chat state and the derived view of the scene
// (who is present, attention bands). Every feature reads and changes the story state through it
// (`app.modules.api<EngineApi>(ENGINE_API)`), so saves, events and the DRAMATIS_API stay consistent.
import type { AttentionBand, CardProfiles, CharacterProfile, ChatState, StateEvent } from '../../domain/model';
import type { Unsubscribe } from '../../shared/contracts';

export const ENGINE_API = 'engine';

export interface EngineView {
    card: CardProfiles;
    state: ChatState;
    /** Card characters + the chat's extras (generated NPCs), effective profiles. */
    profiles: readonly CharacterProfile[];
    byId: ReadonlyMap<string, CharacterProfile>;
    /** Present after the last committed turn (ids, scene order). */
    present: readonly string[];
    /** Names present in the scene without a profile (the latest reply; the generator sketches them once committed). */
    unknown: readonly string[];
    /** Attention band per present id (static before stage 2, from `state.next.bands` after). */
    bands: Readonly<Record<string, AttentionBand>>;
    /** The player's character name as the story writes it. */
    playerName: string;
    /** Starting greeting of the chat. */
    greeting: number;
}

export interface EngineApi {
    /** The current view, or null outside a solo chat / before the first load. */
    view(): EngineView | null;
    /** Resolves once the current chat is loaded. */
    ready(): Promise<EngineView | null>;
    /**
     * Changes the chat state: the mutator gets a deep clone (and the view) and returns the new state (or mutates the
     * clone and returns nothing). Saved with the version check, events emitted, view rebuilt. False when not saved
     * (no chat, another tab won).
     */
    updateState(mutate: (state: ChatState, view: EngineView) => ChatState | void): Promise<boolean>;
    /** Same for the card profiles (also re-derives the chat view; new characters get a CharacterState). */
    updateProfiles(mutate: (profiles: CardProfiles, view: EngineView | null) => CardProfiles | void): Promise<boolean>;
    /** Recomputes presence and bands now (after a committed turn, a reply, a chat load). */
    refresh(): Promise<void>;
    /** Story name → profile id (presence matching, plus Maestro's names when present). */
    resolve(name: string): string | null;
    /** Appends story log lines inside the next save (kept to the last 300). */
    log(events: StateEvent[]): void;
    onChange(listener: (view: EngineView | null) => void): Unsubscribe;
}
