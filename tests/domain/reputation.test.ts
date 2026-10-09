import { describe, expect, it } from 'vitest';
import {
    MAX_REPUTATION_REASONS,
    applyReputation,
    knowsPlayer,
    rumoursReaching,
    spreadRumours,
    strangerStance,
    witnessed,
} from '../../src/domain/reputation';
import type { ReputationDelta } from '../../src/domain/reputation';
import { PLAYER_ID } from '../../src/domain/model';
import type { Reputation, Rumour } from '../../src/domain/model';

const groups: Record<string, string[]> = {
    guard1: ['стража', 'город'],
    guard2: ['стража'],
    thief: ['воры', 'город'],
    hermit: [],
};
const groupsOf = (id: string): string[] => groups[id] ?? [];

function rep(among: string, fields: Partial<Reputation> = {}): Reputation {
    return { among, label: '', stance: 0, weaknesses: [], reasons: [], ...fields };
}

function rumour(id: string, reached: string[], fields: Partial<Rumour> = {}): Rumour {
    return {
        id,
        text: 'у него при себе золото',
        about: PLAYER_ID,
        origin: reached[0] ?? '',
        carriers: [],
        reached,
        turn: 1,
        ...fields,
    };
}

function seq(...values: number[]): () => number {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)]!;
}

describe('witnessed', () => {
    it('gives one delta per group of the witnesses plus the place', () => {
        const r = witnessed(
            { text: ' зарезал стражника ', delta: -2, label: 'убийца', weakness: ' ', place: 'Город' },
            ['guard1', 'guard2', 'thief', 'hermit'],
            groupsOf,
        );
        expect(r).toEqual([
            { among: 'стража', text: 'зарезал стражника', delta: -2, label: 'убийца' },
            { among: 'город', text: 'зарезал стражника', delta: -2, label: 'убийца' },
            { among: 'воры', text: 'зарезал стражника', delta: -2, label: 'убийца' },
        ]);
    });

    it('records weaknesses and clamps deltas', () => {
        const [d] = witnessed({ text: 'напился в стельку', delta: -9, weakness: 'пьёт' }, ['guard2'], groupsOf);
        expect(d).toEqual({ among: 'стража', text: 'напился в стельку', delta: -3, weakness: 'пьёт' });
        expect(witnessed({ text: 'x', delta: Number.NaN }, ['guard2'], groupsOf)[0]!.delta).toBe(0);
    });

    it('needs witnesses and words', () => {
        expect(witnessed({ text: 'x', delta: 1 }, [], groupsOf)).toEqual([]);
        expect(witnessed({ text: '  ', delta: 1 }, ['guard1'], groupsOf)).toEqual([]);
        expect(witnessed({ text: 'x', delta: 1, place: 'лес' }, ['hermit'], groupsOf)).toEqual([
            { among: 'лес', text: 'x', delta: 1 },
        ]);
        expect(witnessed({ text: 'x', delta: 1 }, ['nobody'], () => undefined as unknown as string[])).toEqual([]);
    });
});

