// Words for every scale of the model (docs/model.md §4–§5): English for the prompt (the motive card, background
// passes), Russian for the UI and the Russian card. Numbers stay in the engine; the model only sees these words (П6).
// Pure lookups: every function clamps or falls back instead of throwing.
import type {
    AffectionOnset,
    AppetiteKind,
    AppetiteSource,
    ArcStage,
    AttentionBand,
    Claim,
    Coping,
    Drive,
    Gaze,
    HexacoAxis,
    Justification,
    Lod,
    MoodOctant,
    Move,
    Origin,
    Stance,
    Style,
    TieIntent,
    Value,
    WorldTone,
} from './model';

export type Lang = 'en' | 'ru';
export type Gender = 'female' | 'male';

/** One word or phrase per language. */
type Word = { en: string; ru: string };

function pick(word: Word | undefined, lang: Lang): string {
    if (!word) return '';
    return lang === 'ru' ? word.ru : word.en;
}

function index(value: number, min: number, max: number): number {
    const n = Number.isFinite(value) ? Math.round(value) : min;
    return Math.min(max, Math.max(min, n)) - min;
}

/* ------------------------------------------------------------------ stance (§4.3) */

/** −3 … +3, Blades in the Dark faction status. */
const STANCE_EN = ['at war', 'hostile', 'interfering', 'neutral', 'helpful', 'friendly', 'allied'];
/** Russian labels: masculine, feminine, and a noun for an unknown gender. */
const STANCE_RU: [string, string, string][] = [
    ['Война', 'Война', 'война'],
    ['Враждебен', 'Враждебна', 'враждебность'],
    ['Мешает', 'Мешает', 'помехи'],
    ['Нейтрален', 'Нейтральна', 'нейтралитет'],
    ['Расположен', 'Расположена', 'расположение'],
    ['Дружелюбен', 'Дружелюбна', 'дружелюбие'],
    ['Союзник', 'Союзница', 'союз'],
];

/** Behavioural definition of each step: goes into the prompt as is (§4.3). Gender-free in both languages. */
const STANCE_BEHAVIOUR: Word[] = [
    { en: 'will take risks to do harm', ru: 'идёт на риск, чтобы навредить' },
    { en: 'tries to do harm when it is safe', ru: 'старается навредить, если это не опасно' },
    { en: 'makes trouble when it is cheap', ru: 'создаёт трудности, когда это дёшево' },
    { en: 'minds their own business; just one face among many', ru: 'по своим делам; игрок — один из многих' },
    { en: 'helps when it costs next to nothing', ru: 'помогает, если это почти ничего не стоит' },
    { en: 'helps unless it brings serious trouble', ru: 'помогает, если это не грозит серьёзными проблемами' },
    { en: 'helps even at a cost to themselves', ru: 'помогает даже себе в ущерб' },
];

/**
 * Stance word. English is the prompt word ('hostile'); Russian is the UI label in the character's gender
 * («Враждебна»), masculine when the gender is unknown (the UI tables use it).
 */
export function stanceLabel(stance: Stance | number, lang: Lang, gender?: Gender): string {
    const i = index(stance, -3, 3);
    if (lang === 'en') return STANCE_EN[i]!;
    const row = STANCE_RU[i]!;
    return gender === 'female' ? row[1] : row[0];
}

/** Gender-free stance word: a noun in Russian («враждебность»), the same word in English. */
export function stanceNoun(stance: Stance | number, lang: Lang): string {
    const i = index(stance, -3, 3);
    return lang === 'en' ? STANCE_EN[i]! : STANCE_RU[i]![2];
}

/** What a character on this step does (the ladder definition). */
export function stanceBehaviour(stance: Stance | number, lang: Lang): string {
    return pick(STANCE_BEHAVIOUR[index(stance, -3, 3)], lang);
}

/* ------------------------------------------------------------------ appetite pressure (§4.5) */

