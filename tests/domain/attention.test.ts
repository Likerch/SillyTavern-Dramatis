import { describe, expect, it } from 'vitest';
import {
    BAND_THRESHOLDS,
    BUSINESS_FLOOR,
    allocateBands,
    bandOf,
    directionOf,
    playerRelevance,
    relevanceTerms,
    tacticIgnores,
} from '../../src/domain/attention';
import type { RelevanceInput } from '../../src/domain/attention';

function input(fields: Partial<RelevanceInput> = {}): RelevanceInput {
    return {
        roleInIntention: 'none',
        stance: 0,
        openDebts: 0,
        grudges: 0,
        needPull: 0,
        want: 0,
        pressure: 0,
        addressed: false,
        near: false,
        roleDuty: false,
        agendaUrgency: 0,
        proactivity: 5,
        ...fields,
    };
}

describe('playerRelevance', () => {
    it('is zero when nothing ties the character to the player', () => {
        expect(playerRelevance(input())).toBe(0);
    });

    it('reproduces the tips example of §5.6', () => {
        const ilva = playerRelevance(
            input({ roleInIntention: 'means', stance: -2, near: true, agendaUrgency: 0.5, proactivity: 6 }),
        );
        expect(bandOf(ilva)).toBe('business');
        const bram = playerRelevance(
            input({ roleInIntention: 'means', near: true, agendaUrgency: 0.3, proactivity: 5 }),
        );
        expect(bandOf(bram)).toBe('business');
        const sota = playerRelevance(
            input({ roleInIntention: 'means', needPull: 0.8, near: true, agendaUrgency: 0.1, proactivity: 4 }),
        );
        expect(bandOf(sota)).toBe('focus');
        const carters = playerRelevance(input({ near: true, agendaUrgency: 0.4, proactivity: 3 }));
        expect(bandOf(carters)).toBe('background');
    });

    it('combines terms with a noisy-OR that never exceeds 1', () => {
        const all = input({
            roleInIntention: 'threat',
            stance: -3,
            openDebts: 9,
            grudges: 9,
            needPull: 1,
            want: 5,
            pressure: 5,
            near: true,
            addressed: true,
        });
        expect(playerRelevance(all)).toBe(1);
        expect(relevanceTerms(all)).toEqual([1, 0.6, 0.5, 0.5, 1, 0.15, 0.3]);
    });

    it('sharpens desire with pressure', () => {
        const calm = playerRelevance(input({ want: 4, pressure: 0 }));
        const hungry = playerRelevance(input({ want: 4, pressure: 5 }));
        expect(calm).toBeCloseTo(0.4);
        expect(hungry).toBeCloseTo(0.8);
    });

    it('subtracts urgency × proactivity', () => {
        const free = playerRelevance(input({ roleInIntention: 'target' }));
        const busy = playerRelevance(input({ roleInIntention: 'target', agendaUrgency: 1, proactivity: 10 }));
        expect(free).toBe(1);
        expect(busy).toBe(0);
    });

    it('floors addressed and duty-bound characters at business', () => {
        const busy = { agendaUrgency: 1, proactivity: 10 };
        expect(playerRelevance(input({ ...busy, addressed: true }))).toBe(BUSINESS_FLOOR);
        expect(playerRelevance(input({ ...busy, roleDuty: true }))).toBe(BUSINESS_FLOOR);
        for (const g of ['low', 'medium', 'high'] as const) expect(bandOf(BUSINESS_FLOOR, g)).toBe('business');
    });

    it('lets a hostile character who ignores stay in the background', () => {
        const snub = input({ stance: -2, addressed: true, ignores: true, agendaUrgency: 1, proactivity: 10 });
        expect(bandOf(playerRelevance(snub))).toBe('background');
        expect(playerRelevance({ ...snub, stance: -1 })).toBe(BUSINESS_FLOOR);
        expect(playerRelevance({ ...snub, ignores: false })).toBe(BUSINESS_FLOOR);
    });

    it('tolerates garbage numbers', () => {
        const r = playerRelevance(
            input({
                openDebts: Number.NaN,
                grudges: -4,
                needPull: Number.POSITIVE_INFINITY,
                want: Number.NaN,
                pressure: 99,
                agendaUrgency: Number.NaN,
                proactivity: Number.NaN,
            }),
        );
        expect(r).toBe(0);
        expect(playerRelevance(input({ roleInIntention: 'bogus' as never }))).toBe(0);
    });
});

describe('bands', () => {
    it('uses thresholds shifted by gravity', () => {
        expect(bandOf(0.34)).toBe('background');
        expect(bandOf(0.35)).toBe('business');
        expect(bandOf(0.65)).toBe('focus');
        expect(bandOf(0.3, 'medium')).toBe('business');
        expect(bandOf(0.58, 'medium')).toBe('focus');
        expect(bandOf(0.5, 'high')).toBe('focus');
        expect(bandOf(0.24, 'high')).toBe('background');
        expect(bandOf(0.4, 'bogus' as never)).toBe('business');
        expect(BAND_THRESHOLDS.low.focus).toBeGreaterThan(BAND_THRESHOLDS.high.focus);
    });

    it('keeps at most the budget in focus, demoting the lowest', () => {
        const r = allocateBands(
            [
                { id: 'a', score: 0.7 },
                { id: 'b', score: 0.9 },
                { id: 'c', score: 0.8 },
                { id: 'd', score: 0.4 },
                { id: 'e', score: 0.1 },
            ],
            { focusBudget: 2 },
        );
        expect(r.map((x) => [x.id, x.band, x.demoted ?? false])).toEqual([
            ['a', 'business', true],
            ['b', 'focus', false],
            ['c', 'focus', false],
            ['d', 'business', false],
            ['e', 'background', false],
        ]);
    });

    it('keeps the earlier one on equal scores and defaults the budget to 2', () => {
        const r = allocateBands([
            { id: 'a', score: 0.8 },
            { id: 'b', score: 0.8 },
            { id: 'c', score: 0.8 },
        ]);
        expect(r.map((x) => x.band)).toEqual(['focus', 'focus', 'business']);
    });

    it('lets strong reasons exceed the budget', () => {
        const r = allocateBands(
            [
                { id: 'a', score: 0.9 },
                { id: 'b', score: 0.7, strong: true },
                { id: 'c', score: 0.66, strong: true },
            ],
            { focusBudget: 1 },
        );
        expect(r.map((x) => x.band)).toEqual(['business', 'focus', 'focus']);
    });

    it('applies gravity and a zero budget', () => {
        const r = allocateBands([{ id: 'a', score: 0.55 }], { gravity: 'high', focusBudget: 0 });
        expect(r[0]).toEqual({ id: 'a', score: 0.55, band: 'business', demoted: true });
        expect(allocateBands([{ id: 'a', score: 0.55 }], { gravity: 'high' })[0]!.band).toBe('focus');
    });
});

describe('direction and tactics', () => {
    it('takes direction from the stance', () => {
        expect(directionOf(2)).toBe('help');
        expect(directionOf(0)).toBe('neutral');
        expect(directionOf(-1)).toBe('hinder');
    });

    it('recognises ignoring tactics in both languages', () => {
        expect(tacticIgnores(['прямота', 'молчание', 'отказ в мелочах'])).toBe(true);
        expect(tacticIgnores(['Ignores him pointedly'])).toBe(true);
        expect(tacticIgnores(['flattery', 'blackmail'])).toBe(false);
        expect(tacticIgnores([])).toBe(false);
        expect(tacticIgnores([5 as unknown as string])).toBe(false);
    });
});
