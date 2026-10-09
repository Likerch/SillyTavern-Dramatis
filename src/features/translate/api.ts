// Display translation for other modules: `app.modules.api<TranslateApi>(TRANSLATE_API)` (the engine's describe(), the
// intent sheet). Absent while the «translate» module is off: callers then show the stored text as it is.
import type { DisplayLanguage, TranslationSource } from '../../domain/translate';
import type { Unsubscribe } from '../../shared/contracts';

export const TRANSLATE_API = 'translate';

/** How long each occasion waits, gathering what else is asked meanwhile (ms). */
export const TRANSLATE_DELAYS = {
    /** The sheet rendered: what is on screen. */
    sheet: 250,
    /** describe() (Maestro's DES tab): it is called again on every change. */
    describe: 800,
    /** A save of the chat state or the card profiles (passes, the intent reading, the generator): the scene. */
    scene: 4000,
} as const;

export type { DisplayLanguage, TranslationSource } from '../../domain/translate';

export interface TranslateOutcome {
    ok: boolean;
    /** Strings translated and stored by this run. */
    translated: number;
    /** Strings the model left without a usable translation. */
    failed: number;
    /** Strings not sent (a refused or failed request stopped the run). */
    pending: number;
    /** 'not-leader', 'cap', 'needs-maestro', 'no-profile', 'parse'… (core/strings llmErrorText words it). */
    error?: string;
    /** What the requests cost, when the connection reports it. */
    costUsd?: number;
}

export interface ScheduleOptions {
    /** The user's own action (the sheet he opened): no leader or cap checks, and the own connection without Maestro. */
    interactive?: boolean;
    /** Waits this long, gathering what else is asked meanwhile (ms). */
    delayMs?: number;
}

export interface TranslateApi {
    /** The language free text is shown in now: 'ru' shows translations, 'en' the text as stored. */
    language(): DisplayLanguage;
    /** For display: the Russian translation when the language is Russian and one is cached, else the text itself. */
    display(text: string): string;
    /** The cached Russian translation of an English text, when the language is Russian (editor hints). */
    translation(text: string): string | undefined;
    /** English free text that a Russian display would translate (Russian text never is). */
    needs(text: string): boolean;
    /** Translates the untranslated ones among these strings now (none twice at a time, recent failures skipped). */
    request(sources: readonly TranslationSource[], options?: ScheduleOptions): Promise<TranslateOutcome>;
    /** The same a moment later, gathered with whatever else is asked meanwhile (the strings are read when it runs). */
    schedule(sources: () => readonly TranslationSource[], options?: ScheduleOptions): void;
    /** Every free text of the current card in this chat («Перевести сейчас»): the user's action, failures retried. */
    translateAll(): Promise<TranslateOutcome>;
    /** Runs what is scheduled now and waits for every running request. */
    settle(): Promise<void>;
    /** Translations arrived, the card's cache loaded, or the display language changed. */
    onChange(listener: () => void): Unsubscribe;
}
