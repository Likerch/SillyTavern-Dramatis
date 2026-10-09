// The turn module (docs/model.md §5, §8, §12 «Ход»; dev-plan stage 2 «Такт»). After every reply the leader tab asks
// the background model (task 'dramatis.turn') what happened in it; the answer is kept as a draft of that message and
// swipe and applied only when the user sends the next message (П11: swiped replies leave nothing). Applying runs the
// pure rules of domain/turn-apply.ts through the engine (stances with inertia, moods, intentions, appetites, methods,
// schemes, corruption, drift, reputation, bands and initiative), records a journal entry with undo, and routes held
// arc steps to Maestro's Inbox. Mode «Экономный» runs the pass every 2nd reply for the characters in focus or on
// business with the player. Drift in mode «Переделать» offers a new swipe of the reply before it is committed.
import { desSwipeRecord, parseDesScene } from '../../adapters/des/parse';
import { PLAYER_ID } from '../../domain/model';
import type { ChatState } from '../../domain/model';
import { matchName, presentFromDes } from '../../domain/presence';
import type { SceneMark } from '../../domain/scene';
import { cleanForAnalysis } from '../../domain/text-clean';
import { hashText } from '../../domain/intent-prompt';
import { stanceLabel } from '../../domain/ladders';
import {
    applyArcProposal,
    arcProposalValid,
    commitTurn,
    detectDrift,
    leversFor,
    parseArcProposal,
} from '../../domain/turn-apply';
import type { ArcProposal, CommitResult, TurnInput, TurnLevers } from '../../domain/turn-apply';
import { TURN_TASK, parseTurnResult, turnMessages, turnSchema } from '../../domain/turn-prompt';
import type { TurnPass } from '../../domain/turn-prompt';
import type { ApiJournalChange, MaestroApiV1 } from '../../shared/apis';
import type { App, DramatisModule, Logger, ModuleContext } from '../../shared/contracts';
import { ENGINE_API } from '../engine/api';
import type { EngineApi, EngineView } from '../engine/api';
import { TURN_STRINGS } from './strings';

export const ARC_KIND = 'dramatis.arc';
export const TURN_JOURNAL_KIND = 'dramatis.turn';
/** Journal target of whole-state snapshots (undo of a committed turn). */
export const STATE_TARGET = 'dramatis-state';

export interface TurnSettings {
    /** Answer budget of the turn pass. */
    maxTokens: number;
    temperature: number;
}

/** What a reply's pass leaves until the user sends the next message. */
export interface TurnDraft {
    chatId: string;
    messageIndex: number;
    swipeId: number;
    /** Hash of the cleaned reply text: an edited reply is not the one that was analysed. */
    hash: string;
    pass: TurnPass;
    /** Characters the pass analysed. */
    ids: string[];
}

/** Errors of a background request that mean «not now»: another tab leads, or the daily cap is reached. */
const SILENT_ERRORS = new Set(['not-leader', 'cap', 'aborted']);

interface Pending {
    controller: AbortController;
    promise: Promise<void>;
}

function swipeOf(message: STChatMessage | undefined): number {
    const id = message?.swipe_id;
    return typeof id === 'number' && id >= 0 ? id : 0;
}

function isAssistant(message: STChatMessage | undefined): message is STChatMessage {
    return !!message && !message.is_user && !message.is_system;
}

/** Arc proposals travel through the Inbox with their chat. */
interface ArcPayload extends ArcProposal {
    chatId: string;
}

