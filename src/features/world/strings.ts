// Strings of the «world» module (keys `world.*`). Russian is the primary UI language; the user is addressed with «ты».
// Story-log lines take the names and story words as written (`{name}`, `{attempt}`…).
import type { I18nParts } from '../../shared/contracts';

export const WORLD_STRINGS: I18nParts = {
    en: {
        'world.title': 'Living world',
        'world.settings.title': 'Living world',
        'world.settings.interval': 'World tick every N turns',
        'world.settings.intervalHint':
            '0 — by mode: every 30 turns in Economy, 15 in Balanced, 10 in Cinema. The world also ticks on a scene change and on a time skip.',
        'world.settings.notices': 'Notify about world events',
        'world.settings.noticesHint':
            'Fronts coming to pass and exposed schemes your character could hear about. Everything else goes to the log only.',

        'world.notice.doom': 'The world moved — {name}: {doom}',
        'world.notice.rumour': 'Rumours: {text}',
        'world.journal.summary': 'World tick: {actions} off-screen actions',

        'world.log.attempt.success': '{name} off-screen: {attempt} — succeeded.',
        'world.log.attempt.partial': '{name} off-screen: {attempt} — partly, but {complication}.',
        'world.log.attempt.failure': '{name} off-screen: {attempt} — failed.',
        'world.log.attempt.setback': '{name} off-screen: {attempt} — failed and lost ground.',
        'world.log.intention.done': '{name} achieved off-screen: {intention}.',
        'world.log.front.doom': 'Came to pass — {name}: {doom}.',
        'world.log.consequence.stance': '{name} → {target}: {from} → {to} ({text}).',
        'world.log.consequence.reputation': 'Reputation among {among}: {from} → {to} ({text}).',
        'world.log.appetite.sated': '{name}: {appetite} — sated off-screen.',
        'world.log.appetite.lapse': '{name}: lapsed off-screen — {appetite}.',
        'world.log.appetite.withdrawal': '{name}: withdrawal — {appetite}.',
        'world.log.scheme.breach': 'Someone noticed preparations: {name} — {scheme}.',
        'world.log.scheme.exposed': 'Scheme exposed: {name} against {target} — {scheme}.',
        'world.log.scheme.ready': 'Scheme ready: {name} against {target} — {scheme}.',
        'world.log.scheme.done': 'Scheme carried out off-screen: {name} against {target} — {scheme}.',
        'world.log.scheme.failed': 'Scheme failed: {name} against {target} — {scheme}.',
        'world.log.rumour.spread': 'The rumour «{text}» reached: {groups}.',
        'world.log.player.learned': '{name} heard of you: «{rumour}».',

        'world.complication.cost': 'it cost more than planned',
        'world.complication.noticed': 'someone noticed',
        'world.complication.slow': 'it took longer than hoped',
        'world.complication.balked': 'an ally balked',
        'world.complication.trail': 'it left a trail',
    },
    ru: {
        'world.title': 'Живой мир',
        'world.settings.title': 'Живой мир',
        'world.settings.interval': 'Тик мира каждые N ходов',
        'world.settings.intervalHint':
            '0 — по режиму: каждые 30 ходов в экономном, 15 в сбалансированном, 10 в «Кино». Ещё мир делает тик при смене сцены и при пропуске времени.',
        'world.settings.notices': 'Сообщать о событиях мира',
        'world.settings.noticesHint':
            'Сбывшиеся повестки и раскрытые замыслы, о которых твой персонаж мог услышать. Остальное — только в журнале.',

        'world.notice.doom': 'Мир сдвинулся — {name}: {doom}',
        'world.notice.rumour': 'Слухи: {text}',
        'world.journal.summary': 'Тик мира: действий за кадром — {actions}',

        'world.log.attempt.success': '{name} за кадром: {attempt} — получилось.',
        'world.log.attempt.partial': '{name} за кадром: {attempt} — отчасти, но {complication}.',
        'world.log.attempt.failure': '{name} за кадром: {attempt} — не вышло.',
        'world.log.attempt.setback': '{name} за кадром: {attempt} — не вышло, дело откатилось назад.',
        'world.log.intention.done': '{name}: цель достигнута за кадром — {intention}.',
        'world.log.front.doom': 'Сбылось — {name}: {doom}.',
        'world.log.consequence.stance': '{name} → {target}: {from} → {to} ({text}).',
        'world.log.consequence.reputation': 'Репутация ({among}): {from} → {to} ({text}).',
        'world.log.appetite.sated': '{name}: {appetite} — утолено за кадром.',
        'world.log.appetite.lapse': '{name}: срыв за кадром — {appetite}.',
        'world.log.appetite.withdrawal': '{name}: ломка — {appetite}.',
        'world.log.scheme.breach': 'Кто-то заметил приготовления: {name} — {scheme}.',
        'world.log.scheme.exposed': 'Замысел раскрыт: {name} против {target} — {scheme}.',
        'world.log.scheme.ready': 'Замысел готов: {name} против {target} — {scheme}.',
        'world.log.scheme.done': 'Замысел исполнен за кадром: {name} против {target} — {scheme}.',
        'world.log.scheme.failed': 'Замысел сорвался: {name} против {target} — {scheme}.',
        'world.log.rumour.spread': 'Слух «{text}» дошёл до: {groups}.',
        'world.log.player.learned': '{name} узнаёт о тебе из слухов: «{rumour}».',

        'world.complication.cost': 'обошлось дороже, чем думали',
        'world.complication.noticed': 'кто-то заметил',
        'world.complication.slow': 'ушло больше времени',
        'world.complication.balked': 'союзник дрогнул',
        'world.complication.trail': 'остались следы',
    },
};
