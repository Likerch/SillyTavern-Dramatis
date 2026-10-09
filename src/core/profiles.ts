// Card-level profiles (docs/model.md §15): one file per card, `dramatis-card-<hash(avatar)>.json`, holding the
// CardProfiles document itself (its `schema` field drives migrations). The card is never changed. A missing or
// unreadable file reads as empty profiles, so a card without Dramatis data simply has no cast yet.
import type { CardProfiles } from '../domain/model';
import type { Bus, FileStore, Host, Logger, ProfileStore, Unsubscribe } from '../shared/contracts';

export const CARD_PROFILES_SCHEMA = 1;

/** One migration step: moves a raw document from schema N to N + 1. */
export type ProfilesMigration = (doc: Record<string, unknown>) => Record<string, unknown>;

export interface ProfileStoreImpl extends ProfileStore {
    /** File name of a card's profiles. */
    fileName(card: string): string;
    /** Registers a migration step from `fromSchema` to `fromSchema + 1` (raise CARD_PROFILES_SCHEMA with it). */
    migration(fromSchema: number, step: ProfilesMigration): void;
}

export interface ProfileStoreDeps {
    host: Host;
    files: FileStore;
    bus: Bus;
    log: Logger;
    /** Schema this code writes (tests raise it to exercise migrations). */
    schema?: number;
}

export function emptyCardProfiles(card: string): CardProfiles {
    return {
        schema: CARD_PROFILES_SCHEMA,
        card,
        worldTone: 'indifferent',
        invariants: [],
        characters: [],
        rules: [],
        reputation: [],
        meta: {},
    };
}

function isDict(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Gives a stored document every top-level field of CardProfiles (older or hand-edited files may lack some). */
function normalize(raw: Record<string, unknown>, card: string, schema: number): CardProfiles {
    const base = emptyCardProfiles(card);
    const doc = { ...base, ...raw } as unknown as CardProfiles;
    for (const key of ['invariants', 'characters', 'rules', 'reputation'] as const) {
        if (!Array.isArray(doc[key])) (doc as unknown as Record<string, unknown>)[key] = [];
    }
    if (!isDict(doc.meta)) doc.meta = {};
    if (typeof doc.worldTone !== 'string') doc.worldTone = base.worldTone;
    doc.card = card;
    doc.schema = schema;
    return doc;
}

export function createProfileStore(deps: ProfileStoreDeps): ProfileStoreImpl {
    const { host, files, bus, log } = deps;
    const target = deps.schema ?? CARD_PROFILES_SCHEMA;
    const migrations = new Map<number, ProfilesMigration>();
    const listeners = new Set<(card: string) => void>();

    const fileName = (card: string) => files.fileName('card', card);

    function migrate(raw: Record<string, unknown>): Record<string, unknown> {
        let schema = typeof raw.schema === 'number' ? raw.schema : 1;
        let doc = raw;
        while (schema < target) {
            const step = migrations.get(schema);
            if (!step) {
                log.warn(`no profiles migration from schema ${schema}`);
                break;
            }
            doc = step(doc);
            schema++;
        }
        return doc;
    }

    async function load(card: string): Promise<CardProfiles> {
        let raw: unknown;
        try {
            raw = await files.read<unknown>(fileName(card));
        } catch (error) {
            log.warn(`could not read the profiles of ${card}`, error);
            return emptyCardProfiles(card);
        }
        if (!isDict(raw)) return emptyCardProfiles(card);
        try {
            return normalize(migrate(raw), card, target);
        } catch (error) {
            log.error(`profiles of ${card} could not be migrated; using empty ones`, error);
            return emptyCardProfiles(card);
        }
    }

    return {
        load,

        async current(): Promise<CardProfiles | null> {
            const card = host.cardKey();
            return card ? load(card) : null;
        },

        async save(profiles: CardProfiles): Promise<void> {
            const card = profiles.card;
            if (!card) throw new Error('profiles without a card cannot be saved');
            profiles.schema = target;
            await files.write(fileName(card), profiles);
            for (const listener of [...listeners]) {
                try {
                    listener(card);
                } catch (error) {
                    log.error('profiles listener failed', error);
                }
            }
            await bus.emit('profiles:changed', { card });
        },

        onChange(listener: (card: string) => void): Unsubscribe {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        fileName,

        migration(fromSchema: number, step: ProfilesMigration): void {
            migrations.set(fromSchema, step);
        },
    };
}
