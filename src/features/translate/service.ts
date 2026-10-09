// The translator behind TranslateApi: lookups from the current card's cache (store.ts), and runs that send the
// untranslated strings of what is shown to the background model in batches (one request per batch, the strict JSON
// schema {items:[{id, ru}]}), store what comes back and tell the listeners.
//
// Background and interactive (docs/guide/settings.md «Описания в окнах»):
// - background runs (describe() for Maestro's DES tab, the scene after a pass, the sheet re-rendered by a change it did
//   not ask for) go through Maestro with `background: true`: only in the chat's leading tab and under the daily cap.
//   Without Maestro they do not run (a background task needs it, as every Dramatis background task does). A refusal
//   pauses background runs for a minute.
// - interactive runs (the sheet the user opened or clicked through, «Перевести сейчас») are his action: `background:
//   false` — Maestro's profile without the leader/cap checks, or Dramatis' own connection profile without Maestro.
// Re-entrancy: a string being translated is not asked again by another run; a string the model failed is not asked
// again for FAILED_COOLDOWN_MS (only «Перевести сейчас» retries it), so a page that re-renders cannot loop.
import {
    TRANSLATE_SCHEMA,
    TRANSLATE_SCHEMA_NAME,
    TRANSLATE_TASK,
    buildBatches,
    cardSources,
    displayLanguage,
    nameHints,
    needsTranslation,
    parseTranslations,
    translateMaxTokens,
    translateMessages,
    translationKey,
} from '../../domain/translate';
import type { BatchItem, DisplayLanguage, TranslationSource } from '../../domain/translate';
import type { App, LlmResult, Logger, Unsubscribe } from '../../shared/contracts';
import { ENGINE_API } from '../engine/api';
import type { EngineApi } from '../engine/api';
import type { ScheduleOptions, TranslateApi, TranslateOutcome } from './api';
import { createTranslationStore } from './store';
import type { TranslationStore } from './store';

/** A string the model left untranslated is not asked again for this long (except «Перевести сейчас»). */
export const FAILED_COOLDOWN_MS = 10 * 60_000;
/** Background runs wait this long after Maestro refused one (another tab leads, the daily cap, no profile…). */
export const REFUSED_PAUSE_MS = 60_000;
/** Batches a background run sends at most (the rest waits for the next occasion). */
export const BACKGROUND_BATCHES = 3;
/** Batches a run for the sheet on screen sends at most. */
export const INTERACTIVE_BATCHES = 6;

/** Errors that stop a run: the next batch would not get through either. */
const STOP_ERRORS = new Set([
    'not-leader',
    'cap',
    'needs-maestro',
    'no-profile',
    'no-cm',
    'breaker',
    'aborted',
    'maestro-stopped',
    'bad-task',
    'bad-request',
]);

/** Where the display language comes from: the setting, Maestro's story language or the UI language. */
export type LanguageSource = 'choice' | 'story' | 'ui';

export interface Translator {
    api: TranslateApi;
    languageInfo(): { language: DisplayLanguage; source: LanguageSource };
    /** Translations kept for the current card (0 before its cache is loaded or outside a solo chat). */
    cached(): number;
    /** The chat changed: work for the old card is cancelled, the new card's cache is loaded. */
    chatChanged(): void;
    /** Something the display language depends on changed (the setting, Maestro came or went). */
    changed(): void;
    dispose(): Promise<void>;
}

export interface TranslatorDeps {
    app: App;
    log: Logger;
    store?: TranslationStore;
    now?: () => number;
}

interface Queued {
    producer: () => readonly TranslationSource[];
    interactive: boolean;
    /** When it runs (ms, Date.now()). */
    due: number;
}

interface Sent {
    translated: number;
    failed: number;
    error?: string;
    stop?: boolean;
    costUsd?: number;
}

