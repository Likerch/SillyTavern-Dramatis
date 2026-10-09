// Module «cast» (stage 1, works without Maestro): the motive card (docs/model.md §6). Right before every real
// generation (not a dry run, not a quiet background call) it refreshes the engine's scene and sets the one-generation
// injection `dramatis_cast` (in chat, depth from the settings, system role) built from the stored state only — no AI on
// the send path (П10). Nobody present, no chat or no engine: nothing is injected.
//
// With Maestro the user's message commits the previous reply only after ST ran the producers (MESSAGE_SENT comes after
// GENERATION_AFTER_COMMANDS), so the card is built once more at Maestro's `generation:before` (its generate interceptor,
// before the prompt is assembled), after the turn module settled that commit: the generation gets the `state.next` of
// the turn it follows. A generation that writes a BunnyMo sheet (`!fullsheet`…) gets no card.
//
// With Maestro, while the chat has a cast and the voice cards are merged into the card (speech digests come from
// MAESTRO_API.speech), the module claims Maestro's quiet modes `voices` and `ck.consistency` — one block per character
// instead of three (docs/integration-dramatis.md §5.4 on Maestro's side). The claims go when the cast empties, the
// merge is switched off, the module stops or Maestro goes away.
// In the «Кино» mode the director module (stage 5) is asked for this beat's calls once per generation (in the producer,
// after the reply being answered is committed); they go into this generation's card only.
import { buildCastCard } from '../../domain/render';
import type { MaestroApiV1, MaestroQuietFunction } from '../../shared/apis';
import type { App, DramatisModule, GenerationInfo, I18nParts, Logger, Unsubscribe } from '../../shared/contracts';
import { DIRECTOR_API } from '../director/api';
import type { DirectorApi } from '../director/api';
import { ENGINE_API } from '../engine/api';
import type { EngineApi, EngineView } from '../engine/api';
import { TURN_API } from '../turn/api';
import type { TurnApi } from '../turn/api';

export type CastSettings = Record<string, never>;

/** Injection key (ST slot `dramatis_cast`). */
export const CAST_INJECTION = 'cast';
/** Owner name of Dramatis' claims on Maestro's quiet modes. */
export const QUIET_OWNER = 'dramatis';
/** How long the card waits for the committed turn at Maestro's `generation:before` (Maestro waits 1.5 s at most). */
export const SETTLE_MS = 1000;

/** BunnyMo sheet commands (as Maestro's src/domain/sheets.ts detects them). */
const SHEET_COMMAND_RE =
    /(^|[^\p{L}\p{N}])!(fullsheet|quicksheet|tagsheet|memsheet|updatesheet|physheet)(?![\p{L}\p{N}])/iu;

/** The user's message asks BunnyMo for a sheet: that generation writes the sheet, not the story. */
export function isSheetCommand(text: string | null | undefined): boolean {
    return !!text && SHEET_COMMAND_RE.test(text);
}

/** Waits for a promise at most `ms` (the send path must not hang on a slow save). */
async function within(promise: Promise<unknown>, ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
    });
    try {
        await Promise.race([
            promise.then(
                () => undefined,
                () => undefined,
            ),
            timeout,
        ]);
    } finally {
        clearTimeout(timer);
    }
}

export const CAST_STRINGS: I18nParts = {
    en: {
        'cast.title': 'Motive card',
        'cast.slash.card': 'Shows the motive card that would be sent with the next generation (for debugging).',
        'cast.slash.empty': 'Nobody is in the scene: no motive card would be sent now.',
    },
    ru: {
        'cast.title': 'Карточка мотивов',
        'cast.slash.card': 'Показывает карточку мотивов, которая уйдёт со следующей генерацией (для отладки).',
        'cast.slash.empty': 'В сцене никого нет: карточка мотивов сейчас не отправляется.',
    },
};

/** Present ids that have a profile. */
function castOf(view: EngineView | null): string[] {
    return view ? view.present.filter((id) => view.byId.has(id)) : [];
}