const PRESSURE: Word[] = [
    { en: 'sated', ru: 'сыт' },
    { en: 'background', ru: 'фон' },
    { en: 'present', ru: 'есть' },
    { en: 'preoccupied', ru: 'поглощён' },
    { en: 'driving', ru: 'гонит' },
    { en: 'obsessed', ru: 'одержим' },
];
const PRESSURE_RU_FEMININE = ['сыта', 'фон', 'есть', 'поглощена', 'гонит', 'одержима'];

const PRESSURE_BEHAVIOUR: Word[] = [
    { en: 'not interested, may even be put off', ru: 'не интересно, может даже отталкивать' },
    { en: 'notices cues', ru: 'замечает поводы' },
    { en: 'thinks about it idly, takes cheap chances', ru: 'думает об этом без дела, ловит дешёвые случаи' },
    {
        en: 'attention sticks to it, plans around it, irritated by obstacles',
        ru: 'внимание прикипает, строит планы вокруг, раздражается на помехи',
    },
    {
        en: 'crowds out other goals; risk does not deter, conscience weakens',
        ru: 'вытесняет другие цели, риск не пугает, совесть слабеет',
    },
    {
        en: 'acts at the first chance; only hard brakes hold — mortal fear, an unbreakable vow, a strong guard',
        ru: 'действует при первой возможности; держат только жёсткие сдержки — смертельный страх, нерушимый обет, сильный сторож',
    },
];

/** Pressure word 0 sated … 5 obsessed («сыт» … «одержим»; feminine forms for female characters). */
export function pressureLabel(pressure: number, lang: Lang, gender?: Gender): string {
    const i = index(pressure, 0, 5);
    if (lang === 'ru' && gender === 'female') return PRESSURE_RU_FEMININE[i]!;
    return pick(PRESSURE[i], lang);
}

export function pressureBehaviour(pressure: number, lang: Lang): string {
    return pick(PRESSURE_BEHAVIOUR[index(pressure, 0, 5)], lang);
}

/* ------------------------------------------------------------------ gaze (§4.5) */

const GAZE: Record<Gaze, Word> = {
    person: { en: 'person', ru: 'Человек' },
    prize: { en: 'prize', ru: 'Приз' },
    instrument: { en: 'instrument', ru: 'Средство' },
    property: { en: 'property', ru: 'Собственность' },
    prey: { en: 'prey', ru: 'Добыча' },
    mate: { en: 'mate', ru: 'Пара по инстинкту' },
};

const GAZE_BEHAVIOUR: Record<Gaze, Word> = {
    person: {
        en: 'negotiates, accepts a refusal, cares how the other feels',
        ru: 'договаривается, принимает отказ, ему важно, каково другому',
    },
    prize: {
        en: 'pursues, competes, boasts; cools once won',
        ru: 'добивается, соперничает, хвастается; добыв — остывает',
    },
    instrument: {
        en: 'a means to an end (a dose, a coin, a key); anyone like them would do',
        ru: 'способ (доза, монета, ключ); подойдёт любой такой же',
    },
    property: {
        en: 'keeps, guards, may sell or trade; may even look after them as one keeps livestock; jealous of "theft"',
        ru: 'держит, стережёт, может продать или обменять; может беречь, как скот или сокровище; ревнует к «краже»',
    },
    prey: {
        en: 'stalks, cuts off from their own, strikes from ambush; their words are noise',
        ru: 'выслеживает, отделяет от своих, нападает из засады; слова цели для него — шум',
    },
    mate: {
        en: 'wants a mate for themselves or their kind',
        ru: 'хочет «пару» для себя или рода',
    },
};

