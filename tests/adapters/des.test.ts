import { beforeEach, describe, expect, it } from 'vitest';
import { createDesReader } from '../../src/adapters/des';
import { desSwipeRecord, parseDesCharacters, parseDesScene, parseTrackerJson } from '../../src/adapters/des/parse';
import { memoryLogger, mockHost } from '../helpers/fakes';
import { installStMock, message } from '../helpers/st-mock';
import type { StMock } from '../helpers/st-mock';

let mock: StMock;

function tracked(thoughts: unknown, infoBox: unknown = null, swipe = 0, extraSwipes: unknown[] = []): STChatMessage {
    const record = { quests: null, infoBox, characterThoughts: thoughts };
    const swipes = [...extraSwipes];
    swipes[swipe] = record;
    return message('ответ', { swipe_id: swipe, extra: { dooms_tracker_swipes: swipes } });
}

beforeEach(() => {
    mock = installStMock();
});

describe('DES parsing', () => {
    it('reads the array form with nested relationship, thoughts and details', () => {
        const characters = parseDesCharacters(
            JSON.stringify([
                {
                    name: ' Марта ',
                    relationship: { status: '[Враг]' },
                    thoughts: { content: 'Опять он.' },
                    details: { appearance: 'рыжая', внешность: { value: 'высокая' }, empty: '' },
                },
                { name: 'Брам', present: false, Relationship: 'Friend' },
                { name: 'Гость', thoughts: 'Is not currently in the scene, waiting outside.' },
                { noName: true },
            ]),
        );
        expect(characters).toEqual([
            {
                name: 'Марта',
                relationship: 'Враг',
                thoughts: 'Опять он.',
                details: { appearance: 'рыжая', внешность: 'высокая' },
                offScene: false,
            },
            { name: 'Брам', relationship: 'Friend', details: {}, offScene: true },
            {
                name: 'Гость',
                thoughts: 'Is not currently in the scene, waiting outside.',
                details: {},
                offScene: true,
            },
        ]);
    });

    it('reads the legacy {characters} form inside a fence and tells missing from empty', () => {
        expect(parseDesCharacters('```json\n{"characters":[{"name":"A","relationship":"Ally"}]}\n```')).toEqual([
            { name: 'A', relationship: 'Ally', details: {}, offScene: false },
        ]);
        expect(parseDesCharacters('[]')).toEqual([]);
        expect(parseDesCharacters(null)).toBeNull();
        expect(parseDesCharacters('not json')).toBeNull();
        expect(parseDesCharacters('{"other":1}')).toBeNull();
        expect(parseTrackerJson({ already: 'parsed' })).toEqual({ already: 'parsed' });
    });

    it('reads place, date and time in flat and nested forms', () => {
        expect(parseDesScene('{"location":"Таверна","date":"3 мая","time":{"start":"18:00","end":"18:30"}}')).toEqual({
            location: 'Таверна',
            date: '3 мая',
            time: { start: '18:00', end: '18:30' },
        });
        expect(parseDesScene({ location: { value: 'Лес' }, time: 'ночь' })).toEqual({
            location: 'Лес',
            time: { start: 'ночь' },
        });
        expect(parseDesScene('[1,2]')).toBeNull();
    });

    it('takes the record of the current swipe, falling back to swipe_info', () => {
        const direct = tracked('[]', null, 1, [{ quests: null, infoBox: null, characterThoughts: '[{"name":"Old"}]' }]);
        expect(desSwipeRecord(direct)?.characterThoughts).toBe('[]');

        const fallback = message('x', {
            swipe_id: 1,
            extra: {},
            swipe_info: [{}, { extra: { dooms_tracker_swipes: { 1: { characterThoughts: '[{"name":"B"}]' } } } }],
        });
        expect(desSwipeRecord(fallback)?.characterThoughts).toBe('[{"name":"B"}]');

        expect(desSwipeRecord(message('u', { is_user: true }))).toBeNull();
        expect(desSwipeRecord(tracked(null))).toBeNull();
    });
});

describe('DesReader', () => {
    it('gives the cast of a message as contract characters', () => {
        mock.chat = [tracked(JSON.stringify([{ name: 'Марта', relationship: 'Враг', present: true }]))];
        const reader = createDesReader(mockHost(), memoryLogger());
        expect(reader.castAt(0)).toEqual([{ name: 'Марта', present: true, relationship: 'Враг', details: {} }]);
        expect(reader.castAt(5)).toEqual([]);
    });

    it('finds the last tracker among the last assistant messages', () => {
        const old = tracked(JSON.stringify([{ name: 'Старый' }]), JSON.stringify({ location: 'Рынок' }));
        mock.chat = [old, message('я', { is_user: true }), message('без трекера')];
        const reader = createDesReader(mockHost(), memoryLogger());
        expect(reader.lastCast().map((c) => c.name)).toEqual(['Старый']);
        expect(reader.scene()).toEqual({ place: 'Рынок' });

        // More than ten assistant replies without a tracker: nothing is found.
        mock.chat = [old, ...Array.from({ length: 10 }, () => message('пусто'))];
        expect(reader.lastCast()).toEqual([]);
        expect(reader.scene()).toEqual({});
    });

    it('reports the scene time where the reply ended', () => {
        mock.chat = [
            tracked(
                '[]',
                JSON.stringify({ location: 'Таверна', date: '3 мая', time: { start: '18:00', end: '19:00' } }),
            ),
        ];
        expect(createDesReader(mockHost(), memoryLogger()).scene()).toEqual({
            place: 'Таверна',
            time: '19:00',
            date: '3 мая',
        });
    });

    it('reads the roster and knows whether DES is around', () => {
        const reader = createDesReader(mockHost(), memoryLogger());
        expect(reader.roster()).toEqual([]);
        expect(reader.available()).toBe(false);
        mock.chatMetadata.dooms_tracker = { knownCharacters: { Марта: {}, Брам: {} } };
        expect(reader.roster()).toEqual(['Марта', 'Брам']);
        expect(reader.available()).toBe(true);
        mock.extensionSettings.disabledExtensions = ['third-party/Dooms-Enhancement-Suite'];
        expect(reader.available()).toBe(false);
    });

    it('reads DES’s own aliases from its settings (its folder or the old tracker key), cleaned', () => {
        const reader = createDesReader(mockHost(), memoryLogger());
        expect(reader.aliases()).toEqual({});
        mock.extensionSettings['third-party/Dooms-Enhancement-Suite'] = {
            characterAliases: {
                ' Ilva Holm ': [' Ильва ', 'хозяйка', '', 7, 'Ильва'],
                Bram: 'not a list',
                '': ['nobody'],
            },
        };
        mock.extensionSettings['third-party/dooms-character-tracker'] = {
            characterAliases: { 'Ilva Holm': ['Хольм'], Sota: ['Сотка'] },
        };
        mock.extensionSettings['third-party/other-extension'] = { characterAliases: { Fenn: ['Фенн'] } };
        expect(reader.aliases()).toEqual({ 'Ilva Holm': ['Ильва', 'хозяйка', 'Хольм'], Sota: ['Сотка'] });
        mock.extensionSettings.disabledExtensions = ['third-party/Dooms-Enhancement-Suite'];
        expect(reader.aliases()).toEqual({});
    });
});
