// Starts and stops Dramatis modules (ported from Maestro's module manager). Everything a module registers through
// `own()` is released when it stops, so a stopped module leaves no trace.
// - enabled = the user's switch, else the module's default (settings.isModuleEnabled);
// - modules with `needsMaestro` start only while MAESTRO_API is present and stop when it disappears
//   (bus `maestro:changed`);
// - each module gets an App whose `modules.expose()` knows the module: exposing `'api'` registers a DRAMATIS_API part
//   (src/app/api.ts), any other key an inter-module API; both are dropped when the module stops.
import type {
    App,
    Bus,
    DramatisModule,
    Logger,
    MaestroBridge,
    ModuleManager,
    SettingsService,
    Unsubscribe,
} from '../shared/contracts';
import { API_PART_KEY } from './api';
import type { DramatisApiPart } from './api';

type Disposer = Unsubscribe | (() => void | Promise<void>);

interface Entry {
    module: DramatisModule;
    running: boolean;
    disposers: Disposer[];
    /** API keys the module exposed (besides its API part); dropped when it stops. */
    exposed: Set<string>;
    /** Removes the module's DRAMATIS_API part. */
    apiPartOff: Unsubscribe | null;
    /** init() in progress. */
    starting: Promise<void> | null;
}

export interface ModulesDeps {
    settings: SettingsService;
    bridge: MaestroBridge;
    bus: Bus;
    log: Logger;
    registerApiPart(part: DramatisApiPart): Unsubscribe;
}

export class Modules implements ModuleManager {
    private readonly entries = new Map<string, Entry>();
    private readonly apis = new Map<string, unknown>();
    private app: App | null = null;
    /** startAll() ran and stopAll() has not: modules may start. */
    private active = false;
    private offMaestro: Unsubscribe | null = null;
    /** Serialises starts and stops (Maestro may come and go while modules start). */
    private queue: Promise<unknown> = Promise.resolve();

    constructor(private readonly deps: ModulesDeps) {}

    register(modules: DramatisModule[], registerStrings: (module: DramatisModule) => void): void {
        for (const module of modules) {
            if (this.entries.has(module.key)) throw new Error(`duplicate module key ${module.key}`);
            this.entries.set(module.key, {
                module,
                running: false,
                disposers: [],
                exposed: new Set(),
                apiPartOff: null,
                starting: null,
            });
            registerStrings(module);
        }
    }

    /** Starts every enabled module (in stage order) that can run now. */
    startAll(app: App): Promise<void> {
        this.app = app;
        this.active = true;
        this.offMaestro ??= this.deps.bus.on('maestro:changed', () => this.followMaestro());
        return this.serial(async () => {
            for (const entry of this.ordered()) if (this.canStart(entry)) await this.start(entry);
        });
    }

    /** Stops every running module (reverse stage order). */
    stopAll(): Promise<void> {
        this.active = false;
        return this.serial(async () => {
            for (const entry of this.ordered().reverse()) await this.stop(entry);
        });
    }

    /** stopAll() and stop following Maestro (app stop). */
    async dispose(): Promise<void> {
        this.offMaestro?.();
        this.offMaestro = null;
        await this.stopAll();
    }

    list(): { module: DramatisModule; enabled: boolean; running: boolean }[] {
        return this.ordered().map((entry) => ({
            module: entry.module,
            enabled: this.enabled(entry),
            running: entry.running,
        }));
    }

    // Not queued: a module may switch another one from its own init (queued, that would wait for itself).
    async enable(key: string): Promise<void> {
        const entry = this.entries.get(key);
        if (!entry) return;
        this.deps.settings.setModuleEnabled(key, true);
        if (this.canStart(entry)) await this.start(entry);
    }

    async disable(key: string): Promise<void> {
        const entry = this.entries.get(key);
        if (!entry) return;
        this.deps.settings.setModuleEnabled(key, false);
        await this.stop(entry);
    }

