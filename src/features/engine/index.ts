// Module «engine» (stage 1, works without Maestro): the current card profiles + chat state and the scene view behind
// EngineApi (engine.ts), plus its part of DRAMATIS_API — whether the chat has a cast, every stance with its reasons
// (NPC → player and NPC ↔ NPC, for Maestro's relations graph), goals, the dependences the engine owns (BunnyMo's
// Medicine Check stays quiet for them), the «relationships»/«social» mechanics templates it replaces, the starting
// scenes' cast and a display-ready summary of one character (describe.ts, for the «Dramatis» tab Maestro adds to
// DES's Character Sheet). The summary shows free text through the «translate» module when it runs: the Russian of what
// is translated already, and the rest is asked for in the background (the summary refreshes through onChange).
import { moodLabel, stanceLabel } from '../../domain/ladders';
import { chatLevers } from '../../domain/levers';
import { PLAYER_ID } from '../../domain/model';
import type { AppetiteKind } from '../../domain/model';
import { strongestReasons } from '../../domain/render';
import { startFor } from '../../domain/state-init';
import { whoOf } from '../../domain/translate';
import type { DramatisApiV1, DramatisCharacterView, DramatisStanceInfo, DramatisStartMember } from '../../shared/apis';
import type { App, DramatisModule } from '../../shared/contracts';
import { TRANSLATE_API, TRANSLATE_DELAYS } from '../translate/api';
import type { TranslateApi, TranslationSource } from '../translate/api';
import { ENGINE_API } from './api';
import type { EngineApi, EngineView } from './api';
import { describeCharacter } from './describe';
import type { DescribeInput } from './describe';
import { createEngine } from './engine';
import { ENGINE_STRINGS } from './strings';

export { ENGINE_STRINGS } from './strings';

export type EngineSettings = Record<string, never>;

/** Appetites whose dependence the engine leads (BunnyMo's Medicine Check is silenced for their owners). */
const DEPENDENCE_KINDS: readonly AppetiteKind[] = ['drink', 'substance'];

type ApiPart = Partial<Omit<DramatisApiV1, 'version' | 'dramatisVersion' | 'onChange'>>;

/** What a summary of this character takes from the app: the UI language and words, the chat's secrets lever, the player. */
export function describeInput(app: App, view: EngineView, id: string): DescribeInput {
    return {
        view,
        id,
        lang: app.i18n.locale(),
        t: (key, params) => app.i18n.t(key, params),
        secrets: chatLevers(app.settings.get(), view.state.overrides).secrets,
        player: view.playerName.trim() || app.i18n.t('engine.player'),
    };
}

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

        startCast(greeting: number): DramatisStartMember[] {
            const view = engine.view();
            if (!view) return [];
            const lang = app.i18n.locale();
            const out: DramatisStartMember[] = [];
            // Card characters only: the chat's extras are faces met in play, not part of any starting scene.
            for (const profile of view.card.characters) {
                if (profile.kind === 'group') continue;
                const start = startFor(profile, greeting);
                const tie = profile.ties.find((item) => item.target === PLAYER_ID);
                const member: DramatisStartMember = { name: profile.name, present: start?.present === true };
                if (start?.doing) member.doing = start.doing;
                if (start?.goal) member.goal = start.goal;
                if (tie) {
                    member.stance = tie.stance;
                    member.stanceLabel = stanceLabel(tie.stance, lang, profile.gender);
                    const reason = strongestReasons(tie.reasons ?? [], 1)[0];
                    if (reason) member.reason = reason;
                }
                const mood = profile.core.baselineMood;
                if (mood) member.mood = mood.label || moodLabel(mood.octant, lang);
                if (profile.gender) member.gender = profile.gender;
                out.push(member);
            }
            return out;
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

        describe(name: string): DramatisCharacterView | null {
            const view = engine.view();
            const query = typeof name === 'string' ? name.trim() : '';
            if (!view || !query) return null;
            const resolved = engine.resolve(query);
            const id = resolved && view.byId.has(resolved) ? resolved : view.byId.has(query) ? query : null;
            const profile = id ? view.byId.get(id) : undefined;
            if (!id || !profile) return null;
            const translate = app.modules.api<TranslateApi>(TRANSLATE_API);
            if (!translate || translate.language() !== 'ru') return describeCharacter(describeInput(app, view, id));
            // Free text in Russian where it is translated already; the rest is asked for in the background (Maestro
            // calls describe() for its DES tab: not the user's own action) and onChange refreshes the tab.
            const who = whoOf(profile);
            const shown: TranslationSource[] = [];
            const tr = (text: string): string => {
                if (!translate.needs(text)) return text;
                shown.push({ text, who });
                return translate.display(text);
            };
            const summary = describeCharacter({ ...describeInput(app, view, id), tr });
            if (shown.some((source) => translate.translation(source.text) === undefined)) {
                translate.schedule(() => shown, { delayMs: TRANSLATE_DELAYS.describe });
            }
            return summary;
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
