// Module «metrics» (stage 5, docs/model.md §16 «Как поймём, что работает»). Like the arcs, it runs after the turn
// module without touching it: when the engine shows a committed turn whose summary (`state.lastPass`) it has not
// counted yet, the leader tab reads that reply and counts it into `state.metrics` (domain/metrics.ts) — the share of NPC
// lines addressed to the player, unprompted initiative, drift, stance steps, how distinguishable the voices are. The
// numbers are shown on the «Замеры» page of the sheet window and by `/dramatis-stats` (`/dramatis-stats reset` starts
// counting again). Counting needs the turn pass (and so Maestro); the command and the page work without it.
import { emptyMetrics, metricsReport, metricsRows, updateMetrics } from '../../domain/metrics';
import type { NamedProfile } from '../../domain/presence';
import type { ChatState } from '../../domain/model';
import { cleanForAnalysis } from '../../domain/text-clean';
import type { App, DramatisModule, I18nParts, Logger, Unsubscribe } from '../../shared/contracts';
import { ENGINE_API } from '../engine/api';
import type { EngineApi, EngineView } from '../engine/api';

export type MetricsSettings = Record<string, never>;

export const STATS_SLASH = 'dramatis-stats';
/** The window `/dramatis` opens (app.ts CAST_WINDOW_ID), where the sheet keeps the «Замеры» page. */
const SHEET_WINDOW = 'cast';

export const METRICS_STRINGS: I18nParts = {
    en: {
        'metrics.title': 'Measurements',
        'metrics.slash.help':
            'Shows the measurements of this chat (NPC lines addressed to you, initiative, drift, voices) and opens the «Measurements» page. /dramatis-stats reset starts counting again.',
        'metrics.slash.title': 'Dramatis measurements',
        'metrics.slash.noChat': 'Open a chat with a character first.',
        'metrics.slash.reset': 'Measurements reset: counting starts again with the next turn.',
        'metrics.slash.resetFailed': 'The measurements were not reset (no chat, or another tab saved first).',
    },
    ru: {
        'metrics.title': 'Замеры',
        'metrics.slash.help':
            'Показывает замеры этого чата (реплики NPC к тебе, инициатива, дрейф, различимость голосов) и открывает страницу «Замеры». /dramatis-stats reset — начать счёт заново.',
        'metrics.slash.title': 'Замеры Dramatis',
        'metrics.slash.noChat': 'Сначала открой чат с персонажем.',
        'metrics.slash.reset': 'Замеры сброшены: счёт начнётся заново со следующего хода.',
        'metrics.slash.resetFailed': 'Замеры не сброшены (нет чата или другая вкладка успела раньше).',
    },
};

/** Whether the state shows a committed turn the metrics have not counted. */
export function metricsDue(state: ChatState): boolean {
    const summary = state.lastPass;
    return !!summary && summary.turn === state.turn && (state.metrics?.lastTurn ?? -1) < summary.turn;
}

/** Counts the committed turn of the state (unchanged when it is not due). */
export function countTurn(state: ChatState, view: EngineView, reply: string): ChatState {
    const summary = state.lastPass;
    if (!summary || !metricsDue(state)) return state;
    const people: NamedProfile[] = summary.present
        .map((id) => view.byId.get(id))
        .filter((profile): profile is NonNullable<typeof profile> => !!profile);
    const next = state.next?.turn === state.turn ? state.next : undefined;
    return {
        ...state,
        metrics: updateMetrics(state.metrics, {
            turn: summary.turn,
            reply,
            playerName: view.playerName,
            people,
            ...(next?.moves ? { moves: next.moves } : {}),
            summary,
        }),
    };
}

/** The report as text lines in the UI language. */
export function statsText(app: App, state: ChatState | null | undefined): string {
    const rows = metricsRows(metricsReport(state?.metrics), app.i18n.locale());
    return [app.i18n.t('metrics.slash.title'), ...rows.map((row) => `${row.label}: ${row.value}`)].join('\n');
}

export function createMetricsController(app: App, log: Logger) {
    const engine = (): EngineApi | null => app.modules.api<EngineApi>(ENGINE_API) ?? null;
    let queue: Promise<void> = Promise.resolve();
    let scheduled = false;
    let stopped = false;

    function replyAt(index: number | undefined): string {
        if (index === undefined) return '';
        const chat = app.host.ctx().chat;
        return Array.isArray(chat) ? cleanForAnalysis(chat[index]) : '';
    }

    async function count(): Promise<void> {
        if (stopped) return;
        const store = engine();
        const view = store?.view();
        if (!store || !view || !metricsDue(view.state)) return;
        const maestro = app.maestro.api();
        try {
            if (maestro && !maestro.leader.isLeader()) return;
        } catch (error) {
            log.debug('leader check failed', error);
            return;
        }
        const reply = replyAt(view.state.lastPass?.messageIndex);
        await store.updateState((state, current) => countTurn(state, current, reply));
    }

    return {
        schedule(): Promise<void> {
            if (scheduled) return queue;
            scheduled = true;
            queue = queue
                .then(() => {
                    scheduled = false;
                    return count();
                })
                .catch((error: unknown) => log.error('metrics failed', error));
            return queue;
        },

        async reset(): Promise<boolean> {
            const store = engine();
            if (!store?.view()) return false;
            return store.updateState((state) => {
                state.metrics = emptyMetrics(state.turn);
            });
        },

        idle(): Promise<void> {
            return queue;
        },

        stop(): void {
            stopped = true;
        },
    };
}

export const metricsModule: DramatisModule<MetricsSettings> = {
    key: 'metrics',
    stage: 5,
    titleKey: 'metrics.title',
    enabledByDefault: true,
    defaults: () => ({}),
    i18n: METRICS_STRINGS,

    init({ app, log, own }) {
        const controller = createMetricsController(app, log);
        const t = app.i18n.t.bind(app.i18n);

        let attached: EngineApi | null = null;
        let off: Unsubscribe | null = null;
        const attach = () => {
            const current = app.modules.api<EngineApi>(ENGINE_API) ?? null;
            if (current === attached) return;
            off?.();
            off = null;
            attached = current;
            if (current) off = current.onChange(() => void controller.schedule());
        };
        attach();
        own(
            app.settings.onChange((key) => {
                if (key.startsWith('modules.') || key === '*') queueMicrotask(attach);
            }),
        );
        own(() => {
            controller.stop();
            off?.();
            off = null;
            attached = null;
        });

        own(
            app.ui.addSlashCommand(STATS_SLASH, 'metrics.slash.help', async (value) => {
                const store = app.modules.api<EngineApi>(ENGINE_API);
                const view = store ? (store.view() ?? (await store.ready())) : null;
                if (!view) return t('metrics.slash.noChat');
                if (value.trim().toLowerCase() === 'reset') {
                    return (await controller.reset()) ? t('metrics.slash.reset') : t('metrics.slash.resetFailed');
                }
                app.ui.openWindow(SHEET_WINDOW, { page: 'metrics' });
                return statsText(app, view.state);
            }),
        );
        void controller.schedule();
    },
};
