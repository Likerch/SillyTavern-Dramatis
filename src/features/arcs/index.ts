// Module «arcs» (stage 5, docs/model.md §9 «Дуги и перемены»). It runs after the turn module, without touching it:
// the turn pass leaves a short summary of the committed turn in the chat state (`state.lastPass`: matched keys, choices
// under pressure, the strain the code saw), and this module watches the engine for a summary it has not processed yet.
// Then, in the leader tab, it moves the arcs (domain/arcs.ts): strain and lean per character, the revealed choices kept
// as permanent memories with a story log line, and a ripe stage step proposed through MAESTRO_API
// (`dramatis.arc-stage`, by default «notify»: applied with a notice, undo in the journal). Each character's arc
// remembers the turn it last processed, so a repeated change event or another tab never counts a turn twice, and
// turns where nothing pressed write nothing (strain decays lazily). Undoing the turn restores the arcs with it.
import {
    applyArcStage,
    arcStepValid,
    arcsPending,
    parseArcStep,
    progressArcs,
    revertArcStage,
} from '../../domain/arcs';
import type { ArcStep } from '../../domain/arcs';
import { arcStageLabel } from '../../domain/ladders';
import type { ArcStage } from '../../domain/model';
import type { ApiJournalChange, MaestroApiV1 } from '../../shared/apis';
import type { App, DramatisModule, I18nParts, Logger, Unsubscribe } from '../../shared/contracts';
import { ENGINE_API } from '../engine/api';
import type { EngineApi, EngineView } from '../engine/api';

export type ArcsSettings = Record<string, never>;

/** Proposal kind and journal target of a stage step. */
export const ARC_STAGE_KIND = 'dramatis.arc-stage';
export const ARC_STAGE_TARGET = 'dramatis.arc-stage';

const STAGES: readonly ArcStage[] = ['intact', 'cracking', 'glimpsed', 'embraced', 'rejected'];

export const ARCS_STRINGS: I18nParts = {
    en: {
        'arcs.title': 'Arcs',
        'arcs.applier': 'Dramatis: arc stage',
        'arcs.propose.title': '{name}’s arc: {from} → {to}',
        'arcs.propose.description':
            'What pressed: «{reason}». {meaning} Accept, and the motive card shows the new stage.',
        'arcs.accept': 'Accept',
        'arcs.reject': 'Not yet',
        'arcs.stage.cracking': 'The old belief starts to crack: doubts show under pressure.',
        'arcs.stage.glimpsed': 'The truth has been glimpsed: torn between the old way and the new.',
        'arcs.stage.embraced': 'The truth is embraced: the old belief lets go.',
        'arcs.stage.rejected': 'The truth is turned away: the old belief holds tighter than ever.',
    },
    ru: {
        'arcs.title': 'Дуги',
        'arcs.applier': 'Dramatis: стадия дуги',
        'arcs.propose.title': 'Дуга — {name}: {from} → {to}',
        'arcs.propose.description':
            'Что надавило: «{reason}». {meaning} Если примешь, карточка мотивов покажет новую стадию.',
        'arcs.accept': 'Принять',
        'arcs.reject': 'Пока нет',
        'arcs.stage.cracking': 'Старая вера даёт трещину: под давлением проступают сомнения.',
        'arcs.stage.glimpsed': 'Правда увидена: персонаж разрывается между старым и новым.',
        'arcs.stage.embraced': 'Правда принята: старая вера отпускает.',
        'arcs.stage.rejected': 'Правда отвергнута: старая вера держит крепче прежнего.',
    },
};

/** A stage step travels through the Inbox with its chat. */
interface ArcStagePayload extends ArcStep {
    chatId: string;
}

function isStage(value: unknown): value is ArcStage {
    return typeof value === 'string' && (STAGES as readonly string[]).includes(value);
}

