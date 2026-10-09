// The translator and its cache store over small fakes: the per-card file (load, save after a pause, merging another
// tab's copy, re-reading), and the scheduling (a producer asked again waits again; separate occasions run at their own
// time; interactive strings are not sent again in the background).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFileName } from '../../src/core/files';
import { stableHash } from '../../src/core/hash';
import { TRANSLATE_TASK, translationKey } from '../../src/domain/translate';
import type { TranslationSource } from '../../src/domain/translate';
import { createTranslator } from '../../src/features/translate/service';
import { SAVE_DELAY_MS, createTranslationStore, translationsFile } from '../../src/features/translate/store';
import type { App, FileStore, LlmRequest, LlmResult } from '../../src/shared/contracts';
import { memoryLogger } from '../helpers/fakes';

afterEach(() => {
    vi.useRealTimers();
});

function memoryFiles(): FileStore & { data: Map<string, string>; writes: number } {
    const files = {
        data: new Map<string, string>(),
        writes: 0,
        async read<T>(name: string): Promise<T | null> {
            const text = files.data.get(name);
            return text === undefined ? null : (JSON.parse(text) as T);
        },
        async write(name: string, data: unknown): Promise<void> {
            files.writes++;
            files.data.set(name, JSON.stringify(data));
        },
        async remove(name: string): Promise<void> {
            files.data.delete(name);
        },
        fileName: (kind: string, key?: string) => makeFileName(kind, key),
    };
    return files;
}

interface FakeApp {
    app: App;
    files: ReturnType<typeof memoryFiles>;
    requests: LlmRequest[];
    reply: (request: LlmRequest) => LlmResult | Promise<LlmResult>;
}

/** Just what the translator touches: a solo chat with a card, Russian, Maestro leading, an LLM that answers. */
function fakeApp(): FakeApp {
    const files = memoryFiles();
    const fake: FakeApp = {
        files,
        requests: [],
        reply: (request) => {
            const items = (JSON.parse(request.messages[1]!.content) as { items: { id: string; text: string }[] }).items;
            return {
                ok: true,
                data: { items: items.map((item) => ({ id: item.id, ru: `перевод строки ${item.id}` })) },
            };
        },
        app: undefined as unknown as App,
    };
    fake.app = {
        host: { isGroupChat: () => false, cardKey: () => 'tavern.png', chatId: () => 'chat-1' },
        settings: { get: () => ({ textLanguage: 'ru' }) },
        i18n: { locale: () => 'ru' },
        maestro: { api: () => ({ leader: { isLeader: () => true } }), present: () => true },
        llm: {
            available: () => true,
            async request(request: LlmRequest) {
                fake.requests.push(request);
                return fake.reply(request);
            },
        },
        modules: { api: () => undefined },
        files,
    } as unknown as App;
    return fake;
}

const textsOf = (request: LlmRequest) =>
    (JSON.parse(request.messages[1]!.content) as { items: { text: string }[] }).items.map((item) => item.text);

describe('translate — the cache store', () => {
    it('loads a card’s file, saves new translations after a pause, merged with another tab’s copy', async () => {
        vi.useFakeTimers();
        const files = memoryFiles();
        const name = translationsFile(files, 'tavern.png');
        expect(name).toBe(makeFileName(`card-${stableHash('tavern.png')}-ru`));
        files.data.set(
            name,
            JSON.stringify({ schema: 1, card: 'tavern.png', entries: { old: { ru: 'старое', at: 1 } } }),
        );
        const store = createTranslationStore({ files, log: memoryLogger() });
        expect(store.current('tavern.png')).toBeNull();
        const doc = await store.ensure('tavern.png');
        expect(doc.entries.old?.ru).toBe('старое');
        expect(store.put('tavern.png', [{ key: 'new', ru: 'новое' }], 10)).toBe(1);
        expect(store.put('other.png', [{ key: 'x', ru: 'икс' }], 10)).toBe(0);

        // Another tab writes meanwhile.
        files.data.set(
            name,
            JSON.stringify({
                schema: 1,
                card: 'tavern.png',
                entries: { old: { ru: 'старое', at: 1 }, theirs: { ru: 'их', at: 5 } },
            }),
        );
        expect(files.writes).toBe(0);
        await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
        expect(files.writes).toBe(1);
        const saved = JSON.parse(files.data.get(name)!) as { entries: Record<string, { ru: string }> };
        expect(Object.keys(saved.entries).sort()).toEqual(['new', 'old', 'theirs']);
        expect(store.lookup('tavern.png', 'irrelevant', 1)).toBeUndefined();
        expect(store.has('tavern.png', 'theirs')).toBe(true);
        await store.dispose();
        expect(files.writes).toBe(1);
    });

    it('re-reads the file for another tab’s translations, and writes a pending save before switching cards', async () => {
        const files = memoryFiles();
        const store = createTranslationStore({ files, log: memoryLogger(), saveDelayMs: 60_000 });
        await store.ensure('tavern.png');
        store.put('tavern.png', [{ key: translationKey('innkeeper'), ru: 'трактирщица' }], 10);
        const name = translationsFile(files, 'tavern.png');
        files.data.set(
            name,
            JSON.stringify({ schema: 1, card: 'tavern.png', entries: { theirs: { ru: 'их', at: 20 } } }),
        );
        expect(await store.refresh('tavern.png', true)).toBe(1);
        expect(store.has('tavern.png', 'theirs')).toBe(true);
        expect(await store.refresh('tavern.png')).toBe(0);

        await store.ensure('ford.png');
        expect(store.current('tavern.png')).toBeNull();
        expect(store.current('ford.png')).not.toBeNull();
        const saved = JSON.parse(files.data.get(name)!) as { entries: Record<string, { ru: string }> };
        expect(saved.entries[translationKey('innkeeper')]?.ru).toBe('трактирщица');
        expect(saved.entries.theirs?.ru).toBe('их');
        expect(store.size('ford.png')).toBe(0);
    });
});

