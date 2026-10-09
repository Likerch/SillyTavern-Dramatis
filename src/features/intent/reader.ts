// The author-intent reading (docs/model.md §7), interactive (the user's button, a new chat): an LLM task that works
// without Maestro on Dramatis' own client.
//
// Sources: every card field and greeting, the persona, the card's lorebook and the CarrotKernel archives of the card's
// character, of the names the lorebook entries carry and of everyone the profiles already know; after the first part
// (the card itself) the archives of the names it found join the remaining parts. The first part is read in two steps
// — a free-text dossier per character, then the structured answer from the sources and the dossier (a dossier that
// fails only costs the step: the part is read in one); every later part is one structured request
// (domain/intent-prompt.ts). The answers are merged and applied (domain/intent-apply.ts — quote checks, provenance,
// anti-softening; fields the user edited or locked stay theirs) and saved through the engine; a reading the user
// asked for (`force`) is a full re-read: what the generator wrote for the characters it reads gives way, and the open
// chat's live copies the story has not touched follow the new profiles. An answer cut off by the token limit is read
// as far as it goes; an empty one says that a reasoning model may have spent it on thoughts.
//
// `intent.sourcesHash` fingerprints the card and its lorebook, not the archives: those are written by the stack itself
// (Maestro «Оформить», BunnyMo) and would keep offering re-reads. A reading whose later part failed keeps what it got
// and stores a marked hash, so the next chat with the card offers to read it again.
import { llmErrorText } from '../../core/strings';
import { parseJsonText, repairJsonText } from '../../core/llm';
import { applyIntent, mergeIntentResults, parseIntentResult } from '../../domain/intent-apply';
import { refreshLiveState } from '../../domain/intent-reread';
import type { ApplyResult } from '../../domain/intent-apply';
import {
    INTENT_TASK,
    chunkIntentSources,
    dossierMessages,
    emptyKnown,
    intentContext,
    intentFingerprint,
    intentMessages,
    intentSchema,
    intentSources,
    knownFromResult,
} from '../../domain/intent-prompt';
import type { CardBookEntry, IntentKnown, IntentPart, StoryLanguage } from '../../domain/intent-prompt';
import type { CardProfiles } from '../../domain/model';
import type { ApiJournalChange } from '../../shared/apis';
import type { App, ArchiveSheet, CardReader, CardSource, Logger } from '../../shared/contracts';
import { ENGINE_API } from '../engine/api';
import type { EngineApi } from '../engine/api';
import type { IntentApi, IntentReadResult } from './api';
import { plural, warningText } from './strings';

/** Journal target of whole-profile snapshots: `ref.card` names the card, `before` is restored on undo. */
export const PROFILES_TARGET = 'dramatis-profiles';
/** The window the result notice opens (the cast sheet). */
export const CAST_WINDOW = 'cast';
/** Appended to the fingerprint of a reading with a failed part. */
export const PARTIAL_MARK = '~partial';
/** Per part (the structured answer of a rich cast with its evidence needs room). */
export const INTENT_MAX_TOKENS = 12000;
export const INTENT_TEMPERATURE = 0.2;
/** The dossier of the first part: compact notes per character. */
export const DOSSIER_MAX_TOKENS = 4000;
export const DOSSIER_TEMPERATURE = 0.3;
/** Names the archive lookup takes at most. */
const MAX_ARCHIVE_NAMES = 300;
/** Notes shown in the notice (all of them are in the result). */
const NOTICE_NOTES = 3;

type PreparableCardReader = CardReader & { prepare?: () => Promise<void> };

/** Errors of a background request that mean «not now» (another tab leads, the daily cap, Maestro restarting). */
const QUIET_ERRORS = new Set(['not-leader', 'cap', 'maestro-stopped']);

export interface ReadOptions {
    force?: boolean;
    /**
     * Started by Dramatis itself (a new chat), not by the user: with Maestro it is background work — the leading tab
     * and the daily cap apply — and «not now» answers stay quiet.
     */
    auto?: boolean;
}

