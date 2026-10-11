// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESUME_FALLBACK_MS, createMaestroBridge, isMaestroApi } from '../../src/adapters/maestro';
import type { MaestroBridgeImpl } from '../../src/adapters/maestro';
import { createBus } from '../../src/core/bus';
import { MAESTRO_API_GLOBAL, MAESTRO_API_READY_EVENT } from '../../src/shared/apis';
import { fakeMaestro, memoryLogger, mockHost } from '../helpers/fakes';
import type { FakeMaestro } from '../helpers/fakes';
import { EVENT_TYPES, flush, installStMock } from '../helpers/st-mock';
import type { StMock } from '../helpers/st-mock';

let mock: StMock;
const globals = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
    mock = installStMock();
});

/** Every bridge a test made: disposed after it, so none of them hears the next test's window events. */
const bridges: MaestroBridgeImpl[] = [];

afterEach(() => {
    for (const bridge of bridges.splice(0)) bridge.dispose();
    delete globals[MAESTRO_API_GLOBAL];
});

function setup() {
    const log = memoryLogger();
    const bus = createBus(log);
    const changes: boolean[] = [];
    bus.on('maestro:changed', ({ present }) => {
        changes.push(present);
    });
    const workshops: boolean[] = [];
    bus.on('maestro:workshop', ({ active }) => {
        workshops.push(active);
    });
    const bridge = createMaestroBridge(mockHost(log), bus, log);
    bridges.push(bridge);
    return { bridge, bus, changes, workshops, log };
}

/** Publishes this fake as MAESTRO_API and announces it the way Maestro does. */
async function publish(maestro: FakeMaestro): Promise<void> {
    globals[MAESTRO_API_GLOBAL] = maestro.api;
    window.dispatchEvent(new CustomEvent(MAESTRO_API_READY_EVENT));
    await flush();
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

    it('announces a restarted Maestro (a new API object) even when nobody saw it gone', async () => {
        const { bridge, changes } = setup();
        bridge.install();
        globals[MAESTRO_API_GLOBAL] = fakeMaestro().api;
        expect(bridge.present()).toBe(true);
        await flush();
        expect(changes).toEqual([true]);

        // Maestro's stop and start happened between two looks: only the object differs.
        globals[MAESTRO_API_GLOBAL] = fakeMaestro().api;
        window.dispatchEvent(new CustomEvent(MAESTRO_API_READY_EVENT));
        await flush();
        expect(changes).toEqual([true, true]);
        expect(bridge.present()).toBe(true);
        await flush();
        expect(changes).toEqual([true, true]);
        bridge.dispose();
    });

    it('warns once about an unsupported version', () => {
        const { bridge, log } = setup();
        globals[MAESTRO_API_GLOBAL] = { version: 2 };
        expect(bridge.check()).toBe(false);
        expect(bridge.check()).toBe(false);
        expect(log.lines.filter((line) => line.level === 'warn')).toHaveLength(1);
    });
});

