// Bridge to Maestro's public API (src/shared/apis.ts): `globalThis.MAESTRO_API` v1, published by Maestro when it is
// installed and enabled. Maestro loads before Dramatis (loading_order 200 < 210) but activates asynchronously, so the
// global is looked up again on its `maestro-api-ready` window event, on APP_READY and on chat changes; every api()
// call reads it live as well, so a Maestro disabled in the meantime is noticed on first use. Each change of presence —
// and a new API object after a Maestro restart — is announced on the bus as `maestro:changed`.
//
// «Мастерская» (Maestro 1.21+, the optional `workshop` member): the chat of a helper card, where the story machinery
// stays silent. The bridge follows `workshop.onChange` of the API object it holds — a restarted Maestro's new object
// gets a new subscription and the old one is dropped — and announces every flip on the bus as `maestro:workshop`:
// - the pause at once: the listener returns that emit, so Maestro (deciding in its first CHAT_CHANGED listener) waits
//   until every module is stopped before the rest of CHAT_CHANGED runs;
// - the resume once the chat switch is through: Maestro tells it in that same first listener, before SillyTavern has
//   loaded the new chat's persona (its own CHAT_CHANGED listener, after a fetch) — modules started then would read the
//   card with the old persona. So a resume during a switch waits for Dramatis' last CHAT_CHANGED listener (a few
//   seconds at most); with the chat unchanged (the tag removed while it is open) it is announced at once. Until then
//   workshop() still answers true.
// A new object (or Maestro gone: no workshop) is compared with the state announced last as well.
import { MAESTRO_API_GLOBAL, MAESTRO_API_READY_EVENT } from '../../shared/apis';
import type { ApiUnsubscribe, MaestroApiV1 } from '../../shared/apis';
import type { Bus, Host, Logger, MaestroBridge, Unsubscribe } from '../../shared/contracts';

export interface MaestroBridgeImpl extends MaestroBridge {
    /** Starts watching for Maestro (window event, APP_READY, chat changes). */
    install(): void;
    /** Looks the global up again and announces a change of presence. */
    check(): boolean;
    dispose(): void;
}

/** A usable MAESTRO_API v1: the version and the members Dramatis calls unconditionally. */
export function isMaestroApi(value: unknown): value is MaestroApiV1 {
    if (!value || typeof value !== 'object') return false;
    const api = value as Partial<MaestroApiV1>;
    return (
        api.version === 1 &&
        !!api.llm &&
        typeof api.llm.request === 'function' &&
        typeof api.llm.available === 'function' &&
        typeof api.onTurn === 'function'
    );
}

/** A resume waiting for the end of a chat switch goes ahead after this long anyway (a CHAT_CHANGED that never ends). */
export const RESUME_FALLBACK_MS = 5000;

/** `workshop.active()` of an API object; false without the member (Maestro before 1.21) or when it throws. */
function workshopOf(api: MaestroApiV1 | null, log: Logger): boolean {
    const member = api?.workshop;
    if (!member || typeof member.active !== 'function') return false;
    try {
        return member.active() === true;
    } catch (error) {
        log.debug('MAESTRO_API.workshop.active failed', error);
        return false;
    }
}

