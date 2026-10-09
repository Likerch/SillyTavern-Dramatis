// The window controller: routes between the list, a character page and the world pages, re-renders on engine
// changes (keeping the scroll position and the focused control, and never under a field the user is typing in),
// follows the secrets lever and the UI language, switches between tabs and an accordion with the window width, and
// runs the intent reading for the header.
//
// Display translation (features/translate): free text the page shows goes through ctx.tr() and English field values
// get a Russian hint (translation.ts); after each render the strings on screen without a translation are asked for —
// interactive when the render is the user's own doing (opening the window, a page, a tab, a filter, a click: it may use
// the own connection without Maestro and skips Maestro's leader and cap checks), background when a change he did not
// ask for re-rendered it (a pass, another tab, arriving translations). Arriving translations re-render the window.
import type { EngineApi } from '../engine/api';
import { ENGINE_API } from '../engine/api';
import { TRANSLATE_API, TRANSLATE_DELAYS } from '../translate/api';
import type { TranslateApi, TranslationSource } from '../translate/api';
import { chatLevers } from '../../domain/levers';
import { whoOf } from '../../domain/translate';
import type { App, Logger, Unsubscribe } from '../../shared/contracts';
import { clear, el } from '../../ui/dom';
import { KEY_ATTR } from '../../ui/form';
import { isSheetViewport } from '../../ui/windows';
import { takeAuthor } from './edits';
import { renderList } from './list';
import type { IntentPanel } from './list';
import { renderCharacterPage, sectionKey } from './page';
import { emptyState } from './parts';
import { INTENT_API } from './types';
import type { IntentApi, IntentReadResult, ListFilter, Route, SheetCtx, SheetSession, SheetSettings } from './types';
import { renderLevers } from './levers';
import { renderMetrics } from './metrics';
import { annotateFields } from './translation';
import { renderInvariants, renderReputation, renderRules } from './world';

export interface SheetDeps {
    app: App;
    settings: SheetSettings;
    log: Logger;
    /** Intent results by card key: they survive closing the window. */
    results: Map<string, { result: IntentReadResult; taken: Set<number> }>;
    /** Signature of the intent module's last result already shown (or dismissed) per card: not adopted again. */
    seen: Map<string, string>;
}

/** How often the header re-checks an intent reading started elsewhere. */
const INTENT_POLL_MS = 1000;

function isIntentResult(value: unknown): value is IntentReadResult {
    if (!value || typeof value !== 'object') return false;
    const dict = value as Record<string, unknown>;
    return typeof dict.ok === 'boolean' && Array.isArray(dict.diff) && Array.isArray(dict.warnings);
}

function signature(result: IntentReadResult): string {
    try {
        return JSON.stringify(result);
    } catch {
        return String(Date.now());
    }
}

function routeFrom(params: Record<string, unknown>): Route {
    if (typeof params.character === 'string' && params.character) return { page: 'character', id: params.character };
    if (
        params.page === 'rules' ||
        params.page === 'reputation' ||
        params.page === 'invariants' ||
        params.page === 'metrics' ||
        params.page === 'levers'
    ) {
        return { page: params.page };
    }
    return { page: 'list' };
}

export class SheetView {
    private route: Route;
    private readonly session: SheetSession = { revealed: new Set(), expanded: new Set(), drafts: new Map() };
    private readonly offs: Unsubscribe[] = [];
    private engineOff: Unsubscribe | null = null;
    private engineRef: EngineApi | null = null;
    private disposed = false;
    private pending = false;
    private narrow: boolean;
    private intentBusy = false;
    private poll: ReturnType<typeof setTimeout> | null = null;
    private resetScroll = true;
    private waiting = false;
    private translateRef: TranslateApi | null = null;
    private translateOff: Unsubscribe | null = null;
    /** The next render with content is the user's own doing: what it shows may be translated interactively. */
    private byUser = true;
    /** Free text the render in progress showed through ctx.tr(). */
    private shown: TranslationSource[] = [];