export interface IntentReader extends IntentApi {
    read(options?: ReadOptions): Promise<IntentReadResult>;
    /** The current card and the fingerprint of its sources now (null outside a solo chat). */
    fingerprint(): Promise<{ card: string; hash: string } | null>;
    /** Restores a journal snapshot (Maestro undo of `dramatis-profiles`). */
    undo(change: ApiJournalChange): Promise<boolean>;
    /** Cancels a reading in progress. */
    abort(): void;
}

/** Fingerprint of a card's sources for re-read checks: card fields, greetings, persona and lorebook (no archives). */
export function sourcesFingerprint(card: CardSource, book: readonly CardBookEntry[]): string {
    return intentFingerprint(intentSources(card, { cardBook: book }));
}

function failure(error: string): IntentReadResult {
    return { ok: false, error, characters: 0, warnings: [], diff: [] };
}

function unique(values: readonly string[], max: number): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of values) {
        const value = typeof raw === 'string' ? raw.trim() : '';
        const key = value.toLowerCase();
        if (!value || seen.has(key)) continue;
        seen.add(key);
        out.push(value);
        if (out.length >= max) break;
    }
    return out;
}

/** Names whose archives are worth reading: the card's character, the lorebook's titles and keys, known profiles. */
export function archiveNames(
    card: CardSource,
    book: readonly CardBookEntry[],
    profiles: CardProfiles | null | undefined,
): string[] {
    const names: string[] = [card.name];
    for (const entry of book) names.push(entry.comment, ...entry.keys);
    for (const profile of profiles?.characters ?? [])
        names.push(profile.name, ...profile.aliases, profile.english ?? '');
    return unique(names, MAX_ARCHIVE_NAMES);
}

const sheetKey = (sheet: ArchiveSheet) => `${sheet.book}#${sheet.uid}`;