export function createTurnController(app: App, settings: TurnSettings, log: Logger) {
    const pending = new Map<string, Pending>();
    /** Commits that arrived while their pass was still running. */
    const waiting = new Set<string>();
    /** Commits already applied (chat, message, swipe, text hash). */
    const applied = new Set<string>();

    const key = (chatId: string, index: number, swipe: number) => `${chatId}\u0000${index}\u0000${swipe}`;
    const maestro = (): MaestroApiV1 | null => app.maestro.api();
    const engine = (): EngineApi | undefined => app.modules.api<EngineApi>(ENGINE_API);
    const chat = (): STChatMessage[] => {
        const list = app.host.ctx().chat;
        return Array.isArray(list) ? list : [];
    };
    const fingerprint = (message: STChatMessage) => hashText(cleanForAnalysis(message));

    function leader(api: MaestroApiV1): boolean {
        try {
            return api.leader.isLeader();
        } catch (error) {
            log.debug('leader check failed', error);
            return false;
        }
    }

    function levers(view: EngineView): TurnLevers {
        return leversFor(app.settings.get(), view.state.overrides);
    }

    /** Economy: every 2nd reply only (by the committed turn count, so every swipe of a reply decides alike). */
    function skipped(view: EngineView): boolean {
        return levers(view).mode === 'economy' && view.state.turn % 2 !== 0;
    }

    /* ------------------------------------------------------------------ reading the reply */

    function lastPlayerMessage(index: number): string {
        const messages = chat();
        for (let i = Math.min(index, messages.length) - 1; i >= 0; i--) {
            const message = messages[i];
            if (message?.is_user) return cleanForAnalysis(message);
        }
        return '';
    }

    function markAt(index: number): SceneMark {
        const record = desSwipeRecord(chat()[index]);
        const parsed = record ? parseDesScene(record.infoBox) : null;
        const mark: SceneMark = {};
        if (parsed?.location) mark.place = parsed.location;
        const time = parsed?.time?.end ?? parsed?.time?.start;
        if (time) mark.time = time;
        if (parsed?.date) mark.date = parsed.date;
        return mark;
    }

    function resolver(view: EngineView): (name: string) => string | null {
        const api = engine();
        return (name: string) => {
            try {
                return api?.resolve(name) ?? matchName(name, view.profiles, { strict: true });
            } catch {
                return matchName(name, view.profiles, { strict: true });
            }
        };
    }

    function desLabels(index: number, view: EngineView): Record<string, string> {
        const labels: Record<string, string> = {};
        const resolve = resolver(view);
        for (const member of app.readers.des.castAt(index)) {
            if (!member.relationship) continue;
            const id = resolve(member.name);
            if (id && view.byId.has(id)) labels[id] = member.relationship;
        }
        return labels;
    }

    function presentAt(index: number, view: EngineView): string[] {
        const fromDes = presentFromDes(app.readers.des.castAt(index), view.profiles);
        return [...new Set([...view.present, ...fromDes.present])].filter((id) => view.byId.has(id));
    }

    function inputFor(view: EngineView, state: ChatState, index: number): TurnInput {
        return {
            state,
            profiles: view.profiles,
            present: presentAt(index, view),
            playerName: view.playerName,
            desLabels: desLabels(index, view),
            mark: markAt(index),
            resolve: resolver(view),
        };
    }

    /** The reply is still the committed one: same swipe and text, and the player has written after it. */
    function stillCommitted(chatId: string, index: number, swipe: number, hash: string): boolean {
        if (app.host.chatId() !== chatId) return false;
        const messages = chat();
        const message = messages[index];
        if (!isAssistant(message) || swipeOf(message) !== swipe || fingerprint(message) !== hash) return false;
        return messages.slice(index + 1).some((item) => item?.is_user);
    }

    /* ------------------------------------------------------------------ the pass */

    function launch(chatId: string, index: number, view: EngineView): void {
        const message = chat()[index];
        if (!isAssistant(message)) return;
        const api = maestro();
        if (!api) return;
        const swipe = swipeOf(message);
        const id = key(chatId, index, swipe);
        if (pending.has(id)) return;
        const hash = fingerprint(message);
        let ids = presentAt(index, view);
        if (levers(view).mode === 'economy')
            ids = ids.filter((item) => (view.bands[item] ?? 'background') !== 'background');
        const reply = cleanForAnalysis(message);
        if (!ids.length || !reply) {
            if (waiting.delete(id)) void apply(chatId, index, swipe, hash, null);
            return;
        }
        const fromDes = presentFromDes(app.readers.des.castAt(index), view.profiles);
        const desScene = app.readers.des.scene();
        const controller = new AbortController();
        const run = async () => {
            let pass: TurnPass | null = null;
            try {
                const result = await api.llm.request({
                    task: TURN_TASK,
                    messages: turnMessages({
                        playerName: view.playerName,
                        playerMessage: lastPlayerMessage(index),
                        reply,
                        scene: { ...desScene, ...markAt(index) },
                        profiles: view.profiles,
                        state: view.state,
                        ids,
                        present: presentAt(index, view),
                        others: fromDes.unknown,
                    }),
                    maxTokens: settings.maxTokens,
                    temperature: settings.temperature,
                    schema: turnSchema(ids),
                    background: true,
                    signal: controller.signal,
                });
                if (result.ok) pass = parseTurnResult(result.data, { ids });
                else if (SILENT_ERRORS.has(result.error ?? '')) log.debug(`turn pass skipped: ${result.error}`);
                else log.warn(`turn pass failed: ${result.error ?? 'unknown error'}`);
            } catch (error) {
                if (!controller.signal.aborted) log.warn('turn pass failed', error);
            }
            // An aborted run must not touch a newer run of the same reply (an edit, then the same swipe again).
            if (pending.get(id)?.controller === controller) pending.delete(id);
            if (controller.signal.aborted) return;
            if (app.host.chatId() !== chatId) {
                waiting.delete(id);
                return;
            }
            if (waiting.delete(id)) {
                await apply(chatId, index, swipe, hash, pass);
                return;
            }
            if (!pass) return;
            const draft: TurnDraft = { chatId, messageIndex: index, swipeId: swipe, hash, pass, ids };
            app.state.setDraft(index, swipe, draft);
            offerRedo(draft);
        };
        pending.set(id, { controller, promise: run() });
    }

    /* ------------------------------------------------------------------ drift: «Переделать» */

    function offerRedo(draft: TurnDraft): void {
        const api = maestro();
        const view = engine()?.view();
        if (!api || !view || levers(view).driftResponse !== 'redo') return;
        const findings = detectDrift(inputFor(view, view.state, draft.messageIndex), draft.pass);
        if (!findings.length) return;
        const names = [
            ...new Set(findings.map((finding) => view.byId.get(finding.character)?.name ?? finding.character)),
        ];
        api.notice(app.i18n.t('turn.redo.notice', { names: names.join(', ') }), {
            importance: 'important',
            action: { label: app.i18n.t('turn.redo.action'), run: () => requestSwipe(draft) },
        });
    }

    /** A new swipe of the reply (ST 1.19 `swipe.to` overswipe = regenerate; `/swipe` when the context lacks it). */
    function requestSwipe(draft: TurnDraft): void {
        const messages = chat();
        const message = messages[draft.messageIndex];
        if (
            app.host.chatId() !== draft.chatId ||
            draft.messageIndex !== messages.length - 1 ||
            !isAssistant(message) ||
            swipeOf(message) !== draft.swipeId
        ) {
            app.ui.notice(app.i18n.t('turn.redo.tooLate'), { level: 'warn' });
            return;
        }
        const ctx = app.host.ctx() as STContext & {
            swipe?: { to?: (event: null, direction: string, options: Record<string, unknown>) => Promise<void> };
        };
        const swipes = Array.isArray(message.swipes) ? message.swipes.length : 1;
        try {
            if (typeof ctx.swipe?.to === 'function') {
                void ctx.swipe.to(null, 'right', { message, forceSwipeId: Math.max(1, swipes) });
            } else {
                void ctx.executeSlashCommandsWithOptions('/swipe');
            }
        } catch (error) {
            log.warn('could not request a new swipe', error);
        }
    }

    /* ------------------------------------------------------------------ commit */

    async function apply(chatId: string, index: number, swipe: number, hash: string, pass: TurnPass | null) {
        const api = maestro();
        const store = engine();
        if (!api || !store || !stillCommitted(chatId, index, swipe, hash)) return;
        const commitId = `${key(chatId, index, swipe)}\u0000${hash}`;
        if (applied.has(commitId)) return;
        applied.add(commitId);
        const out: { result?: CommitResult; before?: ChatState; view?: EngineView } = {};
        const saved = await store.updateState((state, current) => {
            out.before = structuredClone(state);
            out.view = current;
            out.result = commitTurn(inputFor(current, state, index), pass, {
                rng: app.rng,
                levers: levers(current),
                messageIndex: index,
                uiLang: app.i18n.locale(),
                cardLang: app.settings.get().cardLanguage,
            });
            return out.result.state;
        });
        if (!saved || !out.result || !out.before || !out.view) {
            applied.delete(commitId);
            return;
        }
        await afterCommit(api, chatId, index, out.result, out.before, out.view);
    }

    async function afterCommit(
        api: MaestroApiV1,
        chatId: string,
        index: number,
        result: CommitResult,
        before: ChatState,
        view: EngineView,
    ): Promise<void> {
        const turn = result.state.turn;
        const change: ApiJournalChange = { target: STATE_TARGET, ref: { chatId, turn }, before, after: { turn } };
        try {
            await api.journal.record({
                kind: TURN_JOURNAL_KIND,
                summary: result.events.length
                    ? app.i18n.t('turn.journal.summary', { turn, count: result.events.length })
                    : app.i18n.t('turn.journal.quiet', { turn }),
                changes: [change],
                sourceMessage: index,
            });
        } catch (error) {
            log.warn('journal record failed', error);
        }
        // Not awaited: an «ask» level may wait for the user, and the turn pipeline must not.
        for (const proposal of result.proposals) void proposeArc(api, chatId, proposal, view);
        for (const note of result.notes) {
            if (note.kind === 'break' || note.kind === 'scheme-exposed') {
                const kind = note.kind === 'break' ? 'break' : 'scheme';
                const line = result.events
                    .filter((event) => event.character === note.character && event.kind === kind)
                    .pop();
                if (line) api.notice(line.text, { importance: 'info' });
            } else if (note.kind === 'new-names') {
                log.debug('new names in the scene', note.names);
            }
        }
    }

    async function proposeArc(api: MaestroApiV1, chatId: string, proposal: ArcProposal, view: EngineView) {
        const name = (id: string) => (id === PLAYER_ID ? view.playerName : (view.byId.get(id)?.name ?? id));
        const lang = app.i18n.locale();
        const gender = view.byId.get(proposal.character)?.gender;
        const payload: ArcPayload = { ...proposal, chatId };
        try {
            await api.propose({
                kind: ARC_KIND,
                title: app.i18n.t('turn.arc.title', {
                    name: name(proposal.character),
                    target: name(proposal.target),
                    from: stanceLabel(proposal.from, lang, gender),
                    to: stanceLabel(proposal.to, lang, gender),
                }),
                description: app.i18n.t('turn.arc.description', { text: proposal.text }),
                changes: [
                    {
                        target: STATE_TARGET,
                        ref: { chatId, character: proposal.character, target: proposal.target },
                        before: proposal.from,
                        after: proposal.to,
                    },
                ],
                payload: JSON.parse(JSON.stringify(payload)) as unknown,
                ...(proposal.sourceMessage !== undefined ? { sourceMessage: proposal.sourceMessage } : {}),
                fallback: 'inbox',
                acceptLabel: app.i18n.t('turn.arc.accept'),
                rejectLabel: app.i18n.t('turn.arc.reject'),
            });
        } catch (error) {
            log.warn('arc proposal failed', error);
        }
    }

    /* ------------------------------------------------------------------ appliers and undo */

    function arcPayload(payload: unknown): ArcPayload | null {
        const proposal = parseArcProposal(payload);
        const chatId = (payload as { chatId?: unknown } | null)?.chatId;
        return proposal && typeof chatId === 'string' ? { ...proposal, chatId } : null;
    }

    async function applyArc(payload: unknown): Promise<void> {
        const proposal = arcPayload(payload);
        const store = engine();
        if (!proposal || !store || app.host.chatId() !== proposal.chatId) {
            log.info('arc step not applied: it belongs to another chat or is malformed');
            return;
        }
        await store.updateState(
            (state, view) =>
                applyArcProposal(state, proposal, {
                    profiles: view.profiles,
                    playerName: view.playerName,
                    uiLang: app.i18n.locale(),
                }).state,
        );
    }

    async function arcStillValid(payload: unknown): Promise<boolean> {
        const proposal = arcPayload(payload);
        const view = engine()?.view();
        return !!proposal && !!view && app.host.chatId() === proposal.chatId && arcProposalValid(view.state, proposal);
    }

    async function undo(change: ApiJournalChange): Promise<boolean> {
        const ref = change.ref as { chatId?: unknown; turn?: unknown };
        const store = engine();
        const view = store?.view();
        const before = change.before as ChatState | null;
        if (!store || !view || ref.chatId !== app.host.chatId()) return false;
        // Only the latest committed turn can be taken back: later turns were built on it.
        if (view.state.turn !== ref.turn || !before || typeof before !== 'object' || typeof before.turn !== 'number') {
            return false;
        }
        return store.updateState(() => structuredClone(before));
    }

    /* ------------------------------------------------------------------ events */

    return {
        async onReply(messageIndex: number): Promise<void> {
            const api = maestro();
            if (!api || !leader(api)) return;
            const chatId = app.host.chatId();
            const store = engine();
            if (!chatId || !store) return;
            const view = store.view() ?? (await store.ready());
            if (!view || skipped(view)) return;
            launch(chatId, messageIndex, view);
        },

        async onCommit(messageIndex: number): Promise<void> {
            const api = maestro();
            if (!api || !leader(api)) return;
            const chatId = app.host.chatId();
            const store = engine();
            const message = chat()[messageIndex];
            if (!chatId || !store || !isAssistant(message)) return;
            const swipe = swipeOf(message);
            const hash = fingerprint(message);
            const id = key(chatId, messageIndex, swipe);
            const draft = app.state.takeDraft(messageIndex, swipe) as TurnDraft | undefined;
            if (draft && draft.chatId === chatId && draft.hash === hash) {
                await apply(chatId, messageIndex, swipe, hash, draft.pass);
                return;
            }
            if (pending.has(id)) {
                waiting.add(id);
                return;
            }
            const view = store.view() ?? (await store.ready());
            if (!view) return;
            if (skipped(view)) {
                await apply(chatId, messageIndex, swipe, hash, null);
                return;
            }
            // No draft (a swipe back to an older reply, a reload): run the pass now and apply it when it is done.
            waiting.add(id);
            launch(chatId, messageIndex, view);
            if (!pending.has(id) && waiting.delete(id)) await apply(chatId, messageIndex, swipe, hash, null);
        },

        onInvalidated(messageIndex: number): void {
            for (const [id, item] of [...pending]) {
                const index = Number(id.split('\u0000')[1]);
                if (index >= messageIndex) {
                    item.controller.abort();
                    pending.delete(id);
                    waiting.delete(id);
                }
            }
            app.state.dropDrafts(messageIndex);
        },

        reset(): void {
            for (const item of pending.values()) item.controller.abort();
            pending.clear();
            waiting.clear();
            applied.clear();
        },

        /** Settles once every pass in flight has finished (tests, shutdown). */
        async idle(): Promise<void> {
            await Promise.all([...pending.values()].map((item) => item.promise));
        },

        applyArc,
        arcStillValid,
        undo,
    };
}