    constructor(
        private readonly deps: SheetDeps,
        private readonly container: HTMLElement,
        params: Record<string, unknown>,
    ) {
        this.route = routeFrom(params);
        this.narrow = isSheetViewport();
        this.session.expanded.add(sectionKey(deps.settings.tab));
        const { app } = deps;
        this.offs.push(
            app.settings.onChange((key) => {
                if (key === 'secrets' || key === 'uiLanguage' || key === '*') this.renderSoon();
            }),
        );
        this.offs.push(app.bus.on('chat:changed', () => this.onChatChanged()));
        const onResize = () => {
            const narrow = isSheetViewport();
            if (narrow === this.narrow) return;
            this.narrow = narrow;
            this.renderSoon();
        };
        globalThis.addEventListener?.('resize', onResize);
        this.offs.push(() => globalThis.removeEventListener?.('resize', onResize));
        // Typing: no re-render under a dirty field; it runs once the field is left.
        const onFocusOut = () => {
            if (!this.pending) return;
            setTimeout(() => {
                if (this.pending && !this.typing()) this.render();
            }, 0);
        };
        container.addEventListener('focusout', onFocusOut);
        this.offs.push(() => container.removeEventListener('focusout', onFocusOut));
        this.render();
    }

    dispose(): void {
        this.disposed = true;
        for (const off of this.offs.splice(0)) off();
        this.engineOff?.();
        this.engineOff = null;
        this.translateOff?.();
        this.translateOff = null;
        if (this.poll) clearTimeout(this.poll);
        this.poll = null;
    }

    /* ------------------------------------------------------------------ rendering */

    /** Re-renders now unless the user is typing in a field (then once he leaves it). */
    renderSoon(): void {
        if (this.disposed) return;
        if (this.typing()) {
            this.pending = true;
            return;
        }
        this.render();
    }