/** The gaze as it reads in the card after «Wants X …» («as loot to keep or sell»). */
const GAZE_PHRASE: Record<Gaze, Word> = {
    person: { en: 'as a person — would bargain and accept a refusal', ru: 'как человека — договорится, примет отказ' },
    prize: { en: 'as a prize to win and show off', ru: 'как приз, которым можно похвастаться' },
    instrument: {
        en: 'as a means to an end — anyone like them would do',
        ru: 'как средство — подойдёт любой такой же',
    },
    property: { en: 'as property to keep, guard or trade', ru: 'как собственность — держать, стеречь, обменять' },
    prey: { en: 'as prey to stalk and seize', ru: 'как дичь — выследить и схватить' },
    mate: { en: 'as a mate by instinct', ru: 'как пару по инстинкту' },
};
const LOOT_PHRASE: Word = { en: 'as loot to keep or sell', ru: 'как добычу — оставить себе или продать' };

export function gazeLabel(gaze: Gaze, lang: Lang): string {
    return pick(GAZE[gaze], lang);
}

export function gazeBehaviour(gaze: Gaze, lang: Lang): string {
    return pick(GAZE_BEHAVIOUR[gaze], lang);
}

/** «as loot to keep or sell» (property seen through plunder), «as prey to stalk and seize»… */
export function gazePhrase(gaze: Gaze, lang: Lang, kind?: AppetiteKind): string {
    if (gaze === 'property' && kind === 'plunder') return pick(LOOT_PHRASE, lang);
    return pick(GAZE_PHRASE[gaze], lang);
}

/* ------------------------------------------------------------------ method ladder (§5.7) */

const METHOD: Word[] = [
    { en: 'hold back, switch', ru: 'Удержаться, переключиться' },
    { en: 'substitute', ru: 'Замена' },
    { en: 'wait, prepare', ru: 'Выждать, подготовить' },
    { en: 'ask, court, seduce', ru: 'Просить, ухаживать, соблазнять' },
    { en: 'buy, bargain', ru: 'Купить, сторговаться' },
    { en: 'deceive', ru: 'Обмануть' },
    { en: 'weaken', ru: 'Ослабить' },
    { en: 'coerce', ru: 'Принудить' },
    { en: 'force', ru: 'Сила' },
];

/** What the character is doing about it now, for «Now: …» in the card. */
const METHOD_NOW: Word[] = [
    { en: 'holding back, busying themselves elsewhere', ru: 'сдерживается, занимает себя другим' },
    { en: 'settling for a substitute', ru: 'ищет замену' },
    { en: 'biding time and preparing', ru: 'выжидает и готовится' },
    { en: 'courting', ru: 'ухаживает, соблазняет' },
    { en: 'bargaining', ru: 'торгуется' },
    { en: 'deceiving', ru: 'обманывает' },
    { en: 'wearing the target down', ru: 'ослабляет цель' },
    { en: 'coercing', ru: 'принуждает' },
    { en: 'ready to use force', ru: 'готов взять силой' },
];

/** Ladder step name 0 … 8 («Удержаться, переключиться» … «Сила»). */
export function methodLabel(step: number, lang: Lang): string {
    return pick(METHOD[index(step, 0, 8)], lang);
}

/** The step as a present activity («biding time and preparing»). */
export function methodNow(step: number, lang: Lang): string {
    return pick(METHOD_NOW[index(step, 0, 8)], lang);
}

/** «scheming»: the method runs as a scheme with a clock. */
export function schemingLabel(lang: Lang): string {
    return lang === 'ru' ? 'готовит замысел' : 'scheming';
}

/* ------------------------------------------------------------------ styles (почерки, §5.7) */

const STYLE: Record<Style, Word> = {
    siren: { en: 'siren', ru: 'Сирена' },
    buyer: { en: 'buyer', ru: 'Покупатель' },
    insider: { en: 'insider', ru: 'Свой' },
    spider: { en: 'spider', ru: 'Паук' },
    raider: { en: 'raider', ru: 'Налётчик' },
    shadow: { en: 'shadow', ru: 'Тень' },
    shepherd: { en: 'shepherd', ru: 'Пастух' },
    duelist: { en: 'duelist', ru: 'Поединщик' },
    honest: { en: 'honest', ru: 'Честный' },
};

