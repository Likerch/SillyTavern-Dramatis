// The generator module and new faces grounded in the story (docs/model.md §10.2): sketches built on the turn pass's
// facts or the word heuristics, rules applied on the face's groups, promotion on the story (the world, the facts, the
// dice's values as guesses), facts arriving later, the background repair of dice-made faces (once, leader tab, not in
// economy mode) and the sheet's interactive rebuild. Synthetic fixtures only.
import { describe, expect, it } from 'vitest';
import { createApiPublisher } from '../../src/app/api';
import { Modules } from '../../src/app/module-manager';
import { createBus } from '../../src/core/bus';
import { createI18n } from '../../src/core/i18n';
import { Settings } from '../../src/core/settings';
import { NEW_FACE_SYSTEM_PROMPT, sampleParams, sketchProfile } from '../../src/domain/generator';
import type { GenParams } from '../../src/domain/generator';
import { PLAYER_ID } from '../../src/domain/model';
import type { AppetiteRule, CardProfiles, CharacterProfile, ChatState, StateEvent } from '../../src/domain/model';
import { recordFacts } from '../../src/domain/newcomers';
import { matchName, presentFromDes } from '../../src/domain/presence';
import { emptyCardProfiles, setMeta } from '../../src/domain/profile-defaults';
import { createCharacterState, ensureCharacterState, initChatState } from '../../src/domain/state-init';
import { ENGINE_API } from '../../src/features/engine/api';
import type { EngineApi, EngineView } from '../../src/features/engine/api';
import { generatorModule } from '../../src/features/generator';
import { GENERATOR_API } from '../../src/features/generator/api';
import type { GeneratorApi } from '../../src/features/generator/api';
import type { ApiJournalChange, ApiLlmRequest } from '../../src/shared/apis';
import type { App, CardSource, DesCharacter, DramatisModule, LlmRouter } from '../../src/shared/contracts';
import { seeded } from '../domain/appetites-fixtures';
import { fakeMaestro, memoryLogger, staticBridge } from '../helpers/fakes';

/* ------------------------------------------------------------------ the rig (as generator.test.ts, trimmed) */

function fakeEngine(card: CardProfiles, state: ChatState, cast: () => DesCharacter[]) {
    let current = { card, state };
    const listeners = new Set<(view: EngineView | null) => void>();
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
    const logs: StateEvent[] = [];
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
        get state() {
            return current.state;
        },
    };
}

function said(mes: string, isUser = false): STChatMessage {
    return { name: isUser ? 'Курьер' : 'Рассказчик', is_user: isUser, is_system: false, send_date: '', mes };
}

interface RigOptions {
    cast?: DesCharacter[];
    state?: (state: ChatState) => ChatState;
    settings?: Record<string, unknown>;
    chat?: STChatMessage[];
    cardSource?: CardSource;
    leader?: boolean;
}

async function rig(options: RigOptions = {}) {
    const log = memoryLogger();
    const store: Record<string, unknown> = {};
    const settings = new Settings(
        () => store,
        () => {},
        log,
    );
    for (const [key, value] of Object.entries(options.settings ?? {})) settings.set(key as 'mode', value as 'balanced');
    const bus = createBus(log);
    const i18n = createI18n(() => 'ru');
    const maestro = fakeMaestro();
    const notices: string[] = [];
    const records: { kind: string; summary: string; changes: ApiJournalChange[] }[] = [];
    maestro.api.notice = (text) => void notices.push(text);
    maestro.api.journal = {
        record: async (action) => {
            records.push(action);
            return `j${records.length}`;
        },
        registerUndo: () => () => {},
    };
    maestro.api.styleUp = async () => true;
    maestro.api.setCanonGoals = async () => true;
    maestro.api.leader = { isLeader: () => options.leader ?? true, onChange: () => () => {} };
    maestro.reply = (request) => ({ ok: true, data: answerFor(request) });
    const bridge = staticBridge(maestro.api);
    const card = emptyCardProfiles('card.png');
    let state = initChatState(card, 0, 'card.png');
    state = options.state ? options.state(state) : state;
    const cast = { list: options.cast ?? [] };
    const engine = fakeEngine(card, state, () => cast.list);
    const chat = options.chat ?? [said('В доме тихо.'), said('Иду на кухню.', true)];
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
            lore: { archives: async () => [], cardBook: async () => [] },
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
    return { api, engine, maestro, bus, notices, records, settle, cast };
}

