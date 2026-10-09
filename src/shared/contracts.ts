// Contracts between Dramatis layers (docs/dev-plan.md). Implementations live in src/host, src/core,
// src/adapters and src/ui; features only see these interfaces through the App passed to init().
// Types only, plus tiny constants. The personality model itself is in src/domain/model.ts.
import type { CardProfiles, ChatState } from '../domain/model';
import type { MaestroApiV1 } from './apis';

/* ------------------------------------------------------------------ basics */

export type Unsubscribe = () => void;
export type Dict = Record<string, string>;

export interface I18nParts {
    en: Dict;
    ru: Dict;
}

export interface Logger {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    scope(name: string): Logger;
}

export interface I18n {
    t(key: string, params?: Record<string, string | number>): string;
    register(parts: I18nParts): void;
    locale(): 'ru' | 'en';
}

/** Injectable randomness (dice, sampling): tests pass a seeded one. Returns [0, 1). */
export type Rng = () => number;

/* ------------------------------------------------------------------ settings */

export type Mode = 'economy' | 'balanced' | 'cinema';

/** Every lever of docs/model.md §14; per-chat overrides live in the chat state document. */
export interface DramatisSettings {
    schemaVersion: number;
    enabled: boolean;
    debug: boolean;
    uiLanguage: 'auto' | 'ru' | 'en';
    mode: Mode;
    /** Connection profile id for tasks run without Maestro ('' = the active connection). */
    profile: string;
    /** Language of the motive card. */
    cardLanguage: 'en' | 'ru';
    /** One block with Maestro's voice cards (speech + motives). */
    mergeVoices: boolean;
    worldTone: 'hostile' | 'indifferent' | 'neutral' | 'welcoming';
    playerGravity: 'low' | 'medium' | 'high';
    inertia: 'high' | 'medium' | 'low';
    fidelity: 'strict' | 'balanced' | 'free';
    diversity: 'even' | 'varied';
    driftResponse: 'correct' | 'stress' | 'redo';
    secrets: 'open' | 'spoiler' | 'known';
    appetiteStrength: 'muted' | 'author' | 'sharp';
    /** How many characters may actively hunt the player in one scene; 0 = as the author wrote. */
    huntersPerScene: 0 | 1 | 2 | 3;
    corruption: 'off' | 'coarse' | 'all';
    /** Portraits get a CK archive with BunnyMo tags through Maestro «Оформить». */
    autoArchives: boolean;
    /** Motive card budget in tokens (≈ chars / 4). */
    cardBudget: number;
    /** In-chat depth of the motive card. */
    depth: number;
    /** Modules switched on/off by the user; missing = module default. */
    modules: Record<string, boolean>;
}

export interface SettingsService {
    get(): DramatisSettings;
    /** Sets a top-level value and saves (debounced). */
    set<K extends keyof DramatisSettings>(key: K, value: DramatisSettings[K]): void;
    module<T extends object>(key: string, defaults: () => T): T;
    isModuleEnabled(key: string, byDefault: boolean): boolean;
    setModuleEnabled(key: string, enabled: boolean): void;
    save(): void;
    reset(): void;
    onChange(listener: (key: string) => void): Unsubscribe;
}

/* ------------------------------------------------------------------ host (SillyTavern) */

export type ListenerOrder = 'first' | 'last' | 'normal';

export interface HostEvents {
    on(event: string, handler: (...args: unknown[]) => unknown, options?: { order?: ListenerOrder }): Unsubscribe;
    emit(event: string, ...args: unknown[]): Promise<void>;
    /** Resolves an eventTypes key to the raw event name (undefined if this ST lacks it). */
    name(key: string): string | undefined;
}

export interface HostModules {
    worldInfo(): Promise<Record<string, unknown>>;
    script(): Promise<Record<string, unknown>>;
    load(path: string): Promise<Record<string, unknown>>;
}

export interface Host {
    ctx(): STContext;
    events: HostEvents;
    modules: HostModules;
    chatId(): string | null;
    isGroupChat(): boolean;
    /** Avatar file name of the current character card (the card key), null outside a solo chat. */
    cardKey(): string | null;
}

/* ------------------------------------------------------------------ storage */

/** Files under ST user files, always prefixed `dramatis-`. */
export interface FileStore {
    read<T>(name: string, options?: { fresh?: boolean }): Promise<T | null>;
    write(name: string, data: unknown): Promise<void>;
    remove(name: string): Promise<void>;
    /** Safe file name for an arbitrary key (hash), keeping the prefix: dramatis-<kind>-<hash>.json. */
    fileName(kind: string, key?: string): string;
}

