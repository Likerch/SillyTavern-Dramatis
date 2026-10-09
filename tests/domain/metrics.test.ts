import { describe, expect, it } from 'vitest';
import {
    LINE_WORDS,
    METRICS_WINDOW,
    VOICE_LINES,
    VOICE_SPEAKERS,
    countInitiatives,
    dialogueLines,
    emptyMetrics,
    lineWords,
    metricsReport,
    metricsRows,
    overlap,
    updateMetrics,
} from '../../src/domain/metrics';
import type { MetricsInput } from '../../src/domain/metrics';
import { PLAYER_ID } from '../../src/domain/model';
import type { MetricsState, PassSummary } from '../../src/domain/model';
import { profile } from './cast-fixtures';

const people = [profile('ilva', 'Ильва'), profile('bram', 'Брам'), profile('kira', 'Kira')];

function input(turn: number, reply: string, patch: Partial<MetricsInput> = {}): MetricsInput {
    return { turn, reply, playerName: 'Курьер', people, ...patch };
}

describe('dialogue lines', () => {
    it('finds quoted lines and their speakers by the narration around them', () => {
        const lines = dialogueLines(
            [
                'Ильва вытерла стойку. «Плати и уходи», — бросила она.',
                '«Эй, Брам, налей ещё», — крикнул возчик.',
                '«Сиди тихо», — буркнул Брам, не глядя на Курьера.',
                'Над дверью висела вывеска «Рог».',
            ].join('\n'),
            people,
            'Курьер',
        );
        expect(lines).toEqual([
            { text: 'Плати и уходи', speaker: 'ilva', toPlayer: false },
            { text: 'Эй, Брам, налей ещё', toPlayer: false },
            { text: 'Сиди тихо', speaker: 'bram', toPlayer: false },
        ]);
    });

    it('reads dash dialogue: speech and the author’s words alternate', () => {
        const lines = dialogueLines(
            '— Ты кто такой? — спросил Брам. — Иди отсюда, Курьер.\n— Не твоё дело, — ответила Ильва.',
            people,
            'Курьер',
        );
        expect(lines).toEqual([
            { text: 'Ты кто такой?', speaker: 'bram', toPlayer: true },
            { text: 'Иди отсюда, Курьер.', speaker: 'bram', toPlayer: true },
            { text: 'Не твоё дело,', speaker: 'ilva', toPlayer: true },
        ]);
    });

    it('counts English address and leaves out what the player says', () => {
        const lines = dialogueLines(
            [
                'Kira leaned in. "You owe me, courier."',
                '"I owe nobody," Курьер said.',
                '"Bram, fetch the rope," Kira snapped.',
                '“Not now.” Ilva shrugged.',
            ].join('\n'),
            people,
            'Курьер',
        );
        expect(lines).toEqual([
            { text: 'You owe me, courier.', speaker: 'kira', toPlayer: true },
            { text: 'Bram, fetch the rope,', speaker: 'kira', toPlayer: false },
            { text: 'Not now.', toPlayer: false },
        ]);
        expect(dialogueLines('no dialogue here', people, '')).toEqual([]);
    });

    it('measures overlap on lower-case words', () => {
        expect(lineWords('Ёлки, ЕЛКИ и палки!')).toEqual(['елки', 'елки', 'палки']);
        expect(lineWords('слово '.repeat(LINE_WORDS + 5))).toHaveLength(LINE_WORDS);
        expect(overlap(['a1', 'b2'], ['b2', 'c3'])).toBeCloseTo(1 / 3);
        expect(overlap([], ['x'])).toBe(0);
    });
});

