// The display translation rules (src/domain/translate.ts): the display language, which strings are English, the
// per-card cache (keys, bounds, merging), batches, the prompt and the reading of the reply.
import { describe, expect, it } from 'vitest';
import { PLAYER_ID } from '../../src/domain/model';
import { emptyCardProfiles } from '../../src/domain/profile-defaults';
import {
    BATCH_CHARS,
    BATCH_ITEMS,
    MAX_ENTRIES,
    MAX_SOURCE,
    TRANSLATE_SCHEMA,
    boundTranslations,
    buildBatches,
    cardSources,
    characterSources,
    displayLanguage,
    emptyTranslations,
    lookupTranslation,
    mergeTranslations,
    nameHints,
    needsTranslation,
    normalizeSource,
    parseTranslations,
    readTranslations,
    storeTranslations,
    textLanguage,
    translateMaxTokens,
    translateMessages,
    translateSegments,
    translationKey,
    whoOf,
} from '../../src/domain/translate';
import type { BatchItem, TranslationDoc } from '../../src/domain/translate';
import { liveState, tavern } from './cast-fixtures';

describe('the display language', () => {
    it('takes the setting first, then the story’s language from Maestro, then the UI language', () => {
        expect(displayLanguage('ru', 'en', 'en')).toBe('ru');
        expect(displayLanguage('en', 'ru', 'ru')).toBe('en');
        expect(displayLanguage('auto', 'en', 'ru')).toBe('en');
        expect(displayLanguage('auto', 'ru', 'en')).toBe('ru');
        expect(displayLanguage('auto', undefined, 'ru')).toBe('ru');
        expect(displayLanguage('auto', 'de', 'en')).toBe('en');
        expect(displayLanguage(undefined, null, 'ru')).toBe('ru');
    });
});

describe('which strings are English', () => {
    it('reads English prose with Russian names as English, Russian prose with an English name as Russian', () => {
        expect(textLanguage('Wants Сота out of this town')).toBe('en');
        expect(textLanguage('Ильва and Брам distrust Сота')).toBe('en');
        expect(textLanguage('Не доверяет Kael')).toBe('ru');
        expect(textLanguage('Kael не доверяет имперцам')).toBe('ru');
        expect(textLanguage('Kael')).toBe('en');
        expect(textLanguage('Ильва, Брам')).toBe('ru');
        expect(textLanguage('42 — 7')).toBeNull();
    });

    it('translates English free text only: not Russian edits, numbers, stray letters or overlong text', () => {
        expect(needsTranslation('innkeeper')).toBe(true);
        expect(needsTranslation("counting the week's takings.")).toBe(true);
        expect(needsTranslation('Охраняет ворота от Kael')).toBe(false);
        expect(needsTranslation('брага')).toBe(false);
        expect(needsTranslation('x')).toBe(false);
        expect(needsTranslation('12')).toBe(false);
        expect(needsTranslation('   ')).toBe(false);
        expect(needsTranslation(undefined)).toBe(false);
        expect(needsTranslation('word '.repeat(MAX_SOURCE))).toBe(false);
    });

    it('keys a string by its normalized form: spaces and a trailing full stop do not matter', () => {
        expect(normalizeSource('  sells  the old cart. ')).toBe('sells the old cart');
        expect(normalizeSource('waits;,')).toBe('waits');
        expect(translationKey('sells the old cart.')).toBe(translationKey('sells  the old cart'));
        expect(translationKey('sells the old cart')).not.toBe(translationKey('sells the new cart'));
    });

    it('translates the English parts of a log line and leaves its Russian frame', () => {
        const tr = (part: string) => `[${part}]`;
        expect(translateSegments('Ильва → Курьер: новая причина «paid generously» (теплее)', tr)).toBe(
            'Ильва → Курьер: новая причина «[paid generously]» (теплее)',
        );
        expect(translateSegments('Ильва → Курьер: Нейтрален → Враждебна (an imperial)', tr)).toBe(
            'Ильва → Курьер: Нейтрален → Враждебна ([an imperial])',
        );
        expect(translateSegments('Ilva → the courier: new reason (warmer)', tr)).toBe(
            '[Ilva → the courier: new reason (warmer)]',
        );
        expect(translateSegments('Ильва ушла (Курьер)', tr)).toBe('Ильва ушла (Курьер)');
    });
});

