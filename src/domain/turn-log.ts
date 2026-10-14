// Story log lines of the turn and scene passes (ChatState.log, shown in the UI): one short line per meaningful
// change — a stance step with its reason, a scheme started, ready or exposed, a lapse or a binge, withdrawal, a
// corruption stain or threshold, a break. Written in the UI language (the domain has no i18n service, as render.ts),
// names as the story writes them. Also the corruption threshold step shared by both passes. Pure.
import { crossThreshold, crossedThresholds } from './corruption';
import type { CorruptionState } from './corruption';
import { pressureLabel, stanceLabel } from './ladders';
import type { Gender, Lang } from './ladders';
import { PLAYER_ID } from './model';
import type { CharacterProfile, StateEvent } from './model';
import { BRAND_WORDS, GIFT_WORDS, giftChance, identityOf, identityPhrase } from './thresholds';
import type { Rng } from '../shared/contracts';

/** Story log lines kept in the chat state. */
export const MAX_LOG = 300;

/** Chance that a character without a profile accepts the gift of a threshold (thresholds.ts giftChance weighs it). */
export const GIFT_ACCEPT = 0.5;

export type LogKind =
    | 'stance'
    | 'reason'
    | 'arc'
    | 'intention'
    | 'appetite'
    | 'scheme'
    | 'claim'
    | 'gaze'
    | 'temptation'
    | 'corruption'
    | 'drift'
    | 'break'
    | 'reputation'
    | 'rumour'
    | 'scene';

/** English, Russian (masculine or unknown gender) and, when it differs, Russian for a female character. */
type Pair = { en: string; ru: string; ruF?: string };

