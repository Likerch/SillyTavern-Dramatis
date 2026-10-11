// Strings of the core services (keys `core.*`). Russian is the primary UI language; the user is addressed with «ты».
import type { I18n, I18nParts } from '../shared/contracts';

export const CORE_STRINGS: I18nParts = {
    en: {
        'core.name': 'Dramatis',
        'core.llm.needsMaestro': 'This needs Maestro: background AI tasks run through it.',
        'core.llm.noProfile': 'No connection profile: pick one in the Dramatis settings or in Connection Manager.',
        'core.llm.noCm': 'Connection Manager is off, so AI requests are not possible.',
        'core.llm.refusal': 'The model refused to answer.',
        'core.llm.aborted': 'The request was cancelled.',
        'core.llm.notLeader': 'Another SillyTavern tab leads this chat: background AI tasks run there.',
        'core.llm.cap': 'The daily limit of background AI spending is reached (Maestro settings).',
        'core.llm.breaker': 'AI requests are paused after repeated failures; Maestro will try again shortly.',
        'core.llm.badTask': 'Maestro does not know this AI task.',
        'core.llm.badRequest': 'Maestro refused the AI request as malformed.',
        'core.llm.maestroStopped': 'Maestro is stopped, so the AI request did not run.',
        'core.llm.workshop': 'This is a workshop chat (Maestro «Мастерская»): Dramatis stays silent here.',
        'core.llm.parse': 'The model’s answer could not be read.',
        'core.llm.empty': 'The model returned an empty answer.',
        'core.llm.transport': 'Could not reach the model: {error}',
        'core.llm.failed': 'The AI request failed: {error}',
        'core.api.noReading':
            'The author’s intent cannot be read now: Dramatis or its «Author’s intent» module is switched off.',
    },
    ru: {
        'core.name': 'Dramatis',
        'core.llm.needsMaestro': 'Для этого нужен Maestro: фоновые задачи ИИ идут через него.',
        'core.llm.noProfile':
            'Не выбран профиль подключения: выбери его в настройках Dramatis или в Connection Manager.',
        'core.llm.noCm': 'Connection Manager выключен, поэтому запросы к ИИ невозможны.',
        'core.llm.refusal': 'Модель отказалась отвечать.',
        'core.llm.aborted': 'Запрос отменён.',
        'core.llm.notLeader': 'Этот чат ведёт другая вкладка SillyTavern: фоновые задачи ИИ идут там.',
        'core.llm.cap': 'Исчерпан дневной лимит расходов на фоновые задачи ИИ (настройки Maestro).',
        'core.llm.breaker': 'Запросы к ИИ приостановлены после нескольких сбоев подряд; Maestro скоро попробует снова.',
        'core.llm.badTask': 'Maestro не знает такой задачи ИИ.',
        'core.llm.badRequest': 'Maestro отклонил запрос к ИИ как неправильный.',
        'core.llm.maestroStopped': 'Maestro остановлен, поэтому запрос к ИИ не выполнен.',
        'core.llm.workshop': 'Это чат мастерской (Maestro «Мастерская»): здесь Dramatis молчит.',
        'core.llm.parse': 'Не получилось разобрать ответ модели.',
        'core.llm.empty': 'Модель вернула пустой ответ.',
        'core.llm.transport': 'Не удалось связаться с моделью: {error}',
        'core.llm.failed': 'Запрос к ИИ не удался: {error}',
        'core.api.noReading': 'Замысел сейчас не прочитать: Dramatis или его модуль «Замысел автора» выключен.',
    },
};

/** A human sentence for an LlmResult error code ('needs-maestro', 'no-profile', 'refusal', …). */
export function llmErrorText(i18n: I18n, error: string | undefined): string {
    switch (error) {
        case 'needs-maestro':
            return i18n.t('core.llm.needsMaestro');
        case 'no-profile':
            return i18n.t('core.llm.noProfile');
        case 'no-cm':
            return i18n.t('core.llm.noCm');
        case 'refusal':
            return i18n.t('core.llm.refusal');
        case 'aborted':
            return i18n.t('core.llm.aborted');
        case 'not-leader':
            return i18n.t('core.llm.notLeader');
        case 'cap':
            return i18n.t('core.llm.cap');
        case 'breaker':
            return i18n.t('core.llm.breaker');
        case 'bad-task':
            return i18n.t('core.llm.badTask');
        case 'bad-request':
            return i18n.t('core.llm.badRequest');
        case 'maestro-stopped':
            return i18n.t('core.llm.maestroStopped');
        case 'workshop':
            return i18n.t('core.llm.workshop');
        case 'parse':
            return i18n.t('core.llm.parse');
        case 'empty':
            return i18n.t('core.llm.empty');
        default:
            if (error?.startsWith('transport:')) {
                return i18n.t('core.llm.transport', { error: error.slice('transport:'.length).trim() || '?' });
            }
            return i18n.t('core.llm.failed', { error: error ?? '?' });
    }
}
