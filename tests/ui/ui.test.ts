// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../../src/core/i18n';
import { CORE_STRINGS } from '../../src/core/strings';
import { UI_STRINGS, createUi } from '../../src/ui';
import type { UiImpl } from '../../src/ui';
import { resetSlashSlots } from '../../src/ui/slash';
import { SHEET_BREAKPOINT } from '../../src/ui/windows';
import { memoryLogger, mockHost } from '../helpers/fakes';
import { FakePopup, POPUP_RESULT, installStMock } from '../helpers/st-mock';
import type { StMock } from '../helpers/st-mock';

let mock: StMock;
let ui: UiImpl;
let locale: 'ru' | 'en' = 'ru';

function makeUi(): UiImpl {
    const i18n = createI18n(() => locale);
    i18n.register(CORE_STRINGS);
    i18n.register(UI_STRINGS);
    i18n.register({
        en: { 'test.window': 'Test', 'test.menu': 'Sheet', 'test.menuHint': 'Opens the sheet' },
        ru: { 'test.window': 'Проба', 'test.menu': 'Лист', 'test.menuHint': 'Открывает лист' },
    });
    return createUi({ host: mockHost(), i18n, log: memoryLogger() });
}

beforeEach(() => {
    mock = installStMock();
    resetSlashSlots();
    locale = 'ru';
    FakePopup.instances = [];
    document.body.innerHTML = '<div id="extensions_settings2"></div>';
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    ui = makeUi();
});

afterEach(() => {
    ui.dispose();
});

describe('strings', () => {
    it('every English key has a Russian translation', () => {
        const i18n = createI18n(() => 'ru');
        i18n.register(CORE_STRINGS);
        i18n.register(UI_STRINGS);
        expect(i18n.missingRussian()).toEqual([]);
        expect(Object.keys(UI_STRINGS.ru).filter((key) => !(key in UI_STRINGS.en))).toEqual([]);
        expect(Object.keys(CORE_STRINGS.ru).filter((key) => !(key in CORE_STRINGS.en))).toEqual([]);
    });
});

describe('windows', () => {
    it('opens a right-side window with a scrolling body and closes it with its cleanup', () => {
        const cleanup = vi.fn();
        ui.addWindow({
            id: 'w',
            titleKey: 'test.window',
            defaultWidth: 500,
            render(container, params) {
                container.textContent = String(params.who);
                return cleanup;
            },
        });
        ui.openWindow('w', { who: 'Марта' });
        const win = document.querySelector<HTMLElement>('[data-window="w"]')!;
        expect(win.querySelector('.dramatis-window-title')?.textContent).toBe('Проба');
        expect(win.querySelector('.dramatis-window-body')?.textContent).toBe('Марта');
        expect(win.classList.contains('dramatis-window-sheet')).toBe(false);
        expect(win.style.getPropertyValue('--dramatis-window-width')).toBe('500px');
        expect(ui.isWindowOpen('w')).toBe(true);

        win.querySelector<HTMLButtonElement>('.dramatis-window-close')!.click();
        expect(cleanup).toHaveBeenCalledOnce();
        expect(document.querySelector('[data-window="w"]')).toBeNull();
    });

    it('re-renders an open window with new params and closes on Escape', () => {
        const renders: unknown[] = [];
        ui.addWindow({ id: 'w', titleKey: 'test.window', render: (_c, params) => void renders.push(params.n) });
        ui.openWindow('w', { n: 1 });
        ui.openWindow('w', { n: 2 });
        expect(renders).toEqual([1, 2]);
        expect(document.querySelectorAll('[data-window="w"]')).toHaveLength(1);
        document
            .querySelector('[data-window="w"]')!
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(ui.isWindowOpen('w')).toBe(false);
    });

    it('becomes a full-screen sheet on narrow screens', () => {
        Object.defineProperty(window, 'innerWidth', { value: SHEET_BREAKPOINT - 1, configurable: true });
        ui.addWindow({ id: 'w', titleKey: 'test.window', render: () => {} });
        ui.openWindow('w');
        expect(document.querySelector('[data-window="w"]')?.classList.contains('dramatis-window-sheet')).toBe(true);
    });

    it('stacks specs: a module window replaces the placeholder and gives it back', () => {
        ui.addWindow({ id: 'cast', titleKey: 'test.window', render: (c) => void (c.textContent = 'placeholder') });
        const off = ui.addWindow({ id: 'cast', titleKey: 'test.window', render: (c) => void (c.textContent = 'real') });
        ui.openWindow('cast');
        const body = () => document.querySelector('[data-window="cast"] .dramatis-window-body')?.textContent;
        expect(body()).toBe('real');
        off();
        expect(body()).toBe('placeholder');
    });

    it('closes a window whose last spec is removed and ignores unknown ids', () => {
        const off = ui.addWindow({ id: 'w', titleKey: 'test.window', render: () => {} });
        ui.openWindow('w');
        off();
        expect(ui.isWindowOpen('w')).toBe(false);
        ui.openWindow('nothing');
        expect(document.querySelector('.dramatis-window')).toBeNull();
    });

    it('shows an error line when a window fails to render', () => {
        ui.addWindow({
            id: 'bad',
            titleKey: 'test.window',
            render: () => {
                throw new Error('x');
            },
        });
        ui.openWindow('bad');
        expect(document.querySelector('[data-window="bad"] .dramatis-error-text')).not.toBeNull();
    });
});