describe('counting turns', () => {
    const summary = (turn: number, patch: Partial<PassSummary> = {}): PassSummary => ({
        turn,
        present: ['ilva', 'bram'],
        characters: {},
        steps: [],
        drift: [],
        ...patch,
    });

    it('counts lines to the player, initiative, drift and steps — once per turn', () => {
        const first = updateMetrics(
            undefined,
            input(1, '«Плати, Курьер», — сказала Ильва.\n«Брам, кости», — сказала Ильва.', {
                moves: {
                    ilva: { move: 'initiate', target: 'bram' },
                    bram: { move: 'obstruct', target: PLAYER_ID },
                    sota: { move: 'own' },
                },
                summary: summary(1, {
                    drift: ['ilva'],
                    steps: [
                        { character: 'ilva', target: PLAYER_ID, from: -2, to: -1 },
                        { character: 'bram', target: 'ilva', from: 0, to: -1 },
                    ],
                }),
            }),
        );
        expect(first).toMatchObject({
            lastTurn: 1,
            turns: 1,
            totals: { lines: 2, toPlayer: 1, initiatives: 2, initiativeTurns: 1, drift: 1, up: 1, down: 1 },
        });
        expect(first.recent).toEqual([{ turn: 1, lines: 2, toPlayer: 1, initiatives: 2, drift: 1, up: 1, down: 1 }]);
        expect(updateMetrics(first, input(1, '«Ещё»'))).toBe(first);
        const stale = updateMetrics(first, input(2, '', { summary: summary(1, { drift: ['x'] }) }));
        expect(stale.totals.drift).toBe(1);
        expect(countInitiatives(undefined)).toBe(0);
    });

    it('keeps a window of recent turns', () => {
        let metrics: MetricsState | undefined;
        for (let turn = 1; turn <= METRICS_WINDOW + 5; turn++) metrics = updateMetrics(metrics, input(turn, ''));
        expect(metrics!.recent).toHaveLength(METRICS_WINDOW);
        expect(metrics!.recent[0]!.turn).toBe(6);
        expect(metrics!.turns).toBe(METRICS_WINDOW + 5);
    });

    it('tells voices apart: own words repeat, others’ do not', () => {
        let metrics: MetricsState | undefined;
        const turns = [
            '«Клянусь бородой, налей ещё браги», — сказал Брам.',
            '«Дети мои, тише, тише», — сказала Ильва.',
            '«Клянусь бородой, браги мне», — сказал Брам.',
            '«Дети мои, хватит шуметь», — сказала Ильва.',
        ];
        turns.forEach((reply, index) => (metrics = updateMetrics(metrics, input(index + 1, reply))));
        const report = metricsReport(metrics);
        expect(report.distinguishability).not.toBeNull();
        expect(report.distinguishability!).toBeGreaterThan(0.8);
        expect(metrics!.voices.map((voice) => voice.id)).toEqual(['bram', 'ilva']);

        let same: MetricsState | undefined;
        ['«Да, господин»', '«Да, господин»', '«Да, господин»', '«Да, господин»'].forEach(
            (line, index) =>
                (same = updateMetrics(same, input(index + 1, `${line}, — сказал${index % 2 ? 'а Ильва' : ' Брам'}.`))),
        );
        expect(metricsReport(same).distinguishability).toBe(0.5);
    });

    it('keeps a few lines of a few speakers', () => {
        let metrics: MetricsState | undefined;
        const many = Array.from({ length: VOICE_SPEAKERS + 2 }, (_, i) =>
            profile(`p${i}`, `Персонаж${'абвгдежзиклмноп'[i]}`),
        );
        many.forEach((person, index) => {
            const reply = Array.from(
                { length: VOICE_LINES + 1 },
                (_, k) => `«Строка номер ${k}», — сказал ${person.name}.`,
            ).join('\n');
            metrics = updateMetrics(metrics, { ...input(index + 1, reply), people: many });
        });
        expect(metrics!.voices).toHaveLength(VOICE_SPEAKERS);
        expect(metrics!.voices.every((voice) => voice.lines.length <= VOICE_LINES)).toBe(true);
    });
});

describe('the report', () => {
    it('is empty without data', () => {
        const report = metricsReport(undefined);
        expect(report).toMatchObject({
            turns: 0,
            share: null,
            initiativesPer10: null,
            driftPer20: null,
            distinguishability: null,
        });
        const rows = metricsRows(report, 'ru');
        expect(rows.map((row) => row.key)).toEqual(['turns', 'share', 'initiative', 'drift', 'stances', 'voices']);
        expect(rows[1]!.value).toBe('пока нет данных');
        expect(rows[5]!.value).toBe('пока мало реплик');
        expect(metricsRows(report, 'en')[5]!.value).toBe('not enough lines yet');
    });

    it('reads shares, rates and voices in story words', () => {
        const metrics: MetricsState = {
            ...emptyMetrics(10),
            turns: 10,
            totals: { lines: 20, toPlayer: 5, initiatives: 12, initiativeTurns: 8, drift: 2, up: 1, down: 3 },
            recent: [
                { turn: 9, lines: 4, toPlayer: 2, initiatives: 1, drift: 1, up: 0, down: 0 },
                { turn: 10, lines: 4, toPlayer: 0, initiatives: 0, drift: 0, up: 0, down: 1 },
            ],
            overlap: { within: 1.2, withinN: 3, across: 0.6, acrossN: 6 },
        };
        const report = metricsReport(metrics);
        expect(report).toMatchObject({
            share: 0.25,
            recentShare: 0.25,
            initiativesPer10: 12,
            recentInitiativeTurns: 1,
            recentDrift: 1,
            driftPer20: 4,
            distinguishability: 0.8,
        });
        const ru = metricsRows(report, 'ru');
        expect(ru[1]!.value).toBe('25% (5 из 20) · за последние 2: 25%');
        expect(ru[2]!.value).toBe('12,0 на 10 ходов (ходов с инициативой — 1 из последних 2)');
        expect(ru[3]!.value).toBe('1 за последние 2 (в среднем 4,0 на 20 ходов)');
        expect(ru[4]!.value).toBe('теплее — 1, холоднее — 3');
        expect(ru[5]!.value).toBe('0,80');
        const en = metricsRows(report, 'en');
        expect(en[1]!.value).toBe('25% (5 of 20) · last 2 turns: 25%');
        expect(en[5]!.value).toBe('0.80');
        expect(
            metricsReport({ ...metrics, overlap: { within: 0, withinN: 1, across: 0, acrossN: 1 } }).distinguishability,
        ).toBe(0.5);
    });
});