describe('translate — scheduling', () => {
    it('waits again when the same occasion comes again (a trailing debounce), the others at their own time', async () => {
        vi.useFakeTimers();
        const fake = fakeApp();
        const translator = createTranslator({ app: fake.app, log: memoryLogger() });
        await vi.advanceTimersByTimeAsync(0);
        const scene: () => TranslationSource[] = () => [{ text: 'dicing with the carters' }];
        translator.api.schedule(scene, { delayMs: 4000 });
        await vi.advanceTimersByTimeAsync(3000);
        translator.api.schedule(scene, { delayMs: 4000 });
        translator.api.schedule(() => [{ text: 'an imperial' }], { delayMs: 800 });
        await vi.advanceTimersByTimeAsync(900);
        expect(fake.requests.map(textsOf)).toEqual([['an imperial']]);
        await vi.advanceTimersByTimeAsync(2000);
        expect(fake.requests).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1200);
        expect(fake.requests.map(textsOf)).toEqual([['an imperial'], ['dicing with the carters']]);
        expect(fake.requests.every((request) => request.task === TRANSLATE_TASK && request.background)).toBe(true);
        expect(translator.api.display('an imperial')).toBe('перевод строки 1');
        await translator.dispose();
    });

    it('sends what the user opened as his own request and leaves it out of the background one', async () => {
        const fake = fakeApp();
        const translator = createTranslator({ app: fake.app, log: memoryLogger() });
        translator.api.schedule(() => [{ text: 'an imperial' }, { text: 'innkeeper' }], { interactive: true });
        translator.api.schedule(() => [{ text: 'innkeeper' }, { text: 'sees a purse' }], { delayMs: 5000 });
        await translator.api.settle();
        expect(fake.requests).toHaveLength(2);
        const own = fake.requests.find((request) => !request.background)!;
        const background = fake.requests.find((request) => request.background)!;
        expect(textsOf(own)).toEqual(['an imperial', 'innkeeper']);
        expect(textsOf(background)).toEqual(['sees a purse']);
        await translator.dispose();
    });

    it('forgets what was scheduled for the old chat and cancels its requests', async () => {
        const fake = fakeApp();
        let release: (value: LlmResult) => void = () => {};
        fake.reply = () =>
            new Promise((resolve) => {
                release = resolve;
            });
        const translator = createTranslator({ app: fake.app, log: memoryLogger() });
        const running = translator.api.request([{ text: 'an imperial' }]);
        translator.api.schedule(() => [{ text: 'innkeeper' }], { delayMs: 60_000 });
        await vi.waitFor(() => expect(fake.requests).toHaveLength(1));
        expect(fake.requests[0]!.signal?.aborted).toBe(false);
        translator.chatChanged();
        expect(fake.requests[0]!.signal?.aborted).toBe(true);
        release({ ok: false, error: 'aborted' });
        expect(await running).toMatchObject({ ok: false, error: 'aborted', translated: 0 });
        await translator.api.settle();
        expect(fake.requests).toHaveLength(1);
        await translator.dispose();
    });
});
