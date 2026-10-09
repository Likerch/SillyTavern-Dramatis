// Module «translate» (works without Maestro): the display translation of Dramatis' free text. Dramatis stores
// descriptions in English for the model (the motive card stays English with the names as the story writes them); the
// player reads them in Russian when the story is Russian — in the «Лист замысла» window and in DRAMATIS_API.describe
// (Maestro's «Dramatis» tab in DES). domain/translate.ts holds the rules, service.ts the runs, store.ts the cache.
//
// - Language («Язык описаний в окнах», `textLanguage`): auto follows MAESTRO_API.storyLanguage() (Maestro 1.20+), else
//   the UI language; 'en' shows everything as stored and translates nothing.
// - Task 'dramatis.translate' is listed in Maestro's per-task profiles («Dramatis: перевод описаний»); without Maestro
//   the interactive runs use Dramatis' own connection profile, like the intent reading.
// - When it translates (each string once per card; a cached one is shown at once):
//   · the sheet: what is on screen, after it renders — interactive when the render is the user's doing (opening the
//     window, a page, a tab, a click), background when a change re-rendered it;
//   · describe(): the lines of that summary, background (Maestro calls it for its tab, not the user directly);
//   · after a save of the chat state or the card profiles (turn pass, intent reading, generator, world tick): the
//     summary lines, role and species of the characters in the scene, background, debounced;
//   · «Перевести сейчас» in the settings: every description of the current card in this chat, interactive, failures
//     retried.
// - When translations arrive, DRAMATIS_API listeners hear it (Maestro's tab refreshes by itself) and the sheet
//   re-renders.
import { llmErrorText } from '../../core/strings';
import type { ApiUnsubscribe } from '../../shared/apis';
import { TRANSLATE_TASK, whoOf } from '../../domain/translate';
import type { TranslationSource } from '../../domain/translate';
import type { App, DramatisModule } from '../../shared/contracts';
import { button, el, field, select } from '../../ui';
import { describeInput } from '../engine';
import { ENGINE_API } from '../engine/api';
import type { EngineApi } from '../engine/api';
import { describeCharacter } from '../engine/describe';
import { TRANSLATE_API, TRANSLATE_DELAYS } from './api';
import type { TranslateOutcome } from './api';
import { createTranslator } from './service';
import type { Translator } from './service';
import { TRANSLATE_STRINGS } from './strings';

export { TRANSLATE_STRINGS } from './strings';

export type TranslateSettings = Record<string, never>;

const LANGUAGES = ['auto', 'ru', 'en'] as const;

/**
 * What the player sees of the characters in the scene without opening anything: the lines of their summaries (the DES
 * tab), their role and species (the sheet's list rows).
 */
export function sceneSources(app: App): TranslationSource[] {
    const view = app.modules.api<EngineApi>(ENGINE_API)?.view();
    if (!view) return [];
    const out: TranslationSource[] = [];
    for (const id of view.present) {
        const profile = view.byId.get(id);
        if (!profile) continue;
        const who = whoOf(profile);
        for (const text of [profile.role, profile.species]) if (text) out.push({ text, who });
        describeCharacter({
            ...describeInput(app, view, id),
            tr: (text) => {
                out.push({ text, who });
                return text;
            },
        });
    }
    return out;
}

/** The notice after «Перевести сейчас». */
export function outcomeText(app: App, outcome: TranslateOutcome): string {
    const t = (key: string, params?: Record<string, string | number>) => app.i18n.t(key, params);
    if (outcome.error === 'english') return t('translate.english');
    if (outcome.error === 'no-card') return t('translate.noCard');
    const left = outcome.failed + outcome.pending;
    if (outcome.translated === 0 && left === 0 && !outcome.error) return t('translate.nothing');
    if (outcome.translated === 0 && outcome.error) {
        return t('translate.failed', { error: llmErrorText(app.i18n, outcome.error) });
    }
    return left
        ? t('translate.done.failed', { n: outcome.translated, failed: left })
        : t('translate.done', { n: outcome.translated });
}