/** The model's answers: a draft or portrait with its core re-derived, or a rebuild of every face asked. */
function answerFor(request: ApiLlmRequest): unknown {
    const take = (name: string) => ({
        name,
        concept: `${name}: младшая дочь в семье`,
        want: 'чтобы семья держалась вместе',
        need: 'чтобы её услышали',
        goals: [
            {
                text: 'wants the dinner to go well because of her father, but the brothers fight',
                kind: 'external',
                priority: 1,
            },
        ],
        signatures: ['if the brothers fight → steps between them', 'if praised → blushes'],
        keys: ['a kind word from the father'],
        doing: 'накрывает на стол',
        sceneGoal: 'успеть до ужина',
        stanceBehaviour: 'обнимает его при встрече',
        stanceReason: 'его сестра',
        playerStance: 2,
        values: ['benevolence', 'tradition', 'security'],
        sacrifice: 'power',
        temperament: { agreeableness: 2, extraversion: 1 },
        drivesHigh: ['family', 'social'],
        drivesLow: ['power'],
        tactics: ['charm'],
        proactivity: 5,
        moodOctant: 'relaxed',
        moodLabel: 'спокойна',
        role: 'сестра',
        species: '',
        summary: 'A sister',
        fit: 5,
        typicality: 2,
    });
    if (request.task === 'dramatis.reground') {
        const names = String(request.messages[1]?.content ?? '')
            .split('\n')
            .filter((line) => line.startsWith('Name: '))
            .map((line) => line.slice('Name: '.length).replace(/ \(also: .*\)$/, ''));
        return { characters: names.map(take) };
    }
    return { candidates: [take('a'), take('b'), take('c')] };
}

/* ------------------------------------------------------------------ fixtures */

const family: AppetiteRule = {
    id: 'family',
    holders: 'family members',
    kind: 'flesh',
    label: 'family relationships are allowed and normal',
    source: 'culture',
    target: { mode: 'class', class: 'family members' },
    intensity: { zero: 0, low: 0, mid: 0, high: 1 },
    styles: { honest: 1 },
    choosiness: 0,
    exclusivity: 'shared',
    affectionOnset: 'common',
    groupMode: 'tribe',
};

function familyWorld(state: ChatState): ChatState {
    return {
        ...state,
        rules: [family],
        reputation: [
            {
                among: 'All family members',
                label: 'a family member who can be approached',
                stance: 0,
                weaknesses: [],
                reasons: [],
            },
        ],
    };
}

/** A face an older build drew from dice (the old layout: no 'dice' marks, a «чужак» tie), with its live state. */
function legacy(state: ChatState, name = 'Вера'): ChatState {
    const params: GenParams = { ...sampleParams('unknown', 'hostile', [], seeded(5), 'even'), stance: -1 };
    delete params.basis;
    let face = sketchProfile(name, params, { lang: 'ru', id: 'vera' });
    face = { ...face, lod: 'draft', core: { ...face.core, concept: 'ищет эмоций в мелких преступлениях' } };
    for (const path of Object.keys(face.meta)) {
        const meta = face.meta[path]!;
        face = setMeta(face, path, meta.sources?.includes('dice') ? { origin: 'generated' } : meta);
    }
    face = setMeta(face, `ties.${PLAYER_ID}`, { origin: 'generated', sources: ['template'] });
    face = setMeta(face, 'core.concept', { origin: 'generated' });
    // The user had fixed her voice.
    face = setMeta({ ...face, core: { ...face.core, voice: 'Ну и ну.' } }, 'core.voice', {
        origin: 'user',
        locked: true,
    });
    const live = createCharacterState(face, 0);
    live.present = true;
    return { ...state, extras: [...state.extras, face], characters: { ...state.characters, [face.id]: live } };
}

const lisaCast: DesCharacter[] = [{ name: 'Лиза', present: true, details: {} }];

function lisa(r: { engine: { state: ChatState } }): CharacterProfile {
    return r.engine.state.extras.find((profile) => profile.name === 'Лиза')!;
}

/* ------------------------------------------------------------------ tests */

