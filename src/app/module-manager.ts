// Starts and stops Dramatis modules (ported from Maestro's module manager). Everything a module registers through
// `own()` is released when it stops, so a stopped module leaves no trace.
// - enabled = the user's switch, else the module's default (settings.isModuleEnabled);
// - modules with `needsMaestro` start only while MAESTRO_API is present, stop when it disappears and restart when
//   Maestro restarts (a new API object forgets their registrations) — bus `maestro:changed`;
// - «Мастерская» (Maestro 1.21+): no module runs in a workshop chat (a helper card's chat, where the story machinery
//   stays silent). Every running module stops when such a chat opens and every module that can start starts again when
//   it is left or the card loses the tag — bus `maestro:workshop`, whose emit Maestro awaits, so the modules are gone
//   before the rest of CHAT_CHANGED runs. Their switches do not change;
// - each module gets an App whose `modules.expose()` knows the module: exposing `'api'` registers a DRAMATIS_API part
//   (src/app/api.ts), any other key an inter-module API; both are dropped when the module stops;
// - `session()` gives a module the same memory object on every start of this manager's life (the page session):
//   «once per session» marks survive a stop and start — a workshop chat round trip must not offer or read again.
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
    /** MAESTRO_API object the module started with (needsMaestro modules register on it). */
    maestro: unknown;
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
    /** Each module's session memory (ModuleContext.session), kept past its stops. */
    private readonly memories = new Map<string, object>();
    private app: App | null = null;
    /** startAll() ran and stopAll() has not: modules may start. */
    private active = false;
    private offMaestro: Unsubscribe | null = null;
    private offWorkshop: Unsubscribe | null = null;
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
                maestro: null,
            });
            registerStrings(module);
        }
    }

    /** Starts every enabled module (in stage order) that can run now. */
    startAll(app: App): Promise<void> {
        this.app = app;
        this.active = true;
        this.offMaestro ??= this.deps.bus.on('maestro:changed', () => this.followMaestro());
        this.offWorkshop ??= this.deps.bus.on('maestro:workshop', () => this.followWorkshop());
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
        this.offWorkshop?.();
        this.offWorkshop = null;
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
        if (this.deps.bridge.workshop()) return false;
        return !entry.module.needsMaestro || this.deps.bridge.present();
    }

    private serial(job: () => Promise<void>): Promise<void> {
        const next = this.queue.then(job, job);
        this.queue = next.catch(() => undefined);
        return next;
    }

    /**
     * Maestro came, went or restarted: start or stop the modules that need it. A restarted Maestro (a new API object)
     * forgot every task, applier, undo handler and turn listener registered on the old one, so its modules restart.
     */
    private followMaestro(): Promise<void> {
        return this.serial(async () => {
            const api = this.deps.bridge.api();
            const present = api !== null;
            const stale = present ? this.ordered().filter((entry) => this.restartsFor(entry, api)) : [];
            for (const entry of [...stale].reverse()) await this.stop(entry);
            for (const entry of this.ordered()) {
                if (!entry.module.needsMaestro) continue;
                if (present && this.canStart(entry)) await this.start(entry);
                else if (!present) await this.stop(entry);
            }
        });
    }

    /**
     * «Мастерская» flipped: in a workshop chat every running module stops (reverse stage order, as stopAll), out of it
     * every module that can start starts again. The bridge is read when the job runs, so flips queued behind a slow
     * start end in the latest state.
     */
    private followWorkshop(): Promise<void> {
        return this.serial(async () => {
            if (this.deps.bridge.workshop()) {
                for (const entry of this.ordered().reverse()) await this.stop(entry);
                return;
            }
            for (const entry of this.ordered()) if (this.canStart(entry)) await this.start(entry);
        });
    }

    /** A running module that needs Maestro and started with another MAESTRO_API object. */
    private restartsFor(entry: Entry, api: unknown): boolean {
        return !!entry.module.needsMaestro && entry.running && entry.maestro !== api;
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
        entry.maestro = this.deps.bridge.api();
        try {
            await entry.module.init({
                app: this.scopedApp(app, entry),
                settings: this.deps.settings.module(entry.module.key, entry.module.defaults as () => object),
                log,
                own: (dispose) => entry.disposers.push(dispose),
                session: <T extends object>(create: () => T): T => this.memory(entry.module.key, create),
            });
            entry.running = true;
            log.debug('started');
        } catch (error) {
            log.error('init failed', error);
            await this.release(entry);
        }
    }

    private memory<T extends object>(key: string, create: () => T): T {
        let memory = this.memories.get(key) as T | undefined;
        if (!memory) {
            memory = create();
            this.memories.set(key, memory);
        }
        return memory;
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
