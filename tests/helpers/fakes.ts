// Small fakes for core tests: a silent logger that records lines, a host over the ST mock, a fake MAESTRO_API.
import { createHost } from '../../src/host';
import type { HostImpl } from '../../src/host';
import type { ApiLlmRequest, ApiLlmResult, ApiTurnEvent, MaestroApiV1 } from '../../src/shared/apis';
import type { Logger, MaestroBridge } from '../../src/shared/contracts';

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
}

/** A MAESTRO_API v1 double: records LLM requests and lets the test fire turn events. */
export function fakeMaestro(): FakeMaestro {
    const fake: FakeMaestro = {
        requests: [],
        reply: () => ({ ok: true, text: 'ok', data: 'ok', costUsd: 0.001 }),
        available: true,
        turnListeners: new Set(),
        async emitTurn(event) {
            for (const listener of [...fake.turnListeners]) await listener(event);
        },
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
    return fake;
}

/** A bridge with a switchable API (no globals). */
export function staticBridge(api: MaestroApiV1 | null = null): MaestroBridge & { set(api: MaestroApiV1 | null): void } {
    let current = api;
    return {
        api: () => current,
        present: () => current !== null,
        set(next) {
            current = next;
        },
    };
}
