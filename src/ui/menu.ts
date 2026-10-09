// Items of SillyTavern's extensions («wand») menu `#extensionsMenu`, built the way ST's own extensions build theirs:
// `div.list-group-item.flex-container.flexGap5` with a Font Awesome icon (`.extensionsMenuExtensionButton`: ST styles it
// and makes the item keyboard-interactable — Enter clicks it) and a label, in an `.extension_container` of its own.
// ST creates the menu once at start-up, before third-party extensions load; an item added earlier waits for it, and an
// item comes back by itself when ST rebuilds the menu or something else removes it (one observer on the body's own
// children, one on the menu's). A click lets ST close the menu as for its own items. Labels follow the UI language.
import type { I18n, Logger, MenuItemSpec, Unsubscribe } from '../shared/contracts';
import { el } from './dom';

/** ST's extensions menu (public/scripts/templates/wandMenu.html). */
export const EXTENSIONS_MENU_ID = 'extensionsMenu';

interface MenuItem {
    spec: MenuItemSpec;
    root: HTMLElement;
    item: HTMLElement;
    label: HTMLElement;
}

export interface MenuItemsDeps {
    i18n: I18n;
    log: Logger;
}

export class MenuItems {
    private readonly items = new Map<string, MenuItem>();
    private bodyObserver: MutationObserver | null = null;
    private menuObserver: MutationObserver | null = null;
    private observedMenu: HTMLElement | null = null;

    constructor(private readonly deps: MenuItemsDeps) {}

    add(spec: MenuItemSpec): Unsubscribe {
        if (typeof document === 'undefined') return () => {};
        this.items.get(spec.id)?.root.remove();
        const entry = this.build(spec);
        this.items.set(spec.id, entry);
        this.ensure();
        return () => {
            if (this.items.get(spec.id) !== entry) return;
            this.items.delete(spec.id);
            entry.root.remove();
            if (!this.items.size) this.unobserve();
        };
    }

    /** Labels and tooltips follow the UI language. */
    relabel(): void {
        const t = this.deps.i18n.t.bind(this.deps.i18n);
        for (const { spec, item, label } of this.items.values()) {
            label.textContent = t(spec.labelKey);
            if (spec.titleKey) item.setAttribute('title', t(spec.titleKey));
        }
    }

    dispose(): void {
        for (const entry of this.items.values()) entry.root.remove();
        this.items.clear();
        this.unobserve();
    }

    private build(spec: MenuItemSpec): MenuItem {
        const t = this.deps.i18n.t.bind(this.deps.i18n);
        const iconClass = spec.icon.startsWith('fa-') ? spec.icon : `fa-${spec.icon}`;
        const label = el('span', { text: t(spec.labelKey) });
        const item = el(
            'div',
            {
                class: 'list-group-item flex-container flexGap5 interactable dramatis-menu-item',
                title: spec.titleKey ? t(spec.titleKey) : undefined,
                data: { dramatisMenu: spec.id },
                attrs: { role: 'button', tabindex: '0' },
            },
            [
                el('i', {
                    class: ['fa-solid', 'fa-fw', iconClass, 'extensionsMenuExtensionButton'],
                    attrs: { 'aria-hidden': 'true' },
                }),
                label,
            ],
        );
        const run = () => {
            try {
                spec.onClick();
            } catch (error) {
                this.deps.log.error(`menu item ${spec.id} failed`, error);
            }
        };
        item.addEventListener('click', run);
        // ST turns Enter into a click on its interactables; Space is ours.
        item.addEventListener('keydown', (event) => {
            if (event.key !== ' ') return;
            event.preventDefault();
            item.click();
        });
        const root = el('div', { class: 'extension_container', attrs: { id: `dramatis_wand_${spec.id}` } }, [item]);
        return { spec, root, item, label };
    }

    /** Puts every item into the current menu (when there is one) and watches for it being rebuilt or emptied. */
    private ensure(): void {
        if (!this.items.size) return;
        const menu = document.getElementById(EXTENSIONS_MENU_ID);
        if (menu) {
            for (const { root } of this.items.values()) if (root.parentElement !== menu) menu.appendChild(root);
        }
        this.observe(menu);
    }

    private observe(menu: HTMLElement | null): void {
        if (typeof MutationObserver === 'undefined') return;
        try {
            if (!this.bodyObserver && document.body) {
                this.bodyObserver = new MutationObserver(() => this.ensure());
                this.bodyObserver.observe(document.body, { childList: true });
            }
            if (menu === this.observedMenu) return;
            this.menuObserver?.disconnect();
            this.menuObserver = null;
            this.observedMenu = menu;
            if (!menu) return;
            this.menuObserver = new MutationObserver(() => this.ensure());
            this.menuObserver.observe(menu, { childList: true });
        } catch (error) {
            this.deps.log.debug('extensions menu observer failed', error);
        }
    }

    private unobserve(): void {
        this.bodyObserver?.disconnect();
        this.menuObserver?.disconnect();
        this.bodyObserver = null;
        this.menuObserver = null;
        this.observedMenu = null;
    }
}