describe('settings drawer', () => {
    it('renders sections by order inside an inline drawer and relabels on language change', () => {
        ui.mount();
        const cleanup = vi.fn();
        ui.addSettingsSection({ id: 'b', titleKey: 'ui.settings.levers', order: 2, render: () => cleanup });
        ui.addSettingsSection({ id: 'a', titleKey: 'ui.settings.general', order: 1, render: () => {} });
        const titles = () =>
            [...document.querySelectorAll('#dramatis-settings .dramatis-settings-title')].map((n) => n.textContent);
        expect(document.querySelector('#extensions_settings2 .inline-drawer .inline-drawer-content')).not.toBeNull();
        expect(titles()).toEqual(['Общие', 'Рычаги']);
        locale = 'en';
        ui.relabel();
        expect(titles()).toEqual(['General', 'Levers']);
        expect(cleanup).toHaveBeenCalled();
    });

    it('removes a section and the whole drawer on dispose', () => {
        ui.mount();
        const off = ui.addSettingsSection({ id: 'a', titleKey: 'ui.settings.general', order: 1, render: () => {} });
        off();
        expect(document.querySelectorAll('#dramatis-settings .dramatis-settings-section')).toHaveLength(0);
        ui.dispose();
        expect(document.querySelector('#dramatis-settings')).toBeNull();
    });
});

describe('notices, confirmations, styles, slash commands', () => {
    it('shows toasts by level with an action button', () => {
        const info = vi.fn();
        const warning = vi.fn();
        (globalThis as unknown as { toastr: Record<string, unknown> }).toastr.info = info;
        (globalThis as unknown as { toastr: Record<string, unknown> }).toastr.warning = warning;
        ui.notice('Готово');
        expect(info).toHaveBeenCalledWith('Готово', 'Dramatis', expect.objectContaining({ timeOut: 5000 }));
        const run = vi.fn();
        ui.notice('Есть вопрос', { level: 'warn', action: { label: 'Открыть', run } });
        const [content, , options] = warning.mock.calls[0] as [HTMLElement, string, { onclick(e: Event): void }];
        const actionButton = content.querySelector('button')!;
        expect(actionButton.textContent).toBe('Открыть');
        options.onclick({ target: actionButton } as unknown as Event);
        expect(run).toHaveBeenCalledOnce();
    });

    it('asks through ST Popup and closes open popups on dispose', async () => {
        const answer = ui.confirm('Удалить?', 'Совсем.');
        const popup = FakePopup.instances[0]!;
        expect(popup.options).toMatchObject({ okButton: 'Да', cancelButton: 'Нет' });
        popup.close(POPUP_RESULT.AFFIRMATIVE);
        expect(await answer).toBe(true);

        const pending = ui.confirm('Ещё?', 'Да или нет');
        ui.dispose();
        expect(await pending).toBe(false);
        expect(FakePopup.instances[1]?.closed).toBe(true);
    });

    it('adds and removes styles', () => {
        const off = ui.style('cast', '.x { color: red; }');
        expect(document.head.querySelector('style[data-dramatis-style="cast"]')?.textContent).toContain('red');
        off();
        expect(document.head.querySelector('style[data-dramatis-style="cast"]')).toBeNull();
    });

    it('routes slash commands and answers after the owner dropped them', async () => {
        const off = ui.addSlashCommand('dramatis-test', 'ui.slash.dramatis', (value) => `got ${value}`);
        const command = mock.slashCommands.get('dramatis-test')!;
        expect(command.helpString).toBe('Открывает окно Dramatis.');
        expect(await command.callback({}, 'x')).toBe('got x');
        off();
        expect(await command.callback({}, 'x')).toBe('Команда /dramatis-test выключена вместе со своим модулем.');
    });
});