const STYLE_BEHAVIOUR: Record<Style, Word> = {
    siren: { en: 'seduces; may cool once it is won', ru: 'соблазн; добыв, может остыть' },
    buyer: { en: 'deals, payment, favours', ru: 'сделка, плата, услуги' },
    insider: { en: 'uses the trust of their own circle, in secret', ru: 'пользуется доверием своего круга, тайно' },
    spider: {
        en: 'lures and traps through a scheme: waits, deceives, springs',
        ru: 'заманивает и ловит через замысел: выжидает → обманывает → захлопывает',
    },
    raider: {
        en: 'pack, ambush, force; usually with their own approving',
        ru: 'стая, засада, сила; обычно с одобрения своих',
    },
    shadow: {
        en: 'takes the sleeping, the drunk, the helpless; avoids a fight',
        ru: 'берёт спящих, пьяных, беспомощных; избегает схватки',
    },
    shepherd: {
        en: 'keeps a "flock" of the willing or the dependent close',
        ru: 'держит при себе «стадо» добровольных или зависимых',
    },
    duelist: {
        en: "challenge and the victor's right — fair by their custom",
        ru: 'вызов и право победителя — по его обычаю это честно',
    },
    honest: {
        en: 'only by consent; frustrated more often than others',
        ru: 'только по согласию; чаще других досадует',
    },
};

export function styleLabel(style: Style, lang: Lang): string {
    return pick(STYLE[style], lang);
}

export function styleBehaviour(style: Style, lang: Lang): string {
    return pick(STYLE_BEHAVIOUR[style], lang);
}

/* ------------------------------------------------------------------ attention and moves (§4.4, §5.4) */

const BAND: Record<AttentionBand, Word> = {
    background: { en: 'background', ru: 'Фон' },
    business: { en: 'business', ru: 'По делу' },
    focus: { en: 'in focus', ru: 'В фокусе' },
};

const BAND_MEANING: Record<AttentionBand, Word> = {
    background: {
        en: 'busy with their own; the player is part of the scenery',
        ru: 'занят своим; ты — часть обстановки',
    },
    business: {
        en: 'deals with the player while needed for their aim',
        ru: 'имеет с тобой дело, пока ты нужен для его цели',
    },
    focus: { en: 'the player is their main concern now', ru: 'ты — его главная забота сейчас' },
};

export function bandLabel(band: AttentionBand, lang: Lang): string {
    return pick(BAND[band], lang);
}

export function bandMeaning(band: AttentionBand, lang: Lang): string {
    return pick(BAND_MEANING[band], lang);
}

const MOVE: Record<Move, Word> = {
    own: { en: 'presses on with their own business', ru: 'гнёт своё' },
    respond: { en: 'responds', ru: 'отвечает' },
    initiate: { en: 'starts something', ru: 'заводит разговор или дело' },
    obstruct: { en: 'gets in the way', ru: 'мешает' },
    watch: { en: 'watches', ru: 'наблюдает' },
    leave: { en: 'leaves', ru: 'уходит' },
};

/** Move with a target, English only («starts something with Брам»). */
const MOVE_TARGET_EN: Record<Move, string> = {
    own: 'presses on with their own business',
    respond: 'responds to {t}',
    initiate: 'starts something with {t}',
    obstruct: "gets in {t}'s way",
    watch: 'watches {t}',
    leave: 'leaves',
};

/** The move of this beat; Russian puts the target in brackets to keep it in the nominative. */
export function moveLabel(move: Move, lang: Lang, target?: string): string {
    const who = target?.trim();
    if (!who || move === 'own' || move === 'leave') return pick(MOVE[move], lang);
    if (lang === 'en') return MOVE_TARGET_EN[move].replace('{t}', who);
    return `${MOVE[move].ru} (${who})`;
}

/* ------------------------------------------------------------------ moods (PAD octants) */

