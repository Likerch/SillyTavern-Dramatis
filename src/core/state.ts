// Chat-level state (docs/model.md §15): one file per chat, `dramatis-chat-<hash(chatId)>-state.json`, holding an
// envelope with a schema number (migrations) and a write version (compare-and-swap between tabs, as Maestro's
// chat-store). The first use of a chat builds the state from the card profiles (initChatState) without writing it:
// the file appears with the first save, so merely opening a chat leaves nothing behind.
//
// Drafts (dev-plan «черновик → фиксация при отправке»): results derived from a reply are kept in memory per chat,
// message and swipe; the turn pass takes them when the user sends the next message and they are dropped when that
// reply is swiped, edited or deleted, or the chat changes.
import type { CardProfiles, ChatState } from '../domain/model';
import { CHAT_STATE_SCHEMA, initChatState } from '../domain/state-init';
import type { Bus, FileStore, Host, Logger, ProfileStore, StateStore, Unsubscribe } from '../shared/contracts';
import { currentTabId, readFresh } from './files';
import { stableHash } from './hash';
import { emptyCardProfiles } from './profiles';

export interface StateEnvelope {
    /** Schema of `data` (migrations move it forward). */
    schema: number;
    /** Incremented on every write; a tab writes only over the version it last saw. */
    version: number;
    updatedAt: number;
    /** Tab that wrote this version. */
    tabId: string;
    data: ChatState;
}

/** One migration step: moves a raw state document from schema N to N + 1. */
export type StateMigration = (doc: Record<string, unknown>) => Record<string, unknown>;

export interface StateStoreDeps {
    host: Host;
    files: FileStore;
    profiles: ProfileStore;
    bus: Bus;
    log: Logger;
    /** Greeting the current chat started with (CardReader.greetingIndex). */
    greeting: () => number;
    /** Schema this code writes (tests raise it to exercise migrations). */
    schema?: number;
}

export interface StateStoreImpl extends StateStore {
    /** File name of a chat's state. */
    fileName(chatId: string): string;
    migration(fromSchema: number, step: StateMigration): void;
    /** Subscribes to the bus (chat changes, invalidated replies, profile saves). */
    install(): void;
    dispose(): void;
    /** Forgets cached states (also done on chat change). */
    clearCache(): void;
}

interface Entry {
    chatId: string;
    state: ChatState;
    /** The file exists (read or written by this tab); an unsaved state is rebuilt when its sources change. */
    saved: boolean;
}

