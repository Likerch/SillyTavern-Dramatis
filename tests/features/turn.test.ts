import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBus } from '../../src/core/bus';
import { createI18n } from '../../src/core/i18n';
import { Settings } from '../../src/core/settings';
import { sampleParams, sketchProfile } from '../../src/domain/generator';
import { PLAYER_ID } from '../../src/domain/model';
import type { CardProfiles, CharacterProfile, ChatState } from '../../src/domain/model';
import { matchName } from '../../src/domain/presence';
import { emptyCardProfiles } from '../../src/domain/profile-defaults';
import type { TurnPass } from '../../src/domain/turn-prompt';
import { ENGINE_API } from '../../src/features/engine/api';
import type { EngineApi, EngineView } from '../../src/features/engine/api';
import { ARC_KIND, STATE_TARGET, turnModule } from '../../src/features/turn';
import { TURN_API } from '../../src/features/turn/api';
import type { TurnApi } from '../../src/features/turn/api';
import { TURN_STRINGS } from '../../src/features/turn/strings';
import type { ApiJournalChange, ApiLlmRequest, ApiLlmResult, ApiProposal } from '../../src/shared/apis';
import type { App, DesCharacter, DramatisSettings, Unsubscribe } from '../../src/shared/contracts';
import { seeded } from '../domain/appetites-fixtures';
import { TAVERN_PRESENT, tavern } from '../domain/cast-fixtures';
import { entry, event, turnPass } from '../domain/turn-fixtures';
import { fakeMaestro, freshSession, memoryLogger, mockHost, staticBridge } from '../helpers/fakes';
import type { MemoryLogger } from '../helpers/fakes';
import { flush, installStMock, message } from '../helpers/st-mock';
import type { StMock } from '../helpers/st-mock';

const TIP = turnPass({
    events: [event('PLAYER', 'ilva', 'pay', 'left a generous tip', { witnesses: ['bram'], intensity: 4 })],
    characters: [
        entry('ilva', { emotion: { type: 'suspicion', intensity: 3, target: 'PLAYER', cause: 'a bribe' } }),
        entry('bram', { playerRole: 'means' }),
    ],
});

const MOCK = turnPass({
    events: [event('PLAYER', 'bram', 'insult', 'mocked Брам')],
    characters: [entry('bram')],
});

