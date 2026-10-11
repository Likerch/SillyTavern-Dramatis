// Builds the App: host, core services, readers, the Maestro bridge, UI, API and modules. The only place that knows
// every layer.
import { version as packageVersion } from '../../package.json';
import { createMaestroBridge, createReaders } from '../adapters';
import type { MaestroBridgeImpl, ReadersImpl } from '../adapters';
import { createBus } from '../core/bus';
import { createEphemeral } from '../core/ephemeral';
import { createFileStore } from '../core/files';
import { createI18n, hostLocale } from '../core/i18n';
import { createLlmRouter } from '../core/llm';
import { ConsoleLogger, createLogger } from '../core/logger';
import { createProfileStore } from '../core/profiles';
import { Settings } from '../core/settings';
import { createStateStore } from '../core/state';
import { CORE_STRINGS } from '../core/strings';
import { createTurnTracker } from '../core/turn';
import type { TurnTracker } from '../core/turn';
import { createHost } from '../host';
import type { App, Rng, Unsubscribe } from '../shared/contracts';
import { UI_STRINGS, createUi, el, generalSettingsSection } from '../ui';
import { createApiPublisher } from './api';
import type { ApiPublisher } from './api';
import { Modules } from './module-manager';
import { MODULES } from './registry';

export const DRAMATIS_VERSION: string = packageVersion;

/** The window `/dramatis` opens; a module registers the real one (the app keeps a placeholder underneath). */
export const CAST_WINDOW_ID = 'cast';

export interface Runtime {
    app: App;
    settings: Settings;
    modules: Modules;
    turn: TurnTracker;
    bridge: MaestroBridgeImpl;
    readers: ReadersImpl;
    api: ApiPublisher;
    stop(): Promise<void>;
}

export async function startDramatis(options: { rng?: Rng } = {}): Promise<Runtime> {
    const log = createLogger();
    const host = createHost(log.scope('host'));
    const settings = new Settings(
        () => host.ctx().extensionSettings,
        () => host.ctx().saveSettingsDebounced(),
        log.scope('settings'),
    );
    ConsoleLogger.setLevel(settings.get().debug ? 'debug' : 'info');

    const i18n = createI18n(() => {
        const choice = settings.get().uiLanguage;
        if (choice === 'ru' || choice === 'en') return choice;
        return hostLocale(() => host.ctx().getCurrentLocale?.());
    });
    i18n.register(CORE_STRINGS);
    i18n.register(UI_STRINGS);

    const bus = createBus(log.scope('bus'));
    const files = createFileStore(host, log.scope('files'));
    const bridge = createMaestroBridge(host, bus, log.scope('maestro'));
    const readers = createReaders(host, log.scope('readers'));
    const profiles = createProfileStore({ host, files, bus, log: log.scope('profiles') });
    const state = createStateStore({
        host,
        files,
        profiles,
        bus,
        log: log.scope('state'),
        greeting: () => readers.card.greetingIndex(),
    });
    const llm = createLlmRouter({ host, settings, bridge, log: log.scope('llm') });
    const ephemeral = createEphemeral({ host, log: log.scope('ephemeral') });
    const turn = createTurnTracker({ host, bus, ephemeral, bridge, log: log.scope('turn') });
    const ui = createUi({ host, i18n, log: log.scope('ui') });
    const api = createApiPublisher({
        version: DRAMATIS_VERSION,
        settings,
        bus,
        log: log.scope('api'),
        i18n,
        workshop: () => bridge.workshop(),
    });
    const modules = new Modules({
        settings,
        bridge,
        bus,
        log: log.scope('modules'),
        registerApiPart: (part) => api.registerPart(part),
    });

    const app: App = {
        version: DRAMATIS_VERSION,
        host,
        log,
        i18n,
        settings,
        files,
        profiles,
        state,
        llm,
        ephemeral,
        bus,
        readers,
        maestro: bridge,
        ui,
        rng: options.rng ?? Math.random,
        modules,
    };

    modules.register(MODULES, (module) => {
        if (module.i18n) i18n.register(module.i18n);
    });

    bridge.install();
    readers.install();
    state.install();
    turn.install();
    ui.mount();

    const owned: Unsubscribe[] = [];
    owned.push(ui.addSettingsSection(generalSettingsSection({ settings, i18n, host })));
    owned.push(
        ui.addWindow({
            id: CAST_WINDOW_ID,
            titleKey: 'ui.window.cast',
            render(container) {
                container.append(el('div', { class: 'dramatis-placeholder', text: i18n.t('ui.window.placeholder') }));
            },
        }),
    );
    owned.push(
        ui.addSlashCommand('dramatis', 'ui.slash.dramatis', () => {
            ui.openWindow(CAST_WINDOW_ID);
            return '';
        }),
    );
    owned.push(
        settings.onChange((key) => {
            if (key === 'debug' || key === '*') ConsoleLogger.setLevel(settings.get().debug ? 'debug' : 'info');
            if (key === 'uiLanguage' || key === '*') ui.relabel();
            if (key === 'enabled' || key === '*') {
                if (settings.get().enabled) void modules.startAll(app);
                else void modules.stopAll();
            }
        }),
    );

    api.publish();
    if (settings.get().enabled) await modules.startAll(app);

    // Extensions loaded after us may have pushed their listeners behind our 'last' ones.
    const appReady = host.events.name('APP_READY');
    if (appReady) owned.push(host.events.on(appReady, () => host.events.reassertOrder()));

    log.info(`${DRAMATIS_VERSION} started${bridge.present() ? ' with Maestro' : ''}`);

    return {
        app,
        settings,
        modules,
        turn,
        bridge,
        readers,
        api,
        async stop() {
            for (const off of owned.splice(0)) off();
            await modules.dispose();
            api.dispose();
            ui.dispose();
            turn.dispose();
            state.dispose();
            readers.dispose();
            bridge.dispose();
            bus.clear();
            host.dispose();
        },
    };
}
