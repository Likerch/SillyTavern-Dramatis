import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/core/settings';
import { CHAT_LEVERS, chatLevers, cleanOverrides, isChatLever, validLever, withLever } from '../../src/domain/levers';

describe('chat levers', () => {
    it('lays the chat’s valid overrides over the general settings', () => {
        const general = defaultSettings();
        const merged = chatLevers(general, { mode: 'cinema', cardLanguage: 'ru', depth: 3, mergeVoices: false });
        expect(merged.mode).toBe('cinema');
        expect(merged.cardLanguage).toBe('ru');
        expect(merged.depth).toBe(3);
        expect(merged.mergeVoices).toBe(false);
        expect(merged.inertia).toBe(general.inertia);
        expect(general.mode).toBe('balanced');
    });

    it('drops unknown keys and bad values', () => {
        expect(
            cleanOverrides({
                mode: 'turbo',
                depth: 99,
                cardBudget: 250.5,
                huntersPerScene: 7,
                profile: 'x',
                enabled: false,
                worldTone: 'hostile',
                secrets: 'open',
            }),
        ).toEqual({ secrets: 'open' });
        expect(chatLevers(defaultSettings(), undefined)).toEqual(defaultSettings());
    });

    it('accepts any integer in a numeric lever’s range, not only the presets', () => {
        expect(validLever('cardBudget', 250)).toBe(true);
        expect(validLever('cardBudget', 40)).toBe(false);
        expect(validLever('depth', 20)).toBe(true);
        expect(validLever('depth', -1)).toBe(false);
        expect(validLever('mergeVoices', 'yes')).toBe(false);
    });

    it('sets and removes one lever; a general value can be pinned', () => {
        let overrides = withLever(undefined, 'mode', 'economy');
        expect(overrides).toEqual({ mode: 'economy' });
        overrides = withLever(overrides, 'inertia', 'high');
        expect(overrides).toEqual({ mode: 'economy', inertia: 'high' });
        overrides = withLever(overrides, 'mode', null);
        expect(overrides).toEqual({ inertia: 'high' });
        expect(withLever({ mode: 'turbo' }, 'depth', 2)).toEqual({ depth: 2 });
        expect(withLever({}, 'depth', 77)).toEqual({});
    });

    it('lists only real settings keys', () => {
        const keys = Object.keys(defaultSettings());
        for (const key of CHAT_LEVERS) expect(keys).toContain(key);
        expect(isChatLever('mode')).toBe(true);
        expect(isChatLever('profile')).toBe(false);
    });
});