const MOOD: Record<MoodOctant, Word> = {
    exuberant: { en: 'exuberant', ru: 'воодушевлённое' },
    dependent: { en: 'dependent', ru: 'ищущее опоры' },
    relaxed: { en: 'relaxed', ru: 'спокойное' },
    docile: { en: 'docile', ru: 'покорное' },
    hostile: { en: 'hostile', ru: 'враждебное' },
    anxious: { en: 'anxious', ru: 'тревожное' },
    disdainful: { en: 'disdainful', ru: 'презрительное' },
    bored: { en: 'bored', ru: 'скучающее' },
};

export function moodLabel(octant: MoodOctant, lang: Lang): string {
    return pick(MOOD[octant], lang);
}

/* ------------------------------------------------------------------ core vocabularies */

const VALUE: Record<Value, Word> = {
    'self-direction': { en: 'self-direction', ru: 'самостоятельность' },
    stimulation: { en: 'stimulation', ru: 'новизна и острота' },
    hedonism: { en: 'pleasure', ru: 'удовольствие' },
    achievement: { en: 'achievement', ru: 'достижения' },
    power: { en: 'power', ru: 'власть' },
    security: { en: 'security', ru: 'безопасность' },
    conformity: { en: 'conformity', ru: 'следование правилам' },
    tradition: { en: 'tradition', ru: 'традиция' },
    benevolence: { en: 'care for their own', ru: 'забота о близких' },
    universalism: { en: 'fairness for all', ru: 'справедливость для всех' },
};

export function valueLabel(value: Value, lang: Lang): string {
    return pick(VALUE[value], lang);
}

const DRIVE: Record<Drive, Word> = {
    power: { en: 'power', ru: 'власть' },
    independence: { en: 'independence', ru: 'независимость' },
    curiosity: { en: 'curiosity', ru: 'любопытство' },
    acceptance: { en: 'acceptance', ru: 'признание' },
    order: { en: 'order', ru: 'порядок' },
    saving: { en: 'hoarding', ru: 'накопительство' },
    honor: { en: 'honour', ru: 'честь' },
    idealism: { en: 'idealism', ru: 'идеализм' },
    social: { en: 'company', ru: 'общение' },
    family: { en: 'family', ru: 'семья' },
    status: { en: 'status', ru: 'статус' },
    vengeance: { en: 'vengeance', ru: 'месть' },
    romance: { en: 'romance', ru: 'романтика' },
    eating: { en: 'food', ru: 'еда' },
    physical: { en: 'physical exertion', ru: 'физическая сила' },
    tranquility: { en: 'tranquillity', ru: 'покой' },
};

export function driveLabel(drive: Drive, lang: Lang): string {
    return pick(DRIVE[drive], lang);
}

const HEXACO_LABEL: Record<HexacoAxis, Word> = {
    honesty: { en: 'honesty-humility', ru: 'честность-скромность' },
    emotionality: { en: 'emotionality', ru: 'эмоциональность' },
    extraversion: { en: 'extraversion', ru: 'общительность' },
    agreeableness: { en: 'agreeableness', ru: 'доброжелательность' },
    conscientiousness: { en: 'conscientiousness', ru: 'добросовестность' },
    openness: { en: 'openness', ru: 'открытость' },
};

/** Words for the extremes of each axis: [low, high]. Only ±2 goes into a prompt (§4.1). */
const HEXACO_POLES: Record<HexacoAxis, [Word, Word]> = {
    honesty: [
        { en: 'sly and greedy', ru: 'хитрый и жадный' },
        { en: 'scrupulously honest', ru: 'честный до щепетильности' },
    ],
    emotionality: [
        { en: 'fearless and detached', ru: 'бесстрашный и отстранённый' },
        { en: 'anxious and sentimental', ru: 'тревожный и чувствительный' },
    ],
    extraversion: [
        { en: 'withdrawn', ru: 'замкнутый' },
        { en: 'outgoing and bold', ru: 'общительный и смелый' },
    ],
    agreeableness: [
        { en: 'quick to anger, unforgiving', ru: 'вспыльчивый, не прощает' },
        { en: 'patient and forgiving', ru: 'терпеливый, прощает' },
    ],
    conscientiousness: [
        { en: 'careless and impulsive', ru: 'небрежный и импульсивный' },
        { en: 'diligent and careful', ru: 'усердный и аккуратный' },
    ],
    openness: [
        { en: 'conventional', ru: 'консервативный' },
        { en: 'curious and unconventional', ru: 'любознательный и необычный' },
    ],
};

