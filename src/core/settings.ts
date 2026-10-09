// Settings in extension_settings.dramatis: every lever of docs/model.md §14 (flat, easy to inspect) plus `slices`,
// the settings of each module. The object stays the same reference so ST's own save picks up every change.
import type { DramatisSettings, Logger, SettingsService, Unsubscribe } from '../shared/contracts';

export const SETTINGS_KEY = 'dramatis';
export const SETTINGS_SCHEMA_VERSION = 1;

/** Allowed values of every choice lever: stored values outside them fall back to the default. */
export const SETTINGS_CHOICES = {
    uiLanguage: ['auto', 'ru', 'en'],
    mode: ['economy', 'balanced', 'cinema'],
    cardLanguage: ['en', 'ru'],
    textLanguage: ['auto', 'ru', 'en'],
    worldTone: ['hostile', 'indifferent', 'neutral', 'welcoming'],
    playerGravity: ['low', 'medium', 'high'],
    inertia: ['high', 'medium', 'low'],
    fidelity: ['strict', 'balanced', 'free'],
    diversity: ['even', 'varied'],
    driftResponse: ['correct', 'stress', 'redo'],
    secrets: ['open', 'spoiler', 'known'],
    appetiteStrength: ['muted', 'author', 'sharp'],
    huntersPerScene: [0, 1, 2, 3],
    corruption: ['off', 'coarse', 'all'],
} as const satisfies { [K in keyof DramatisSettings]?: readonly DramatisSettings[K][] };

export type ChoiceKey = keyof typeof SETTINGS_CHOICES;

export function defaultSettings(): DramatisSettings {
    return {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        enabled: true,
        debug: false,
        uiLanguage: 'auto',
        mode: 'balanced',
        profile: '',
        cardLanguage: 'en',
        textLanguage: 'auto',
        mergeVoices: true,
        worldTone: 'indifferent',
        playerGravity: 'low',
        inertia: 'high',
        fidelity: 'strict',
        diversity: 'varied',
        driftResponse: 'correct',
        secrets: 'spoiler',
        appetiteStrength: 'author',
        huntersPerScene: 2,
        corruption: 'all',
        autoArchives: true,
        cardBudget: 300,
        depth: 1,
        modules: {},
    };
}

/** What lives under extension_settings.dramatis. */
export interface StoredSettings extends DramatisSettings {
    /** Module settings slices by module key. */
    slices: Record<string, Record<string, unknown>>;
}

/** One migration step: moves raw stored settings from schema N to N + 1 (mutates in place). */
export type SettingsMigration = (raw: Record<string, unknown>) => void;

/**
 * Migration steps by the schema they start from: `SETTINGS_MIGRATIONS[1]` moves 1 → 2, and so on. Add a step and bump
 * SETTINGS_SCHEMA_VERSION together. Schema 0 is "no version stored" (first run): nothing to move.
 */
export const SETTINGS_MIGRATIONS: Record<number, SettingsMigration> = {};

function isDict(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Fills missing keys from defaults without overwriting stored values (recursively for plain objects). */
export function fillDefaults<T extends object>(stored: unknown, defaults: T): T {
    if (!isDict(stored)) return structuredClone(defaults);
    const result = structuredClone(defaults) as Record<string, unknown>;
    for (const [key, value] of Object.entries(stored)) {
        const base = result[key];
        result[key] = isDict(base) && isDict(value) ? fillDefaults(value, base) : value;
    }
    return result as T;
}

/**
 * Runs the migration steps from the stored schema up to `target`, then fills defaults and replaces values of the
 * wrong type or outside their choices. Never throws: a failing step is logged and skipped.
 */
export function migrateSettings(
    raw: unknown,
    log?: Logger,
    migrations: Record<number, SettingsMigration> = SETTINGS_MIGRATIONS,
    target: number = SETTINGS_SCHEMA_VERSION,
): StoredSettings {
    const source: Record<string, unknown> = isDict(raw) ? raw : {};
    let version = typeof source.schemaVersion === 'number' ? source.schemaVersion : 0;
    while (version < target) {
        const step = migrations[version];
        if (step) {
            try {
                step(source);
            } catch (error) {
                log?.error(`settings migration from schema ${version} failed`, error);
            }
        }
        version++;
    }
    const defaults = defaultSettings();
    const filled = fillDefaults(source, { ...defaults, slices: {} }) as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(defaults) as [keyof DramatisSettings, unknown][]) {
        const current = filled[key];
        const choices = (SETTINGS_CHOICES as Record<string, readonly unknown[]>)[key];
        const wrongType = typeof current !== typeof value || (isDict(value) && !isDict(current));
        if (wrongType || (choices && !choices.includes(current))) filled[key] = structuredClone(value);
    }
    if (!isDict(filled.slices)) filled.slices = {};
    const settings = filled as unknown as StoredSettings;
    settings.cardBudget = Math.max(50, Math.round(settings.cardBudget));
    settings.depth = Math.max(0, Math.round(settings.depth));
    settings.schemaVersion = Math.max(target, typeof source.schemaVersion === 'number' ? source.schemaVersion : 0);
    return settings;
}

export class Settings implements SettingsService {
    private readonly listeners = new Set<(key: string) => void>();
    /** Module slices already filled with their defaults since the last load. */
    private readonly filled = new Set<string>();
    private root: StoredSettings;

    constructor(
        private readonly getStore: () => Record<string, unknown>,
        private readonly persist: () => void,
        private readonly log: Logger,
    ) {
        this.root = this.load();
    }

    /** Re-reads extensionSettings (ST may replace the object after a settings reload). */
    reload(): void {
        this.root = this.load();
    }

    get(): DramatisSettings {
        return this.root;
    }

    set<K extends keyof DramatisSettings>(key: K, value: DramatisSettings[K]): void {
        (this.root as DramatisSettings)[key] = value;
        this.save();
        this.notify(key);
    }

    module<T extends object>(key: string, defaults: () => T): T {
        if (!this.filled.has(key)) {
            this.root.slices[key] = fillDefaults(this.root.slices[key], defaults()) as Record<string, unknown>;
            this.filled.add(key);
        }
        return this.root.slices[key] as T;
    }

    isModuleEnabled(key: string, byDefault: boolean): boolean {
        const explicit = this.root.modules[key];
        return typeof explicit === 'boolean' ? explicit : byDefault;
    }

    setModuleEnabled(key: string, enabled: boolean): void {
        this.root.modules[key] = enabled;
        this.save();
        this.notify(`modules.${key}`);
    }

    save(): void {
        try {
            this.persist();
        } catch (error) {
            this.log.error('could not save settings', error);
        }
    }

    /** Lifecycle `clean`: drops everything Dramatis stored in settings. */
    reset(): void {
        const store = this.getStore();
        delete store[SETTINGS_KEY];
        this.root = this.load();
        this.save();
        this.notify('*');
    }

    onChange(listener: (key: string) => void): Unsubscribe {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(key: string): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(key);
            } catch (error) {
                this.log.error('settings listener failed', error);
            }
        }
    }

    private load(): StoredSettings {
        const store = this.getStore();
        const root = migrateSettings(store[SETTINGS_KEY], this.log);
        store[SETTINGS_KEY] = root;
        this.filled.clear();
        return root;
    }
}