describe('extensions menu', () => {
    /** MutationObserver callbacks run after the current task. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const MENU =
        '<div id="extensionsMenu" class="options-content"><div id="sd_wand_container" class="extension_container"></div></div>';
    const items = () => [...document.querySelectorAll<HTMLElement>('[data-dramatis-menu="sheet"]')];

    it('adds an item built like ST’s own ones and runs it on a click and on Space', () => {
        document.body.insertAdjacentHTML('beforeend', MENU);
        const onClick = vi.fn();
        const off = ui.addMenuItem({
            id: 'sheet',
            icon: 'masks-theater',
            labelKey: 'test.menu',
            titleKey: 'test.menuHint',
            onClick,
        });
        const menu = document.getElementById('extensionsMenu')!;
        const container = menu.querySelector<HTMLElement>(':scope > #dramatis_wand_sheet')!;
        expect(container.classList.contains('extension_container')).toBe(true);
        const item = container.querySelector<HTMLElement>(':scope > div.list-group-item.flex-container.flexGap5')!;
        expect(item.querySelector('i.fa-solid.fa-masks-theater.extensionsMenuExtensionButton')).not.toBeNull();
        expect(item.querySelector('span')?.textContent).toBe('Лист');
        expect(item.getAttribute('title')).toBe('Открывает лист');
        expect(item.getAttribute('tabindex')).toBe('0');
        item.click();
        item.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        item.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
        expect(onClick).toHaveBeenCalledTimes(2);
        off();
        expect(menu.querySelector('#dramatis_wand_sheet')).toBeNull();
        expect(menu.querySelector('#sd_wand_container')).not.toBeNull();
    });

    it('waits for the menu, comes back when it is emptied or rebuilt, and follows the language', async () => {
        const off = ui.addMenuItem({ id: 'sheet', icon: 'fa-masks-theater', labelKey: 'test.menu', onClick: () => {} });
        expect(items()).toEqual([]);
        document.body.insertAdjacentHTML('beforeend', MENU);
        await settle();
        expect(items()).toHaveLength(1);
        expect(items()[0]!.closest('#extensionsMenu')).not.toBeNull();

        document.getElementById('extensionsMenu')!.replaceChildren();
        await settle();
        expect(items()).toHaveLength(1);

        document.getElementById('extensionsMenu')!.remove();
        await settle();
        document.body.insertAdjacentHTML('beforeend', MENU);
        await settle();
        expect(items()).toHaveLength(1);
        expect(document.getElementById('extensionsMenu')!.contains(items()[0]!)).toBe(true);

        locale = 'en';
        ui.relabel();
        expect(items()[0]!.querySelector('span')?.textContent).toBe('Sheet');
        expect(items()[0]!.hasAttribute('title')).toBe(false);

        off();
        expect(items()).toEqual([]);
        document.getElementById('extensionsMenu')!.replaceChildren();
        await settle();
        expect(items()).toEqual([]);
    });

    it('replaces an item with the same id and removes everything on dispose', () => {
        document.body.insertAdjacentHTML('beforeend', MENU);
        const first = vi.fn();
        const second = vi.fn();
        const offFirst = ui.addMenuItem({ id: 'sheet', icon: 'book', labelKey: 'test.menu', onClick: first });
        ui.addMenuItem({ id: 'sheet', icon: 'book', labelKey: 'test.menu', onClick: second });
        expect(items()).toHaveLength(1);
        offFirst();
        expect(items()).toHaveLength(1);
        items()[0]!.click();
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledOnce();
        ui.dispose();
        expect(items()).toEqual([]);
        expect(ui.addMenuItem({ id: 'late', icon: 'book', labelKey: 'test.menu', onClick: first })).toBeTypeOf(
            'function',
        );
        expect(document.querySelector('[data-dramatis-menu="late"]')).toBeNull();
    });
});
