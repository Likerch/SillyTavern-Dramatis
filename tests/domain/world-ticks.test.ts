import { describe, expect, it } from 'vitest';
import { MAX_TICKS, TICK_INTERVAL, WARMUP_TURNS, tickInterval, ticksDue } from '../../src/domain/world-ticks';
import type { WorldReading } from '../../src/domain/world-ticks';

const at = (turn: number, mark: WorldReading['mark'] = {}): WorldReading => ({ turn, mark });

describe('tickInterval', () => {
    it('follows the mode: balanced 15, cinema 10, economy 30', () => {
        expect(TICK_INTERVAL).toEqual({ economy: 30, balanced: 15, cinema: 10 });
        expect(tickInterval('balanced')).toBe(15);
        expect(tickInterval('cinema')).toBe(10);
        expect(tickInterval('economy')).toBe(30);
    });

    it('takes a positive override and ignores 0 and garbage', () => {
        expect(tickInterval('balanced', 7)).toBe(7);
        expect(tickInterval('balanced', 6.6)).toBe(7);
        expect(tickInterval('cinema', 0)).toBe(10);
        expect(tickInterval('cinema', Number.NaN)).toBe(10);
        expect(tickInterval('economy', -3)).toBe(30);
    });
});

describe('ticksDue', () => {
    it('never ticks during the first three turns, even on a scene change', () => {
        expect(WARMUP_TURNS).toBe(3);
        for (const turn of [0, 1, 2, 3]) {
            const due = ticksDue(at(0, { place: 'Трактир' }), at(turn, { place: 'Лес' }), { mode: 'cinema' });
            expect(due).toMatchObject({ ticks: 0, reason: 'warmup' });
        }
        expect(ticksDue(at(0, { place: 'Трактир' }), at(4, { place: 'Лес' }), { mode: 'cinema' }).ticks).toBe(1);
    });

    it('ticks every N committed turns by mode', () => {
        expect(ticksDue(at(0), at(14), { mode: 'balanced' })).toEqual({ ticks: 0, reason: 'none' });
        expect(ticksDue(at(0), at(15), { mode: 'balanced' })).toEqual({ ticks: 1, reason: 'interval' });
        expect(ticksDue(at(15), at(25), { mode: 'cinema' }).ticks).toBe(1);
        expect(ticksDue(at(15), at(24), { mode: 'cinema' }).ticks).toBe(0);
        expect(ticksDue(at(10), at(39), { mode: 'economy' }).ticks).toBe(0);
        expect(ticksDue(at(10), at(40), { mode: 'economy' }).ticks).toBe(1);
        expect(ticksDue(at(10), at(15), { mode: 'economy', interval: 5 }).ticks).toBe(1);
    });

    it('ticks once on a change of place', () => {
        const due = ticksDue(at(10, { place: 'Трактир «Рог»' }), at(12, { place: 'Брод' }), { mode: 'balanced' });
        expect(due.ticks).toBe(1);
        expect(due.reason).toBe('scene');
        expect(due.sceneBreak?.reason).toBe('place');
        // A sub-place of the same place is not a new scene.
        expect(
            ticksDue(at(10, { place: 'Трактир' }), at(12, { place: 'Трактир, кухня' }), { mode: 'balanced' }).ticks,
        ).toBe(0);
    });

    it('gives one tick per 8 hours of a time skip, at most three', () => {
        const morning = { place: 'Брод', time: '06:00', date: 'Day 1' };
        expect(ticksDue(at(10, morning), at(11, { ...morning, time: '10:00' }), { mode: 'balanced' })).toMatchObject({
            ticks: 1,
            reason: 'scene',
            hours: 4,
        });
        expect(ticksDue(at(10, morning), at(11, { ...morning, time: '14:00' }), { mode: 'balanced' })).toMatchObject({
            ticks: 1,
            reason: 'time',
            hours: 8,
        });
        expect(ticksDue(at(10, morning), at(11, { ...morning, time: '23:00' }), { mode: 'balanced' })).toMatchObject({
            ticks: 2,
            reason: 'time',
            hours: 17,
        });
        const due = ticksDue(at(10, morning), at(11, { ...morning, date: 'Day 4' }), { mode: 'balanced' });
        expect(due).toMatchObject({ ticks: MAX_TICKS, reason: 'time', hours: 72 });
    });

    it('counts a date that changed but cannot be counted as a day', () => {
        const due = ticksDue(at(10, { date: 'Monday' }), at(11, { date: 'Tuesday' }), { mode: 'balanced' });
        expect(due).toMatchObject({ ticks: 3, reason: 'time', hours: 24 });
    });

    it('does not add the interval to a scene change', () => {
        const due = ticksDue(at(0, { place: 'Трактир' }), at(40, { place: 'Лес' }), { mode: 'balanced' });
        expect(due).toMatchObject({ ticks: 1, reason: 'scene' });
    });

    it('reports elapsed hours without a break and ignores a small time step', () => {
        const due = ticksDue(at(10, { time: '10:00' }), at(11, { time: '11:30' }), { mode: 'balanced' });
        expect(due).toEqual({ ticks: 0, reason: 'none', hours: 1.5 });
        expect(ticksDue(at(0, { time: '10:00' }), at(2, { time: '18:00' }), { mode: 'balanced' })).toEqual({
            ticks: 0,
            reason: 'warmup',
            hours: 8,
        });
    });

    it('respects a custom scene threshold', () => {
        const due = ticksDue(at(10, { time: '10:00' }), at(11, { time: '12:00' }), { mode: 'balanced', sceneHours: 2 });
        expect(due).toMatchObject({ ticks: 1, reason: 'scene', hours: 2 });
    });
});