/** Feminine Russian forms of the poles (the masculine ones above also serve an unknown gender). */
const HEXACO_POLES_RU_FEMININE: Record<HexacoAxis, [string, string]> = {
    honesty: ['хитрая и жадная', 'честная до щепетильности'],
    emotionality: ['бесстрашная и отстранённая', 'тревожная и чувствительная'],
    extraversion: ['замкнутая', 'общительная и смелая'],
    agreeableness: ['вспыльчивая, не прощает', 'терпеливая, прощает'],
    conscientiousness: ['небрежная и импульсивная', 'усердная и аккуратная'],
    openness: ['консервативная', 'любознательная и необычная'],
};

export function hexacoLabel(axis: HexacoAxis, lang: Lang): string {
    return pick(HEXACO_LABEL[axis], lang);
}

/** Pole words for a strong level (|level| ≥ 2 by default), '' for the middle; Russian in the character's gender. */
export function hexacoPole(axis: HexacoAxis, level: number, lang: Lang, threshold = 2, gender?: Gender): string {
    if (!Number.isFinite(level) || Math.abs(level) < threshold) return '';
    const pole = level > 0 ? 1 : 0;
    if (lang === 'ru' && gender === 'female') return HEXACO_POLES_RU_FEMININE[axis][pole];
    return pick(HEXACO_POLES[axis][pole], lang);
}

/* ------------------------------------------------------------------ appetites (§4.5) */

const APPETITE_KIND: Record<AppetiteKind, Word> = {
    flesh: { en: 'flesh and mating', ru: 'плоть и спаривание' },
    plunder: { en: 'plunder and captives', ru: 'добыча и пленники' },
    dominance: { en: "power over another's body", ru: 'власть над чужим телом' },
    cruelty: { en: 'cruelty', ru: 'жестокость' },
    hunger: { en: 'a creature hunger', ru: 'особый голод' },
    food: { en: 'food', ru: 'еда' },
    drink: { en: 'drink', ru: 'выпивка' },
    substance: { en: 'a substance', ru: 'вещество' },
    thrill: { en: 'thrill and risk', ru: 'азарт и риск' },
    luxury: { en: 'luxury and idleness', ru: 'роскошь и праздность' },
    adoration: { en: 'adoration and glory', ru: 'поклонение и слава' },
    other: { en: 'a craving', ru: 'другое' },
};

export function appetiteKindLabel(kind: AppetiteKind, lang: Lang): string {
    return pick(APPETITE_KIND[kind], lang);
}

/** Where an appetite comes from; English takes a possessive pronoun («his band's custom»). */
const APPETITE_SOURCE: Record<AppetiteSource, Word> = {
    individual: { en: '{pos} own craving', ru: 'личное' },
    species: { en: "{pos} kind's nature", ru: 'природа вида' },
    culture: { en: "{pos} band's custom", ru: 'обычай своих' },
    situation: { en: 'circumstance', ru: 'обстоятельства' },
    world: { en: 'a rule of this world', ru: 'правило мира' },
};

/** Possessive pronoun for English card lines. */
export function possessive(gender: Gender | undefined): string {
    return gender === 'female' ? 'her' : gender === 'male' ? 'his' : 'their';
}

export function appetiteSourceLabel(source: AppetiteSource, lang: Lang, gender?: Gender): string {
    return pick(APPETITE_SOURCE[source], lang).replace('{pos}', possessive(gender));
}

