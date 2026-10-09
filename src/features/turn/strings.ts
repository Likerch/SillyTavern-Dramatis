// Strings of the turn module (keys `turn.*`). Russian is the primary UI language; the user is addressed with «ты».
import type { I18nParts } from '../../shared/contracts';

export const TURN_STRINGS: I18nParts = {
    en: {
        'turn.title': 'Turn pass',
        'turn.arc.title': 'A change of heart: {name} → {target} ({from} → {to})',
        'turn.arc.description':
            'The event goes past the bound the author set for this tie: «{text}». Accept, and the stance moves one step.',
        'turn.arc.accept': 'Accept',
        'turn.arc.reject': 'Keep as it was',
        'turn.journal.summary': 'Turn {turn}: {count} changes in the story state',
        'turn.journal.quiet': 'Turn {turn}: the story state moved on',
        'turn.redo.notice': '{names}: the reply played them against their character. You can redo it.',
        'turn.redo.action': 'Redo',
        'turn.redo.tooLate': 'Only the last reply can be redone.',
    },
    ru: {
        'turn.title': 'Проход хода',
        'turn.arc.title': 'Перемена: {name} → {target} ({from} → {to})',
        'turn.arc.description':
            'Событие выходит за границу, которую автор задал этому отношению: «{text}». Если примешь — отношение сдвинется на шаг.',
        'turn.arc.accept': 'Принять',
        'turn.arc.reject': 'Оставить как есть',
        'turn.journal.summary': 'Ход {turn}: изменений в состоянии истории — {count}',
        'turn.journal.quiet': 'Ход {turn}: состояние истории сдвинулось',
        'turn.redo.notice': '{names}: ответ разошёлся с характером. Можно переделать.',
        'turn.redo.action': 'Переделать',
        'turn.redo.tooLate': 'Переделать можно только последний ответ.',
    },
};