const RESCUE = turnPass({
    events: [event('PLAYER', 'sota', 'save', 'pulled Сота out of the fire', { witnesses: ['ilva'], intensity: 5 })],
    characters: [entry('ilva', { keyMatched: 'protection of her daughter' }), entry('sota')],
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function fakeEngine(profiles: CharacterProfile[], initial: ChatState) {
    const box = { state: initial, updates: 0 };
    const card: CardProfiles = { ...emptyCardProfiles('tavern.png'), characters: profiles };
    const view = (): EngineView => ({
        card,
        state: box.state,
        profiles,
        byId: new Map(profiles.map((profile) => [profile.id, profile] as const)),
        present: TAVERN_PRESENT,
        unknown: [],
        bands: box.state.next?.bands ?? {
            ilva: 'business',
            bram: 'business',
            sota: 'focus',
            carters: 'background',
            fenn: 'background',
        },
        playerName: 'Курьер',
        greeting: 0,
    });
    const api: EngineApi = {
        view,
        ready: async () => view(),
        async updateState(mutate) {
            const clone = structuredClone(box.state);
            box.state = mutate(clone, view()) ?? clone;
            box.updates++;
            return true;
        },
        updateProfiles: async () => false,
        refresh: async () => {},
        resolve: (name) => matchName(name, profiles),
        log: () => {},
        onChange: () => () => {},
    };
    return { api, box };
}

interface Setup {
    mock: StMock;
    app: App;
    bus: ReturnType<typeof createBus>;
    engine: ReturnType<typeof fakeEngine>;
    maestro: ReturnType<typeof fakeMaestro>;
    drafts: Map<string, unknown>;
    proposals: ApiProposal[];
    appliers: Map<
        string,
        { apply: (payload: unknown) => Promise<void>; valid?: (payload: unknown) => Promise<boolean> }
    >;
    undoers: Map<string, (change: ApiJournalChange) => Promise<boolean>>;
    journal: { kind: string; changes: ApiJournalChange[] }[];
    order: string[];
    notices: { text: string; options?: { action?: { label: string; run: () => void } } }[];
    leader: { value: boolean };
    des: DesCharacter[];
    reply: (request: ApiLlmRequest) => ApiLlmResult | Promise<ApiLlmResult>;
    /** What the module exposed to other modules (TURN_API). */
    exposed: Map<string, unknown>;
    /** Dramatis' own files (the turn snapshot). */
    files: Map<string, unknown>;
    dispose(): Promise<void>;
}

async function setup(
    options: {
        levers?: Partial<DramatisSettings>;
        patch?: (profiles: CharacterProfile[], state: ChatState) => void;
        pass?: TurnPass;
        /** A Maestro 1.23+ whose scene split is active. */
        split?: boolean;
    } = {},
): Promise<Setup> {
    const mock = installStMock();
    mock.chatId = 'chat-1';
    mock.chat = [
        message('The inn is half empty tonight.'),
        message('I leave a silver coin on the counter.', { is_user: true }),
        message('Ильва sweeps the coin into her apron.', {
            swipe_id: 0,
            swipes: ['Ильва sweeps the coin into her apron.'],
        }),
    ];
    const log = memoryLogger();
    const store: Record<string, unknown> = {};
    const settings = new Settings(
        () => store,
        () => {},
        log,
    );
    for (const [key, value] of Object.entries(options.levers ?? {})) {
        settings.set(key as keyof DramatisSettings, value as never);
    }
    const i18n = createI18n(() => 'en');
    i18n.register(TURN_STRINGS);
    const bus = createBus(log);
    const { profiles, state } = tavern();
    options.patch?.(profiles, state);
    const engine = fakeEngine(profiles, state);
    const maestro = fakeMaestro(options.split ? { sceneSplit: true } : {});
    const drafts = new Map<string, unknown>();
    const result: Setup = {
        mock,
        app: undefined as unknown as App,
        bus,
        engine,
        maestro,
        drafts,
        proposals: [],
        appliers: new Map(),
        undoers: new Map(),
        journal: [],
        order: [],
        notices: [],
        leader: { value: true },
        des: [],
        reply: () => ({ ok: true, data: JSON.parse(JSON.stringify(options.pass ?? TIP)) }),
        exposed: new Map(),
        files: new Map(),
        async dispose() {},
    };
    maestro.reply = (request) => result.reply(request);
    maestro.api.leader.isLeader = () => result.leader.value;
    maestro.api.propose = async (proposal) => {
        result.order.push('propose');
        result.proposals.push(proposal);
        return 'queued';
    };
    maestro.api.registerApplier = (kind, _label, apply, valid) => {
        result.order.push('registerApplier');
        result.appliers.set(kind, { apply, ...(valid ? { valid } : {}) });
        return () => result.appliers.delete(kind);
    };
    maestro.api.journal = {
        record: async (action) => {
            result.journal.push(action);
            return `j${result.journal.length}`;
        },
        registerUndo: (target, handler) => {
            result.undoers.set(target, handler);
            return () => result.undoers.delete(target);
        },
    };
    maestro.api.notice = (text, noticeOptions) => {
        result.notices.push({ text, ...(noticeOptions ? { options: noticeOptions } : {}) });
    };
    const app = {
        version: '0.0.1',
        host: mockHost(log),
        log,
        i18n,
        settings,
        bus,
        rng: seeded(5),
        maestro: staticBridge(maestro.api),
        modules: {
            api: (key: string) => (key === ENGINE_API ? engine.api : result.exposed.get(key)),
            expose: (key: string, value: unknown) => result.exposed.set(key, value),
        },
        state: {
            setDraft: (index: number, swipe: number, draft: unknown) => drafts.set(`${index}:${swipe}`, draft),
            takeDraft: (index: number, swipe: number) => {
                const draft = drafts.get(`${index}:${swipe}`);
                drafts.delete(`${index}:${swipe}`);
                return draft;
            },
            dropDrafts: (index?: number) => {
                for (const key of [...drafts.keys()]) {
                    if (index === undefined || Number(key.split(':')[0]) >= index) drafts.delete(key);
                }
            },
        },
        readers: {
            des: {
                available: () => true,
                castAt: () => result.des,
                lastCast: () => result.des,
                scene: () => ({}),
                roster: () => [],
                aliases: () => ({}),
            },
        },
        ui: { notice: vi.fn() },
        files: {
            fileName: (kind: string) => `dramatis-${kind}.json`,
            read: async (name: string) => (result.files.has(name) ? structuredClone(result.files.get(name)) : null),
            write: async (name: string, data: unknown) => void result.files.set(name, structuredClone(data)),
            remove: async (name: string) => void result.files.delete(name),
        },
    } as unknown as App;
    result.app = app;
    const owned: Unsubscribe[] = [];
    await turnModule.init({
        app,
        settings: turnModule.defaults(),
        log,
        own: (dispose) => void owned.push(dispose as Unsubscribe),
        session: freshSession,
    });
    result.dispose = async () => {
        for (const off of owned.splice(0)) await off();
    };
    return result;
}

async function reply(s: Setup, index = 2): Promise<void> {
    await s.bus.emit('reply:ready', { messageIndex: index });
    await flush();
}

async function send(s: Setup, index = 2): Promise<void> {
    s.mock.chat.push(message('Thanks.', { is_user: true }));
    await s.bus.emit('turn:committed', { messageIndex: index });
    await flush();
}

beforeEach(() => {
    vi.restoreAllMocks();
});

describe('turn module', () => {
    it('registers its task, applier and undo target, and gives them back when stopped', async () => {
        const s = await setup();
        expect(s.appliers.has(ARC_KIND)).toBe(true);
        expect(s.undoers.has(STATE_TARGET)).toBe(true);
        await s.dispose();
        expect(s.appliers.size).toBe(0);
        expect(s.undoers.size).toBe(0);
        await s.bus.emit('reply:ready', { messageIndex: 2 });
        expect(s.maestro.requests).toHaveLength(0);
    });

    it('keeps the pass of a reply as a draft and applies it when the next message is sent', async () => {
        const s = await setup();
        await reply(s);
        expect(s.maestro.requests).toHaveLength(1);
        const request = s.maestro.requests[0]!;
        expect(request).toMatchObject({ task: 'dramatis.turn', background: true });
        expect(request.schema?.name).toBe('dramatis_turn');
        expect(request.messages[1]!.content).toContain('Ильва sweeps the coin');
        expect(request.messages[1]!.content).toContain('I leave a silver coin');
        expect(s.drafts.has('2:0')).toBe(true);
        expect(s.engine.box.updates).toBe(0);

        await send(s);
        expect(s.engine.box.updates).toBe(1);
        const state = s.engine.box.state;
        expect(state.turn).toBe(1);
        expect(
            state.characters.ilva!.ties[PLAYER_ID]!.reasons.some((item) => item.text === 'left a generous tip'),
        ).toBe(true);
        expect(state.characters.ilva!.emotion?.type).toBe('suspicion');
        expect(s.drafts.size).toBe(0);
        expect(s.journal).toHaveLength(1);
        expect(s.journal[0]!.kind).toBe('dramatis.turn');
        expect(s.journal[0]!.changes[0]).toMatchObject({ target: STATE_TARGET, ref: { chatId: 'chat-1', turn: 1 } });
        // The journal record stays small: the whole state before the turn is in Dramatis' own snapshot file.
        expect(s.journal[0]!.changes[0]!.before).toEqual({ turn: 0 });
        expect(s.journal[0]!.changes[0]!.after).toEqual({ turn: 1 });
        const snapshot = [...s.files.values()][0] as { chatId: string; turn: number; before: ChatState };
        expect(snapshot).toMatchObject({ chatId: 'chat-1', turn: 1, before: { turn: 0 } });

        // The same commit again (a second message without a reply between) changes nothing.
        await s.bus.emit('turn:committed', { messageIndex: 2 });
        await flush();
        expect(s.engine.box.updates).toBe(1);
    });

    it('drops the draft of a swiped reply; the new swipe is analysed on its own', async () => {
        const s = await setup();
        s.reply = (request) => ({
            ok: true,
            data: JSON.parse(JSON.stringify(request.messages[1]!.content.includes('spits') ? MOCK : TIP)),
        });
        await reply(s);
        expect(s.drafts.has('2:0')).toBe(true);
        await s.bus.emit('message:invalidated', { messageIndex: 2, reason: 'swiped' });
        expect(s.drafts.size).toBe(0);

        const swiped = s.mock.chat[2]!;
        swiped.swipe_id = 1;
        swiped.mes = 'Ильва spits on the floor; Брам laughs.';
        await reply(s);
        expect(s.drafts.has('2:1')).toBe(true);
        await send(s);
        const state = s.engine.box.state;
        expect(
            state.characters.ilva!.ties[PLAYER_ID]!.reasons.some((item) => item.text === 'left a generous tip'),
        ).toBe(false);
        expect(state.characters.bram!.ties[PLAYER_ID]!.reasons.some((item) => item.text === 'mocked Брам')).toBe(true);
    });

    it('aborts a pass still running when its reply is swiped away', async () => {
        const s = await setup();
        const pending = deferred<ApiLlmResult>();
        s.reply = () => pending.promise;
        await reply(s);
        const signal = s.maestro.requests[0]!.signal!;
        await s.bus.emit('message:invalidated', { messageIndex: 2, reason: 'swiped' });
        expect(signal.aborted).toBe(true);
        pending.resolve({ ok: true, data: TIP });
        await flush();
        expect(s.drafts.size).toBe(0);
    });

    it('applies a pass that finishes after the commit, if the reply is still the committed one', async () => {
        const s = await setup();
        const pending = deferred<ApiLlmResult>();
        s.reply = () => pending.promise;
        await reply(s);
        await send(s);
        expect(s.engine.box.updates).toBe(0);
        pending.resolve({ ok: true, data: JSON.parse(JSON.stringify(TIP)) });
        await flush();
        await flush();
        expect(s.engine.box.updates).toBe(1);
        expect(s.drafts.size).toBe(0);
        expect(s.engine.box.state.characters.ilva!.emotion?.type).toBe('suspicion');
    });

    it('does not apply a late pass to an edited reply', async () => {
        const s = await setup();
        const pending = deferred<ApiLlmResult>();
        s.reply = () => pending.promise;
        await reply(s);
        await send(s);
        s.mock.chat[2]!.mes = 'Ильва throws the coin back.';
        pending.resolve({ ok: true, data: TIP });
        await flush();
        await flush();
        expect(s.engine.box.updates).toBe(0);
    });

    it('runs the pass at commit time when there is no draft (a reload, a swipe back)', async () => {
        const s = await setup();
        await send(s);
        await flush();
        expect(s.maestro.requests).toHaveLength(1);
        expect(s.engine.box.updates).toBe(1);
        expect(s.engine.box.state.characters.ilva!.emotion?.type).toBe('suspicion');
    });

    it('commits without a pass when the request is refused (not the leader at the model, or the cap)', async () => {
        const s = await setup();
        s.reply = () => ({ ok: false, error: 'cap' });
        await reply(s);
        expect(s.drafts.size).toBe(0);
        await send(s);
        await flush();
        expect(s.engine.box.updates).toBe(1);
        expect(s.engine.box.state.turn).toBe(1);
        expect(s.journal[0]!.changes[0]!.ref).toEqual({ chatId: 'chat-1', turn: 1 });
    });

    it('stays silent on a «workshop» refusal (Maestro 1.21 «Мастерская») and asks again at commit', async () => {
        const s = await setup();
        s.reply = () => ({ ok: false, error: 'workshop' });
        await reply(s);
        expect(s.drafts.size).toBe(0);
        await send(s);
        await flush();
        // «Not now», not a failure: the commit asks once more and goes on without a pass.
        expect(s.maestro.requests).toHaveLength(2);
        expect(s.engine.box.state.turn).toBe(1);
        expect(s.notices).toEqual([]);
        expect((s.app.log as MemoryLogger).lines.filter((line) => line.level === 'warn')).toEqual([]);
    });

    it('does nothing outside the leader tab', async () => {
        const s = await setup();
        s.leader.value = false;
        await reply(s);
        await send(s);
        expect(s.maestro.requests).toHaveLength(0);
        expect(s.engine.box.updates).toBe(0);
        expect(s.drafts.size).toBe(0);
    });

    it('economy: every second reply, only the characters in focus or on business', async () => {
        const odd = await setup({ levers: { mode: 'economy' }, patch: (_profiles, state) => void (state.turn = 1) });
        await reply(odd);
        expect(odd.maestro.requests).toHaveLength(0);
        await send(odd);
        expect(odd.maestro.requests).toHaveLength(0);
        expect(odd.engine.box.updates).toBe(1);
        expect(odd.engine.box.state.turn).toBe(2);

        const even = await setup({ levers: { mode: 'economy' } });
        await reply(even);
        expect(even.maestro.requests).toHaveLength(1);
        const schema = even.maestro.requests[0]!.schema!.schema as {
            properties: { characters: { items: { properties: { id: { enum: string[] } } } } };
        };
        expect(schema.properties.characters.items.properties.id.enum).toEqual(['ilva', 'bram', 'sota']);
        expect(even.maestro.requests[0]!.messages[1]!.content).not.toContain('[carters]');
    });

    it('routes an arc step to the Inbox and applies it once approved', async () => {
        const s = await setup({
            pass: RESCUE,
            patch: (profiles) => {
                const ilva = profiles.find((profile) => profile.id === 'ilva')!;
                ilva.core = { ...ilva.core, stanceBounds: [{ target: PLAYER_ID, max: -2 }] };
            },
        });
        await reply(s);
        await send(s);
        expect(s.order.indexOf('registerApplier')).toBeLessThan(s.order.indexOf('propose'));
        expect(s.proposals).toHaveLength(1);
        const proposal = s.proposals[0]!;
        expect(proposal).toMatchObject({ kind: ARC_KIND, fallback: 'inbox', sourceMessage: 2 });
        expect(proposal.title).toBe('A change of heart: Ильва → Курьер (hostile → interfering)');
        expect(proposal.payload).toMatchObject({
            chatId: 'chat-1',
            character: 'ilva',
            target: PLAYER_ID,
            from: -2,
            to: -1,
        });
        expect(JSON.parse(JSON.stringify(proposal.payload))).toEqual(proposal.payload);
        expect(s.engine.box.state.characters.ilva!.ties[PLAYER_ID]!.stance).toBe(-2);

        const applier = s.appliers.get(ARC_KIND)!;
        expect(await applier.valid!(proposal.payload)).toBe(true);
        await applier.apply(proposal.payload);
        expect(s.engine.box.state.characters.ilva!.ties[PLAYER_ID]!.stance).toBe(-1);
        expect(await applier.valid!(proposal.payload)).toBe(false);
        expect(s.engine.box.state.log.some((line) => line.kind === 'arc' && line.text.includes('arc step'))).toBe(true);

        // Maestro journals the applied card with the proposal's changes; its undo comes back to this target.
        const undo = s.undoers.get(STATE_TARGET)!;
        const change = proposal.changes[0]!;
        expect(change).toMatchObject({ target: STATE_TARGET, before: -2, after: -1 });
        expect(await undo(change)).toBe(true);
        expect(s.engine.box.state.characters.ilva!.ties[PLAYER_ID]!.stance).toBe(-2);
        // Taken back already (or moved since): nothing to undo.
        expect(await undo(change)).toBe(false);
    });

    it('does not apply an arc step of another chat', async () => {
        const s = await setup();
        const payload = {
            chatId: 'other',
            character: 'ilva',
            target: PLAYER_ID,
            dir: 1,
            from: -2,
            to: -1,
            text: 'x',
            turn: 1,
        };
        await s.appliers.get(ARC_KIND)!.apply(payload);
        expect(s.engine.box.updates).toBe(0);
        expect(await s.appliers.get(ARC_KIND)!.valid!(payload)).toBe(false);
    });

    it('announces the applied turn once the commit is saved: the new counter and its own next', async () => {
        const s = await setup();
        const seen: { messageIndex: number; turn: number; next?: number; state: number }[] = [];
        s.bus.on('turn:applied', ({ messageIndex, turn }) => {
            const state = s.engine.box.state;
            seen.push({ messageIndex, turn, state: state.turn, ...(state.next ? { next: state.next.turn } : {}) });
        });
        await reply(s);
        await send(s);
        expect(seen).toEqual([{ messageIndex: 2, turn: 1, state: 1, next: 1 }]);

        // A second message after the same reply is no new turn: no model call, no commit, no announcement.
        await s.bus.emit('turn:committed', { messageIndex: 2 });
        await flush();
        expect(seen).toHaveLength(1);
        expect(s.maestro.requests).toHaveLength(1);
        expect(s.engine.box.updates).toBe(1);
    });

    it('never commits the same reply twice, even after a reload (the state remembers its last commit)', async () => {
        const first = await setup();
        await reply(first);
        await send(first);
        const lastCommit = first.engine.box.state.lastCommit;
        expect(lastCommit).toMatchObject({ messageIndex: 2, swipeId: 0 });

        const reloaded = await setup({
            patch: (_profiles, state) => {
                state.turn = 1;
                state.lastCommit = lastCommit;
            },
        });
        await send(reloaded);
        await flush();
        expect(reloaded.maestro.requests).toHaveLength(0);
        expect(reloaded.engine.box.updates).toBe(0);
    });

    it('reads a reply announced twice (ST renders it again) only once; a changed text is read again', async () => {
        const s = await setup();
        await reply(s);
        await reply(s);
        expect(s.maestro.requests).toHaveLength(1);
        s.mock.chat[2]!.mes = 'Ильва sweeps the coin into her apron and smiles.';
        await reply(s);
        expect(s.maestro.requests).toHaveLength(2);
    });

    it('does not ask the model again at commit about a reply whose pass was refused', async () => {
        const s = await setup();
        s.reply = () => ({ ok: false, refusal: true, error: 'refusal' });
        await reply(s);
        expect(s.maestro.requests).toHaveLength(1);
        await send(s);
        await flush();
        expect(s.maestro.requests).toHaveLength(1);
        expect(s.engine.box.state.turn).toBe(1);
    });

    it('settle(): commits a ready draft before the generation when turn:committed is late, once', async () => {
        const s = await setup();
        await reply(s);
        s.mock.chat.push(message('Thanks.', { is_user: true }));
        const turn = s.exposed.get(TURN_API) as TurnApi;
        await turn.settle();
        expect(s.engine.box.updates).toBe(1);
        expect(s.engine.box.state.next?.turn).toBe(1);
        expect(s.engine.box.state.turn).toBe(1);

        await s.bus.emit('turn:committed', { messageIndex: 2 });
        await flush();
        expect(s.engine.box.updates).toBe(1);
        expect(s.maestro.requests).toHaveLength(1);
    });

    it('settle(): never asks the model on the send path — a reply without a draft waits for its commit', async () => {
        const s = await setup();
        s.mock.chat.push(message('Thanks.', { is_user: true }));
        await (s.exposed.get(TURN_API) as TurnApi).settle();
        expect(s.maestro.requests).toHaveLength(0);
        expect(s.engine.box.updates).toBe(0);
    });

    it('reads the scene as the reply left it before the pass', async () => {
        const s = await setup();
        const refresh = vi.spyOn(s.engine.api, 'refresh');
        await reply(s);
        expect(refresh).toHaveBeenCalled();
        expect(s.maestro.requests).toHaveLength(1);
    });

    it('undoes the latest committed turn from its journal snapshot', async () => {
        const s = await setup();
        await reply(s);
        await send(s);
        const undo = s.undoers.get(STATE_TARGET)!;
        const change = s.journal[0]!.changes[0]!;
        expect(await undo({ ...change, ref: { ...change.ref, chatId: 'other' } })).toBe(false);
        expect(await undo(change)).toBe(true);
        expect(s.engine.box.state.turn).toBe(0);
        expect(s.engine.box.state.characters.ilva!.emotion).toBeUndefined();
        expect(await undo(change)).toBe(false);
    });

    it('undoes a turn recorded with a whole state (records made before the snapshot file)', async () => {
        const s = await setup();
        await reply(s);
        await send(s);
        const old = structuredClone(s.engine.box.state);
        old.turn = 0;
        delete old.characters.ilva!.emotion;
        s.files.clear();
        const change = { target: STATE_TARGET, ref: { chatId: 'chat-1', turn: 1 }, before: old, after: { turn: 1 } };
        expect(await s.undoers.get(STATE_TARGET)!(change)).toBe(true);
        expect(s.engine.box.state.turn).toBe(0);
    });

    it('offers «Redo» for a reply that drifted, and asks ST for a new swipe', async () => {
        const s = await setup({ levers: { driftResponse: 'redo' }, pass: turnPass() });
        s.des = [{ name: 'Ильва', present: true, relationship: 'Подруга', details: {} }];
        const to = vi.fn(async () => {});
        (s.mock.context as unknown as { swipe: unknown }).swipe = { to };
        await reply(s);
        expect(s.notices).toHaveLength(1);
        expect(s.notices[0]!.text).toContain('Ильва');
        expect(s.notices[0]!.options?.action?.label).toBe('Redo');
        s.notices[0]!.options!.action!.run();
        expect(to).toHaveBeenCalledWith(
            null,
            'right',
            expect.objectContaining({ forceSwipeId: 1, message: s.mock.chat[2] }),
        );

        // Too late once the player has written after it.
        s.mock.chat.push(message('Thanks.', { is_user: true }));
        s.notices[0]!.options!.action!.run();
        expect(to).toHaveBeenCalledTimes(1);
        expect(s.app.ui.notice).toHaveBeenCalled();
    });

    it('stays quiet about drift in the default «correct» mode but corrects the next card', async () => {
        const s = await setup({ pass: turnPass() });
        s.des = [{ name: 'Ильва', present: true, relationship: 'Подруга', details: {} }];
        await reply(s);
        expect(s.notices).toHaveLength(0);
        await send(s);
        expect(s.engine.box.state.next?.corrections?.ilva?.[0]).toContain('still hostile');
    });
});

describe('turn module — departures (§6.4)', () => {
    /** The reply at index 2 says this (one swipe). */
    function replyText(s: Setup, text: string, index = 2): void {
        const reply = s.mock.chat[index]!;
        reply.mes = text;
        reply.swipes = [text];
    }

    it('commits the departure the reply’s narration shows; the DES tracker of the reply still lists her', async () => {
        const s = await setup({ pass: turnPass({ characters: [entry('ilva', { sceneGoal: 'see the rebels' })] }) });
        s.des = [{ name: 'Ильва', present: true, details: {} }];
        replyText(s, '```json\n{"characterThoughts": [{"name": "Ильва"}]}\n```\nИльва сгребла монеты в фартук и ушла.');
        await reply(s);
        await send(s);
        const state = s.engine.box.state;
        expect(state.away).toEqual({ ilva: { since: 1, by: 'narration', doing: 'see the rebels' } });
        expect(state.next?.bands?.ilva).toBeUndefined();
        expect(state.next?.moves?.ilva).toBeUndefined();
    });

    it('keeps her out through a later reply whose stale tracker lists her; the offscreen block is not the scene', async () => {
        const s = await setup({ pass: turnPass() });
        s.des = [{ name: 'Ильва', present: true, details: {} }];
        replyText(s, 'Ильва ушла.');
        await reply(s);
        await send(s);
        expect(s.engine.box.state.away?.ilva).toBeDefined();
        s.mock.chat.push(
            message('Брам заказал ещё пива.\n\n<offscreen>Ильва вернулась домой и легла спать.</offscreen>', {
                swipe_id: 0,
                swipes: ['Брам заказал ещё пива.'],
            }),
        );
        await reply(s, 4);
        // The pass sees neither her nor the offscreen block.
        const last = s.maestro.requests.at(-1)!.messages[1]!.content;
        expect(last).not.toContain('легла спать');
        await send(s, 4);
        const state = s.engine.box.state;
        expect(state.turn).toBe(2);
        expect(state.away?.ilva).toEqual({ since: 1, by: 'narration' });
        expect(state.next?.bands?.ilva).toBeUndefined();
    });

    it('brings her back when the next reply has her come in', async () => {
        const s = await setup({ pass: turnPass() });
        replyText(s, 'Ильва ушла.');
        await reply(s);
        await send(s);
        s.mock.chat.push(
            message('Вошла Ильва с охапкой дров.', { swipe_id: 0, swipes: ['Вошла Ильва с охапкой дров.'] }),
        );
        await reply(s, 4);
        await send(s, 4);
        expect(s.engine.box.state.away).toEqual({});
        expect(s.engine.box.state.next?.bands?.ilva).toBeDefined();
    });

    it('picks the «Elsewhere» line only while Maestro keeps the scene split', async () => {
        const pass = turnPass({ characters: [entry('ilva', { sceneGoal: 'see the rebels' })] });
        const split = await setup({ pass, split: true });
        replyText(split, 'Ильва накинула шаль и ушла.');
        await reply(split);
        await send(split);
        expect(split.engine.box.state.next?.elsewhere).toEqual([{ id: 'ilva', text: 'see the rebels' }]);

        const plain = await setup({ pass });
        replyText(plain, 'Ильва накинула шаль и ушла.');
        await reply(plain);
        await send(plain);
        expect(plain.engine.box.state.away?.ilva).toBeDefined();
        expect(plain.engine.box.state.next?.elsewhere).toBeUndefined();
    });
});

describe('turn module — newcomers (docs/model.md §10.2)', () => {
    it('asks about faces without a sheet or with a guessed one, and keeps what the reply showed for the generator', async () => {
        const pass = turnPass({
            newcomers: [
                {
                    name: 'Лиза',
                    role: 'daughter',
                    species: '',
                    relation: 'family',
                    relationNote: 'дочь Ильвы',
                    stanceHint: null,
                    reason: '',
                    groups: ['the household'],
                },
            ],
        });
        const s = await setup({
            pass,
            patch: (profiles, state) => {
                const kira = sketchProfile(
                    'Кира',
                    sampleParams('unknown', 'indifferent', [], seeded(2), 'even', { grounded: true, facts: null }),
                );
                profiles.push(kira);
                state.extras = [kira];
                state.rules = [];
                state.reputation = [
                    { among: 'the household', label: 'one of us', stance: 1, weaknesses: [], reasons: [] },
                ];
            },
        });
        s.des = [
            { name: 'Ильва', present: true, details: {} },
            { name: 'Лиза', present: true, details: {} },
            { name: 'Кира', present: true, details: {} },
        ];
        await reply(s);
        const request = s.maestro.requests[0]!;
        expect(request.messages[1]!.content).toContain('Newcomers: Лиза, Кира');
        expect(request.messages[1]!.content).toContain('World groups: the household');
        expect(JSON.stringify(request.schema)).toContain('"enum":["Лиза","Кира"]');
        await send(s);
        expect(s.engine.box.state.generator?.facts).toEqual([
            {
                name: 'Лиза',
                relation: 'family',
                source: 'turn',
                turn: 1,
                role: 'daughter',
                relationNote: 'дочь Ильвы',
                groups: ['the household'],
            },
        ]);
    });
});