describe('new faces grounded in the story', () => {
    it('sketches the daughter of a family scenario from the turn pass’s facts: family, no «чужак», the rule applied', async () => {
        const r = await rig({
            cast: lisaCast,
            state: (s) => {
                const next = familyWorld(s);
                recordFacts(next, [
                    {
                        name: 'Лиза',
                        relation: 'family',
                        relationNote: 'дочь Джона',
                        groups: ['family members'],
                        source: 'turn',
                        turn: 0,
                    },
                ]);
                return next;
            },
        });
        const face = lisa(r);
        expect(face.groups).toEqual(['family members', 'All family members']);
        const tie = face.ties.find((item) => item.target === PLAYER_ID)!;
        expect(tie.stance).toBe(0);
        expect(tie.reasons[0]).toMatchObject({ id: 'story-relation', text: 'дочь Джона' });
        expect(face.meta[`ties.${PLAYER_ID}`]).toEqual({ origin: 'story', sources: ['turn'] });
        expect(JSON.stringify(face)).not.toMatch(/чужак/);
        expect(face.appetites[0]).toMatchObject({ rule: 'family' });
        expect(tie.want).toBeGreaterThan(0);
        expect(r.engine.state.characters[face.id]!.ties[PLAYER_ID]!.reasons[0]!.id).toBe('story-relation');
        expect(r.maestro.requests).toHaveLength(0);
    });

    it('falls back on the words of the chat when no pass ran (economy)', async () => {
        const r = await rig({
            cast: lisaCast,
            settings: { mode: 'economy' },
            chat: [said('На пороге стоит Лиза, твоя сестра.'), said('Привет, Лиза.', true)],
        });
        const tie = lisa(r).ties[0]!;
        expect(tie).toMatchObject({ stance: 1 });
        expect(tie.reasons[0]).toMatchObject({ id: 'story-relation', text: 'твоя сестра' });
        expect(lisa(r).meta[`ties.${PLAYER_ID}`]).toEqual({ origin: 'story', sources: ['heuristic'] });
        // Roles are kept in English like the rest of the profile (the card's language lever); the story's words stay.
        expect(lisa(r).role).toBe('sister');
    });

    it('meets the player mildly when nothing is known, and grounds the face once the story shows who she is', async () => {
        const r = await rig({ cast: lisaCast, state: familyWorld });
        expect(lisa(r).ties[0]).toMatchObject({ stance: 0, reasons: [] });
        expect(lisa(r).meta[`ties.${PLAYER_ID}`]).toEqual({ origin: 'generated', sources: ['default'] });
        await r.engine.engine.updateState((state) => {
            recordFacts(state, [
                { name: 'Лиза', relation: 'family', relationNote: 'дочь Джона', source: 'turn', turn: state.turn },
            ]);
        });
        await r.bus.emit('turn:committed', { messageIndex: 0 });
        await r.settle();
        const face = lisa(r);
        expect(face.meta[`ties.${PLAYER_ID}`]).toEqual({ origin: 'story', sources: ['turn'] });
        expect(face.ties.find((item) => item.target === PLAYER_ID)!.reasons[0]!.text).toBe('дочь Джона');
        expect(face.groups).toEqual(['family members', 'All family members']);
        // The family's rule now reaches her too.
        expect(face.appetites[0]).toMatchObject({ rule: 'family' });
        expect(r.engine.state.characters[face.id]!.ties[PLAYER_ID]!.reasons[0]!.text).toBe('дочь Джона');
        expect(r.records.at(-1)!.summary).toBe('История показала, кто это: Лиза');
        expect(r.maestro.requests).toHaveLength(0);
    });

    it('promotes a new face on the story: the world, the facts, the dice’s values only as guesses', async () => {
        const r = await rig({
            cast: lisaCast,
            state: familyWorld,
            cardSource: {
                name: 'Семья',
                description: 'A modern family lives together; the player lives with them.',
                personality: '',
                scenario: 'An ordinary evening at home.',
                firstMes: 'Вечер. Семья собирается к ужину.',
                alternateGreetings: [],
                creatorNotes: '',
            } as unknown as CardSource,
        });
        const id = lisa(r).id;
        const dice = lisa(r).core.values;
        const outcome = await r.api.promote(id, 'draft');
        expect(outcome.ok).toBe(true);
        const request = r.maestro.requests[0]!;
        expect(request.messages[0]!.content).toBe(NEW_FACE_SYSTEM_PROMPT);
        const user = request.messages[1]!.content;
        expect(user).toContain('Card description: A modern family lives together');
        expect(user).toContain('Rule of the world — family members → family members: family relationships are allowed');
        expect(user).toContain("Reputation of the player's character among All family members");
        expect(user).toContain('Provisional guesses of the dice');
        expect(JSON.stringify(request.schema)).toContain('drivesHigh');
        const face = lisa(r);
        expect(face.lod).toBe('draft');
        expect(face.core.values.top).toEqual(['benevolence', 'tradition', 'security']);
        expect(face.core.values).not.toEqual(dice);
        expect(face.meta['core.values']).toEqual({ origin: 'generated', sources: ['grounded'] });
        expect(face.ties.find((item) => item.target === PLAYER_ID)).toMatchObject({ stance: 2 });
        expect(r.engine.state.characters[id]!.ties[PLAYER_ID]!.stance).toBe(2);
    });
});

