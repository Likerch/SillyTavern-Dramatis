// Types of the intent sheet («Состав / Лист замысла»): its settings slice, the pages it routes between and the shape of
// the intent module's API it calls (typed here: the sheet depends on the interface only, never on the module).
import type { EngineApi, EngineView } from '../engine/api';
import type { Lang } from '../../domain/ladders';
import type { App, DramatisSettings, I18n, Logger } from '../../shared/contracts';

/** The window `/dramatis` opens (app.ts CAST_WINDOW_ID): the sheet replaces the app's placeholder. */
export const CAST_WINDOW = 'cast';
export const SHEET_SLASH = 'dramatis-sheet';

export const INTENT_API = 'intent';

export interface IntentDiffEntry {
    path: string;
    /** Character id; absent or '' for the card level (world tone, rules, reputation, invariants). */
    character?: string;
    /** 'updated' | 'kept-user' | 'kept-locked' (others shown as they come). */
    status: string;
    before?: unknown;
    after?: unknown;
}

export interface IntentReadResult {
    ok: boolean;
    error?: string;
    characters: number;
    warnings: string[];
    diff: IntentDiffEntry[];
    /** A short human summary from the intent module (shown instead of the sheet's own line). */
    message?: string;
    /** The reading did not run (nothing changed in the sources, no connection…); `message` says why. */
    skipped?: boolean;
}

/** `app.modules.api<IntentApi>('intent')`: reading the author's intent (docs/model.md §7). */
export interface IntentApi {
    read(opts?: { force?: boolean }): Promise<IntentReadResult>;
    running(): boolean;
    lastResult(): unknown;
}

export type ListFilter = 'all' | 'present' | 'groups';
export const FILTERS: readonly ListFilter[] = ['all', 'present', 'groups'];

export type SectionId = 'core' | 'appetites' | 'agenda' | 'ties' | 'now' | 'history';
export const SECTIONS: readonly SectionId[] = ['core', 'appetites', 'agenda', 'ties', 'now', 'history'];

/** The module's settings slice: what the window remembers between openings. */
export interface SheetSettings {
    filter: ListFilter;
    tab: SectionId;
}

export type Route =
    | { page: 'list' }
    | { page: 'character'; id: string }
    | { page: 'rules' }
    | { page: 'reputation' }
    | { page: 'invariants' }
    | { page: 'metrics' }
    | { page: 'levers' };

export type SecretsMode = DramatisSettings['secrets'];

/** What a window remembers while it is open: revealed spoilers, open evidence and accordion sections, drafts. */
export interface SheetSession {
    revealed: Set<string>;
    expanded: Set<string>;
    /** Unsaved rule intensity shares (percent) by rule key, while their sum is off. */
    drafts: Map<string, Record<string, number>>;
}

/** Everything a page renderer needs. */
export interface SheetCtx {
    app: App;
    log: Logger;
    t: I18n['t'];
    lang: Lang;
    engine: EngineApi;
    view: EngineView;
    secrets: SecretsMode;
    session: SheetSession;
    settings: SheetSettings;
    /**
     * Free text as the player reads it: the Russian translation when the windows show Russian and it is known, else the
     * text as stored. What it is given is asked for translation after the render (`who`: whom it is about, by default
     * the character of the page).
     */
    tr(text: string | undefined, who?: string): string;
    navigate(route: Route): void;
    /** Re-renders the window (after a local state change). */
    rerender(): void;
    /** Runs a save; a failed one (another tab won, no chat) shows a warning. */
    save(job: Promise<boolean>): Promise<void>;
}
