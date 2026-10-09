import { describe, expect, it } from 'vitest';
import {
    COPING_KINDS,
    actGate,
    clampInt,
    defaultDrift,
    effectiveBaseline,
    pressureWord,
    strengthShift,
    tickAppetite,
    toScale3,
    toScale5,
} from '../../src/domain/appetites';
import type { AppetiteEvents, AppetiteTickContext } from '../../src/domain/appetites';
import type { Appetite, AppetiteState } from '../../src/domain/model';
import { appState, appetite } from './appetites-fixtures';

const ctx: AppetiteTickContext = { turn: 10, strength: 'author' };

function tick(a: Appetite, s: AppetiteState, events: AppetiteEvents, c: Partial<AppetiteTickContext> = {}) {
    return tickAppetite(a, s, events, { ...ctx, ...c });
}

describe('helpers', () => {
    it('clamps and rounds', () => {
        expect(clampInt(2.6, 0, 5)).toBe(3);
        expect(clampInt(-4, 0, 5)).toBe(0);
        expect(clampInt(9, 0, 5)).toBe(5);
        expect(clampInt(Number.NaN, 0, 5)).toBe(0);
        expect(toScale5(7)).toBe(5);
        expect(toScale3(-1)).toBe(0);
        expect(toScale3(2.2)).toBe(2);
    });

    it('maps the strength lever onto the baseline, never waking a dormant appetite', () => {
        expect(strengthShift('muted')).toBe(-1);
        expect(strengthShift('author')).toBe(0);
        expect(strengthShift('sharp')).toBe(1);
        expect(effectiveBaseline(3, 'muted')).toBe(2);
        expect(effectiveBaseline(5, 'sharp')).toBe(5);
        expect(effectiveBaseline(1, 'muted')).toBe(0);
        expect(effectiveBaseline(0, 'sharp')).toBe(0);
    });

    it('gives daily drift to bodily kinds and opportunity drift to the rest', () => {
        expect(defaultDrift('hunger')).toBe('daily');
        expect(defaultDrift('food')).toBe('daily');
        expect(defaultDrift('drink')).toBe('daily');
        expect(defaultDrift('substance')).toBe('daily');
        expect(defaultDrift('plunder')).toBe('opportunity');
        expect(defaultDrift('flesh')).toBe('opportunity');
        expect(defaultDrift('other')).toBe('none');
        expect(COPING_KINDS).toContain('drink');
    });
});

describe('tickAppetite: drift and decay', () => {
    it('climbs daily by 1, or by 2 for strong appetites', () => {
        expect(tick(appetite({ baseline: 3 }), appState({ pressure: 1 }), { daysPassed: 1 }).state.pressure).toBe(2);
        expect(tick(appetite({ baseline: 4 }), appState({ pressure: 1 }), { daysPassed: 1 }).state.pressure).toBe(3);
        const r = tick(appetite({ baseline: 3 }), appState({ pressure: 1 }), { hoursPassed: 50 });
        expect(r.state.pressure).toBe(3);
        expect(r.notes).toContain('drift');
    });

    it('does not drift without a whole day, nor when the lever mutes the baseline to 0', () => {
        expect(tick(appetite(), appState({ pressure: 1 }), { hoursPassed: 20 }).state.pressure).toBe(1);
        const muted = tick(
            appetite({ baseline: 1 }),
            appState({ pressure: 1 }),
            { daysPassed: 3 },
            { strength: 'muted' },
        );
        expect(muted.state.pressure).toBe(1);
    });

    it('sharpens drift with the sharp lever', () => {
        const r = tick(appetite({ baseline: 3 }), appState({ pressure: 0 }), { daysPassed: 1 }, { strength: 'sharp' });
        expect(r.state.pressure).toBe(2);
    });

    it('raises a seasonal appetite to its baseline in season and lets it cool off season', () => {
        const a = appetite({ kind: 'flesh', drift: 'seasonal', baseline: 4 });
        const inSeason = tick(a, appState({ pressure: 1 }), { seasonActive: true });
        expect(inSeason.state.pressure).toBe(4);
        expect(inSeason.notes).toContain('season');
        expect(tick(a, appState({ pressure: 1 }), { seasonActive: true, daysPassed: 1 }).state.pressure).toBe(4);
        expect(tick(a, appState({ pressure: 4 }), { seasonActive: true, daysPassed: 1 }).state.pressure).toBe(5);
        expect(tick(a, appState({ pressure: 3 }), { daysPassed: 1 }).state.pressure).toBe(2);
    });

    it('decays opportunity appetites by a day without cues, never below 0', () => {
        const a = appetite({ kind: 'plunder', drift: 'opportunity' });
        const r = tick(a, appState({ pressure: 3 }), { daysPassed: 2 });
        expect(r.state.pressure).toBe(1);
        expect(r.notes).toContain('decay');
        expect(tick(a, appState({ pressure: 1 }), { daysPassed: 5 }).state.pressure).toBe(0);
        expect(tick(a, appState({ pressure: 3 }), {}).state.pressure).toBe(3);
        expect(tick(a, appState({ pressure: 3 }), { daysPassed: 2, cue: true }).state.pressure).toBe(4);
        expect(tick(a, appState({ pressure: 0 }), { daysPassed: 2 }).notes).not.toContain('decay');
    });
});

