import { describe, expect, it } from 'vitest';
import {
    STRESS_AFTER_BREAK,
    STRESS_BREAK,
    addStress,
    correctionFor,
    driftFindings,
    labelKind,
    labelRange,
    stressBreak,
    stressOf,
} from '../../src/domain/drift';
import type { DriftFinding } from '../../src/domain/drift';
import { PLAYER_ID } from '../../src/domain/model';

describe('DES labels', () => {
    it('reads the five DES labels in both languages, any case', () => {
        const cases: Record<string, string> = {
            Lover: 'lover',
            FRIEND: 'friend',
            Ally: 'ally',
            enemy: 'enemy',
            Neutral: 'neutral',
            Любовник: 'lover',
            Любовница: 'lover',
            Друг: 'friend',
            Союзник: 'ally',
            ВРАГ: 'enemy',
            Нейтральный: 'neutral',
        };
        for (const [label, kind] of Object.entries(cases)) expect(labelKind(label)).toBe(kind);
    });

    it('reads free words', () => {
        expect(labelKind('Подруга')).toBe('friend');
        expect(labelKind('Враждебен')).toBe('enemy');
        expect(labelKind('враждебна к чужакам')).toBe('enemy');
        expect(labelKind('Недруг')).toBe('enemy');
        expect(labelKind('Hostile')).toBe('enemy');
        expect(labelKind('unfriendly')).toBe('rival');
        expect(labelKind('Соперница')).toBe('rival');
        expect(labelKind('Girlfriend')).toBe('lover');
        expect(labelKind('Возлюбленная')).toBe('lover');
        expect(labelKind('love interest')).toBe('lover');
        expect(labelKind('Союзница')).toBe('ally');
        expect(labelKind('Незнакомец')).toBe('neutral');
        expect(labelKind('acquaintance')).toBe('neutral');
        expect(labelKind('Дружелюбна')).toBe('friend');
        expect(labelKind('Нейтральна')).toBe('neutral');
    });

    it('returns nothing for unknown, empty or former ties', () => {
        expect(labelKind('Любопытство')).toBeUndefined();
        expect(labelKind('')).toBeUndefined();
        expect(labelKind(undefined)).toBeUndefined();
        expect(labelKind('Ex-lover')).toBeUndefined();
        expect(labelKind('бывшая подруга')).toBeUndefined();
        expect(labelKind(3 as unknown as string)).toBeUndefined();
    });

    it('gives a stance range', () => {
        expect(labelRange('Враг')).toEqual({ kind: 'enemy', min: -3, max: -1 });
        expect(labelRange('Friend')).toEqual({ kind: 'friend', min: 1, max: 3 });
        expect(labelRange('???')).toBeUndefined();
    });
});

describe('driftFindings', () => {
    it('flags a friendly label on a hostile stance', () => {
        expect(driftFindings({ character: 'ilva', stance: -2, desLabel: 'Друг' })).toEqual([
            {
                kind: 'label-mismatch',
                character: 'ilva',
                target: PLAYER_ID,
                stance: -2,
                label: 'friend',
                gap: 3,
                direction: 'warmer',
            },
        ]);
    });

    it('flags a cold label on a warm stance', () => {
        const [f] = driftFindings({ character: 'sota', target: 'ilva', stance: 3, desLabel: 'Neutral' });
        expect(f).toMatchObject({ kind: 'label-mismatch', target: 'ilva', gap: 2, direction: 'colder' });
    });

    it('accepts labels within range', () => {
        expect(driftFindings({ character: 'a', stance: -1, desLabel: 'Нейтральный' })).toEqual([]);
        expect(driftFindings({ character: 'a', stance: 0, desLabel: 'Ally' })).toEqual([]);
        expect(driftFindings({ character: 'a', stance: 2 })).toEqual([]);
    });

    it('reports every flagged kind', () => {
        const kinds = driftFindings({
            character: 'grukk',
            stance: -1,
            warmthWithoutCause: true,
            appetiteBecameLove: true,
            dependenceVanished: true,
            actedAgainstValues: true,
        }).map((f) => f.kind);
        expect(kinds).toEqual(['warmth', 'appetite-love', 'dependence-vanished', 'against-self']);
    });
});

describe('correctionFor', () => {
    it('groups findings per character and target', () => {
        const findings = [
            ...driftFindings({ character: 'ilva', stance: -2, desLabel: 'Friend', warmthWithoutCause: true }),
            ...driftFindings({ character: 'grukk', target: 'mira', stance: -1, appetiteBecameLove: true }),
            ...driftFindings({ character: 'yan', stance: 0, dependenceVanished: true, actedAgainstValues: true }),
        ];
        expect(correctionFor(findings)).toEqual([
            { character: 'ilva', target: PLAYER_ID, stance: -2, emphasise: ['stance'], drift: 'warmer' },
            {
                character: 'grukk',
                target: 'mira',
                stance: -1,
                emphasise: ['appetite-separation', 'stance'],
                drift: 'warmer',
            },
            { character: 'yan', target: PLAYER_ID, stance: 0, emphasise: ['withdrawal', 'values'] },
        ]);
    });

    it('marks a colder reply and lets warmth win', () => {
        const colder = driftFindings({ character: 'sota', stance: 3, desLabel: 'Enemy' });
        expect(correctionFor(colder)[0]!.drift).toBe('colder');
        const mixed: DriftFinding[] = [
            ...colder,
            { kind: 'warmth', character: 'sota', target: PLAYER_ID, stance: 3 },
            ...colder,
        ];
        expect(correctionFor(mixed)[0]!.drift).toBe('warmer');
        expect(correctionFor([])).toEqual([]);
    });
});

describe('stress', () => {
    const f = (kind: DriftFinding['kind'], gap?: number): DriftFinding => ({
        kind,
        character: 'a',
        target: PLAYER_ID,
        stance: 0,
        ...(gap !== undefined ? { gap } : {}),
    });

    it('weighs findings', () => {
        expect(stressOf([f('label-mismatch', 1)])).toBe(10);
        expect(stressOf([f('label-mismatch', 3)])).toBe(20);
        expect(stressOf([f('label-mismatch')])).toBe(10);
        expect(stressOf([f('warmth'), f('against-self')])).toBe(35);
    });

    it('adds stress within 0–100 without touching the input', () => {
        const state = { id: 'x', stress: 50 };
        const next = addStress(state, [f('against-self')]);
        expect(next).toEqual({ id: 'x', stress: 70 });
        expect(state.stress).toBe(50);
        expect(addStress({ stress: 95 }, [f('against-self')]).stress).toBe(100);
        expect(addStress({ stress: Number.NaN }, [f('warmth')]).stress).toBe(15);
        expect(addStress(state, [])).toBe(state);
    });

    it('breaks at the threshold in the coping style', () => {
        expect(stressBreak(STRESS_BREAK - 1, 'surrender')).toBeNull();
        expect(stressBreak(STRESS_BREAK, 'surrender')).toEqual({ kind: 'withdraw', stress: STRESS_AFTER_BREAK });
        expect(stressBreak(80, 'avoid')).toEqual({ kind: 'leave', stress: 30 });
        expect(stressBreak(100, 'overcompensate')!.kind).toBe('lash-out');
        expect(stressBreak(70)!.kind).toBe('leave');
        expect(stressBreak(Number.NaN, 'avoid')).toBeNull();
    });
});
