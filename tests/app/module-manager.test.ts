import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiPublisher } from '../../src/app/api';
import { Modules } from '../../src/app/module-manager';
import { createBus } from '../../src/core/bus';
import { Settings } from '../../src/core/settings';
import type { App, DramatisModule, ModuleContext } from '../../src/shared/contracts';
import { fakeMaestro, memoryLogger, staticBridge } from '../helpers/fakes';
import { flush, installStMock } from '../helpers/st-mock';

beforeEach(() => {
    installStMock();
});

function setup(withMaestro = false) {
    const log = memoryLogger();
    const store: Record<string, unknown> = {};
    const settings = new Settings(
        () => store,
        () => {},
        log,
    );
    const bus = createBus(log);
    const maestro = fakeMaestro();
    const bridge = staticBridge(withMaestro ? maestro.api : null);
    const publisher = createApiPublisher({ version: '0.0.1', settings, bus, log });
    const modules = new Modules({
        settings,
        bridge,
        bus,
        log,
        registerApiPart: (part) => publisher.registerPart(part),
    });
    const app = { modules, bus, settings } as unknown as App;
    return { settings, bus, bridge, maestro, modules, app, publisher, log };
}

function module(key: string, overrides: Partial<DramatisModule<{ n: number }>> = {}) {
    const released = vi.fn();
    const contexts: ModuleContext<{ n: number }>[] = [];
    const spec: DramatisModule<{ n: number }> = {
        key,
        stage: 1,
        titleKey: `${key}.title`,
        enabledByDefault: true,
        defaults: () => ({ n: 1 }),
        init(ctx) {
            contexts.push(ctx);
            ctx.own(released);
        },
        ...overrides,
    };
    return { spec, released, contexts };
}

describe('Modules', () => {
    it('starts enabled modules in stage order with their settings slice', async () => {
        const order: string[] = [];
        const { modules, app, settings } = setup();
        const late = module('late', { stage: 3, init: () => void order.push('late') });
        const early = module('early', { stage: 0, init: () => void order.push('early') });
        const off = module('off', { enabledByDefault: false });
        const strings = vi.fn();
        modules.register([late.spec, early.spec, off.spec] as DramatisModule[], strings);
        expect(strings).toHaveBeenCalledTimes(3);
        await modules.startAll(app);
        expect(order).toEqual(['early', 'late']);
        expect(modules.list().map((item) => [item.module.key, item.enabled, item.running])).toEqual([
            ['early', true, true],
            ['off', false, false],
            ['late', true, true],
        ]);
        expect(settings.module('late', () => ({ n: 0 }))).toEqual({ n: 1 });
    });

    it('releases everything a module owns on disable and starts it again on enable', async () => {
        const { modules, app, settings } = setup();
        const one = module('one');
        modules.register([one.spec] as DramatisModule[], () => {});
        await modules.startAll(app);
        await modules.disable('one');
        expect(one.released).toHaveBeenCalledOnce();
        expect(settings.isModuleEnabled('one', true)).toBe(false);
        await modules.enable('one');
        expect(one.contexts).toHaveLength(2);
        expect(modules.list()[0]?.running).toBe(true);
    });

    it('rejects duplicate keys and survives a failing init', async () => {
        const { modules, app, log } = setup();
        expect(() => modules.register([module('a').spec, module('a').spec] as DramatisModule[], () => {})).toThrow();
        const broken = module('broken', {
            init(ctx) {
                ctx.own(() => {});
                throw new Error('nope');
            },
        });
        modules.register([broken.spec] as DramatisModule[], () => {});
        await modules.startAll(app);
        expect(modules.list().find((item) => item.module.key === 'broken')?.running).toBe(false);
        expect(log.lines.some((line) => line.level === 'error')).toBe(true);
    });

    it('starts needsMaestro modules only while Maestro is present', async () => {
        const { modules, app, bus, bridge, maestro } = setup(false);
        const needy = module('needy', { needsMaestro: true });
        const plain = module('plain');
        modules.register([needy.spec, plain.spec] as DramatisModule[], () => {});
        await modules.startAll(app);
        expect(needy.contexts).toHaveLength(0);
        expect(plain.contexts).toHaveLength(1);

        bridge.set(maestro.api);
        await bus.emit('maestro:changed', { present: true });
        await flush();
        expect(needy.contexts).toHaveLength(1);
        expect(modules.list().find((item) => item.module.key === 'needy')?.running).toBe(true);

        bridge.set(null);
        await bus.emit('maestro:changed', { present: false });
        await flush();
        expect(needy.released).toHaveBeenCalledOnce();
        expect(plain.released).not.toHaveBeenCalled();
        expect(modules.list().find((item) => item.module.key === 'needy')?.running).toBe(false);
    });

    it('restarts needsMaestro modules when Maestro restarts with a new API object (registrations are gone)', async () => {
        const { modules, app, bus, bridge } = setup(true);
        const needy = module('needy', { needsMaestro: true });
        const plain = module('plain');
        modules.register([needy.spec, plain.spec] as DramatisModule[], () => {});
        await modules.startAll(app);
        expect(needy.contexts).toHaveLength(1);

        // Same object again (a chat change re-check): nothing restarts.
        await bus.emit('maestro:changed', { present: true });
        await flush();
        expect(needy.contexts).toHaveLength(1);

        bridge.set(fakeMaestro().api);
        await bus.emit('maestro:changed', { present: true });
        await flush();
        expect(needy.released).toHaveBeenCalledOnce();
        expect(needy.contexts).toHaveLength(2);
        expect(plain.contexts).toHaveLength(1);
        expect(modules.list().find((item) => item.module.key === 'needy')?.running).toBe(true);
    });

    it('scopes expose(): API parts and named APIs go away with the module', async () => {
        const { modules, app, publisher, settings } = setup();
        const cast = module('cast', {
            init(ctx) {
                ctx.app.modules.expose('api', { active: () => true, goals: (name: string) => [`goal of ${name}`] });
                ctx.app.modules.expose('cast.view', { open: () => 1 });
            },
        });
        modules.register([cast.spec] as DramatisModule[], () => {});
        await modules.startAll(app);
        expect(publisher.api.active()).toBe(true);
        expect(publisher.api.goals('Марта')).toEqual(['goal of Марта']);
        expect(modules.api<{ open(): number }>('cast.view')?.open()).toBe(1);

        settings.set('enabled', false);
        expect(publisher.api.active()).toBe(false);
        settings.set('enabled', true);

        await modules.disable('cast');
        expect(publisher.api.active()).toBe(false);
        expect(publisher.api.goals('Марта')).toEqual([]);
        expect(modules.api('cast.view')).toBeUndefined();
    });

    it('stops everything on stopAll and keeps them stopped until startAll', async () => {
        const { modules, app } = setup();
        const one = module('one');
        modules.register([one.spec] as DramatisModule[], () => {});
        await modules.startAll(app);
        await modules.stopAll();
        expect(one.released).toHaveBeenCalledOnce();
        await modules.enable('one');
        expect(one.contexts).toHaveLength(1);
        await modules.startAll(app);
        expect(one.contexts).toHaveLength(2);
        await modules.dispose();
    });
});