    private typing(): boolean {
        const active = document.activeElement;
        return (
            !!active &&
            this.container.contains(active) &&
            (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
            active.dataset.dirty === '1'
        );
    }

    render(): void {
        if (this.disposed) return;
        this.pending = false;
        const active = document.activeElement;
        const focusKey =
            active && this.container.contains(active) ? active.closest(`[${KEY_ATTR}]`)?.getAttribute(KEY_ATTR) : null;
        const scroll = this.resetScroll ? 0 : this.container.scrollTop;
        this.resetScroll = false;
        clear(this.container);
        const root = el('div', { class: ['dramatis-sheet', 'dramatis-ui', this.narrow && 'dramatis-sheet-narrow'] });
        this.container.appendChild(root);
        this.shown = [];
        try {
            for (const node of this.build()) root.appendChild(node);
            this.translateShown(root);
        } catch (error) {
            this.deps.log.error('sheet render failed', error);
            root.appendChild(
                el('div', { class: 'dramatis-error-text', text: this.deps.app.i18n.t('ui.window.failed') }),
            );
        }
        this.container.scrollTop = scroll;
        if (focusKey) {
            const target = [...this.container.querySelectorAll<HTMLElement>(`[${KEY_ATTR}]`)].find(
                (node) => node.getAttribute(KEY_ATTR) === focusKey,
            );
            target?.focus({ preventScroll: true });
        }
    }

    private engine(): EngineApi | null {
        const engine = this.deps.app.modules.api<EngineApi>(ENGINE_API) ?? null;
        if (engine !== this.engineRef) {
            this.engineOff?.();
            this.engineOff = engine ? engine.onChange(() => this.renderSoon()) : null;
            this.engineRef = engine;
        }
        return engine;
    }

    private translator(): TranslateApi | null {
        const api = this.deps.app.modules.api<TranslateApi>(TRANSLATE_API) ?? null;
        if (api !== this.translateRef) {
            this.translateOff?.();
            this.translateOff = api ? api.onChange(() => this.renderSoon()) : null;
            this.translateRef = api;
        }
        return api;
    }

    /** Whom the page is about (a character's page), for the Russian endings of its translations. */
    private routeWho(view: NonNullable<ReturnType<EngineApi['view']>>): string | undefined {
        if (this.route.page !== 'character') return undefined;
        const profile = view.byId.get(this.route.id);
        return profile ? whoOf(profile) : undefined;
    }

    /** Hints under English fields, then asks for what the page shows without a translation yet. */
    private translateShown(root: HTMLElement): void {
        const translate = this.translator();
        const view = this.engineRef?.view();
        if (!translate || !view || translate.language() !== 'ru') return;
        const title = this.deps.app.i18n.t('sheet.translation.hint');
        const shown = [...this.shown, ...annotateFields(root, translate, title, this.routeWho(view))];
        const interactive = this.byUser;
        this.byUser = false;
        if (!shown.some((source) => translate.translation(source.text) === undefined)) return;
        translate.schedule(() => shown, { interactive, delayMs: TRANSLATE_DELAYS.sheet });
    }

    /** Re-renders as the user's own doing (a click, a page). */
    private renderByUser(): void {
        this.byUser = true;
        this.render();
    }

    private intentApi(): IntentApi | undefined {
        return this.deps.app.modules.api<IntentApi>(INTENT_API);
    }

    private build(): HTMLElement[] {
        const { app } = this.deps;
        const t = app.i18n.t.bind(app.i18n);
        const engine = this.engine();
        if (!engine) return [emptyState(t('sheet.empty.noEngine'))];
        if (app.host.isGroupChat()) return [emptyState(t('sheet.empty.group'))];
        const view = engine.view();
        if (!view) {
            if (!app.host.chatId()) return [emptyState(t('sheet.empty.noChat'))];
            this.waitForEngine(engine);
            return [emptyState(t('sheet.empty.loading'))];
        }
        const ctx = this.ctx(engine, view);
        this.watchIntent();
        switch (this.route.page) {
            case 'character':
                return renderCharacterPage(ctx, this.route.id, this.narrow);
            case 'rules':
                return renderRules(ctx);
            case 'reputation':
                return renderReputation(ctx);
            case 'invariants':
                return renderInvariants(ctx);
            case 'metrics':
                return renderMetrics(ctx);
            case 'levers':
                return renderLevers(ctx);
            default:
                return renderList(ctx, this.intentPanel(view.card.card), this.deps.settings.filter, (filter) =>
                    this.setFilter(filter),
                );
        }
    }

    private ctx(engine: EngineApi, view: NonNullable<ReturnType<EngineApi['view']>>): SheetCtx {
        const { app, log, settings } = this.deps;
        const translate = this.translator();
        const pageWho = this.routeWho(view);
        return {
            app,
            log,
            t: app.i18n.t.bind(app.i18n),
            lang: app.i18n.locale(),
            engine,
            view,
            secrets: chatLevers(app.settings.get(), view.state.overrides).secrets,
            session: this.session,
            settings,
            tr: (text, who) => {
                if (!text) return '';
                if (!translate?.needs(text)) return text;
                const about = who ?? pageWho;
                this.shown.push(about ? { text, who: about } : { text });
                return translate.display(text);
            },
            navigate: (route) => this.navigate(route),
            rerender: () => this.renderByUser(),
            save: async (job) => {
                let saved = false;
                try {
                    saved = await job;
                } catch (error) {
                    log.error('sheet save failed', error);
                }
                if (!saved && !this.disposed) {
                    app.ui.notice(app.i18n.t('sheet.saveFailed'), { level: 'warn' });
                    this.renderSoon();
                }
            },
        };
    }

    private waitForEngine(engine: EngineApi): void {
        if (this.waiting) return;
        this.waiting = true;
        void engine
            .ready()
            .catch((error: unknown) => this.deps.log.warn('engine not ready', error))
            .finally(() => {
                this.waiting = false;
                if (engine.view()) this.renderSoon();
            });
    }

    navigate(route: Route): void {
        this.route = route;
        this.resetScroll = true;
        this.renderByUser();
        // The new page starts at its top, focus on its first control.
        this.container.querySelector<HTMLElement>('button, input, select, textarea')?.focus({ preventScroll: true });
    }

    private setFilter(filter: ListFilter): void {
        this.deps.settings.filter = filter;
        this.deps.app.settings.save();
        this.renderByUser();
    }

    private onChatChanged(): void {
        this.route = { page: 'list' };
        this.resetScroll = true;
        this.session.revealed.clear();
        this.session.drafts.clear();
        this.renderSoon();
    }

    /* ------------------------------------------------------------------ the intent reading */

    private intentPanel(card: string): IntentPanel {
        const api = this.intentApi();
        let stored = this.deps.results.get(card);
        if (!stored && api) {
            // A reading run elsewhere (chat preparation): shown once, not again after «Скрыть».
            const last = api.lastResult();
            const lastCard = last && typeof last === 'object' ? (last as { card?: unknown }).card : undefined;
            const sig = isIntentResult(last) ? signature(last) : '';
            if (sig && (lastCard === undefined || lastCard === card) && this.deps.seen.get(card) !== sig) {
                stored = { result: last as IntentReadResult, taken: new Set() };
                this.deps.results.set(card, stored);
                this.deps.seen.set(card, sig);
            }
        }
        return {
            api,
            busy: this.intentBusy,
            result: stored?.result ?? null,
            taken: stored?.taken ?? new Set(),
            read: (force) => this.readIntent(card, force),
            take: (index) => this.takeBack(card, index),
            dismiss: () => {
                this.deps.results.delete(card);
                this.renderByUser();
            },
        };
    }

    private async readIntent(card: string, force: boolean): Promise<void> {
        const api = this.intentApi();
        if (!api || this.intentBusy || api.running()) return;
        this.intentBusy = true;
        this.render();
        let result: IntentReadResult;
        try {
            result = await api.read(force ? { force: true } : undefined);
        } catch (error) {
            this.deps.log.error('intent reading failed', error);
            result = {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
                characters: 0,
                warnings: [],
                diff: [],
            };
        } finally {
            this.intentBusy = false;
        }
        if (!isIntentResult(result)) return;
        this.deps.results.set(card, { result, taken: new Set() });
        this.deps.seen.set(card, signature(result));
        if (!this.disposed) this.render();
    }

    private async takeBack(card: string, index: number): Promise<void> {
        const stored = this.deps.results.get(card);
        const entry = stored?.result.diff[index];
        const engine = this.engine();
        if (!stored || !entry || !engine) return;
        let saved = false;
        try {
            saved = await takeAuthor(engine, entry);
        } catch (error) {
            this.deps.log.error('taking the author value failed', error);
        }
        if (saved) stored.taken.add(index);
        else this.deps.app.ui.notice(this.deps.app.i18n.t('sheet.saveFailed'), { level: 'warn' });
        if (!this.disposed) this.render();
    }

    /** A reading started elsewhere (chat preparation): check again until it ends, then refresh the header. */
    private watchIntent(): void {
        if (this.poll || this.route.page !== 'list') return;
        const api = this.intentApi();
        if (!api?.running() || this.intentBusy) return;
        this.poll = setTimeout(() => {
            this.poll = null;
            if (!this.disposed) this.renderSoon();
        }, INTENT_POLL_MS);
    }
}

/** The window spec's render: one view per opening (params may name a character or a page). */
export function renderSheet(deps: SheetDeps, container: HTMLElement, params: Record<string, unknown>): Unsubscribe {
    const view = new SheetView(deps, container, params);
    return () => view.dispose();
}