function settingsSection(app: App, translator: Translator) {
    const t = (key: string, params?: Record<string, string | number>) => app.i18n.t(key, params);
    return {
        id: 'translate',
        titleKey: 'translate.settings.title',
        order: 25,
        render(container: HTMLElement) {
            const status = el('div', { class: 'dramatis-field-hint' });
            const update = () => {
                const { language, source } = translator.languageInfo();
                const card = app.host.isGroupChat() ? null : app.host.cardKey();
                const kept = card
                    ? t('translate.settings.cached', { n: translator.cached() })
                    : t('translate.settings.noCard');
                status.textContent = `${t(`translate.settings.now.${source}.${language}`)} ${kept}`;
            };
            const choice = select({
                value: app.settings.get().textLanguage,
                options: LANGUAGES.map((value) => ({ value, label: t(`translate.settings.language.${value}`) })),
                label: t('translate.settings.language'),
                onChange: (value) => app.settings.set('textLanguage', value),
            });
            container.append(
                el('div', { class: 'dramatis-settings-group' }, [
                    field(t('translate.settings.language'), choice, t('translate.settings.languageHint')),
                    status,
                    el('div', { class: 'dramatis-settings-buttons' }, [
                        button({
                            label: t('translate.settings.translateNow'),
                            icon: 'language',
                            onClick: async () => {
                                app.ui.notice(t('translate.running'));
                                const outcome = await translator.api.translateAll();
                                app.ui.notice(outcomeText(app, outcome), {
                                    level: outcome.ok || outcome.translated > 0 ? 'info' : 'warn',
                                });
                                update();
                            },
                        }),
                    ]),
                    el('div', { class: 'dramatis-field-hint', text: t('translate.settings.translateNowHint') }),
                ]),
            );
            update();
            const offs = [
                translator.api.onChange(update),
                app.settings.onChange((key) => {
                    if (key === 'textLanguage') update();
                }),
            ];
            return () => {
                for (const off of offs) off();
            };
        },
    };
}

export const translateModule: DramatisModule<TranslateSettings> = {
    key: 'translate',
    stage: 1,
    titleKey: 'translate.title',
    enabledByDefault: true,
    defaults: () => ({}),
    i18n: TRANSLATE_STRINGS,

    init({ app, log, own }) {
        const translator = createTranslator({ app, log });
        const maestroOffs: ApiUnsubscribe[] = [];
        let stopped = false;
        // DRAMATIS_API listeners (Maestro's DES tab) hear about new translations: registering the part again announces.
        const part = {};
        own(
            translator.api.onChange(() => {
                if (!stopped) app.modules.expose('api', part);
            }),
        );
        app.modules.expose(TRANSLATE_API, translator.api);

        function releaseMaestro(): void {
            for (const off of maestroOffs.splice(0)) {
                try {
                    off();
                } catch (error) {
                    log.debug('Maestro unregister failed', error);
                }
            }
        }

        function registerMaestro(): void {
            releaseMaestro();
            const api = stopped ? null : app.maestro.api();
            if (!api) return;
            try {
                maestroOffs.push(
                    api.llm.registerTask(TRANSLATE_TASK, {
                        ru: TRANSLATE_STRINGS.ru['translate.task']!,
                        en: TRANSLATE_STRINGS.en['translate.task']!,
                    }),
                );
            } catch (error) {
                log.warn('could not register the translation task with Maestro', error);
            }
        }

        const scene = () => sceneSources(app);
        const afterSave = () => translator.api.schedule(scene, { delayMs: TRANSLATE_DELAYS.scene });
        own(app.bus.on('state:changed', afterSave));
        own(app.bus.on('profiles:changed', afterSave));
        own(app.bus.on('chat:changed', () => translator.chatChanged()));
        own(
            app.bus.on('maestro:changed', ({ present }) => {
                if (present) registerMaestro();
                else releaseMaestro();
                translator.changed();
            }),
        );
        own(
            app.settings.onChange((key) => {
                if (key === 'textLanguage' || key === 'uiLanguage' || key === '*') translator.changed();
            }),
        );
        own(app.ui.addSettingsSection(settingsSection(app, translator)));
        own(async () => {
            stopped = true;
            releaseMaestro();
            await translator.dispose();
        });

        registerMaestro();
        // The chat may be open already: load its card's translations.
        queueMicrotask(() => {
            if (!stopped) translator.chatChanged();
        });
    },
};
