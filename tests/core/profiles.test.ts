import { beforeEach, describe, expect, it } from 'vitest';
import { createBus } from '../../src/core/bus';
import { createFileStore } from '../../src/core/files';
import { stableHash } from '../../src/core/hash';
import { CARD_PROFILES_SCHEMA, createProfileStore, emptyCardProfiles } from '../../src/core/profiles';
import { memoryLogger, mockHost } from '../helpers/fakes';
import { character, installStMock, openSoloChat } from '../helpers/st-mock';
import type { StMock } from '../helpers/st-mock';

let mock: StMock;

beforeEach(() => {
    mock = installStMock();
});

function setup(schema?: number) {
    const host = mockHost();
    const log = memoryLogger();
    const bus = createBus(log);
    const files = createFileStore(host, log);
    const store = createProfileStore({ host, files, bus, log, schema });
    return { host, bus, files, store };
}

describe('ProfileStore', () => {
    it('names the file by the hashed avatar', () => {
        const { store } = setup();
        expect(store.fileName('marta.png')).toBe(`dramatis-card-${stableHash('marta.png')}.json`);
    });

    it('gives empty profiles for a card without a file', async () => {
        const { store } = setup();
        expect(await store.load('marta.png')).toEqual(emptyCardProfiles('marta.png'));
    });

    it('saves, emits profiles:changed and loads back', async () => {
        const { store, bus } = setup();
        const events: string[] = [];
        const direct: string[] = [];
        bus.on('profiles:changed', ({ card }) => {
            events.push(card);
        });
        store.onChange((card) => direct.push(card));

        const profiles = emptyCardProfiles('marta.png');
        profiles.worldTone = 'hostile';
        profiles.invariants.push('Марта никогда не лжёт гостям');
        await store.save(profiles);

        expect(events).toEqual(['marta.png']);
        expect(direct).toEqual(['marta.png']);
        expect(mock.files.has(store.fileName('marta.png'))).toBe(true);
        const loaded = await store.load('marta.png');
        expect(loaded.worldTone).toBe('hostile');
        expect(loaded.invariants).toEqual(['Марта никогда не лжёт гостям']);
    });

    it('repairs documents missing collections and refuses profiles without a card', async () => {
        const { store } = setup();
        mock.files.set(store.fileName('a.png'), JSON.stringify({ schema: 1, worldTone: 7, characters: 'x' }));
        const loaded = await store.load('a.png');
        expect(loaded).toMatchObject({ card: 'a.png', characters: [], rules: [], reputation: [], invariants: [] });
        expect(loaded.worldTone).toBe('indifferent');
        await expect(store.save({ ...emptyCardProfiles(''), card: '' })).rejects.toThrow();
    });

    it('migrates older schemas forward', async () => {
        const { store } = setup(CARD_PROFILES_SCHEMA + 1);
        store.migration(CARD_PROFILES_SCHEMA, (doc) => ({ ...doc, invariants: ['migrated'] }));
        mock.files.set(store.fileName('a.png'), JSON.stringify({ ...emptyCardProfiles('a.png') }));
        const loaded = await store.load('a.png');
        expect(loaded.invariants).toEqual(['migrated']);
        expect(loaded.schema).toBe(CARD_PROFILES_SCHEMA + 1);
    });

    it('current() follows the solo chat card and is null in a group', async () => {
        const { store } = setup();
        expect(await store.current()).toBeNull();
        openSoloChat(mock, character('Marta'));
        expect((await store.current())?.card).toBe('marta.png');
        mock.groupId = 'g1';
        expect(await store.current()).toBeNull();
    });
});