const W = {
    player: { en: 'the player', ru: 'игрок' },
    reasonUp: {
        en: '{name} → {target}: new reason «{text}» (warmer)',
        ru: '{name} → {target}: новая причина «{text}» (теплее)',
    },
    reasonDown: {
        en: '{name} → {target}: new reason «{text}» (colder)',
        ru: '{name} → {target}: новая причина «{text}» (холоднее)',
    },
    step: { en: '{name} → {target}: {from} → {to} ({text})', ru: '{name} → {target}: {from} → {to} ({text})' },
    arc: {
        en: '{name} → {target}: «{text}» would cross the author’s bound — waiting in the Inbox',
        ru: '{name} → {target}: «{text}» выходит за границу замысла — ждёт решения во «Входящих»',
    },
    arcApplied: {
        en: '{name} → {target}: arc step {from} → {to} ({text})',
        ru: '{name} → {target}: шаг дуги {from} → {to} ({text})',
    },
    drift: {
        en: '{name} → {target}: back to {to} as reasons faded',
        ru: '{name} → {target}: причины остыли, снова {to}',
    },
    achieved: {
        en: '{name}: achieved «{text}»',
        ru: '{name}: добился своего — «{text}»',
        ruF: '{name}: добилась своего — «{text}»',
    },
    impossible: { en: '{name}: gave up «{text}» as impossible', ru: '{name}: «{text}» — невозможно, оставлено' },
    dropped: { en: '{name}: dropped «{text}»', ru: '{name}: бросил «{text}»', ruF: '{name}: бросила «{text}»' },
    switched: {
        en: '{name}: switched from «{text}» to «{other}»',
        ru: '{name}: сменил «{text}» на «{other}»',
        ruF: '{name}: сменила «{text}» на «{other}»',
    },
    promoted: { en: '{name}: took up «{text}»', ru: '{name}: взялся за «{text}»', ruF: '{name}: взялась за «{text}»' },
    lapse: { en: '{name}: broke the vow — {what}', ru: '{name}: сорвался — {what}', ruF: '{name}: сорвалась — {what}' },
    binge: { en: '{name}: the lapse turns into a binge — {what}', ru: '{name}: срыв перешёл в запой — {what}' },
    recommit: {
        en: '{name}: slipped, but holds on again — {what}',
        ru: '{name}: оступился, но снова держится — {what}',
        ruF: '{name}: оступилась, но снова держится — {what}',
    },
    withdrawal: { en: '{name}: withdrawal sets in — {what}', ru: '{name}: началась ломка — {what}' },
    withdrawalEnd: { en: '{name}: withdrawal eased — {what}', ru: '{name}: ломка отпустила — {what}' },
    sensitized: { en: '{name}: cues bite harder now — {what}', ru: '{name}: поводы цепляют сильнее — {what}' },
    schemeStarted: {
        en: '{name}: starts a scheme — {text}',
        ru: '{name}: начал замысел — {text}',
        ruF: '{name}: начала замысел — {text}',
    },
    schemeReady: { en: '{name}: the scheme is ready to spring — {text}', ru: '{name}: замысел готов — {text}' },
    schemeExposed: { en: '{name}: the scheme is exposed — {text}', ru: '{name}: замысел раскрыт — {text}' },
    claim: {
        en: '{name}: lays claim to {target}',
        ru: '{name}: застолбил — {target}',
        ruF: '{name}: застолбила — {target}',
    },
    owned: { en: '{name}: now holds {target}', ru: '{name}: теперь владеет — {target}' },
    gaze: { en: '{name} sees {target} differently now', ru: '{name} иначе смотрит на {target}' },
    gazeFall: { en: '{name} looks at outsiders as things now', ru: '{name}: на чужих теперь смотрит как на вещи' },
    temptation: {
        en: '{name}: tempted to cross a line for {what}',
        ru: '{name}: искушение переступить черту ради «{what}»',
    },
    stain: { en: '{name}: a stain on the conscience ({text})', ru: '{name}: пятно на совести ({text})' },
    remorseOk: { en: '{name}: remorse washes the stains away', ru: '{name}: раскаяние смыло пятна' },
    remorseFail: { en: '{name}: no remorse — corruption {level}', ru: '{name}: раскаяния нет — разложение {level}' },
    threshold: { en: '{name}: corruption reaches {level}', ru: '{name}: разложение дошло до {level}' },
    giftTaken: {
        en: '{name} takes the gift of the fall: {what}',
        ru: '{name} принимает дар падения: {what}',
        ruF: '{name} принимает дар падения: {what}',
    },
    giftRefused: {
        en: '{name} refuses the gift ({what}) and holds on to themselves',
        ru: '{name} отказывается от дара ({what}) и держится за себя',
    },
    brand: { en: '{name} is branded: {what}', ru: '{name}: клеймо — {what}' },
    identity: { en: '{name} now {what}', ru: '{name} теперь {what}' },
    lost: { en: '{name} is lost', ru: '{name}: потерян', ruF: '{name}: потеряна' },
    recovered: {
        en: '{name}: climbs back a step — corruption {level}',
        ru: '{name}: шаг назад от падения — разложение {level}',
    },
    driftFound: {
        en: '{name}: the reply played them against the engine ({what})',
        ru: '{name}: ответ разошёлся с движком ({what})',
    },
    driftFollowed: {
        en: '{name}: the story played them otherwise; the invented sheet gives way ({what})',
        ru: '{name}: история показала иначе — придуманное уступает ({what})',
    },
    break: {
        en: '{name}: breaks under the strain — {what}',
        ru: '{name}: не выдержал — {what}',
        ruF: '{name}: не выдержала — {what}',
    },
    repStep: {
        en: 'Reputation among {among}: {from} → {to} ({text})',
        ru: 'Репутация ({among}): {from} → {to} ({text})',
    },
    repLabel: { en: 'Among {among} you are now «{text}»', ru: 'Для {among} ты теперь «{text}»' },
    repWeakness: { en: '{among} know your weakness: {text}', ru: '{among} знают твою слабость: {text}' },
    rumour: { en: 'A rumour starts: «{text}»', ru: 'Пошёл слух: «{text}»' },
    sceneEnd: { en: 'The scene ends', ru: 'Сцена закончилась' },
    sceneLeft: { en: '{name} left the scene', ru: '{name} ушёл из сцены', ruF: '{name} ушла из сцены' },
    sceneBack: {
        en: '{name} is back in the scene',
        ru: '{name} вернулся в сцену',
        ruF: '{name} вернулась в сцену',
    },
    chapterEnd: { en: 'The scene ends; time passes ({hours} h)', ru: 'Сцена закончилась; прошло времени: {hours} ч' },
} satisfies Record<string, Pair>;