const ENDORSEMENT: Record<'proud' | 'torn' | 'fighting', Word> = {
    proud: { en: 'proud of it', ru: 'гордится' },
    torn: { en: 'torn about it', ru: 'раздираем' },
    fighting: { en: 'fights it', ru: 'борется' },
};

export function endorsementLabel(value: 'proud' | 'torn' | 'fighting', lang: Lang): string {
    return pick(ENDORSEMENT[value], lang);
}

const VOW: Record<'none' | 'moderate' | 'abstinent', Word> = {
    none: { en: 'no vow', ru: 'нет' },
    moderate: { en: 'keeps to a measure', ru: 'знает меру' },
    abstinent: { en: 'has sworn off it', ru: 'завязал' },
};

export function vowLabel(value: 'none' | 'moderate' | 'abstinent', lang: Lang): string {
    return pick(VOW[value], lang);
}

const VISIBILITY: Record<'open' | 'hidden' | 'secret', Word> = {
    open: { en: 'open', ru: 'открыто' },
    hidden: { en: 'hides it', ru: 'скрывает' },
    secret: { en: 'a secret', ru: 'тайна' },
};

export function visibilityLabel(value: 'open' | 'hidden' | 'secret', lang: Lang): string {
    return pick(VISIBILITY[value], lang);
}

const CLAIM: Record<Claim, Word> = {
    none: { en: 'no claim', ru: 'нет' },
    interest: { en: 'interested', ru: 'интерес' },
    claimed: { en: 'has staked a claim', ru: 'застолбил' },
    owned: { en: 'owns', ru: 'владеет' },
};

/** Claim word; Russian «застолбила» for a female character. */
export function claimLabel(value: Claim, lang: Lang, gender?: Gender): string {
    if (lang === 'ru' && gender === 'female' && value === 'claimed') return 'застолбила';
    return pick(CLAIM[value], lang);
}

/** Desirability 0 none … 5 overpowering (a tie's `want`), the sheet's words. */
const WANT: Word[] = [
    { en: 'none', ru: 'нет' },
    { en: 'barely', ru: 'едва' },
    { en: 'a little', ru: 'немного' },
    { en: 'noticeably', ru: 'заметно' },
    { en: 'strongly', ru: 'сильно' },
    { en: 'overpoweringly', ru: 'неодолимо' },
];

export function wantLabel(want: number, lang: Lang): string {
    return pick(WANT[index(want, 0, 5)], lang);
}

/** Corruption 0–10 in six steps (edges 1, 3, 5, 7, 10), the sheet's words; Russian in the character's gender. */
const CORRUPTION: Word[] = [
    { en: 'clean', ru: 'чист' },
    { en: 'keeps to principles', ru: 'держится принципов' },
    { en: 'excuses are habitual', ru: 'оправдания привычны' },
    { en: 'strangers are almost things', ru: 'чужие — почти вещи' },
    { en: 'the craving is part of who they are', ru: 'влечение — часть «я»' },
    { en: 'lost', ru: 'потерян' },
];
const CORRUPTION_EDGES = [1, 3, 5, 7, 10];

export function corruptionLabel(level: number, lang: Lang, gender?: Gender): string {
    const value = Number.isFinite(level) ? level : 0;
    const step = CORRUPTION_EDGES.filter((edge) => value >= edge).length;
    if (lang === 'ru' && gender === 'female' && (step === 0 || step === 5)) return step === 0 ? 'чиста' : 'потеряна';
    return pick(CORRUPTION[step], lang);
}

const ONSET: Record<AffectionOnset, Word> = {
    never: { en: 'never', ru: 'никогда' },
    rare: { en: 'rarely', ru: 'редко' },
    possible: { en: 'possibly', ru: 'возможно' },
    common: { en: 'often', ru: 'часто' },
};

export function onsetLabel(value: AffectionOnset, lang: Lang): string {
    return pick(ONSET[value], lang);
}

/* ------------------------------------------------------------------ ties, world, misc */