describe('the cache document', () => {
    function doc(entries: Record<string, { ru: string; at: number }>): TranslationDoc {
        return { ...emptyTranslations('tavern.png'), entries };
    }

    it('stores translations by key, counts what changed and marks a looked-up entry as used', () => {
        const cache = emptyTranslations('tavern.png');
        const key = translationKey('innkeeper');
        expect(storeTranslations(cache, [{ key, ru: 'трактирщица' }], 10)).toBe(1);
        expect(storeTranslations(cache, [{ key, ru: 'трактирщица' }], 20)).toBe(0);
        expect(cache.entries[key]).toEqual({ ru: 'трактирщица', at: 20 });
        expect(lookupTranslation(cache, 'innkeeper.', 30)).toBe('трактирщица');
        expect(cache.entries[key]!.at).toBe(30);
        expect(lookupTranslation(cache, 'cook')).toBeUndefined();
    });

    it('stays bounded: the least recently used entries go first', () => {
        const cache = doc({
            a: { ru: 'а', at: 5 },
            b: { ru: 'б', at: 1 },
            c: { ru: 'в', at: 3 },
            d: { ru: 'г', at: 4 },
        });
        expect(boundTranslations(cache, 2)).toBe(2);
        expect(Object.keys(cache.entries).sort()).toEqual(['a', 'd']);
        const full = emptyTranslations('x');
        const items = Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => ({ key: `k${i}`, ru: 'да' }));
        storeTranslations(full, items, 1);
        expect(Object.keys(full.entries)).toHaveLength(MAX_ENTRIES);
    });

    it('reads a stored document tolerantly and bounds it', () => {
        const read = readTranslations(
            {
                schema: 1,
                card: 'other.png',
                entries: {
                    good: { ru: 'хорошо', at: 3 },
                    noTime: { ru: 'без времени' },
                    empty: { ru: '  ', at: 1 },
                    broken: 'да',
                    alsoBroken: { at: 2 },
                },
            },
            'tavern.png',
        );
        expect(read.card).toBe('tavern.png');
        expect(read.entries).toEqual({ good: { ru: 'хорошо', at: 3 }, noTime: { ru: 'без времени', at: 0 } });
        expect(readTranslations(null, 'tavern.png')).toEqual(emptyTranslations('tavern.png'));
        expect(readTranslations({ entries: [] }, 'tavern.png').entries).toEqual({});
    });

    it('merges another tab’s copy: the newer entry of a key wins, the rest is kept', () => {
        const ours = doc({ a: { ru: 'наше а', at: 5 }, b: { ru: 'наше б', at: 1 } });
        const theirs = doc({ b: { ru: 'их б', at: 2 }, c: { ru: 'их в', at: 1 }, a: { ru: 'их а', at: 4 } });
        const merged = mergeTranslations(ours, theirs);
        expect(merged.entries).toEqual({
            a: { ru: 'наше а', at: 5 },
            b: { ru: 'их б', at: 2 },
            c: { ru: 'их в', at: 1 },
        });
        expect(mergeTranslations(ours, theirs, 1).entries).toEqual({ a: { ru: 'наше а', at: 5 } });
    });
});

