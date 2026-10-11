// @vitest-environment happy-dom
// The «translate» module on the whole app: DRAMATIS_API.describe() in Russian once translated (English before, the
// DES tab told through onChange), the display language (Maestro's story language, the setting, the UI language), the
// per-card cache file, background versus interactive runs (leader, no Maestro, the own connection), re-entrancy and
// failed answers, the scene after a save, «Перевести сейчас» and the settings section.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFileName } from '../../src/core/files';
import { stableHash } from '../../src/core/hash';
import { TRANSLATE_TASK, translationKey } from '../../src/domain/translate';
import type { CardProfiles, ChatState } from '../../src/domain/model';
import { emptyCardProfiles } from '../../src/domain/profile-defaults';
import { TRANSLATE_API } from '../../src/features/translate/api';
import type { TranslateApi } from '../../src/features/translate/api';
import { outcomeText } from '../../src/features/translate';
import { TRANSLATE_STRINGS } from '../../src/features/translate/strings';
import { DRAMATIS_API_GLOBAL } from '../../src/shared/apis';
import type { ApiLlmRequest, ApiLlmResult, DramatisApiV1 } from '../../src/shared/apis';
import { fakeMaestro } from '../helpers/fakes';
import type { FakeMaestro } from '../helpers/fakes';
import { flush } from '../helpers/st-mock';
import { tavern } from '../domain/cast-fixtures';
import { fakeDes, startHarness, stopHarness, until } from './harness';
import type { Harness, HarnessOptions } from './harness';

afterEach(stopHarness);

const api = () => (globalThis as unknown as Record<string, DramatisApiV1>)[DRAMATIS_API_GLOBAL]!;
const translator = (h: Harness) => h.app.modules.api<TranslateApi>(TRANSLATE_API)!;
const cacheFile = (card = 'tavern.png') => makeFileName(`card-${stableHash(card)}-ru`);

function tavernCard(): CardProfiles {
    return { ...emptyCardProfiles('tavern.png'), characters: tavern().profiles };
}

function tavernState(): ChatState {
    return { ...tavern().state, card: 'tavern.png' };
}

/** Russian for the tavern's English lines (what Ильва's summary and the list show). */
const RU: Record<string, string> = {
    "a rebel's widow who keeps the inn to spite the occupiers": 'вдова повстанца, держит трактир назло оккупантам',
    innkeeper: 'трактирщица',
    'an imperial': 'имперец',
    'the Empire hanged her husband': 'Империя повесила её мужа',
    'paid generously': 'заплатил щедро',
    'takes his coin, gives nothing back, never says his name':
        'берёт его монету, ничего не даёт взамен, имени не называет',
    'grim watchfulness': 'мрачная настороженность',
    'passes letters to the rebels': 'передаёт письма повстанцам',
    'if she is ordered about, does it slowly and badly': 'если ей приказывают — делает медленно и плохо',
    'bluntness, silence, refusing small favours': 'прямота, молчание, отказ в мелких услугах',
    bluntness: 'прямота',
    silence: 'молчание',
    'refusing small favours': 'отказ в мелких услугах',
    'protection of her daughter': 'защита её дочери',
    'honest payment of the town debts': 'честная уплата долгов города',
};

/** The translation requests Maestro got (other tasks left out). */
const translations = (maestro: FakeMaestro) => maestro.requests.filter((request) => request.task === TRANSLATE_TASK);

function itemsOf(request: ApiLlmRequest): { id: string; text: string; who?: string }[] {
    return (JSON.parse(request.messages[1]!.content) as { items: { id: string; text: string; who?: string }[] }).items;
}

/** Maestro answers translation requests from RU (unknown lines are left out of the answer). */
function translating(maestro: FakeMaestro, dict: Record<string, string> = RU): void {
    maestro.reply = (request) => {
        if (request.task !== TRANSLATE_TASK) return { ok: true, data: 'ok', text: 'ok' };
        const items = itemsOf(request)
            .filter((item) => dict[item.text])
            .map((item) => ({ id: item.id, ru: dict[item.text]! }));
        return { ok: true, data: { items }, costUsd: 0.0002 };
    };
}

