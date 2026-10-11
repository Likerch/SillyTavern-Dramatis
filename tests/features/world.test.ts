// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createBus } from '../../src/core/bus';
import { createI18n } from '../../src/core/i18n';
import { defaultSettings } from '../../src/core/settings';
import { PLAYER_ID } from '../../src/domain/model';
import type { CharacterProfile, CharacterState, ChatState, Front } from '../../src/domain/model';
import { emptyAgenda, emptyCardProfiles } from '../../src/domain/profile-defaults';
import { ENGINE_API } from '../../src/features/engine/api';
import type { EngineApi, EngineView } from '../../src/features/engine/api';
import { WORLD_JOURNAL_KIND, WORLD_UNDO_TARGET, playerCanHear, restoreSnapshot, world } from '../../src/features/world';
import type { WorldSettings } from '../../src/features/world';
import { WORLD_STRINGS } from '../../src/features/world/strings';
import { TURN_API } from '../../src/features/turn/api';
import type { ApiJournalChange, DramatisApiV1 } from '../../src/shared/apis';
import type { App, DramatisSettings, Rng, SettingsSection, Unsubscribe } from '../../src/shared/contracts';
import { always, appState, appetite } from '../domain/appetites-fixtures';
import { chat, liveState, profile, tie } from '../domain/cast-fixtures';
import { fakeMaestro, freshSession, memoryLogger, staticBridge } from '../helpers/fakes';

/* ------------------------------------------------------------------ fixtures */

function front(filled: number): Front {
    return {
        impulse: 'control of the port',
        steps: ['buys up debts', 'pressures the captain', 'burns the warehouse'],
        doom: 'the port is theirs',
        clock: { segments: 6, filled },
        consequences: [{ kind: 'reputation', among: 'порт', delta: -1 }],
    };
}

function cast(): { profiles: CharacterProfile[]; state: ChatState } {
    const guild = profile('guild', 'Гильдия', {
        kind: 'group',
        lod: 'draft',
        agenda: { ...emptyAgenda(), resources: ['money'], front: front(2) },
    });
    const ilva = profile('ilva', 'Ильва', { lod: 'portrait', ties: [tie('grukk', 0)] });
    const grukk = profile('grukk', 'Грукк', {
        lod: 'draft',
        aliases: ['гоблин'],
        agenda: {
            ...emptyAgenda(),
            intentions: [
                {
                    id: 'i1',
                    text: 'carry off the merchant’s goods',
                    nextStep: 'ask the carters when the caravan leaves',
                    dropIf: [],
                    clock: { segments: 5, filled: 1 },
                },
            ],
        },
        appetites: [appetite({ id: 'plunder', kind: 'plunder', sources: ['culture'], drift: 'opportunity' })],
        ties: [tie('ilva', 0)],
    });
    const mira = profile('mira', 'Мира');
    const profiles = [guild, ilva, grukk, mira];
    const characters: Record<string, CharacterState> = {
        guild: liveState(guild, { present: false, knowsPlayer: false }),
        ilva: liveState(ilva),
        grukk: liveState(grukk, { present: false, appetites: { plunder: appState({ pressure: 1 }) } }),
        mira: liveState(mira, { present: false }),
    };
    return { profiles, state: chat(characters, { turn: 15 }) };
}

function fakeEngine(initial: EngineView) {
    let view = initial;
    const saves: ChatState[] = [];
    const api: EngineApi = {
        view: () => view,
        ready: async () => view,
        async updateState(mutate) {
            const clone = structuredClone(view.state);
            const result = mutate(clone, view) ?? clone;
            view = { ...view, state: result };
            saves.push(result);
            return true;
        },
        updateProfiles: async () => false,
        refresh: async () => {},
        resolve: (name) =>
            view.profiles.find((p) => p.id === name || p.name === name || p.aliases.includes(name))?.id ?? null,
        log: () => {},
        onChange: () => () => {},
    };
    return {
        api,
        saves,
        get state() {
            return view.state;
        },
        set state(state: ChatState) {
            view = { ...view, state };
        },
        setPresent(present: string[]) {
            view = { ...view, present };
        },
        clearView() {
            view = null as unknown as EngineView;
        },
    };
}

