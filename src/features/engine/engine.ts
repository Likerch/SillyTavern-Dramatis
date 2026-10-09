// The engine service behind EngineApi (api.ts): holds the current card profiles and chat state, derives the scene view
// (who is present, attention bands) and is the one door through which features change them.
//
// - Loads on start and on bus `chat:changed`, `profiles:changed` (this card) and `state:changed` (this chat); a group
//   chat or no chat gives a null view. Profiles without a live state get one in memory (ensureCharacterState) — it is
//   written with the next update, so merely opening a chat writes nothing.
// - Presence (refresh on `reply:ready`, `turn:committed`, invalidated messages, Maestro coming or going, and on every
//   load): the DES tracker of the last reply when there is one (names nobody has a profile for stay in `unknown` for the
//   generator; Maestro's name gluing gets a second try), else the names in the last 3 messages with the card's own
//   character always present; until the user's first message the starting scene's `present` flags count too.
// - Bands: the turn pass's `state.next.bands` when computed after the current turn, else static ones (view.ts).
// - Updates are serialised. Each mutator gets a deep clone; a state save that lost the version race to another tab
//   reloads and retries once. Queued log lines go into the next state save (the last 300 are kept).
import { ensureCharacterState } from '../../domain/state-init';
import { matchName, presentFromDes, presentFromText } from '../../domain/presence';
import type { NamedProfile } from '../../domain/presence';
import type { CardProfiles, CharacterProfile, ChatState, StateEvent } from '../../domain/model';
import type { App, Logger, Unsubscribe } from '../../shared/contracts';
import type { EngineApi, EngineView } from './api';
import { effectiveProfiles, sceneBands } from './view';

/** Story log lines kept in the chat state. */
export const LOG_CAP = 300;
/** Messages the text presence reads. */
const PRESENCE_MESSAGES = 3;

export interface EngineDeps {
    app: App;
    log: Logger;
}

export interface EngineImpl extends EngineApi {
    /** Subscribes to the bus and loads the current chat. */
    start(): void;
    /** Drops the view, listeners and subscriptions. */
    stop(): void;
}

interface Presence {
    present: string[];
    unknown: string[];
}

