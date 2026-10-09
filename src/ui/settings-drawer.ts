// The Dramatis block in ST's Extensions panel: an inline drawer (like every other extension) in the right column
// #extensions_settings2, holding the settings sections modules add, ordered by `order`. ST opens and closes
// `.inline-drawer` itself through a delegated document listener (script.js), so no handler is needed here.
import type { I18n, Logger, SettingsSection, Unsubscribe } from '../shared/contracts';
import { clear, el } from './dom';

export const SETTINGS_ROOT_ID = 'dramatis-settings';

interface Rendered {
    dispose: Unsubscribe | null;
}

export class SettingsDrawer {
    private readonly sections = new Map<string, SettingsSection>();
    private readonly rendered: Rendered[] = [];
    private root: HTMLElement | null = null;
    private title: HTMLElement | null = null;
    private content: HTMLElement | null = null;

    constructor(
        private readonly i18n: I18n,
        private readonly log: Logger,
    ) {}

    mount(): void {
        if (this.root || typeof document === 'undefined') return;
        const container =
            document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings');
        if (!container) {
            this.log.debug('extensions panel not found; settings drawer not mounted');
            return;
        }
        document.getElementById(SETTINGS_ROOT_ID)?.remove();
        this.title = el('b', { text: this.i18n.t('ui.title') });
        this.content = el('div', { class: 'inline-drawer-content dramatis-settings-content' });
        this.root = el('div', { class: 'extension_container dramatis-ui', attrs: { id: SETTINGS_ROOT_ID } }, [
            el('div', { class: 'inline-drawer' }, [
                el('div', { class: 'inline-drawer-toggle inline-drawer-header' }, [
                    this.title,
                    el('div', { class: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' }),
                ]),
                this.content,
            ]),
        ]);
        container.appendChild(this.root);
        this.render();
    }

    add(section: SettingsSection): Unsubscribe {
        if (this.sections.has(section.id)) this.log.warn(`settings section "${section.id}" replaced`);
        this.sections.set(section.id, section);
        this.render();
        return () => {
            if (this.sections.get(section.id) !== section) return;
            this.sections.delete(section.id);
            this.render();
        };
    }

    /** Builds every section again (sections added or removed, the language changed). */
    render(): void {
        this.release();
        if (!this.content) return;
        if (this.title) this.title.textContent = this.i18n.t('ui.title');
        clear(this.content);
        const ordered = [...this.sections.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
        for (const section of ordered) {
            const body = el('div', { class: 'dramatis-settings-body' });
            this.content.appendChild(
                el('section', { class: 'dramatis-settings-section', data: { section: section.id } }, [
                    el('h4', { class: 'dramatis-settings-title', text: this.i18n.t(section.titleKey) }),
                    body,
                ]),
            );
            try {
                const dispose = section.render(body);
                this.rendered.push({ dispose: typeof dispose === 'function' ? dispose : null });
            } catch (error) {
                this.log.error(`settings section ${section.id} failed to render`, error);
                body.appendChild(el('div', { class: 'dramatis-error-text', text: this.i18n.t('ui.window.failed') }));
            }
        }
    }

    dispose(): void {
        this.release();
        this.sections.clear();
        this.root?.remove();
        this.root = null;
        this.title = null;
        this.content = null;
    }

    private release(): void {
        for (const item of this.rendered.splice(0)) {
            try {
                item.dispose?.();
            } catch (error) {
                this.log.error('settings section cleanup failed', error);
            }
        }
    }
}
