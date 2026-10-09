// @vitest-environment happy-dom
// The intent sheet: strings, the cast list and the character page over the tavern and raid fixtures, empty states,
// /dramatis-sheet.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createI18n } from '../../../src/core/i18n';
import { emptyCardProfiles } from '../../../src/domain/profile-defaults';
import { SHEET_STRINGS } from '../../../src/features/sheet/strings';
import { chat, raid } from '../../domain/cast-fixtures';
import { FakePopup, POPUP_RESULT } from '../../helpers/st-mock';
import { buttonByText, byKey, fakeEngine, flush, harness, profileOf } from './harness';
import type { Harness } from './harness';

let h: Harness | null = null;

afterEach(async () => {
    await h?.dispose();
    h = null;
    FakePopup.instances = [];
});

function rowOf(body: HTMLElement, id: string): HTMLElement {
    const row = body.querySelector<HTMLElement>(`.dramatis-sheet-row[data-id="${id}"]`);
    if (!row) throw new Error(`no row ${id}`);
    return row;
}

describe('strings', () => {
    it('has every key in both languages', () => {
        const i18n = createI18n(() => 'ru');
        i18n.register(SHEET_STRINGS);
        expect(i18n.missingRussian()).toEqual([]);
        expect(Object.keys(SHEET_STRINGS.ru).filter((key) => !(key in SHEET_STRINGS.en))).toEqual([]);
    });

    it('defines every literal key the module uses', () => {
        const dir = join(__dirname, '../../../src/features/sheet');
        const used = new Set<string>();
        for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
            const text = readFileSync(join(dir, file), 'utf8');
            for (const match of text.matchAll(/'(sheet\.[A-Za-z0-9_.-]+)'/g)) used.add(match[1]!);
        }
        expect(used.size).toBeGreaterThan(100);
        expect([...used].filter((key) => !(key in SHEET_STRINGS.en))).toEqual([]);
    });
});

describe('the cast list', () => {
    it('lists the tavern: name, detail level, presence, attention band and stance toward the player', () => {
        h = harness();
        const body = h.open();
        expect(document.querySelector('[data-window="cast"] .dramatis-window-title')?.textContent).toBe('Лист замысла');
        expect(body.querySelector('.dramatis-sheet-title')?.textContent).toBe('Трактир');
        expect(body.querySelector('.dramatis-sheet-counts')?.textContent).toBe('Персонажей: 4 · групп: 1 · в сцене: 5');
        const rows = [...body.querySelectorAll<HTMLElement>('.dramatis-sheet-row')].map((row) => row.dataset.id);
        expect(rows).toEqual(['ilva', 'bram', 'sota', 'carters', 'fenn']);

        const ilva = rowOf(body, 'ilva');
        expect(ilva.querySelector('.dramatis-sheet-row-open')?.textContent).toBe('Ильва');
        expect(ilva.querySelector('.dramatis-sheet-row-sub')?.textContent).toBe('innkeeper');
        const stance = ilva.querySelector<HTMLElement>('.dramatis-stance')!;
        expect(stance.textContent).toBe('Враждебна');
        expect(stance.dataset.stance).toBe('-2');
        const tags = [...ilva.querySelectorAll('.dramatis-sheet-tag')].map((tag) => tag.textContent);
        expect(tags).toEqual(['Эскиз', 'в сцене', 'По делу']);
        expect(rowOf(body, 'sota').querySelector('[data-band="focus"]')?.textContent).toBe('В фокусе');
        expect(rowOf(body, 'sota').querySelector('.dramatis-stance')?.textContent).toBe('Расположена');
        expect(rowOf(body, 'bram').querySelector('.dramatis-stance')?.textContent).toBe('Нейтрален');
        expect(rowOf(body, 'carters').querySelector('.dramatis-sheet-row-sub')?.textContent).toBe('Группа');
    });

    it('filters by presence and groups, remembering the choice', async () => {
        h = harness();
        h.engine!.present = ['ilva', 'sota', 'carters'];
        const body = h.open();
        buttonByText(body, 'В сцене').click();
        let rows = [...body.querySelectorAll<HTMLElement>('.dramatis-sheet-row')].map((row) => row.dataset.id);
        expect(rows).toEqual(['ilva', 'sota', 'carters']);
        expect(h.slice.filter).toBe('present');
        expect(buttonByText(body, 'В сцене').getAttribute('aria-pressed')).toBe('true');
        buttonByText(body, 'Группы').click();
        rows = [...body.querySelectorAll<HTMLElement>('.dramatis-sheet-row')].map((row) => row.dataset.id);
        expect(rows).toEqual(['carters']);
        buttonByText(body, 'Все').click();
        expect(body.querySelectorAll('.dramatis-sheet-row')).toHaveLength(5);
        // Present first in scene order, then the rest.
        expect(body.querySelector<HTMLElement>('.dramatis-sheet-row:last-child')?.dataset.id).toBe('fenn');
    });

    it('shows the strongest appetite pressure and running schemes of the raid', () => {
        const { profiles, state } = raid();
        const engine = fakeEngine({ ...emptyCardProfiles('ford.png'), characters: profiles }, state, {
            present: ['grukk', 'mira'],
            bands: { grukk: 'business', mira: 'background' },
        });
        h = harness({ engine, secrets: 'open' });
        const body = h.open();
        const grukk = rowOf(body, 'grukk');
        expect(grukk.querySelector('.dramatis-sheet-pressure')?.textContent).toBe('гонит');
        expect(grukk.textContent).toContain('замыслов: 1');
        expect(grukk.querySelector('.dramatis-stance')?.textContent).toBe('Мешает');
        expect(rowOf(body, 'mira').querySelector('.dramatis-sheet-pressure')).toBeNull();
    });

    it('keeps schemes under a spoiler in the list until clicked', () => {
        const { profiles, state } = raid();
        const engine = fakeEngine({ ...emptyCardProfiles('ford.png'), characters: profiles }, state, {
            present: ['grukk'],
        });
        h = harness({ engine, secrets: 'spoiler' });
        const grukk = rowOf(h.open(), 'grukk');
        const box = grukk.querySelector<HTMLElement>('.dramatis-spoiler')!;
        expect(box.classList.contains('dramatis-spoiler-open')).toBe(false);
        expect(box.querySelector('.dramatis-spoiler-content')?.hasAttribute('inert')).toBe(true);
        box.querySelector<HTMLButtonElement>('.dramatis-spoiler-reveal')!.click();
        expect(box.classList.contains('dramatis-spoiler-open')).toBe(true);
        expect(box.textContent).toContain('замыслов: 1');
    });

    it('opens a character on click and comes back', () => {
        h = harness();
        const body = h.open();
        rowOf(body, 'ilva').querySelector<HTMLButtonElement>('.dramatis-sheet-row-open')!.click();
        expect(body.querySelector('.dramatis-sheet-page-head .dramatis-sheet-title')?.textContent).toBe('Ильва');
        buttonByText(body, 'Состав').click();
        expect(body.querySelectorAll('.dramatis-sheet-row')).toHaveLength(5);
    });

    it('adds a character and a group from the list', async () => {
        h = harness();
        const body = h.open();
        const name = byKey<HTMLInputElement>(body, 'add:name');
        name.value = 'Стражник';
        buttonByText(body, 'Добавить персонажа').click();
        await flush();
        const guard = profileOf(h.engine!, 'strazhnik');
        expect(guard).toMatchObject({ name: 'Стражник', kind: 'character', lod: 'sketch' });
        expect(guard.meta.name).toEqual({ origin: 'user', locked: true });
        expect(h.engine!.state.characters.strazhnik).toBeDefined();
        // The new character's page opens.
        expect(body.querySelector('.dramatis-sheet-page-head .dramatis-sheet-title')?.textContent).toBe('Стражник');

        buttonByText(body, 'Состав').click();
        byKey<HTMLInputElement>(body, 'add:name').value = 'Гарнизон';
        buttonByText(body, 'Добавить группу').click();
        await flush();
        expect(profileOf(h.engine!, 'garnizon').kind).toBe('group');
    });
});