/** Card-level profiles (docs/model.md §15): one file per card. */
export interface ProfileStore {
    /** Profiles of a card (created empty when missing). */
    load(card: string): Promise<CardProfiles>;
    /** Profiles of the current chat's card, null outside a solo chat. */
    current(): Promise<CardProfiles | null>;
    save(profiles: CardProfiles): Promise<void>;
    onChange(listener: (card: string) => void): Unsubscribe;
}

/** Chat-level state (one file per chat) with drafts committed on send. */
export interface StateStore {
    /** State of the current chat (created from the card profiles on first use); null outside a solo chat. */
    current(): Promise<ChatState | null>;
    save(state: ChatState): Promise<boolean>;
    /**
     * Drafts: results derived from a reply (turn pass), kept per message and swipe until the user sends the next
     * message (then `commitDraft` returns it) or the reply is swiped/edited/deleted (dropped).
     */
    setDraft(messageIndex: number, swipeId: number, draft: unknown): void;
    takeDraft(messageIndex: number, swipeId: number): unknown | undefined;
    dropDrafts(messageIndex?: number): void;
    onChange(listener: () => void): Unsubscribe;
}

/* ------------------------------------------------------------------ LLM */

export interface LlmMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface LlmRequest {
    task: string;
    messages: LlmMessage[];
    maxTokens: number;
    temperature?: number;
    schema?: { name: string; schema: Record<string, unknown> };
    /** Background tasks need Maestro (leader tab, cost cap); interactive ones may run on the own client. */
    background: boolean;
    signal?: AbortSignal;
}

export interface LlmResult<T = unknown> {
    ok: boolean;
    data?: T;
    text?: string;
    refusal?: boolean;
    error?: string;
    costUsd?: number;
}

/** Routes requests through MAESTRO_API when present, otherwise through Dramatis' own Connection Manager client. */
export interface LlmRouter {
    request<T = unknown>(request: LlmRequest): Promise<LlmResult<T>>;
    /** Whether a task can run now (interactive tasks work without Maestro, background tasks need it). */
    available(task: string, background: boolean): boolean;
    viaMaestro(): boolean;
}

/* ------------------------------------------------------------------ prompt injections */

export interface InjectionSpec {
    text: string;
    /** -1 none (scan only), 0 in prompt, 1 in chat at depth, 2 before prompt. */
    position: -1 | 0 | 1 | 2;
    depth?: number;
    /** 0 system, 1 user, 2 assistant. */
    role?: 0 | 1 | 2;
    scan?: boolean;
}

export interface GenerationInfo {
    type: string;
    dryRun: boolean;
    quiet: boolean;
}

/** Set right before a generation, cleared after it. Keys are prefixed `dramatis_`. */
export interface Ephemeral {
    setInjection(key: string, spec: InjectionSpec): void;
    addProducer(name: string, producer: (gen: GenerationInfo) => void | Promise<void>): Unsubscribe;
    /** True while the named injection is set for the generation in progress. */
    isSet(key: string): boolean;
    clearAll(): void;
}

/* ------------------------------------------------------------------ events */

export interface DramatisEvents {
    'chat:changed': { chatId: string | null };
    /** A reply finished (after DES parsed it). */
    'reply:ready': { messageIndex: number };
    /** The user sent a message: the previous reply is now committed. */
    'turn:committed': { messageIndex: number };
    'message:invalidated': { messageIndex: number; reason: 'swiped' | 'deleted' | 'edited' };
    'generation:before': GenerationInfo;
    'generation:ended': { type: string; stopped: boolean };
    'profiles:changed': { card: string };
    'state:changed': { chatId: string | null };
    'maestro:changed': { present: boolean };
}

export interface Bus {
    on<K extends keyof DramatisEvents>(
        event: K,
        handler: (payload: DramatisEvents[K]) => void | Promise<void>,
    ): Unsubscribe;
    emit<K extends keyof DramatisEvents>(event: K, payload: DramatisEvents[K]): Promise<void>;
}

/* ------------------------------------------------------------------ readers of the stack */

/** One character of a DES tracker record (Maestro src/domain/des-tracker.ts, ported). */
export interface DesCharacter {
    name: string;
    present: boolean;
    /** DES relationship label as written by the model («Враг», "Friend"…). */
    relationship?: string;
    thoughts?: string;
    /** Custom detail fields, snake_case keys. */
    details: Record<string, string>;
}

