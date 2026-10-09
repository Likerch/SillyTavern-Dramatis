// A harness for the sheet module: a fake EngineApi over plain card/state objects (deep clones per update, like the
// engine), a fake intent API, and an App with the real UI shell over the ST mock.
import { vi } from 'vitest';
import { createBus } from '../../../src/core/bus';
import { createI18n } from '../../../src/core/i18n';
import { defaultSettings } from '../../../src/core/settings';
import { CORE_STRINGS } from '../../../src/core/strings';
import { matchName } from '../../../src/domain/presence';
import { emptyCardProfiles } from '../../../src/domain/profile-defaults';
import { ensureCharacterState } from '../../../src/domain/state-init';
import type { AttentionBand, CardProfiles, CharacterProfile, ChatState, StateEvent } from '../../../src/domain/model';
import type { EngineApi, EngineView } from '../../../src/features/engine/api';
import { sheetModule } from '../../../src/features/sheet';
import { SHEET_STRINGS } from '../../../src/features/sheet/strings';
import type { IntentApi, IntentReadResult, SheetSettings } from '../../../src/features/sheet/types';
import type { App, DramatisSettings, SettingsService, Unsubscribe } from '../../../src/shared/contracts';
import { UI_STRINGS, createUi } from '../../../src/ui';
import type { UiImpl } from '../../../src/ui';
import { resetSlashSlots } from '../../../src/ui/slash';
import { memoryLogger, mockHost } from '../../helpers/fakes';
import { installStMock } from '../../helpers/st-mock';
import type { StMock } from '../../helpers/st-mock';
import { tavern } from '../../domain/cast-fixtures';

export interface FakeEngine extends EngineApi {
    card: CardProfiles;
    state: ChatState;
    present: string[];
    bands: Record<string, AttentionBand>;
    playerName: string;
    profileCalls: number;
    stateCalls: number;
    logged: StateEvent[];
    /** Saves fail (another tab won). */
    fail: boolean;
    /** No view (the chat is still loading or there is none). */
    noView: boolean;
}

