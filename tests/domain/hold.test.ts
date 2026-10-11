import { describe, expect, it } from 'vitest';
import { hesitation, initiativeHolds, isOoc, pursuingIds } from '../../src/domain/hold';
import type { PursuitInput } from '../../src/domain/hold';
import { PLAYER_ID } from '../../src/domain/model';

describe('isOoc', () => {
    it('knows the out-of-character marks', () => {
        for (const text of [
            '((давай пропустим))',
            'OOC: skip this',
            '[OOC] stop',
            'ООС: стоп',
            '(ooc) wait',
            '// stop',
        ])
            expect(isOoc(text), text).toBe(true);
    });

    it('does not take a smiley or a word for one', () => {
        for (const text of ['Подожди))', 'Нет((', 'cooc', 'Подожди…', '']) expect(isOoc(text), text).toBe(false);
    });
});

describe('hesitation', () => {
    it('reads a short hesitation or refusal, Russian and English', () => {
        expect(hesitation('Подожди…')).toBe('Подожди…');
        expect(hesitation('нет')).toBe('нет');
        expect(hesitation('*отводит взгляд* Я не уверен…')).toBe('отводит взгляд Я не уверен…');
        expect(hesitation('Ну… может, не здесь?')).toBe('Ну… может, не здесь?');
        expect(hesitation('— Стой, не так быстро.')).toBe('Стой, не так быстро.');
        expect(hesitation('Wait, not now.')).toBe('Wait, not now.');
        expect(hesitation("I'm not sure")).toBe("I'm not sure");
    });

    it('is null for longer messages, decisive acts, OOC and anything else', () => {
        expect(hesitation('Подожди, я не уверен, что это хорошая идея прямо здесь и сейчас')).toBeNull();
        expect(hesitation('Нет. Я ухожу.')).toBeNull();
        expect(hesitation('Нет! *отталкиваю её*')).toBeNull();
        expect(hesitation('No. I walk away.')).toBeNull();
        expect(hesitation('((стоп, давай без этого))')).toBeNull();
        expect(hesitation('OOC: stop')).toBeNull();
        expect(hesitation('Давай.')).toBeNull();
        expect(hesitation('')).toBeNull();
        expect(hesitation(null)).toBeNull();
    });
});

describe('pursuingIds', () => {
    const base = (patch: Partial<PursuitInput> = {}): PursuitInput => ({
        ids: ['mira', 'bram'],
        byId: new Map([
            ['mira', {}],
            ['bram', {}],
        ]),
        events: [],
        pass: new Map(),
        want: () => 0,
        ...patch,
    });

    it('takes the move «initiate» at the player in the beat', () => {
        expect(pursuingIds(base({ moves: { mira: { move: 'initiate', target: PLAYER_ID } } }))).toEqual(['mira']);
        expect(pursuingIds(base({ moves: { mira: { move: 'initiate', target: 'bram' } } }))).toEqual([]);
    });

    it('takes pressing acts on the player, an aim at him that advanced, a want he met', () => {
        expect(pursuingIds(base({ events: [{ actor: 'mira', target: PLAYER_ID, act: 'seduce' }] }))).toEqual(['mira']);
        expect(pursuingIds(base({ events: [{ actor: 'mira', target: PLAYER_ID, act: 'help' }] }))).toEqual([]);
        expect(pursuingIds(base({ pass: new Map([['bram', { playerRole: 'target', advanced: true }]]) }))).toEqual([
            'bram',
        ]);
        expect(
            pursuingIds(
                base({
                    want: (id) => (id === 'mira' ? 3 : 0),
                    pass: new Map([['mira', { refusedByPlayer: true }]]),
                }),
            ),
        ).toEqual(['mira']);
    });

    it('never counts a minor', () => {
        const byId = new Map([
            ['mira', { minor: true }],
            ['bram', {}],
        ]);
        expect(pursuingIds(base({ byId, events: [{ actor: 'mira', target: PLAYER_ID, act: 'flirt' }] }))).toEqual([]);
    });
});

describe('initiativeHolds', () => {
    const byId = new Map([
        ['mira', {}],
        ['bram', {}],
        ['kid', { minor: true }],
    ]);

    it('holds for the pursuers and those making the first move at the player, against a hesitation', () => {
        expect(
            initiativeHolds({
                playerMessage: 'Подожди…',
                present: ['mira', 'bram', 'kid'],
                moves: { bram: { move: 'initiate', target: PLAYER_ID }, kid: { move: 'initiate', target: PLAYER_ID } },
                pursuing: ['mira'],
                byId,
            }),
        ).toEqual({ ids: ['mira', 'bram'], said: 'Подожди…' });
    });

    it('lets an OOC request, a decisive act or a real answer win', () => {
        const input = { present: ['mira'], pursuing: ['mira'], byId };
        expect(initiativeHolds({ ...input, playerMessage: '((стоп))' })).toBeNull();
        expect(initiativeHolds({ ...input, playerMessage: 'Нет. Я ухожу.' })).toBeNull();
        expect(initiativeHolds({ ...input, playerMessage: 'Да, иди ко мне.' })).toBeNull();
        expect(initiativeHolds({ ...input, playerMessage: 'Нет', present: [] })).toBeNull();
    });
});