interface Setup {
    engine: ReturnType<typeof fakeEngine>;
    maestro: ReturnType<typeof fakeMaestro>;
    record: ReturnType<typeof vi.fn>;
    notices: { text: string; importance?: string }[];
    undo: () => (change: ApiJournalChange) => Promise<boolean>;
    leader: { value: boolean };
    scene: { place?: string; time?: string; date?: string };
    settings: WorldSettings;
    general: DramatisSettings;
    save: ReturnType<typeof vi.fn>;
    sections: SettingsSection[];
    part: () => Partial<DramatisApiV1>;
    chatId: { value: string | null };
    bus: ReturnType<typeof createBus>;
    commit(messageIndex?: number, turn?: number): Promise<void>;
    dispose(): Promise<void>;
}

async function setup(
    options: { rng?: Rng; state?: (s: ChatState) => void; present?: string[]; turnModule?: boolean } = {},
): Promise<Setup> {
    const { profiles, state } = cast();
    options.state?.(state);
    const view: EngineView = {
        card: { ...emptyCardProfiles('card.png'), characters: profiles },
        state,
        profiles,
        byId: new Map(profiles.map((p) => [p.id, p])),
        present: options.present ?? ['ilva'],
        unknown: [],
        bands: {},
        playerName: 'Курьер',
        greeting: 0,
    };
    const engine = fakeEngine(view);
    const maestro = fakeMaestro();
    const leader = { value: true };
    maestro.api.leader = { isLeader: () => leader.value, onChange: () => () => {} };
    const record = vi.fn(async () => 'j1');
    let undoHandler: ((change: ApiJournalChange) => Promise<boolean>) | null = null;
    maestro.api.journal = {
        record,
        registerUndo: (target, handler) => {
            expect(target).toBe(WORLD_UNDO_TARGET);
            undoHandler = handler;
            return () => {
                undoHandler = null;
            };
        },
    };
    const notices: { text: string; importance?: string }[] = [];
    maestro.api.notice = (text, opts) =>
        notices.push({ text, ...(opts?.importance ? { importance: opts.importance } : {}) });

    const log = memoryLogger();
    const bus = createBus(log);
    const i18n = createI18n(() => 'ru');
    i18n.register(WORLD_STRINGS);
    const general = defaultSettings();
    const save = vi.fn();
    const sections: SettingsSection[] = [];
    let part: Partial<DramatisApiV1> = {};
    const scene: Setup['scene'] = { place: 'Трактир' };
    const chatId = { value: 'chat-1' as string | null };
    const app = {
        modules: {
            api: (key: string) =>
                key === ENGINE_API
                    ? engine.api
                    : key === TURN_API && options.turnModule
                      ? { settle: async () => {} }
                      : undefined,
            expose: (key: string, value: unknown) => {
                if (key === 'api') part = value as Partial<DramatisApiV1>;
            },
        },
        i18n,
        maestro: staticBridge(maestro.api),
        readers: { des: { scene: () => ({ ...scene }) } },
        settings: { get: () => general, save },
        bus,
        host: { chatId: () => chatId.value },
        rng: options.rng ?? always(0.2),
        ui: {
            addSettingsSection: (section: SettingsSection) => {
                sections.push(section);
                return () => {
                    sections.splice(sections.indexOf(section), 1);
                };
            },
        },
    } as unknown as App;
    const settings = world.defaults();
    const owned: (Unsubscribe | (() => void | Promise<void>))[] = [];
    await world.init({ app, settings, log, own: (d) => owned.push(d), session: freshSession });
    return {
        engine,
        maestro,
        record,
        notices,
        undo: () => {
            if (!undoHandler) throw new Error('no undo handler');
            return undoHandler;
        },
        leader,
        scene,
        settings,
        general,
        save,
        sections,
        part: () => part,
        chatId,
        bus,
        async commit(messageIndex = 7, turn) {
            if (turn !== undefined) engine.state = { ...engine.state, turn };
            await bus.emit('turn:committed', { messageIndex });
        },
        async dispose() {
            for (const off of owned.splice(0).reverse()) await off();
        },
    };
}

const world0 = (s: ChatState) => {
    s.world = { lastTick: 0, ticks: 0, place: 'Трактир' };
};

/* ------------------------------------------------------------------ the module */

