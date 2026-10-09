// The translation cache of the current card in memory and on disk: `dramatis-card-<hash(card)>-ru.json` next to the
// card's profiles (`dramatis-card-<hash(card)>.json`), same user-files storage. Lookups are synchronous (describe() and
// the sheet render synchronously): the current card's document is loaded when its chat opens and answers from memory.
// New translations are saved after a short pause; a save first reads the file fresh and merges it (another tab may have
// added its own), and the size stays bounded (the least recently used go first).
import { stableHash } from '../../core/hash';
import {
    emptyTranslations,
    lookupTranslation,
    mergeTranslations,
    readTranslations,
    storeTranslations,
} from '../../domain/translate';
import type { TranslationDoc } from '../../domain/translate';
import type { FileStore, Logger } from '../../shared/contracts';

/** Pause before new translations are written. */
export const SAVE_DELAY_MS = 1500;
/** An interactive run re-reads the file (another tab's translations) at most this often. */
export const REFRESH_MS = 30_000;

export function translationsFile(files: FileStore, card: string): string {
    return files.fileName(`card-${stableHash(card)}-ru`);
}

export interface TranslationStore {
    /** The loaded document of this card, or null (not loaded yet: lookups answer nothing meanwhile). */
    current(card: string): TranslationDoc | null;
    /** Loads the card's document (once; another card's pending save is written first). */
    ensure(card: string): Promise<TranslationDoc>;
    /** Re-reads the file and takes in what another tab added; returns how many entries arrived. */
    refresh(card: string, force?: boolean): Promise<number>;
    lookup(card: string, text: string, now: number): string | undefined;
    has(card: string, key: string): boolean;
    /** Stores translations of the card (loaded); returns how many were new. Saved after SAVE_DELAY_MS. */
    put(card: string, items: readonly { key: string; ru: string }[], now: number): number;
    /** Writes a pending save now. */
    flush(): Promise<void>;
    size(card: string): number;
    dispose(): Promise<void>;
}

export function createTranslationStore(deps: {
    files: FileStore;
    log: Logger;
    saveDelayMs?: number;
}): TranslationStore {
    const { files, log } = deps;
    const delay = deps.saveDelayMs ?? SAVE_DELAY_MS;
    let doc: TranslationDoc | null = null;
    let loading: { card: string; job: Promise<TranslationDoc> } | null = null;
    let dirty = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let saving: Promise<void> = Promise.resolve();
    let refreshed = 0;
    let disposed = false;

    async function read(card: string): Promise<TranslationDoc | null> {
        try {
            const raw = await files.read<unknown>(translationsFile(files, card), { fresh: true });
            return raw === null ? null : readTranslations(raw, card);
        } catch (error) {
            log.warn(`could not read the translations of ${card}`, error);
            return null;
        }
    }

    function save(): Promise<void> {
        if (timer) clearTimeout(timer);
        timer = null;
        if (!dirty || !doc) return saving;
        const target = doc;
        dirty = false;
        saving = saving.then(async () => {
            const theirs = await read(target.card);
            const merged = theirs ? mergeTranslations(target, theirs) : target;
            try {
                await files.write(translationsFile(files, target.card), merged);
            } catch (error) {
                log.warn(`could not save the translations of ${target.card}`, error);
                return;
            }
            // Another tab's entries join the document in memory (when it is still this card's).
            if (theirs && doc === target) doc.entries = { ...merged.entries, ...pick(doc, merged) };
        });
        return saving;
    }

    /** Entries written to `doc` while the save ran (they win over the merged copy). */
    function pick(current: TranslationDoc, merged: TranslationDoc): TranslationDoc['entries'] {
        const out: TranslationDoc['entries'] = {};
        for (const [key, entry] of Object.entries(current.entries)) {
            const other = merged.entries[key];
            if (!other || other.at < entry.at) out[key] = entry;
        }
        return out;
    }

    function later(): void {
        if (disposed) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void save(), delay);
    }

    const store: TranslationStore = {
        current: (card) => (doc && doc.card === card ? doc : null),

        ensure(card: string): Promise<TranslationDoc> {
            if (doc && doc.card === card) return Promise.resolve(doc);
            if (loading?.card === card) return loading.job;
            const job = (async () => {
                await save();
                const loaded = (await read(card)) ?? emptyTranslations(card);
                if (loading?.card === card) {
                    doc = loaded;
                    dirty = false;
                    refreshed = Date.now();
                }
                return doc && doc.card === card ? doc : loaded;
            })();
            loading = { card, job };
            const done = () => {
                if (loading?.job === job) loading = null;
            };
            void job.then(done, done);
            return job;
        },

        async refresh(card: string, force = false): Promise<number> {
            const current = await store.ensure(card);
            if (!force && Date.now() - refreshed < REFRESH_MS) return 0;
            refreshed = Date.now();
            const theirs = await read(card);
            if (!theirs || doc !== current) return 0;
            let added = 0;
            for (const [key, entry] of Object.entries(theirs.entries)) {
                const own = current.entries[key];
                if (own && own.at >= entry.at) continue;
                if (own?.ru !== entry.ru) added++;
                current.entries[key] = entry;
            }
            return added;
        },

        lookup(card, text, now) {
            const current = store.current(card);
            return current ? lookupTranslation(current, text, now) : undefined;
        },

        has: (card, key) => !!store.current(card)?.entries[key],

        put(card, items, now) {
            const current = store.current(card);
            if (!current || !items.length) return 0;
            const changed = storeTranslations(current, items, now);
            if (changed) {
                dirty = true;
                later();
            }
            return changed;
        },

        flush: () => save(),

        size: (card) => Object.keys(store.current(card)?.entries ?? {}).length,

        async dispose(): Promise<void> {
            disposed = true;
            await save();
        },
    };
    return store;
}
