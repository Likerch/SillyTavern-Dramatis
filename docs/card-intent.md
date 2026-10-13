# Замысел в карточке (card intent v1)

> Dramatis 1.6.0. Формат для мастерских (Officina, `SillyTavern-Officina/docs/plan.md` §6.9, §15), которые пишут замысел автора прямо в карточку. Пользователю — раздел [«Замысел, записанный в карточке»](guide/sheet.md#замысел-записанный-в-карточке) руководства.

## Где и что

Объект лежит в карточке по пути `character.data.extensions.dramatis.intent` (карточка V2/V3, данные расширений). Типы, JSON Schema (`CARD_INTENT_SCHEMA`), словари (`CARD_INTENT_VOCABULARY`), пределы (`CARD_INTENT_LIMITS`), маркеры раздела в заметках и проверка (`validateCardIntent`) — в одном файле без импортов: [`src/shared/card-intent.ts`](../src/shared/card-intent.ts). Officina копирует его **дословно**; тест Dramatis держит словари равными модели (`src/domain/model.ts`).

Формат повторяет то, что вычитывает чтение замысла (`src/domain/intent-prompt.ts` → `intent-apply.ts`), поле в поле, в форме модели Dramatis:

```jsonc
{
  "version": 1,
  "world": {
    "tone": "hostile",                         // hostile | indifferent | neutral | welcoming
    "invariants": ["Ильва никогда не выдаёт мятежников"],
    "reputation": [{ "among": "стража", "label": "имперский курьер", "stance": -2, "greeting": -1 }],
    "rules": [{ "name": "возчики пьют", "holders": "возчики", "kind": "drink", "label": "брага", "target": "thing" }]
  },
  "characters": {
    "Ильва": {                                 // ключ — имя, как пишет история (именительный падеж)
      "english": "Ilva", "aliases": ["хозяйка"], "russian": [], "gender": "female",
      "kind": "character", "minor": false, "role": "хозяйка трактира «Рог»", "species": "",
      "core": {
        "concept": "вдова мятежника, держит трактир назло оккупантам",
        "values": { "top": ["security", "tradition"], "sacrifice": "conformity" },
        "temperament": { "honesty": 1, "agreeableness": -2 },          // HEXACO −2…+2
        "drives": { "high": ["vengeance", "family"], "low": ["status"] },
        "wound": { "ghost": "имперцы повесили её мужа", "lie": "имперцам верить нельзя", "triggers": [], "coping": "overcompensate" },
        "want": "…", "need": "…", "arcLock": false,
        "signatures": ["если ей приказывают → делает медленно и плохо"], "tactics": [],
        "attachment": { "anxiety": 0, "avoidance": 1 }, "proactivity": 6,
        "baselineMood": { "octant": "hostile", "label": "мрачная настороженность" },
        "stanceBounds": [{ "target": "PLAYER", "max": 0 }],
        "redLines": { "never": [], "would": [] }, "keys": [],
        "moralWeakness": "…", "voice": "Деньги вперёд, курьер.", "justifications": [],
        "dark": { "ruthless": false }, "corruption": 0, "anchors": ["Сота"]
      },
      "agenda": {
        "dream": "…", "goals": [{ "text": "…", "kind": "external", "priority": 1 }],
        "intentions": [{ "text": "…", "nextStep": "…", "dropIf": [] }],
        "front": { "impulse": "…", "steps": [], "doom": "…", "segments": 6 },
        "resources": [], "leverage": [], "secrets": ["прячет в погребе оружие мятежников"], "ifIgnored": "…"
      },
      "appetites": [{ "kind": "drink", "label": "брага", "baseline": 3, "target": "thing" }],
      "ties": [{ "target": "PLAYER", "stance": -2, "reasons": ["ты имперский курьер"], "behaviour": "…",
                 "intent": "avoid", "changeIf": ["доверие — только делами"], "want": 0 }],
      "starts": [{ "greeting": 0, "present": true, "doing": "считает выручку", "goal": "взять плату вперёд" }]
    }
  }
}
```

Правила:

- Весь текст — обычные строки **на языке истории**; `{{user}}` и `{{char}}` можно, они остаются как есть. Игрок — `PLAYER` (или `{{user}}`) в связях, границах, якорях и целях влечений.
- Всё необязательно, кроме того, без чего запись не имеет смысла: у связи — `target` и `stance`, у цели — `text`, у влечения и правила — `kind`, у правила — `name`, у раны — `ghost`, у настроения — `octant`, у стартовой сцены — `greeting`, у репутации — `label` и `stance`.
- **Отсутствующее поле, пустая строка и пустой список — «автор не говорит»**: это поле Dramatis вычитает из текста карточки, как раньше. Данное поле — авторское.
- Одна связь на цель, одно влечение на вид, одна стартовая сцена на приветствие, одно правило на имя; один человек — одна запись (имя, `english`, `aliases`, `russian` не должны совпадать с чужими).

## Что делает Dramatis

- **Проверяет** (`validateCardIntent`): всё верное берёт, остальное перечисляет. Неизвестное поле, значение вне шкалы или словаря, запись без обязательного, повтор — отбрасываются; слишком длинный текст и лишние элементы списка — обрезаются. Ошибки пишутся в консоль браузера и одной строкой в замечаниях чтения.
- **Пишет как авторское**: каждое данное поле — `origin: 'author'`, источник `card.intent`, без цитаты. Ни проверки цитат, ни защиты от смягчения: это слово автора. Единицы — те же, что у чтения: `core.<поле>`, `agenda.<поле>`, связь `ties.<цель>` и влечение `appetites.<вид>` — по одной, остальное (`starts`, `invariants`, `reputation`, правило) — целиком. Чтение текста эти поля **никогда не переписывает**. Правка пользователя и его замок 🔒 — сильнее (показываются расхождением). Граница для несовершеннолетних действует как везде.
- **Читает текст только ради пробелов.** Если замысел покрывает то, что нужно карточке мотивов (`complete`: тон мира; хотя бы один персонаж; у каждого — `core.concept`, `core.values.top`, `core.drives.high`, `core.want` или цель, связь с `PLAYER`; у группы — `concept` и связь с `PLAYER`), модель вообще не вызывается, соединение с ИИ не нужно. Иначе модель читает карточку как раньше и заполняет только то, чего в замысле нет (`inferred` или `author` с цитатой). Если текст прочитать не удалось, авторская часть всё равно сохраняется, а чтение помечается для повтора.
- **Раздел «Замысел» в `creator_notes`** — тот же замысел словами — при структурном замысле в чтение не попадает, чтобы не считать его дважды. Officina оборачивает его маркерами `CARD_INTENT_NOTES_BEGIN` / `CARD_INTENT_NOTES_END` (`<!-- dramatis:intent -->` … `<!-- /dramatis:intent -->`); без маркеров вырезается раздел под заголовком Markdown «Замысел» / «Intent» до следующего заголовка того же уровня.
- **Изменения**: объект замысла входит в отпечаток карточки — изменённый замысел даёт предложение «Перечитать?» (или читается сам при новом чате). То, что прежний замысел писал, а новый больше не говорит, очищается, и его снова может вычитать текст. Карточка без замысла даёт тот же отпечаток, что до 1.6.

## DRAMATIS_API (1.6+)

```ts
const api = globalThis.DRAMATIS_API;
if (api?.features?.includes('cardIntent') && api.cardIntentVersion === 1) {
    const check = api.validateCardIntent!(intent);
    // check.ok — ничего не отброшено; check.errors — [{ path, code, message }];
    // check.intent — что Dramatis возьмёт; check.complete / check.missing — обойдётся ли без чтения текста.
}
```

`validateCardIntent` — чистая функция: отвечает и при выключенном Dramatis, и в чате мастерской. `intentState().fromCard` говорит, что последнее чтение взяло замысел карточки. Тот же `validateCardIntent` есть в скопированном `card-intent.ts` — для проверки без Dramatis.

## Для Officina

1. Скопировать `src/shared/card-intent.ts` дословно (сверять при обновлении Dramatis).
2. Перед выпуском — `validateCardIntent`: показать `errors`, предупредить, если `complete` ложно (тогда Dramatis дочитает пробелы моделью).
3. Писать `data.extensions.dramatis.intent` и раздел «Замысел» в `creator_notes` между маркерами — из одних и тех же данных каста.
4. После выпуска — `readIntent({ force: true })` в чате песочницы; `intentState().fromCard` и `describe(name)` — для отчёта обкатки.