async function setup(options: { maestro?: FakeMaestro | null; before?: HarnessOptions['before'] } = {}) {
    const maestro = options.maestro === null ? null : (options.maestro ?? fakeMaestro());
    if (maestro) translating(maestro);
    const h = await startHarness({
        profiles: tavernCard(),
        state: tavernState(),
        persona: 'Курьер',
        maestro: maestro ?? undefined,
        before: (mock) => {
            // The card is not read by itself: the intent reading makes requests of its own.
            mock.extensionSettings.dramatis = { slices: { intent: { autoRead: false } } };
            options.before?.(mock);
        },
    });
    return { h, maestro };
}

describe('translate — describe() for the DES tab', () => {
    it('shows the English until translated, asks in the background, then shows Russian and tells the listeners', async () => {
        const { h, maestro } = await setup();
        const listener = vi.fn();
        api().onChange(listener);

        const before = api().describe!('Ильва')!;
        expect(before.headline).toBe("a rebel's widow who keeps the inn to spite the occupiers");
        expect(translations(maestro!)).toHaveLength(0);

        await translator(h).settle();
        const sent = translations(maestro!);
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({
            task: TRANSLATE_TASK,
            background: true,
            schema: { name: 'dramatis_translation' },
        });
        const texts = itemsOf(sent[0]!).map((item) => item.text);
        expect(texts).toContain('an imperial');
        expect(texts).toContain('grim watchfulness');
        expect(itemsOf(sent[0]!)[0]!.who).toBe('Ильва (she)');
        await flush();
        expect(listener).toHaveBeenCalled();

        const after = api().describe!('Ильва')!;
        expect(after.headline).toBe('вдова повстанца, держит трактир назло оккупантам');
        const lines = Object.fromEntries(after.sections.map((section) => [section.id, section.lines]));
        expect(lines.stance![0]).toEqual({ text: 'Враждебна — имперец; Империя повесила её мужа; заплатил щедро' });
        expect(lines.stance![1]).toEqual({
            text: 'Как проявляется: берёт его монету, ничего не даёт взамен, имени не называет',
        });
        expect(lines.now).toContainEqual({ text: 'Настроение: мрачная настороженность' });
        expect(lines.secrets).toEqual([{ text: 'передаёт письма повстанцам', secret: true }]);

        // Everything shown is cached: describe() asks nothing more.
        await translator(h).settle();
        expect(translations(maestro!)).toHaveLength(1);
    });

    it('leaves the user’s Russian alone: it is shown as written and never sent', async () => {
        const card = tavernCard();
        const ilva = card.characters.find((item) => item.id === 'ilva')!;
        ilva.core.concept = 'Вдова повстанца, назло имперцам держит трактир';
        ilva.role = 'хозяйка трактира';
        const maestro = fakeMaestro();
        translating(maestro);
        const h = await startHarness({ profiles: card, state: tavernState(), persona: 'Курьер', maestro });
        expect(api().describe!('Ильва')!.headline).toBe('Вдова повстанца, назло имперцам держит трактир');
        await translator(h).settle();
        const texts = translations(maestro).flatMap((request) => itemsOf(request).map((item) => item.text));
        expect(texts).not.toContain('Вдова повстанца, назло имперцам держит трактир');
        expect(texts.some((text) => /[а-яё]{3}/i.test(text) && !/[a-z]{3}/i.test(text))).toBe(false);
        expect(texts).toContain('an imperial');
    });
});

