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
        'core.llm.failed': 'The AI request failed: {error}',
    },
    ru: {
        'core.name': 'Dramatis',
        'core.llm.needsMaestro': 'Для этого нужен Maestro: фоновые задачи ИИ идут через него.',
        'core.llm.noProfile':
            'Не выбран профиль подключения: выбери его в настройках Dramatis или в Connection Manager.',
        'core.llm.noCm': 'Connection Manager выключен, поэтому запросы к ИИ невозможны.',
        'core.llm.refusal': 'Модель отказалась отвечать.',
        'core.llm.aborted': 'Запрос отменён.',
        'core.llm.failed': 'Запрос к ИИ не удался: {error}',
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
        default:
            return i18n.t('core.llm.failed', { error: error ?? '?' });
    }
}
