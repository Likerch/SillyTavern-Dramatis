import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCardReader, replaceNames } from '../../src/adapters/card';
import { memoryLogger, mockHost } from '../helpers/fakes';
import { character, installStMock, message, openSoloChat } from '../helpers/st-mock';
import type { StMock } from '../helpers/st-mock';

let mock: StMock;

beforeEach(() => {
    mock = installStMock();
});

describe('CardReader', () => {
    it('reads every source field of the card and the persona', () => {
        mock.name1 = 'Ян';
        mock.powerUserSettings.persona_description = '{{user}} — бродячий лекарь.';
        mock.context.tags = [{ id: 't1', name: 'Fantasy' }];
        mock.context.tagMap = { 'marta.png': ['t1'] };
        openSoloChat(
            mock,
            character('Marta', {
                description: '{{char}} держит таверну.',
                personality: 'упрямая',
                scenario: '{{user}} входит в таверну.',
                first_mes: 'Чего тебе, <USER>?',
                mes_example: '<START>{{char}}: Ну?',
                tags: ['fantasy', 'Tavern'],
                data: {
                    creator_notes: 'Марта не лжёт.',
                    system_prompt: 'Пиши от третьего лица.',
                    post_history_instructions: 'Коротко.',
                    alternate_greetings: ['Опять ты, {{user}}?', 'Закрыто.'],
                    tags: ['Drama'],
                    extensions: { depth_prompt: { prompt: '{{char}} устала.' } },
                },
            }),
        );
        const source = createCardReader(mockHost(), memoryLogger()).current();
        expect(source).toEqual({
            avatar: 'marta.png',
            name: 'Marta',
            description: 'Marta держит таверну.',
            personality: 'упрямая',
            scenario: 'Ян входит в таверну.',
            firstMes: 'Чего тебе, Ян?',
            alternateGreetings: ['Опять ты, Ян?', 'Закрыто.'],
            mesExample: '<START>Marta: Ну?',
            creatorNotes: 'Марта не лжёт.',
            systemPrompt: 'Пиши от третьего лица.',
            postHistory: 'Коротко.',
            depthPrompt: 'Marta устала.',
            tags: ['Drama', 'fantasy', 'Tavern'],
            persona: { name: 'Ян', description: 'Ян — бродячий лекарь.' },
        });
    });

    it('falls back to the data block and is null outside a solo chat', () => {
        const reader = createCardReader(mockHost(), memoryLogger());
        expect(reader.current()).toBeNull();
        openSoloChat(mock, character('Bram', { data: { description: 'Кузнец.', first_mes: 'Здорово.' } }));
        expect(reader.current()).toMatchObject({ description: 'Кузнец.', firstMes: 'Здорово.', tags: [] });
        mock.groupId = 'g1';
        expect(reader.current()).toBeNull();
    });

    it('gives the greeting the chat started with', () => {
        const reader = createCardReader(mockHost(), memoryLogger());
        expect(reader.greetingIndex()).toBe(0);
        mock.chat = [message('Привет', { swipe_id: 2 })];
        expect(reader.greetingIndex()).toBe(2);
        mock.chat = [message('Я первый', { is_user: true, swipe_id: 1 })];
        expect(reader.greetingIndex()).toBe(0);
    });

    it('loads a shallow character before reading', async () => {
        openSoloChat(mock, character('Lazy', { shallow: true }));
        const unshallow = vi.fn(async () => {});
        mock.context.unshallowCharacter = unshallow;
        await createCardReader(mockHost(), memoryLogger()).prepare();
        expect(unshallow).toHaveBeenCalledWith(0);
    });

    it('passes the structured intent on as stored, macros and all; absent when the card has none', () => {
        const intent = { version: 1, characters: { Марта: { core: { concept: '{{char}} держит таверну' } } } };
        openSoloChat(mock, character('Marta', { data: { extensions: { dramatis: { intent }, world: 'Марта' } } }));
        const reader = createCardReader(mockHost(), memoryLogger());
        expect(reader.current()!.intent).toEqual(intent);
        openSoloChat(mock, character('Bram', { data: { extensions: { dramatis: { other: 1 } } } }));
        expect(reader.current()).not.toHaveProperty('intent');
        openSoloChat(mock, character('Fenn', { data: { extensions: { dramatis: 'broken' } } }));
        expect(reader.current()).not.toHaveProperty('intent');
        // Not an object, still the card's: the reading validates it (and says it cannot use it).
        openSoloChat(mock, character('Ola', { data: { extensions: { dramatis: { intent: 'v1' } } } }));
        expect(reader.current()!.intent).toBe('v1');
    });

    it('replaces only the name macros', () => {
        expect(replaceNames('{{CHAR}} и {{user}}, {{random::a,b}}', 'A', 'B')).toBe('A и B, {{random::a,b}}');
        expect(replaceNames('', 'A', 'B')).toBe('');
    });
});
