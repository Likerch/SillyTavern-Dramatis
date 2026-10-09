// @vitest-environment happy-dom
// The intent sheet with the display translation: free text in Russian once translated (the list, the page header,
// live reasons, the story log), English field values keeping the stored text with the Russian as a hint, Russian and
// names left alone, and what the window asks to translate — interactive when the user opened or clicked it, background
// when a change re-rendered it.
import { afterEach, describe, expect, it } from 'vitest';
import { needsTranslation, normalizeSource } from '../../../src/domain/translate';
import type { TranslationSource } from '../../../src/domain/translate';
import type { TranslateApi } from '../../../src/features/translate/api';
import { buttonByText, byKey, flush, harness, profileOf } from './harness';
import type { Harness } from './harness';

let h: Harness | null = null;

afterEach(async () => {
    await h?.dispose();
    h = null;
});

interface FakeTranslate extends TranslateApi {
    dict: Record<string, string>;
    lang: 'ru' | 'en';
    scheduled: { sources: TranslationSource[]; interactive: boolean }[];
    /** Translations arrived: tells the listeners. */
    arrive(dict: Record<string, string>): void;
}

function fakeTranslate(dict: Record<string, string> = {}): FakeTranslate {
    const listeners = new Set<() => void>();
    const lookup = (text: string) => (needsTranslation(text) ? fake.dict[normalizeSource(text)] : undefined);
    const fake: FakeTranslate = {
        dict,
        lang: 'ru',
        scheduled: [],
        language: () => fake.lang,
        display: (text) => (fake.lang === 'ru' ? (lookup(text) ?? text) : text),
        translation: (text) => (fake.lang === 'ru' ? lookup(text) : undefined),
        needs: (text) => needsTranslation(text),
        request: async () => ({ ok: true, translated: 0, failed: 0, pending: 0 }),
        schedule(producer, options) {
            fake.scheduled.push({ sources: [...producer()], interactive: options?.interactive === true });
        },
        translateAll: async () => ({ ok: true, translated: 0, failed: 0, pending: 0 }),
        settle: async () => {},
        onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        arrive(more) {
            Object.assign(fake.dict, more);
            for (const listener of [...listeners]) listener();
        },
    };
    return fake;
}

const texts = (fake: FakeTranslate, index = -1) => fake.scheduled.at(index)?.sources.map((source) => source.text) ?? [];