describe('applyReputation', () => {
    const d = (among: string, text: string, delta: number, extra: Partial<ReputationDelta> = {}): ReputationDelta => ({
        among,
        text,
        delta,
        ...extra,
    });

    it('creates a group from the general reputation and steps down on one bad deed', () => {
        const start = [rep('*', { label: 'беглый каторжник', stance: -1, weaknesses: ['пьёт'] })];
        const r = applyReputation(start, [d('Стража', 'украл кошелёк', -1, { label: 'вор' })]);
        expect(r.reputation[1]).toEqual({
            among: 'Стража',
            label: 'вор',
            stance: -2,
            weaknesses: ['пьёт'],
            reasons: ['украл кошелёк'],
        });
        expect(r.changes.map((c) => c.kind)).toEqual(['created', 'label', 'step']);
        expect(start).toHaveLength(1);
    });

    it('needs two different good deeds to step up', () => {
        let list = [rep('город')];
        list = applyReputation(list, [d('город', 'потушил пожар', 0.6)]).reputation;
        expect(list[0]!.stance).toBe(0);
        expect(list[0]!.progress).toEqual({ dir: 1, sum: 0.6, events: 1 });
        const again = applyReputation(list, [d('ГОРОД', 'Потушил пожар!', 0.6)]);
        expect(again.reputation[0]!.stance).toBe(0);
        expect(again.reputation[0]!.progress).toEqual({ dir: 1, sum: 1.14, events: 1 });
        expect(again.reputation[0]!.reasons).toEqual(['потушил пожар']);
        const second = applyReputation(again.reputation, [d('город', 'спас ребёнка', 0.5)]);
        expect(second.reputation[0]!.stance).toBe(1);
        expect(second.reputation[0]!.progress).toBeUndefined();
        expect(second.changes.at(-1)).toEqual({ kind: 'step', among: 'город', from: 0, to: 1, text: 'спас ребёнка' });
    });

    it('moves at once on a decisive deed', () => {
        const r = applyReputation([rep('долина')], [d('долина', 'убил дракона', 2)]);
        expect(r.reputation[0]!.stance).toBe(1);
    });

    it('resets progress on the opposite direction', () => {
        let list = applyReputation([rep('город')], [d('город', 'помог', 0.5)]).reputation;
        list = applyReputation(list, [d('город', 'нахамил', -0.5)]).reputation;
        expect(list[0]!.progress).toEqual({ dir: -1, sum: 0.5, events: 1 });
    });

    it('stays at the end of the ladder', () => {
        const r = applyReputation([rep('воры', { stance: -3 })], [d('воры', 'сдал скупщика', -1)]);
        expect(r.reputation[0]!.stance).toBe(-3);
        expect(r.reputation[0]!.progress).toBeUndefined();
    });

    it('records weaknesses once and keeps recent reasons', () => {
        let list = [rep('стража')];
        list = applyReputation(list, [d('стража', 'a', 0, { weakness: 'Падок на лесть' })]).reputation;
        const r = applyReputation(list, [d('стража', 'b', 0, { weakness: 'падок на лесть' })]);
        expect(r.reputation[0]!.weaknesses).toEqual(['Падок на лесть']);
        expect(r.changes).toEqual([]);
        let many = [rep('x')];
        for (let i = 0; i < MAX_REPUTATION_REASONS + 3; i++) {
            many = applyReputation(many, [d('x', `deed ${i}`, 0)]).reputation;
        }
        expect(many[0]!.reasons).toHaveLength(MAX_REPUTATION_REASONS);
        expect(many[0]!.reasons.at(-1)).toBe(`deed ${MAX_REPUTATION_REASONS + 2}`);
    });

    it('starts a new group neutral without a general entry', () => {
        const r = applyReputation([], [d('порт', 'прибыл', 0.2)]);
        expect(r.reputation[0]).toMatchObject({ among: 'порт', label: '', stance: 0 });
        expect(r.changes.map((c) => c.kind)).toEqual(['created', 'pending']);
    });
});