describe('translate — the display language', () => {
    it('follows Maestro’s story language: an English story shows the stored text and asks nothing', async () => {
        const maestro = fakeMaestro();
        maestro.api.storyLanguage = () => 'en';
        const { h } = await setup({ maestro });
        expect(translator(h).language()).toBe('en');
        expect(api().describe!('Ильва')!.headline).toBe("a rebel's widow who keeps the inn to spite the occupiers");
        await translator(h).settle();
        expect(translations(maestro)).toHaveLength(0);

        // The setting overrides the story's language.
        h.app.settings.set('textLanguage', 'ru');
        expect(translator(h).language()).toBe('ru');
        api().describe!('Ильва');
        await translator(h).settle();
        expect(translations(maestro)).toHaveLength(1);
    });

    it('lets the setting keep English for a Russian story, and falls back to the UI language without Maestro’s', async () => {
        const maestro = fakeMaestro();
        maestro.api.storyLanguage = () => 'ru';
        const { h } = await setup({ maestro });
        expect(translator(h).language()).toBe('ru');
        h.app.settings.set('textLanguage', 'en');
        expect(translator(h).language()).toBe('en');
        api().describe!('Ильва');
        await translator(h).settle();
        expect(translations(maestro)).toHaveLength(0);

        h.app.settings.set('textLanguage', 'auto');
        delete maestro.api.storyLanguage;
        expect(translator(h).language()).toBe('ru');
        h.app.settings.set('uiLanguage', 'en');
        expect(translator(h).language()).toBe('en');
        h.app.settings.set('uiLanguage', 'ru');
        expect(translator(h).language()).toBe('ru');
    });

    it('tells the listeners when the language changes', async () => {
        const { h } = await setup();
        const listener = vi.fn();
        translator(h).onChange(listener);
        h.app.settings.set('textLanguage', 'en');
        expect(listener).toHaveBeenCalled();
    });
});

describe('translate — the cache', () => {
    it('keeps the translations per card in dramatis-card-<hash>-ru.json, merged with what is there', async () => {
        const { h, maestro } = await setup({
            before: (mock) => {
                mock.files.set(
                    cacheFile(),
                    JSON.stringify({
                        schema: 1,
                        card: 'tavern.png',
                        entries: {
                            [translationKey('dicing with the carters')]: { ru: 'играет в кости с возчиками', at: 1 },
                        },
                    }),
                );
            },
        });
        api().describe!('Ильва');
        await translator(h).settle();
        expect(translations(maestro!)).toHaveLength(1);
        // Stopping the module writes the pending save at once.
        await h.runtime.modules.disable('translate');
        const stored = JSON.parse(h.mock.files.get(cacheFile())!) as {
            card: string;
            entries: Record<string, { ru: string; at: number }>;
        };
        expect(stored.card).toBe('tavern.png');
        expect(stored.entries[translationKey('an imperial')]?.ru).toBe('имперец');
        expect(stored.entries[translationKey('dicing with the carters')]?.ru).toBe('играет в кости с возчиками');
    });

    it('shows a stored translation as soon as the chat opens, without asking again', async () => {
        const entries: Record<string, { ru: string; at: number }> = {};
        for (const [english, russian] of Object.entries(RU)) entries[translationKey(english)] = { ru: russian, at: 5 };
        const { h, maestro } = await setup({
            before: (mock) => mock.files.set(cacheFile(), JSON.stringify({ schema: 1, card: 'tavern.png', entries })),
        });
        await until(() => translator(h).display('innkeeper') === 'трактирщица');
        expect(api().describe!('Ильва')!.headline).toBe('вдова повстанца, держит трактир назло оккупантам');
        expect(translator(h).translation('an imperial.')).toBe('имперец');
        // Only the lines without a translation are asked for.
        await translator(h).settle();
        const texts = translations(maestro!).flatMap((request) => itemsOf(request).map((item) => item.text));
        for (const english of Object.keys(RU)) expect(texts).not.toContain(english);
    });
});

