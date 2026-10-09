import { beforeEach, describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../../src/domain/model';
import { createBus } from '../../src/core/bus';
import { createFileStore } from '../../src/core/files';
import { stableHash } from '../../src/core/hash';
import { createProfileStore, emptyCardProfiles } from '../../src/core/profiles';
import { createStateStore, isStateEnvelope } from '../../src/core/state';
import type { StateEnvelope } from '../../src/core/state';
import { memoryLogger, mockHost } from '../helpers/fakes';
import { character, flush, installStMock, openSoloChat } from '../helpers/st-mock';
import type { StMock } from '../helpers/st-mock';

let mock: StMock;
let greeting = 0;

function marta(): CharacterProfile {
    return {
        id: 'marta',
        name: 'Марта',
        aliases: [],
        kind: 'character',
        lod: 'sketch',
        core: {
            concept: 'трактирщица',
            values: { top: [] },
            temperament: {},
            drives: { high: [], low: [] },
            arcLock: false,
            signatures: [],
            tactics: [],
            commitment: 'open',
            proactivity: 3,
            baselineMood: { octant: 'relaxed' },
            stanceBounds: [],
            redLines: { never: [], would: [] },
            keys: [],
            justifications: [],
            corruption: 0,
            anchors: [],
        },
        appetites: [],
        agenda: { goals: [], intentions: [], resources: [], leverage: [], secrets: [] },
        ties: [],
        starts: [
            { greeting: 0, present: true, doing: 'наливает' },
            { greeting: 1, present: false },
        ],
        meta: {},
    };
}

async function setup() {
    const host = mockHost();
    const log = memoryLogger();
    const bus = createBus(log);
    const files = createFileStore(host, log);
    const profiles = createProfileStore({ host, files, bus, log });
    const card = emptyCardProfiles('marta.png');
    card.characters.push(marta());
    await profiles.save(card);
    const store = createStateStore({ host, files, profiles, bus, log, greeting: () => greeting });
    store.install();
    return { host, bus, files, profiles, store, log };
}

beforeEach(() => {
    mock = installStMock();
    greeting = 0;
    openSoloChat(mock, character('Marta'), 'Marta - 2026-10-09');
});

describe('StateStore', () => {
    it('names the file by the hashed chat id', async () => {
        const { store } = await setup();
        expect(store.fileName('Marta - 2026-10-09')).toBe(
            `dramatis-chat-${stableHash('Marta - 2026-10-09')}-state.json`,
        );
    });

    it('builds the first state from the card profiles without writing it', async () => {
        const { store } = await setup();
        const state = await store.current();
        expect(state?.card).toBe('marta.png');
        expect(state?.characters.marta?.present).toBe(true);
        expect(state?.characters.marta?.scene.doing).toBe('наливает');
        expect(mock.files.has(store.fileName('Marta - 2026-10-09'))).toBe(false);
        expect(await store.current()).toBe(state);
    });

    it('is null outside a solo chat', async () => {
        const { store } = await setup();
        mock.groupId = 'g1';
        expect(await store.current()).toBeNull();
        mock.groupId = null;
        mock.chatId = undefined;
        expect(await store.current()).toBeNull();
    });

    it('saves an envelope with growing versions and emits state:changed', async () => {
        const { store, bus } = await setup();
        const seen: (string | null)[] = [];
        let direct = 0;
        bus.on('state:changed', ({ chatId }) => {
            seen.push(chatId);
        });
        store.onChange(() => direct++);

        const state = (await store.current())!;
        state.turn = 1;
        expect(await store.save(state)).toBe(true);
        state.turn = 2;
        expect(await store.save(state)).toBe(true);
        await flush();

        const env = JSON.parse(mock.files.get(store.fileName('Marta - 2026-10-09'))!) as StateEnvelope;
        expect(isStateEnvelope(env)).toBe(true);
        expect(env.version).toBe(2);
        expect(env.schema).toBe(1);
        expect(env.data.turn).toBe(2);
        expect(seen).toEqual(['Marta - 2026-10-09', 'Marta - 2026-10-09']);
        expect(direct).toBe(2);
    });

    it('refuses to write over a newer version from another tab and reloads it', async () => {
        const { store } = await setup();
        const state = (await store.current())!;
        expect(await store.save(state)).toBe(true);

        const name = store.fileName('Marta - 2026-10-09');
        const remote = JSON.parse(mock.files.get(name)!) as StateEnvelope;
        remote.version = 5;
        remote.data.turn = 42;
        mock.files.set(name, JSON.stringify(remote));

        state.turn = 3;
        expect(await store.save(state)).toBe(false);
        const reloaded = await store.current();
        expect(reloaded?.turn).toBe(42);
        expect(reloaded).not.toBe(state);

        reloaded!.turn = 43;
        expect(await store.save(reloaded!)).toBe(true);
        expect((JSON.parse(mock.files.get(name)!) as StateEnvelope).version).toBe(6);
    });

    it('reads a saved state after a chat switch and back', async () => {
        const { store, bus } = await setup();
        const state = (await store.current())!;
        state.turn = 9;
        await store.save(state);
        await bus.emit('chat:changed', { chatId: 'other' });
        const again = await store.current();
        expect(again).not.toBe(state);
        expect(again?.turn).toBe(9);
    });

    it('keeps drafts per message and swipe until taken', async () => {
        const { store } = await setup();
        store.setDraft(3, 0, { a: 1 });
        store.setDraft(3, 1, { a: 2 });
        expect(store.takeDraft(3, 1)).toEqual({ a: 2 });
        expect(store.takeDraft(3, 1)).toBeUndefined();
        expect(store.takeDraft(3, 0)).toEqual({ a: 1 });
    });

    it('drops drafts of an invalidated message and later ones, and all of them on chat change', async () => {
        const { store, bus } = await setup();
        store.setDraft(1, 0, 'one');
        store.setDraft(3, 0, 'three');
        store.setDraft(5, 0, 'five');
        await bus.emit('message:invalidated', { messageIndex: 3, reason: 'swiped' });
        expect(store.takeDraft(3, 0)).toBeUndefined();
        expect(store.takeDraft(5, 0)).toBeUndefined();
        expect(store.takeDraft(1, 0)).toBe('one');

        store.setDraft(2, 0, 'two');
        await bus.emit('chat:changed', { chatId: 'x' });
        expect(store.takeDraft(2, 0)).toBeUndefined();

        store.setDraft(2, 0, 'two');
        store.dropDrafts();
        expect(store.takeDraft(2, 0)).toBeUndefined();
    });

    it('keeps drafts apart per chat', async () => {
        const { store } = await setup();
        store.setDraft(1, 0, 'a');
        mock.chatId = 'another chat';
        expect(store.takeDraft(1, 0)).toBeUndefined();
        mock.chatId = 'Marta - 2026-10-09';
        expect(store.takeDraft(1, 0)).toBe('a');
    });

    it('rebuilds an unsaved state when the greeting is swiped or the profiles change', async () => {
        const { store, bus, profiles } = await setup();
        const first = await store.current();
        expect(first?.greeting).toBe(0);

        greeting = 1;
        await bus.emit('message:invalidated', { messageIndex: 0, reason: 'swiped' });
        const second = await store.current();
        expect(second?.greeting).toBe(1);
        expect(second?.characters.marta?.present).toBe(false);

        const card = await profiles.load('marta.png');
        card.worldTone = 'welcoming';
        await profiles.save(card);
        expect((await store.current())?.worldTone).toBe('welcoming');

        // Saved states stay as they are.
        const saved = (await store.current())!;
        await store.save(saved);
        greeting = 0;
        await bus.emit('message:invalidated', { messageIndex: 0, reason: 'swiped' });
        expect(await store.current()).toBe(saved);
    });

    it('migrates stored states and repairs missing collections', async () => {
        const host = mockHost();
        const log = memoryLogger();
        const bus = createBus(log);
        const files = createFileStore(host, log);
        const profiles = createProfileStore({ host, files, bus, log });
        const store = createStateStore({ host, files, profiles, bus, log, greeting: () => 0, schema: 2 });
        store.migration(1, (doc) => ({ ...doc, scene: 7 }));
        mock.files.set(
            store.fileName('Marta - 2026-10-09'),
            JSON.stringify({ schema: 1, version: 3, updatedAt: 0, tabId: 't', data: { card: 'marta.png', turn: 4 } }),
        );
        const state = await store.current();
        expect(state?.scene).toBe(7);
        expect(state?.turn).toBe(4);
        expect(state?.characters).toEqual({});
        expect(state?.log).toEqual([]);
        expect(state?.schema).toBe(2);
    });
});
