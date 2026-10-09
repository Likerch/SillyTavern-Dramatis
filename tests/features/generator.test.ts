import { describe, expect, it, vi } from 'vitest';
import { createApiPublisher } from '../../src/app/api';
import { Modules } from '../../src/app/module-manager';
import { createBus } from '../../src/core/bus';
import { createI18n } from '../../src/core/i18n';
import { Settings } from '../../src/core/settings';
import { PLAYER_ID } from '../../src/domain/model';
import type { AppetiteRule, CardProfiles, CharacterProfile, ChatState, StateEvent } from '../../src/domain/model';
import { matchName, presentFromDes } from '../../src/domain/presence';
import { emptyCardProfiles, setMeta } from '../../src/domain/profile-defaults';
import { ensureCharacterState, initChatState } from '../../src/domain/state-init';
import { ENGINE_API } from '../../src/features/engine/api';
import type { EngineApi, EngineView } from '../../src/features/engine/api';
import { GROUNDED_SYSTEM_PROMPT } from '../../src/domain/generator';
import type { CardBookEntry } from '../../src/domain/intent-prompt';
import { JOURNAL_KIND, JOURNAL_TARGET, generatorModule, identityOf, roleSources } from '../../src/features/generator';
import { GENERATOR_API } from '../../src/features/generator/api';
import type { GeneratorApi } from '../../src/features/generator/api';
import { TURN_API } from '../../src/features/turn/api';
import type { ApiJournalChange, ApiLlmRequest, ApiLlmResult } from '../../src/shared/apis';
import type {
    App,
    ArchiveSheet,
    CardSource,
    DesCharacter,
    DramatisModule,
    LlmRouter,
} from '../../src/shared/contracts';
import { seeded } from '../domain/appetites-fixtures';
import { profile as makeProfile } from '../domain/cast-fixtures';
import { GUARDIAN_CARD } from '../domain/guardian-fixtures';
import { fakeMaestro, memoryLogger, staticBridge } from '../helpers/fakes';

/* ------------------------------------------------------------------ a fake engine */