/** The motive card text for the engine's current view ('' when nobody is present); `director`: this beat's calls. */
export function castCardText(
    app: App,
    view: EngineView | null,
    log?: Logger,
    director?: Readonly<Record<string, string>>,
): string {
    const present = castOf(view);
    if (!view || !present.length) return '';
    const settings = app.settings.get();
    const state = view.state;
    const next = state.next && state.next.turn === state.turn ? state.next : undefined;
    const api = app.maestro.api();
    const merge = settings.mergeVoices && api !== null;
    const speech = (id: string): string | null => {
        const name = view.byId.get(id)?.name;
        if (!api || !name) return null;
        try {
            return api.speech(name);
        } catch (error) {
            log?.debug('Maestro speech failed', error);
            return null;
        }
    };
    return buildCastCard({
        profiles: view.profiles,
        state,
        present,
        bands: view.bands,
        moves: next?.moves,
        playerName: view.playerName,
        lang: settings.cardLanguage,
        budgetTokens: settings.cardBudget,
        speech: merge ? speech : undefined,
        corrections: next?.corrections,
        mergeVoices: merge,
        appetites: next?.appetites,
        snaps: next?.snaps,
        director,
    }).text;
}

export const castModule: DramatisModule<CastSettings> = {
    key: 'cast',
    stage: 1,
    titleKey: 'cast.title',
    enabledByDefault: true,
    defaults: () => ({}),
    i18n: CAST_STRINGS,

    init({ app, log, own }) {
        let stopped = false;
        /** The generation in progress writes a BunnyMo sheet: no card, and Maestro keeps its own blocks. */
        let sheet = false;
        let attached: EngineApi | null = null;
        let offEngine: Unsubscribe | null = null;
        const claims = new Map<MaestroQuietFunction, Unsubscribe>();
        let claimedWith: MaestroApiV1 | null = null;
        let lastActive = false;

        const engine = (): EngineApi | null => app.modules.api<EngineApi>(ENGINE_API) ?? null;

        /** Follows the engine instance (it may start after this module or restart). */
        function attach(): EngineApi | null {
            const current = engine();
            if (current === attached) return current;
            offEngine?.();
            offEngine = null;
            attached = current;
            if (current) offEngine = current.onChange(() => sync());
            return current;
        }

        const hasCast = (): boolean => !stopped && castOf(attach()?.view() ?? null).length > 0;

        function release(fn: MaestroQuietFunction): void {
            const off = claims.get(fn);
            claims.delete(fn);
            try {
                off?.();
            } catch (error) {
                log.debug(`releasing quiet ${fn} failed`, error);
            }
        }

        function syncQuiet(active: boolean): void {
            const api = stopped ? null : app.maestro.api();
            if (claimedWith && claimedWith !== api) for (const fn of [...claims.keys()]) release(fn);
            const wanted = new Set<MaestroQuietFunction>();
            if (api && active) {
                // One block per character (motives + speech) replaces both — only while the speech is merged in;
                // without it CK's consistency block keeps the speech side (Maestro's contract, §5.4).
                if (app.settings.get().mergeVoices) {
                    wanted.add('voices');
                    wanted.add('ck.consistency');
                }
            }
            for (const fn of [...claims.keys()]) if (!wanted.has(fn)) release(fn);
            for (const fn of wanted) {
                if (claims.has(fn) || !api) continue;
                try {
                    claims.set(fn, api.quiet(fn, QUIET_OWNER));
                    claimedWith = api;
                } catch (error) {
                    log.warn(`Maestro quiet ${fn} failed`, error);
                }
            }
            if (!claims.size) claimedWith = null;
        }

        const part = { castBlockActive: () => hasCast() && !sheet };

        function sync(): void {
            const active = hasCast();
            syncQuiet(active);
            if (active !== lastActive) {
                lastActive = active;
                // Re-registering the part makes DRAMATIS_API tell its listeners.
                if (!stopped) app.modules.expose('api', part);
            }
        }

        /** What the user's message of this generation says: the input before ST sends it, else the last user message. */
        function userText(gen: GenerationInfo): string {
            if (gen.type === 'normal' && typeof document !== 'undefined') {
                const input = document.getElementById('send_textarea') as HTMLTextAreaElement | null;
                if (input?.value?.trim()) return input.value;
            }
            const chat = app.host.ctx().chat;
            for (let i = (Array.isArray(chat) ? chat.length : 0) - 1; i >= 0; i--) {
                const message = chat[i];
                if (message?.is_user && !message.is_system) return String(message.mes ?? '');
            }
            return '';
        }

        /** The real generation in progress (its card may still be rebuilt), null between generations. */
        let generation: GenerationInfo | null = null;
        /** The director's calls for the generation in progress (cinema), asked once per generation. */
        let directorCalls: Readonly<Record<string, string>> | undefined;

        /** Sets (or clears) the card of this generation from the engine's view now. */
        async function inject(gen: GenerationInfo): Promise<void> {
            if (gen.dryRun || gen.quiet || stopped) return;
            generation = gen;
            sheet = isSheetCommand(userText(gen));
            const current = attach();
            let text = '';
            if (current && !sheet) {
                await current.refresh();
                text = stopped ? '' : castCardText(app, current.view(), log, directorCalls);
            }
            if (!text && !app.ephemeral.isSet(CAST_INJECTION)) return;
            app.ephemeral.setInjection(CAST_INJECTION, {
                text,
                position: 1,
                depth: app.settings.get().depth,
                role: 0,
            });
        }

        /**
         * «Кино»: the director's calls, asked once per generation in the producer — ST awaits it fully, while Maestro
         * waits for its `generation:before` listeners at most 1.5 s. A message being sent first commits the reply it
         * answers (turn.settle), so the director sees the fresh view.
         */
        async function direct(gen: GenerationInfo): Promise<void> {
            const director = app.modules.api<DirectorApi>(DIRECTOR_API);
            if (!director || gen.dryRun || gen.quiet || stopped || app.settings.get().mode !== 'cinema') return;
            const turn = app.modules.api<TurnApi>(TURN_API);
            if (turn && gen.type === 'normal') await within(turn.settle(), SETTLE_MS);
            directorCalls = await director.beat(gen).catch(() => undefined);
        }

        own(
            app.ephemeral.addProducer(CAST_INJECTION, async (gen) => {
                await direct(gen);
                await inject(gen);
            }),
        );
        // With Maestro: once more inside its generate interceptor, after the commit of the reply this message answered.
        own(
            app.bus.on('generation:before', async (gen) => {
                if (gen.dryRun || gen.quiet || stopped || !app.maestro.api()) return;
                const turn = app.modules.api<TurnApi>(TURN_API);
                if (turn) await within(turn.settle(), SETTLE_MS);
                await inject(gen);
            }),
        );
        own(
            app.bus.on('generation:ended', () => {
                sheet = false;
                generation = null;
                directorCalls = undefined;
            }),
        );
        // A commit that lands later still (its pass finished meanwhile, a slow save): the card follows it while the
        // generation runs — a prompt already assembled keeps what it read, the slot is cleared at the end anyway.
        own(
            app.bus.on('turn:applied', async () => {
                if (generation) await inject(generation);
            }),
        );
        own(
            app.ui.addSlashCommand('dramatis-card', 'cast.slash.card', async () => {
                const current = attach();
                await current?.refresh();
                return castCardText(app, current?.view() ?? null, log) || app.i18n.t('cast.slash.empty');
            }),
        );
        // Maestro forgets claims when it restarts: whenever it comes (or goes), start over.
        own(
            app.bus.on('maestro:changed', () => {
                for (const fn of [...claims.keys()]) release(fn);
                claimedWith = null;
                sync();
            }),
        );
        own(
            app.settings.onChange((key) => {
                if (key === 'mergeVoices' || key === '*') sync();
                // A module switch is announced before the module starts: look for the engine once it has.
                else if (key.startsWith('modules.')) queueMicrotask(() => !stopped && sync());
            }),
        );
        own(() => {
            stopped = true;
            offEngine?.();
            offEngine = null;
            attached = null;
            for (const fn of [...claims.keys()]) release(fn);
            claimedWith = null;
        });

        app.modules.expose('api', part);
        sync();
    },
};