const TIE_INTENT: Record<TieIntent, Word> = {
    none: { en: 'nothing in particular', ru: 'ничего' },
    recruit: { en: 'recruit', ru: 'завербовать' },
    extract: { en: 'find things out', ru: 'выведать' },
    use: { en: 'use', ru: 'использовать' },
    avenge: { en: 'take revenge', ru: 'отомстить' },
    avoid: { en: 'avoid', ru: 'избегать' },
    protect: { en: 'protect', ru: 'защитить' },
    seduce: { en: 'seduce', ru: 'соблазнить' },
    court: { en: 'court', ru: 'ухаживать' },
};

export function tieIntentLabel(intent: TieIntent, lang: Lang): string {
    return pick(TIE_INTENT[intent], lang);
}

const WORLD_TONE: Record<WorldTone, Word> = {
    hostile: { en: 'hostile', ru: 'враждебный' },
    indifferent: { en: 'indifferent', ru: 'безразличный' },
    neutral: { en: 'neutral', ru: 'нейтральный' },
    welcoming: { en: 'welcoming', ru: 'радушный' },
};

export function worldToneLabel(tone: WorldTone, lang: Lang): string {
    return pick(WORLD_TONE[tone], lang);
}

/** Bandura's mechanisms as a stock line of self-talk (used when no story words are known). */
const JUSTIFICATION: Record<Justification, Word> = {
    'moral-justification': { en: 'it serves a higher cause', ru: 'это ради высшей цели' },
    euphemism: { en: 'calls it by a softer name', ru: 'называет это мягким словом' },
    comparison: { en: 'others do far worse', ru: 'другие делают куда хуже' },
    displacement: { en: 'orders are orders', ru: 'приказ есть приказ' },
    diffusion: { en: 'everyone does it', ru: 'все так делают' },
    minimizing: { en: 'it is no great harm', ru: 'большого вреда нет' },
    dehumanization: { en: 'they are not really people', ru: 'они не совсем люди' },
    blame: { en: 'they brought it on themselves', ru: 'сами виноваты' },
};

export function justificationLabel(value: Justification, lang: Lang): string {
    return pick(JUSTIFICATION[value], lang);
}

const COPING: Record<Coping, Word> = {
    surrender: { en: 'gives in', ru: 'сдаётся' },
    avoid: { en: 'avoids', ru: 'избегает' },
    overcompensate: { en: 'attacks', ru: 'идёт в атаку' },
};

export function copingLabel(value: Coping, lang: Lang): string {
    return pick(COPING[value], lang);
}

const ARC_STAGE: Record<ArcStage, Word> = {
    intact: { en: 'the lie holds', ru: 'ложь цела' },
    cracking: { en: 'cracking', ru: 'трещина' },
    glimpsed: { en: 'truth glimpsed', ru: 'правда увидена' },
    embraced: { en: 'truth embraced', ru: 'принята' },
    rejected: { en: 'truth rejected', ru: 'отвергнута' },
};

export function arcStageLabel(value: ArcStage, lang: Lang): string {
    return pick(ARC_STAGE[value], lang);
}

const LOD: Record<Lod, Word> = {
    sketch: { en: 'sketch', ru: 'Эскиз' },
    draft: { en: 'draft', ru: 'Набросок' },
    portrait: { en: 'portrait', ru: 'Портрет' },
};

export function lodLabel(value: Lod, lang: Lang): string {
    return pick(LOD[value], lang);
}

const ORIGIN: Record<Origin, Word> = {
    author: { en: 'author', ru: 'автор' },
    inferred: { en: 'from the card, no quote', ru: 'из карточки, без цитаты' },
    generated: { en: 'generated', ru: 'дописано' },
    story: { en: 'story', ru: 'история' },
    user: { en: 'your edit', ru: 'твоя правка' },
};

export function originLabel(value: Origin, lang: Lang): string {
    return pick(ORIGIN[value], lang);
}