describe('sheet — translated descriptions', () => {
    it('asks for the list’s English on opening as the user’s action, then shows the Russian that arrives', async () => {
        const translate = fakeTranslate();
        h = harness({ translate });
        const body = h.open();
        const sub = () =>
            body.querySelector('.dramatis-sheet-row[data-id="ilva"] .dramatis-sheet-row-sub')?.textContent;
        expect(sub()).toBe('innkeeper');
        expect(translate.scheduled).toHaveLength(1);
        expect(translate.scheduled[0]).toMatchObject({ interactive: true });
        expect(translate.scheduled[0]!.sources).toContainEqual({ text: 'innkeeper', who: 'Ильва (she)' });

        translate.arrive({ innkeeper: 'трактирщица' });
        expect(sub()).toBe('трактирщица');
        // Everything on screen is translated now: nothing more is asked.
        expect(translate.scheduled).toHaveLength(1);
    });

    it('keeps the stored English in the fields with the Russian as a hint; names and Russian stay as they are', () => {
        const translate = fakeTranslate({
            "a rebel's widow who keeps the inn to spite the occupiers":
                'вдова повстанца, держит трактир назло оккупантам',
            bluntness: 'прямота',
            innkeeper: 'трактирщица',
            Ilva: 'Ильва',
        });
        h = harness({ translate });
        const ilva = profileOf(h.engine!, 'ilva');
        ilva.english = 'Ilva';
        ilva.aliases = ['Holm'];
        ilva.core.want = 'Чтобы имперцы ушли из города';
        const body = h.open({ character: 'ilva' });

        expect(body.querySelector('.dramatis-sheet-page-head .dramatis-muted')?.textContent).toBe('трактирщица');
        const concept = byKey<HTMLTextAreaElement>(body, 'ilva:core.concept');
        expect(concept.value).toBe("a rebel's widow who keeps the inn to spite the occupiers");
        const hint = concept.nextElementSibling as HTMLElement;
        expect(hint.classList.contains('dramatis-translation')).toBe(true);
        expect(hint.textContent).toBe('вдова повстанца, держит трактир назло оккупантам');
        expect(hint.getAttribute('lang')).toBe('ru');
        expect(hint.title).toMatch(/сохранённый текст/);

        // A list item: the hint goes under the row, the field keeps the English.
        const tactic = byKey<HTMLInputElement>(body, 'ilva:core.tactics.0');
        expect(tactic.value).toBe('bluntness');
        expect(tactic.parentElement!.nextElementSibling?.textContent).toBe('прямота');

        // The name fields are names; the Russian want is the user's own words.
        expect(
            byKey<HTMLInputElement>(body, 'ilva:english').nextElementSibling?.classList.contains(
                'dramatis-translation',
            ),
        ).not.toBe(true);
        const want = byKey<HTMLTextAreaElement>(body, 'ilva:core.want');
        expect(want.nextElementSibling?.classList.contains('dramatis-translation')).not.toBe(true);
        const asked = texts(translate);
        expect(asked).not.toContain('Чтобы имперцы ушли из города');
        expect(asked).not.toContain('Ilva');
        expect(asked).not.toContain('Holm');
        expect(asked).toContain('silence');
        expect(translate.scheduled.at(-1)!.sources).toContainEqual({ text: 'silence', who: 'Ильва (she)' });
        expect(translate.scheduled.at(-1)!.interactive).toBe(true);
    });

    it('shows live reasons and the English parts of the story log in Russian', () => {
        const translate = fakeTranslate({ 'an imperial': 'имперец', 'paid generously': 'заплатил щедро' });
        h = harness({ translate });
        h.engine!.state.log = [
            {
                turn: 2,
                character: 'ilva',
                kind: 'reason',
                text: 'Ильва → Курьер: новая причина «paid generously» (теплее)',
            },
        ];
        h.slice.tab = 'ties';
        const body = h.open({ character: 'ilva' });
        const reasons = [...body.querySelectorAll('.dramatis-sheet-reason-text')].map((node) => node.textContent);
        expect(reasons).toContain('имперец');
        buttonByText(body, 'История').click();
        expect(body.querySelector('.dramatis-sheet-log-text')?.textContent).toBe(
            'Ильва → Курьер: новая причина «заплатил щедро» (теплее)',
        );
    });

    it('asks in the background when a change it did not ask for re-renders the window', async () => {
        const translate = fakeTranslate();
        h = harness({ translate });
        h.open({ character: 'ilva' });
        expect(translate.scheduled.at(-1)!.interactive).toBe(true);
        await h.engine!.updateState((state) => {
            state.characters.ilva!.scene = { attention: 'business', doing: 'polishing the mugs' };
        });
        await flush();
        expect(translate.scheduled.at(-1)!.interactive).toBe(false);
        // A click is the user's again.
        buttonByText(h.body(), 'Сейчас').click();
        expect(translate.scheduled.at(-1)!.interactive).toBe(true);
        expect(texts(translate)).toContain('polishing the mugs');
    });

    it('shows the stored text and asks nothing while descriptions are shown in English', () => {
        const translate = fakeTranslate({ innkeeper: 'трактирщица' });
        translate.lang = 'en';
        h = harness({ translate });
        const body = h.open({ character: 'ilva' });
        expect(body.querySelector('.dramatis-sheet-page-head .dramatis-muted')?.textContent).toBe('innkeeper');
        expect(body.querySelector('.dramatis-translation')).toBeNull();
        expect(translate.scheduled).toHaveLength(0);
    });

    it('works as before without the translate module', () => {
        h = harness();
        const body = h.open({ character: 'ilva' });
        expect(body.querySelector('.dramatis-sheet-page-head .dramatis-muted')?.textContent).toBe('innkeeper');
        expect(body.querySelector('.dramatis-translation')).toBeNull();
    });
});
