// Author-intent reading (docs/model.md §7) for other modules: `app.modules.api<IntentApi>(INTENT_API)`.
import type { IntentDiff } from '../../domain/intent-apply';

export const INTENT_API = 'intent';

/** One difference a re-read found (a field it updated, or the user's / a locked value it kept). */
export type IntentDiffEntry = IntentDiff;

export interface IntentReadResult {
    ok: boolean;
    /** Human sentence (UI language) when not ok. */
    error?: string;
    /** Cast entries the reading found (characters and groups). */
    characters: number;
    /** Human sentences (UI language): fields dropped without evidence, capped stances, parts that failed… */
    warnings: string[];
    diff: IntentDiffEntry[];
    /** What the notice said (UI language): the summary and the first notes. */
    message?: string;
    /** Not read: the sources did not change since the last reading (only without `force`). */
    skipped?: boolean;
}

export interface IntentApi {
    /**
     * Reads the current card's intent and applies it to its profiles (the user's edits and locks are kept). Without
     * `force` a card whose sources did not change since the last reading is skipped.
     */
    read(options?: { force?: boolean }): Promise<IntentReadResult>;
    /** A reading is in progress. */
    running(): boolean;
    /** The result of the last reading in this session, or null. */
    lastResult(): IntentReadResult | null;
}