describe('the repair of faces an older build drew from dice', () => {
    it('rebuilds them on the story once, in one background request, keeping the user’s edit', async () => {
        const r = await rig({ state: (s) => legacy(familyWorld(s)) });
        expect(r.api.groundable()).toEqual(['vera']);
        expect(r.maestro.requests).toHaveLength(0);
        await r.bus.emit('reply:ready', { messageIndex: 1 });
        await r.settle();
        expect(r.maestro.requests).toHaveLength(1);
        const request = r.maestro.requests[0]!;
        expect(request).toMatchObject({ task: 'dramatis.reground', background: true });
        expect(request.schema?.name).toBe('dramatis_reground');
        expect(request.messages[1]!.content).toContain('Level: a DRAFT');
        const vera = r.engine.state.extras[0]!;
        expect(vera.lod).toBe('draft');
        expect(vera.core.concept).toBe('Вера: младшая дочь в семье');
        expect(vera.core.voice).toBe('Ну и ну.');
        expect(vera.core.values.top).toEqual(['benevolence', 'tradition', 'security']);
        const tie = vera.ties.find((item) => item.target === PLAYER_ID)!;
        expect(tie.stance).toBe(2);
        expect(JSON.stringify(tie)).not.toMatch(/чужак/);
        expect(r.engine.state.characters.vera!.ties[PLAYER_ID]!.stance).toBe(2);
        expect(r.engine.state.generator?.regrounded).toEqual(['vera']);
        expect(r.api.groundable()).toEqual([]);
        expect(r.records.at(-1)!.summary).toBe('Вера: пересобран по истории');
        expect(r.notices).toContain('Пересобраны по истории: Вера');
        // Never again by itself.
        await r.bus.emit('reply:ready', { messageIndex: 3 });
        await r.settle();
        expect(r.maestro.requests).toHaveLength(1);
    });

    it('waits in economy mode and in a tab that does not lead', async () => {
        const economy = await rig({ state: (s) => legacy(s), settings: { mode: 'economy' } });
        await economy.bus.emit('reply:ready', { messageIndex: 1 });
        await economy.settle();
        expect(economy.maestro.requests).toHaveLength(0);
        const follower = await rig({ state: (s) => legacy(s), leader: false });
        await follower.bus.emit('reply:ready', { messageIndex: 1 });
        await follower.settle();
        expect(follower.maestro.requests).toHaveLength(0);
        expect(follower.api.groundable()).toEqual(['vera']);
    });

    it('rebuilds on the sheet’s button: one face, or every new face of the chat', async () => {
        const r = await rig({ cast: lisaCast, state: (s) => legacy(s) });
        const outcome = await r.api.reground([lisa(r).id]);
        expect(outcome.ok).toBe(true);
        expect(r.maestro.requests).toHaveLength(1);
        expect(r.maestro.requests[0]).toMatchObject({ task: 'dramatis.reground', background: false });
        expect(lisa(r).core.want).toBe('чтобы семья держалась вместе');
        expect(lisa(r).lod).toBe('sketch');
        const all = await r.api.reground();
        expect(all.ok).toBe(true);
        expect(r.maestro.requests).toHaveLength(2);
        expect(r.maestro.requests[1]!.messages[1]!.content).toContain('Name: Вера');
        expect(r.engine.state.generator?.regrounded).toEqual(expect.arrayContaining(['vera']));
        expect(await r.api.reground(['nobody'])).toMatchObject({ ok: false, error: 'unknown' });
    });
});