export function fakeEngine(
    card: CardProfiles,
    state: ChatState,
    options: { present?: string[]; bands?: Record<string, AttentionBand>; playerName?: string } = {},
): FakeEngine {
    const listeners = new Set<(view: EngineView | null) => void>();
    let pending: StateEvent[] = [];
    let current: EngineView | null = null;
    const build = (): EngineView => {
        const profiles: CharacterProfile[] = [...engine.card.characters, ...engine.state.extras];
        return {
            card: engine.card,
            state: engine.state,
            profiles,
            byId: new Map(profiles.map((profile) => [profile.id, profile] as const)),
            present: engine.present,
            unknown: [],
            bands: engine.bands,
            playerName: engine.playerName,
            greeting: engine.state.greeting,
        };
    };
    const changed = () => {
        current = build();
        for (const listener of [...listeners]) listener(current);
    };
    const engine: FakeEngine = {
        card,
        state,
        present: options.present ?? [],
        bands: options.bands ?? {},
        playerName: options.playerName ?? 'Курьер',
        profileCalls: 0,
        stateCalls: 0,
        logged: [],
        fail: false,
        noView: false,
        view: () => (engine.noView ? null : (current ??= build())),
        ready: async () => engine.view(),
        async updateState(mutate) {
            engine.stateCalls++;
            if (engine.fail) return false;
            const clone = structuredClone(engine.state);
            const result = mutate(clone, current ?? build());
            const next = result ?? clone;
            next.log = [...next.log, ...pending];
            engine.logged.push(...pending);
            pending = [];
            engine.state = next;
            changed();
            return true;
        },
        async updateProfiles(mutate) {
            engine.profileCalls++;
            if (engine.fail) return false;
            const clone = structuredClone(engine.card);
            const result = mutate(clone, current ?? build());
            engine.card = result ?? clone;
            // New characters get a live state (as the engine does).
            const live = structuredClone(engine.state);
            let added = false;
            for (const profile of engine.card.characters) {
                if (live.characters[profile.id]) continue;
                ensureCharacterState(live, profile);
                added = true;
            }
            if (added) engine.state = live;
            changed();
            return true;
        },
        refresh: async () => changed(),
        resolve: (name) => matchName(name, [...engine.card.characters, ...engine.state.extras]),
        log: (events) => {
            pending.push(...events);
        },
        onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    return engine;
}

/** The tavern of docs/model.md §4.6 as card + state, everyone present. */
export function tavernEngine(): FakeEngine {
    const { profiles, state } = tavern();
    const card: CardProfiles = { ...emptyCardProfiles('tavern.png'), characters: profiles };
    return fakeEngine(card, state, {
        present: ['ilva', 'bram', 'sota', 'carters', 'fenn'],
        bands: { ilva: 'business', bram: 'business', sota: 'focus', carters: 'background', fenn: 'background' },
    });
}

export interface FakeIntent extends IntentApi {
    calls: ({ force?: boolean } | undefined)[];
    busy: boolean;
    last: unknown;
    /** Resolves the pending read with this result. */
    finish(result: IntentReadResult): void;
}

export function fakeIntent(): FakeIntent {
    let resolve: ((result: IntentReadResult) => void) | null = null;
    const intent: FakeIntent = {
        calls: [],
        busy: false,
        last: null,
        read(opts) {
            intent.calls.push(opts);
            intent.busy = true;
            return new Promise((done) => {
                resolve = (result) => {
                    intent.busy = false;
                    intent.last = result;
                    done(result);
                };
            });
        },
        running: () => intent.busy,
        lastResult: () => intent.last,
        finish(result) {
            resolve?.(result);
            resolve = null;
        },
    };
    return intent;
}

export interface Harness {
    app: App;
    ui: UiImpl;
    mock: StMock;
    engine: FakeEngine | null;
    intent: FakeIntent | null;
    slice: SheetSettings;
    settings: DramatisSettings;
    notices: { text: string; level?: string }[];
    /** What the module exposed (`api`: its DRAMATIS_API part). */
    exposed: Map<string, unknown>;
    open(params?: Record<string, unknown>): HTMLElement;
    body(): HTMLElement;
    setSetting<K extends keyof DramatisSettings>(key: K, value: DramatisSettings[K]): void;
    dispose(): Promise<void>;
}

export interface HarnessOptions {
    engine?: FakeEngine | null;
    intent?: FakeIntent | null;
    secrets?: DramatisSettings['secrets'];
    width?: number;
}

export function harness(options: HarnessOptions = {}): Harness {
    const mock = installStMock();
    resetSlashSlots();
    document.body.innerHTML = '';
    Object.defineProperty(window, 'innerWidth', { value: options.width ?? 1280, configurable: true });
    const log = memoryLogger();
    const i18n = createI18n(() => 'ru');
    i18n.register(CORE_STRINGS);
    i18n.register(UI_STRINGS);
    i18n.register(SHEET_STRINGS);
    const host = mockHost(log);
    const ui = createUi({ host, i18n, log });
    const root = defaultSettings();
    root.secrets = options.secrets ?? 'spoiler';
    const slices: Record<string, object> = {};
    const listeners = new Set<(key: string) => void>();
    const settings: SettingsService = {
        get: () => root,
        set(key, value) {
            root[key] = value;
            for (const listener of [...listeners]) listener(key);
        },
        module: <T extends object>(key: string, defaults: () => T) => (slices[key] ??= defaults()) as T,
        isModuleEnabled: (_key, byDefault) => byDefault,
        setModuleEnabled: () => undefined,
        save: vi.fn(),
        reset: () => undefined,
        onChange(listener): Unsubscribe {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    const engine = options.engine === undefined ? tavernEngine() : options.engine;
    const intent = options.intent === undefined ? fakeIntent() : options.intent;
    const notices: { text: string; level?: string }[] = [];
    const exposed = new Map<string, unknown>();
    const app = {
        version: 'test',
        host,
        log,
        i18n,
        settings,
        bus: createBus(log),
        readers: { card: { current: () => ({ name: 'Трактир' }), greetingIndex: () => 0 } },
        ui: {
            ...ui,
            notice: (text: string, opts?: { level?: string }) => void notices.push({ text, level: opts?.level }),
        },
        modules: {
            list: () => [],
            enable: async () => undefined,
            disable: async () => undefined,
            api: <T>(key: string) =>
                (key === 'engine' ? engine : key === 'intent' ? intent : undefined) as T | undefined,
            expose: (key: string, api: unknown) => void exposed.set(key, api),
        },
        rng: () => 0.5,
    } as unknown as App;
    const slice = settings.module('sheet', sheetModule.defaults);
    const owned: (() => void | Promise<void>)[] = [];
    void sheetModule.init({ app, settings: slice, log, own: (dispose) => void owned.push(dispose) });
    return {
        app,
        ui,
        mock,
        engine,
        intent,
        slice,
        settings: root,
        notices,
        exposed,
        open(params) {
            ui.openWindow('cast', params);
            return this.body();
        },
        body: () => document.querySelector<HTMLElement>('[data-window="cast"] .dramatis-window-body')!,
        setSetting: (key, value) => settings.set(key, value),
        async dispose() {
            for (const dispose of owned.splice(0).reverse()) await dispose();
            ui.dispose();
        },
    };
}

/** Waits for queued saves and re-renders. */
export function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The control with this focus key (data-dramatis-key). */
export function byKey<T extends HTMLElement = HTMLElement>(root: ParentNode, key: string): T {
    const node = [...root.querySelectorAll<T>('[data-dramatis-key]')].find(
        (item) => item.getAttribute('data-dramatis-key') === key,
    );
    if (!node) throw new Error(`no control ${key}`);
    return node;
}

/** Sets a value and fires `change` (how the controls commit). */
export function commit(node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
    node.value = value;
    node.dispatchEvent(new Event('change', { bubbles: true }));
}

/** A button by its visible text. */
export function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
    const node = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
        (item) => item.textContent?.trim() === text,
    );
    if (!node) throw new Error(`no button «${text}»`);
    return node;
}

export function profileOf(engine: FakeEngine, id: string): CharacterProfile {
    const profile = [...engine.card.characters, ...engine.state.extras].find((item) => item.id === id);
    if (!profile) throw new Error(`no profile ${id}`);
    return profile;
}