export type LogWord = keyof typeof W;

/** Fills a log template in the given language. */
export function logText(
    key: LogWord,
    lang: Lang,
    params: Record<string, string | number> = {},
    gender?: Gender,
): string {
    const word: Pair = W[key];
    const template = lang === 'en' ? word.en : gender === 'female' && word.ruF ? word.ruF : word.ru;
    return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** Collects log lines for one pass. */
export class TurnLog {
    readonly events: StateEvent[] = [];

    constructor(
        readonly lang: Lang,
        readonly turn: number,
        private readonly names: ReadonlyMap<string, CharacterProfile>,
        private readonly playerName: string,
        private readonly messageIndex?: number,
    ) {}

    name(id: string | undefined): string {
        if (!id) return '';
        if (id === PLAYER_ID) return this.playerName.trim() || (this.lang === 'ru' ? W.player.ru : W.player.en);
        return this.names.get(id)?.name ?? id;
    }

    gender(id: string): Gender | undefined {
        return this.names.get(id)?.gender;
    }

    stance(value: number, id: string): string {
        return stanceLabel(value, this.lang, this.gender(id));
    }

    pressure(value: number, id: string): string {
        return pressureLabel(value, this.lang, this.gender(id));
    }

    add(kind: LogKind, key: LogWord, params: Record<string, string | number>, character?: string): void {
        const gender = character ? this.gender(character) : undefined;
        const event: StateEvent = { turn: this.turn, kind, text: logText(key, this.lang, params, gender) };
        if (character) event.character = character;
        if (this.messageIndex !== undefined) event.messageIndex = this.messageIndex;
        this.events.push(event);
    }
}

/** Appends lines to the state's log, keeping the last MAX_LOG. */
export function appendLog<T extends { log: StateEvent[] }>(state: T, events: readonly StateEvent[]): void {
    if (events.length) state.log = [...state.log, ...events].slice(-MAX_LOG);
}

/** Who crosses the threshold (stage 5): the profile weighs the gift, an anchor near holds them back. */
export interface ThresholdWho {
    profile?: CharacterProfile;
    anchorPresent?: boolean;
}

/**
 * The corruption level moved up from `from` to the state's level: every threshold passed brings its brand, the gift is
 * taken or refused by a roll weighted by the character (thresholds.ts giftChance; refusal earns a remorse die), both in
 * story words; at 7 the craving becomes part of who they are (`identity`); 10 is «lost». Returns the new state and
 * whether 5 was crossed (the gaze shift unlock).
 */
export function passThresholds(
    corruption: CorruptionState,
    from: number,
    rng: Rng,
    log: TurnLog,
    id: string,
    who: ThresholdWho = {},
): { state: CorruptionState; crossed5: boolean } {
    let state = corruption;
    let crossed5 = false;
    const name = log.name(id);
    for (const threshold of crossedThresholds(from, corruption.level)) {
        if (threshold === 10) {
            log.add('corruption', 'lost', { name }, id);
            continue;
        }
        if (threshold === 5) crossed5 = true;
        const chance = who.profile
            ? giftChance(who.profile, threshold, { anchorPresent: who.anchorPresent === true })
            : GIFT_ACCEPT;
        const accept = rng() < chance;
        state = crossThreshold(state, threshold, accept);
        log.add('corruption', 'threshold', { name, level: threshold }, id);
        log.add(
            'corruption',
            accept ? 'giftTaken' : 'giftRefused',
            { name, what: GIFT_WORDS[threshold][log.lang] },
            id,
        );
        log.add('corruption', 'brand', { name, what: BRAND_WORDS[threshold][log.lang] }, id);
        if (threshold === 7) {
            const identity = identityOf(who.profile);
            state = { ...state, identity };
            log.add('corruption', 'identity', { name, what: identityPhrase(identity, log.lang, log.gender(id)) }, id);
        }
    }
    return { state, crossed5 };
}