export type TurnController = ReturnType<typeof createTurnController>;

export const turnModule: DramatisModule<TurnSettings> = {
    key: 'turn',
    stage: 2,
    titleKey: 'turn.title',
    enabledByDefault: true,
    needsMaestro: true,
    defaults: () => ({ maxTokens: 1600, temperature: 0.2 }),
    i18n: TURN_STRINGS,
    init(ctx: ModuleContext<TurnSettings>) {
        const { app, own, log } = ctx;
        const api = app.maestro.api();
        if (!api) return;
        const controller = createTurnController(app, ctx.settings, log);
        // Registrations live as long as this start: Maestro forgets them on its restart, and the module manager
        // restarts this module on `maestro:changed`.
        own(api.llm.registerTask(TURN_TASK, { ru: 'Dramatis: такт', en: 'Dramatis: turn pass' }));
        own(
            api.registerApplier(
                ARC_KIND,
                { ru: 'Dramatis: шаг дуги', en: 'Dramatis: arc step' },
                (payload) => controller.applyArc(payload),
                (payload) => controller.arcStillValid(payload),
            ),
        );
        own(api.journal.registerUndo(STATE_TARGET, (change) => controller.undo(change)));
        own(app.bus.on('reply:ready', ({ messageIndex }) => controller.onReply(messageIndex)));
        own(app.bus.on('turn:committed', ({ messageIndex }) => controller.onCommit(messageIndex)));
        own(app.bus.on('message:invalidated', ({ messageIndex }) => controller.onInvalidated(messageIndex)));
        own(app.bus.on('chat:changed', () => controller.reset()));
        own(() => controller.reset());
    },
};
