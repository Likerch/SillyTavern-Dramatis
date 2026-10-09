import { describe, expect, it } from 'vitest';
import { DRIVES, STYLES, VALUES } from '../../src/domain/model';
import {
    ROLE_PRIORS,
    UNKNOWN_ROLE,
    detectRole,
    loadRolePriors,
    roleIds,
    rolePrior,
    roleScores,
    stanceReason,
    stanceTell,
    toneStances,
} from '../../src/domain/role-priors';

const ADULT_ROLES = [
    'guard',
    'soldier',
    'innkeeper',
    'merchant',
    'servant',
    'noble',
    'priest',
    'thief',
    'mercenary',
    'peasant',
    'scholar',
    'healer',
    'raider',
    'cultist',
];

describe('bundled role priors', () => {
    it('has every role of the brief plus unknown, each with complete tables', () => {
        const ids = roleIds();
        for (const role of ADULT_ROLES) expect(ids).toContain(role);
        expect(ids[ids.length - 1]).toBe(UNKNOWN_ROLE);
        for (const id of ids) {
            const prior = rolePrior(id);
            expect(prior.id).toBe(id);
            for (const value of VALUES) expect(prior.values[value]).toBeGreaterThanOrEqual(1);
            for (const drive of DRIVES) expect(prior.drives[drive]).toBeGreaterThanOrEqual(1);
            expect(prior.tactics.length).toBeGreaterThan(0);
            expect(Object.keys(prior.styles).every((style) => (STYLES as readonly string[]).includes(style))).toBe(
                true,
            );
            expect(prior.proactivity[0]).toBeLessThanOrEqual(prior.proactivity[1]);
            for (const list of [prior.doing, prior.want, prior.tell]) {
                expect(list.en.length).toBeGreaterThan(0);
                expect(list.ru.length).toBe(list.en.length);
            }
            for (const tell of [...prior.tell.en, ...prior.tell.ru]) expect(tell).toMatch(/^(if|если) .+ → .+/);
            if (id !== UNKNOWN_ROLE) expect(prior.words.en.length + prior.words.ru.length).toBeGreaterThan(0);
        }
    });

    it('leans roles the way the role reads', () => {
        expect(rolePrior('guard').values.security).toBeGreaterThan(rolePrior('guard').values.hedonism);
        expect(rolePrior('raider').strangerBias).toBeLessThan(0);
        expect(rolePrior('merchant').strangerBias).toBeGreaterThan(0);
        expect(rolePrior('innkeeper').duty).toBe(true);
        expect(rolePrior('raider').duty).toBe(false);
        expect(rolePrior('scholar').temperament.openness).toEqual([1, 2]);
    });

    it('falls back to unknown for anything else', () => {
        expect(rolePrior('astronaut').id).toBe(UNKNOWN_ROLE);
        expect(rolePrior(undefined).id).toBe(UNKNOWN_ROLE);
        expect(rolePrior(' Guard ').id).toBe('guard');
    });

    it('gives tone distributions summing to one; an indifferent world has a noticeable cold share', () => {
        for (const tone of ['hostile', 'indifferent', 'neutral', 'welcoming'] as const) {
            const shares = Object.values(toneStances(tone));
            expect(shares.reduce((a, b) => a + (b ?? 0), 0)).toBeCloseTo(1, 2);
        }
        const indifferent = toneStances('indifferent');
        const cold = (indifferent[-1] ?? 0) + (indifferent[-2] ?? 0) + (indifferent[-3] ?? 0);
        expect(cold).toBeGreaterThanOrEqual(0.3);
        const hostile = toneStances('hostile');
        expect((hostile[-2] ?? 0) + (hostile[-1] ?? 0)).toBeGreaterThan(0.5);
        const welcoming = toneStances('welcoming');
        expect((welcoming[1] ?? 0) + (welcoming[2] ?? 0)).toBeGreaterThan(0.5);
    });

    it('words a stance toward a stranger in both languages', () => {
        expect(stanceTell(-1, 'en')).toMatch(/stranger/);
        expect(stanceTell(-1, 'ru')).toMatch(/чужак/);
        expect(stanceReason(-2, 'en')).toMatch(/trouble/);
        expect(stanceReason(0, 'ru')).toBe('чужак');
        expect(stanceReason(2, 'en')).toMatch(/newcomer/);
    });
});