function isDict(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isStateEnvelope(value: unknown): value is StateEnvelope {
    return isDict(value) && typeof value.version === 'number' && typeof value.schema === 'number' && 'data' in value;
}

/** Gives a stored state every top-level collection (older or hand-edited files may lack some). */
function normalize(data: Record<string, unknown>, card: string): ChatState {
    const state = data as unknown as ChatState;
    if (!isDict(state.characters)) state.characters = {};
    for (const key of ['extras', 'rules', 'reputation', 'rumours', 'schemes', 'log'] as const) {
        if (!Array.isArray(state[key])) (state as unknown as Record<string, unknown>)[key] = [];
    }
    for (const key of ['turn', 'scene', 'greeting'] as const) {
        if (typeof state[key] !== 'number') state[key] = 0;
    }
    if (typeof state.card !== 'string' || !state.card) state.card = card;
    if (typeof state.worldTone !== 'string') state.worldTone = 'indifferent';
    return state;
}

const draftKey = (chatId: string, messageIndex: number, swipeId: number) =>
    `${chatId}\u0000${messageIndex}\u0000${swipeId}`;

export function createStateStore(deps: StateStoreDeps): StateStoreImpl {
    const { host, files, profiles, bus, log } = deps;
    const target = deps.schema ?? CHAT_STATE_SCHEMA;
    const tabId = currentTabId();
    const cache = new Map<string, Entry>();
    const loading = new Map<string, Promise<Entry>>();
    const chains = new Map<string, Promise<unknown>>();
    const migrations = new Map<number, StateMigration>();
    /** Version this tab last read or wrote, per chat. Survives cache clears (a write may finish after a switch). */
    const knownVersions = new Map<string, number>();
    /** State object → chat it belongs to: save() writes back to the chat it was read from. */
    const owners = new WeakMap<object, string>();
    const drafts = new Map<string, { chatId: string; messageIndex: number; draft: unknown }>();
    const listeners = new Set<() => void>();
    const unsubscribers: Unsubscribe[] = [];
    let generation = 0;

    const fileName = (chatId: string) => files.fileName(`chat-${stableHash(chatId)}-state`);

    const serial = <R>(key: string, job: () => Promise<R>): Promise<R> => {
        const previous = chains.get(key) ?? Promise.resolve();
        const next = previous.then(job, job);
        const settled = next.catch(() => undefined);
        chains.set(key, settled);
        void settled.then(() => {
            if (chains.get(key) === settled) chains.delete(key);
        });
        return next;
    };

    function migrate(env: StateEnvelope): Record<string, unknown> {
        let schema = env.schema;
        let doc: Record<string, unknown> = isDict(env.data) ? (env.data as unknown as Record<string, unknown>) : {};
        while (schema < target) {
            const step = migrations.get(schema);
            if (!step) {
                log.warn(`no state migration from schema ${schema}`);
                break;
            }
            doc = step(doc);
            schema++;
        }
        doc.schema = Math.max(schema, target);
        return doc;
    }

    async function build(chatId: string, card: string): Promise<Entry> {
        let source: CardProfiles;
        try {
            source = await profiles.load(card);
        } catch (error) {
            log.warn('profiles could not be loaded; the chat starts with no cast', error);
            source = emptyCardProfiles(card);
        }
        let greeting = 0;
        try {
            greeting = deps.greeting();
        } catch (error) {
            log.debug('greeting index unavailable', error);
        }
        return { chatId, state: initChatState(source, greeting, card), saved: false };
    }

    function changed(chatId: string | null): void {
        for (const listener of [...listeners]) {
            try {
                listener();
            } catch (error) {
                log.error('state listener failed', error);
            }
        }
        void bus.emit('state:changed', { chatId });
    }

    function load(chatId: string, card: string): Promise<Entry> {
        const cached = cache.get(chatId);
        if (cached) return Promise.resolve(cached);
        const pending = loading.get(chatId);
        if (pending) return pending;
        const startedIn = generation;
        const job = serial(chatId, async () => {
            const again = cache.get(chatId);
            if (again) return again;
            const raw = await readFresh<unknown>(files, fileName(chatId));
            let entry: Entry;
            if (isStateEnvelope(raw)) {
                entry = { chatId, state: normalize(migrate(raw), card), saved: true };
                knownVersions.set(chatId, raw.version);
            } else {
                if (raw !== null) log.warn('chat state has no envelope; starting from the card profiles');
                entry = await build(chatId, card);
            }
            owners.set(entry.state, chatId);
            if (startedIn === generation) cache.set(chatId, entry);
            return entry;
        });
        loading.set(chatId, job);
        void job
            .finally(() => {
                if (loading.get(chatId) === job) loading.delete(chatId);
            })
            .catch(() => undefined);
        return job;
    }

    /** Unsaved states are rebuilt next time (their greeting or profiles changed before anything was written). */
    function dropUnsaved(match: (entry: Entry) => boolean): void {
        for (const [chatId, entry] of [...cache]) {
            if (!entry.saved && match(entry)) cache.delete(chatId);
        }
    }

    function dropDrafts(messageIndex?: number): void {
        const chatId = host.chatId();
        for (const [key, item] of [...drafts]) {
            if (item.chatId !== chatId) continue;
            if (messageIndex === undefined || item.messageIndex >= messageIndex) drafts.delete(key);
        }
    }

    function clearCache(): void {
        generation++;
        cache.clear();
    }

    return {
        async current(): Promise<ChatState | null> {
            const chatId = host.chatId();
            const card = host.cardKey();
            if (!chatId || !card || host.isGroupChat()) return null;
            try {
                const entry = await load(chatId, card);
                return entry.state;
            } catch (error) {
                log.error('could not load the chat state', error);
                return null;
            }
        },

        async save(state: ChatState): Promise<boolean> {
            const chatId = owners.get(state) ?? host.chatId();
            if (!chatId) {
                log.debug('no chat: state not saved');
                return false;
            }
            const startedIn = generation;
            return serial(chatId, async () => {
                const name = fileName(chatId);
                let raw: unknown;
                try {
                    raw = await readFresh<unknown>(files, name);
                } catch (error) {
                    log.warn('could not re-read the chat state before writing', error);
                    return false;
                }
                const remote = isStateEnvelope(raw) ? raw : null;
                const remoteVersion = remote?.version ?? 0;
                const known = knownVersions.get(chatId) ?? 0;
                if (remote && (remoteVersion > known || remote.schema > target)) {
                    log.info(`another tab wrote state version ${remoteVersion} (this tab saw ${known}); reloading`);
                    knownVersions.set(chatId, remoteVersion);
                    if (startedIn === generation) {
                        try {
                            const fresh: Entry = {
                                chatId,
                                state: normalize(migrate(remote), state.card),
                                saved: true,
                            };
                            owners.set(fresh.state, chatId);
                            cache.set(chatId, fresh);
                        } catch (error) {
                            cache.delete(chatId);
                            log.error('could not refresh the chat state', error);
                        }
                    }
                    changed(chatId);
                    return false;
                }
                state.schema = target;
                const env: StateEnvelope = {
                    schema: target,
                    version: Math.max(known, remoteVersion) + 1,
                    updatedAt: Date.now(),
                    tabId,
                    data: state,
                };
                try {
                    await files.write(name, env);
                } catch (error) {
                    log.error('could not write the chat state', error);
                    return false;
                }
                owners.set(state, chatId);
                knownVersions.set(chatId, env.version);
                if (startedIn === generation) cache.set(chatId, { chatId, state, saved: true });
                changed(chatId);
                return true;
            });
        },

        setDraft(messageIndex: number, swipeId: number, draft: unknown): void {
            const chatId = host.chatId();
            if (!chatId) return;
            drafts.set(draftKey(chatId, messageIndex, swipeId), { chatId, messageIndex, draft });
        },

        takeDraft(messageIndex: number, swipeId: number): unknown {
            const chatId = host.chatId();
            if (!chatId) return undefined;
            const key = draftKey(chatId, messageIndex, swipeId);
            const item = drafts.get(key);
            drafts.delete(key);
            return item?.draft;
        },

        /** Drops the drafts of this message and of every later one (all drafts of the chat when omitted). */
        dropDrafts,

        onChange(listener: () => void): Unsubscribe {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        fileName,

        migration(fromSchema: number, step: StateMigration): void {
            migrations.set(fromSchema, step);
        },

        install(): void {
            if (unsubscribers.length) return;
            unsubscribers.push(
                bus.on('chat:changed', () => {
                    clearCache();
                    drafts.clear();
                }),
                bus.on('message:invalidated', ({ messageIndex }) => {
                    dropDrafts(messageIndex);
                    // The greeting was swiped before anything was written: start from the new greeting.
                    if (messageIndex === 0) dropUnsaved((entry) => entry.chatId === host.chatId());
                }),
                bus.on('profiles:changed', ({ card }) => dropUnsaved((entry) => entry.state.card === card)),
            );
        },

        dispose(): void {
            for (const off of unsubscribers.splice(0)) off();
            drafts.clear();
            listeners.clear();
            clearCache();
        },

        clearCache,
    };
}