describe('tickAppetite: cues, elaboration, stress', () => {
    const plunder = appetite({ kind: 'plunder', drift: 'opportunity' });

    it('adds +1 per cue, capped at +2 per scene', () => {
        expect(tick(plunder, appState({ pressure: 1 }), { cue: true }).state.pressure).toBe(2);
        expect(tick(plunder, appState({ pressure: 1 }), { cue: 5 }).state.pressure).toBe(3);
        expect(tick(plunder, appState({ pressure: 1 }), { cue: 0 }).state.pressure).toBe(1);
        expect(tick(plunder, appState({ pressure: 1 }), { cue: false }).notes).toEqual([]);
    });

    it('amplifies a cue with high sensitization, stress, intoxication or another strong appetite', () => {
        expect(tick(plunder, appState({ pressure: 1, sensitization: 2 }), { cue: true }).state.pressure).toBe(3);
        expect(tick(plunder, appState({ pressure: 1 }), { cue: true, intoxicated: true }).state.pressure).toBe(3);
        expect(tick(plunder, appState({ pressure: 1 }), { cue: true, otherAppetiteHigh: true }).state.pressure).toBe(3);
        expect(tick(plunder, appState({ pressure: 1 }), { cue: true, stress: true }).state.pressure).toBe(3);
        expect(tick(plunder, appState({ pressure: 1, sensitization: 1 }), { cue: true }).state.pressure).toBe(2);
    });

    it('adds elaboration only when idle after a cue', () => {
        const r = tick(plunder, appState({ pressure: 1 }), { cue: true, idleAfterCue: true });
        expect(r.state.pressure).toBe(3);
        expect(r.notes).toEqual(['cue', 'elaboration']);
    });

    it('feeds coping kinds with stress, not the others', () => {
        expect(tick(appetite(), appState({ pressure: 1 }), { stress: true }).state.pressure).toBe(2);
        expect(tick(plunder, appState({ pressure: 1 }), { stress: true }).state.pressure).toBe(1);
        expect(tick(appetite(), appState({ pressure: 1 }), { stress: true, cue: true }).state.pressure).toBe(4);
    });

    it('never goes above 5', () => {
        const r = tick(appetite(), appState({ pressure: 4 }), {
            cue: 3,
            stress: true,
            idleAfterCue: true,
            daysPassed: 2,
        });
        expect(r.state.pressure).toBe(5);
    });
});

