// Module «director» (stage 5, docs/model.md §12 «Кино»: «плюс режиссёрский проход перед ответом»). Only in the cinema
// mode (the chat's override or the setting): right before a real generation — not a dry run, a quiet call, an
// impersonation or a continuation — the motive card asks for the beat; a short structured request (task
// 'dramatis.director', part of the user's own generation: `background: false`) names up to three present characters
// who act now, with an intent and a target, from the engine's view of the scene (domain/director.ts). The calls go into
// this generation's motive card only (CastCardInput.director) — nothing is stored. A slow or failed request is skipped
// silently after `timeoutMs`: the card is built without it.
import { DIRECTOR_TASK, directorCalls, directorMessages, directorSchema, parseDirector } from '../../domain/director';
import { cleanForAnalysis } from '../../domain/text-clean';
import { leversFor } from '../../domain/turn-apply';
import type { App, DramatisModule, GenerationInfo, I18nParts, Logger } from '../../shared/contracts';
import { ENGINE_API } from '../engine/api';
import type { EngineApi } from '../engine/api';
import { DIRECTOR_API } from './api';
import type { DirectorApi } from './api';

export interface DirectorSettings {
    maxTokens: number;
    temperature: number;
    /** The request is dropped after this long (ms): the reply must not wait for the director. */
    timeoutMs: number;
}

/** Generations the director sits out: the player's own text, continuing a reply, background calls. */
const SKIPPED_TYPES = new Set(['impersonate', 'continue', 'quiet']);

export const DIRECTOR_STRINGS: I18nParts = {
    en: {
        'director.title': 'Director (Cinema mode)',
        'director.task': 'Dramatis: director',
    },
    ru: {
        'director.title': 'Режиссёр (режим «Кино»)',
        'director.task': 'Dramatis: режиссёр',
    },
};

/** What the player is sending now: ST adds his message to the chat only after the generation started. */
function typedInput(): string {
    try {
        const node = globalThis.document?.getElementById('send_textarea') as HTMLTextAreaElement | null;
        return typeof node?.value === 'string' ? node.value : '';
    } catch {
        return '';
    }
}

function isReply(message: STChatMessage | undefined): boolean {
    return !!message && !message.is_user && !message.is_system;
}

/** The player's message this generation answers and the reply before it. */
function exchange(app: App, gen: GenerationInfo): { playerMessage: string; lastReply: string } {
    const raw = app.host.ctx().chat;
    const chat: STChatMessage[] = Array.isArray(raw) ? raw : [];
    let lastUser = -1;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i]?.is_user) {
            lastUser = i;
            break;
        }
    }
    // A new message is still in the input box; a swipe or a regeneration answers the last one in the chat.
    const fresh = gen.type === 'normal' || gen.type === '';
    const playerMessage = fresh ? typedInput().trim() : lastUser >= 0 ? cleanForAnalysis(chat[lastUser]) : '';
    const before = fresh ? chat.length : lastUser;
    let lastReply = '';
    for (let i = before - 1; i >= 0; i--) {
        if (isReply(chat[i])) {
            lastReply = cleanForAnalysis(chat[i]);
            break;
        }
    }
    return { playerMessage, lastReply };
}

export function createDirector(app: App, settings: DirectorSettings, log: Logger): DirectorApi {
    return {
        async beat(gen: GenerationInfo) {
            if (gen.dryRun || gen.quiet || SKIPPED_TYPES.has(gen.type)) return undefined;
            const api = app.maestro.api();
            const view = app.modules.api<EngineApi>(ENGINE_API)?.view() ?? null;
            if (!api || !view) return undefined;
            const general = app.settings.get();
            if (leversFor(general, view.state.overrides).mode !== 'cinema') return undefined;
            const present = view.present.filter((id) => view.byId.has(id));
            if (!present.length) return undefined;
            const lang = general.cardLanguage;
            const controller = new AbortController();
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<null>((resolve) => {
                timer = setTimeout(
                    () => {
                        controller.abort();
                        resolve(null);
                    },
                    Math.max(0, settings.timeoutMs),
                );
            });
            try {
                const scene = app.readers.des.scene();
                const request = api.llm.request({
                    task: DIRECTOR_TASK,
                    messages: directorMessages({
                        profiles: view.profiles,
                        state: view.state,
                        present,
                        bands: view.bands,
                        playerName: view.playerName,
                        ...exchange(app, gen),
                        scene: {
                            ...(scene.place ? { place: scene.place } : {}),
                            ...(scene.time ? { time: scene.time } : {}),
                        },
                        lang,
                    }),
                    maxTokens: settings.maxTokens,
                    temperature: settings.temperature,
                    schema: directorSchema(present),
                    background: false,
                    signal: controller.signal,
                });
                // A request that ignores the signal must not hold the reply either.
                request.catch(() => undefined);
                const result = await Promise.race([request, timeout]);
                if (!result) {
                    log.debug('director timed out');
                    return undefined;
                }
                if (!result.ok) {
                    log.debug(`director skipped: ${result.error ?? 'no answer'}`);
                    return undefined;
                }
                const beat = parseDirector(result.data, present);
                if (!beat?.actors.length) return undefined;
                return directorCalls(beat, { profiles: view.profiles, playerName: view.playerName, lang });
            } catch (error) {
                log.debug('director skipped', error);
                return undefined;
            } finally {
                if (timer) clearTimeout(timer);
            }
        },
    };
}

export const directorModule: DramatisModule<DirectorSettings> = {
    key: 'director',
    stage: 5,
    titleKey: 'director.title',
    enabledByDefault: true,
    needsMaestro: true,
    defaults: () => ({ maxTokens: 400, temperature: 0.3, timeoutMs: 3500 }),
    i18n: DIRECTOR_STRINGS,

    init({ app, settings, log, own }) {
        const api = app.maestro.api();
        if (!api) return;
        try {
            own(
                api.llm.registerTask(DIRECTOR_TASK, {
                    ru: DIRECTOR_STRINGS.ru['director.task']!,
                    en: DIRECTOR_STRINGS.en['director.task']!,
                }),
            );
        } catch (error) {
            log.warn('could not register the director task with Maestro', error);
        }
        app.modules.expose(DIRECTOR_API, createDirector(app, settings, log));
    },
};
