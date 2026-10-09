import { describe, expect, it, vi } from 'vitest';
import {
    SETTINGS_CHOICES,
    SETTINGS_KEY,
    SETTINGS_SCHEMA_VERSION,
    Settings,
    defaultSettings,
    fillDefaults,
    migrateSettings,
} from '../../src/core/settings';
import { memoryLogger } from '../helpers/fakes';

function make(stored?: unknown) {
    const store: Record<string, unknown> = stored === undefined ? {} : { [SETTINGS_KEY]: stored };
    const persist = vi.fn();
    const settings = new Settings(() => store, persist, memoryLogger());
    return { store, persist, settings };
}

describe('defaults', () => {
    it('cover every lever with the agreed values', () => {
        expect(defaultSettings()).toEqual({
            schemaVersion: 1,
            enabled: true,
            debug: false,
            uiLanguage: 'auto',
            mode: 'balanced',
            profile: '',
            cardLanguage: 'en',
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
        });
    });

    it('every default is one of its choices', () => {
        const defaults = defaultSettings() as unknown as Record<string, unknown>;
        for (const [key, choices] of Object.entries(SETTINGS_CHOICES)) {
            expect(choices as readonly unknown[]).toContain(defaults[key]);
        }
    });

    it('are written into extension_settings.dramatis on first load', () => {
        const { store, settings } = make();
        expect(store[SETTINGS_KEY]).toBe(settings.get());
        expect(settings.get().schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
        expect((store[SETTINGS_KEY] as { slices: unknown }).slices).toEqual({});
    });
});

describe('migration and repair', () => {
    it('keeps stored values and fills missing ones', () => {
        const { settings } = make({ schemaVersion: 1, mode: 'cinema', modules: { cast: false } });
        expect(settings.get().mode).toBe('cinema');
        expect(settings.get().depth).toBe(1);
        expect(settings.get().modules).toEqual({ cast: false });
    });

    it('replaces values of the wrong type or outside their choices', () => {
        const settings = migrateSettings({
            schemaVersion: 1,
            mode: 'turbo',
            huntersPerScene: 7,
            enabled: 'yes',
            cardBudget: 3,
            modules: [],
        });
        expect(settings.mode).toBe('balanced');
        expect(settings.huntersPerScene).toBe(2);
        expect(settings.enabled).toBe(true);
        expect(settings.cardBudget).toBe(50);
        expect(settings.modules).toEqual({});
    });

    it('runs migration steps from the stored schema', () => {
        const step0 = vi.fn((raw: Record<string, unknown>) => {
            raw.mode = 'economy';
        });
        const step1 = vi.fn((raw: Record<string, unknown>) => {
            raw.depth = 4;
        });
        const migrated = migrateSettings({ schemaVersion: 0 }, memoryLogger(), { 0: step0, 1: step1 }, 2);
        expect(step0).toHaveBeenCalledOnce();
        expect(step1).toHaveBeenCalledOnce();
        expect(migrated.mode).toBe('economy');
        expect(migrated.depth).toBe(4);
        expect(migrated.schemaVersion).toBe(2);

        const skipped = vi.fn();
        migrateSettings({ schemaVersion: 2 }, memoryLogger(), { 1: skipped }, 2);
        expect(skipped).not.toHaveBeenCalled();
    });

    it('logs a failing step and goes on', () => {
        const log = memoryLogger();
        const migrated = migrateSettings(
            { schemaVersion: 0, mode: 'cinema' },
            log,
            {
                0: () => {
                    throw new Error('boom');
                },
            },
            1,
        );
        expect(migrated.mode).toBe('cinema');
        expect(log.lines.some((line) => line.level === 'error')).toBe(true);
    });

    it('fillDefaults merges nested objects', () => {
        expect(fillDefaults({ a: { x: 2 } }, { a: { x: 1, y: 1 }, b: 3 })).toEqual({ a: { x: 2, y: 1 }, b: 3 });
        expect(fillDefaults(null, { a: 1 })).toEqual({ a: 1 });
    });
});

describe('Settings service', () => {
    it('sets, saves and notifies', () => {
        const { settings, persist } = make();
        const seen: string[] = [];
        settings.onChange((key) => seen.push(key));
        settings.set('mode', 'economy');
        expect(settings.get().mode).toBe('economy');
        expect(persist).toHaveBeenCalled();
        expect(seen).toEqual(['mode']);
    });

    it('gives module slices filled with defaults, stored once', () => {
        const { settings, store } = make({ slices: { cast: { limit: 9 } } });
        const slice = settings.module('cast', () => ({ limit: 3, show: true }));
        expect(slice).toEqual({ limit: 9, show: true });
        slice.limit = 5;
        expect(settings.module('cast', () => ({ limit: 3, show: true })).limit).toBe(5);
        expect((store[SETTINGS_KEY] as { slices: Record<string, unknown> }).slices.cast).toBe(slice);
    });

    it('knows module switches with defaults', () => {
        const { settings } = make();
        expect(settings.isModuleEnabled('cast', true)).toBe(true);
        expect(settings.isModuleEnabled('cast', false)).toBe(false);
        const seen: string[] = [];
        settings.onChange((key) => seen.push(key));
        settings.setModuleEnabled('cast', false);
        expect(settings.isModuleEnabled('cast', true)).toBe(false);
        expect(seen).toEqual(['modules.cast']);
    });

    it('resets everything', () => {
        const { settings, store } = make({ mode: 'cinema' });
        const seen: string[] = [];
        settings.onChange((key) => seen.push(key));
        settings.reset();
        expect(settings.get().mode).toBe('balanced');
        expect(store[SETTINGS_KEY]).toBe(settings.get());
        expect(seen).toEqual(['*']);
    });

    it('survives a failing listener and a failing save', () => {
        const log = memoryLogger();
        const settings = new Settings(
            () => ({}),
            () => {
                throw new Error('disk');
            },
            log,
        );
        settings.onChange(() => {
            throw new Error('listener');
        });
        expect(() => settings.set('debug', true)).not.toThrow();
        expect(log.lines.filter((line) => line.level === 'error')).toHaveLength(2);
    });
});