export interface DesReader {
    available(): boolean;
    /** Tracker characters of a message (current swipe); [] when none. */
    castAt(messageIndex: number): DesCharacter[];
    /** Tracker characters of the last assistant message that has a tracker (up to 10 back). */
    lastCast(): DesCharacter[];
    /** Place and time of the scene from the last tracker. */
    scene(): { place?: string; time?: string; date?: string };
    /** DES roster of the chat (known characters). */
    roster(): string[];
}

/** A character archive (CK repository entry with `<BunnymoTags>`). */
export interface ArchiveSheet {
    name: string;
    book: string;
    uid: number;
    tags: { key: string; value: string }[];
    mbti?: { type: string; variant?: 'H' | 'U' };
    linguistics?: string;
}

export interface LoreReader {
    /** Archives whose name matches any of the names (aliases included). */
    archives(names: string[]): Promise<ArchiveSheet[]>;
    /** Entries of the card's own lorebook (character_book or the linked world). */
    cardBook(): Promise<{ uid: number; keys: string[]; comment: string; content: string }[]>;
}

/** Everything the intent reading needs from the current card (docs/model.md §7). */
export interface CardSource {
    avatar: string;
    name: string;
    description: string;
    personality: string;
    scenario: string;
    firstMes: string;
    alternateGreetings: string[];
    mesExample: string;
    creatorNotes: string;
    systemPrompt: string;
    postHistory: string;
    /** Character's Note (depth prompt). */
    depthPrompt: string;
    tags: string[];
    persona: { name: string; description: string };
}

export interface CardReader {
    current(): CardSource | null;
    /** Greeting the chat started with (swipe of message 0), 0 = first_mes. */
    greetingIndex(): number;
}

export interface Readers {
    des: DesReader;
    lore: LoreReader;
    card: CardReader;
}

/* ------------------------------------------------------------------ Maestro bridge */

export interface MaestroBridge {
    /** MAESTRO_API v1 when Maestro is installed and enabled, else null. Re-checked on `maestro-api-ready`. */
    api(): MaestroApiV1 | null;
    present(): boolean;
}

/* ------------------------------------------------------------------ UI */

export interface WindowSpec {
    id: string;
    titleKey: string;
    /** Renders the body; the returned disposer runs when the window closes. */
    render(container: HTMLElement, params: Record<string, unknown>): void | Unsubscribe;
    defaultWidth?: number;
}

export interface SettingsSection {
    id: string;
    titleKey: string;
    order: number;
    render(container: HTMLElement): void | Unsubscribe;
}

export interface Ui {
    notice(text: string, options?: { level?: 'info' | 'warn' | 'error'; action?: { label: string; run: () => void } }): void;
    confirm(title: string, body: string | HTMLElement): Promise<boolean>;
    addWindow(spec: WindowSpec): Unsubscribe;
    openWindow(id: string, params?: Record<string, unknown>): void;
    closeWindow(id: string): void;
    addSettingsSection(section: SettingsSection): Unsubscribe;
    addSlashCommand(name: string, helpKey: string, callback: (value: string) => string | Promise<string>): Unsubscribe;
    /** Adds CSS removed on dispose. */
    style(id: string, css: string): Unsubscribe;
}

/* ------------------------------------------------------------------ modules and app */

export interface ModuleContext<S extends object> {
    app: App;
    settings: S;
    log: Logger;
    own(dispose: Unsubscribe | (() => void | Promise<void>)): void;
}

export interface DramatisModule<S extends object = object> {
    key: string;
    /** Stage of docs/dev-plan.md that introduces it. */
    stage: number;
    titleKey: string;
    enabledByDefault: boolean;
    /** Needs MAESTRO_API (stays idle without it). */
    needsMaestro?: boolean;
    defaults(): S;
    i18n?: I18nParts;
    init(ctx: ModuleContext<S>): void | Promise<void>;
    dispose?(): void | Promise<void>;
}

export interface ModuleManager {
    list(): { module: DramatisModule; enabled: boolean; running: boolean }[];
    enable(key: string): Promise<void>;
    disable(key: string): Promise<void>;
    api<T>(key: string): T | undefined;
    expose(key: string, api: unknown): void;
}

export interface App {
    version: string;
    host: Host;
    log: Logger;
    i18n: I18n;
    settings: SettingsService;
    files: FileStore;
    profiles: ProfileStore;
    state: StateStore;
    llm: LlmRouter;
    ephemeral: Ephemeral;
    bus: Bus;
    readers: Readers;
    maestro: MaestroBridge;
    ui: Ui;
    rng: Rng;
    modules: ModuleManager;
}
