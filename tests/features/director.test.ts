// @vitest-environment happy-dom
// The director (stage 5, «Кино»): when it runs, what it sends, how it gives up, and its calls in the motive card.
import { afterEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/core/settings';
import { DIRECTOR_TASK } from '../../src/domain/director';
import type { CardProfiles, ChatState } from '../../src/domain/model';
import { emptyCardProfiles } from '../../src/domain/profile-defaults';
import { DIRECTOR_API } from '../../src/features/director/api';
import type { DirectorApi } from '../../src/features/director/api';
import { DIRECTOR_STRINGS, createDirector, directorModule } from '../../src/features/director';
import type { DirectorSettings } from '../../src/features/director';
import { ENGINE_API } from '../../src/features/engine/api';
import type { EngineView } from '../../src/features/engine/api';
import type { ApiLlmRequest, ApiLlmResult } from '../../src/shared/apis';
import type { App, DramatisSettings, GenerationInfo } from '../../src/shared/contracts';
import { TAVERN_BANDS, TAVERN_PRESENT, tavern } from '../domain/cast-fixtures';
import { fakeMaestro, memoryLogger, staticBridge } from '../helpers/fakes';
import { message } from '../helpers/st-mock';
import { generate, startHarness, stopHarness } from './harness';

afterEach(stopHarness);

const gen = (type = 'normal', patch: Partial<GenerationInfo> = {}): GenerationInfo => ({
    type,
    dryRun: false,
    quiet: false,
    ...patch,
});

const answer = {
    actors: [
        { id: 'ilva', intent: 'sweeps the coin into her apron', target: 'PLAYER', move: 'respond' },
        { id: 'bram', intent: 'eyes the courier’s purse', target: '', move: 'watch' },
    ],
};

function setup(
    options: { mode?: DramatisSettings['mode']; chat?: STChatMessage[]; settings?: Partial<DirectorSettings> } = {},
) {
    const { profiles, state } = tavern();
    const view: EngineView = {
        card: { ...emptyCardProfiles('tavern.png'), characters: profiles },
        state,
        profiles,
        byId: new Map(profiles.map((p) => [p.id, p])),
        present: TAVERN_PRESENT,
        unknown: [],
        bands: TAVERN_BANDS,
        playerName: 'Курьер',
        greeting: 0,
    };
    const maestro = fakeMaestro();
    maestro.reply = () => ({ ok: true, data: answer });
    const general = { ...defaultSettings(), mode: options.mode ?? 'cinema' };
    const exposed = new Map<string, unknown>();
    const tasks: string[] = [];
    maestro.api.llm.registerTask = (id) => {
        tasks.push(id);
        return () => {};
    };
    const app = {
        modules: {
            api: (key: string) => (key === ENGINE_API ? { view: () => view } : exposed.get(key)),
            expose: (key: string, value: unknown) => exposed.set(key, value),
        },
        maestro: staticBridge(maestro.api),
        settings: { get: () => general },
        readers: { des: { scene: () => ({ place: 'трактир', time: 'вечер' }) } },
        host: { ctx: () => ({ chat: options.chat ?? [] }) },
    } as unknown as App;
    const settings: DirectorSettings = { ...directorModule.defaults(), ...options.settings };
    return {
        app,
        view,
        maestro,
        general,
        exposed,
        tasks,
        director: createDirector(app, settings, memoryLogger()),
        settings,
    };
}

describe('director module', () => {
    it('is a stage-5 module that needs Maestro, registers its task and exposes its API', async () => {
        expect(directorModule).toMatchObject({ key: 'director', stage: 5, enabledByDefault: true, needsMaestro: true });
        expect(directorModule.defaults()).toEqual({ maxTokens: 400, temperature: 0.3, timeoutMs: 3500 });
        expect(Object.keys(DIRECTOR_STRINGS.ru).sort()).toEqual(Object.keys(DIRECTOR_STRINGS.en).sort());
        const s = setup();
        await directorModule.init({ app: s.app, settings: s.settings, log: memoryLogger(), own: () => {} });
        expect(s.tasks).toEqual([DIRECTOR_TASK]);
        expect(typeof (s.exposed.get(DIRECTOR_API) as DirectorApi).beat).toBe('function');
    });

    it('sends a short structured request as part of the user’s generation and returns the calls', async () => {
        document.body.innerHTML = '<textarea id="send_textarea">I put a coin on the counter.</textarea>';
        const s = setup({ chat: [message('Ильва считает выручку.')] });
        const calls = await s.director.beat(gen());
        expect(calls).toEqual({
            ilva: 'sweeps the coin into her apron (toward Курьер)',
            bram: 'eyes the courier’s purse',
        });
        const request: ApiLlmRequest = s.maestro.requests[0]!;
        expect(request).toMatchObject({ task: DIRECTOR_TASK, maxTokens: 400, temperature: 0.3, background: false });
        expect(request.signal).toBeInstanceOf(AbortSignal);
        expect(request.schema?.name).toBe('dramatis_director');
        const user = request.messages[1]!.content;
        expect(user).toContain('I put a coin on the counter.');
        expect(user).toContain('Ильва считает выручку.');
        expect(user).toContain('Place: трактир');
    });

    it('answers a swipe with the last message of the chat', async () => {
        document.body.innerHTML = '<textarea id="send_textarea"></textarea>';
        const s = setup({
            chat: [message('Ильва считает.'), message('Кладу монету.', { is_user: true }), message('Old reply.')],
        });
        await s.director.beat(gen('swipe'));
        const user = s.maestro.requests[0]!.messages[1]!.content;
        expect(user).toContain('Кладу монету.');
        expect(user).toContain('Ильва считает.');
        expect(user).not.toContain('Old reply.');
    });

    it('sits out other modes, dry runs, quiet calls, impersonation and continuation', async () => {
        const s = setup({ mode: 'balanced' });
        expect(await s.director.beat(gen())).toBeUndefined();
        s.general.mode = 'cinema';
        for (const info of [
            gen('normal', { dryRun: true }),
            gen('quiet', { quiet: true }),
            gen('impersonate'),
            gen('continue'),
        ])
            expect(await s.director.beat(info)).toBeUndefined();
        expect(s.maestro.requests).toHaveLength(0);
        // The chat may switch the lever on for itself.
        s.general.mode = 'balanced';
        s.view.state.overrides = { mode: 'cinema' };
        expect(await s.director.beat(gen())).toBeDefined();
    });

    it('gives up silently on an error, an empty answer or after the timeout', async () => {
        const s = setup({ settings: { timeoutMs: 20 } });
        s.maestro.reply = () => ({ ok: false, error: 'breaker' });
        expect(await s.director.beat(gen())).toBeUndefined();
        s.maestro.reply = () => ({ ok: true, data: { actors: [] } });
        expect(await s.director.beat(gen())).toBeUndefined();
        s.maestro.reply = () => {
            throw new Error('boom');
        };
        expect(await s.director.beat(gen())).toBeUndefined();
        let aborted = false;
        s.maestro.reply = (request) =>
            new Promise<ApiLlmResult>((resolve) => {
                request.signal?.addEventListener('abort', () => (aborted = true));
                setTimeout(() => resolve({ ok: true, data: answer }), 500);
            });
        const started = Date.now();
        expect(await s.director.beat(gen())).toBeUndefined();
        expect(Date.now() - started).toBeLessThan(400);
        expect(aborted).toBe(true);
    });

    it('needs Maestro, a view and someone present', async () => {
        const s = setup();
        s.view.present = [];
        expect(await s.director.beat(gen())).toBeUndefined();
        const none = setup();
        (none.app.maestro as ReturnType<typeof staticBridge>).set(null);
        expect(await none.director.beat(gen())).toBeUndefined();
    });
});

describe('director calls in the motive card', () => {
    function tavernCard(): CardProfiles {
        return { ...emptyCardProfiles('tavern.png'), characters: tavern().profiles };
    }
    function tavernState(): ChatState {
        return { ...tavern().state, card: 'tavern.png' };
    }

    it('reach the card of this generation only in the «Кино» mode', async () => {
        const maestro = fakeMaestro();
        maestro.reply = (request) =>
            request.task === DIRECTOR_TASK ? { ok: true, data: answer } : { ok: false, error: 'not-leader' };
        const h = await startHarness({ profiles: tavernCard(), state: tavernState(), persona: 'Курьер', maestro });
        await generate(h.mock);
        expect(h.mock.prompts.get('dramatis_cast')!.value).not.toContain("director's call");
        expect(maestro.requests.filter((r) => r.task === DIRECTOR_TASK)).toHaveLength(0);
        h.app.settings.set('mode', 'cinema');
        await generate(h.mock);
        const text = h.mock.prompts.get('dramatis_cast')!.value;
        expect(text).toContain("This beat, director's call: sweeps the coin into her apron (toward Курьер).");
        expect(text).toContain("This beat, director's call: eyes the courier’s purse.");
        expect(maestro.requests.filter((r) => r.task === DIRECTOR_TASK)).toHaveLength(1);
        // Nothing of it is stored.
        const view = h.engine.view()!;
        expect(JSON.stringify(view.state)).not.toContain('sweeps the coin');
    });
});
