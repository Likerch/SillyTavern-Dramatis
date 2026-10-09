// The turn module (docs/model.md §5, §8, §12 «Ход»; dev-plan stage 2 «Такт»). After every reply the leader tab asks
// the background model (task 'dramatis.turn') what happened in it; the answer is kept as a draft of that message and
// swipe and applied only when the user sends the next message (П11: swiped replies leave nothing). Applying runs the
// pure rules of domain/turn-apply.ts through the engine (stances with inertia, moods, intentions, appetites, methods,
// schemes, corruption, drift, reputation, bands and initiative), records a journal entry with undo, and routes held
// arc steps to Maestro's Inbox. Mode «Экономный» runs the pass every 2nd reply for the characters in focus or on
// business with the player. Drift in mode «Переделать» offers a new swipe of the reply before it is committed.
import { desSwipeRecord, parseDesScene } from '../../adapters/des/parse';
import { PLAYER_ID } from '../../domain/model';
import type { ChatState, Tie } from '../../domain/model';
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
import { stableHash } from '../../core/hash';
import { ENGINE_API } from '../engine/api';
import type { EngineApi, EngineView } from '../engine/api';
import { TURN_API } from './api';
import type { TurnApi } from './api';
import { TURN_STRINGS } from './strings';

export const ARC_KIND = 'dramatis.arc';
export const TURN_JOURNAL_KIND = 'dramatis.turn';
/** Journal target of the chat state: a committed turn (undone from its snapshot) and an arc step. */
export const STATE_TARGET = 'dramatis-state';

/**
 * The state before the latest committed turn, kept in Dramatis' own file per chat (one snapshot, overwritten by the
 * next commit). Maestro's journal keeps up to 2000 records per chat in one document: a whole state in each turn's
 * record made that document grow by the size of the state every turn.
 */
export interface TurnSnapshot {
    chatId: string;
    /** The turn the snapshot undoes (the state's turn after that commit). */
    turn: number;
    before: ChatState;
}

/** File of a chat's turn snapshot (`dramatis-chat-<hash>-undo.json`). */
export function snapshotFile(app: App, chatId: string): string {
    return app.files.fileName(`chat-${stableHash(chatId)}-undo`);
}

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

/** Errors of a background request that mean «not now»: another tab leads, the daily cap, Maestro restarting. */
const SILENT_ERRORS = new Set(['not-leader', 'cap', 'aborted', 'maestro-stopped']);

interface Pending {
    controller: AbortController;
    promise: Promise<void>;
}

/** A saved commit, for the journal and the notices that follow it. */
interface Committed {
    api: MaestroApiV1;
    result: CommitResult;
    before: ChatState;
    view: EngineView;
}

