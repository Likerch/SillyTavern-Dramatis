// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiPublisher } from '../../src/app/api';
import { createBus } from '../../src/core/bus';
import { createI18n } from '../../src/core/i18n';
import { Settings } from '../../src/core/settings';
import { CORE_STRINGS } from '../../src/core/strings';
import { DRAMATIS_API_GLOBAL, DRAMATIS_API_READY_EVENT } from '../../src/shared/apis';
import type { DramatisApiV1, DramatisCharacterView } from '../../src/shared/apis';
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
    const i18n = createI18n(() => 'ru');
    i18n.register(CORE_STRINGS);
    const publisher = createApiPublisher({ version: '0.0.1', settings, bus, log, i18n });
    return { publisher, settings, bus, log };
}

const NO_READING = 'Замысел сейчас не прочитать: Dramatis или его модуль «Замысел автора» выключен.';

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
        expect(api.startCast!(0)).toEqual([]);
        expect(api.intentState!()).toBeNull();
        expect(api.describe!('Марта')).toBeNull();
        expect(() => api.openSheet!('Марта')).not.toThrow();
    });

    it('passes the 1.3 members to the parts: intent state, reading, a character summary, the sheet', async () => {
        const { publisher } = setup();
        const view: DramatisCharacterView = { name: 'Марта', sections: [], secrets: 'spoiler' };
        const opened: (string | undefined)[] = [];
        publisher.registerPart({
            intentState: () => ({ read: true, at: 5, characters: 2, groups: 1, running: false }),
            readIntent: async (options) => ({ ok: true, characters: options?.force ? 3 : 0, skipped: !options?.force }),
            describe: (name) => (name === 'Марта' ? view : null),
            openSheet: (name) => void opened.push(name),
        });
        const api = publisher.api;
        expect(api.intentState!()).toEqual({ read: true, at: 5, characters: 2, groups: 1, running: false });
        expect(await api.readIntent!({ force: true })).toEqual({ ok: true, characters: 3, skipped: false });
        expect(api.describe!('Марта')).toBe(view);
        expect(api.describe!('Брам')).toBeNull();
        api.openSheet!('Марта');
        api.openSheet!();
        expect(opened).toEqual(['Марта', undefined]);
    });

    it('answers readIntent with «not available» without a reader, when switched off or when the reader breaks', async () => {
        const { publisher, settings, log } = setup();
        const outcome = { ok: false, characters: 0, error: NO_READING, message: NO_READING };
        expect(await publisher.api.readIntent!()).toEqual(outcome);
        publisher.registerPart({ readIntent: async () => ({ ok: true, characters: 1 }) });
        settings.set('enabled', false);
        expect(await publisher.api.readIntent!()).toEqual(outcome);
        settings.set('enabled', true);
        publisher.registerPart({ readIntent: () => Promise.reject(new Error('boom')) });
        expect(await publisher.api.readIntent!()).toEqual(outcome);
        expect(log.lines.some((line) => line.level === 'warn')).toBe(true);
    });

    it('says the key when it has no words for «not available»', async () => {
        const log = memoryLogger();
        const settings = new Settings(
            () => ({}),
            () => {},
            log,
        );
        const publisher = createApiPublisher({ version: '0.0.1', settings, bus: createBus(log), log });
        expect(await publisher.api.readIntent!()).toMatchObject({ ok: false, error: 'core.api.noReading' });
    });

    it('says a workshop chat (Maestro 1.21 «Мастерская») is why nothing can read', async () => {
        const log = memoryLogger();
        const settings = new Settings(
            () => ({}),
            () => {},
            log,
        );
        const i18n = createI18n(() => 'ru');
        i18n.register(CORE_STRINGS);
        let workshop = true;
        const bus = createBus(log);
        const publisher = createApiPublisher({ version: '0.0.1', settings, bus, log, i18n, workshop: () => workshop });
        expect(await publisher.api.readIntent!()).toMatchObject({
            ok: false,
            error: 'Это чат мастерской (Maestro «Мастерская»): здесь Dramatis молчит.',
        });
        workshop = false;
        expect(await publisher.api.readIntent!()).toMatchObject({ ok: false, error: NO_READING });
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
