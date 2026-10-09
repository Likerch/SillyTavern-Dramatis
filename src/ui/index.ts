// Dramatis' own UI shell (no Maestro dependency): notices (toastr), confirmations (ST Popup), windows, the settings
// drawer in the Extensions panel, slash commands, items of ST's extensions menu and styles. Everything it adds to the
// page goes away on dispose().
import type { Host, I18n, Logger, SettingsSection, Ui, Unsubscribe, WindowSpec } from '../shared/contracts';
import { el, setButtonErrorHandler } from './dom';
import { MenuItems } from './menu';
import { SettingsDrawer } from './settings-drawer';
import { SlashCommands } from './slash';
import { WindowManager } from './windows';

export { UI_STRINGS } from './strings';
export { generalSettingsSection, GENERAL_SECTION_ID } from './general-settings';
export { button, clear, el, icon } from './dom';
export { field, numberInput, select, toggle } from './controls';

export interface UiDeps {
    host: Host;
    i18n: I18n;
    log: Logger;
}

export interface UiImpl extends Ui {
    /** Puts the settings drawer into the Extensions panel. */
    mount(): void;
    /** Re-renders what shows translated text (the UI language changed). */
    relabel(): void;
    isWindowOpen(id: string): boolean;
    dispose(): void;
}

interface PopupHandle {
    show(): Promise<unknown>;
    completeCancelled(): Promise<unknown>;
}

type ToastLevel = 'info' | 'warning' | 'error';
const TOAST: Record<'info' | 'warn' | 'error', ToastLevel> = { info: 'info', warn: 'warning', error: 'error' };

export function createUi(deps: UiDeps): UiImpl {
    const { host, i18n, log } = deps;
    const windows = new WindowManager({ i18n, log: log.scope('windows') });
    const drawer = new SettingsDrawer(i18n, log.scope('settings'));
    const slash = new SlashCommands(host, i18n, log.scope('slash'));
    const menu = new MenuItems({ i18n, log: log.scope('menu') });
    const styles = new Map<string, HTMLStyleElement>();
    const popups = new Set<PopupHandle>();
    let disposed = false;

    setButtonErrorHandler((error) => log.error('button action failed', error));

    return {
        notice(text, options = {}): void {
            if (disposed) return;
            const notifier = (globalThis as { toastr?: typeof toastr }).toastr;
            if (!notifier) {
                log.info(text);
                return;
            }
            const level = options.level ?? 'info';
            const action = options.action;
            const toastOptions: Record<string, unknown> = {
                timeOut: level === 'error' ? 15000 : level === 'warn' || action ? 8000 : 5000,
                extendedTimeOut: 5000,
            };
            let message: string | HTMLElement = text;
            if (action) {
                // The action is a real button on the toast: a click elsewhere only closes it.
                const actionButton = el('button', {
                    class: ['menu_button', 'dramatis-toast-action'],
                    text: action.label,
                    attrs: { type: 'button' },
                });
                message = el('span', { class: 'dramatis-toast' }, [
                    el('span', { class: 'dramatis-toast-text', text }),
                    actionButton,
                ]);
                toastOptions.escapeHtml = false;
                toastOptions.onclick = (event?: Event) => {
                    const target = event?.target;
                    if (!(target instanceof Element) || !target.closest('.dramatis-toast-action')) return;
                    try {
                        action.run();
                    } catch (error) {
                        log.error('notice action failed', error);
                    }
                };
            }
            const show = notifier[TOAST[level]] as (message: unknown, title?: string, options?: unknown) => unknown;
            show(message, i18n.t('ui.title'), toastOptions);
        },

        async confirm(title: string, body: string | HTMLElement): Promise<boolean> {
            if (disposed) return false;
            try {
                const c = host.ctx();
                const content = el('div', { class: 'dramatis-confirm dramatis-ui' }, [
                    el('h3', { class: 'dramatis-confirm-title', text: title }),
                    typeof body === 'string' ? el('div', { class: 'dramatis-confirm-body', text: body }) : body,
                ]);
                const popup = new c.Popup(content, c.POPUP_TYPE.CONFIRM, '', {
                    okButton: i18n.t('ui.confirm.yes'),
                    cancelButton: i18n.t('ui.confirm.no'),
                    leftAlign: true,
                });
                popups.add(popup);
                try {
                    const result = await popup.show();
                    return result === c.POPUP_RESULT.AFFIRMATIVE;
                } finally {
                    popups.delete(popup);
                }
            } catch (error) {
                log.error('confirm failed', error);
                return false;
            }
        },

        addWindow(spec: WindowSpec): Unsubscribe {
            if (disposed) return () => {};
            return windows.add(spec);
        },

        openWindow(id: string, params?: Record<string, unknown>): void {
            if (disposed) return;
            windows.open(id, params ?? {});
        },

        closeWindow(id: string): void {
            windows.close(id);
        },

        isWindowOpen(id: string): boolean {
            return windows.isOpen(id);
        },

        addSettingsSection(section: SettingsSection): Unsubscribe {
            if (disposed) return () => {};
            return drawer.add(section);
        },

        addSlashCommand(name: string, helpKey: string, callback: (value: string) => string | Promise<string>) {
            if (disposed) return () => {};
            return slash.add(name, helpKey, callback);
        },

        style(id: string, css: string): Unsubscribe {
            if (disposed || typeof document === 'undefined') return () => {};
            let node = styles.get(id);
            if (!node || !node.isConnected) {
                node = el('style', { attrs: { 'data-dramatis-style': id } });
                document.head.appendChild(node);
                styles.set(id, node);
            }
            node.textContent = css;
            const owned = node;
            return () => {
                if (styles.get(id) !== owned) return;
                owned.remove();
                styles.delete(id);
            };
        },

        addMenuItem(item): Unsubscribe {
            if (disposed) return () => {};
            return menu.add(item);
        },

        mount(): void {
            drawer.mount();
        },

        relabel(): void {
            drawer.render();
            windows.retitle();
            menu.relabel();
        },

        dispose(): void {
            if (disposed) return;
            disposed = true;
            // Popup.completeCancelled() resolves show(); closing the dialog element directly would leave it pending.
            for (const popup of [...popups]) void popup.completeCancelled().catch(() => undefined);
            popups.clear();
            windows.dispose();
            drawer.dispose();
            slash.dispose();
            menu.dispose();
            for (const node of styles.values()) node.remove();
            styles.clear();
        },
    };
}
