import { describe, expect, it } from 'vitest';
import { clamp, clamp01, clampStance, normalizeText, round3, uniqueId } from '../../src/domain/util';

describe('util', () => {
    it('clamps numbers', () => {
        expect(clamp(5, 0, 3)).toBe(3);
        expect(clamp(-1, 0, 3)).toBe(0);
        expect(clamp(Number.NaN, 1, 3)).toBe(1);
        expect(clamp01(0.4)).toBe(0.4);
        expect(clamp01(7)).toBe(1);
        expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
    });

    it('rounds onto the stance ladder', () => {
        expect(clampStance(1.6)).toBe(2);
        expect(clampStance(-9)).toBe(-3);
        expect(clampStance(Number.NaN)).toBe(0);
    });

    it('rounds float noise', () => {
        expect(round3(0.1 + 0.2)).toBe(0.3);
    });

    it('normalises story words', () => {
        expect(normalizeText('  Трактир «Рог», ЗАЛ!  ')).toBe('трактир рог зал');
        expect(normalizeText('Ёлка — ёж')).toBe('елка еж');
    });

    it('makes unique ids', () => {
        expect(uniqueId('a', [])).toBe('a');
        expect(uniqueId('a', ['a', 'a-2'])).toBe('a-3');
    });
});
