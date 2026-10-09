// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiPublisher } from '../../src/app/api';
import { createBus } from '../../src/core/bus';
import { Settings } from '../../src/core/settings';
import { DRAMATIS_API_GLOBAL, DRAMATIS_API_READY_EVENT } from '../../src/shared/apis';
import type { DramatisApiV1 } from '../../src/shared/apis';
import { memoryLogger } from '../helpers/fakes';
import { flush, installStMock } from '../helpers/st-mock';

const globals = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
    installStMock();
});

afterEach(() => {
    delete globals[DRAMATIS_API_GLOBAL];
});

function setup() {
    const log = memoryLogger();
    const settings = new Settings(
        () => ({}),
        () => {},
        log,
    );
    const bus = createBus(log);
    const publisher = createApiPublisher({ version: '0.0.1', settings, bus, log });
    return { publisher, settings, bus, log };
}

describe('DRAMATIS_API publication', () => {
    it('publishes v1 with safe defaults and announces it', () => {
        const { publisher } = setup();
        const ready = vi.fn();
        window.addEventListener(DRAMATIS_API_READY_EVENT, ready);
        publisher.publish();
        window.removeEventListener(DRAMATIS_API_READY_EVENT, ready);

        const api = globals[DRAMATIS_API_GLOBAL] as DramatisApiV1;
        expect(api).toBe(publisher.api);
        expect(ready).toHaveBeenCalledOnce();
        expect(api.version).toBe(1);
        expect(api.dramatisVersion).toBe('0.0.1');
        expect(api.active()).toBe(false);
        expect(api.castBlockActive()).toBe(false);
        expect(api.dependenceOwned()).toEqual([]);
        expect(api.stances()).toEqual([]);
        expect(api.goals('Марта')).toEqual([]);
        expect(api.offscreenBrief('Марта')).toBeNull();
        expect(api.matureAgendas()).toEqual([]);
        expect(api.replacesSocialMechanics()).toBe(false);
    });

    it('answers from the latest part that defines a method, and from defaults when it throws', () => {
        const { publisher, log } = setup();
        const offFirst = publisher.registerPart({ castBlockActive: () => true, dependenceOwned: () => ['Брам'] });
        publisher.registerPart({
            castBlockActive: () => false,
            stances: () => {
                throw new Error('broken');
            },
        });
        expect(publisher.api.castBlockActive()).toBe(false);
        expect(publisher.api.dependenceOwned()).toEqual(['Брам']);
        expect(publisher.api.stances()).toEqual([]);
        expect(log.lines.some((line) => line.level === 'warn')).toBe(true);
        offFirst();
        expect(publisher.api.dependenceOwned()).toEqual([]);
    });

    it('gives defaults while Dramatis is switched off', () => {
        const { publisher, settings } = setup();
        publisher.registerPart({ active: () => true });
        expect(publisher.api.active()).toBe(true);
        settings.set('enabled', false);
        expect(publisher.api.active()).toBe(false);
    });

    it('fires onChange once per burst of changes', async () => {
        const { publisher, bus, settings } = setup();
        publisher.publish();
        const listener = vi.fn();
        const off = publisher.api.onChange(listener);
        void bus.emit('state:changed', { chatId: 'c' });
        void bus.emit('profiles:changed', { card: 'a.png' });
        await flush();
        expect(listener).toHaveBeenCalledOnce();
        settings.set('enabled', false);
        await flush();
        expect(listener).toHaveBeenCalledTimes(2);
        off();
        publisher.registerPart({});
        await flush();
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('is removed on unpublish and dispose', () => {
        const { publisher } = setup();
        publisher.publish();
        publisher.unpublish();
        expect(globals[DRAMATIS_API_GLOBAL]).toBeUndefined();
        publisher.publish();
        publisher.dispose();
        expect(globals[DRAMATIS_API_GLOBAL]).toBeUndefined();
    });
});