describe('world module', () => {
    it('is a stage-4 module that needs Maestro, on by default, with Russian strings for every key', () => {
        expect(world).toMatchObject({ key: 'world', stage: 4, enabledByDefault: true, needsMaestro: true });
        expect(world.defaults()).toEqual({ interval: 0, notices: true });
        expect(Object.keys(WORLD_STRINGS.ru).sort()).toEqual(Object.keys(WORLD_STRINGS.en).sort());
    });

    it('does nothing in a tab that is not the leader', async () => {
        const s = await setup({ state: world0 });
        s.leader.value = false;
        await s.commit();
        expect(s.engine.saves).toHaveLength(0);
        expect(s.record).not.toHaveBeenCalled();
    });

    it('with the turn module running, ticks after its commit (turn:applied), not on the sent message', async () => {
        const s = await setup({ state: world0, turnModule: true });
        // The message is sent: the turn module has not counted the turn yet (14), so nothing may tick on it.
        await s.commit(7, 14);
        expect(s.engine.saves).toHaveLength(0);
        // Its commit is saved: turn 15 is due.
        s.engine.state = { ...s.engine.state, turn: 15 };
        await s.bus.emit('turn:applied', { messageIndex: 7, turn: 15 });
        expect(s.engine.saves).toHaveLength(1);
        expect(s.engine.state.world).toMatchObject({ lastTick: 15, ticks: 1 });
        // A repeated announcement of the same turn ticks nothing more.
        await s.bus.emit('turn:applied', { messageIndex: 7, turn: 15 });
        expect(s.engine.saves).toHaveLength(1);
    });

    it('starts the world record on the first turns without ticking', async () => {
        const s = await setup();
        await s.commit(1, 2);
        expect(s.engine.saves).toHaveLength(1);
        expect(s.engine.state.world).toEqual({ lastTick: 0, ticks: 0, place: 'Трактир' });
        await s.commit(3, 3);
        expect(s.engine.saves).toHaveLength(1);
        expect(s.record).not.toHaveBeenCalled();
    });

    it('ticks every N turns: one action per absent actor, a localized log, a journal entry with a snapshot', async () => {
        const s = await setup({ state: world0 });
        await s.commit(7, 14);
        expect(s.engine.saves).toHaveLength(0);
        await s.commit(7, 15);
        expect(s.engine.saves).toHaveLength(1);
        const state = s.engine.state;
        expect(state.world).toEqual({ lastTick: 15, ticks: 1, place: 'Трактир' });
        expect(state.characters.guild!.offscreen).toHaveLength(1);
        expect(state.characters.grukk!.offscreen).toHaveLength(1);
        expect(state.characters.ilva!.offscreen).toBeUndefined();
        const lines = state.log.filter((line) => line.kind.startsWith('world.'));
        expect(lines.map((line) => line.text)).toEqual(
            expect.arrayContaining([
                'Гильдия за кадром: pressures the captain — получилось.',
                'Грукк за кадром: ask the carters when the caravan leaves — получилось.',
            ]),
        );
        expect(s.record).toHaveBeenCalledTimes(1);
        const action = s.record.mock.calls[0]![0] as {
            kind: string;
            summary: string;
            sourceMessage: number;
            changes: ApiJournalChange[];
        };
        expect(action.kind).toBe(WORLD_JOURNAL_KIND);
        expect(action.summary).toBe('Тик мира: действий за кадром — 2');
        expect(action.sourceMessage).toBe(7);
        expect(action.changes).toHaveLength(1);
        const change = action.changes[0]!;
        expect(change.target).toBe(WORLD_UNDO_TARGET);
        expect(change.ref).toEqual({ chatId: 'chat-1', tick: 15 });
        const before = change.before as { characters: Record<string, CharacterState> };
        expect(Object.keys(before.characters).sort()).toEqual(['grukk', 'guild']);
        expect(before.characters.guild!.agenda.front!.clock.filled).toBe(2);
        expect(change.after).toEqual({ lastTick: 15, ticks: 1 });
    });

    it('reads the chat’s own lever overrides (mode «Кино»: every 10 turns)', async () => {
        const s = await setup({
            state: (state) => {
                world0(state);
                state.overrides = { mode: 'cinema' };
            },
        });
        await s.commit(7, 10);
        expect(s.record).toHaveBeenCalledTimes(1);
        expect(s.engine.state.world!.lastTick).toBe(10);
    });

    it('takes the interval from its settings', async () => {
        const s = await setup({ state: world0 });
        s.settings.interval = 5;
        await s.commit(7, 5);
        expect(s.record).toHaveBeenCalledTimes(1);
        expect(s.engine.state.world!.lastTick).toBe(5);
    });

    it('ticks on a scene change and counts time skips from the last tick', async () => {
        const s = await setup({
            // Successes by one segment for the guild, partial successes for Грукк.
            rng: always(0.45),
            state: (state) => {
                state.world = { lastTick: 10, ticks: 1, place: 'Трактир', time: '08:00', date: 'Day 1' };
            },
        });
        s.scene.place = 'Трактир';
        s.scene.time = '09:00';
        s.scene.date = 'Day 1';
        await s.commit(7, 12);
        expect(s.record).not.toHaveBeenCalled();
        s.scene.place = 'Брод';
        await s.commit(9, 13);
        expect(s.record).toHaveBeenCalledTimes(1);
        expect(s.engine.state.world).toEqual({ lastTick: 13, ticks: 2, place: 'Брод', time: '09:00', date: 'Day 1' });
        s.scene.time = '09:00';
        s.scene.date = 'Day 3';
        await s.commit(11, 14);
        // 48 hours: three ticks in one go, one action per tick and actor.
        expect(s.engine.state.world!.ticks).toBe(5);
        expect(s.engine.state.characters.guild!.offscreen).toHaveLength(4);
        expect(s.engine.state.characters.grukk!.offscreen).toHaveLength(4);
        expect(s.engine.state.characters.guild!.agenda.front!.done).toBe(true);
        expect(s.engine.state.characters.grukk!.agenda.intentions).toEqual([]);
        expect(s.record).toHaveBeenCalledTimes(2);
    });

    it('announces a front coming to pass', async () => {
        const s = await setup({
            state: (state) => {
                world0(state);
                state.characters.guild!.agenda.front = front(5);
            },
        });
        await s.commit(7, 15);
        expect(s.notices).toEqual([{ text: 'Мир сдвинулся — Гильдия: the port is theirs', importance: 'important' }]);
        expect(s.engine.state.log.map((line) => line.text)).toEqual(
            expect.arrayContaining([
                'Сбылось — Гильдия: the port is theirs.',
                'Репутация (порт): нейтралитет → помехи (the port is theirs).',
            ]),
        );
    });

    it('tells «Слухи: …» only when the player could hear an exposed scheme', async () => {
        const exposedScheme = (state: ChatState) => {
            world0(state);
            state.schemes = [
                {
                    id: 's1',
                    owner: 'grukk',
                    target: 'mira',
                    method: 8,
                    text: 'cut her wagon off at the ford at dusk',
                    clock: { segments: 5, filled: 1 },
                    secrecy: 0,
                    breaches: 4,
                    accomplices: [],
                    state: 'running',
                    startedTurn: 5,
                },
            ];
        };
        // Грукк talks to Ильва, who is in the scene: the rumour reaches her this very tick.
        const heard = await setup({ rng: always(0.05), state: exposedScheme });
        await heard.commit(7, 15);
        expect(heard.engine.state.schemes[0]!.state).toBe('exposed');
        expect(heard.notices).toContainEqual({
            text: 'Слухи: Грукк schemes against Мира: cut her wagon off at the ford at dusk',
            importance: 'info',
        });

        // Nobody near the player talks to Грукк: the log only.
        const far = await setup({
            rng: always(0.05),
            state: (state) => {
                exposedScheme(state);
                state.characters.grukk!.ties = {};
                state.characters.ilva!.ties = {};
            },
        });
        await far.commit(7, 15);
        expect(far.engine.state.schemes[0]!.state).toBe('exposed');
        expect(far.notices.filter((n) => n.text.startsWith('Слухи'))).toEqual([]);
        expect(far.engine.state.log.map((line) => line.text)).toContain(
            'Замысел раскрыт: Грукк против Мира — cut her wagon off at the ford at dusk.',
        );
    });

    it('stays quiet when notices are off', async () => {
        const s = await setup({
            state: (state) => {
                world0(state);
                state.characters.guild!.agenda.front = front(5);
            },
        });
        s.settings.notices = false;
        await s.commit(7, 15);
        expect(s.notices).toEqual([]);
        expect(s.engine.state.characters.guild!.agenda.front!.done).toBe(true);
    });

    it('undoes the latest tick from the journal and refuses other chats and older ticks', async () => {
        const s = await setup({ state: world0 });
        const original = structuredClone(s.engine.state);
        await s.commit(7, 15);
        const change = (s.record.mock.calls[0]![0] as { changes: ApiJournalChange[] }).changes[0]!;

        s.chatId.value = 'chat-2';
        expect(await s.undo()(change)).toBe(false);
        s.chatId.value = 'chat-1';
        expect(await s.undo()({ ...change, before: 'garbage' })).toBe(false);
        expect(await s.undo()({ ...change, ref: { chatId: 'chat-1', tick: 3 } })).toBe(false);

        expect(await s.undo()(change)).toBe(true);
        const state = s.engine.state;
        expect(state.characters.guild).toEqual(original.characters.guild);
        expect(state.characters.grukk).toEqual(original.characters.grukk);
        expect(state.log.filter((line) => line.kind.startsWith('world.'))).toEqual([]);
        expect(state.world).toEqual({ lastTick: 15, ticks: 0, place: 'Трактир' });
    });

    it('restores missing characters as absent and keeps other log lines', () => {
        const { state } = cast();
        state.log = [
            { turn: 15, kind: 'world.attempt', text: 'x' },
            { turn: 15, kind: 'stance', text: 'kept' },
            { turn: 14, kind: 'world.attempt', text: 'older' },
        ];
        const next = restoreSnapshot(
            state,
            { characters: { mira: null }, rumours: [], schemes: [], reputation: [] },
            15,
        );
        expect(next.characters.mira).toBeUndefined();
        expect(next.log.map((line) => line.text)).toEqual(['kept', 'older']);
        expect(next.world).toBeUndefined();
    });

    it('publishes offscreenBrief and matureAgendas for Maestro', async () => {
        const s = await setup({
            state: (state) => {
                world0(state);
                state.characters.guild!.agenda.front = front(5);
            },
        });
        const part = s.part();
        expect(part.matureAgendas?.()).toEqual([
            {
                text: 'Гильдия: burns the warehouse (control of the port) — if nobody intervenes: the port is theirs',
                weight: 2.5,
            },
        ]);
        expect(part.offscreenBrief?.('Гильдия')).toBe(
            'Гильдия — Agenda: control of the port (5/6), next: burns the warehouse; if nobody intervenes: the port is theirs.',
        );
        await s.commit(7, 15);
        expect(part.offscreenBrief?.('гоблин')).toMatch(
            /^Грукк — Wants: carry off the merchant’s goods\. Since last seen: tried to ask the carters when the caravan leaves — succeeded \(3\/5\)\./,
        );
        expect(part.offscreenBrief?.('Никто')).toBeNull();
        s.engine.clearView();
        expect(part.offscreenBrief?.('Гильдия')).toBeNull();
        expect(part.matureAgendas?.()).toEqual([]);
    });

    it('decides audibility by the scene place and the present characters', () => {
        const { profiles, state } = cast();
        const view = { profiles, present: ['ilva'] } as unknown as EngineView;
        const rumour = {
            id: 'r',
            text: 't',
            about: PLAYER_ID,
            origin: 'x',
            carriers: [],
            reached: ['трактир'],
            turn: 1,
        };
        expect(playerCanHear(state, view, rumour, 'Трактир')).toBe(true);
        expect(playerCanHear(state, view, { ...rumour, reached: ['Ильва'] })).toBe(true);
        expect(playerCanHear(state, view, { ...rumour, reached: ['Грукк'] }, 'Трактир')).toBe(false);
    });

    it('has a «Живой мир» settings section that saves its values', async () => {
        const s = await setup();
        expect(s.sections).toHaveLength(1);
        const section = s.sections[0]!;
        expect(section).toMatchObject({ id: 'world', titleKey: 'world.settings.title' });
        const container = document.createElement('div');
        section.render(container);
        expect(container.textContent).toContain('Тик мира каждые N ходов');
        const number = container.querySelector('input[type="number"]') as HTMLInputElement;
        number.value = '20';
        number.dispatchEvent(new Event('change'));
        expect(s.settings.interval).toBe(20);
        const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change'));
        expect(s.settings.notices).toBe(false);
        expect(s.save).toHaveBeenCalledTimes(2);
    });

    it('releases its listener, undo handler and section when stopped', async () => {
        const s = await setup({ state: world0 });
        await s.dispose();
        await s.commit(7, 15);
        expect(s.engine.saves).toHaveLength(0);
        expect(s.sections).toEqual([]);
        expect(() => s.undo()).toThrow();
    });

    it('waits for the engine: no view, no tick', async () => {
        const s = await setup({ state: world0 });
        s.engine.clearView();
        await s.commit(7);
        expect(s.record).not.toHaveBeenCalled();
    });
});
