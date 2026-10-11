// The motive card and the scene's edges (docs/model.md §6.4–§6.5): the initiative that holds against a hesitation,
// the «Elsewhere» line for absent characters, the trim order that keeps moves and the focus's appetite longest, and
// the decisive move words.
import { describe, expect, it } from 'vitest';
import { PLAYER_ID } from '../../src/domain/model';
import { buildCastCard, estimateTokens } from '../../src/domain/render';
import type { CastCardInput } from '../../src/domain/render';
import { TAVERN_BANDS, TAVERN_PRESENT, profile, raid, tavern } from './cast-fixtures';

function tavernInput(patch: Partial<CastCardInput> = {}): CastCardInput {
    const { profiles, state } = tavern();
    return {
        profiles: [...profiles, profile('liza', 'Лиза', { gender: 'female' })],
        state,
        present: TAVERN_PRESENT,
        bands: TAVERN_BANDS,
        moves: { ilva: { move: 'initiate', target: 'bram', text: 'quietly sends Брам to follow him' } },
        playerName: 'Courier',
        lang: 'en',
        budgetTokens: 0,
        mergeVoices: false,
        ...patch,
    };
}

describe('the initiative holds (§6.5)', () => {
    it('adds the line to the pursuer’s block, right after its main line', () => {
        const lines = buildCastCard(tavernInput({ hold: { ids: ['sota'], said: 'Подожди…' } })).text.split('\n');
        const at = lines.findIndex((line) => line.startsWith('Сота — wiping tables'));
        expect(lines[at + 1]).toBe(
            'Сота — initiative holds: Courier\'s "Подожди…" is a beat of the scene, not its end. Сота keeps pursuing it, as her nature and goal demand — insists, persuades, teases or takes control, and stops only if stopping is truly in her nature. Only a clear, decisive act of Courier or an out-of-character request ends it.',
        );
    });

    it('says it in Russian, and gives a background pursuer a block', () => {
        const text = buildCastCard(tavernInput({ lang: 'ru', hold: { ids: ['fenn'], said: 'нет' } })).text;
        expect(text).toContain(
            'Фенн — держит инициативу: «нет» игрока — часть сцены, а не её конец. Добивается своего, как велят природа и цель, — настаивает, уговаривает, дразнит или берёт верх; отступает, только если это и правда в характере. Закончить это может лишь ясный решительный поступок игрока или просьба вне роли.',
        );
        expect(text).toContain('Фенн — asleep.');
        expect(text).not.toMatch(/Заняты своим: .*Фенн/);
    });

    it('keeps the pursuer’s block to the very last when the budget is tight', () => {
        const card = buildCastCard(tavernInput({ budgetTokens: 10, hold: { ids: ['bram'], said: 'нет' } }));
        expect(card.trimmed).toEqual(['ilva', 'sota']);
        expect(card.text).toContain('Брам — initiative holds');
    });

    it('is not there without a hold, nor for someone not present', () => {
        expect(buildCastCard(tavernInput()).text).not.toContain('initiative holds');
        expect(buildCastCard(tavernInput({ hold: { ids: ['liza'], said: 'нет' } })).text).not.toContain('Лиза');
    });
});

