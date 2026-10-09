import { beforeEach, describe, expect, it } from 'vitest';
import { createLoreReader } from '../../src/adapters/lore';
import { isBunnyMoCoreEntry, isCharacterArchive, normalizeName, parseArchive } from '../../src/adapters/lore/archive';
import { memoryLogger, mockHost } from '../helpers/fakes';
import { EVENT_TYPES, character, installStMock, openSoloChat } from '../helpers/st-mock';
import type { StMock } from '../helpers/st-mock';

let mock: StMock;

const MARTA = `<BunnymoTags><Name:Марта Светлова>, <PHYSICAL><SPECIES:HUMAN>, <GENDER:FEMALE></PHYSICAL>,
<PERSONALITY><Dere:Tsundere>, <ENTJ-U>, <TRAIT:STUBBORN></PERSONALITY>
<Linguistics>Character uses <LING:COMMANDING> speech.</Linguistics></BunnymoTags>
<Genre>Fantasy</Genre>`;

beforeEach(() => {
    mock = installStMock();
});

describe('archive parsing', () => {
    it('reads the name, tags, MBTI and the Linguistics prose', () => {
        const sheet = parseArchive({ uid: 4, key: ['Марта'], content: MARTA }, 'Repo');
        expect(sheet).toEqual({
            name: 'Марта Светлова',
            book: 'Repo',
            uid: 4,
            tags: [
                { key: 'SPECIES', value: 'HUMAN' },
                { key: 'GENDER', value: 'FEMALE' },
                { key: 'DERE', value: 'Tsundere' },
                { key: 'TRAIT', value: 'STUBBORN' },
            ],
            mbti: { type: 'ENTJ', variant: 'U' },
            linguistics: 'Character uses <LING:COMMANDING> speech.',
        });
    });

    it('takes MBTI from a tag and the name from the comment when the block has none', () => {
        const sheet = parseArchive({ uid: 1, comment: 'Брам', content: '<BunnymoTags><MBTI:istp></BunnymoTags>' }, 'B');
        expect(sheet?.name).toBe('Брам');
        expect(sheet?.mbti).toEqual({ type: 'ISTP' });
        expect(sheet?.tags).toEqual([]);
    });

    it('skips templates, placeholders and core entries', () => {
        expect(isCharacterArchive({ content: '<BunnymoTags><Name:NAME>, <GENRE:BLANK></BunnymoTags>' })).toBe(false);
        expect(isCharacterArchive({ content: '<BunnymoTags><GENRE:BLANK></BunnymoTags>' })).toBe(false);
        expect(isCharacterArchive({ content: 'plain text' })).toBe(false);
        const core = { key: ['!fullsheet'], content: '<BunnymoTags><Name:Example></BunnymoTags>' };
        expect(isBunnyMoCoreEntry(core)).toBe(true);
        expect(isCharacterArchive(core)).toBe(false);
        expect(parseArchive(core, 'x')).toBeNull();
        expect(isCharacterArchive({ content: '<BunnymoTags><INFP-H></BunnymoTags>' })).toBe(true);
    });

    it('compares names case-insensitively with ё = е', () => {
        expect(normalizeName('  Пётр  Иванов ')).toBe('петр иванов');
    });
});

describe('LoreReader', () => {
    beforeEach(() => {
        mock.extensionSettings.CarrotKernel = { characterRepoBooks: ['Repo', 'Missing'] };
        mock.books.set('Repo', {
            entries: {
                1: { uid: 1, key: ['Марта', '/regex/i'], content: MARTA },
                2: { uid: 2, key: ['Брам'], content: '<BunnymoTags><Name:Брам>, <TRAIT:LOYAL></BunnymoTags>' },
                3: { uid: 3, key: ['Off'], disable: true, content: '<BunnymoTags><Name:Off></BunnymoTags>' },
                4: { uid: 4, key: ['note'], content: 'just lore' },
            },
        });
    });

    it('finds archives in CK repository books by name or key', async () => {
        const reader = createLoreReader(mockHost(), memoryLogger());
        expect(reader.repoBooks()).toEqual(['Repo', 'Missing']);
        expect((await reader.archives(['марта'])).map((sheet) => sheet.name)).toEqual(['Марта Светлова']);
        expect((await reader.archives(['Марта Светлова', 'брам'])).map((sheet) => sheet.uid)).toEqual([1, 2]);
        expect(await reader.archives(['Off'])).toEqual([]);
        expect(await reader.archives(['/regex/i'])).toEqual([]);
        expect(await reader.archives([])).toEqual([]);
    });

    it('caches books until ST reports them saved', async () => {
        const host = mockHost();
        const reader = createLoreReader(host, memoryLogger());
        reader.install();
        expect(await reader.archives(['Брам'])).toHaveLength(1);
        mock.books.get('Repo')!.entries[2]!.content = '<BunnymoTags><Name:Брам Новый></BunnymoTags>';
        expect((await reader.archives(['Брам']))[0]?.name).toBe('Брам');
        await mock.eventSource.emit(EVENT_TYPES.WORLDINFO_UPDATED!, 'Repo');
        expect((await reader.archives(['Брам']))[0]?.name).toBe('Брам Новый');
        reader.dispose();
    });

    it('gives nothing without CK repositories', async () => {
        delete mock.extensionSettings.CarrotKernel;
        const reader = createLoreReader(mockHost(), memoryLogger());
        expect(await reader.archives(['Марта'])).toEqual([]);
    });

    it('reads the card book from the linked world', async () => {
        mock.books.set('Tavern Lore', {
            entries: {
                7: { uid: 7, key: ['таверна'], keysecondary: ['трактир'], comment: 'Таверна', content: 'Шумно.' },
                3: { uid: 3, key: ['город'], comment: 'Город', content: 'Стены.', disable: true },
                1: { uid: 1, key: ['река'], comment: 'Река', content: 'Холодная.' },
            },
        });
        openSoloChat(mock, character('Marta', { data: { extensions: { world: 'Tavern Lore' } } }));
        const reader = createLoreReader(mockHost(), memoryLogger());
        expect(await reader.cardBook()).toEqual([
            { uid: 1, keys: ['река'], comment: 'Река', content: 'Холодная.' },
            { uid: 7, keys: ['таверна', 'трактир'], comment: 'Таверна', content: 'Шумно.' },
        ]);
    });

    it('falls back to the embedded character book', async () => {
        openSoloChat(
            mock,
            character('Marta', {
                data: {
                    character_book: {
                        entries: [
                            { id: 5, keys: ['ключ'], secondary_keys: ['второй'], name: 'Имя', content: 'Текст' },
                            { keys: ['выкл'], content: 'нет', enabled: false },
                        ],
                    },
                },
            }),
        );
        const reader = createLoreReader(mockHost(), memoryLogger());
        expect(await reader.cardBook()).toEqual([
            { uid: 5, keys: ['ключ', 'второй'], comment: 'Имя', content: 'Текст' },
        ]);
        mock.groupId = 'g';
        expect(await reader.cardBook()).toEqual([]);
    });
});