describe('spreadRumours', () => {
    const graph = { таверна: ['рынок'], рынок: ['стража', 'порт'], порт: [] };

    it('reaches neighbours one hop per tick', () => {
        const r = spreadRumours([rumour('r1', ['таверна'])], graph, seq(0, 0.9), 1);
        expect(r.rumours[0]!.reached).toEqual(['таверна', 'рынок']);
        expect(r.spread).toEqual([{ tick: 1, rumour: 'r1', group: 'рынок', distorted: false }]);
        const two = spreadRumours([rumour('r1', ['таверна'])], graph, seq(0, 0.9, 0, 0.9, 0, 0.9), 2);
        expect(two.rumours[0]!.reached).toEqual(['таверна', 'рынок', 'стража', 'порт']);
    });

    it('treats links as two-way', () => {
        const r = spreadRumours([rumour('r1', ['порт'])], graph, seq(0, 0.9), 1);
        expect(r.rumours[0]!.reached).toEqual(['порт', 'рынок']);
    });

    it('fails a roll above the chance', () => {
        const start = [rumour('r1', ['таверна'])];
        const r = spreadRumours(start, graph, seq(0.5), 3);
        expect(r.rumours[0]).toEqual(start[0]);
        expect(r.spread).toEqual([]);
        expect(spreadRumours(start, graph, seq(0.5), 1, { chance: 0.6 }).rumours[0]!.reached).toHaveLength(2);
    });

    it('forks a distorted retelling', () => {
        const r = spreadRumours([rumour('r1', ['таверна'])], graph, seq(0, 0.05), 1);
        expect(r.rumours[0]!.reached).toEqual(['таверна']);
        expect(r.rumours[1]).toEqual({
            id: 'r1~1',
            text: 'у него при себе золото',
            about: PLAYER_ID,
            origin: 'рынок',
            carriers: [],
            reached: ['рынок'],
            false: true,
            turn: 1,
            variantOf: 'r1',
        });
        expect(r.spread).toEqual([{ tick: 1, rumour: 'r1', group: 'рынок', distorted: true, variant: 'r1~1' }]);
    });

    it('spreads a retelling further and never re-reaches groups that heard any version', () => {
        // tick 1: r1 → рынок distorted (r1~1). tick 2: r1 has only таверна (рынок heard) → nothing;
        // r1~1 → стража, порт (no further distortion: already false).
        const r = spreadRumours([rumour('r1', ['таверна'])], graph, seq(0, 0.05, 0, 0), 2);
        expect(r.rumours.map((x) => [x.id, x.reached])).toEqual([
            ['r1', ['таверна']],
            ['r1~1', ['рынок', 'стража', 'порт']],
        ]);
        expect(r.spread.filter((s) => s.tick === 2).map((s) => s.rumour)).toEqual(['r1~1', 'r1~1']);
    });

    it('keeps fork ids unique and does not mutate input', () => {
        const start = [rumour('r1', ['рынок']), rumour('r1~1', ['x'], { variantOf: 'r1', false: true })];
        const r = spreadRumours(start, graph, seq(0, 0.05, 0.9, 0.9), 1);
        expect(r.rumours.map((x) => x.id)).toContain('r1~2');
        expect(start[0]!.reached).toEqual(['рынок']);
    });

    it('does nothing without ticks or links', () => {
        const start = [rumour('r1', ['таверна'])];
        expect(spreadRumours(start, graph, seq(0), 0).spread).toEqual([]);
        expect(spreadRumours(start, graph, seq(0), Number.NaN).spread).toEqual([]);
        expect(spreadRumours(start, {}, seq(0), 3).spread).toEqual([]);
        expect(spreadRumours(start, { a: ['a'] }, seq(0), 3).spread).toEqual([]);
    });

    it('is deterministic with the same rng', () => {
        const a = spreadRumours([rumour('r1', ['таверна'])], graph, seq(0.1, 0.3, 0.2, 0.8, 0.3), 3);
        const b = spreadRumours([rumour('r1', ['таверна'])], graph, seq(0.1, 0.3, 0.2, 0.8, 0.3), 3);
        expect(a).toEqual(b);
    });
});

describe('strangers and knowledge', () => {
    const reputation = [
        rep('*', { label: 'чужак', stance: 0, weaknesses: ['азартен'] }),
        rep('город', { label: 'вор', stance: -1, weaknesses: ['пьёт'] }),
        rep('купцы', { label: 'щедрый', stance: 1, weaknesses: ['Пьёт'] }),
        rep('стража', { label: 'герой', stance: 2 }),
    ];

    it('lets bad news win', () => {
        expect(strangerStance(reputation, ['Город', 'купцы'])).toEqual({
            stance: -1,
            label: 'вор',
            among: 'город',
            weaknesses: ['пьёт', 'азартен'],
        });
    });

    it('takes the best view when nobody thinks ill', () => {
        expect(strangerStance(reputation, ['купцы', 'стража'])).toMatchObject({ stance: 2, label: 'герой' });
    });

    it('falls back to the general reputation, then to nothing', () => {
        expect(strangerStance(reputation, ['порт'])).toMatchObject({ stance: 0, label: 'чужак', among: '*' });
        expect(strangerStance(reputation.slice(1), ['порт'])).toBeUndefined();
        expect(strangerStance([], [])).toBeUndefined();
    });

    it('knows the player by sight or by rumour', () => {
        const rumours = [
            rumour('r1', ['рынок']),
            rumour('r2', ['порт'], { about: 'ilva' }),
            rumour('r3', [], { carriers: ['bram'] }),
        ];
        expect(knowsPlayer({ id: 'kira', groups: [] }, [], ['kira'])).toBe(true);
        expect(knowsPlayer({ id: 'kira', groups: ['Рынок'] }, rumours, [])).toBe(true);
        expect(knowsPlayer({ id: 'nayra', groups: ['порт'] }, rumours, new Set(['kira']))).toBe(false);
        expect(knowsPlayer({ id: 'bram', groups: [] }, rumours, [])).toBe(true);
        expect(rumoursReaching({ id: 'x', groups: ['порт'] }, rumours, 'ilva').map((r) => r.id)).toEqual(['r2']);
    });
});
