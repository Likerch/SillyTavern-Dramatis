import { describe, expect, it } from 'vitest';
import {
    AFFECTION_CHANCE,
    GAZE_RANK,
    QUADRANTS,
    affectionStarts,
    guardStanceRise,
    hotGaze,
    quadrant,
    sateWant,
    shiftGaze,
} from '../../src/domain/gaze';
import { always, seeded } from './appetites-fixtures';

describe('shiftGaze', () => {
    it('moves one step toward the object per objectifying event', () => {
        expect(shiftGaze('person', { newJustification: true })).toBe('prize');
        expect(shiftGaze('prize', { corruptionCrossed: true, outGroup: true })).toBe('instrument');
        expect(shiftGaze('instrument', { corruptionCrossed: true, outGroup: true, newJustification: true })).toBe(
            'prey',
        );
        expect(shiftGaze('mate', { newJustification: true })).toBe('property');
        expect(shiftGaze('prey', { newJustification: true })).toBe('prey');
    });

    it('applies the corruption shift only to out-group targets', () => {
        expect(shiftGaze('person', { corruptionCrossed: true })).toBe('person');
    });

    it('moves toward the person with warmth, acknowledged agency, anchors and remorse', () => {
        expect(shiftGaze('prey', { agency: 'duel-defeat' })).toBe('property');
        expect(shiftGaze('instrument', { stanceRose: true, anchor: true })).toBe('person');
        expect(shiftGaze('mate', { agency: 'saved-life' })).toBe('person');
        expect(shiftGaze('property', { remorse: true, agency: 'outwitted', stanceRose: true, anchor: true })).toBe(
            'person',
        );
        expect(shiftGaze('person', { stanceRose: true })).toBe('person');
    });

    it('lets opposite events cancel out', () => {
        expect(shiftGaze('prize', { stanceRose: true, newJustification: true })).toBe('prize');
        expect(shiftGaze('prize', {})).toBe('prize');
    });

    it('applies a culture script to out-group targets unless something humanized them', () => {
        expect(shiftGaze('person', { outGroup: true, cultureGaze: 'property' })).toBe('property');
        expect(shiftGaze('person', { cultureGaze: 'property' })).toBe('person');
        expect(shiftGaze('prey', { outGroup: true, cultureGaze: 'property' })).toBe('prey');
        expect(shiftGaze('instrument', { outGroup: true, cultureGaze: 'property', stanceRose: true })).toBe('prize');
    });
});

describe('hotGaze', () => {
    it('makes anyone an instrument (or prey if disliked) at obsessed', () => {
        expect(hotGaze('person', 5, 1)).toBe('instrument');
        expect(hotGaze('mate', 5, -1)).toBe('prey');
        expect(hotGaze('property', 5, 2)).toBe('property');
        expect(hotGaze('person', 4, -3)).toBe('person');
        expect(GAZE_RANK.prey).toBeGreaterThan(GAZE_RANK.person);
    });
});

describe('quadrant', () => {
    it('maps want × stance onto the nine ids', () => {
        expect(QUADRANTS).toHaveLength(9);
        expect(quadrant(0, -2)).toBe('enemy');
        expect(quadrant(1, 0)).toBe('stranger');
        expect(quadrant(1, 3)).toBe('friend');
        expect(quadrant(2, -1)).toBe('exploit');
        expect(quadrant(3, 0)).toBe('deal');
        expect(quadrant(2, 1)).toBe('courtship');
        expect(quadrant(4, -2)).toBe('predator');
        expect(quadrant(5, 0)).toBe('acquirer');
        expect(quadrant(4, 2)).toBe('possessive-love');
    });
});

describe('hard rules', () => {
    it('lowers want on satisfaction, by at least 1', () => {
        expect(sateWant(4, 2)).toBe(2);
        expect(sateWant(4, 0)).toBe(3);
        expect(sateWant(1, 5)).toBe(0);
    });

    it('rolls back a stance rise without a stance event, never a fall', () => {
        expect(guardStanceRise(0, 1, false)).toBe(0);
        expect(guardStanceRise(0, 1, true)).toBe(1);
        expect(guardStanceRise(1, -1, false)).toBe(-1);
    });

    it('lets affection start only through a stance event and only when allowed', () => {
        expect(affectionStarts('common', false, always(0))).toBe(false);
        expect(affectionStarts('never', true, always(0))).toBe(false);
        expect(affectionStarts('rare', true, always(0.1))).toBe(true);
        expect(affectionStarts('rare', true, always(0.2))).toBe(false);
        expect(AFFECTION_CHANCE.common).toBeGreaterThan(AFFECTION_CHANCE.possible);
    });

    it('follows the onset odds (seeded)', () => {
        const rng = seeded(9);
        let rare = 0;
        let common = 0;
        for (let i = 0; i < 1000; i++) {
            if (affectionStarts('rare', true, rng)) rare++;
            if (affectionStarts('common', true, rng)) common++;
        }
        expect(rare / 1000).toBeGreaterThan(0.1);
        expect(rare / 1000).toBeLessThan(0.2);
        expect(common / 1000).toBeGreaterThan(0.8);
    });
});