describe('translate — runs', () => {
    it('never asks for the same strings twice at a time', async () => {
        const { h, maestro } = await setup();
        let release: (value: ApiLlmResult) => void = () => {};
        let calls = 0;
        maestro!.reply = () =>
            calls++ === 0
                ? new Promise((resolve) => {
                      release = resolve;
                  })
                : { ok: true, data: { items: [{ id: '1', ru: 'трактирщица' }] } };
        const sources = [{ text: 'an imperial' }, { text: 'paid generously' }];
        const first = translator(h).request(sources);
        await flush();
        const second = await translator(h).request([...sources, { text: 'innkeeper' }]);
        expect(translations(maestro!)).toHaveLength(2);
        expect(itemsOf(translations(maestro!)[1]!).map((item) => item.text)).toEqual(['innkeeper']);
        release({
            ok: true,
            data: {
                items: [
                    { id: '1', ru: 'имперец' },
                    { id: '2', ru: 'заплатил щедро' },
                ],
            },
        });
        expect(await first).toMatchObject({ ok: true, translated: 2 });
        expect(second).toMatchObject({ ok: true, translated: 1 });
    });

    it('does not ask again at once for what the model failed, but «Перевести сейчас» retries it', async () => {
        const { h, maestro } = await setup();
        maestro!.reply = () => ({ ok: true, data: { items: [{ id: '1', ru: 'still English' }] } });
        const outcome = await translator(h).request([{ text: 'an imperial' }]);
        expect(outcome).toMatchObject({ ok: false, translated: 0, failed: 1 });
        await translator(h).request([{ text: 'an imperial' }]);
        expect(translations(maestro!)).toHaveLength(1);

        translating(maestro!);
        const all = await translator(h).translateAll();
        expect(all.translated).toBeGreaterThan(5);
        const retried = translations(maestro!)
            .slice(1)
            .flatMap((request) => itemsOf(request).map((item) => item.text));
        expect(retried).toContain('an imperial');
        expect(
            translations(maestro!)
                .slice(1)
                .every((request) => request.background === false),
        ).toBe(true);
        expect(translator(h).display('an imperial')).toBe('имперец');
    });

    it('waits in a tab that does not lead the chat; the user’s own request goes through', async () => {
        const maestro = fakeMaestro();
        maestro.api.leader = { isLeader: () => false, onChange: () => () => {} };
        const { h } = await setup({ maestro });
        api().describe!('Ильва');
        await translator(h).settle();
        expect(translations(maestro)).toHaveLength(0);
        const outcome = await translator(h).request([{ text: 'an imperial' }], { interactive: true });
        expect(outcome).toMatchObject({ ok: true, translated: 1 });
        expect(translations(maestro)[0]).toMatchObject({ background: false });
    });

    it('pauses background runs after Maestro refused one (the daily cap)', async () => {
        const { h, maestro } = await setup();
        maestro!.reply = () => ({ ok: false, error: 'cap' });
        expect(await translator(h).request([{ text: 'an imperial' }])).toMatchObject({ ok: false, error: 'cap' });
        expect(await translator(h).request([{ text: 'paid generously' }])).toMatchObject({ error: 'paused' });
        expect(translations(maestro!)).toHaveLength(1);
    });

    it('stops on a «workshop» refusal (Maestro 1.21 «Мастерская») without counting the strings as failed', async () => {
        const { h, maestro } = await setup();
        maestro!.reply = () => ({ ok: false, error: 'workshop' });
        const outcome = await translator(h).request([{ text: 'an imperial' }], { interactive: true });
        expect(outcome).toMatchObject({ ok: false, error: 'workshop', failed: 0 });
        translating(maestro!);
        const again = await translator(h).request([{ text: 'an imperial' }], { interactive: true });
        expect(again).toMatchObject({ ok: true, translated: 1 });
    });

    it('without Maestro: nothing in the background, the user’s own request on the own connection profile', async () => {
        const sent: unknown[] = [];
        const { h } = await setup({
            maestro: null,
            before: (mock) => {
                mock.extensionSettings.connectionManager = {
                    selectedProfile: 'p1',
                    profiles: [{ id: 'p1', name: 'Main', api: 'openai' }],
                };
                mock.sendRequest = async (_profile, prompt) => {
                    sent.push(prompt);
                    const content = JSON.stringify({ items: [{ id: '1', ru: 'имперец' }] });
                    return { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] };
                };
            },
        });
        expect(await translator(h).request([{ text: 'an imperial' }])).toMatchObject({ error: 'needs-maestro' });
        expect(sent).toHaveLength(0);
        const outcome = await translator(h).request([{ text: 'an imperial' }], { interactive: true });
        expect(outcome).toMatchObject({ ok: true, translated: 1 });
        expect(sent).toHaveLength(1);
        expect(translator(h).display('an imperial')).toBe('имперец');
    });

    it('translates the summaries of the scene after a save (a pass, a reading), in the background', async () => {
        const { h, maestro } = await setup();
        fakeDes(h.runtime, [{ name: 'Брам', present: true, details: {} }]);
        await h.engine.refresh();
        await h.engine.updateState((state) => {
            state.characters.bram!.scene = { attention: 'business', doing: 'dicing with the carters' };
        });
        await translator(h).settle();
        const sent = translations(maestro!);
        expect(sent).toHaveLength(1);
        expect(sent[0]!.background).toBe(true);
        const texts = itemsOf(sent[0]!).map((item) => item.text);
        expect(texts).toContain('dicing with the carters');
        expect(texts).toContain('sees a purse');
        expect(texts).not.toContain('an imperial');
        expect(itemsOf(sent[0]!).every((item) => item.who === 'Брам (he)')).toBe(true);
    });

    it('registers its task with Maestro', async () => {
        const maestro = fakeMaestro();
        const registered: string[] = [];
        maestro.api.llm.registerTask = (id) => {
            registered.push(id);
            return () => {};
        };
        await setup({ maestro });
        expect(registered).toContain(TRANSLATE_TASK);
    });
});

