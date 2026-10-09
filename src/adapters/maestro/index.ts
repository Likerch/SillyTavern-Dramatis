// Bridge to Maestro's public API (src/shared/apis.ts): `globalThis.MAESTRO_API` v1, published by Maestro when it is
// installed and enabled. Maestro loads before Dramatis (loading_order 200 < 210) but activates asynchronously, so the
// global is looked up again on its `maestro-api-ready` window event, on APP_READY and on chat changes; every api()
// call reads it live as well, so a Maestro disabled in the meantime is noticed on first use. Each change of presence
// is announced on the bus as `maestro:changed`.
import { MAESTRO_API_GLOBAL, MAESTRO_API_READY_EVENT } from '../../shared/apis';
import type { MaestroApiV1 } from '../../shared/apis';
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

export function createMaestroBridge(host: Host, bus: Bus, log: Logger): MaestroBridgeImpl {
    let present = false;
    let warned = false;
    const unsubscribers: Unsubscribe[] = [];

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

    function note(api: MaestroApiV1 | null): void {
        const now = api !== null;
        if (now === present) return;
        present = now;
        log.info(now ? `Maestro ${api?.maestroVersion ?? '?'} connected` : 'Maestro is gone');
        // Announced asynchronously: api() may be called from inside other handlers.
        queueMicrotask(() => void bus.emit('maestro:changed', { present: now }));
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
            onReady();
        },

        dispose(): void {
            for (const off of unsubscribers.splice(0)) off();
        },
    };
}
