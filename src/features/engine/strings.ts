// Strings of the «engine» module (keys `engine.*`): its title, the player's generic name and the words of
// DRAMATIS_API.describe (describe.ts). Free text of the story stays as stored; only the frame is translated.
// The user is addressed with «ты».
import type { I18nParts } from '../../shared/contracts';

export const ENGINE_STRINGS: I18nParts = {
    en: {
        'engine.title': 'Engine',
        'engine.player': 'the player',

        'engine.describe.section.stance': 'Toward you',
        'engine.describe.section.wants': 'Wants',
        'engine.describe.section.now': 'Now',
        'engine.describe.section.appetites': 'Appetites',
        'engine.describe.section.core': 'Who they are',
        'engine.describe.section.secrets': 'Secrets',

        'engine.describe.stance': '{stance} — {reasons}',
        'engine.describe.behaviour': 'How it shows: {text}',
        'engine.describe.want': 'Wants you: {want}',
        'engine.describe.claim': 'Claim: {claim}',
        'engine.describe.intent': 'Means to: {intent}',

        'engine.describe.intention': '{text} → next: {next}',
        'engine.describe.dream': 'Dream: {text}',

        'engine.describe.doing': 'Doing: {text}',
        'engine.describe.sceneGoal': 'Scene goal: {text}',
        'engine.describe.obstacle': 'In the way: {text}',
        'engine.describe.mood': 'Mood: {mood}',
        'engine.describe.emotion': 'Feeling: {text}',
        'engine.describe.stress': 'Stress: {n} (breaks at {max})',
        'engine.describe.corruption': 'Corruption: {level} — {word}',

        'engine.describe.appetite': '{what}: {pressure}',
        'engine.describe.appetiteTarget': '{what}: {pressure} → {target}',

        'engine.describe.values': 'Values: {list}',
        'engine.describe.valuesSacrifice': 'Values: {list}; would give up {sacrifice}',
        'engine.describe.temperament': 'Temperament: {list}',
        'engine.describe.drives': 'Driven by: {list}',
        'engine.describe.wound': 'Wound: {text}',
        'engine.describe.lie': 'False belief: {text}',
        'engine.describe.signature': 'If → then: {text}',
        'engine.describe.tactics': 'Tactics: {list}',
        'engine.describe.keys': 'Can be moved by: {list}',

        'engine.describe.doom': 'If nobody intervenes: {text}',
        'engine.describe.scheme': 'Scheme against {target}: {text}',
    },
    ru: {
        'engine.title': 'Движок',
        'engine.player': 'игрок',

        'engine.describe.section.stance': 'Отношение к тебе',
        'engine.describe.section.wants': 'Чего хочет',
        'engine.describe.section.now': 'Сейчас',
        'engine.describe.section.appetites': 'Влечения',
        'engine.describe.section.core': 'Кто это',
        'engine.describe.section.secrets': 'Тайны',

        'engine.describe.stance': '{stance} — {reasons}',
        'engine.describe.behaviour': 'Как проявляется: {text}',
        'engine.describe.want': 'Хочет тебя: {want}',
        'engine.describe.claim': 'Притязание: {claim}',
        'engine.describe.intent': 'Намерение: {intent}',

        'engine.describe.intention': '{text} → дальше: {next}',
        'engine.describe.dream': 'Мечта: {text}',

        'engine.describe.doing': 'Занятие: {text}',
        'engine.describe.sceneGoal': 'Цель в сцене: {text}',
        'engine.describe.obstacle': 'Помеха: {text}',
        'engine.describe.mood': 'Настроение: {mood}',
        'engine.describe.emotion': 'Чувство: {text}',
        'engine.describe.stress': 'Напряжение: {n} (срыв на {max})',
        'engine.describe.corruption': 'Разложение: {level} — {word}',

        'engine.describe.appetite': '{what}: {pressure}',
        'engine.describe.appetiteTarget': '{what}: {pressure} → {target}',

        'engine.describe.values': 'Ценности: {list}',
        'engine.describe.valuesSacrifice': 'Ценности: {list}; пожертвует: {sacrifice}',
        'engine.describe.temperament': 'Темперамент: {list}',
        'engine.describe.drives': 'Двигатели: {list}',
        'engine.describe.wound': 'Рана: {text}',
        'engine.describe.lie': 'Ложная вера: {text}',
        'engine.describe.signature': 'Если → то: {text}',
        'engine.describe.tactics': 'Тактики: {list}',
        'engine.describe.keys': 'Сдвинуть может: {list}',

        'engine.describe.doom': 'Если никто не вмешается: {text}',
        'engine.describe.scheme': 'Замысел ({target}): {text}',
    },
};