describe('detectRole', () => {
    it('finds roles in English and Russian story words, inflected forms included', () => {
        expect(detectRole(['Стражник у ворот'])).toBe('guard');
        expect(detectRole(['Трактирщица Марта'])).toBe('innkeeper');
        expect(detectRole(['the innkeeper'])).toBe('innkeeper');
        expect(detectRole(['Role: guards'])).toBe('guard');
        expect(detectRole(['бандиты с большой дороги'])).toBe('raider');
        expect(detectRole(['старый вор'])).toBe('thief');
        expect(detectRole(['two watchmen at the gate'])).toBe('guard');
        expect(detectRole(['a pair of thieves'])).toBe('thief');
        expect(detectRole(['mercenaries'])).toBe('mercenary');
        expect(detectRole(['жрица храма'])).toBe('priest');
        expect(detectRole(['торговца'])).toBe('merchant');
    });

    it('does not read prefixes of unrelated words', () => {
        expect(detectRole(['воротник'])).toBe(UNKNOWN_ROLE);
        expect(detectRole(['принцип'])).toBe(UNKNOWN_ROLE);
        expect(detectRole(['лекарство'])).toBe(UNKNOWN_ROLE);
        expect(detectRole(['', '   '])).toBe(UNKNOWN_ROLE);
    });

    it('counts ё and е spellings once', () => {
        expect(roleScores(['налётчик']).get('raider')).toBe(1);
    });

    it('weighs sources: a role detail beats a passing word in the thoughts', () => {
        const role = detectRole([
            { text: 'Хозяйка трактира, трактирщица', weight: 3 },
            { text: 'Опять эти солдаты пьют в долг', weight: 0.5 },
        ]);
        expect(role).toBe('innkeeper');
        expect(detectRole([{ text: 'солдат', weight: 0 }])).toBe(UNKNOWN_ROLE);
    });
});

describe('loadRolePriors', () => {
    it('tolerates junk and always has unknown', () => {
        const priors = loadRolePriors({
            roles: {
                Brute: {
                    words: { en: ['brute', 7], ru: ['громил*'] },
                    values: { power: 3, nonsense: 9, security: -4 },
                    temperament: { agreeableness: [2, -5], honesty: 'x' },
                    proactivity: [12, 'a'],
                    styles: { raider: 2, pirate: 3 },
                    moods: { hostile: 1, angry: 2 },
                    strangerBias: -3,
                },
            },
            tones: { hostile: { '-1': 2, '0': 2, '9': 4 } },
        });
        const brute = priors.roles.get('brute')!;
        expect(brute.words).toEqual({ en: ['brute'], ru: ['громил*'] });
        expect(brute.values.power).toBe(4);
        expect(brute.values.security).toBe(1);
        expect(brute.temperament).toEqual({ agreeableness: [-2, 2] });
        expect(brute.proactivity).toEqual([2, 7]);
        expect(brute.styles).toEqual({ raider: 2 });
        expect(brute.moods).toEqual({ hostile: 1 });
        expect(brute.strangerBias).toBe(-1);
        expect(priors.roles.has(UNKNOWN_ROLE)).toBe(true);
        expect(priors.tones.hostile).toEqual({ [-1]: 0.5, 0: 0.5 });
        expect(Object.values(priors.tones.welcoming).reduce((a, b) => a + (b ?? 0), 0)).toBeCloseTo(1, 2);
        expect(detectRole(['громила у двери'], priors)).toBe('brute');
        expect(loadRolePriors(null).roles.size).toBe(1);
        expect(ROLE_PRIORS.roles.size).toBeGreaterThanOrEqual(ADULT_ROLES.length + 1);
    });
});