export function createTranslator(deps: TranslatorDeps): Translator {
    const { app, log } = deps;
    const now = deps.now ?? Date.now;
    const store = deps.store ?? createTranslationStore({ files: app.files, log });
    const listeners = new Set<() => void>();
    const inFlight = new Set<string>();
    /** Key → until when it is not asked again. */
    const failed = new Map<string, number>();
    const running = new Set<Promise<unknown>>();
    /** Scheduled work: each producer runs at its own time (asked again, it waits again — a trailing debounce). */
    const queued: Queued[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let timerDue = 0;
    let pausedUntil = 0;
    let loadingCard: string | null = null;
    let controller = new AbortController();
    let disposed = false;

    function card(): string | null {
        try {
            return app.host.isGroupChat() ? null : app.host.cardKey();
        } catch (error) {
            log.debug('no card key', error);
            return null;
        }
    }

    function languageInfo(): { language: DisplayLanguage; source: LanguageSource } {
        const choice = app.settings.get().textLanguage;
        if (choice === 'ru' || choice === 'en') return { language: choice, source: 'choice' };
        let story: unknown;
        try {
            story = app.maestro.api()?.storyLanguage?.();
        } catch (error) {
            log.debug('Maestro storyLanguage failed', error);
        }
        const language = displayLanguage('auto', story, app.i18n.locale());
        return { language, source: story === 'ru' || story === 'en' ? 'story' : 'ui' };
    }

    const language = (): DisplayLanguage => languageInfo().language;

    function notify(): void {
        for (const listener of [...listeners]) {
            try {
                listener();
            } catch (error) {
                log.warn('translation listener failed', error);
            }
        }
    }

    /** Starts loading the card's cache (lookups answer nothing until it is in; listeners hear when it is). */
    function load(cardKey: string): void {
        if (store.current(cardKey) || loadingCard === cardKey) return;
        loadingCard = cardKey;
        store
            .ensure(cardKey)
            .then((doc) => {
                if (loadingCard === cardKey) loadingCard = null;
                if (!disposed && card() === cardKey && Object.keys(doc.entries).length) notify();
            })
            .catch((error: unknown) => {
                if (loadingCard === cardKey) loadingCard = null;
                log.warn('translations could not be loaded', error);
            });
    }

    function lookup(text: string): string | undefined {
        if (!needsTranslation(text)) return undefined;
        const cardKey = card();
        if (!cardKey) return undefined;
        if (!store.current(cardKey)) {
            load(cardKey);
            return undefined;
        }
        return store.lookup(cardKey, text, now());
    }

    function markFailed(keys: readonly string[]): void {
        const until = now() + FAILED_COOLDOWN_MS;
        for (const key of keys) failed.set(key, until);
        if (failed.size > 5000) {
            const at = now();
            for (const [key, until] of failed) if (until <= at) failed.delete(key);
        }
    }

    /** Why a background run cannot go now, or null. */
    function backgroundBlocked(): string | null {
        if (now() < pausedUntil) return 'paused';
        const api = app.maestro.api();
        if (!api) return 'needs-maestro';
        if (!app.llm.available(TRANSLATE_TASK, true)) return 'unavailable';
        try {
            if (!api.leader.isLeader()) return 'not-leader';
        } catch (error) {
            log.debug('Maestro leader check failed', error);
        }
        return null;
    }

    async function send(cardKey: string, batch: BatchItem[], background: boolean, signal: AbortSignal): Promise<Sent> {
        const view = app.modules.api<EngineApi>(ENGINE_API)?.view();
        const names = nameHints(
            view?.profiles ?? [],
            batch.map((item) => item.text),
        );
        let result: LlmResult<unknown>;
        try {
            result = await app.llm.request<unknown>({
                task: TRANSLATE_TASK,
                messages: translateMessages(batch, names),
                maxTokens: translateMaxTokens(batch),
                temperature: 0.2,
                schema: { name: TRANSLATE_SCHEMA_NAME, schema: TRANSLATE_SCHEMA },
                background,
                signal,
            });
        } catch (error) {
            result = { ok: false, error: `transport: ${error instanceof Error ? error.message : String(error)}` };
        }
        const costUsd = result.costUsd;
        const sent = (value: Sent): Sent => (costUsd === undefined ? value : { ...value, costUsd });
        if (!result.ok) {
            const error = result.error ?? 'failed';
            if (STOP_ERRORS.has(error)) {
                if (background && error !== 'aborted') pausedUntil = now() + REFUSED_PAUSE_MS;
                return sent({ translated: 0, failed: 0, error, stop: true });
            }
            log.debug(`translation batch failed: ${error}`);
            markFailed(batch.map((item) => item.key));
            return sent({ translated: 0, failed: batch.length, error });
        }
        if (disposed || signal.aborted || card() !== cardKey) {
            return sent({ translated: 0, failed: 0, error: 'aborted', stop: true });
        }
        const parsed = parseTranslations(result.data ?? result.text, batch);
        markFailed(parsed.missing);
        for (const item of parsed.translated) failed.delete(item.key);
        if (store.put(cardKey, parsed.translated, now())) notify();
        return sent({ translated: parsed.translated.length, failed: parsed.missing.length });
    }

    async function run(
        sources: readonly TranslationSource[],
        options: { interactive: boolean; retry?: boolean },
    ): Promise<TranslateOutcome> {
        const outcome: TranslateOutcome = { ok: true, translated: 0, failed: 0, pending: 0 };
        if (disposed || language() !== 'ru') return outcome;
        const cardKey = card();
        if (!cardKey || !sources.some((source) => needsTranslation(source?.text))) return outcome;
        const background = !options.interactive;
        if (background) {
            const blocked = backgroundBlocked();
            if (blocked) return { ...outcome, ok: false, error: blocked };
        }
        const signal = controller.signal;
        await store.ensure(cardKey);
        if (options.interactive && (await store.refresh(cardKey, options.retry === true))) notify();
        if (disposed || signal.aborted || card() !== cardKey) return { ...outcome, ok: false, error: 'aborted' };
        const at = now();
        const batches = buildBatches(sources, {
            skip: (key) =>
                store.has(cardKey, key) || inFlight.has(key) || (!options.retry && (failed.get(key) ?? 0) > at),
            maxBatches: options.retry ? undefined : background ? BACKGROUND_BATCHES : INTERACTIVE_BATCHES,
        });
        const keys = batches.flat().map((item) => item.key);
        if (!keys.length) return outcome;
        for (const key of keys) inFlight.add(key);
        try {
            for (const batch of batches) {
                if (disposed || signal.aborted) break;
                const sent = await send(cardKey, batch, background, signal);
                outcome.translated += sent.translated;
                outcome.failed += sent.failed;
                if (sent.costUsd !== undefined) outcome.costUsd = (outcome.costUsd ?? 0) + sent.costUsd;
                if (sent.error) {
                    outcome.ok = false;
                    outcome.error = sent.error;
                }
                if (sent.stop) break;
            }
        } finally {
            for (const key of keys) inFlight.delete(key);
        }
        outcome.pending = keys.length - outcome.translated - outcome.failed;
        if (outcome.pending > 0 && !outcome.error) outcome.error = 'aborted';
        if (outcome.pending > 0 || outcome.failed > 0) outcome.ok = false;
        return outcome;
    }

    function track<T>(job: Promise<T>): Promise<T> {
        const settled = job.then(
            () => undefined,
            (error: unknown) => log.warn('translation run failed', error),
        );
        running.add(settled);
        void settled.then(() => running.delete(settled));
        return job;
    }

    function collect(producers: (() => readonly TranslationSource[])[]): TranslationSource[] {
        return producers.flatMap((producer) => {
            try {
                return [...producer()];
            } catch (error) {
                log.warn('could not gather the strings to translate', error);
                return [];
            }
        });
    }

    function clearQueue(): void {
        queued.length = 0;
        if (timer) clearTimeout(timer);
        timer = null;
    }

    /** Sets the timer for the earliest scheduled entry. */
    function arm(): void {
        if (!queued.length || disposed) return;
        const next = Math.min(...queued.map((entry) => entry.due));
        if (timer && timerDue === next) return;
        if (timer) clearTimeout(timer);
        timerDue = next;
        timer = setTimeout(() => void fire(), Math.max(0, next - Date.now()));
    }

    /** Runs what is due (everything with `all`): the interactive strings first, the background ones without them. */
    function fire(all = false): Promise<void> {
        if (timer) clearTimeout(timer);
        timer = null;
        const at = Date.now();
        const ready = all ? queued.splice(0) : queued.filter((entry) => entry.due <= at);
        if (!all) for (const entry of ready) queued.splice(queued.indexOf(entry), 1);
        arm();
        const interactive = collect(ready.filter((entry) => entry.interactive).map((entry) => entry.producer));
        const own = new Set(interactive.map((source) => translationKey(source.text ?? '')));
        const background = collect(ready.filter((entry) => !entry.interactive).map((entry) => entry.producer)).filter(
            (source) => !own.has(translationKey(source.text ?? '')),
        );
        const jobs: Promise<unknown>[] = [];
        if (interactive.length) jobs.push(track(run(interactive, { interactive: true })));
        if (background.length) jobs.push(track(run(background, { interactive: false })));
        return Promise.all(jobs).then(() => undefined);
    }

    function schedule(producer: () => readonly TranslationSource[], options: ScheduleOptions = {}): void {
        if (disposed) return;
        const interactive = options.interactive === true;
        const due = Date.now() + Math.max(0, options.delayMs ?? 0);
        const known = queued.find((entry) => entry.producer === producer && entry.interactive === interactive);
        if (known) known.due = due;
        else queued.push({ producer, interactive, due });
        arm();
    }

    async function settle(): Promise<void> {
        if (queued.length) await fire(true);
        while (running.size) await Promise.all([...running]);
    }

    async function translateAll(): Promise<TranslateOutcome> {
        const empty: TranslateOutcome = { ok: true, translated: 0, failed: 0, pending: 0 };
        if (language() !== 'ru') return { ...empty, error: 'english' };
        const cardKey = card();
        const engine = app.modules.api<EngineApi>(ENGINE_API);
        const view = engine ? (engine.view() ?? (await engine.ready())) : null;
        if (!cardKey || !view || view.card.card !== cardKey) return { ...empty, ok: false, error: 'no-card' };
        return track(run(cardSources(view.card, view.state), { interactive: true, retry: true }));
    }

    const api: TranslateApi = {
        language,
        display: (text) => (language() === 'ru' ? (lookup(text) ?? text) : text),
        translation: (text) => (language() === 'ru' ? lookup(text) : undefined),
        needs: (text) => needsTranslation(text),
        request: (sources, options = {}) => track(run(sources, { interactive: options.interactive === true })),
        schedule,
        translateAll,
        settle,
        onChange(listener: () => void): Unsubscribe {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };

    return {
        api,
        languageInfo,
        cached: () => {
            const cardKey = card();
            return cardKey ? store.size(cardKey) : 0;
        },
        chatChanged(): void {
            if (disposed) return;
            controller.abort();
            controller = new AbortController();
            clearQueue();
            const cardKey = card();
            if (cardKey) load(cardKey);
            notify();
        },
        changed: () => {
            if (!disposed) notify();
        },
        async dispose(): Promise<void> {
            disposed = true;
            controller.abort();
            clearQueue();
            listeners.clear();
            await store.dispose();
        },
    };
}
