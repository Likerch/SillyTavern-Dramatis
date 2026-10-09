// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMaestroBridge, isMaestroApi } from '../../src/adapters/maestro';
import { createBus } from '../../src/core/bus';
import { MAESTRO_API_GLOBAL, MAESTRO_API_READY_EVENT } from '../../src/shared/apis';
import { fakeMaestro, memoryLogger, mockHost } from '../helpers/fakes';
import { EVENT_TYPES, flush, installStMock } from '../helpers/st-mock';
import type { StMock } from '../helpers/st-mock';

let mock: StMock;
const globals = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
    mock = installStMock();
});

afterEach(() => {
    delete globals[MAESTRO_API_GLOBAL];
});

function setup() {
    const log = memoryLogger();
    const bus = createBus(log);
    const changes: boolean[] = [];
    bus.on('maestro:changed', ({ present }) => {
        changes.push(present);
    });
    const bridge = createMaestroBridge(mockHost(log), bus, log);
    return { bridge, changes, log };
}

describe('Maestro bridge', () => {
    it('accepts only MAESTRO_API v1 with the members Dramatis calls', () => {
        expect(isMaestroApi(fakeMaestro().api)).toBe(true);
        expect(isMaestroApi({ ...fakeMaestro().api, version: 2 })).toBe(false);
        expect(isMaestroApi({ version: 1 })).toBe(false);
        expect(isMaestroApi(null)).toBe(false);
    });

    it('is absent without the global and notices it on the ready event', async () => {
        const { bridge, changes } = setup();
        bridge.install();
        expect(bridge.present()).toBe(false);
        expect(bridge.api()).toBeNull();

        const maestro = fakeMaestro();
        globals[MAESTRO_API_GLOBAL] = maestro.api;
        window.dispatchEvent(new CustomEvent(MAESTRO_API_READY_EVENT));
        await flush();
        expect(changes).toEqual([true]);
        expect(bridge.api()).toBe(maestro.api);
        bridge.dispose();
    });

    it('re-checks on APP_READY and on every call, announcing each change once', async () => {
        const { bridge, changes } = setup();
        bridge.install();
        globals[MAESTRO_API_GLOBAL] = fakeMaestro().api;
        await mock.eventSource.emit(EVENT_TYPES.APP_READY!);
        expect(bridge.present()).toBe(true);
        delete globals[MAESTRO_API_GLOBAL];
        expect(bridge.api()).toBeNull();
        expect(bridge.present()).toBe(false);
        await flush();
        expect(changes).toEqual([true, false]);
    });

    it('warns once about an unsupported version', () => {
        const { bridge, log } = setup();
        globals[MAESTRO_API_GLOBAL] = { version: 2 };
        expect(bridge.check()).toBe(false);
        expect(bridge.check()).toBe(false);
        expect(log.lines.filter((line) => line.level === 'warn')).toHaveLength(1);
    });
});
