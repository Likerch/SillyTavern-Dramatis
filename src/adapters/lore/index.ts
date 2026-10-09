// Lore reader: CarrotKernel character archives (entries with `<BunnymoTags>` in the books CK marks as Character Repos,
// `extension_settings.CarrotKernel.characterRepoBooks`) and the entries of the current card's own lorebook (its linked
// World Info book, else the embedded `data.character_book`). Read-only; parsed books are cached until ST reports the
// book saved (WORLDINFO_UPDATED).
import type { ArchiveSheet, Host, LoreReader, Logger, Unsubscribe } from '../../shared/contracts';
import { archiveNames, normalizeName, parseArchive } from './archive';
import type { LoreEntryLike } from './archive';

export const CK_SETTINGS_KEY = 'CarrotKernel';

export interface CardBookEntry {
    uid: number;
    keys: string[];
    comment: string;
    content: string;
}

export interface LoreReaderImpl extends LoreReader {
    /** Books CK scans for archives (Character Repos). */
    repoBooks(): string[];
    install(): void;
    dispose(): void;
}

interface CachedArchive {
    sheet: ArchiveSheet;
    names: string[];
}

function isDict(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item) : [];
}

export function createLoreReader(host: Host, log: Logger): LoreReaderImpl {
    const books = new Map<string, Promise<CachedArchive[]>>();
    const unsubscribers: Unsubscribe[] = [];

    async function loadBook(name: string): Promise<Record<string, unknown> | null> {
        let load = host.ctx().loadWorldInfo;
        if (typeof load !== 'function') {
            try {
                const module = await host.modules.worldInfo();
                if (typeof module.loadWorldInfo === 'function')
                    load = module.loadWorldInfo as (book: string) => Promise<unknown>;
            } catch (error) {
                log.debug('world-info.js is not available', error);
            }
        }
        if (typeof load !== 'function') return null;
        try {
            const data = await load(name);
            return isDict(data) && isDict(data.entries) ? data.entries : null;
        } catch (error) {
            log.debug(`lorebook ${name} did not load`, error);
            return null;
        }
    }

    function archivesOf(book: string): Promise<CachedArchive[]> {
        let cached = books.get(book);
        if (!cached) {
            cached = loadBook(book).then((entries) => {
                const found: CachedArchive[] = [];
                for (const raw of Object.values(entries ?? {})) {
                    if (!isDict(raw) || raw.disable === true) continue;
                    const entry = raw as LoreEntryLike;
                    const sheet = parseArchive(entry, book);
                    if (sheet) found.push({ sheet, names: archiveNames(entry, sheet) });
                }
                return found;
            });
            // A failed load is not remembered.
            void cached.catch(() => books.delete(book));
            books.set(book, cached);
        }
        return cached;
    }

    function repoBooks(): string[] {
        const settings = host.ctx().extensionSettings?.[CK_SETTINGS_KEY];
        return isDict(settings) ? stringList(settings.characterRepoBooks) : [];
    }

    return {
        repoBooks,

        async archives(names: string[]): Promise<ArchiveSheet[]> {
            const wanted = new Set(names.map(normalizeName).filter(Boolean));
            if (wanted.size === 0) return [];
            const result: ArchiveSheet[] = [];
            for (const book of repoBooks()) {
                for (const archive of await archivesOf(book)) {
                    if (archive.names.some((name) => wanted.has(name))) result.push(structuredClone(archive.sheet));
                }
            }
            return result;
        },

        async cardBook(): Promise<CardBookEntry[]> {
            const ctx = host.ctx();
            if (ctx.groupId) return [];
            const character = ctx.characterId === undefined ? undefined : ctx.characters?.[Number(ctx.characterId)];
            if (!character) return [];
            const world = character.data?.extensions?.world;
            if (typeof world === 'string' && world) {
                const entries = await loadBook(world);
                if (entries) {
                    const list: CardBookEntry[] = [];
                    for (const raw of Object.values(entries)) {
                        if (!isDict(raw) || raw.disable === true) continue;
                        list.push({
                            uid: Number.isFinite(Number(raw.uid)) ? Number(raw.uid) : -1,
                            keys: [...stringList(raw.key), ...stringList(raw.keysecondary)],
                            comment: typeof raw.comment === 'string' ? raw.comment : '',
                            content: typeof raw.content === 'string' ? raw.content : '',
                        });
                    }
                    return list.sort((a, b) => a.uid - b.uid);
                }
            }
            // Not linked (or the book is gone): the lorebook embedded in the card itself.
            const embedded = character.data?.character_book?.entries;
            if (!Array.isArray(embedded)) return [];
            return embedded
                .filter((entry) => isDict(entry) && entry.enabled !== false)
                .map((entry, index) => ({
                    uid: Number.isFinite(Number(entry.id)) ? Number(entry.id) : index,
                    keys: [...stringList(entry.keys), ...stringList(entry.secondary_keys)],
                    comment:
                        typeof entry.comment === 'string' && entry.comment
                            ? entry.comment
                            : typeof entry.name === 'string'
                              ? entry.name
                              : '',
                    content: typeof entry.content === 'string' ? entry.content : '',
                }));
        },

        install(): void {
            if (unsubscribers.length) return;
            const updated = host.events.name('WORLDINFO_UPDATED');
            if (updated) {
                unsubscribers.push(
                    host.events.on(updated, (name) => {
                        if (typeof name === 'string') books.delete(name);
                    }),
                );
            }
        },

        dispose(): void {
            for (const off of unsubscribers.splice(0)) off();
            books.clear();
        },
    };
}