describe('Maestro bridge — «Мастерская» (Maestro 1.21+)', () => {
    it('is never a workshop chat without Maestro or with a Maestro that has no `workshop`', async () => {
        const { bridge, workshops } = setup();
        bridge.install();
        expect(bridge.workshop()).toBe(false);
        await publish(fakeMaestro());
        expect(bridge.workshop()).toBe(false);
        expect(workshops).toEqual([]);
        bridge.dispose();
    });

    it('answers workshop() live and announces each flip once, awaiting the bus handlers', async () => {
        const { bridge, bus, workshops } = setup();
        const maestro = fakeMaestro({ workshop: false });
        bridge.install();
        await publish(maestro);
        expect(maestro.workshopListeners.size).toBe(1);
        expect(bridge.workshop()).toBe(false);

        // The module manager's pause takes a while: Maestro (awaiting its listener) waits for it.
        let paused = false;
        bus.on('maestro:workshop', async ({ active }) => {
            await flush();
            paused = active;
        });
        await maestro.setWorkshop(true);
        expect(paused).toBe(true);
        expect(workshops).toEqual([true]);
        expect(bridge.workshop()).toBe(true);

        // A repeated call with the same state announces nothing.
        await [...maestro.workshopListeners][0]!(true);
        expect(workshops).toEqual([true]);

        await maestro.setWorkshop(false);
        expect(paused).toBe(false);
        expect(workshops).toEqual([true, false]);
        expect(bridge.workshop()).toBe(false);
        bridge.dispose();
        expect(maestro.workshopListeners.size).toBe(0);
    });

    it('notices a workshop chat already open when Maestro appears', async () => {
        const { bridge, workshops } = setup();
        bridge.install();
        await publish(fakeMaestro({ workshop: true }));
        expect(workshops).toEqual([true]);
        expect(bridge.workshop()).toBe(true);
        bridge.dispose();
    });

    it('follows a restarted Maestro: drops the old subscription, takes the new object’s state', async () => {
        const { bridge, workshops, changes } = setup();
        const first = fakeMaestro({ workshop: false });
        bridge.install();
        await publish(first);
        const stale = [...first.workshopListeners][0]!;

        const second = fakeMaestro({ workshop: true });
        await publish(second);
        expect(changes).toEqual([true, true]);
        expect(first.workshopListeners.size).toBe(0);
        expect(second.workshopListeners.size).toBe(1);
        expect(workshops).toEqual([true]);

        // The old object calling its (removed) listener from a running emit changes nothing.
        await stale(false);
        expect(workshops).toEqual([true]);
        expect(bridge.workshop()).toBe(true);

        await second.setWorkshop(false);
        expect(workshops).toEqual([true, false]);
        bridge.dispose();
    });

    it('is out of the workshop when Maestro goes away', async () => {
        const { bridge, workshops } = setup();
        bridge.install();
        await publish(fakeMaestro({ workshop: true }));
        delete globals[MAESTRO_API_GLOBAL];
        expect(bridge.present()).toBe(false);
        await flush();
        expect(workshops).toEqual([true, false]);
        expect(bridge.workshop()).toBe(false);
        bridge.dispose();
    });

    it('survives a throwing `workshop` member', async () => {
        const { bridge, log } = setup();
        const maestro = fakeMaestro({ workshop: false });
        maestro.api.workshop!.active = () => {
            throw new Error('broken');
        };
        maestro.api.workshop!.onChange = () => {
            throw new Error('broken');
        };
        bridge.install();
        await publish(maestro);
        expect(bridge.workshop()).toBe(false);
        expect(log.lines.some((line) => line.level === 'warn')).toBe(true);
        bridge.dispose();
    });

    it('resumes only once the chat switch is through (SillyTavern loads the persona after Maestro decides)', async () => {
        const { bridge, workshops } = setup();
        const maestro = fakeMaestro({ workshop: true });
        const event = EVENT_TYPES.CHAT_CHANGED!;
        // SillyTavern's own listener (the persona of the new chat) is registered before the extensions.
        const seen: boolean[][] = [];
        mock.eventSource.on(event, () => void seen.push([...workshops]));
        bridge.install();
        await publish(maestro);
        expect(workshops).toEqual([true]);
        // Maestro decides in its first listener.
        mock.eventSource.makeFirst(event, () => maestro.setWorkshop(mock.chatId === 'workshop'));

        mock.chatId = 'story';
        await mock.eventSource.emit(event, 'story');
        // SillyTavern's listener ran while Dramatis was still paused; Dramatis' last listener resumed it.
        expect(seen).toEqual([[true]]);
        expect(workshops).toEqual([true, false]);
        expect(bridge.workshop()).toBe(false);

        // Into a workshop chat: the pause comes at once, before SillyTavern's listener.
        mock.chatId = 'workshop';
        await mock.eventSource.emit(event, 'workshop');
        expect(seen[1]).toEqual([true, false, true]);
    });

    it('holds the pause while the resume waits: workshop() stays true until the switch is through', async () => {
        const { bridge, workshops } = setup();
        const maestro = fakeMaestro({ workshop: true });
        bridge.install();
        await publish(maestro);
        mock.chatId = 'story';
        // Maestro's first CHAT_CHANGED listener says «no workshop» — the rest of CHAT_CHANGED is still to come.
        await maestro.setWorkshop(false);
        expect(workshops).toEqual([true]);
        expect(bridge.workshop()).toBe(true);
        // Back into a workshop chat before the switch ended: nothing to resume.
        await maestro.setWorkshop(true);
        await mock.eventSource.emit(EVENT_TYPES.CHAT_CHANGED!, 'story');
        expect(workshops).toEqual([true]);
        expect(bridge.workshop()).toBe(true);
    });

    it('resumes at once when the tag goes while the chat stays open', async () => {
        const { bridge, workshops } = setup();
        const maestro = fakeMaestro({ workshop: true });
        bridge.install();
        await publish(maestro);
        await maestro.setWorkshop(false);
        expect(workshops).toEqual([true, false]);
    });

    it('resumes after a while anyway when the chat switch never reports its end', async () => {
        vi.useFakeTimers();
        try {
            const { bridge, workshops } = setup();
            const maestro = fakeMaestro({ workshop: true });
            bridge.install();
            globals[MAESTRO_API_GLOBAL] = maestro.api;
            expect(bridge.workshop()).toBe(true);
            await vi.advanceTimersByTimeAsync(0);
            expect(workshops).toEqual([true]);
            mock.chatId = 'story';
            await maestro.setWorkshop(false);
            await vi.advanceTimersByTimeAsync(RESUME_FALLBACK_MS - 1);
            expect(workshops).toEqual([true]);
            await vi.advanceTimersByTimeAsync(1);
            expect(workshops).toEqual([true, false]);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('Maestro bridge — the scene split (Maestro 1.23+)', () => {
    it('is null without Maestro, with a Maestro that has no `sceneSplit`, and while it is inactive', async () => {
        const { bridge } = setup();
        bridge.install();
        expect(bridge.sceneSplit()).toBeNull();
        await publish(fakeMaestro());
        expect(bridge.sceneSplit()).toBeNull();
        const maestro = fakeMaestro({ sceneSplit: false });
        await publish(maestro);
        expect(bridge.sceneSplit()).toBeNull();
        maestro.splitActive = true;
        expect(bridge.sceneSplit()).toEqual({ tag: 'offscreen' });
    });

    it('reads the tag live, falls back to «offscreen» for an odd one and survives a throwing member', async () => {
        const { bridge, log } = setup();
        bridge.install();
        const maestro = fakeMaestro({ sceneSplit: true });
        await publish(maestro);
        maestro.api.sceneSplit!.tag = 'around';
        expect(bridge.sceneSplit()).toEqual({ tag: 'around' });
        maestro.api.sceneSplit!.tag = '<b>';
        expect(bridge.sceneSplit()).toEqual({ tag: 'offscreen' });
        maestro.api.sceneSplit!.active = () => {
            throw new Error('boom');
        };
        expect(bridge.sceneSplit()).toBeNull();
        expect(log.lines.some((line) => String(line.args[0]).includes('sceneSplit'))).toBe(true);
    });
});
