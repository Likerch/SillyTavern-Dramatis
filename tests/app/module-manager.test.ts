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

    it('gives a module the same session memory on every start, and another module its own', async () => {
        const { modules, app, bus, bridge } = setup(true);
        const memories: { offered: Set<string> }[] = [];
        const one = module('one', {
            init(ctx) {
                const memory = ctx.session(() => ({ offered: new Set<string>() }));
                memory.offered.add(`start ${memories.length + 1}`);
                memories.push(memory);
            },
        });
        let other: object | null = null;
        const two = module('two', {
            init(ctx) {
                other = ctx.session(() => ({ offered: new Set<string>() }));
            },
        });
        modules.register([one.spec, two.spec] as DramatisModule[], () => {});
        await modules.startAll(app);
        await modules.disable('one');
        await modules.enable('one');
        bridge.setWorkshop(true);
        await bus.emit('maestro:workshop', { active: true });
        bridge.setWorkshop(false);
        await bus.emit('maestro:workshop', { active: false });
        expect(memories).toHaveLength(3);
        expect(memories[2]).toBe(memories[0]);
        expect([...memories[0]!.offered]).toEqual(['start 1', 'start 2', 'start 3']);
        expect(other).not.toBe(memories[0]);
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

describe('Modules — «Мастерская» (Maestro 1.21+)', () => {
    const running = (modules: Modules) =>
        modules
            .list()
            .filter((item) => item.running)
            .map((item) => item.module.key);

    it('starts nothing in a workshop chat, not even on enable(), and everything once it is left', async () => {
        const { modules, app, bus, bridge, settings } = setup(true);
        const needy = module('needy', { needsMaestro: true, stage: 2 });
        const plain = module('plain');
        modules.register([needy.spec, plain.spec] as DramatisModule[], () => {});
        bridge.setWorkshop(true);
        await modules.startAll(app);
        expect(running(modules)).toEqual([]);
        await modules.disable('plain');
        await modules.enable('plain');
        expect(settings.isModuleEnabled('plain', true)).toBe(true);
        expect(plain.contexts).toHaveLength(0);
        // Maestro coming back or restarting does not start them either.
        await bus.emit('maestro:changed', { present: true });
        expect(running(modules)).toEqual([]);

        bridge.setWorkshop(false);
        await bus.emit('maestro:workshop', { active: false });
        expect(running(modules)).toEqual(['plain', 'needy']);
    });

    it('stops every running module when a workshop chat opens and starts them again when it is left', async () => {
        const { modules, app, bus, bridge, settings, publisher } = setup(true);
        const order: string[] = [];
        const early = module('early', {
            stage: 0,
            init(ctx) {
                order.push('start early');
                ctx.app.modules.expose('api', { active: () => true });
                ctx.own(() => void order.push('stop early'));
            },
        });
        const late = module('late', {
            stage: 3,
            needsMaestro: true,
            init(ctx) {
                order.push('start late');
                ctx.own(() => void order.push('stop late'));
            },
        });
        const off = module('off', { enabledByDefault: false });
        modules.register([early.spec, late.spec, off.spec] as DramatisModule[], () => {});
        await modules.startAll(app);
        expect(publisher.api.active()).toBe(true);

        bridge.setWorkshop(true);
        await bus.emit('maestro:workshop', { active: true });
        // Stopped in reverse stage order, as stopAll(); the switches stay as they were.
        expect(order).toEqual(['start early', 'start late', 'stop late', 'stop early']);
        expect(running(modules)).toEqual([]);
        expect(publisher.api.active()).toBe(false);
        expect(settings.isModuleEnabled('early', true)).toBe(true);
        expect(settings.isModuleEnabled('late', true)).toBe(true);

        bridge.setWorkshop(false);
        await bus.emit('maestro:workshop', { active: false });
        expect(order.slice(4)).toEqual(['start early', 'start late']);
        expect(running(modules)).toEqual(['early', 'late']);
        expect(publisher.api.active()).toBe(true);
        expect(off.contexts).toHaveLength(0);
    });

    it('the flip resolves only when the stop has finished (Maestro awaits it before CHAT_CHANGED goes on)', async () => {
        const { modules, app, bus, bridge } = setup(true);
        let released = false;
        const slow = module('slow', {
            init(ctx) {
                ctx.own(async () => {
                    await flush();
                    released = true;
                });
            },
        });
        modules.register([slow.spec] as DramatisModule[], () => {});
        await modules.startAll(app);
        bridge.setWorkshop(true);
        await bus.emit('maestro:workshop', { active: true });
        expect(released).toBe(true);
    });

    it('a stale flip queued behind a slow start ends in the latest state', async () => {
        const { modules, app, bus, bridge } = setup(true);
        let finish = () => {};
        const slow = module('slow', {
            init: () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                }),
        });
        modules.register([slow.spec] as DramatisModule[], () => {});
        const started = modules.startAll(app);
        await flush();
        bridge.setWorkshop(true);
        const opened = bus.emit('maestro:workshop', { active: true });
        // Left again before the pause got its turn: the queued pause reads the bridge and stops nothing.
        bridge.setWorkshop(false);
        const left = bus.emit('maestro:workshop', { active: false });
        finish();
        await Promise.all([started, opened, left]);
        expect(running(modules)).toEqual(['slow']);
        expect(slow.released).not.toHaveBeenCalled();
    });

    it('stops following the workshop on dispose', async () => {
        const { modules, app, bus, bridge } = setup(true);
        const one = module('one');
        modules.register([one.spec] as DramatisModule[], () => {});
        await modules.startAll(app);
        await modules.dispose();
        bridge.setWorkshop(false);
        await bus.emit('maestro:workshop', { active: false });
        expect(one.contexts).toHaveLength(1);
    });
});
