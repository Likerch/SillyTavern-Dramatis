// Module «intent» (stage 1, works without Maestro): reading the author's intent (docs/model.md §7, reader.ts) and
// exposing it as IntentApi.
// - Automatically (setting `autoRead`): a solo chat that opens with no user message yet, with a card never read before,
//   is read once per card and session — only when an AI connection is ready (and, with Maestro, in its leading tab);
//   a card whose sources changed since its reading gets an offer to read it again.
// - `/dramatis-read` and the button in the «Замысел» settings section read again on demand.
// - With Maestro: the task is listed in its profiles («Dramatis: чтение замысла») and every reading goes into its journal
//   with an undo that restores the profiles as they were. Maestro forgets both when it restarts, so they are
//   registered again whenever it comes back.
import type { ApiUnsubscribe } from '../../shared/apis';
import type { DramatisModule } from '../../shared/contracts';
import { INTENT_TASK } from '../../domain/intent-prompt';
import { button, el, field, toggle } from '../../ui';
import { ENGINE_API } from '../engine/api';
import type { EngineApi } from '../engine/api';
import { INTENT_API } from './api';
import { PROFILES_TARGET, createIntentReader } from './reader';
import { INTENT_STRINGS } from './strings';

export interface IntentSettings {
    /** Read a new card's intent by itself and offer re-reads when the card changed. */
    autoRead: boolean;
}

export const intentModule: DramatisModule<IntentSettings> = {
    key: 'intent',
    stage: 1,
    titleKey: 'intent.title',
    enabledByDefault: true,
    defaults: () => ({ autoRead: true }),
    i18n: INTENT_STRINGS,

    init({ app, settings, log, own }) {
        const t = (key: string, params?: Record<string, string | number>) => app.i18n.t(key, params);
        const reader = createIntentReader({ app, log });
        let stopped = false;
        /** Cards read automatically in this session (never twice, even when the reading failed). */
        const autoRead = new Set<string>();
        /** Re-read offers made in this session: card + fingerprint. */
        const offered = new Set<string>();
        const maestroOffs: ApiUnsubscribe[] = [];

        const engine = (): EngineApi | null => app.modules.api<EngineApi>(ENGINE_API) ?? null;

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
                    api.llm.registerTask(INTENT_TASK, {
                        ru: INTENT_STRINGS.ru['intent.task']!,
                        en: INTENT_STRINGS.en['intent.task']!,
                    }),
                );
            } catch (error) {
                log.warn('could not register the intent task with Maestro', error);
            }
            try {
                maestroOffs.push(api.journal.registerUndo(PROFILES_TARGET, (change) => reader.undo(change)));
            } catch (error) {
                log.warn('could not register the profiles undo with Maestro', error);
            }
        }

        function hasUserMessages(): boolean {
            const chat = app.host.ctx().chat;
            return Array.isArray(chat) && chat.some((message) => message?.is_user && !message.is_system);
        }

        /** In Maestro's leading tab (or without Maestro): two tabs must not both read the same new chat. */
        function leads(): boolean {
            const api = app.maestro.api();
            if (!api) return true;
            try {
                return api.leader.isLeader();
            } catch (error) {
                log.debug('Maestro leader check failed', error);
                return true;
            }
        }

        async function onChatOpened(): Promise<void> {
            if (stopped || !settings.autoRead || app.host.isGroupChat() || !app.host.chatId()) return;
            const cardKey = app.host.cardKey();
            if (!cardKey || reader.running()) return;
            const view = await engine()?.ready();
            const profiles =
                view && view.card.card === cardKey ? view.card : await app.profiles.load(cardKey).catch(() => null);
            if (stopped || !profiles || app.host.cardKey() !== cardKey) return;
            if (!profiles.intent) {
                if (hasUserMessages() || autoRead.has(cardKey)) return;
                if (!app.llm.available(INTENT_TASK, false) || !leads()) return;
                autoRead.add(cardKey);
                await reader.read();
                return;
            }
            const now = await reader.fingerprint();
            if (stopped || !now || now.card !== cardKey || now.hash === profiles.intent.sourcesHash) return;
            const offer = `${cardKey}\u0000${now.hash}`;
            if (offered.has(offer)) return;
            offered.add(offer);
            app.ui.notice(t('intent.changed'), {
                action: { label: t('intent.reread'), run: () => void reader.read({ force: true }) },
            });
        }

        const check = () => {
            void onChatOpened().catch((error: unknown) => log.error('intent check failed', error));
        };

        app.modules.expose(INTENT_API, {
            read: (options?: { force?: boolean }) => reader.read(options),
            running: () => reader.running(),
            lastResult: () => reader.lastResult(),
        });

        own(app.bus.on('chat:changed', () => check()));
        own(
            app.bus.on('maestro:changed', ({ present }) => {
                if (present) registerMaestro();
                else releaseMaestro();
            }),
        );
        own(
            app.ui.addSlashCommand('dramatis-read', 'intent.slash.read', async () => {
                const result = await reader.read({ force: true });
                return result.ok ? (result.message ?? '') : t('intent.failed', { error: result.error ?? '?' });
            }),
        );
        own(
            app.ui.addSettingsSection({
                id: 'intent',
                titleKey: 'intent.settings.title',
                order: 20,
                render(container) {
                    const status = el('span', { class: 'dramatis-muted', text: '…' });
                    let alive = true;
                    const update = async () => {
                        const cardKey = app.host.isGroupChat() ? null : app.host.cardKey();
                        let text = t('intent.settings.status.noCard');
                        if (cardKey) {
                            const view = await engine()?.ready();
                            const profiles =
                                view?.card.card === cardKey
                                    ? view.card
                                    : await app.profiles.load(cardKey).catch(() => null);
                            const at = profiles?.intent?.at;
                            text = at
                                ? t('intent.settings.status.read', {
                                      date: new Date(at).toLocaleString(app.i18n.locale() === 'ru' ? 'ru-RU' : 'en-GB'),
                                  })
                                : t('intent.settings.status.none');
                        }
                        if (alive) status.textContent = text;
                    };
                    container.append(
                        el('div', { class: 'dramatis-settings-group' }, [
                            toggle({
                                label: t('intent.settings.autoRead'),
                                hint: t('intent.settings.autoReadHint'),
                                checked: settings.autoRead,
                                onChange: (checked) => {
                                    settings.autoRead = checked;
                                    app.settings.save();
                                },
                            }),
                            field(t('intent.settings.status'), status),
                            button({
                                label: t('intent.settings.readNow'),
                                icon: 'book-open',
                                onClick: async () => {
                                    await reader.read({ force: true });
                                    await update();
                                },
                            }),
                        ]),
                    );
                    void update();
                    return () => {
                        alive = false;
                    };
                },
            }),
        );
        own(() => {
            stopped = true;
            reader.abort();
            releaseMaestro();
        });

        registerMaestro();
        // The chat may already be open (Dramatis switched on mid-session).
        queueMicrotask(check);
    },
};
