// DRAMATIS_API v1 (src/shared/apis.ts): published on globalThis while Dramatis runs, with a `dramatis-api-ready` window
// event, and removed on disable. Every method has a safe default; modules fill them in with parts —
// `app.modules.expose('api', part)` during init (released automatically when the module stops) — and the latest part
// that defines a method answers it. While Dramatis is switched off in its settings every method gives its default
// (readIntent: a failed outcome saying the reading is not available).
// onChange listeners fire (once per microtask) when the state, the profiles, the chat, the parts or the switch change.
import { DRAMATIS_API_GLOBAL, DRAMATIS_API_READY_EVENT } from '../shared/apis';
import type {
    ApiUnsubscribe,
    DramatisApiV1,
    DramatisCharacterView,
    DramatisIntentState,
    DramatisReadOutcome,
} from '../shared/apis';
import type { Bus, I18n, Logger, SettingsService, Unsubscribe } from '../shared/contracts';

/** What a module may provide (every member optional). */
export type DramatisApiPart = Partial<Omit<DramatisApiV1, 'version' | 'dramatisVersion' | 'onChange'>>;

/** The key under which modules expose their API part. */
export const API_PART_KEY = 'api';

export interface ApiPublisher {
    /** The object published as DRAMATIS_API. */
    readonly api: DramatisApiV1;
    registerPart(part: DramatisApiPart): Unsubscribe;
    /** Sets the global and announces it. */
    publish(): void;
    /** Removes the global (extension disabled). */
    unpublish(): void;
    /** Fires onChange listeners (coalesced). */
    notify(): void;
    dispose(): void;
}

export interface ApiPublisherDeps {
    version: string;
    settings: SettingsService;
    bus: Bus;
    log: Logger;
    /** For the words of the defaults (readIntent while nothing can read); the key itself without it. */
    i18n?: I18n;
}

type Method = keyof DramatisApiPart;

export function createApiPublisher(deps: ApiPublisherDeps): ApiPublisher {
    const { settings, bus, log } = deps;
    const parts: DramatisApiPart[] = [];
    const listeners = new Set<() => void>();
    const unsubscribers: Unsubscribe[] = [];
    let pending = false;

    /** The answer of the latest part defining `method`, or the fallback (also when it throws or Dramatis is off). */
    function call<M extends Method, R>(method: M, fallback: R, args: unknown[] = []): R {
        if (!settings.get().enabled) return fallback;
        for (let i = parts.length - 1; i >= 0; i--) {
            const fn = parts[i]?.[method];
            if (typeof fn !== 'function') continue;
            try {
                const value = (fn as (...a: unknown[]) => unknown)(...args);
                return (value ?? fallback) as R;
            } catch (error) {
                log.warn(`DRAMATIS_API.${method} failed`, error);
                return fallback;
            }
        }
        return fallback;
    }

    /** readIntent when no part can read (Dramatis or its intent module is off) or the reading broke. */
    function noReading(): DramatisReadOutcome {
        const error = deps.i18n?.t('core.api.noReading') ?? 'core.api.noReading';
        return { ok: false, characters: 0, error, message: error };
    }

    function notify(): void {
        if (pending) return;
        pending = true;
        queueMicrotask(() => {
            pending = false;
            for (const listener of [...listeners]) {
                try {
                    listener();
                } catch (error) {
                    log.warn('DRAMATIS_API onChange listener failed', error);
                }
            }
        });
    }

    const api: DramatisApiV1 = {
        version: 1,
        dramatisVersion: deps.version,
        active: () => call('active', false),
        castBlockActive: () => call('castBlockActive', false),
        dependenceOwned: () => [...call<'dependenceOwned', string[]>('dependenceOwned', [])],
        stances: () => [...call<'stances', ReturnType<DramatisApiV1['stances']>>('stances', [])],
        goals: (name: string) => [...call<'goals', string[]>('goals', [], [name])],
        offscreenBrief: (name: string) => call<'offscreenBrief', string | null>('offscreenBrief', null, [name]),
        matureAgendas: () => [
            ...call<'matureAgendas', ReturnType<DramatisApiV1['matureAgendas']>>('matureAgendas', []),
        ],
        replacesSocialMechanics: () => call('replacesSocialMechanics', false),
        startCast: (greeting: number) => [
            ...call<'startCast', ReturnType<NonNullable<DramatisApiV1['startCast']>>>('startCast', [], [greeting]),
        ],
        intentState: () => call<'intentState', DramatisIntentState | null>('intentState', null),
        readIntent: (options?: { force?: boolean }) =>
            Promise.resolve(call<'readIntent', Promise<DramatisReadOutcome> | null>('readIntent', null, [options]))
                .then((outcome) => outcome ?? noReading())
                .catch((error: unknown) => {
                    log.warn('DRAMATIS_API.readIntent failed', error);
                    return noReading();
                }),
        describe: (name: string) => call<'describe', DramatisCharacterView | null>('describe', null, [name]),
        openSheet: (name?: string) => {
            call<'openSheet', void>('openSheet', undefined, [name]);
        },
        onChange(listener: () => void): ApiUnsubscribe {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };

    return {
        api,

        registerPart(part: DramatisApiPart): Unsubscribe {
            parts.push(part);
            notify();
            return () => {
                const index = parts.indexOf(part);
                if (index < 0) return;
                parts.splice(index, 1);
                notify();
            };
        },

        publish(): void {
            (globalThis as unknown as Record<string, unknown>)[DRAMATIS_API_GLOBAL] = api;
            if (!unsubscribers.length) {
                unsubscribers.push(
                    bus.on('state:changed', notify),
                    bus.on('profiles:changed', notify),
                    bus.on('chat:changed', notify),
                    settings.onChange((key) => {
                        if (key === 'enabled' || key === '*') notify();
                    }),
                );
            }
            try {
                globalThis.dispatchEvent?.(new CustomEvent(DRAMATIS_API_READY_EVENT, { detail: { version: 1 } }));
            } catch (error) {
                log.debug('could not announce DRAMATIS_API', error);
            }
        },

        unpublish(): void {
            const store = globalThis as unknown as Record<string, unknown>;
            if (store[DRAMATIS_API_GLOBAL] === api) delete store[DRAMATIS_API_GLOBAL];
        },

        notify,

        dispose(): void {
            for (const off of unsubscribers.splice(0)) off();
            parts.length = 0;
            listeners.clear();
            const store = globalThis as unknown as Record<string, unknown>;
            if (store[DRAMATIS_API_GLOBAL] === api) delete store[DRAMATIS_API_GLOBAL];
        },
    };
}