function fakeEngine(card: CardProfiles, state: ChatState, cast: () => DesCharacter[]) {
    let current = { card, state };
    const listeners = new Set<(view: EngineView | null) => void>();
    const logs: StateEvent[] = [];
    const build = (): EngineView => {
        const profiles = [...current.card.characters, ...current.state.extras];
        const { present, unknown } = presentFromDes(cast(), profiles);
        return {
            card: current.card,
            state: current.state,
            profiles,
            byId: new Map(profiles.map((profile) => [profile.id, profile] as const)),
            present,
            unknown,
            bands: {},
            playerName: 'Курьер',
            greeting: 0,
        };
    };
    const emit = () => {
        const view = build();
        for (const listener of [...listeners]) listener(view);
    };
    const engine: EngineApi = {
        view: build,
        ready: async () => build(),
        async updateState(mutate) {
            const clone = structuredClone(current.state);
            const next = mutate(clone, build()) ?? clone;
            current = { ...current, state: next };
            emit();
            return true;
        },
        async updateProfiles(mutate) {
            const clone = structuredClone(current.card);
            const next = mutate(clone, build()) ?? clone;
            const state = structuredClone(current.state);
            for (const profile of next.characters) ensureCharacterState(state, profile);
            current = { card: next, state };
            emit();
            return true;
        },
        async refresh() {
            emit();
        },
        resolve: (name) => matchName(name, build().profiles),
        log: (events) => void logs.push(...events),
        onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    return {
        engine,
        logs,
        get state() {
            return current.state;
        },
        get card() {
            return current.card;
        },
        /** The engine's own scene pass: a new scene. */
        async nextScene() {
            await engine.updateState((s) => {
                s.scene += 1;
                s.turn += 1;
            });
        },
    };
}

/* ------------------------------------------------------------------ candidates the fake model returns */

function candidates(): { candidates: Record<string, unknown>[] } {
    const one = (n: number, fit: number, typicality: number) => ({
        concept: `Concept ${n}`,
        want: `want ${n}`,
        need: `need ${n}`,
        wound: { ghost: `ghost ${n}`, lie: `lie ${n}`, triggers: ['smoke'], coping: 'avoid' },
        goals: [
            {
                text: `wants the gate quiet ${n} because of the captain, but smugglers pay`,
                kind: 'external',
                priority: 1,
            },
            { text: `wants respect ${n}`, kind: 'internal', priority: 2 },
        ],
        dream: `dream ${n}`,
        intentions: [{ text: `intention ${n}`, nextStep: 'ask around', dropIf: ['caught'] }],
        signatures: [`if bribed → looks away ${n}`, `if mocked → remembers ${n}`],
        keys: [`only deeds ${n}`],
        redLinesNever: ['never betrays the watch'],
        redLinesWould: ['takes a bribe'],
        voice: 'Бумаги. Живо.',
        moodLabel: 'tired and sour',
        doing: `checking a cart ${n}`,
        sceneGoal: 'get through the shift',
        stanceBehaviour: `makes him wait ${n}`,
        stanceReason: 'another stranger at the gate',
        secrets: ['takes smugglers’ coin'],
        leverage: ['his debts'],
        resources: ['the gate key'],
        ifIgnored: 'lets the smugglers through',
        appetites: [],
        summary: `Take ${n}`,
        fit,
        typicality,
    });
    return { candidates: [one(1, 4, 2), one(2, 5, 1), one(3, 3, 4)] };
}

/* ------------------------------------------------------------------ the rig */

function said(mes: string, isUser = false): STChatMessage {
    return { name: isUser ? 'Курьер' : 'Рассказчик', is_user: isUser, is_system: false, send_date: '', mes };
}

interface RigOptions {
    cast?: DesCharacter[];
    card?: (card: CardProfiles) => CardProfiles;
    state?: (state: ChatState) => ChatState;
    archives?: ArchiveSheet[];
    leader?: boolean;
    settings?: Record<string, unknown>;
    chat?: STChatMessage[];
    /** The open card (grounded fills read it); none by default. */
    cardSource?: CardSource;
    cardBook?: CardBookEntry[];
}

async function rig(options: RigOptions = {}) {
    const log = memoryLogger();
    const store: Record<string, unknown> = {};
    const settings = new Settings(
        () => store,
        () => {},
        log,
    );
    for (const [key, value] of Object.entries(options.settings ?? {})) {
        settings.set(key as 'mode', value as 'balanced');
    }
    const bus = createBus(log);
    const i18n = createI18n(() => 'ru');
    const maestro = fakeMaestro();
    const styleUp = vi.fn<(name: string, tags: string[]) => Promise<boolean>>(async () => true);
    const setCanonGoals = vi.fn<(name: string, goals: string[]) => Promise<boolean>>(async () => true);
    const notices: string[] = [];
    const records: { kind: string; summary: string; changes: ApiJournalChange[] }[] = [];
    let undo: ((change: ApiJournalChange) => Promise<boolean>) | null = null;
    const tasks: string[] = [];
    let leader = options.leader ?? true;
    maestro.api.styleUp = styleUp;
    maestro.api.setCanonGoals = setCanonGoals;
    maestro.api.notice = (text) => void notices.push(text);
    maestro.api.journal = {
        record: async (action) => {
            records.push(action);
            return `j${records.length}`;
        },
        registerUndo: (target, handler) => {
            if (target === JOURNAL_TARGET) undo = handler;
            return () => {};
        },
    };
    maestro.api.llm.registerTask = (id) => {
        tasks.push(id);
        return () => {};
    };
    maestro.api.leader = { isLeader: () => leader, onChange: () => () => {} };
    maestro.reply = (): ApiLlmResult => ({ ok: true, data: candidates() });
    const bridge = staticBridge(maestro.api);

    let card = emptyCardProfiles('card.png');
    card = options.card ? options.card(card) : card;
    let state = initChatState(card, 0, 'card.png');
    state = options.state ? options.state(state) : state;
    const cast = { list: options.cast ?? [] };
    const engine = fakeEngine(card, state, () => cast.list);
    // A reply the user already answered: its DES cast is committed (the fake DES gives the same cast for every reply).
    const chat: STChatMessage[] = options.chat ?? [said('У ворот людно.'), said('Иду к воротам.', true)];

    const llm: LlmRouter = {
        request: (request) => maestro.api.llm.request(request as ApiLlmRequest) as never,
        available: () => true,
        viaMaestro: () => true,
    };
    const publisher = createApiPublisher({ version: '0.0.1', settings, bus, log });
    const modules = new Modules({
        settings,
        bridge,
        bus,
        log,
        registerApiPart: (part) => publisher.registerPart(part),
    });
    const archives = options.archives ?? [];
    const app = {
        version: '0.0.1',
        host: { ctx: () => ({ chat }), chatId: () => 'chat-1' },
        log,
        i18n,
        settings,
        bus,
        readers: {
            des: {
                available: () => true,
                lastCast: () => cast.list,
                castAt: () => cast.list,
                scene: () => ({}),
                roster: () => [],
                aliases: () => ({}),
            },
            lore: {
                archives: async (names: string[]) =>
                    archives.filter((sheet) => names.some((name) => name.toLowerCase() === sheet.name.toLowerCase())),
                cardBook: async () => options.cardBook ?? [],
            },
            card: { current: () => options.cardSource ?? null, greetingIndex: () => 0 },
        },
        maestro: bridge,
        llm,
        ui: { notice: (text: string) => void notices.push(text) },
        rng: seeded(7),
        modules,
    } as unknown as App;
    modules.expose(ENGINE_API, engine.engine);
    modules.register([generatorModule as DramatisModule], (module) => {
        if (module.i18n) i18n.register(module.i18n);
    });
    await modules.startAll(app);
    const api = modules.api<GeneratorApi>(GENERATOR_API)!;
    const settle = async () => {
        for (let i = 0; i < 6; i++) await api.idle();
    };
    await settle();
    return {
        api,
        engine,
        maestro,
        bus,
        styleUp,
        setCanonGoals,
        notices,
        records,
        tasks,
        cast,
        chat,
        settle,
        undo: () => undo,
        setLeader: (value: boolean) => {
            leader = value;
        },
        modules,
    };
}

function authored(id: string, name: string, patch: Partial<CharacterProfile> = {}): CharacterProfile {
    let profile = makeProfile(id, name, { lod: 'draft', ...patch });
    profile = {
        ...profile,
        core: {
            ...profile.core,
            values: { top: ['security'] },
            temperament: { honesty: 1 },
            drives: { high: ['family'], low: [] },
            want: 'keep the inn',
            signatures: ['if ordered → slow'],
            tactics: ['silence'],
            keys: ['her daughter'],
            ...patch.core,
        },
    };
    return setMeta(profile, 'core', { origin: 'author' });
}

const ilva = (): CharacterProfile => authored('ilva', 'Ильва', { role: 'innkeeper' });
const guardCast = (): DesCharacter[] => [
    { name: 'Ильва', present: true, details: {} },
    { name: 'Стражник', present: true, details: { role: 'стражник у ворот' }, thoughts: 'Опять этот курьер.' },
];

/* ------------------------------------------------------------------ tests */

describe('generator module', () => {
    it('registers its task and API, and stays code-only for sketches', async () => {
        const r = await rig({
            card: (c) => ({ ...c, characters: [ilva()] }),
            cast: [{ name: 'Ильва', present: true, details: {} }],
        });
        expect(r.tasks).toEqual(['dramatis.generate']);
        expect(r.api.busy()).toEqual([]);
        expect(r.maestro.requests).toHaveLength(0);
        expect(r.engine.state.extras).toEqual([]);
    });

    it('sketches an unknown face at once, without the model: role from DES, live state, journal and notice', async () => {
        const r = await rig({ card: (c) => ({ ...c, characters: [ilva()] }), cast: guardCast() });
        const extras = r.engine.state.extras;
        expect(extras).toHaveLength(1);
        const guard = extras[0]!;
        expect(guard).toMatchObject({ name: 'Стражник', lod: 'sketch', role: 'guard' });
        expect(guard.core.values.top).toHaveLength(3);
        expect(guard.ties[0]!.target).toBe(PLAYER_ID);
        const live = r.engine.state.characters[guard.id]!;
        expect(live).toMatchObject({ present: true, knowsPlayer: true });
        expect(live.stats).toEqual({ scenes: 1, lastScene: 0, interactions: 0, present: true });
        expect(live.scene.doing).toBeTruthy();
        expect(r.maestro.requests).toHaveLength(0);
        expect(r.records).toHaveLength(1);
        expect(r.records[0]).toMatchObject({ kind: JOURNAL_KIND, summary: 'Новое лицо: Стражник — эскиз, стражник' });
        expect(r.records[0]!.changes[0]).toMatchObject({
            target: JOURNAL_TARGET,
            before: null,
            ref: { store: 'extras', id: guard.id },
        });
        expect(r.notices).toEqual(['Новое лицо: Стражник (стражник)']);
        expect(r.engine.logs[0]).toMatchObject({ kind: 'generator.new', text: 'Стражник' });
        // Already known: nothing more on the next change.
        await r.engine.engine.refresh();
        await r.settle();
        expect(r.engine.state.extras).toHaveLength(1);
        expect(r.records).toHaveLength(1);
    });

    it('counts scenes, promotes to a draft in the background, then to a portrait that gets BunnyMo tags', async () => {
        const chat = [said('Стражник загораживает ворота.'), said('Ну что, Стражник, пропустишь?', true)];
        const r = await rig({ card: (c) => ({ ...c, characters: [ilva()] }), cast: guardCast(), chat });
        const id = r.engine.state.extras[0]!.id;
        await r.bus.emit('turn:committed', { messageIndex: -1 });
        await r.settle();
        expect(r.engine.state.characters[id]!.stats).toMatchObject({ scenes: 1, interactions: 1 });
        expect(r.maestro.requests).toHaveLength(0);
        for (let i = 0; i < 2; i++) {
            await r.engine.nextScene();
            await r.bus.emit('turn:committed', { messageIndex: 5 });
            await r.settle();
        }
        expect(r.engine.state.characters[id]!.stats).toMatchObject({ scenes: 3, interactions: 1 });
        // Earned, but the generation the message started runs now: the model is asked once its reply is in.
        expect(r.maestro.requests).toHaveLength(0);
        await r.bus.emit('reply:ready', { messageIndex: 6 });
        await r.settle();
        expect(r.maestro.requests).toHaveLength(1);
        const draftRequest = r.maestro.requests[0]!;
        expect(draftRequest).toMatchObject({ task: 'dramatis.generate', background: true });
        expect(draftRequest.schema?.name).toBe('dramatis_generate');
        expect(draftRequest.messages[1]!.content).toMatch(/level of a DRAFT/);
        expect(draftRequest.messages[1]!.content).toMatch(/Role: guard/);
        let guard = r.engine.state.extras[0]!;
        expect(guard.lod).toBe('draft');
        expect(guard.core.want).toMatch(/^want [123]$/);
        expect(guard.core.signatures).toHaveLength(2);
        expect(r.engine.state.characters[id]!.scene.doing).toMatch(/^checking a cart/);
        expect(r.setCanonGoals).toHaveBeenCalledWith(
            'Стражник',
            expect.arrayContaining([expect.stringMatching(/wants the gate quiet/)]),
        );
        expect(r.styleUp).not.toHaveBeenCalled();
        expect(r.records.at(-1)!.summary).toMatch(/Стражник: Эскиз → Набросок|Стражник: .* → .*/);
        // The sheet's button: a portrait now (interactive request).
        const outcome = await r.api.promote(id, 'portrait');
        expect(outcome.ok).toBe(true);
        expect(outcome.written).toEqual(expect.arrayContaining(['core.wound', 'agenda.secrets']));
        expect(r.maestro.requests).toHaveLength(2);
        expect(r.maestro.requests[1]).toMatchObject({ background: false });
        expect(r.maestro.requests[1]!.messages[1]!.content).toMatch(/PORTRAIT/);
        guard = r.engine.state.extras[0]!;
        expect(guard.lod).toBe('portrait');
        expect(guard.core.want).toBe(r.engine.state.extras[0]!.core.want);
        expect(r.styleUp).toHaveBeenCalledTimes(1);
        const [name, tags] = r.styleUp.mock.calls[0]!;
        expect(name).toBe('Стражник');
        expect(tags.some((tag) => tag.startsWith('DERE:'))).toBe(true);
        expect(tags.some((tag) => /^MBTI:[EI][NS][FT][JP]-[HU]$/.test(tag))).toBe(true);
        // Already a portrait: nothing to do.
        expect(await r.api.promote(id, 'draft')).toEqual({ ok: true, written: [] });
        expect(r.maestro.requests).toHaveLength(2);
    });

    it('reads a CK archive instead of styling one', async () => {
        const r = await rig({
            cast: [{ name: 'Серафина', present: true, details: {} }],
            archives: [
                {
                    name: 'Серафина',
                    book: 'repo',
                    uid: 1,
                    tags: [
                        { key: 'SPECIES', value: 'LAMIA' },
                        { key: 'ATTACHMENT', value: 'ANXIOUS' },
                        { key: 'VICE', value: 'DRINKING' },
                    ],
                    mbti: { type: 'INFP', variant: 'U' },
                },
            ],
        });
        const id = r.engine.state.extras[0]!.id;
        const outcome = await r.api.promote(id, 'portrait');
        expect(outcome.ok).toBe(true);
        const sera = r.engine.state.extras[0]!;
        expect(sera.species).toBe('lamia');
        expect(sera.core.attachment).toEqual({ anxiety: 2, avoidance: 0 });
        expect(sera.core.wound?.coping).toBe('avoid');
        expect(sera.appetites.map((item) => item.kind)).toEqual(['drink']);
        expect(r.engine.state.characters[id]!.appetites[sera.appetites[0]!.id]).toBeDefined();
        expect(r.maestro.requests[0]!.messages[1]!.content).toContain('<tags>');
        expect(r.styleUp).not.toHaveBeenCalled();
    });

    it('does not style portraits when automatic archives are off', async () => {
        const r = await rig({
            cast: [{ name: 'Брам', present: true, details: {} }],
            settings: { autoArchives: false },
        });
        await r.api.promote(r.engine.state.extras[0]!.id, 'portrait');
        expect(r.styleUp).not.toHaveBeenCalled();
        expect(r.setCanonGoals).toHaveBeenCalled();
    });

    it('with the turn module running, counts a turn after its commit (turn:applied), not on the sent message', async () => {
        const r = await rig({ cast: [{ name: 'Брам', present: true, details: {} }] });
        const id = r.engine.state.extras[0]!.id;
        const scenes = r.engine.state.characters[id]!.stats!.scenes;
        r.modules.expose(TURN_API, { settle: async () => {} });
        await r.engine.nextScene();
        await r.bus.emit('turn:committed', { messageIndex: 0 });
        await r.settle();
        expect(r.engine.state.characters[id]!.stats!.scenes).toBe(scenes);
        await r.bus.emit('turn:applied', { messageIndex: 0, turn: 1 });
        await r.settle();
        expect(r.engine.state.characters[id]!.stats!.scenes).toBe(scenes + 1);
    });

    it('leaves background work to the leader tab and retries quietly later', async () => {
        const r = await rig({ cast: [{ name: 'Брам', present: true, details: {} }], leader: false });
        const id = r.engine.state.extras[0]!.id;
        expect(r.engine.state.extras).toHaveLength(1);
        await r.api.pin(id, false);
        const scenes = r.engine.state.characters[id]!.stats?.scenes;
        for (let i = 0; i < 2; i++) {
            await r.engine.nextScene();
            await r.bus.emit('turn:committed', { messageIndex: 0 });
            await r.settle();
        }
        expect(r.maestro.requests).toHaveLength(0);
        // The leading tab counts this chat's turns: a second tab counting them too would count each twice.
        expect(r.engine.state.characters[id]!.stats?.scenes).toBe(scenes);
        r.setLeader(true);
        r.maestro.reply = () => ({ ok: false, error: 'cap' });
        for (let i = 0; i < 2; i++) {
            await r.engine.nextScene();
            await r.bus.emit('turn:committed', { messageIndex: 0 });
            await r.bus.emit('reply:ready', { messageIndex: 1 });
            await r.settle();
        }
        expect(r.maestro.requests).toHaveLength(1);
        expect(r.engine.state.extras[0]!.lod).toBe('sketch');
        r.maestro.reply = () => ({ ok: true, data: candidates() });
        await r.engine.nextScene();
        await r.bus.emit('turn:committed', { messageIndex: 0 });
        await r.bus.emit('reply:ready', { messageIndex: 1 });
        await r.settle();
        expect(r.maestro.requests).toHaveLength(2);
        expect(r.engine.state.extras[0]!.lod).toBe('draft');
    });

    it('promotes a pinned face to a portrait', async () => {
        const r = await rig({ cast: [{ name: 'Брам', present: true, details: {} }] });
        const id = r.engine.state.extras[0]!.id;
        const outcome = await r.api.pin(id, true);
        expect(outcome.ok).toBe(true);
        expect(r.engine.state.characters[id]!.stats?.pinned).toBe(true);
        expect(r.engine.state.extras[0]!.lod).toBe('portrait');
        expect((await r.api.pin('nobody', true)).ok).toBe(false);
    });

    it('fills the gaps of authored characters after the intent reading, except in economy mode', async () => {
        const empty = () => makeProfile('fenn', 'Фенн', { lod: 'draft', role: 'peasant' });
        const withIntent = (c: CardProfiles): CardProfiles => ({
            ...c,
            characters: [ilva(), empty()],
            intent: { at: 1, sourcesHash: 'h' },
        });
        const cast: DesCharacter[] = [
            { name: 'Ильва', present: true, details: {} },
            { name: 'Фенн', present: true, details: {} },
        ];
        const economy = await rig({ card: withIntent, cast, settings: { mode: 'economy' } });
        expect(economy.maestro.requests).toHaveLength(0);
        const noIntent = await rig({ card: (c) => ({ ...c, characters: [ilva(), empty()] }), cast });
        expect(noIntent.maestro.requests).toHaveLength(0);
        const r = await rig({ card: withIntent, cast });
        expect(r.maestro.requests).toHaveLength(1);
        expect(r.maestro.requests[0]!.messages[1]!.content).toMatch(/fill ONLY these empty fields/);
        const fenn = r.engine.card.characters.find((item) => item.id === 'fenn')!;
        expect(fenn.core.values.top.length).toBeGreaterThan(0);
        expect(fenn.core.want).toMatch(/^want/);
        expect(fenn.lod).toBe('draft');
        const kept = r.engine.card.characters.find((item) => item.id === 'ilva')!;
        expect(kept).toEqual(ilva());
        expect(r.records.at(-1)!.summary).toMatch(/^Фенн: дописаны пустые поля/);
        expect(r.notices).toContain('Фенн: пустые поля дописаны');
        // The sheet's button on the main character: only its own gaps.
        const outcome = await r.api.fillGaps('ilva');
        expect(outcome.ok).toBe(true);
        expect(outcome.written).not.toContain('core.want');
        expect(r.engine.card.characters.find((item) => item.id === 'ilva')!.core.want).toBe('keep the inn');
        expect(r.styleUp).not.toHaveBeenCalled();
    });

    it('fills a card character from the card itself — no dice — and keeps the dice for the others', async () => {
        let mirelle = makeProfile('mirelle-varrow', 'Mirelle Varrow', { lod: 'portrait', role: 'adoptive mother' });
        mirelle = setMeta(
            { ...mirelle, core: { ...mirelle.core, concept: 'An ancient sorceress raising the child she adopted' } },
            'core.concept',
            { origin: 'inferred' },
        );
        const fenn = makeProfile('fenn', 'Фенн', { lod: 'draft', role: 'peasant' });
        const fromCard = {
            candidates: [
                {
                    values: ['benevolence', 'security', 'power'],
                    sacrifice: 'universalism',
                    temperament: { emotionality: 2, agreeableness: -1 },
                    drivesHigh: ['family', 'power'],
                    drivesLow: ['status'],
                    tactics: ['intimidation'],
                    proactivity: 6,
                    moodOctant: 'relaxed',
                    moodLabel: 'calm and motherly',
                    want: 'Kai safe and grown',
                    signatures: ['if Kai is threatened → turns merciless'],
                    keys: ['Kai learning what she did'],
                    concept: 'A cult leader',
                    appetites: [
                        {
                            kind: 'thrill',
                            label: 'teaching caution',
                            baseline: 3,
                            target: 'thing',
                            targetClass: '',
                            triggers: [],
                            excuse: '',
                        },
                    ],
                    summary: 'From the card',
                    fit: 5,
                    typicality: 2,
                },
            ],
        };
        const r = await rig({
            card: (c) => ({ ...c, characters: [mirelle, fenn], intent: { at: 1, sourcesHash: 'h' } }),
            cast: [
                { name: 'Mirelle Varrow', present: true, details: {} },
                { name: 'Фенн', present: true, details: {} },
            ],
            cardSource: GUARDIAN_CARD,
            cardBook: [{ uid: 1, keys: ['Mirelle'], comment: 'The witch', content: 'Mirelle keeps a grimoire.' }],
            // No fills by themselves: the sheet's button asks for them below.
            settings: { mode: 'economy' },
        });
        expect(r.maestro.requests).toHaveLength(0);
        r.maestro.reply = (request) =>
            request.messages[0]!.content === GROUNDED_SYSTEM_PROMPT
                ? { ok: true, data: fromCard }
                : { ok: true, data: candidates() };
        await r.api.fillGaps('mirelle-varrow');
        await r.api.fillGaps('fenn');
        const asked = r.maestro.requests.filter((request) => request.messages[0]!.content === GROUNDED_SYSTEM_PROMPT);
        expect(asked).toHaveLength(1);
        const text = asked[0]!.messages[1]!.content;
        expect(text).toContain('<sources>\n[Card description]\nMirelle Varrow is an elven sorceress');
        expect(text).toContain('[Lorebook · The witch]\nMirelle keeps a grimoire.');
        expect(text).not.toContain('<params>');
        const after = r.engine.card.characters.find((item) => item.id === 'mirelle-varrow')!;
        expect(after.core.drives).toEqual({ high: ['family', 'power'], low: ['status'] });
        expect(after.core.values.top).toEqual(['benevolence', 'security', 'power']);
        expect(after.core.baselineMood).toEqual({ octant: 'relaxed', label: 'calm and motherly' });
        expect(after.core.concept).toBe('An ancient sorceress raising the child she adopted');
        expect(after.appetites).toEqual([]);
        // Фенн is nobody the card wrote: the dice still decide his core.
        const dice = r.maestro.requests.filter((request) => request.messages[0]!.content !== GROUNDED_SYSTEM_PROMPT);
        expect(dice.some((request) => request.messages[1]!.content.includes('<params>'))).toBe(true);
        const fennAfter = r.engine.card.characters.find((item) => item.id === 'fenn')!;
        expect(fennAfter.core.values.top.length).toBeGreaterThan(0);
        expect(fennAfter.agenda.secrets).toEqual([]);
    });

    it('waits with gap fills while a generation runs', async () => {
        const empty = () => makeProfile('fenn', 'Фенн', { lod: 'draft', role: 'peasant' });
        const cast: DesCharacter[] = [{ name: 'Фенн', present: true, details: {} }];
        const r = await rig({ card: (c) => ({ ...c, characters: [empty()] }), cast });
        expect(r.maestro.requests).toHaveLength(0);
        await r.bus.emit('generation:before', { type: 'normal', dryRun: false, quiet: false });
        // The intent reading lands while the generation runs.
        await r.engine.engine.updateProfiles((card) => ({ ...card, intent: { at: 1, sourcesHash: 'h' } }));
        await r.settle();
        expect(r.maestro.requests).toHaveLength(0);
        // A quiet call of another extension ending is not the generation ending.
        await r.bus.emit('generation:before', { type: 'quiet', dryRun: false, quiet: true });
        await r.engine.engine.refresh();
        await r.settle();
        expect(r.maestro.requests).toHaveLength(0);
        await r.bus.emit('generation:ended', { type: 'normal', stopped: false });
        await r.settle();
        expect(r.maestro.requests).toHaveLength(1);
        expect(r.maestro.requests[0]!.messages[1]!.content).toMatch(/fill ONLY these empty fields/);
    });

    it('sketches only the faces of a committed reply: a reply still open to swipes leaves nothing', async () => {
        const r = await rig({
            card: (c) => ({ ...c, characters: [ilva()] }),
            cast: guardCast(),
            chat: [said('Стражник загораживает ворота.')],
        });
        expect(r.engine.state.extras).toHaveLength(0);
        await r.engine.engine.refresh();
        await r.settle();
        expect(r.engine.state.extras).toHaveLength(0);
        expect(r.records).toHaveLength(0);
        // The player answers: the reply is committed and its faces are sketched.
        r.chat.push(said('Пропусти.', true));
        await r.bus.emit('turn:committed', { messageIndex: 0 });
        await r.settle();
        expect(r.engine.state.extras.map((profile) => profile.name)).toEqual(['Стражник']);
    });

    it('draws group rules for a new face and again when the rules change', async () => {
        const rule: AppetiteRule = {
            id: 'tolls',
            holders: 'the gate guards',
            kind: 'plunder',
            source: 'culture',
            target: { mode: 'class', class: 'travellers' },
            intensity: { zero: 0, low: 0, mid: 0, high: 1 },
            styles: { buyer: 1 },
            choosiness: 0,
            exclusivity: 'shared',
            affectionOnset: 'rare',
            groupMode: 'pack',
        };
        const r = await rig({
            card: (c) => ({ ...c, characters: [ilva()] }),
            cast: guardCast(),
            state: (s) => ({ ...s, rules: [rule] }),
        });
        const guard = r.engine.state.extras[0]!;
        expect(guard.appetites).toHaveLength(1);
        expect(guard.appetites[0]).toMatchObject({ rule: 'tolls', kind: 'plunder' });
        expect(r.engine.state.characters[guard.id]!.appetites[guard.appetites[0]!.id]).toBeDefined();
        expect(guard.ties.some((item) => item.want !== undefined)).toBe(true);
        // A new rule for innkeepers reaches the authored innkeeper.
        const second: AppetiteRule = {
            ...rule,
            id: 'hoarding',
            holders: 'innkeepers',
            kind: 'luxury',
            target: { mode: 'thing' },
        };
        await r.engine.engine.updateState((s) => {
            s.rules = [rule, second];
        });
        await r.settle();
        const ilvaNow = r.engine.card.characters.find((item) => item.id === 'ilva')!;
        expect(ilvaNow.appetites.map((item) => item.rule)).toEqual(['hoarding']);
        expect(r.engine.state.characters.ilva!.appetites[ilvaNow.appetites[0]!.id]).toBeDefined();
        expect(r.records.at(-1)!.summary).toBe('Применены правила влечений: Ильва');
    });

    it('undoes a new face for good', async () => {
        const r = await rig({ card: (c) => ({ ...c, characters: [ilva()] }), cast: guardCast() });
        const change = r.records[0]!.changes[0]!;
        expect(await r.undo()!(change)).toBe(true);
        expect(r.engine.state.extras).toEqual([]);
        expect(r.engine.state.generator?.dismissed).toEqual(['Стражник']);
        await r.engine.engine.refresh();
        await r.settle();
        expect(r.engine.state.extras).toEqual([]);
        expect(await r.undo()!({ ...change, ref: { store: 'elsewhere', id: 'x' } })).toBe(false);
    });

    it('stops cleanly and reports busy or unknown characters', async () => {
        const r = await rig({ cast: [{ name: 'Брам', present: true, details: {} }] });
        expect(await r.api.fillGaps('nobody')).toMatchObject({ ok: false, error: 'unknown' });
        expect(await r.api.promote('nobody', 'sketch')).toEqual({ ok: true, written: [] });
        await r.modules.disable('generator');
        expect(r.modules.api(GENERATOR_API)).toBeUndefined();
    });
});

describe('DES hints', () => {
    it('weighs role-like details over thoughts and reads identity', () => {
        const sources = roleSources('Марта', {
            name: 'Марта',
            present: true,
            details: { occupation: 'трактирщица', look: 'tall' },
            thoughts: 'солдаты',
        });
        expect(sources).toEqual([
            { text: 'Марта', weight: 3 },
            { text: 'трактирщица', weight: 3 },
            { text: 'tall', weight: 1 },
            { text: 'солдаты', weight: 0.5 },
        ]);
        expect(identityOf({ name: 'X', present: true, details: { species: 'lamia', gender: 'female' } })).toEqual({
            species: 'lamia',
            gender: 'female',
        });
        expect(identityOf({ name: 'X', present: true, details: { пол: 'мужской' } })).toEqual({ gender: 'male' });
        expect(identityOf(undefined)).toEqual({});
    });
});