export function createMaestroBridge(host: Host, bus: Bus, log: Logger): MaestroBridgeImpl {
    /** The API object seen last (null: absent). A restarted Maestro publishes a new object. */
    let current: MaestroApiV1 | null = null;
    let warned = false;
    const unsubscribers: Unsubscribe[] = [];
    /** The subscription to `workshop.onChange` of `current` (null: none, or a Maestro without «Мастерская»). */
    let offWorkshop: ApiUnsubscribe | null = null;
    /** The workshop state announced last on the bus (true from the pause until the resume is announced). */
    let workshop = false;
    /** The chat whose CHAT_CHANGED reached Dramatis' last listener: another chat open now means a switch under way. */
    let settledChat: string | null = null;
    /** A resume waiting for the switch under way (the fallback timer); null when none waits. */
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;

    function lookup(): MaestroApiV1 | null {
        const value = (globalThis as unknown as Record<string, unknown>)[MAESTRO_API_GLOBAL];
        if (value === undefined || value === null) return null;
        if (isMaestroApi(value)) return value;
        if (!warned) {
            warned = true;
            const version = (value as { version?: unknown }).version;
            log.warn(`MAESTRO_API version ${String(version)} is not supported; working without Maestro`);
        }
        return null;
    }

    function cancelResume(): void {
        if (resumeTimer) clearTimeout(resumeTimer);
        resumeTimer = null;
    }

    /** Announces a flip (nothing when it is the state announced last); resolves when every bus handler finished. */
    function announceWorkshop(active: boolean): Promise<void> {
        cancelResume();
        if (active === workshop) return Promise.resolve();
        workshop = active;
        log.info(active ? 'workshop chat: Dramatis pauses' : 'out of the workshop chat: Dramatis resumes');
        return bus.emit('maestro:workshop', { active });
    }

    /** What Maestro (or its absence) says now: a pause at once, a resume during a chat switch once it is through. */
    function followState(active: boolean): Promise<void> {
        if (active || !workshop || host.chatId() === settledChat) return announceWorkshop(active);
        resumeTimer ??= setTimeout(() => {
            resumeTimer = null;
            void announceWorkshop(workshopOf(current, log));
        }, RESUME_FALLBACK_MS);
        return Promise.resolve();
    }

    /** Dramatis' last CHAT_CHANGED listener: the switch is through (persona and all), a waiting resume goes now. */
    const onChatSettled = (): Promise<void> | undefined => {
        settledChat = host.chatId();
        return resumeTimer ? announceWorkshop(workshopOf(current, log)) : undefined;
    };

    function releaseWorkshop(): void {
        const off = offWorkshop;
        offWorkshop = null;
        if (!off) return;
        try {
            off();
        } catch (error) {
            log.debug('MAESTRO_API.workshop unsubscribe failed', error);
        }
    }

    /** Follows `workshop.onChange` of this API object; a call from an object no longer current is ignored. */
    function followWorkshop(api: MaestroApiV1 | null): void {
        releaseWorkshop();
        const member = api?.workshop;
        if (!api || !member || typeof member.onChange !== 'function') return;
        try {
            offWorkshop = member.onChange((active) => (current === api ? followState(active === true) : undefined));
        } catch (error) {
            log.warn('could not follow Maestro’s workshop chats', error);
        }
    }

    // A restart of Maestro removes the global and publishes a new object (MAESTRO_API forgets every registration made
    // on the old one). When nothing looked in between, presence never changes — so a new object is announced too, and
    // whoever registered tasks, appliers, undo handlers, quiet claims or turn listeners does it again.
    function note(api: MaestroApiV1 | null): void {
        if (api === current) return;
        const replaced = api !== null && current !== null;
        current = api;
        followWorkshop(api);
        const now = api !== null;
        log.info(
            now ? `Maestro ${api?.maestroVersion ?? '?'} ${replaced ? 'restarted' : 'connected'}` : 'Maestro is gone',
        );
        // Announced asynchronously: api() may be called from inside other handlers.
        queueMicrotask(() => void bus.emit('maestro:changed', { present: now }));
        // The new object (or none) may see the open chat otherwise than the one announced last.
        queueMicrotask(() => void followState(workshopOf(current, log)));
    }

    const onReady = () => {
        note(lookup());
    };

    return {
        api(): MaestroApiV1 | null {
            const api = lookup();
            note(api);
            return api;
        },

        present(): boolean {
            const api = lookup();
            note(api);
            return api !== null;
        },

        workshop(): boolean {
            const api = lookup();
            note(api);
            // A pause holds until its resume is announced (a resume may wait for the end of a chat switch).
            return workshopOf(api, log) || workshop;
        },

        check(): boolean {
            const api = lookup();
            note(api);
            return api !== null;
        },

        install(): void {
            if (unsubscribers.length) return;
            if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
                window.addEventListener(MAESTRO_API_READY_EVENT, onReady);
                unsubscribers.push(() => window.removeEventListener(MAESTRO_API_READY_EVENT, onReady));
            }
            for (const key of ['APP_READY', 'CHAT_CHANGED']) {
                const name = host.events.name(key);
                if (name) unsubscribers.push(host.events.on(name, onReady));
            }
            const chatChanged = host.events.name('CHAT_CHANGED');
            if (chatChanged) unsubscribers.push(host.events.on(chatChanged, onChatSettled, { order: 'last' }));
            settledChat = host.chatId();
            onReady();
        },

        dispose(): void {
            for (const off of unsubscribers.splice(0)) off();
            releaseWorkshop();
            cancelResume();
        },
    };
}
