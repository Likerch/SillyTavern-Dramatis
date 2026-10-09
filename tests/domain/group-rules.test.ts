import { describe, expect, it } from 'vitest';
import {
    DEFAULT_STYLE,
    bandBaseline,
    desirability,
    drawBand,
    drawFromRule,
    effectiveChoosiness,
    huntLimit,
    huntersBudget,
    pickWeighted,
} from '../../src/domain/group-rules';
import type { HuntCandidate } from '../../src/domain/group-rules';
import { PLAYER_ID } from '../../src/domain/model';
import type { AppetiteRule } from '../../src/domain/model';
import { always, seeded, seq } from './appetites-fixtures';

function rule(fields: Partial<AppetiteRule> = {}): AppetiteRule {
    return {
        id: 'valley-mates',
        holders: 'monster girls',
        kind: 'flesh',
        source: 'species',
        target: { mode: 'class', class: 'human men' },
        intensity: { zero: 0.2, low: 0, mid: 0.5, high: 0.3 },
        styles: { raider: 1, siren: 1, duelist: 1 },
        choosiness: 2,
        exclusivity: 'exclusive',
        affectionOnset: 'possible',
        groupMode: 'solitary',
        ...fields,
    };
}

describe('pickWeighted', () => {
    it('picks by weight and ignores empty weights', () => {
        const w = { a: 1, b: 3, c: 0 };
        expect(pickWeighted(w, always(0))).toBe('a');
        expect(pickWeighted(w, always(0.3))).toBe('b');
        expect(pickWeighted(w, always(0.999))).toBe('b');
        expect(pickWeighted(w, always(1))).toBe('b');
        expect(pickWeighted({ a: 0 }, always(0.5))).toBeUndefined();
        expect(pickWeighted({}, always(0.5))).toBeUndefined();
    });

    it('draws bands with real zeros and baselines per band', () => {
        expect(drawBand({ zero: 1, low: 0, mid: 0, high: 0 }, always(0.5))).toBe('zero');
        expect(drawBand({ zero: 0, low: 0, mid: 0, high: 0 }, always(0.5))).toBe('zero');
        expect(bandBaseline('zero', always(0))).toBe(0);
        expect(bandBaseline('low', always(0))).toBe(1);
        expect(bandBaseline('mid', always(0))).toBe(2);
        expect(bandBaseline('mid', always(0.9))).toBe(3);
        expect(bandBaseline('high', always(0))).toBe(4);
        expect(bandBaseline('high', always(0.9))).toBe(5);
    });
});

describe('drawFromRule', () => {
    const candidates = [{ id: PLAYER_ID }, { id: 'merchant' }, { id: 'kira' }, { id: 'page', minor: true }];

    it('spreads a class target over every fitting candidate except self and minors', () => {
        const drawn = drawFromRule(rule(), { id: 'kira', knowsPlayer: false }, seq(0.9, 0.9, 0.1, 0.9), { candidates });
        expect(drawn).not.toBeNull();
        expect(drawn?.band).toBe('high');
        expect(drawn?.targets).toEqual([PLAYER_ID, 'merchant']);
        expect(drawn?.appetite).toMatchObject({
            id: 'valley-mates',
            kind: 'flesh',
            sources: ['species'],
            baseline: 5,
            style: 'raider',
            affectionOnset: 'possible',
            endorsement: 'proud',
            rule: 'valley-mates',
            drift: 'opportunity',
        });
        expect(drawn?.pressure).toBe(5);
    });

    it('targets the player only for those who know him', () => {
        const r = rule({ target: { mode: 'player' } });
        expect(drawFromRule(r, { id: 'sera', knowsPlayer: true }, always(0.5))?.targets).toEqual([PLAYER_ID]);
        expect(drawFromRule(r, { id: 'neira', knowsPlayer: false }, always(0.5))?.targets).toEqual([]);
    });

    it('gives thing appetites no targets and keeps non-sexual kinds for minors', () => {
        const ale = rule({ kind: 'drink', target: { mode: 'thing' }, source: 'culture', styles: {} });
        const drawn = drawFromRule(ale, { id: 'page', knowsPlayer: true, minor: true }, always(0.5), { candidates });
        expect(drawn?.targets).toEqual([]);
        expect(drawn?.appetite.style).toBe(DEFAULT_STYLE);
        expect(drawn?.appetite.drift).toBe('daily');
    });

    it('never gives a minor a sexual appetite', () => {
        expect(drawFromRule(rule(), { id: 'page', knowsPlayer: true, minor: true }, always(0.5))).toBeNull();
    });

    it('keeps real zeros at zero whatever the lever', () => {
        const drawn = drawFromRule(rule(), { id: 'neira', knowsPlayer: true }, always(0), { strength: 'sharp' });
        expect(drawn).toMatchObject({ band: 'zero', pressure: 0 });
        expect(drawn?.appetite.baseline).toBe(0);
    });

    it('applies the strength lever to non-zero draws and copies the label', () => {
        const r = rule({ label: 'жажда пары', source: 'world' });
        const muted = drawFromRule(r, { id: 'a', knowsPlayer: true }, seq(0.5, 0.9, 0.5, 0.1), { strength: 'muted' });
        expect(muted?.appetite.baseline).toBe(2);
        expect(muted?.pressure).toBe(1);
        expect(muted?.appetite.label).toBe('жажда пары');
        expect(muted?.appetite.endorsement).toBe('torn');
    });

    it('follows the rule’s distribution over many individuals (seeded)', () => {
        const rng = seeded(21);
        const counts = { zero: 0, low: 0, mid: 0, high: 0 };
        const styles: Record<string, number> = {};
        for (let i = 0; i < 2000; i++) {
            const drawn = drawFromRule(rule(), { id: `g${i}`, knowsPlayer: true }, rng);
            if (!drawn) continue;
            counts[drawn.band]++;
            styles[drawn.appetite.style] = (styles[drawn.appetite.style] ?? 0) + 1;
        }
        expect(counts.zero / 2000).toBeGreaterThan(0.16);
        expect(counts.zero / 2000).toBeLessThan(0.24);
        expect(counts.low).toBe(0);
        expect(counts.high / 2000).toBeGreaterThan(0.26);
        expect(Object.keys(styles).sort()).toEqual(['duelist', 'raider', 'siren']);
    });
});