describe('the character page', () => {
    it('shows six sections as tabs and remembers the chosen one', () => {
        h = harness();
        const body = h.open({ character: 'ilva' });
        const tabs = [...body.querySelectorAll<HTMLElement>('[role="tab"]')];
        expect(tabs.map((tab) => tab.textContent)).toEqual([
            'Ядро',
            'Влечения',
            'Повестка',
            'Связи',
            'Сейчас',
            'История',
        ]);
        expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
        expect(byKey<HTMLTextAreaElement>(body, 'ilva:core.concept').value).toBe(
            "a rebel's widow who keeps the inn to spite the occupiers",
        );
        tabs[3]!.click();
        expect(h.slice.tab).toBe('ties');
        expect(body.querySelector('[role="tabpanel"]')?.getAttribute('data-section')).toBe('ties');
        // Arrow keys move between tabs.
        body.querySelector('[role="tablist"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        expect(h.slice.tab).toBe('now');
    });

    it('shows ties: the player under his persona name, base and current stance with reasons', () => {
        h = harness();
        h.slice.tab = 'ties';
        const body = h.open({ character: 'ilva' });
        const tie = body.querySelector<HTMLElement>('[data-unit="ties.@player"]')!;
        expect(tie.querySelector('.dramatis-sheet-unit-title')?.textContent).toBe('Курьер (ты)');
        expect(byKey<HTMLSelectElement>(tie, 'ilva:ties.@player.stance').value).toBe('-2');
        expect(byKey<HTMLSelectElement>(tie, 'ilva:ties.@player:current').value).toBe('-2');
        const reasons = [...tie.querySelectorAll('.dramatis-sheet-reason-text')].map((node) => node.textContent);
        expect(reasons).toEqual(['an imperial', 'the Empire hanged her husband', 'paid generously']);
        expect(tie.textContent).toContain('ещё 2 сц.');
        expect(byKey<HTMLTextAreaElement>(tie, 'ilva:ties.@player.behaviour').value).toBe(
            'takes his coin, gives nothing back, never says his name',
        );
        // Ties to the cast follow, by their names.
        const titles = [
            ...body.querySelectorAll('[data-unit^="ties."] > .dramatis-sheet-unit-head .dramatis-sheet-unit-title'),
        ];
        expect(titles.map((node) => node.textContent)).toEqual(['Курьер (ты)', 'Брам', 'Сота']);
    });

    it('lists the history of the character, newest first', () => {
        h = harness();
        h.engine!.state.log = [
            { turn: 1, character: 'ilva', kind: 'stance', text: 'первое' },
            { turn: 2, character: 'bram', kind: 'stance', text: 'чужое' },
            { turn: 3, character: 'ilva', kind: 'mood', text: 'второе' },
        ];
        h.slice.tab = 'history';
        const body = h.open({ character: 'ilva' });
        const lines = [...body.querySelectorAll('.dramatis-sheet-log-text')].map((node) => node.textContent);
        expect(lines).toEqual(['второе', 'первое']);
    });

    it('becomes an accordion on a phone', () => {
        h = harness({ width: 500 });
        const body = h.open({ character: 'ilva' });
        expect(body.querySelector('[role="tablist"]')).toBeNull();
        const heads = [...body.querySelectorAll<HTMLButtonElement>('.dramatis-sheet-acc-head')];
        expect(heads.map((head) => head.textContent)).toEqual([
            'Ядро',
            'Влечения',
            'Повестка',
            'Связи',
            'Сейчас',
            'История',
        ]);
        expect(heads[0]!.getAttribute('aria-expanded')).toBe('true');
        expect(heads[1]!.getAttribute('aria-expanded')).toBe('false');
        heads[4]!.click();
        const now = body.querySelector<HTMLElement>('.dramatis-sheet-acc[data-section="now"] .dramatis-sheet-panel')!;
        expect(byKey<HTMLInputElement>(now, 'ilva:now.scene.doing').value).toBe("counting the week's takings");
        expect(byKey<HTMLElement>(body, 'acc:now').getAttribute('aria-expanded')).toBe('true');
    });

    it('deletes a character after a confirmation', async () => {
        h = harness();
        const body = h.open({ character: 'fenn' });
        body.querySelector<HTMLButtonElement>('.dramatis-btn-danger')!.click();
        await flush();
        FakePopup.instances[0]!.close(POPUP_RESULT.AFFIRMATIVE);
        await flush();
        await flush();
        expect(h.engine!.card.characters.some((profile) => profile.id === 'fenn')).toBe(false);
        expect(h.engine!.state.characters.fenn).toBeUndefined();
        expect(body.querySelectorAll('.dramatis-sheet-row')).toHaveLength(4);
    });
});

describe('empty states', () => {
    it('offers the big «read the intent» button when no one is described yet', () => {
        const engine = fakeEngine(emptyCardProfiles('new.png'), chat({}, { card: 'new.png' }));
        h = harness({ engine });
        const body = h.open();
        const big = body.querySelector<HTMLButtonElement>('.dramatis-sheet-big')!;
        expect(big.textContent).toBe('Прочитать замысел');
        expect(big.disabled).toBe(false);
        expect(body.querySelector('.dramatis-sheet-empty')?.textContent).toContain('ещё никто не описан');
        big.click();
        expect(h.intent!.calls).toEqual([undefined]);
    });

    it('explains a missing engine, a group chat and a missing chat', () => {
        h = harness({ engine: null });
        expect(h.open().textContent).toContain('Движок выключен');
        void h.dispose();

        h = harness();
        h.mock.groupId = 'g1';
        expect(h.open().textContent).toContain('Групповые чаты пока не поддерживаются');
        void h.dispose();

        h = harness();
        h.engine!.noView = true;
        h.mock.chatId = undefined;
        expect(h.open().textContent).toContain('Открой чат с персонажем');
    });

    it('shows the list once a loading chat is ready', async () => {
        h = harness();
        h.engine!.noView = true;
        expect(h.open().textContent).toContain('Загружаю состав');
        h.engine!.noView = false;
        await flush();
        expect(h.body().querySelectorAll('.dramatis-sheet-row')).toHaveLength(5);
    });
});

describe('/dramatis-sheet', () => {
    it('opens a character by name, the list without one, and says when nobody matches', async () => {
        h = harness();
        const command = h.mock.slashCommands.get('dramatis-sheet')!;
        expect(command.helpString).toContain('/dramatis-sheet Ильва');
        expect(await command.callback({}, 'Ильвы')).toBe('');
        expect(h.body().querySelector('.dramatis-sheet-page-head .dramatis-sheet-title')?.textContent).toBe('Ильва');
        expect(await command.callback({}, '')).toBe('');
        expect(h.body().querySelectorAll('.dramatis-sheet-row')).toHaveLength(5);
        expect(await command.callback({}, 'Гэндальф')).toBe('В составе нет никого по имени «Гэндальф».');
    });
});
