// Strings of the «intent» module (keys `intent.*`). Plural keys hold the forms separated by «|»: English one|other,
// Russian one|few|many (plural() picks one). The user is addressed with «ты», masculine forms.
import type { I18n, I18nParts } from '../../shared/contracts';
import type { IntentWarning } from '../../domain/intent-apply';

export const INTENT_STRINGS: I18nParts = {
    en: {
        'intent.title': 'Author’s intent',
        'intent.task': 'Dramatis: author intent',
        'intent.journal': 'Read the author’s intent: {summary}',

        'intent.progress.one': 'Reading the author’s intent…',
        'intent.progress': 'Reading the author’s intent: part {n} of {total}…',
        'intent.done': 'Author’s intent read: {summary}.',
        'intent.done.nobody': 'Author’s intent read: the sources name nobody.',
        'intent.done.warnings': 'Notes ({count}): {list}',
        'intent.done.open': 'Open',
        'intent.failed': 'The author’s intent was not read: {error}',
        'intent.changed': 'The card has changed since its intent was read. Read it again? Your own edits stay.',
        'intent.reread': 'Read again',
        'intent.upToDate': 'The card has not changed since its intent was read.',

        'intent.n.characters': '{n} character|{n} characters',
        'intent.n.groups': '{n} group|{n} groups',
        'intent.n.rules': '{n} appetite rule|{n} appetite rules',

        'intent.error.busy': 'The intent is already being read.',
        'intent.error.noCard': 'The intent is read only in a chat with one character.',
        'intent.error.empty': 'The card has nothing to read.',
        'intent.error.save': 'The reading could not be saved.',
        'intent.error.unexpected': 'Something went wrong: {error}',

        'intent.warning.bad-answer': 'part of the model’s answer could not be read',
        'intent.warning.unevidenced': '{who}{path} has no quote and was left out',
        'intent.warning.quote-unverified': '{who}the quote for {path} was not found in the sources',
        'intent.warning.stance-capped': '{who}the stance {path} was lowered: the sources speak of hostility',
        'intent.warning.stranger-stance': '{who}the stance toward the player was taken from how they treat strangers',
        'intent.warning.rule-target':
            'the rule «{name}» aims at a class, not at the player: the scenario does not say so',
        'intent.warning.minor-appetite': '{who}a minor — sexual appetites removed',
        'intent.warning.minor-target': '{who}an appetite toward a minor was removed',
        'intent.warning.partFailed': 'part {n} of {total} was not read: {error}',
        'intent.warning.skipped': '{n} lorebook entries did not fit into the reading',

        'intent.slash.read': 'Reads the author’s intent of the current card again (your own edits stay).',

        'intent.settings.title': 'Author’s intent',
        'intent.settings.autoRead': 'Read the intent automatically',
        'intent.settings.autoReadHint':
            'When a new chat opens with a card that has not been read yet, Dramatis reads it once; when the card changes, it offers to read it again.',
        'intent.settings.status': 'This card',
        'intent.settings.status.none': 'Not read yet',
        'intent.settings.status.read': 'Read {date}',
        'intent.settings.status.noCard': 'No chat with one character is open',
        'intent.settings.readNow': 'Read the intent',
    },
    ru: {
        'intent.title': 'Замысел автора',
        'intent.task': 'Dramatis: чтение замысла',
        'intent.journal': 'Прочитан замысел автора: {summary}',

        'intent.progress.one': 'Читаю замысел…',
        'intent.progress': 'Читаю замысел: часть {n} из {total}…',
        'intent.done': 'Замысел прочитан: {summary}.',
        'intent.done.nobody': 'Замысел прочитан: в источниках никого не нашлось.',
        'intent.done.warnings': 'Замечания ({count}): {list}',
        'intent.done.open': 'Открыть',
        'intent.failed': 'Замысел не прочитан: {error}',
        'intent.changed': 'Карточка изменилась с тех пор, как замысел был прочитан. Перечитать? Твои правки останутся.',
        'intent.reread': 'Перечитать',
        'intent.upToDate': 'Карточка не менялась с тех пор, как замысел был прочитан.',

        'intent.n.characters': '{n} персонаж|{n} персонажа|{n} персонажей',
        'intent.n.groups': '{n} группа|{n} группы|{n} групп',
        'intent.n.rules': '{n} правило влечений|{n} правила влечений|{n} правил влечений',

        'intent.error.busy': 'Замысел уже читается.',
        'intent.error.noCard': 'Замысел читается только в чате с одним персонажем.',
        'intent.error.empty': 'В карточке нечего читать.',
        'intent.error.save': 'Не получилось сохранить прочитанное.',
        'intent.error.unexpected': 'Что-то пошло не так: {error}',

        'intent.warning.bad-answer': 'часть ответа модели не удалось разобрать',
        'intent.warning.unevidenced': '{who}{path} — без цитаты, пропущено',
        'intent.warning.quote-unverified': '{who}цитата к {path} не нашлась в источниках',
        'intent.warning.stance-capped': '{who}позиция {path} снижена: источники говорят о враждебности',
        'intent.warning.stranger-stance': '{who}позиция к игроку взята из отношения к чужакам',
        'intent.warning.rule-target':
            'правило «{name}» направлено на всех подходящих, а не на игрока: в сценарии нет прямых слов',
        'intent.warning.minor-appetite': '{who}несовершеннолетний — сексуальные влечения убраны',
        'intent.warning.minor-target': '{who}влечение к несовершеннолетнему убрано',
        'intent.warning.partFailed': 'часть {n} из {total} не прочитана: {error}',
        'intent.warning.skipped': 'не вошло в чтение записей лорбука: {n}',

        'intent.slash.read': 'Заново читает замысел автора текущей карточки (твои правки останутся).',

        'intent.settings.title': 'Замысел',
        'intent.settings.autoRead': 'Читать замысел автоматически',
        'intent.settings.autoReadHint':
            'Когда открывается новый чат с ещё не прочитанной карточкой, Dramatis один раз читает её замысел; если карточка изменилась — предлагает перечитать.',
        'intent.settings.status': 'Эта карточка',
        'intent.settings.status.none': 'Замысел ещё не прочитан',
        'intent.settings.status.read': 'Прочитан {date}',
        'intent.settings.status.noCard': 'Не открыт чат с одним персонажем',
        'intent.settings.readNow': 'Прочитать замысел',
    },
};

/** The plural form of a «|»-separated key for `n` (Russian one|few|many, English one|other). */
export function plural(i18n: I18n, key: string, n: number): string {
    const forms = i18n.t(key, { n }).split('|');
    let index: number;
    if (i18n.locale() === 'ru') {
        const mod10 = n % 10;
        const mod100 = n % 100;
        index = mod10 === 1 && mod100 !== 11 ? 0 : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 1 : 2;
    } else {
        index = n === 1 ? 0 : 1;
    }
    return (forms[Math.min(index, forms.length - 1)] ?? '').trim();
}

/** One warning of applyIntent as a short human phrase. */
export function warningText(i18n: I18n, warning: IntentWarning): string {
    const name = warning.name?.trim() ?? '';
    return i18n.t(`intent.warning.${warning.code}`, {
        who: name ? `${name}: ` : '',
        name,
        path: warning.path ?? '',
    });
}
