// Module «cast» (stage 1, works without Maestro): the motive card (docs/model.md §6). Right before every real
// generation (not a dry run, not a quiet background call) it refreshes the engine's scene and sets the one-generation
// injection `dramatis_cast` (in chat, depth from the settings, system role) built from the stored state only — no AI on
// the send path (П10). Nobody present, no chat or no engine: nothing is injected.
//
// With Maestro, while the chat has a cast the module claims Maestro's quiet modes: `voices` when the voice cards are
// merged into the card (speech digests come from MAESTRO_API.speech), `ck.consistency` always — one block per
// character instead of three. The claims go when the cast empties, the module stops or Maestro goes away.
import { buildCastCard } from '../../domain/render';
import type { MaestroApiV1, MaestroQuietFunction } from '../../shared/apis';
import type { App, DramatisModule, I18nParts, Logger, Unsubscribe } from '../../shared/contracts';
import { ENGINE_API } from '../engine/api';
import type { EngineApi, EngineView } from '../engine/api';

export type CastSettings = Record<string, never>;

/** Injection key (ST slot `dramatis_cast`). */
export const CAST_INJECTION = 'cast';
/** Owner name of Dramatis' claims on Maestro's quiet modes. */
export const QUIET_OWNER = 'dramatis';

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

/** The motive card text for the engine's current view ('' when nobody is present). */
export function castCardText(app: App, view: EngineView | null, log?: Logger): string {
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
                wanted.add('ck.consistency');
                if (app.settings.get().mergeVoices) wanted.add('voices');
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

        const part = { castBlockActive: () => hasCast() };

        function sync(): void {
            const active = hasCast();
            syncQuiet(active);
            if (active !== lastActive) {
                lastActive = active;
                // Re-registering the part makes DRAMATIS_API tell its listeners.
                if (!stopped) app.modules.expose('api', part);
            }
        }

        own(
            app.ephemeral.addProducer(CAST_INJECTION, async (gen) => {
                if (gen.dryRun || gen.quiet) return;
                const current = attach();
                if (!current) return;
                await current.refresh();
                const text = castCardText(app, current.view(), log);
                if (!text) return;
                app.ephemeral.setInjection(CAST_INJECTION, {
                    text,
                    position: 1,
                    depth: app.settings.get().depth,
                    role: 0,
                });
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
