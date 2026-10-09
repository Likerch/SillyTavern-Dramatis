import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBus } from '../../src/core/bus';
import { createI18n } from '../../src/core/i18n';
import { Settings } from '../../src/core/settings';
import { PLAYER_ID } from '../../src/domain/model';
import type { CardProfiles, CharacterProfile, ChatState } from '../../src/domain/model';
import { matchName } from '../../src/domain/presence';
import { emptyCardProfiles } from '../../src/domain/profile-defaults';
import type { TurnPass } from '../../src/domain/turn-prompt';
import { ENGINE_API } from '../../src/features/engine/api';
import type { EngineApi, EngineView } from '../../src/features/engine/api';
import { ARC_KIND, STATE_TARGET, turnModule } from '../../src/features/turn';
import { TURN_STRINGS } from '../../src/features/turn/strings';
import type { ApiJournalChange, ApiLlmRequest, ApiLlmResult, ApiProposal } from '../../src/shared/apis';
import type { App, DesCharacter, DramatisSettings, Unsubscribe } from '../../src/shared/contracts';
import { seeded } from '../domain/appetites-fixtures';
import { TAVERN_PRESENT, tavern } from '../domain/cast-fixtures';
import { entry, event, turnPass } from '../domain/turn-fixtures';
import { fakeMaestro, memoryLogger, mockHost, staticBridge } from '../helpers/fakes';
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
    dispose(): Promise<void>;
}

async function setup(
    options: {
        levers?: Partial<DramatisSettings>;
        patch?: (profiles: CharacterProfile[], state: ChatState) => void;
        pass?: TurnPass;
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
    const maestro = fakeMaestro();
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
        modules: { api: (key: string) => (key === ENGINE_API ? engine.api : undefined) },
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
            },
        },
        ui: { notice: vi.fn() },
    } as unknown as App;
    result.app = app;
    const owned: Unsubscribe[] = [];
    await turnModule.init({
        app,
        settings: turnModule.defaults(),
        log,
        own: (dispose) => void owned.push(dispose as Unsubscribe),
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
        expect((s.journal[0]!.changes[0]!.before as ChatState).turn).toBe(0);

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
