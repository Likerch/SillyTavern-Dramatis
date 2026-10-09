// Dramatis files in SillyTavern's user files (`data/<user>/user/files`), ported from Maestro src/core/files.ts:
// - write: POST /api/files/upload { name, data: base64 } — the server writes atomically and only accepts names
//   matching [A-Za-z0-9_.-] (no leading dot, no unsafe extension);
// - read:  GET /user/files/<name> (404 when absent);
// - delete: POST /api/files/delete { path: '/user/files/<name>' }.
// ST's "Data cleanup" lists these files as unused; the `dramatis-` prefix makes them recognisable.
import type { FileStore, Host, Logger } from '../shared/contracts';
import { stableHash } from './hash';

export const FILE_PREFIX = 'dramatis-';
const NAME_RE = /^[A-Za-z0-9_.-]+$/;
const MAX_NAME_LENGTH = 200;
const CACHE_LIMIT = 32;
const CACHE_MAX_TEXT = 512 * 1024;

export interface ReadOptions {
    /** Bypass the in-memory cache and ask the server (compare-and-swap, other tabs). */
    fresh?: boolean;
}

/** The FileStore Dramatis core builds: the contract plus cache control. */
export interface DramatisFileStore extends FileStore {
    read<T>(name: string, options?: ReadOptions): Promise<T | null>;
    /** Drops one cached file, or the whole cache. */
    invalidate(name?: string): void;
}

export class FileStoreError extends Error {
    constructor(
        message: string,
        readonly status?: number,
    ) {
        super(message);
        this.name = 'FileStoreError';
    }
}

let tabIdValue: string | null = null;

/** Random id of this browser tab (page load), written into file envelopes. */
export function currentTabId(): string {
    if (!tabIdValue) {
        const random =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
                : Math.random().toString(36).slice(2, 14);
        tabIdValue = `t${Date.now().toString(36)}${random}`;
    }
    return tabIdValue;
}

/** Throws unless the name is a valid ST user file name with the Dramatis prefix. */
export function assertFileName(name: string): void {
    if (!name.startsWith(FILE_PREFIX)) throw new FileStoreError(`file name must start with ${FILE_PREFIX}: ${name}`);
    if (!NAME_RE.test(name) || name.length > MAX_NAME_LENGTH || name.includes('..')) {
        throw new FileStoreError(`invalid file name: ${name}`);
    }
}

/** `dramatis-<kind>[-<hash(key)>].json`; characters outside [A-Za-z0-9_-] in the kind become `_`. */
export function makeFileName(kind: string, key?: string): string {
    const bare = kind.startsWith(FILE_PREFIX) ? kind.slice(FILE_PREFIX.length) : kind;
    const safeKind = bare.replace(/[^A-Za-z0-9_-]/g, '_') || 'file';
    const suffix = key === undefined ? '' : `-${stableHash(key)}`;
    return `${FILE_PREFIX}${safeKind}${suffix}.json`;
}

/** Base64 of the UTF-8 bytes of a string (btoa alone only accepts Latin-1). */
export function utf8ToBase64(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

/** Reads a file around any cache (works with any FileStore; DramatisFileStore skips its cache). */
export function readFresh<T>(files: FileStore, name: string): Promise<T | null> {
    const store = files as Partial<DramatisFileStore>;
    return typeof store.invalidate === 'function' ? files.read<T>(name, { fresh: true }) : files.read<T>(name);
}

export function createFileStore(host: Host, log: Logger): DramatisFileStore {
    // name -> JSON text (null = known to be absent). Text, not objects: every read parses a fresh copy, so callers
    // can mutate what they get without corrupting the cache.
    const cache = new Map<string, string | null>();
    // Per-name chain: writes and deletes of one file leave this tab in order.
    const chains = new Map<string, Promise<unknown>>();

    const remember = (name: string, text: string | null) => {
        cache.delete(name);
        if (text !== null && text.length > CACHE_MAX_TEXT) return;
        cache.set(name, text);
        while (cache.size > CACHE_LIMIT) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) break;
            cache.delete(oldest);
        }
    };

    const parse = <T>(name: string, text: string | null): T | null => {
        if (text === null) return null;
        try {
            return JSON.parse(text) as T;
        } catch (error) {
            log.warn(`file ${name} is not valid JSON; treating it as absent`, error);
            return null;
        }
    };

    const serial = <R>(name: string, job: () => Promise<R>): Promise<R> => {
        const previous = chains.get(name) ?? Promise.resolve();
        const next = previous.then(job, job);
        const settled = next.catch(() => undefined);
        chains.set(name, settled);
        void settled.then(() => {
            if (chains.get(name) === settled) chains.delete(name);
        });
        return next;
    };

    const headers = () => host.ctx().getRequestHeaders();

    return {
        async read<T>(name: string, options?: ReadOptions): Promise<T | null> {
            assertFileName(name);
            if (!options?.fresh && cache.has(name)) return parse<T>(name, cache.get(name) ?? null);
            // Wait for this tab's own pending write so a read never overtakes it.
            await chains.get(name);
            const response = await fetch(`/user/files/${encodeURIComponent(name)}`, {
                method: 'GET',
                headers: headers(),
                cache: 'no-store',
            });
            if (response.status === 404) {
                remember(name, null);
                return null;
            }
            if (!response.ok) throw new FileStoreError(`read ${name} failed: HTTP ${response.status}`, response.status);
            const text = await response.text();
            remember(name, text);
            return parse<T>(name, text);
        },

        async write(name: string, data: unknown): Promise<void> {
            assertFileName(name);
            const text = JSON.stringify(data);
            if (text === undefined) throw new FileStoreError(`cannot serialise data for ${name}`);
            return serial(name, async () => {
                const response = await fetch('/api/files/upload', {
                    method: 'POST',
                    headers: headers(),
                    body: JSON.stringify({ name, data: utf8ToBase64(text) }),
                });
                if (!response.ok) {
                    cache.delete(name);
                    throw new FileStoreError(`write ${name} failed: HTTP ${response.status}`, response.status);
                }
                remember(name, text);
                log.debug(`wrote ${name} (${text.length} chars)`);
            });
        },

        async remove(name: string): Promise<void> {
            assertFileName(name);
            return serial(name, async () => {
                const response = await fetch('/api/files/delete', {
                    method: 'POST',
                    headers: headers(),
                    body: JSON.stringify({ path: `/user/files/${name}` }),
                });
                if (!response.ok && response.status !== 404) {
                    cache.delete(name);
                    throw new FileStoreError(`delete ${name} failed: HTTP ${response.status}`, response.status);
                }
                remember(name, null);
            });
        },

        fileName(kind: string, key?: string): string {
            return makeFileName(kind, key);
        },

        invalidate(name?: string): void {
            if (name === undefined) cache.clear();
            else cache.delete(name);
        },
    };
}
