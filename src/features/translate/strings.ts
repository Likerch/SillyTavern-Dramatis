// Strings of the «translate» module (keys `translate.*`). The user is addressed with «ты», masculine forms.
import type { I18nParts } from '../../shared/contracts';

export const TRANSLATE_STRINGS: I18nParts = {
    en: {
        'translate.title': 'Descriptions in windows',
        'translate.task': 'Dramatis: translating descriptions',

        'translate.settings.title': 'Descriptions in windows',
        'translate.settings.language': 'Language of descriptions in windows',
        'translate.settings.language.auto': 'Auto: the story’s language, else the interface language',
        'translate.settings.language.ru': 'Russian',
        'translate.settings.language.en': 'English (as stored)',
        'translate.settings.languageHint':
            'Dramatis keeps descriptions (concepts, goals, reasons, what someone is doing) in English for the model. In the intent sheet and in the «Dramatis» tab of DES they can be shown in Russian: each line is translated once and remembered.',
        'translate.settings.now.choice.ru': 'Now: Russian (chosen here).',
        'translate.settings.now.choice.en': 'Now: English (chosen here).',
        'translate.settings.now.story.ru': 'Now: Russian — the story’s language in Maestro.',
        'translate.settings.now.story.en': 'Now: English — the story’s language in Maestro.',
        'translate.settings.now.ui.ru': 'Now: Russian — the interface language.',
        'translate.settings.now.ui.en': 'Now: English — the interface language.',
        'translate.settings.cached': 'Translations kept for this card: {n}.',
        'translate.settings.noCard': 'Translations are kept per card: open a chat with one character.',
        'translate.settings.translateNow': 'Translate now',
        'translate.settings.translateNowHint':
            'Translates every description of this card’s characters in this chat at once, as your own request (Maestro’s daily cap does not stop it). Usually translation runs by itself: when you open the sheet or the «Dramatis» tab, and after turns.',

        'translate.running': 'Translating the descriptions…',
        'translate.done': 'Descriptions translated: {n}.',
        'translate.done.failed': 'Descriptions translated: {n}; the model left {failed} untranslated.',
        'translate.nothing': 'Nothing to translate: every description is already in Russian.',
        'translate.english': 'Descriptions are shown in English now, so there is nothing to translate.',
        'translate.noCard': 'Translations are kept per card: open a chat with one character.',
        'translate.failed': 'The descriptions were not translated: {error}',
    },
    ru: {
        'translate.title': 'Описания в окнах',
        'translate.task': 'Dramatis: перевод описаний',

        'translate.settings.title': 'Описания в окнах',
        'translate.settings.language': 'Язык описаний в окнах',
        'translate.settings.language.auto': 'Авто: язык истории, иначе язык интерфейса',
        'translate.settings.language.ru': 'Русский',
        'translate.settings.language.en': 'Английский (как хранится)',
        'translate.settings.languageHint':
            'Описания (суть, цели, причины, кто чем занят) Dramatis хранит для модели по-английски. В листе замысла и во вкладке «Dramatis» в DES их можно показывать по-русски: каждая строка переводится один раз и запоминается.',
        'translate.settings.now.choice.ru': 'Сейчас: русский (выбран здесь).',
        'translate.settings.now.choice.en': 'Сейчас: английский (выбран здесь).',
        'translate.settings.now.story.ru': 'Сейчас: русский — язык истории в Maestro.',
        'translate.settings.now.story.en': 'Сейчас: английский — язык истории в Maestro.',
        'translate.settings.now.ui.ru': 'Сейчас: русский — язык интерфейса.',
        'translate.settings.now.ui.en': 'Сейчас: английский — язык интерфейса.',
        'translate.settings.cached': 'Переводов у этой карточки: {n}.',
        'translate.settings.noCard': 'Переводы хранятся по карточке: открой чат с одним персонажем.',
        'translate.settings.translateNow': 'Перевести сейчас',
        'translate.settings.translateNowHint':
            'Переводит разом все описания персонажей этой карточки в этом чате — как твой запрос (дневной потолок Maestro его не останавливает). Обычно перевод идёт сам: когда открываешь лист или вкладку «Dramatis», и после ходов.',

        'translate.running': 'Перевожу описания…',
        'translate.done': 'Описаний переведено: {n}.',
        'translate.done.failed': 'Описаний переведено: {n}; модель не перевела ещё {failed}.',
        'translate.nothing': 'Переводить нечего: все описания уже по-русски.',
        'translate.english': 'Описания сейчас показываются по-английски — переводить нечего.',
        'translate.noCard': 'Переводы хранятся по карточке: открой чат с одним персонажем.',
        'translate.failed': 'Описания не переведены: {error}',
    },
};