describe('batches', () => {
    it('takes only English strings, once each, keeping the first who or a later one when it lacked it', () => {
        const batches = buildBatches([
            { text: 'innkeeper' },
            { text: 'трактирщица' },
            { text: 'innkeeper.', who: 'Ильва (she)' },
            { text: 'paid generously', who: 'Ильва (she)' },
            { text: 'paid  generously', who: 'Брам (he)' },
            { text: '' },
            { text: 'Охраняет ворота от Kael' },
        ]);
        expect(batches).toEqual([
            [
                { id: '1', key: translationKey('innkeeper'), text: 'innkeeper', who: 'Ильва (she)' },
                { id: '2', key: translationKey('paid generously'), text: 'paid generously', who: 'Ильва (she)' },
            ],
        ]);
    });

    it('leaves out what is skipped (cached, in flight, failed a moment ago)', () => {
        const skipped = translationKey('innkeeper');
        const batches = buildBatches([{ text: 'innkeeper' }, { text: 'cook' }], { skip: (key) => key === skipped });
        expect(batches.flat().map((item) => item.text)).toEqual(['cook']);
        expect(buildBatches([{ text: 'innkeeper' }], { skip: () => true })).toEqual([]);
    });

    it('packs by count and by size, a long string alone, and stops at the batch limit', () => {
        const many = Array.from({ length: BATCH_ITEMS + 3 }, (_, i) => ({ text: `the note number ${i}` }));
        const batches = buildBatches(many);
        expect(batches.map((batch) => batch.length)).toEqual([BATCH_ITEMS, 3]);
        expect(batches[1]!.map((item) => item.id)).toEqual(['1', '2', '3']);

        const long = 'a long sentence about the war '.repeat(20).trim();
        const sized = buildBatches([{ text: 'short one' }, { text: long }, { text: 'short two' }], { maxChars: 300 });
        expect(sized.map((batch) => batch.map((item) => item.text.slice(0, 9)))).toEqual([
            ['short one'],
            ['a long se'],
            ['short two'],
        ]);
        expect(buildBatches(many, { maxItems: 10, maxBatches: 2 }).map((batch) => batch.length)).toEqual([10, 10]);
        expect(buildBatches(many, { maxItems: 10 }).flat()).toHaveLength(BATCH_ITEMS + 3);
        const chars = buildBatches(many.map((item) => ({ text: `${item.text} ${'x'.repeat(200)}` })));
        for (const batch of chars) {
            expect(batch.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(BATCH_CHARS);
        }
    });
});

describe('the request', () => {
    const batch: BatchItem[] = [
        { id: '1', key: 'k1', text: 'Ilva keeps the inn to spite the occupiers', who: 'Ильва (she)' },
        { id: '2', key: 'k2', text: 'sees a purse' },
    ];

    it('says whom each note is about and gives the Russian names of the English ones in the batch', () => {
        const names = nameHints(
            [
                { name: 'Ильва', english: 'Ilva', aliases: ['хозяйка'] },
                { name: 'Брам', english: 'Bram', aliases: [] },
                { name: 'Kael', english: 'Kael', aliases: [] },
            ],
            batch.map((item) => item.text),
        );
        expect(names).toEqual(['Ilva = Ильва']);
        const messages = translateMessages(batch, names);
        expect(messages).toHaveLength(2);
        expect(messages[0]!.role).toBe('system');
        expect(messages[0]!.content).toMatch(/into Russian/);
        expect(messages[0]!.content).toMatch(/Add nothing/);
        expect(messages[0]!.content).toMatch(/names/);
        expect(JSON.parse(messages[1]!.content)).toEqual({
            names: ['Ilva = Ильва'],
            items: [
                { id: '1', text: 'Ilva keeps the inn to spite the occupiers', who: 'Ильва (she)' },
                { id: '2', text: 'sees a purse' },
            ],
        });
        expect(JSON.parse(translateMessages(batch)[1]!.content).names).toBeUndefined();
    });

    it('matches names as whole words and budgets the answer by the size of the batch', () => {
        expect(nameHints([{ name: 'Ильва', english: 'Ilva', aliases: [] }], ['Ilvana sings'])).toEqual([]);
        expect(translateMaxTokens(batch)).toBeGreaterThanOrEqual(300);
        const big = Array.from({ length: 40 }, (_, i) => ({ id: String(i), key: String(i), text: 'x'.repeat(90) }));
        expect(translateMaxTokens(big)).toBeGreaterThan(translateMaxTokens(batch));
        expect(translateMaxTokens(big)).toBeLessThanOrEqual(4000);
        expect(TRANSLATE_SCHEMA).toMatchObject({ required: ['items'] });
    });

    it('names whom a note is about with the gender the endings need', () => {
        const { profiles } = tavern();
        expect(whoOf(profiles.find((item) => item.id === 'ilva')!)).toBe('Ильва (she)');
        expect(whoOf(profiles.find((item) => item.id === 'bram')!)).toBe('Брам (he)');
        expect(whoOf(profiles.find((item) => item.kind === 'group')!)).toMatch(/\(group\)$/);
        expect(whoOf({ name: 'Некто', kind: 'character' })).toBe('Некто');
    });
});

describe('the reply', () => {
    const batch: BatchItem[] = [
        { id: '1', key: 'k1', text: 'innkeeper' },
        { id: '2', key: 'k2', text: 'paid generously' },
        { id: '3', key: 'k3', text: 'sees a purse' },
    ];

    it('takes the Russian of known ids, cleaned like a source', () => {
        const parsed = parseTranslations(
            {
                items: [
                    { id: '1', ru: ' трактирщица. ' },
                    { id: '2', ru: '«щедро заплатил»' },
                    { id: '3', ru: 'видит  кошелёк' },
                ],
            },
            batch,
        );
        expect(parsed).toEqual({
            translated: [
                { key: 'k1', ru: 'трактирщица' },
                { key: 'k2', ru: 'щедро заплатил' },
                { key: 'k3', ru: 'видит кошелёк' },
            ],
            missing: [],
        });
    });

    it('ignores unknown ids and repeats, and leaves out English, empty or padded answers', () => {
        const parsed = parseTranslations(
            {
                items: [
                    { id: '9', ru: 'лишнее' },
                    { id: 1, ru: 'трактирщица' },
                    { id: '1', ru: 'другое' },
                    { id: '2', ru: 'paid generously' },
                    {
                        id: '3',
                        ru: 'видит кошелёк и ещё очень много всего, чего в оригинале не было и не могло быть никогда',
                    },
                    'garbage',
                    { id: '2' },
                ],
            },
            batch,
        );
        expect(parsed.translated).toEqual([{ key: 'k1', ru: 'трактирщица' }]);
        expect(parsed.missing).toEqual(['k2', 'k3']);
    });

    it('reads a JSON text answer and survives garbage', () => {
        expect(parseTranslations('{"items":[{"id":"3","ru":"видит кошелёк"}]}', batch).translated).toEqual([
            { key: 'k3', ru: 'видит кошелёк' },
        ]);
        expect(parseTranslations('not json', batch)).toEqual({ translated: [], missing: ['k1', 'k2', 'k3'] });
        expect(parseTranslations(null, batch).missing).toHaveLength(3);
        expect(parseTranslations({ items: 'no' }, batch).missing).toHaveLength(3);
    });
});

describe('everything of a card', () => {
    it('lists a character’s free text from the profile and the live state, with whom it is about', () => {
        const { profiles } = tavern();
        const ilva = profiles.find((item) => item.id === 'ilva')!;
        const live = liveState(ilva, {
            scene: { attention: 'business', doing: 'wiping the counter' },
            emotion: { type: 'suspicion', intensity: 2, target: PLAYER_ID, cause: 'he asked about letters', until: 3 },
        });
        const sources = characterSources(ilva, live);
        const texts = sources.map((source) => source.text);
        for (const text of [
            'innkeeper',
            "a rebel's widow who keeps the inn to spite the occupiers",
            'grim watchfulness',
            'refusing small favours',
            'passes letters to the rebels',
            'an imperial',
            'takes his coin, gives nothing back, never says his name',
            "counting the week's takings",
            'wiping the counter',
            'suspicion',
            'he asked about letters',
        ]) {
            expect(texts).toContain(text);
        }
        expect(sources.every((source) => source.who === 'Ильва (she)')).toBe(true);
    });

    it('lists every character of the card, the chat’s extras, schemes and the world', () => {
        const { profiles, state } = tavern();
        const card = {
            ...emptyCardProfiles('tavern.png'),
            characters: profiles,
            invariants: ['the garrison never leaves'],
        };
        const extra = { ...profiles[1]!, id: 'guard', name: 'Стражник', role: 'gate guard' };
        const chatState = {
            ...state,
            extras: [extra],
            rumours: [
                {
                    id: 'r1',
                    text: 'the courier cheats at dice',
                    about: PLAYER_ID,
                    origin: 'x',
                    carriers: [],
                    reached: [],
                    turn: 1,
                },
            ],
        };
        const texts = cardSources(card, chatState).map((source) => source.text);
        expect(texts).toContain('gate guard');
        expect(texts).toContain('the garrison never leaves');
        expect(texts).toContain('the courier cheats at dice');
        expect(texts).toContain('dicing with the carters');
        expect(cardSources(card, null).map((source) => source.text)).toContain('innkeeper');
    });
});