describe('tickAppetite: satisfaction', () => {
    it('subtracts the dose minus tolerance, at least 1', () => {
        expect(tick(appetite(), appState({ pressure: 4 }), { satisfied: { amount: 3 } }).state.pressure).toBe(1);
        const tolerant = tick(appetite(), appState({ pressure: 4, tolerance: 2 }), { satisfied: { amount: 3 } });
        expect(tolerant.state.pressure).toBe(3);
        const veryTolerant = tick(appetite(), appState({ pressure: 4, tolerance: 3 }), { satisfied: { amount: 1 } });
        expect(veryTolerant.state.pressure).toBe(3);
        expect(tick(appetite(), appState({ pressure: 1 }), { satisfied: { amount: 5 } }).state.pressure).toBe(0);
    });

    it('brings pressure to 0 only with the full act', () => {
        expect(
            tick(appetite(), appState({ pressure: 5 }), { satisfied: { amount: 1, full: true } }).state.pressure,
        ).toBe(0);
    });

    it('keeps a floor of 1 for special hunger unless the full act', () => {
        const hunger = appetite({ kind: 'hunger' });
        expect(tick(hunger, appState({ pressure: 3 }), { satisfied: { amount: 5 } }).state.pressure).toBe(1);
        expect(tick(hunger, appState({ pressure: 3 }), { satisfied: { amount: 5, full: true } }).state.pressure).toBe(
            0,
        );
        expect(tick(hunger, appState({ pressure: 0 }), { satisfied: { amount: 2 } }).state.pressure).toBe(0);
    });

    it('records the turn and resets the days unsated', () => {
        const r = tick(
            appetite(),
            appState({ pressure: 3, daysUnsated: 4 }),
            { satisfied: { amount: 2 } },
            { turn: 42 },
        );
        expect(r.state.lastSated).toBe(42);
        expect(r.state.daysUnsated).toBe(0);
        expect(r.notes).toContain('sated');
    });

    it('counts edge satisfactions: tolerance at the second, sensitization at the third', () => {
        const a = appetite();
        const edge = { satisfied: { amount: 1 } };
        const first = tick(a, appState({ pressure: 4 }), edge);
        expect(first.state.edgeCount).toBe(1);
        expect(first.notes).toContain('edge');
        const second = tick(a, { ...first.state, pressure: 4 }, edge);
        expect(second.state.tolerance).toBe(1);
        expect(second.notes).toContain('tolerance-up');
        const third = tick(a, { ...second.state, pressure: 5 }, edge);
        expect(third.state.sensitization).toBe(1);
        expect(third.state.edgeCount).toBe(0);
        expect(third.notes).toContain('sensitized');
    });

    it('does not count calm satisfactions and caps tolerance and sensitization at 3', () => {
        expect(tick(appetite(), appState({ pressure: 3 }), { satisfied: { amount: 1 } }).state.edgeCount).toBe(0);
        const capped = tick(appetite(), appState({ pressure: 4, edgeCount: 2, sensitization: 3, tolerance: 3 }), {
            satisfied: { amount: 1 },
        });
        expect(capped.state.sensitization).toBe(3);
        expect(capped.state.edgeCount).toBe(0);
        expect(capped.notes).not.toContain('sensitized');
        const tol = tick(appetite(), appState({ pressure: 4, edgeCount: 1, tolerance: 3 }), {
            satisfied: { amount: 1 },
        });
        expect(tol.state.tolerance).toBe(3);
        expect(tol.notes).not.toContain('tolerance-up');
    });

    it('does not mutate the input state', () => {
        const s = appState({ pressure: 4 });
        const copy = structuredClone(s);
        tick(appetite(), s, { satisfied: { amount: 2 }, cue: true, daysPassed: 3 });
        expect(s).toEqual(copy);
    });
});

describe('tickAppetite: abstinence violation effect', () => {
    const vowed = appetite({ vow: 'abstinent' });

    it('recommits at pressure 1 when support is present', () => {
        const r = tick(vowed, appState({ pressure: 4 }), { satisfied: { amount: 1 }, support: true });
        expect(r.state.pressure).toBe(1);
        expect(r.state.lapsed).toBe(false);
        expect(r.notes).toEqual(expect.arrayContaining(['lapse', 'recommit']));
    });

    it('binges one tick after an unsupported lapse', () => {
        const lapse = tick(vowed, appState({ pressure: 3 }), { satisfied: { amount: 2 } });
        expect(lapse.state.lapsed).toBe(true);
        expect(lapse.state.pressure).toBe(1);
        const binge = tick(vowed, lapse.state, {});
        expect(binge.state.pressure).toBe(5);
        expect(binge.state.lapsed).toBe(false);
        expect(binge.notes[0]).toBe('binge');
    });

    it('does not re-trigger while bingeing', () => {
        const binge = tick(vowed, appState({ pressure: 1, lapsed: true }), { satisfied: { amount: 2 } });
        expect(binge.state.lapsed).toBe(false);
        expect(binge.state.pressure).toBe(3);
        expect(binge.notes).not.toContain('lapse');
    });

    it('ignores vows other than abstinent', () => {
        const r = tick(appetite({ vow: 'moderate' }), appState({ pressure: 3 }), { satisfied: { amount: 1 } });
        expect(r.state.lapsed).toBe(false);
        expect(r.notes).not.toContain('lapse');
    });
});

