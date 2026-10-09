// Dramatis windows: a floating panel at the right edge under ST's top bar (desktop; drag it by the header) or a
// full-screen sheet under the top bar (narrow screens, < 768 px). A window body scrolls on its own. Specs are kept as
// a stack per id: a module's window replaces an earlier one with the same id (the app's placeholder) and the earlier
// one comes back when the module goes away.
import type { I18n, Logger, Unsubscribe, WindowSpec } from '../shared/contracts';
import { button, clear, el } from './dom';

/** Below this viewport width a window becomes a full-screen sheet. */
export const SHEET_BREAKPOINT = 768;
export const DEFAULT_WINDOW_WIDTH = 420;
/**
 * Windows stack from here up, one step per open window: under ST's own panels and top-bar drawers (z-index 3000–3005),
 * like Maestro's windows (2900–2950), so opening an ST drawer covers them.
 */
const BASE_Z = 2900;
/** Part of a moved window that must stay on screen (its header can always be grabbed). */
const KEEP_VISIBLE = 80;

interface OpenWindow {
    id: string;
    spec: WindowSpec;
    params: Record<string, unknown>;
    root: HTMLElement;
    title: HTMLElement;
    body: HTMLElement;
    dispose: Unsubscribe | null;
}

export interface WindowManagerDeps {
    i18n: I18n;
    log: Logger;
}

export function isSheetViewport(): boolean {
    const width = globalThis.innerWidth || document.documentElement?.clientWidth || 1280;
    return width < SHEET_BREAKPOINT;
}

export class WindowManager {
    private readonly specs = new Map<string, WindowSpec[]>();
    private readonly windows = new Map<string, OpenWindow>();
    /** Open windows, back to front. */
    private readonly order: OpenWindow[] = [];
    private readonly onResize = () => this.layoutAll();
    private listening = false;

    constructor(private readonly deps: WindowManagerDeps) {}

    add(spec: WindowSpec): Unsubscribe {
        const stack = this.specs.get(spec.id) ?? [];
        stack.push(spec);
        this.specs.set(spec.id, stack);
        this.refreshOpen(spec.id);
        return () => {
            const list = this.specs.get(spec.id);
            const index = list?.indexOf(spec) ?? -1;
            if (!list || index < 0) return;
            list.splice(index, 1);
            if (list.length === 0) {
                this.specs.delete(spec.id);
                this.close(spec.id);
            } else {
                this.refreshOpen(spec.id);
            }
        };
    }

    has(id: string): boolean {
        return (this.specs.get(id)?.length ?? 0) > 0;
    }

    isOpen(id: string): boolean {
        return this.windows.has(id);
    }

    open(id: string, params: Record<string, unknown> = {}): void {
        const spec = this.current(id);
        if (!spec) {
            this.deps.log.warn(`window ${id} is not registered`);
            return;
        }
        const existing = this.windows.get(id);
        if (existing) {
            existing.params = params;
            if (existing.spec !== spec) existing.spec = spec;
            this.render(existing);
            this.front(existing);
            return;
        }
        const win = this.build(id, spec, params);
        this.windows.set(id, win);
        document.body.appendChild(win.root);
        this.listen();
        this.layout(win);
        this.render(win);
        this.front(win);
        win.root.focus({ preventScroll: true });
    }

    close(id: string): void {
        const win = this.windows.get(id);
        if (!win) return;
        this.windows.delete(id);
        const index = this.order.indexOf(win);
        if (index >= 0) this.order.splice(index, 1);
        this.release(win);
        win.root.remove();
        if (this.windows.size === 0) this.unlisten();
    }

    /** Titles follow the UI language. */
    retitle(): void {
        for (const win of this.windows.values()) {
            const title = this.deps.i18n.t(win.spec.titleKey);
            win.title.textContent = title;
            win.root.setAttribute('aria-label', title);
            win.root.querySelector('.dramatis-window-close')?.setAttribute('title', this.deps.i18n.t('ui.close'));
        }
    }

    dispose(): void {
        for (const id of [...this.windows.keys()]) this.close(id);
        this.specs.clear();
        this.unlisten();
    }

    private current(id: string): WindowSpec | undefined {
        const stack = this.specs.get(id);
        return stack?.[stack.length - 1];
    }

    /** The spec of an open window changed (replaced or restored): render with the current one. */
    private refreshOpen(id: string): void {
        const win = this.windows.get(id);
        const spec = this.current(id);
        if (!win || !spec || win.spec === spec) return;
        win.spec = spec;
        win.title.textContent = this.deps.i18n.t(spec.titleKey);
        this.render(win);
    }

