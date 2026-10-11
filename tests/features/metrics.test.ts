// @vitest-environment happy-dom
// The metrics module (stage 5, docs/model.md §16): counting committed turns, /dramatis-stats, the «Замеры» page.
import { afterEach, describe, expect, it } from 'vitest';
import { createI18n } from '../../src/core/i18n';
import { emptyMetrics } from '../../src/domain/metrics';
import { PLAYER_ID } from '../../src/domain/model';
import type { ChatState, PassSummary } from '../../src/domain/model';
import { emptyCardProfiles } from '../../src/domain/profile-defaults';
import { ENGINE_API } from '../../src/features/engine/api';
import type { EngineApi, EngineView } from '../../src/features/engine/api';
import { METRICS_STRINGS, STATS_SLASH, metricsDue, metricsModule, statsText } from '../../src/features/metrics';
import type { App, Unsubscribe } from '../../src/shared/contracts';
import { tavern } from '../domain/cast-fixtures';
import { fakeMaestro, freshSession, memoryLogger, staticBridge } from '../helpers/fakes';
import { message } from '../helpers/st-mock';
import { buttonByText, flush, harness } from './sheet/harness';
import type { Harness } from './sheet/harness';

function fakeEngine(initial: EngineView) {
    let view = initial;
    const listeners = new Set<(view: EngineView | null) => void>();
    const saves: ChatState[] = [];
    const api: EngineApi = {
        view: () => view,
        ready: async () => view,
        async updateState(mutate) {
            const clone = structuredClone(view.state);
            const result = mutate(clone, view) ?? clone;
            view = { ...view, state: result };
            saves.push(result);
            for (const listener of [...listeners]) listener(view);
            return true;
        },
        updateProfiles: async () => false,
        refresh: async () => {},
        resolve: () => null,
        log: () => {},
        onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    return {
        api,
        saves,
        get state() {
            return view.state;
        },
        commit(summary: Partial<PassSummary>, moves?: NonNullable<ChatState['next']>['moves']) {
            const turn = view.state.turn + 1;
            const state: ChatState = {
                ...view.state,
                turn,
                lastPass: { turn, present: ['ilva', 'bram'], characters: {}, steps: [], drift: [], ...summary },
                next: { turn, ...(moves ? { moves } : {}) },
            };
            view = { ...view, state };
            for (const listener of [...listeners]) listener(view);
        },
    };
}

async function setup(options: { leader?: boolean; maestro?: boolean } = {}) {
    const { profiles, state } = tavern();
    const view: EngineView = {
        card: { ...emptyCardProfiles('tavern.png'), characters: profiles },
        state,
        profiles,
        byId: new Map(profiles.map((p) => [p.id, p])),
        present: ['ilva', 'bram'],
        unknown: [],
        bands: {},
        playerName: 'Курьер',
        greeting: 0,
    };
    const engine = fakeEngine(view);
    const maestro = fakeMaestro();
    const leader = { value: options.leader ?? true };
    maestro.api.leader = { isLeader: () => leader.value, onChange: () => () => {} };
    const i18n = createI18n(() => 'ru');
    i18n.register(METRICS_STRINGS);
    const chat: STChatMessage[] = [];
    const slash = new Map<string, (value: string) => string | Promise<string>>();
    const opened: { id: string; params?: Record<string, unknown> }[] = [];
    const app = {
        modules: { api: (key: string) => (key === ENGINE_API ? engine.api : undefined), expose: () => {} },
        i18n,
        maestro: staticBridge(options.maestro === false ? null : maestro.api),
        host: { ctx: () => ({ chat }) },
        settings: { onChange: () => () => {} },
        ui: {
            addSlashCommand: (name: string, _help: string, callback: (value: string) => string | Promise<string>) => {
                slash.set(name, callback);
                return () => slash.delete(name);
            },
            openWindow: (id: string, params?: Record<string, unknown>) => opened.push({ id, params }),
        },
    } as unknown as App;
    const owned: (Unsubscribe | (() => void | Promise<void>))[] = [];
    await metricsModule.init({
        app,
        settings: {},
        log: memoryLogger(),
        own: (d) => owned.push(d),
        session: freshSession,
    });
    return {
        app,
        engine,
        chat,
        leader,
        slash,
        opened,
        async settle() {
            for (let i = 0; i < 10; i++) await flush();
        },
        async dispose() {
            for (const off of owned.splice(0).reverse()) await off();
        },
    };
}

describe('metrics module', () => {
    it('is a stage-5 module on by default that works without Maestro, with Russian strings for every key', () => {
        expect(metricsModule).toMatchObject({ key: 'metrics', stage: 5, enabledByDefault: true });
        expect(metricsModule.needsMaestro).toBeFalsy();
        expect(Object.keys(METRICS_STRINGS.ru).sort()).toEqual(Object.keys(METRICS_STRINGS.en).sort());
    });

    it('counts each committed turn once from the committed reply and the turn summary', async () => {
        const s = await setup();
        s.chat.push(
            message('Сажусь за стойку.', { is_user: true }),
            message('«Плати, Курьер», — сказала Ильва. «Брам, налей», — добавила Ильва.'),
        );
        s.engine.commit(
            { messageIndex: 1, drift: ['bram'], steps: [{ character: 'ilva', target: PLAYER_ID, from: -2, to: -1 }] },
            { bram: { move: 'own' }, ilva: { move: 'obstruct', target: PLAYER_ID } },
        );
        await s.settle();
        expect(s.engine.saves).toHaveLength(1);
        expect(s.engine.state.metrics).toMatchObject({
            lastTurn: 1,
            turns: 1,
            totals: { lines: 2, toPlayer: 1, initiatives: 1, initiativeTurns: 1, drift: 1, up: 1, down: 0 },
        });
        expect(metricsDue(s.engine.state)).toBe(false);
        await s.settle();
        expect(s.engine.saves).toHaveLength(1);
        s.engine.commit({});
        await s.settle();
        expect(s.engine.state.metrics?.turns).toBe(2);
        await s.dispose();
        s.engine.commit({});
        await s.settle();
        expect(s.engine.state.metrics?.turns).toBe(2);
    });

    it('lets only the leader tab count', async () => {
        const s = await setup({ leader: false });
        s.engine.commit({});
        await s.settle();
        expect(s.engine.saves).toHaveLength(0);
        await s.dispose();
    });

    it('/dramatis-stats shows the numbers and opens the page; «reset» starts over', async () => {
        const s = await setup({ maestro: false });
        const run = s.slash.get(STATS_SLASH)!;
        const text = await run('');
        expect(text.split('\n')[0]).toBe('Замеры Dramatis');
        expect(text).toContain('Учтено ходов: 0');
        expect(text).toContain('Реплики NPC, обращённые к тебе: пока нет данных');
        expect(s.opened).toEqual([{ id: 'cast', params: { page: 'metrics' } }]);
        s.engine.commit({});
        await s.settle();
        expect(s.engine.state.metrics?.turns).toBe(1);
        expect(await run(' RESET ')).toBe('Замеры сброшены: счёт начнётся заново со следующего хода.');
        expect(s.engine.state.metrics).toEqual(emptyMetrics(1));
        expect(statsText(s.app, null)).toContain('Различимость голосов: пока мало реплик');
        await s.dispose();
    });
});

describe('the «Замеры» page of the sheet', () => {
    let h: Harness | null = null;
    afterEach(async () => {
        await h?.dispose();
        h = null;
    });

    it('opens from the list, shows the numbers with hints and resets them', async () => {
        h = harness();
        const engine = h.engine!;
        engine.state = {
            ...engine.state,
            turn: 12,
            metrics: {
                ...emptyMetrics(12),
                turns: 12,
                totals: { lines: 10, toPlayer: 3, initiatives: 6, initiativeTurns: 5, drift: 1, up: 2, down: 1 },
                recent: [{ turn: 12, lines: 10, toPlayer: 3, initiatives: 6, drift: 1, up: 2, down: 1 }],
            },
        };
        (h.app.modules as { list: () => unknown[] }).list = () => [
            { module: { key: 'metrics' }, enabled: true, running: true },
        ];
        const body = h.open();
        buttonByText(body, 'Замеры').click();
        expect(body.querySelector('.dramatis-sheet-title')?.textContent).toBe('Замеры');
        expect(body.querySelector('.dramatis-error-text')).toBeNull();
        const share = body.querySelector<HTMLElement>('[data-metric="share"]')!;
        expect(share.textContent).toContain('Реплики NPC, обращённые к тебе');
        expect(share.textContent).toContain('30% (3 из 10)');
        expect(share.textContent).toContain('занятые своим говорят друг с другом');
        expect(body.querySelector('[data-metric="initiative"]')!.textContent).toContain('5,0 на 10 ходов');
        h.app.ui.confirm = async () => true;
        buttonByText(body, 'Сбросить замеры').click();
        for (let i = 0; i < 5; i++) await flush();
        expect(engine.state.metrics).toEqual(emptyMetrics(12));
        expect(h.body().textContent).toContain('Пока ничего не посчитано');
    });

    it('opens by name and says when nothing is counted because the module is off', () => {
        h = harness();
        const body = h.open({ page: 'metrics' });
        expect(body.querySelector('.dramatis-sheet-title')?.textContent).toBe('Замеры');
        expect(body.textContent).toContain('Модуль «Замеры» выключен');
        expect(body.textContent).toContain('Пока ничего не посчитано');
    });
});