    api<T>(key: string): T | undefined {
        return this.apis.get(key) as T | undefined;
    }

    /** App-level expose (not owned by a module): an API part stays until the app stops. */
    expose(key: string, api: unknown): void {
        if (key === API_PART_KEY) {
            if (api && typeof api === 'object') this.deps.registerApiPart(api as DramatisApiPart);
            return;
        }
        if (api === undefined) this.apis.delete(key);
        else this.apis.set(key, api);
    }

    private ordered(): Entry[] {
        return [...this.entries.values()].sort((a, b) => a.module.stage - b.module.stage);
    }

    private enabled(entry: Entry): boolean {
        return this.deps.settings.isModuleEnabled(entry.module.key, entry.module.enabledByDefault);
    }

    private canStart(entry: Entry): boolean {
        if (!this.active || !this.app || entry.running || !this.enabled(entry)) return false;
        return !entry.module.needsMaestro || this.deps.bridge.present();
    }

    private serial(job: () => Promise<void>): Promise<void> {
        const next = this.queue.then(job, job);
        this.queue = next.catch(() => undefined);
        return next;
    }

    /** Maestro came or went: start or stop the modules that need it. */
    private followMaestro(): Promise<void> {
        return this.serial(async () => {
            const present = this.deps.bridge.present();
            for (const entry of this.ordered()) {
                if (!entry.module.needsMaestro) continue;
                if (present && this.canStart(entry)) await this.start(entry);
                else if (!present) await this.stop(entry);
            }
        });
    }

    /** The App a module sees: its `modules.expose()` is bound to the module. */
    private scopedApp(app: App, entry: Entry): App {
        const owner: ModuleManager = {
            list: () => this.list(),
            enable: (key) => this.enable(key),
            disable: (key) => this.disable(key),
            api: <T>(key: string) => this.api<T>(key),
            expose: (key, api) => this.exposeFor(entry, key, api),
        };
        return { ...app, modules: owner };
    }

    private exposeFor(entry: Entry, key: string, api: unknown): void {
        if (key === API_PART_KEY) {
            entry.apiPartOff?.();
            entry.apiPartOff =
                api && typeof api === 'object' ? this.deps.registerApiPart(api as DramatisApiPart) : null;
            return;
        }
        if (api === undefined) {
            this.apis.delete(key);
            entry.exposed.delete(key);
            return;
        }
        this.apis.set(key, api);
        entry.exposed.add(key);
    }

    private start(entry: Entry): Promise<void> {
        const app = this.app;
        if (!app || entry.running) return Promise.resolve();
        entry.starting ??= this.init(app, entry).finally(() => {
            entry.starting = null;
        });
        return entry.starting;
    }

    private async init(app: App, entry: Entry): Promise<void> {
        const log = this.deps.log.scope(entry.module.key);
        try {
            await entry.module.init({
                app: this.scopedApp(app, entry),
                settings: this.deps.settings.module(entry.module.key, entry.module.defaults as () => object),
                log,
                own: (dispose) => entry.disposers.push(dispose),
            });
            entry.running = true;
            log.debug('started');
        } catch (error) {
            log.error('init failed', error);
            await this.release(entry);
        }
    }

    private async stop(entry: Entry): Promise<void> {
        if (entry.starting) await entry.starting;
        if (!entry.running) return;
        entry.running = false;
        try {
            await entry.module.dispose?.();
        } catch (error) {
            this.deps.log.error(`dispose of ${entry.module.key} failed`, error);
        }
        await this.release(entry);
    }

    private async release(entry: Entry): Promise<void> {
        for (const dispose of entry.disposers.splice(0).reverse()) {
            try {
                await dispose();
            } catch (error) {
                this.deps.log.error(`release in ${entry.module.key} failed`, error);
            }
        }
        entry.apiPartOff?.();
        entry.apiPartOff = null;
        this.apis.delete(entry.module.key);
        for (const key of entry.exposed) this.apis.delete(key);
        entry.exposed.clear();
    }
}