/** The same reply (index, swipe, text) as the state's last committed one. */
export function sameCommit(state: ChatState, messageIndex: number, swipeId: number, hash: string): boolean {
    const last = state.lastCommit;
    return !!last && last.messageIndex === messageIndex && last.swipeId === swipeId && last.hash === hash;
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
    /** Passes that came back without a usable answer (same keys): the commit applies no pass instead of asking again. */
    const failed = new Set<string>();
    /** Commits being saved now. */
    const committing = new Set<Promise<Committed | null>>();
    /** Replies with a drafted pass (same keys → text hash): ST may announce one reply twice; it is read once. */
    const drafted = new Map<string, string>();

    const key = (chatId: string, index: number, swipe: number) => `${chatId}\u0000${index}\u0000${swipe}`;
    const commitKey = (chatId: string, index: number, swipe: number, hash: string) =>
        `${key(chatId, index, swipe)}\u0000${hash}`;
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
        if (!waiting.has(id) && drafted.get(id) === hash) return;
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
            let silent = false;
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
                else if (SILENT_ERRORS.has(result.error ?? '')) {
                    silent = true;
                    log.debug(`turn pass skipped: ${result.error}`);
                } else log.warn(`turn pass failed: ${result.error ?? 'unknown error'}`);
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
            // A refusal or an unreadable answer is not asked again when the reply is committed.
            if (!pass && !silent) failed.add(commitKey(chatId, index, swipe, hash));
            if (waiting.delete(id)) {
                await apply(chatId, index, swipe, hash, pass);
                return;
            }
            if (!pass) return;
            const draft: TurnDraft = { chatId, messageIndex: index, swipeId: swipe, hash, pass, ids };
            app.state.setDraft(index, swipe, draft);
            drafted.set(id, hash);
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

    /** Whether this reply was committed already (in this session, or as the state's last commit). */
    function isCommitted(chatId: string, index: number, swipe: number, hash: string): boolean {
        if (applied.has(commitKey(chatId, index, swipe, hash))) return true;
        const state = engine()?.view()?.state;
        return !!state && sameCommit(state, index, swipe, hash);
    }

    /** Saves the commit of a reply; null when it was not applied (not committed any more, already applied, lost). */
    async function commit(
        chatId: string,
        index: number,
        swipe: number,
        hash: string,
        pass: TurnPass | null,
    ): Promise<Committed | null> {
        const api = maestro();
        const store = engine();
        if (!api || !store || !stillCommitted(chatId, index, swipe, hash)) return null;
        const commitId = commitKey(chatId, index, swipe, hash);
        if (applied.has(commitId)) return null;
        applied.add(commitId);
        const out: { result?: CommitResult; before?: ChatState; view?: EngineView; again?: boolean } = {};
        const saved = await store.updateState((state, current) => {
            // Another tab (or this one before a reload) committed this very reply already: the state stays.
            if (sameCommit(state, index, swipe, hash)) {
                out.again = true;
                return state;
            }
            out.before = structuredClone(state);
            out.view = current;
            out.result = commitTurn(inputFor(current, state, index), pass, {
                rng: app.rng,
                levers: levers(current),
                messageIndex: index,
                uiLang: app.i18n.locale(),
                cardLang: app.settings.get().cardLanguage,
            });
            out.result.state.lastCommit = { messageIndex: index, swipeId: swipe, hash };
            return out.result.state;
        });
        if (out.again) return null;
        if (!saved || !out.result || !out.before || !out.view) {
            applied.delete(commitId);
            return null;
        }
        failed.delete(commitId);
        return { api, result: out.result, before: out.before, view: out.view };
    }

    /**
     * Commits a reply, then (outside `settle()`) journals it and tells the modules that build on the committed turn
     * (`turn:applied`): the generator and the world always see the new turn counter and `state.next`.
     */
    async function apply(chatId: string, index: number, swipe: number, hash: string, pass: TurnPass | null) {
        const job = commit(chatId, index, swipe, hash, pass);
        committing.add(job);
        const done = await job.finally(() => committing.delete(job));
        if (!done) return;
        await afterCommit(done.api, chatId, index, done.result, done.before, done.view);
        await app.bus.emit('turn:applied', { messageIndex: index, turn: done.result.state.turn });
    }

    /** The reply the last user message answered (committed when it was sent), or -1. */
    function committedIndex(): number {
        const messages = chat();
        for (let i = messages.length - 1; i >= 0; i--) {
            const message = messages[i];
            if (!message?.is_user || message.is_system) continue;
            for (let j = i - 1; j >= 0; j--) if (isAssistant(messages[j])) return j;
            return -1;
        }
        return -1;
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
        const snapshot: TurnSnapshot = { chatId, turn, before };
        try {
            await app.files.write(snapshotFile(app, chatId), snapshot);
        } catch (error) {
            log.warn('the turn snapshot could not be written: this turn cannot be undone', error);
        }
        const change: ApiJournalChange = {
            target: STATE_TARGET,
            ref: { chatId, turn },
            before: { turn: before.turn },
            after: { turn },
        };
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

    /** The state before a committed turn: the snapshot file, or the record itself (older records kept a whole state). */
    async function turnBefore(chatId: string, turn: number, recorded: unknown): Promise<ChatState | null> {
        const whole = recorded as ChatState | null;
        if (whole && typeof whole === 'object' && typeof whole.turn === 'number' && whole.characters) return whole;
        let snapshot: TurnSnapshot | null = null;
        try {
            snapshot = await app.files.read<TurnSnapshot>(snapshotFile(app, chatId), { fresh: true });
        } catch (error) {
            log.warn('the turn snapshot could not be read', error);
        }
        if (!snapshot || snapshot.chatId !== chatId || snapshot.turn !== turn) return null;
        const before = snapshot.before;
        return before && typeof before === 'object' && typeof before.turn === 'number' ? before : null;
    }

    /** An approved arc step taken back: the tie returns to where it was, if nothing moved it since. */
    async function undoArc(store: EngineApi, view: EngineView, change: ApiJournalChange): Promise<boolean> {
        const ref = change.ref as { character?: unknown; target?: unknown };
        const from = change.before;
        const to = change.after;
        if (typeof ref.character !== 'string' || typeof ref.target !== 'string') return false;
        if (typeof from !== 'number' || typeof to !== 'number') return false;
        const character = ref.character;
        const target = ref.target;
        if (view.state.characters[character]?.ties[target]?.stance !== to) return false;
        let undone = false;
        const saved = await store.updateState((state) => {
            const live = state.characters[character];
            const tie = live?.ties[target];
            if (!live || !tie || tie.stance !== to) return;
            const step = Math.sign(to - from);
            const moved =
                tie.moved?.scene === state.scene ? { ...tie.moved, delta: tie.moved.delta - step } : tie.moved;
            live.ties[target] = { ...tie, stance: from as Tie['stance'], ...(moved ? { moved } : {}) };
            undone = true;
        });
        return saved && undone;
    }

    async function undo(change: ApiJournalChange): Promise<boolean> {
        const ref = change.ref as { chatId?: unknown; turn?: unknown; character?: unknown };
        const store = engine();
        const view = store?.view();
        const chatId = app.host.chatId();
        if (!store || !view || !chatId || ref.chatId !== chatId) return false;
        if (typeof ref.character === 'string') return undoArc(store, view, change);
        // Only the latest committed turn can be taken back: later turns were built on it.
        if (typeof ref.turn !== 'number' || view.state.turn !== ref.turn) return false;
        const before = await turnBefore(chatId, ref.turn, change.before);
        if (!before || engine()?.view()?.state.turn !== ref.turn) return false;
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
            // The scene as this reply left it (presence, bands), not as the generation found it.
            await store.refresh();
            const view = store.view() ?? (await store.ready());
            if (!view || skipped(view) || app.host.chatId() !== chatId) return;
            launch(chatId, messageIndex, view);
        },

        /** TurnApi.settle (api.ts). */
        async settle(): Promise<void> {
            const api = maestro();
            const chatId = app.host.chatId();
            const index = committedIndex();
            if (api && chatId && index >= 0 && leader(api)) {
                const message = chat()[index]!;
                const swipe = swipeOf(message);
                const hash = fingerprint(message);
                if (!isCommitted(chatId, index, swipe, hash) && !pending.has(key(chatId, index, swipe))) {
                    const draft = app.state.takeDraft(index, swipe) as TurnDraft | undefined;
                    if (draft && draft.chatId === chatId && draft.hash === hash) {
                        drafted.delete(key(chatId, index, swipe));
                        void apply(chatId, index, swipe, hash, draft.pass);
                    } else if (draft) {
                        app.state.setDraft(index, swipe, draft);
                    }
                }
            }
            await Promise.all([...committing]);
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
            // The same reply again (a second message sent after it, a reload): committed once, never asked again.
            if (isCommitted(chatId, messageIndex, swipe, hash)) return;
            const draft = app.state.takeDraft(messageIndex, swipe) as TurnDraft | undefined;
            drafted.delete(id);
            if (draft && draft.chatId === chatId && draft.hash === hash) {
                await apply(chatId, messageIndex, swipe, hash, draft.pass);
                return;
            }
            if (pending.has(id)) {
                waiting.add(id);
                return;
            }
            const view = store.view() ?? (await store.ready());
            if (!view || isCommitted(chatId, messageIndex, swipe, hash)) return;
            if (skipped(view) || failed.has(commitKey(chatId, messageIndex, swipe, hash))) {
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
            for (const id of [...drafted.keys()]) {
                if (Number(id.split('\u0000')[1]) >= messageIndex) drafted.delete(id);
            }
            app.state.dropDrafts(messageIndex);
        },

        reset(): void {
            for (const item of pending.values()) item.controller.abort();
            pending.clear();
            waiting.clear();
            applied.clear();
            failed.clear();
            drafted.clear();
        },

        /** Settles once every pass in flight and every commit being saved has finished (tests, shutdown). */
        async idle(): Promise<void> {
            await Promise.all([...pending.values()].map((item) => item.promise));
            await Promise.all([...committing]);
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
        const turnApi: TurnApi = { settle: () => controller.settle() };
        app.modules.expose(TURN_API, turnApi);
    },
};