    private build(id: string, spec: WindowSpec, params: Record<string, unknown>): OpenWindow {
        const t = this.deps.i18n.t.bind(this.deps.i18n);
        const title = el('div', { class: 'dramatis-window-title', text: t(spec.titleKey) });
        const close = button({
            icon: 'fa-xmark',
            title: t('ui.close'),
            kind: 'ghost',
            className: 'dramatis-window-close',
            onClick: () => this.close(id),
        });
        const header = el('div', { class: 'dramatis-window-header' }, [title, close]);
        const body = el('div', { class: 'dramatis-window-body', attrs: { tabindex: '-1' } });
        const root = el(
            'div',
            {
                class: 'dramatis-window dramatis-ui',
                data: { window: id },
                attrs: { role: 'dialog', 'aria-label': t(spec.titleKey), tabindex: '-1' },
            },
            [header, body],
        );
        const width = Math.max(280, spec.defaultWidth ?? DEFAULT_WINDOW_WIDTH);
        root.style.setProperty('--dramatis-window-width', `${width}px`);
        const win: OpenWindow = { id, spec, params, root, title, body, dispose: null };
        root.addEventListener('pointerdown', () => this.front(win));
        root.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                this.close(id);
            }
        });
        this.draggable(win, header);
        return win;
    }

    private render(win: OpenWindow): void {
        this.release(win);
        clear(win.body);
        try {
            const dispose = win.spec.render(win.body, win.params);
            win.dispose = typeof dispose === 'function' ? dispose : null;
        } catch (error) {
            this.deps.log.error(`window ${win.id} failed to render`, error);
            win.body.appendChild(
                el('div', { class: 'dramatis-error-text', text: this.deps.i18n.t('ui.window.failed') }),
            );
        }
    }

    private release(win: OpenWindow): void {
        const dispose = win.dispose;
        win.dispose = null;
        if (!dispose) return;
        try {
            dispose();
        } catch (error) {
            this.deps.log.error(`window ${win.id} cleanup failed`, error);
        }
    }

    private front(win: OpenWindow): void {
        const index = this.order.indexOf(win);
        if (index >= 0) this.order.splice(index, 1);
        this.order.push(win);
        this.order.forEach((item, position) => (item.root.style.zIndex = String(BASE_Z + position)));
    }

    private layout(win: OpenWindow): void {
        const sheet = isSheetViewport();
        win.root.classList.toggle('dramatis-window-sheet', sheet);
        if (sheet) {
            // The sheet always fills the screen; on a wide screen again the window starts at the right edge.
            win.root.classList.remove('dramatis-window-moved');
            win.root.style.removeProperty('left');
            win.root.style.removeProperty('top');
            return;
        }
        if (win.root.classList.contains('dramatis-window-moved')) this.clamp(win);
    }

    private layoutAll(): void {
        for (const win of this.windows.values()) this.layout(win);
    }

    private clamp(win: OpenWindow): void {
        const width = globalThis.innerWidth || 1280;
        const height = globalThis.innerHeight || 800;
        const left = Math.min(
            Math.max(parseFloat(win.root.style.left) || 0, KEEP_VISIBLE - win.root.offsetWidth),
            width - KEEP_VISIBLE,
        );
        const top = Math.min(Math.max(parseFloat(win.root.style.top) || 0, 0), height - KEEP_VISIBLE);
        win.root.style.left = `${left}px`;
        win.root.style.top = `${top}px`;
    }

    private draggable(win: OpenWindow, handle: HTMLElement): void {
        handle.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || win.root.classList.contains('dramatis-window-sheet')) return;
            if (event.target instanceof Element && event.target.closest('button')) return;
            const rect = win.root.getBoundingClientRect();
            const dx = event.clientX - rect.left;
            const dy = event.clientY - rect.top;
            win.root.classList.add('dramatis-window-moved');
            win.root.style.left = `${rect.left}px`;
            win.root.style.top = `${rect.top}px`;
            win.root.classList.add('dramatis-window-dragging');
            try {
                handle.setPointerCapture(event.pointerId);
            } catch {
                // Pointer capture is optional (synthetic events in tests).
            }
            const move = (moveEvent: PointerEvent) => {
                win.root.style.left = `${moveEvent.clientX - dx}px`;
                win.root.style.top = `${moveEvent.clientY - dy}px`;
                this.clamp(win);
            };
            const up = () => {
                win.root.classList.remove('dramatis-window-dragging');
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', up);
                handle.removeEventListener('pointercancel', up);
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', up);
            handle.addEventListener('pointercancel', up);
            event.preventDefault();
        });
    }

    private listen(): void {
        if (this.listening) return;
        this.listening = true;
        globalThis.addEventListener?.('resize', this.onResize);
    }

    private unlisten(): void {
        if (!this.listening) return;
        this.listening = false;
        globalThis.removeEventListener?.('resize', this.onResize);
    }
}