describe('tickAppetite: withdrawal and tolerance fade', () => {
    it('starts withdrawal after days unsated: floor dependence + 2, self-control −1, relief mode', () => {
        const r = tick(appetite({ baseline: 1 }), appState({ pressure: 0, dependence: 2 }), { daysPassed: 2 });
        expect(r.state.withdrawal).toBe(true);
        expect(r.state.pressure).toBe(4);
        expect(r.selfControlDelta).toBe(-1);
        expect(r.mode).toBe('relief');
        expect(r.notes).toContain('withdrawal');
    });

    it('waits longer for light dependence and charges self-control only at onset', () => {
        const light = tick(appetite({ baseline: 0 }), appState({ pressure: 0, dependence: 1 }), { daysPassed: 2 });
        expect(light.state.withdrawal).toBe(false);
        expect(light.state.daysUnsated).toBe(2);
        const later = tick(appetite({ baseline: 0 }), light.state, { daysPassed: 1 });
        expect(later.state.withdrawal).toBe(true);
        expect(later.state.pressure).toBe(3);
        const ongoing = tick(appetite({ baseline: 0 }), later.state, { daysPassed: 1 });
        expect(ongoing.selfControlDelta).toBe(0);
        expect(ongoing.mode).toBe('relief');
    });

    it('starts withdrawal by turns when the story gives no time', () => {
        const s = appState({ pressure: 1, dependence: 3, lastSated: 0 });
        expect(tick(appetite(), s, {}, { turn: 39 }).state.withdrawal).toBe(false);
        expect(tick(appetite(), s, {}, { turn: 40 }).state.withdrawal).toBe(true);
        expect(tick(appetite(), s, {}, { turn: 5, withdrawalTurns: 5 }).state.withdrawal).toBe(true);
    });

    it('ends withdrawal with a satisfaction', () => {
        const r = tick(appetite(), appState({ pressure: 5, dependence: 3, withdrawal: true }), {
            satisfied: { amount: 3 },
        });
        expect(r.state.withdrawal).toBe(false);
        expect(r.state.pressure).toBe(2);
        expect(r.mode).toBe('normal');
        expect(r.notes).toContain('withdrawal-end');
    });

    it('keeps the floor while in withdrawal', () => {
        const r = tick(appetite({ drift: 'none' }), appState({ pressure: 5, dependence: 3, withdrawal: true }), {
            daysPassed: 3,
        });
        expect(r.state.pressure).toBe(5);
    });

    it('fades tolerance by 1 per two weeks unsated', () => {
        const a = appetite({ baseline: 0 });
        const r = tick(a, appState({ tolerance: 3, daysUnsated: 10 }), { daysPassed: 5 });
        expect(r.state.tolerance).toBe(2);
        expect(r.notes).toContain('tolerance-fade');
        expect(tick(a, appState({ tolerance: 3, daysUnsated: 0 }), { daysPassed: 30 }).state.tolerance).toBe(1);
        expect(tick(a, appState({ tolerance: 0 }), { daysPassed: 30 }).notes).not.toContain('tolerance-fade');
    });
});

describe('pressureWord and actGate', () => {
    it('names the ladder', () => {
        expect(pressureWord(0)).toBe('sated');
        expect(pressureWord(3)).toBe('preoccupied');
        expect(pressureWord(5)).toBe('obsessed');
        expect(pressureWord(9)).toBe('obsessed');
        expect(pressureWord(-1)).toBe('sated');
    });

    it('acts at preoccupied, or at present with a good chance (Hofmann)', () => {
        expect(actGate(3, 0)).toBe(true);
        expect(actGate(2, 0.6)).toBe(true);
        expect(actGate(2, 0.59)).toBe(false);
        expect(actGate(2, true)).toBe(true);
        expect(actGate(2, false)).toBe(false);
        expect(actGate(1, 1)).toBe(false);
    });
});
