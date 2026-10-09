// Module «engine» (stage 1, works without Maestro): the current card profiles + chat state and the scene view behind
// EngineApi (engine.ts), plus its part of DRAMATIS_API — whether the chat has a cast, every stance with its reasons
// (NPC → player and NPC ↔ NPC, for Maestro's relations graph), goals, the dependences the engine owns (BunnyMo's
// Medicine Check stays quiet for them) and the «relationships»/«social» mechanics templates it replaces.
import { stanceLabel } from '../../domain/ladders';
import { PLAYER_ID } from '../../domain/model';
import type { AppetiteKind } from '../../domain/model';
import { strongestReasons } from '../../domain/render';
import type { DramatisApiV1, DramatisStanceInfo } from '../../shared/apis';
import type { App, DramatisModule, I18nParts } from '../../shared/contracts';
import { ENGINE_API } from './api';
import type { EngineApi } from './api';
import { createEngine } from './engine';

export type EngineSettings = Record<string, never>;

/** Appetites whose dependence the engine leads (BunnyMo's Medicine Check is silenced for their owners). */
const DEPENDENCE_KINDS: readonly AppetiteKind[] = ['drink', 'substance'];

export const ENGINE_STRINGS: I18nParts = {
    en: {
        'engine.title': 'Engine',
        'engine.player': 'the player',
    },
    ru: {
        'engine.title': 'Движок',
        'engine.player': 'игрок',
    },
};

type ApiPart = Partial<Omit<DramatisApiV1, 'version' | 'dramatisVersion' | 'onChange'>>;

/** The engine's part of DRAMATIS_API. */
export function engineApiPart(engine: EngineApi, app: App): ApiPart {
    const active = (): boolean => (engine.view()?.profiles.length ?? 0) > 0;

    return {
        active,

        stances(): DramatisStanceInfo[] {
            const view = engine.view();
            if (!view) return [];
            const lang = app.i18n.locale();
            const player = view.playerName.trim() || app.i18n.t('engine.player');
            const out: DramatisStanceInfo[] = [];
            for (const profile of view.profiles) {
                const live = view.state.characters[profile.id];
                const ties = live ? Object.values(live.ties) : profile.ties;
                for (const tie of ties) {
                    if (!tie || tie.target === profile.id) continue;
                    const to = tie.target === PLAYER_ID ? player : view.byId.get(tie.target)?.name;
                    if (!to) continue;
                    out.push({
                        from: profile.name,
                        to,
                        stance: tie.stance,
                        label: stanceLabel(tie.stance, lang, profile.gender),
                        reasons: strongestReasons(tie.reasons ?? [], tie.reasons?.length ?? 0),
                    });
                }
            }
            return out;
        },

        goals(name: string): string[] {
            const view = engine.view();
            const id = view ? engine.resolve(name) : null;
            const profile = id ? view?.byId.get(id) : undefined;
            if (!view || !id || !profile) return [];
            const agenda = view.state.characters[id]?.agenda ?? profile.agenda;
            const texts = [
                ...[...(agenda.goals ?? [])].sort((a, b) => a.priority - b.priority).map((goal) => goal.text),
                ...(agenda.intentions ?? []).map((intention) => intention.text),
            ];
            const seen = new Set<string>();
            return texts
                .map((text) => (text ?? '').trim())
                .filter((text) => {
                    const key = text.toLowerCase();
                    if (!text || seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
        },

        dependenceOwned(): string[] {
            const view = engine.view();
            if (!view) return [];
            const out: string[] = [];
            for (const profile of view.profiles) {
                const live = view.state.characters[profile.id];
                const owned = profile.appetites.some(
                    (appetite) =>
                        DEPENDENCE_KINDS.includes(appetite.kind) &&
                        (live?.appetites[appetite.id]?.dependence ?? appetite.dependence) > 0,
                );
                if (owned && !out.includes(profile.name)) out.push(profile.name);
            }
            return out;
        },

        replacesSocialMechanics: active,
    };
}

export const engineModule: DramatisModule<EngineSettings> = {
    key: 'engine',
    stage: 1,
    titleKey: 'engine.title',
    enabledByDefault: true,
    defaults: () => ({}),
    i18n: ENGINE_STRINGS,

    init({ app, log, own }) {
        const engine = createEngine({ app, log });
        const part = engineApiPart(engine, app);
        app.modules.expose(ENGINE_API, engine);
        app.modules.expose('api', part);
        // DRAMATIS_API listeners hear saves and chat switches from the bus; a view that only finished loading or a
        // scene that changed (presence, bands) is announced by registering the part again.
        own(engine.onChange(() => app.modules.expose('api', part)));
        engine.start();
        own(() => engine.stop());
    },
};
