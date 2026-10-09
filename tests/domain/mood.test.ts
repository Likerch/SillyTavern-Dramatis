import { describe, expect, it } from 'vitest';
import {
    CALM_TURNS,
    EMOTION_OCTANTS,
    OCTANT_PAD,
    adjacentOctants,
    applyEmotion,
    emotionActive,
    emotionOctant,
    expireEmotion,
    nextEmotion,
    octantDistance,
    relaxMood,
} from '../../src/domain/mood';
import { MOODS } from '../../src/domain/model';
import type { Emotion, Mood } from '../../src/domain/model';

function emotion(type: string, intensity: number, until = 10): Emotion {
    return { type, intensity, target: '', cause: 'test', until };
}

const baseline: Mood = { octant: 'hostile', label: 'мрачная настороженность' };

describe('emotion table', () => {
    it('maps every listed emotion to a known octant', () => {
        for (const octant of Object.values(EMOTION_OCTANTS)) expect(MOODS).toContain(octant);
        expect(Object.keys(OCTANT_PAD).sort()).toEqual([...MOODS].sort());
    });

    it('covers the common types', () => {
        const expected: Record<string, string> = {
            anger: 'hostile',
            fear: 'anxious',
            hope: 'dependent',
            joy: 'exuberant',
            distress: 'bored',
            shame: 'anxious',
            guilt: 'anxious',
            pride: 'exuberant',
            gratitude: 'dependent',
            contempt: 'disdainful',
            disgust: 'hostile',
            suspicion: 'hostile',
            relief: 'relaxed',
            disappointment: 'anxious',
            envy: 'anxious',
            love: 'exuberant',
            lust: 'exuberant',
            boredom: 'bored',
        };
        for (const [type, octant] of Object.entries(expected)) expect(emotionOctant(type)).toBe(octant);
    });

    it('reads case, adjectives and multi-word types', () => {
        expect(emotionOctant('  Angry ')).toBe('hostile');
        expect(emotionOctant('SUSPICIOUS')).toBe('hostile');
        expect(emotionOctant('fears confirmed')).toBe('bored');
        expect(emotionOctant('Happy-for')).toBe('exuberant');
        expect(emotionOctant('wonder')).toBeUndefined();
        expect(emotionOctant(42 as unknown as string)).toBeUndefined();
    });
});

describe('octant geometry', () => {
    it('measures distance on the PAD cube', () => {
        expect(octantDistance('hostile', 'hostile')).toBe(0);
        expect(octantDistance('hostile', 'anxious')).toBe(1);
        expect(octantDistance('hostile', 'docile')).toBe(3);
        expect(octantDistance('exuberant', 'bored')).toBe(3);
        expect(octantDistance('relaxed', 'dependent')).toBe(2);
        expect(adjacentOctants('hostile', 'disdainful')).toBe(true);
        expect(adjacentOctants('hostile', 'exuberant')).toBe(true);
        expect(adjacentOctants('hostile', 'relaxed')).toBe(false);
    });
});

describe('applyEmotion', () => {
    it('moves to the emotion octant on a strong emotion', () => {
        expect(applyEmotion({ octant: 'relaxed' }, baseline, emotion('fear', 4))).toEqual({ octant: 'anxious' });
        expect(applyEmotion({ octant: 'relaxed' }, baseline, emotion('anger', 3))).toEqual(baseline);
    });

    it('moves a weak emotion only to an adjacent octant', () => {
        const relaxed: Mood = { octant: 'relaxed' };
        expect(applyEmotion(relaxed, baseline, emotion('fear', 2))).toBe(relaxed);
        expect(applyEmotion({ octant: 'hostile' }, baseline, emotion('fear', 1))).toEqual({ octant: 'anxious' });
    });

    it('keeps the mood for the same octant, unknown types and empty intensity', () => {
        const mood: Mood = { octant: 'hostile', label: 'x' };
        expect(applyEmotion(mood, baseline, emotion('anger', 5))).toBe(mood);
        expect(applyEmotion(mood, baseline, emotion('wonder', 5))).toBe(mood);
        expect(applyEmotion(mood, baseline, emotion('fear', 0))).toBe(mood);
        expect(applyEmotion(mood, baseline, emotion('fear', Number.NaN))).toBe(mood);
    });

    it('drops the author label away from the baseline octant', () => {
        expect(applyEmotion(baseline, baseline, emotion('joy', 4))).toEqual({ octant: 'exuberant' });
        expect(applyEmotion({ octant: 'hostile' }, { octant: 'hostile' }, emotion('joy', 4))).toEqual({
            octant: 'exuberant',
        });
    });
});

describe('emotion lifetime', () => {
    it('expires after its turn', () => {
        const e = emotion('anger', 3, 5);
        expect(emotionActive(e, 5)).toBe(true);
        expect(emotionActive(e, 6)).toBe(false);
        expect(emotionActive(undefined, 1)).toBe(false);
        expect(expireEmotion(e, 4)).toBe(e);
        expect(expireEmotion(e, 6)).toBeUndefined();
        expect(expireEmotion(undefined, 1)).toBeUndefined();
    });

    it('lets a newer emotion replace unless the current one is clearly stronger', () => {
        const rage = emotion('anger', 5, 10);
        const mild = emotion('joy', 2, 12);
        const strong = emotion('fear', 4, 12);
        expect(nextEmotion(undefined, mild, 1)).toBe(mild);
        expect(nextEmotion(rage, mild, 3)).toBe(rage);
        expect(nextEmotion(rage, strong, 3)).toBe(strong);
        expect(nextEmotion(rage, mild, 11)).toBe(mild);
    });
});

describe('relaxMood', () => {
    const shaken: Mood = { octant: 'anxious' };

    it('returns to the baseline at scene end', () => {
        const r = relaxMood(shaken, baseline, 0, { sceneEnd: true });
        expect(r).toEqual(baseline);
        expect(r).not.toBe(baseline);
    });

    it('returns after enough calm turns', () => {
        expect(relaxMood(shaken, baseline, CALM_TURNS - 1)).toBe(shaken);
        expect(relaxMood(shaken, baseline, CALM_TURNS)).toEqual(baseline);
        expect(relaxMood(shaken, baseline, 1, { calmTurns: 1 })).toEqual(baseline);
    });

    it('keeps a mood already at the baseline', () => {
        const same: Mood = { ...baseline };
        expect(relaxMood(same, baseline, 9)).toBe(same);
        expect(relaxMood({ octant: 'hostile' }, baseline, 9)).toEqual(baseline);
    });
});