describe('translate — settings and words', () => {
    it('has every key in both languages', () => {
        expect(Object.keys(TRANSLATE_STRINGS.ru).sort()).toEqual(Object.keys(TRANSLATE_STRINGS.en).sort());
    });

    it('shows the language choice, the current language and «Перевести сейчас», which tells the result', async () => {
        const { h, maestro } = await setup();
        const section = document.querySelector<HTMLElement>('#dramatis-settings [data-section="translate"]')!;
        expect(section).not.toBeNull();
        const choice = section.querySelector<HTMLSelectElement>('select')!;
        expect(choice.getAttribute('aria-label')).toBe('Язык описаний в окнах');
        expect([...choice.options].map((option) => option.value)).toEqual(['auto', 'ru', 'en']);
        expect(section.textContent).toContain('Сейчас: русский — язык интерфейса.');
        choice.value = 'en';
        choice.dispatchEvent(new Event('change'));
        expect(h.app.settings.get().textLanguage).toBe('en');
        expect(section.textContent).toContain('Сейчас: английский (выбран здесь).');
        choice.value = 'ru';
        choice.dispatchEvent(new Event('change'));

        const now = [...section.querySelectorAll<HTMLButtonElement>('button')].find(
            (button) => button.textContent?.trim() === 'Перевести сейчас',
        )!;
        now.click();
        await until(() => translations(maestro!).length > 0);
        await translator(h).settle();
        await flush();
        expect(translations(maestro!).every((request) => request.background === false)).toBe(true);
        expect(section.textContent).toMatch(/Переводов у этой карточки: \d+\./);
    });

    it('words the outcome of «Перевести сейчас»', async () => {
        const { h } = await setup();
        const text = (outcome: Parameters<typeof outcomeText>[1]) => outcomeText(h.app, outcome);
        expect(text({ ok: true, translated: 0, failed: 0, pending: 0 })).toBe(
            'Переводить нечего: все описания уже по-русски.',
        );
        expect(text({ ok: true, translated: 12, failed: 0, pending: 0 })).toBe('Описаний переведено: 12.');
        expect(text({ ok: false, translated: 10, failed: 2, pending: 3 })).toBe(
            'Описаний переведено: 10; модель не перевела ещё 5.',
        );
        expect(text({ ok: false, translated: 0, failed: 0, pending: 4, error: 'not-leader' })).toMatch(
            /^Описания не переведены: Этот чат ведёт другая вкладка/,
        );
        expect(text({ ok: true, translated: 0, failed: 0, pending: 0, error: 'english' })).toMatch(/по-английски/);
        expect(text({ ok: false, translated: 0, failed: 0, pending: 0, error: 'no-card' })).toMatch(/по карточке/);
    });
});