/** An answer as an object: parsed data, or JSON in the text. */
function answerOf(data: unknown, text: string | undefined): Record<string, unknown> | undefined {
    const value =
        typeof data === 'string' ? parseJsonText(data) : data === undefined && text ? parseJsonText(text) : data;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * What an answer the strict check refused still holds: a whole JSON object that misses a field of the schema (read
 * leniently, like any answer), or one cut off by the token limit, closed where it broke off (`cut`).
 */
function salvageOf(text: string | undefined): { data: Record<string, unknown>; cut: boolean } | undefined {
    if (!text?.trim()) return undefined;
    const whole = parseJsonText(text);
    const complete = !!whole && typeof whole === 'object' && !Array.isArray(whole);
    const value = complete ? whole : repairJsonText(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const data = value as Record<string, unknown>;
    if (!Array.isArray(data.characters) || !data.characters.length) return undefined;
    return { data, cut: !complete };
}

/** The language the story is told in: Maestro's «Язык истории» (1.20+), else the interface language. */
export function storyLanguageOf(app: Pick<App, 'maestro' | 'i18n'>, log?: Logger): StoryLanguage {
    try {
        const told = app.maestro.api()?.storyLanguage?.();
        if (told === 'ru' || told === 'en') return told;
    } catch (error) {
        log?.debug('Maestro storyLanguage failed', error);
    }
    return app.i18n.locale() === 'ru' ? 'ru' : 'en';
}

export function createIntentReader(deps: { app: App; log: Logger }): IntentReader {
    const { app, log } = deps;
    const t = (key: string, params?: Record<string, string | number>) => app.i18n.t(key, params);
    let busy = false;
    let controller: AbortController | null = null;
    let last: IntentReadResult | null = null;

    const engine = (): EngineApi | null => app.modules.api<EngineApi>(ENGINE_API) ?? null;

    async function cardAndBook(): Promise<{ card: CardSource; book: CardBookEntry[]; greeting: number } | null> {
        if (app.host.isGroupChat() || !app.host.cardKey()) return null;
        const reader = app.readers.card as PreparableCardReader;
        if (typeof reader.prepare === 'function') await reader.prepare();
        const card = reader.current();
        if (!card) return null;
        let book: CardBookEntry[] = [];
        try {
            book = await app.readers.lore.cardBook();
        } catch (error) {
            log.warn('the card lorebook could not be read', error);
        }
        let greeting = 0;
        try {
            greeting = reader.greetingIndex();
        } catch (error) {
            log.debug('greeting index unavailable', error);
        }
        return { card, book, greeting };
    }

    async function archivesFor(names: string[]): Promise<ArchiveSheet[]> {
        if (!names.length) return [];
        try {
            return await app.readers.lore.archives(names);
        } catch (error) {
            log.warn('character archives could not be read', error);
            return [];
        }
    }

    /** The profiles of a card as the engine holds them (else as stored). */
    async function profilesOf(cardKey: string): Promise<CardProfiles | null> {
        const view = await engine()?.ready();
        if (view?.card.card === cardKey) return view.card;
        try {
            return await app.profiles.load(cardKey);
        } catch (error) {
            log.warn('profiles could not be loaded', error);
            return null;
        }
    }

    /** Saves through the engine while the card is the open one, else straight to the store. */
    async function saveProfiles(cardKey: string, mutate: (profiles: CardProfiles) => CardProfiles): Promise<boolean> {
        const current = engine();
        if (current && app.host.cardKey() === cardKey) return current.updateProfiles((profiles) => mutate(profiles));
        try {
            const base = await app.profiles.load(cardKey);
            await app.profiles.save(mutate(structuredClone(base)));
            return true;
        } catch (error) {
            log.error('profiles could not be saved', error);
            return false;
        }
    }

    function progress(index: number, total: number): void {
        app.ui.notice(total > 1 ? t('intent.progress', { n: index + 1, total }) : t('intent.progress.one'));
    }

    function summaryOf(counts: { characters: number; groups: number; rules: number }): string {
        const parts: string[] = [];
        if (counts.characters) parts.push(plural(app.i18n, 'intent.n.characters', counts.characters));
        if (counts.groups) parts.push(plural(app.i18n, 'intent.n.groups', counts.groups));
        if (counts.rules) parts.push(plural(app.i18n, 'intent.n.rules', counts.rules));
        return parts.join(', ');
    }

    async function run(
        force: boolean,
        auto: boolean,
        signal: AbortSignal,
    ): Promise<IntentReadResult & { quiet?: boolean }> {
        const background = auto && app.llm.viaMaestro();
        const gathered = await cardAndBook();
        if (!gathered) return failure(t('intent.error.noCard'));
        const { card, book, greeting } = gathered;
        const cardKey = app.host.cardKey() ?? card.avatar;
        const current = await profilesOf(cardKey);
        const hash = sourcesFingerprint(card, book);
        if (!force && current?.intent?.sourcesHash === hash) {
            return { ok: true, skipped: true, characters: 0, warnings: [], diff: [], message: t('intent.upToDate') };
        }

        const asked = new Set<string>();
        const lookup = async (names: string[]) => {
            const fresh = names.filter((name) => !asked.has(name.toLowerCase()));
            for (const name of fresh) asked.add(name.toLowerCase());
            return archivesFor(fresh);
        };
        let archives = await lookup(archiveNames(card, book, current));
        let sources = intentSources(card, { archives, cardBook: book, greeting });
        let chunks = chunkIntentSources(sources);
        if (!chunks.parts.length) return failure(t('intent.error.empty'));
        const context = intentContext(sources);
        const schema = intentSchema();
        const fidelity = app.settings.get().fidelity;
        const storyLanguage = storyLanguageOf(app, log);
        const results: unknown[] = [];
        const notes: string[] = [];
        let known: IntentKnown = emptyKnown();
        let partial = false;

        /**
         * Step 1 of the card's own part: the dossier (plain text). A failure costs only the step — the part is read in
         * one — unless it is a «not now» (another tab leads, the daily cap): then the reading stops here.
         */
        const dossierFor = async (part: IntentPart): Promise<{ text: string; stop?: string }> => {
            const response = await app.llm.request<unknown>({
                task: INTENT_TASK,
                messages: dossierMessages(part, {
                    cardName: card.name,
                    personaName: card.persona.name,
                    storyLanguage,
                }),
                maxTokens: DOSSIER_MAX_TOKENS,
                temperature: DOSSIER_TEMPERATURE,
                background,
                signal,
            });
            const text = typeof response.data === 'string' ? response.data : (response.text ?? '');
            if (response.ok && text.trim()) return { text: text.trim() };
            if (!response.ok && QUIET_ERRORS.has(response.error ?? '')) return { text: '', stop: response.error };
            if (!signal.aborted) {
                const error = llmErrorText(app.i18n, response.ok ? 'empty' : response.error);
                notes.push(t('intent.warning.dossierFailed', { error }));
                log.warn('the intent dossier failed', response.error ?? 'empty');
            }
            return { text: '' };
        };

        for (let index = 0; index < chunks.parts.length; index++) {
            const part = chunks.parts[index]!;
            const total = chunks.parts.length;
            progress(index, total);
            const step = part.core ? await dossierFor(part) : { text: '' };
            if (signal.aborted) return failure(llmErrorText(app.i18n, 'aborted'));
            if (step.stop) return { ...failure(llmErrorText(app.i18n, step.stop)), ...(auto ? { quiet: true } : {}) };
            const dossier = step.text;
            const response = await app.llm.request<unknown>({
                task: INTENT_TASK,
                messages: intentMessages(part, known, {
                    cardName: card.name,
                    personaName: card.persona.name,
                    total,
                    context,
                    fidelity,
                    storyLanguage,
                    ...(dossier ? { dossier } : {}),
                }),
                maxTokens: INTENT_MAX_TOKENS,
                temperature: INTENT_TEMPERATURE,
                schema: { name: schema.name, schema: schema.schema },
                background,
                signal,
            });
            if (signal.aborted) return failure(llmErrorText(app.i18n, 'aborted'));
            let data = response.ok ? answerOf(response.data, response.text) : undefined;
            if (!data && (response.ok || response.error === 'parse')) {
                // A field short of the schema, or cut off by the token limit: what came is still the reading.
                const salvaged = salvageOf(response.text);
                data = salvaged?.data;
                if (salvaged?.cut) notes.push(t('intent.warning.truncated', { n: index + 1, total }));
            }
            if (!data) {
                const empty = (response.ok || response.error === 'parse') && !response.text?.trim();
                const error = empty
                    ? t('intent.error.emptyAnswer')
                    : llmErrorText(app.i18n, response.ok ? 'parse' : response.error);
                if (index === 0) {
                    return {
                        ...failure(error),
                        ...(auto && QUIET_ERRORS.has(response.error ?? '') ? { quiet: true } : {}),
                    };
                }
                notes.push(t('intent.warning.partFailed', { n: index + 1, total, error }));
                partial = true;
                continue;
            }
            results.push(data);
            known = knownFromResult(known, data);
            if (index === 0 && part.core) {
                // Archives of the people the card itself named join the remaining parts.
                const found = await lookup(unique([...known.characters, ...known.groups], MAX_ARCHIVE_NAMES));
                const added = found.filter((sheet) => !archives.some((other) => sheetKey(other) === sheetKey(sheet)));
                if (added.length) {
                    archives = [...archives, ...added];
                    sources = intentSources(card, { archives, cardBook: book, greeting });
                    chunks = chunkIntentSources(sources);
                }
            }
        }
        if (chunks.skipped.length) notes.push(t('intent.warning.skipped', { n: chunks.skipped.length }));

        const options = {
            fidelity,
            now: Date.now(),
            sourcesHash: partial ? `${hash}${PARTIAL_MARK}` : hash,
            sources,
            personaName: card.persona.name,
            cardName: card.name,
            replaceGenerated: force,
        };
        const out: { applied?: ApplyResult; before?: CardProfiles } = {};
        const saved = await saveProfiles(cardKey, (profiles) => {
            out.before = structuredClone(profiles);
            out.applied = applyIntent(profiles, results, options);
            return out.applied.profiles;
        });
        if (!saved || !out.applied || !out.before) return failure(t('intent.error.save'));
        await refreshChat(cardKey, out.before, out.applied.profiles);

        const merged = mergeIntentResults(
            results.map((result) =>
                parseIntentResult(result, { sources, cardName: card.name, personaName: card.persona.name }),
            ),
        );
        const counts = {
            characters: merged.characters.filter((item) => item.kind !== 'group').length,
            groups: merged.characters.filter((item) => item.kind === 'group').length,
            rules: merged.rules.length,
        };
        const warnings = unique(
            [...notes, ...out.applied.warnings.map((warning) => warningText(app.i18n, warning))],
            Number.MAX_SAFE_INTEGER,
        );
        const summary = summaryOf(counts);
        await record(cardKey, summary, out.before, out.applied.profiles);

        let text = summary ? t('intent.done', { summary }) : t('intent.done.nobody');
        if (warnings.length) {
            const shown = warnings.slice(0, NOTICE_NOTES).join('; ');
            const list = warnings.length > NOTICE_NOTES ? `${shown}; …` : shown;
            text = `${text} ${t('intent.done.warnings', { count: warnings.length, list })}`;
        }
        if (warnings.length) log.info('intent reading notes', warnings);
        app.ui.notice(text, {
            level: partial ? 'warn' : 'info',
            action: { label: t('intent.done.open'), run: () => app.ui.openWindow(CAST_WINDOW) },
        });
        return {
            ok: true,
            characters: counts.characters + counts.groups,
            warnings,
            diff: out.applied.diff,
            message: text,
        };
    }

    /**
     * The open chat of this card copied the old profiles into its live state: what the story has not touched there
     * follows the new reading (ties, agenda, resting mood, appetites).
     */
    async function refreshChat(cardKey: string, before: CardProfiles, after: CardProfiles): Promise<void> {
        const current = engine();
        if (!current || app.host.cardKey() !== cardKey || !current.view()) return;
        const changed = after.characters.filter((profile) => {
            const old = before.characters.find((item) => item.id === profile.id);
            return !old || JSON.stringify(old) !== JSON.stringify(profile);
        });
        if (!changed.length) return;
        try {
            await current.updateState((state) => {
                if (state.card !== cardKey) return;
                for (const profile of changed) {
                    const live = state.characters[profile.id];
                    if (!live) continue;
                    const old = before.characters.find((item) => item.id === profile.id);
                    state.characters[profile.id] = refreshLiveState(live, old, profile);
                }
            });
        } catch (error) {
            log.warn('the chat could not take the new reading over', error);
        }
    }

    /** Maestro's journal entry with a whole-profiles snapshot (undo restores `before`). */
    async function record(cardKey: string, summary: string, before: CardProfiles, after: CardProfiles): Promise<void> {
        const api = app.maestro.api();
        if (!api) return;
        try {
            await api.journal.record({
                kind: INTENT_TASK,
                summary: t('intent.journal', { summary: summary || '—' }),
                changes: [{ target: PROFILES_TARGET, ref: { card: cardKey }, before, after }],
            });
        } catch (error) {
            log.warn('the reading could not be recorded in Maestro’s journal', error);
        }
    }

    return {
        async read(options: ReadOptions = {}): Promise<IntentReadResult> {
            if (busy) {
                const result = failure(t('intent.error.busy'));
                app.ui.notice(result.error!, { level: 'warn' });
                return result;
            }
            busy = true;
            const abort = new AbortController();
            controller = abort;
            let result: IntentReadResult & { quiet?: boolean };
            try {
                result = await run(options.force === true, options.auto === true, abort.signal);
            } catch (error) {
                log.error('intent reading failed', error);
                result = failure(
                    t('intent.error.unexpected', { error: error instanceof Error ? error.message : String(error) }),
                );
            } finally {
                busy = false;
                if (controller === abort) controller = null;
            }
            const { quiet, ...outcome } = result;
            last = outcome;
            if (!outcome.ok && !quiet)
                app.ui.notice(t('intent.failed', { error: outcome.error ?? '?' }), { level: 'error' });
            return outcome;
        },

        running: () => busy,

        lastResult: () => last,

        async fingerprint(): Promise<{ card: string; hash: string } | null> {
            const gathered = await cardAndBook();
            const cardKey = app.host.cardKey();
            if (!gathered || !cardKey) return null;
            return { card: cardKey, hash: sourcesFingerprint(gathered.card, gathered.book) };
        },

        async undo(change: ApiJournalChange): Promise<boolean> {
            const card = (change.ref as { card?: unknown } | undefined)?.card;
            const before = change.before as CardProfiles | undefined;
            if (typeof card !== 'string' || !card || !before || !Array.isArray(before.characters)) return false;
            return saveProfiles(card, () => ({ ...structuredClone(before), card }));
        },

        abort(): void {
            controller?.abort();
        },
    };
}