export function createEngine(deps: EngineDeps): EngineImpl {
    const { app, log } = deps;
    let view: EngineView | null = null;
    /** Chat the view belongs to. */
    let viewChat: string | null = null;
    let loadSeq = 0;
    let loading: Promise<EngineView | null> = Promise.resolve(null);
    let updates: Promise<unknown> = Promise.resolve();
    let pendingLog: StateEvent[] = [];
    /** updateProfiles() is saving: its own `profiles:changed` needs no reload (it reloads itself). */
    let savingProfiles = 0;
    /** States this engine handed to the store: their `state:changed` needs no reload. */
    const ownStates = new WeakSet<ChatState>();
    const listeners = new Set<(view: EngineView | null) => void>();
    const unsubscribers: Unsubscribe[] = [];
    let running = false;

    function notify(): void {
        for (const listener of [...listeners]) {
            try {
                listener(view);
            } catch (error) {
                log.error('engine listener failed', error);
            }
        }
    }

    function setView(next: EngineView | null, chatId: string | null): void {
        if (next === view && chatId === viewChat) return;
        view = next;
        viewChat = next ? chatId : null;
        notify();
    }

    /** The solo chat open now, or null. */
    function currentChat(): string | null {
        if (app.host.isGroupChat()) return null;
        return app.host.chatId();
    }

    /** Story name → id among these profiles: presence matching, then Maestro's names (aliases, Russian forms). */
    function resolveIn(name: string, profiles: readonly CharacterProfile[]): string | null {
        if (!name?.trim()) return null;
        return matchName(name, profiles) ?? maestroMatch(name, profiles);
    }

    /** The one profile Maestro's world model calls the same person, or null. */
    function maestroMatch(name: string, profiles: readonly CharacterProfile[]): string | null {
        const api = app.maestro.api();
        if (!api || !name?.trim()) return null;
        const hits = profiles.filter((profile) => {
            try {
                return api.names.same(name, profile.name);
            } catch (error) {
                log.debug('Maestro names.same failed', error);
                return false;
            }
        });
        return hits.length === 1 ? hits[0]!.id : null;
    }

    function chatMessages(): STChatMessage[] {
        const chat = app.host.ctx().chat;
        return Array.isArray(chat) ? chat.filter((message) => message && !message.is_system) : [];
    }

    function presence(profiles: readonly CharacterProfile[], state: ChatState): Presence {
        const named: readonly NamedProfile[] = profiles;
        const des = app.readers.des;
        let cast: ReturnType<typeof des.lastCast> = [];
        try {
            cast = des.available() ? des.lastCast() : [];
        } catch (error) {
            log.debug('DES cast unavailable', error);
        }
        if (cast.length) {
            const found = presentFromDes(cast, named);
            const present = [...found.present];
            const unknown: string[] = [];
            for (const name of found.unknown) {
                // DES names are nominative and were matched strictly: only Maestro's gluing gets a second say.
                const id = maestroMatch(name, profiles);
                if (id && !present.includes(id)) present.push(id);
                else if (!id) unknown.push(name);
            }
            return { present, unknown };
        }
        const messages = chatMessages();
        const flagged = profiles
            .filter((profile) => state.characters[profile.id]?.present)
            .map((profile) => profile.id);
        if (!messages.length) return { present: flagged, unknown: [] };
        let cardName = '';
        try {
            cardName = app.readers.card.current()?.name ?? '';
        } catch (error) {
            log.debug('card name unavailable', error);
        }
        const main = cardName ? (matchName(cardName, named) ?? undefined) : undefined;
        const texts = messages.slice(-PRESENCE_MESSAGES).map((message) => String(message.mes ?? ''));
        const present = presentFromText(texts, named, main);
        // The opening scene (nothing sent yet): the starting scene's cast stays even when the greeting does not name them.
        if (!messages.some((message) => message.is_user)) {
            for (const id of flagged) if (!present.includes(id)) present.push(id);
        }
        return { present, unknown: [] };
    }

    /** Ids the player's last message names. */
    function addressed(profiles: readonly CharacterProfile[]): Set<string> {
        const messages = chatMessages();
        for (let i = messages.length - 1; i >= 0; i--) {
            const message = messages[i]!;
            if (message.is_user) return new Set(presentFromText([String(message.mes ?? '')], profiles));
        }
        return new Set();
    }

    function playerName(): string {
        const name = app.host.ctx().name1;
        return typeof name === 'string' ? name : '';
    }

    function compose(card: CardProfiles, state: ChatState): EngineView {
        const profiles = effectiveProfiles(card, state);
        for (const profile of profiles) ensureCharacterState(state, profile);
        const byId = new Map(profiles.map((profile) => [profile.id, profile] as const));
        const scene = presence(profiles, state);
        const bands = sceneBands(scene.present, byId, state, {
            gravity: app.settings.get().playerGravity,
            addressed: addressed(profiles),
        });
        return {
            card,
            state,
            profiles,
            byId,
            present: scene.present,
            unknown: scene.unknown,
            bands,
            playerName: playerName(),
            greeting: state.greeting,
        };
    }

    async function loadNow(): Promise<{ card: CardProfiles; state: ChatState; chatId: string } | null> {
        const chatId = currentChat();
        if (!chatId || !app.host.cardKey()) return null;
        const [card, state] = await Promise.all([app.profiles.current(), app.state.current()]);
        if (!card || !state) return null;
        return { card, state, chatId };
    }

    function reload(): Promise<EngineView | null> {
        const seq = ++loadSeq;
        const job = (async (): Promise<EngineView | null> => {
            let loaded: Awaited<ReturnType<typeof loadNow>> = null;
            try {
                loaded = await loadNow();
            } catch (error) {
                log.error('could not load the chat', error);
            }
            // A newer load (chat switch) or a stop wins.
            if (seq !== loadSeq || !running) return view;
            if (!loaded || loaded.chatId !== currentChat()) {
                setView(null, null);
                return null;
            }
            setView(compose(loaded.card, loaded.state), loaded.chatId);
            return view;
        })();
        loading = job;
        return job;
    }

    async function ready(): Promise<EngineView | null> {
        for (;;) {
            const job = loading;
            await job.catch(() => null);
            if (job === loading) return view;
        }
    }

    function sameScene(a: EngineView, b: EngineView): boolean {
        return (
            a.playerName === b.playerName &&
            a.profiles.length === b.profiles.length &&
            JSON.stringify([a.present, a.unknown, a.bands]) === JSON.stringify([b.present, b.unknown, b.bands])
        );
    }

    async function refresh(): Promise<void> {
        await ready();
        const current = view;
        if (!current || !running) return;
        const next = compose(current.card, current.state);
        if (view !== current) return;
        if (!sameScene(current, next)) setView(next, viewChat);
    }

    function queue<R>(job: () => Promise<R>): Promise<R> {
        const next = updates.then(job, job);
        updates = next.catch(() => undefined);
        return next;
    }

    async function saveState(mutate: Parameters<EngineApi['updateState']>[0]): Promise<boolean> {
        for (let attempt = 0; attempt < 2; attempt++) {
            const current = await ready();
            const chatId = viewChat;
            if (!current || !chatId || !running) return false;
            let next: ChatState;
            try {
                const draft = structuredClone(current.state);
                next = mutate(draft, current) ?? draft;
            } catch (error) {
                log.error('state update failed', error);
                return false;
            }
            if (currentChat() !== chatId) return false;
            const logged = pendingLog.splice(0);
            if (logged.length) next.log = [...(Array.isArray(next.log) ? next.log : []), ...logged].slice(-LOG_CAP);
            ownStates.add(next);
            let saved = false;
            try {
                saved = await app.state.save(next);
            } catch (error) {
                log.error('could not save the chat state', error);
            }
            if (saved) {
                if (running && viewChat === chatId) setView(compose(view?.card ?? current.card, next), chatId);
                return true;
            }
            pendingLog = [...logged, ...pendingLog].slice(-LOG_CAP);
            log.info(attempt === 0 ? 'state save lost the race; reloading and retrying' : 'state not saved');
            await reload();
        }
        return false;
    }

    async function saveProfiles(mutate: Parameters<EngineApi['updateProfiles']>[0]): Promise<boolean> {
        const current = await ready();
        const key = current?.card.card ?? (app.host.isGroupChat() ? null : app.host.cardKey());
        if (!key || !running) return false;
        for (let attempt = 0; attempt < 2; attempt++) {
            const base = view && view.card.card === key ? view.card : await app.profiles.load(key);
            let next: CardProfiles;
            try {
                const draft = structuredClone(base);
                next = mutate(draft, view) ?? draft;
            } catch (error) {
                log.error('profiles update failed', error);
                return false;
            }
            next.card = key;
            savingProfiles++;
            try {
                await app.profiles.save(next);
            } catch (error) {
                log.warn(attempt === 0 ? 'profiles not saved; reloading and retrying' : 'profiles not saved', error);
                if (attempt === 0) await reload();
                continue;
            } finally {
                savingProfiles--;
            }
            // The store dropped an unsaved chat state of this card: the reload rebuilds it from the new profiles.
            if (running && app.host.cardKey() === key) await reload();
            return true;
        }
        return false;
    }

    function onStateChanged(chatId: string | null): void {
        if (!running || !chatId || chatId !== currentChat()) return;
        void (async () => {
            const state = await app.state.current();
            if (!running || (view && state === view.state) || (state && ownStates.has(state))) return;
            await reload();
        })();
    }

    return {
        view: () => view,
        ready,

        updateState(mutate) {
            return queue(() => saveState(mutate));
        },

        updateProfiles(mutate) {
            return queue(() => saveProfiles(mutate));
        },

        refresh,

        resolve(name: string): string | null {
            return view ? resolveIn(name, view.profiles) : null;
        },

        log(events: StateEvent[]): void {
            if (!Array.isArray(events) || !events.length) return;
            pendingLog = [...pendingLog, ...events].slice(-LOG_CAP);
        },

        onChange(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },

        start(): void {
            if (running) return;
            running = true;
            const { bus } = app;
            unsubscribers.push(
                bus.on('chat:changed', () => {
                    // The old chat's view must not serve a generation of the new one.
                    setView(null, null);
                    void reload();
                }),
                bus.on('profiles:changed', ({ card }) => {
                    if (savingProfiles > 0 || card !== app.host.cardKey()) return;
                    void reload();
                }),
                bus.on('state:changed', ({ chatId }) => onStateChanged(chatId)),
                bus.on('reply:ready', () => void refresh()),
                bus.on('turn:committed', () => void refresh()),
                bus.on('message:invalidated', () => void refresh()),
                bus.on('maestro:changed', () => void refresh()),
            );
            void reload();
        },

        stop(): void {
            if (!running) return;
            running = false;
            loadSeq++;
            for (const off of unsubscribers.splice(0)) off();
            view = null;
            viewChat = null;
            pendingLog = [];
            notify();
            listeners.clear();
        },
    };
}
