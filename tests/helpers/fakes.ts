// Small fakes for core tests: a silent logger that records lines, a host over the ST mock, a fake MAESTRO_API.
import { createHost } from '../../src/host';
import type { HostImpl } from '../../src/host';
import type { ApiLlmRequest, ApiLlmResult, ApiTurnEvent, MaestroApiV1 } from '../../src/shared/apis';
import { sceneSplitOf } from '../../src/adapters/maestro';
import type { Logger, MaestroBridge, ModuleContext } from '../../src/shared/contracts';

export interface MemoryLogger extends Logger {
    lines: { level: string; args: unknown[] }[];
}

export function memoryLogger(): MemoryLogger {
    const lines: { level: string; args: unknown[] }[] = [];
    const logger: MemoryLogger = {
        lines,
        debug: (...args) => lines.push({ level: 'debug', args }),
        info: (...args) => lines.push({ level: 'info', args }),
        warn: (...args) => lines.push({ level: 'warn', args }),
        error: (...args) => lines.push({ level: 'error', args }),
        scope: () => logger,
    };
    return logger;
}

/** The real host over the installed ST mock. */
export function mockHost(log: Logger = memoryLogger()): HostImpl {
    return createHost(log);
}

export interface FakeMaestro {
    api: MaestroApiV1;
    requests: ApiLlmRequest[];
    reply: (request: ApiLlmRequest) => ApiLlmResult | Promise<ApiLlmResult>;
    available: boolean;
    turnListeners: Set<(event: ApiTurnEvent) => void | Promise<void>>;
    emitTurn(event: ApiTurnEvent): Promise<void>;
    /** «Мастерская» (with `{ workshop }`): what `workshop.active()` answers. */
    workshopActive: boolean;
    workshopListeners: Set<(active: boolean) => void | Promise<void>>;
    /** Flips the workshop state and awaits every listener, as Maestro does in its first CHAT_CHANGED listener. */
    setWorkshop(active: boolean): Promise<void>;
    /** The scene split (with `{ sceneSplit }`): what `sceneSplit.active()` answers. */
    splitActive: boolean;
}

/**
 * A MAESTRO_API v1 double: records LLM requests and lets the test fire turn events. With `workshop` it is a Maestro
 * 1.21+ with «Мастерская» (the optional `workshop` member), starting in that state; with `sceneSplit` a Maestro 1.23+
 * whose scene split starts in that state (tag 'offscreen').
 */
export function fakeMaestro(options: { workshop?: boolean; sceneSplit?: boolean } = {}): FakeMaestro {
    const fake: FakeMaestro = {
        requests: [],
        reply: () => ({ ok: true, text: 'ok', data: 'ok', costUsd: 0.001 }),
        available: true,
        turnListeners: new Set(),
        async emitTurn(event) {
            for (const listener of [...fake.turnListeners]) await listener(event);
        },
        workshopActive: options.workshop === true,
        workshopListeners: new Set(),
        async setWorkshop(active) {
            if (fake.workshopActive === active) return;
            fake.workshopActive = active;
            for (const listener of [...fake.workshopListeners]) await listener(active);
        },
        splitActive: options.sceneSplit === true,
        api: undefined as unknown as MaestroApiV1,
    };
    fake.api = {
        version: 1,
        maestroVersion: '1.17.0',
        llm: {
            async request<T>(request: ApiLlmRequest): Promise<ApiLlmResult<T>> {
                fake.requests.push(request);
                return (await fake.reply(request)) as ApiLlmResult<T>;
            },
            available: () => fake.available,
            registerTask: () => () => {},
        },
        leader: { isLeader: () => true, onChange: () => () => {} },
        propose: async () => 'applied',
        registerApplier: () => () => {},
        journal: { record: async () => 'j1', registerUndo: () => () => {} },
        notice: () => {},
        onTurn(listener) {
            fake.turnListeners.add(listener);
            return () => fake.turnListeners.delete(listener);
        },
        names: { resolve: () => null, same: (a, b) => a === b },
        present: () => [],
        speech: () => null,
        quiet: () => () => {},
    };
    if (options.sceneSplit !== undefined) {
        fake.api.sceneSplit = { active: () => fake.splitActive, tag: 'offscreen' };
    }
    if (options.workshop !== undefined) {
        fake.api.workshop = {
            active: () => fake.workshopActive,
            onChange(listener) {
                fake.workshopListeners.add(listener);
                return () => fake.workshopListeners.delete(listener);
            },
        };
    }
    return fake;
}

/** A bridge with a switchable API and workshop state (no globals; flips are not announced). */
export function staticBridge(api: MaestroApiV1 | null = null): MaestroBridge & {
    set(api: MaestroApiV1 | null): void;
    setWorkshop(active: boolean): void;
} {
    let current = api;
    let workshop = false;
    return {
        api: () => current,
        present: () => current !== null,
        workshop: () => current !== null && workshop,
        sceneSplit: () => sceneSplitOf(current, memoryLogger()),
        set(next) {
            current = next;
        },
        setWorkshop(active) {
            workshop = active;
        },
    };
}

/** ModuleContext.session for a module started by hand: a fresh memory on every start. */
export const freshSession: ModuleContext<object>['session'] = (create) => create();