describe('desirability', () => {
    const flesh = { kind: 'flesh' as const, choosiness: 3 };

    it('ignores targets below choosiness, which falls when targets are scarce', () => {
        expect(effectiveChoosiness(3, 10)).toBe(3);
        expect(effectiveChoosiness(3, 3)).toBe(2);
        expect(effectiveChoosiness(3, 1)).toBe(1);
        expect(effectiveChoosiness(1, 0)).toBe(0);
        expect(desirability(flesh, { value: 2 }, { pressure: 4, available: 10 })).toBe(0);
        expect(desirability(flesh, { value: 2 }, { pressure: 4, available: 1 })).toBeGreaterThan(0);
    });

    it('multiplies valuation, taste, novelty, scarcity and pressure', () => {
        const base = { pressure: 4, available: 5 };
        expect(desirability(flesh, { value: 3 }, base)).toBe(3);
        expect(desirability(flesh, { value: 3, taste: 2 }, base)).toBe(5);
        expect(desirability(flesh, { value: 3, taste: -1 }, { ...base, available: 2 })).toBe(3);
        expect(desirability(flesh, { value: 3, novelty: true }, base)).toBe(4);
        expect(desirability(flesh, { value: 3 }, { ...base, pressure: 0 })).toBe(2);
        expect(desirability(flesh, { value: 4 }, { ...base, available: 9 })).toBe(4);
        expect(
            desirability({ kind: 'plunder' }, { value: 5, taste: 2, novelty: true }, { pressure: 5, available: 1 }),
        ).toBe(5);
    });

    it('never makes a minor a sexual target', () => {
        expect(desirability(flesh, { value: 5, minor: true }, { pressure: 5, available: 1 })).toBe(0);
        expect(desirability({ kind: 'plunder' }, { value: 3, minor: true }, { pressure: 4, available: 5 })).toBe(3);
    });
});

describe('huntersBudget', () => {
    const crowd: HuntCandidate[] = [
        { id: 'kira', want: 4, pressure: 4 },
        { id: 'sera', want: 4, pressure: 3, alternatives: true },
        { id: 'tessa', want: 3, pressure: 2 },
        { id: 'ula', want: 2, pressure: 2, alternatives: true },
        { id: 'neira', want: 0, pressure: 0 },
    ];

    it('defaults to 2, 3 when the author says «all» of a player rule, else the lever', () => {
        expect(huntLimit({ perScene: 0 })).toBe(2);
        expect(huntLimit({ perScene: 0, authorSaysAll: true })).toBe(2);
        expect(huntLimit({ perScene: 0, ruleTargetsPlayer: true, authorSaysAll: true })).toBe(3);
        expect(huntLimit({ perScene: 1, ruleTargetsPlayer: true, authorSaysAll: true })).toBe(1);
        expect(huntLimit({ perScene: 3 })).toBe(3);
    });

    it('lets at most the limit hunt and sends the rest elsewhere or to wait', () => {
        const r = huntersBudget(crowd, { perScene: 0 }, seeded(4));
        expect(r.limit).toBe(2);
        expect(r.hunters).toHaveLength(2);
        expect(r.deferred).toHaveLength(2);
        expect([...r.hunters, ...r.deferred.map((d) => d.id)].sort()).toEqual(['kira', 'sera', 'tessa', 'ula']);
        for (const d of r.deferred) {
            expect(d.to).toBe(crowd.find((c) => c.id === d.id)?.alternatives ? 'other-target' : 'wait');
        }
    });

    it('takes everyone when there is room and nobody without want', () => {
        const r = huntersBudget(crowd.slice(2), { perScene: 3 }, always(0));
        expect(r.hunters.sort()).toEqual(['tessa', 'ula']);
        expect(r.deferred).toEqual([]);
        expect(huntersBudget([{ id: 'n', want: 1, pressure: 5 }], { perScene: 2 }, always(0)).hunters).toEqual([]);
    });

    it('favours the keenest but varies the roster (seeded)', () => {
        const rng = seeded(8);
        const picks: Record<string, number> = {};
        for (let i = 0; i < 1000; i++) {
            for (const id of huntersBudget(crowd, { perScene: 1 }, rng).hunters) picks[id] = (picks[id] ?? 0) + 1;
        }
        expect(picks.kira ?? 0).toBeGreaterThan(picks.sera ?? 0);
        expect(picks.sera ?? 0).toBeGreaterThan(picks.ula ?? 0);
        expect(picks.ula ?? 0).toBeGreaterThan(0);
        expect(picks.neira).toBeUndefined();
    });
});