export function createArcsController(app: App, log: Logger) {
    const engine = (): EngineApi | null => app.modules.api<EngineApi>(ENGINE_API) ?? null;
    const t = app.i18n.t.bind(app.i18n);
    let queue: Promise<void> = Promise.resolve();
    let scheduled = false;
    let stopped = false;

    function leader(api: MaestroApiV1): boolean {
        try {
            return api.leader.isLeader();
        } catch (error) {
            log.debug('leader check failed', error);
            return false;
        }
    }

    async function propose(api: MaestroApiV1, chatId: string, step: ArcStep, view: EngineView): Promise<void> {
        const lang = app.i18n.locale();
        const name = view.byId.get(step.character)?.name ?? step.character;
        const payload: ArcStagePayload = { ...step, chatId };
        try {
            await api.propose({
                kind: ARC_STAGE_KIND,
                title: t('arcs.propose.title', {
                    name,
                    from: arcStageLabel(step.from, lang),
                    to: arcStageLabel(step.to, lang),
                }),
                description: t('arcs.propose.description', {
                    reason: step.reason,
                    meaning: t(`arcs.stage.${step.to}`),
                }),
                changes: [
                    {
                        target: ARC_STAGE_TARGET,
                        ref: { chatId, character: step.character },
                        before: step.from,
                        after: step.to,
                    },
                ],
                payload: JSON.parse(JSON.stringify(payload)) as unknown,
                ...(step.messageIndex !== undefined ? { sourceMessage: step.messageIndex } : {}),
                fallback: 'notify',
                acceptLabel: t('arcs.accept'),
                rejectLabel: t('arcs.reject'),
            });
        } catch (error) {
            log.warn('arc stage proposal failed', error);
        }
    }

    /** Moves the arcs by the committed turn the engine shows, once. */
    async function process(): Promise<void> {
        const api = stopped ? null : app.maestro.api();
        const store = engine();
        const view = store?.view();
        if (!api || !store || !view || !leader(api)) return;
        if (!arcsPending(view.state, view.profiles, view.state.lastPass)) return;
        const chatId = app.host.chatId();
        let steps: ArcStep[] = [];
        let after: EngineView = view;
        const saved = await store.updateState((state, current) => {
            steps = [];
            after = current;
            const summary = state.lastPass;
            if (!summary || !arcsPending(state, current.profiles, summary)) return state;
            const result = progressArcs(state, current.profiles, summary, { lang: app.i18n.locale() });
            steps = result.steps;
            return result.state;
        });
        if (!saved || !chatId || app.host.chatId() !== chatId) return;
        // Not awaited: an «ask» level may wait for the user.
        for (const step of steps) void propose(api, chatId, step, after);
    }

    function payloadOf(payload: unknown): ArcStagePayload | null {
        const step = parseArcStep(payload);
        const chatId = (payload as { chatId?: unknown } | null)?.chatId;
        return step && typeof chatId === 'string' ? { ...step, chatId } : null;
    }

    return {
        /** Called on every engine change: queues one processing run. */
        schedule(): Promise<void> {
            if (scheduled) return queue;
            scheduled = true;
            queue = queue
                .then(() => {
                    scheduled = false;
                    return process();
                })
                .catch((error: unknown) => log.error('arcs failed', error));
            return queue;
        },

        async apply(payload: unknown): Promise<void> {
            const step = payloadOf(payload);
            const store = engine();
            if (!step || !store || app.host.chatId() !== step.chatId) {
                log.info('arc stage not applied: it belongs to another chat or is malformed');
                return;
            }
            await store.updateState((state, view) => {
                if (!arcStepValid(state, step)) return state;
                return applyArcStage(state, step, { lang: app.i18n.locale(), profiles: view.profiles }).state;
            });
        },

        async stillValid(payload: unknown): Promise<boolean> {
            const step = payloadOf(payload);
            const view = engine()?.view();
            return !!step && !!view && app.host.chatId() === step.chatId && arcStepValid(view.state, step);
        },

        async undo(change: ApiJournalChange): Promise<boolean> {
            const ref = change.ref as { chatId?: unknown; character?: unknown };
            const store = engine();
            const view = store?.view();
            if (!store || !view || ref.chatId !== app.host.chatId() || typeof ref.character !== 'string') return false;
            const character = ref.character;
            const from = change.before;
            const to = change.after;
            if (!isStage(from) || !isStage(to) || view.state.characters[character]?.arcStage !== to) return false;
            return store.updateState((state) => revertArcStage(state, character, from, to).state);
        },

        /** Settles once the queued run is done (tests). */
        idle(): Promise<void> {
            return queue;
        },

        /** The module stops: queued runs do nothing. */
        stop(): void {
            stopped = true;
        },
    };
}

export type ArcsController = ReturnType<typeof createArcsController>;

export const arcsModule: DramatisModule<ArcsSettings> = {
    key: 'arcs',
    stage: 5,
    titleKey: 'arcs.title',
    enabledByDefault: true,
    needsMaestro: true,
    defaults: () => ({}),
    i18n: ARCS_STRINGS,

    init({ app, log, own }) {
        const api = app.maestro.api();
        if (!api) return;
        const controller = createArcsController(app, log);
        const label = { ru: ARCS_STRINGS.ru['arcs.applier']!, en: ARCS_STRINGS.en['arcs.applier']! };
        own(
            api.registerApplier(
                ARC_STAGE_KIND,
                label,
                (payload) => controller.apply(payload),
                (payload) => controller.stillValid(payload),
            ),
        );
        own(api.journal.registerUndo(ARC_STAGE_TARGET, (change) => controller.undo(change)));

        // Follows the engine instance (it may restart while this module runs).
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
        void controller.schedule();
    },
};