describe('the «Elsewhere» line (§6.4)', () => {
    const notes = [
        { id: 'liza', text: 'selling furs at the market' },
        { id: 'sota', text: 'present, so never here' },
    ];

    it('names absent characters on one line after the card, with the block’s tag', () => {
        const card = buildCastCard(tavernInput({ elsewhere: { notes, tag: 'offscreen' } }));
        const lines = card.text.split('\n');
        expect(lines.at(-1)).toBe(
            '[Elsewhere — not in this scene. Never bring them into it; at most one line about them in the <offscreen> block at the end, if something happens: Лиза (selling furs at the market).]',
        );
        expect(card.elsewhere).toEqual(['liza']);
        expect(card.included).toEqual(TAVERN_PRESENT);
        expect(card.text.match(/Лиза/g)).toHaveLength(1);
    });

    it('says it in Russian, and takes another tag', () => {
        const text = buildCastCard(tavernInput({ lang: 'ru', elsewhere: { notes, tag: 'around' } })).text;
        expect(text.split('\n').at(-1)).toBe(
            '[В других местах — не в этой сцене. Не вводить их в сцену; самое большее одна строка о них в блоке <around> в конце, если что-то происходит: Лиза (selling furs at the market).]',
        );
    });

    it('never pushes anyone present out: it takes only what the budget leaves', () => {
        const plain = buildCastCard(tavernInput());
        const card = buildCastCard(tavernInput({ budgetTokens: plain.tokens, elsewhere: { notes, tag: 'offscreen' } }));
        expect(card.text).toBe(plain.text);
        expect(card.elsewhere).toEqual([]);
        expect(card.trimmed).toEqual([]);
    });

    it('is not there without notes', () => {
        expect(buildCastCard(tavernInput({ elsewhere: { notes: [], tag: 'offscreen' } })).text).not.toContain(
            'Elsewhere',
        );
    });
});

describe('trim order: moves and the focus’s appetite stay longest', () => {
    function raidInput(bands: CastCardInput['bands'], budgetTokens = 0): CastCardInput {
        const { profiles, state } = raid();
        return {
            profiles,
            state,
            present: ['grukk', 'mira'],
            bands,
            moves: { mira: { move: 'watch', target: 'grukk' } },
            playerName: 'Courier',
            lang: 'en',
            budgetTokens,
            mergeVoices: false,
        };
    }

    it('drops the appetite line of one not in focus before dropping anyone’s block', () => {
        const full = buildCastCard(raidInput({ grukk: 'business', mira: 'focus' })).text;
        const appetite = full.split('\n').find((line) => line.startsWith('Грукк — appetite:'))!;
        const rule = full.split('\n').at(-1)!;
        expect(rule).toContain('Desire is not affection');
        const budget = estimateTokens(full) - estimateTokens(appetite) - estimateTokens(rule) + 5;
        const card = buildCastCard(raidInput({ grukk: 'business', mira: 'focus' }, budget));
        expect(card.trimmed).toEqual([]);
        expect(card.text).toContain('Грукк — loitering by the carts');
        expect(card.text).not.toContain('Грукк — appetite:');
        expect(card.text).toContain('This turn: watches Грукк closely and misses nothing.');
    });

    it('keeps the appetite line of the character in focus at the same budget', () => {
        const full = buildCastCard(raidInput({ grukk: 'business', mira: 'focus' })).text;
        const appetite = full.split('\n').find((line) => line.startsWith('Грукк — appetite:'))!;
        const rule = full.split('\n').at(-1)!;
        const budget = estimateTokens(full) - estimateTokens(appetite) - estimateTokens(rule) + 5;
        const card = buildCastCard(raidInput({ grukk: 'focus', mira: 'business' }, budget));
        expect(card.text).toContain('Грукк — appetite:');
    });
});

describe('decisive move words', () => {
    it('says what the character does now, in English and Russian', () => {
        const moves = { bram: { move: 'initiate' as const, target: PLAYER_ID } };
        expect(buildCastCard(tavernInput({ moves })).text).toContain(
            'This turn: acts first toward Courier — starts it now, does not wait to be asked.',
        );
        expect(buildCastCard(tavernInput({ moves, lang: 'ru', playerName: 'Курьер' })).text).toContain(
            'В этот ход: действует первым (Курьер) — начинает сам, не дожидаясь приглашения.',
        );
        expect(
            buildCastCard(tavernInput({ moves: { bram: { move: 'obstruct', target: 'ilva' } }, lang: 'ru' })).text,
        ).toContain('В этот ход: мешает (Ильва) — открыто или хитростью.');
        expect(buildCastCard(tavernInput({ moves: { bram: { move: 'leave' } }, lang: 'ru' })).text).toContain(
            'В этот ход: уходит по своим делам — и после этого в сцене не появляется.',
        );
    });
});
