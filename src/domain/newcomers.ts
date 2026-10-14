// What the story showed about new faces (docs/model.md §10.2 «Эскиз по истории»): who a face is to the player's
// character (kin, a partner, a servant, a master, a friend, a rival, an enemy, someone met before, a stranger), their
// role, kind and groups — from the turn pass's `newcomers` (no extra request), or, when no pass read the reply
// (economy, a skipped turn), from cheap word heuristics: kinship, partner, servant and master words next to the name
// in the chat or in DES details. Kept per chat (GeneratorState.facts); the generator sketches, grounds and promotes a
// face around them, never against them.
// Also the provenance rules of what the generator invents: a 'dice', 'template' or 'default' field is a provisional
// guess the story and a promotion may replace ('grounded': a model wrote it from the story — no guess any more); a
// field the generator wrote at all ('generated') yields to the story when a reply plays the character otherwise
// (drift, §8). Pure.
import { PLAYER_RELATIONS } from './model';
import type { AppetiteRule, CharacterProfile, ChatState, NewcomerFacts, PlayerRelation, Stance } from './model';
import { isInflectionOf, matchName, normalizeName } from './presence';
import { LIMITS, cleanList, cleanText, isProtected, metaAt, oneOf, textKey } from './profile-defaults';
import type { Lang } from './role-priors';

/* ------------------------------------------------------------------ provenance of invented fields */

/** A field drawn by the generator's dice (values, temperament, drives, the stance of a stranger…). */
export const DICE_SOURCE = 'dice';
/** A field written from a role template: a placeholder that a draft or a portrait may replace. */
export const TEMPLATE_SOURCE = 'template';
/** A mild default the generator put where nothing was known (the stance of a face whose tie is not clear yet). */
export const DEFAULT_SOURCE = 'default';
/** A value taken from the card's world rules (an appetite rule's implication for the player). */
export const WORLD_SOURCE = 'world';
/** A value taken from the player's reputation among the face's groups. */
export const REPUTATION_SOURCE = 'reputation';
/** A value a model wrote from the story for a face the story brought in (a grounded promotion or rebuild). */
export const GROUNDED_SOURCE = 'grounded';
/** Sources that mark a provisional guess: the story and a promotion may replace it. */
export const PROVISIONAL_SOURCES: readonly string[] = [DICE_SOURCE, TEMPLATE_SOURCE, DEFAULT_SOURCE];

/**
 * Is the field a provisional guess of the generator (dice, a template, a default)? Locked fields and the user's edits
 * never are. An older sketch's draw carries no sources: on a sketch, every generated field is a guess. With
 * `everyGenerated` (the repair of a dice-made face) any generated field counts.
 */
export function isProvisional(profile: CharacterProfile, path: string, everyGenerated = false): boolean {
    if (isProtected(profile, path)) return false;
    const meta = metaAt(profile, path);
    if (!meta || meta.origin !== 'generated') return false;
    if (everyGenerated) return true;
    if (meta.sources?.some((source) => PROVISIONAL_SOURCES.includes(source))) return true;
    return !meta.sources?.length && profile.lod === 'sketch';
}

/**
 * Did the generator invent the field (origin 'generated', unlocked, not the user's)? A reply that plays the character
 * against an invented field shows the story's version of it: the story wins (drift on invented profiles, §8).
 */
export function isInvented(profile: CharacterProfile | undefined, path: string): boolean {
    if (!profile || isProtected(profile, path)) return false;
    return metaAt(profile, path)?.origin === 'generated';
}

/* ------------------------------------------------------------------ relations */

/** The stance a relation stands for when the story gives no number (null: the dice or a default decide). */
export const RELATION_STANCE: Readonly<Record<PlayerRelation, Stance | null>> = {
    family: 1,
    partner: 2,
    friend: 1,
    servant: 0,
    master: 0,
    acquaintance: 0,
    rival: -1,
    enemy: -2,
    stranger: null,
    unknown: null,
};

/** A relation in words, for a reason when the story gave none. */
const RELATION_WORDS: Readonly<Record<PlayerRelation, { en: string; ru: string }>> = {
    family: { en: 'family', ru: 'родня' },
    partner: { en: 'a partner', ru: 'близкий человек' },
    friend: { en: 'a friend', ru: 'друг' },
    servant: { en: 'in service', ru: 'в услужении' },
    master: { en: 'in charge', ru: 'стоит выше' },
    acquaintance: { en: 'met before', ru: 'знакомы' },
    rival: { en: 'a rival', ru: 'соперник' },
    enemy: { en: 'an enemy', ru: 'враг' },
    stranger: { en: 'a stranger', ru: 'чужак' },
    unknown: { en: 'not clear yet', ru: 'ещё не ясно' },
};

export function relationWords(relation: PlayerRelation, lang: Lang): string {
    return RELATION_WORDS[relation][lang];
}

/** The relation is known and is not «a stranger»: the story tied the face to the player. */
export function storyRelation(relation: PlayerRelation | undefined): boolean {
    return !!relation && relation !== 'unknown' && relation !== 'stranger';
}

/** Words of group labels each relation implies membership in (a family scenario's «family members»). */
const RELATION_CLASS_WORDS: Partial<Record<PlayerRelation, readonly string[]>> = {
    family: [
        'famil*',
        'relative*',
        'kin',
        'kinsfolk',
        'kinfolk',
        'household*',
        'семья',
        'семьи',
        'семье',
        'семью',
        'семьей',
        'семей',
        'семейств*',
        'семейн*',
        'родн*',
        'родственн*',
        'домочадц*',
    ],
    servant: ['servant*', 'slave*', 'maid*', 'thrall*', 'serf*', 'слуг*', 'служанк*', 'прислуг*', 'раб*', 'невольн*'],
    master: ['master*', 'owner*', 'mistress*', 'хозя*', 'господ*', 'госпож*', 'владел*'],
    partner: ['spouse*', 'wife', 'wives', 'husband*', 'lover*', 'супруг*', 'жены', 'жен', 'мужья', 'любовни*'],
};

function inWords(token: string, list: readonly string[]): boolean {
    return list.some((word) => (word.endsWith('*') ? token.startsWith(word.slice(0, -1)) : token === word));
}

function wordsOf(text: string): string[] {
    return normalizeName(text)
        .split(/[\s-]+/)
        .filter(Boolean);
}

/** Group labels of the world a relation implies («family» → «family members», «Все члены семьи»). */
export function relationGroups(relation: PlayerRelation | undefined, groups: readonly string[]): string[] {
    const words = relation ? RELATION_CLASS_WORDS[relation] : undefined;
    if (!words) return [];
    return groups.filter((group) => wordsOf(group).some((word) => inWords(word, words)));
}

/** The world's groups say kin are the cast: kinship words in the story then mean the household. */
export function familyWorld(groups: readonly string[]): boolean {
    return relationGroups('family', groups).length > 0;
}

/**
 * The groups and classes of this world, by name, for the prompts: the holders and target classes of the appetite
 * rules, the groups and places of the reputation, the group profiles. '*' and duplicates are dropped.
 */
export function worldGroups(
    rules: readonly AppetiteRule[],
    reputation: readonly { among: string }[],
    profiles: readonly Pick<CharacterProfile, 'kind' | 'name'>[] = [],
    max = 24,
): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (label: string | undefined) => {
        const clean = cleanText(label, LIMITS.name);
        const key = textKey(clean);
        if (!clean || clean === '*' || seen.has(key)) return;
        seen.add(key);
        out.push(clean);
    };
    for (const rule of rules) {
        add(rule.holders);
        if (rule.target.mode === 'class') add(rule.target.class);
    }
    for (const entry of reputation) add(entry.among);
    for (const profile of profiles) if (profile.kind === 'group') add(profile.name);
    return out.slice(0, max);
}

/* ------------------------------------------------------------------ facts kept per chat */

/** Facts kept per chat (oldest dropped first). */
export const FACTS_CAP = 60;

/** The facts a chat keeps (an older state has none). */
export function factsOf(state: Pick<ChatState, 'generator'>): NewcomerFacts[] {
    const list = state.generator?.facts;
    return Array.isArray(list) ? list.filter((item) => !!item && typeof item.name === 'string') : [];
}

/** The newest facts about a face: by its id, else by any of its names. */
export function factsFor(
    list: readonly NewcomerFacts[],
    who: { id?: string; name: string; aliases?: string[] },
): NewcomerFacts | undefined {
    const named = { id: '_', name: who.name, aliases: who.aliases ?? [] };
    for (let i = list.length - 1; i >= 0; i--) {
        const facts = list[i]!;
        if (who.id && facts.id === who.id) return facts;
        if (normalizeName(facts.name) === normalizeName(who.name)) return facts;
        if (matchName(facts.name, [named], { strict: true })) return facts;
    }
    return undefined;
}

function union(a: readonly string[] = [], b: readonly string[] = []): string[] {
    const out: string[] = [];
    for (const item of [...a, ...b]) if (item && !out.some((other) => textKey(other) === textKey(item))) out.push(item);
    return out;
}

/**
 * Newer facts over older ones about the same face: a relation the newer facts do not know keeps the older one (and its
 * stance and words), a heuristic guess never replaces what the turn pass read; groups add up.
 */
export function mergeFacts(old: NewcomerFacts | undefined, fresh: NewcomerFacts): NewcomerFacts {
    if (!old) return fresh;
    const keepRelation =
        fresh.relation === 'unknown' ||
        (fresh.source === 'heuristic' && old.source === 'turn' && old.relation !== 'unknown');
    const relation = keepRelation ? old : fresh;
    const out: NewcomerFacts = {
        name: fresh.name || old.name,
        relation: relation.relation,
        source: relation.source,
        turn: Math.max(old.turn, fresh.turn),
    };
    const id = fresh.id ?? old.id;
    if (id) out.id = id;
    const role = fresh.role || old.role;
    if (role) out.role = role;
    const species = fresh.species || old.species;
    if (species) out.species = species;
    const note = relation.relationNote || (keepRelation ? fresh.relationNote : old.relationNote);
    if (note) out.relationNote = note;
    const hint = relation.stanceHint ?? (keepRelation ? fresh.stanceHint : undefined);
    if (hint !== undefined) out.stanceHint = hint;
    const why = relation.reason || (keepRelation ? fresh.reason : undefined);
    if (why) out.reason = why;
    const groups = union(old.groups, fresh.groups);
    if (groups.length) out.groups = groups;
    return out;
}

/** The chat keeps these facts (merged into what it knew about the same faces), capped. Mutates the state. */
export function recordFacts(state: ChatState, fresh: readonly NewcomerFacts[]): void {
    if (!fresh.length) return;
    let list = factsOf(state);
    for (const facts of fresh) {
        const at = list.findIndex(
            (item) =>
                (facts.id && item.id === facts.id) ||
                normalizeName(item.name) === normalizeName(facts.name) ||
                !!matchName(facts.name, [{ id: '_', name: item.name, aliases: [] }], { strict: true }),
        );
        const merged = mergeFacts(at >= 0 ? list[at] : undefined, facts);
        list = at >= 0 ? [...list.slice(0, at), ...list.slice(at + 1), merged] : [...list, merged];
    }
    state.generator = { ...(state.generator ?? { dismissed: [] }), facts: list.slice(-FACTS_CAP) };
}

/** One newcomer as the turn pass reports it (turn-prompt.ts TurnNewcomerOut, structurally). */
export interface NewcomerReport {
    name: string;
    role: string;
    species: string;
    relation: string;
    relationNote: string;
    stanceHint: number | null;
    reason: string;
    groups: string[];
}

/**
 * The turn pass's newcomers as facts of this turn: names resolved to profiles where they have one, relations checked,
 * groups kept only when the prompt listed them (`known`, matched loosely; none listed: as given).
 */
export function factsFromTurn(
    reports: readonly NewcomerReport[],
    turn: number,
    resolve: (name: string) => string | null = () => null,
    known: readonly string[] = [],
): NewcomerFacts[] {
    const out: NewcomerFacts[] = [];
    for (const report of reports) {
        const name = cleanText(report.name, LIMITS.name);
        if (!name) continue;
        const facts: NewcomerFacts = {
            name,
            relation: oneOf(PLAYER_RELATIONS, report.relation, 'unknown'),
            source: 'turn',
            turn,
        };
        const id = resolve(name);
        if (id) facts.id = id;
        const role = cleanText(report.role, LIMITS.name);
        if (role) facts.role = role;
        const species = cleanText(report.species, LIMITS.name);
        if (species) facts.species = species;
        const note = cleanText(report.relationNote, LIMITS.name);
        if (note) facts.relationNote = note;
        if (typeof report.stanceHint === 'number' && Number.isInteger(report.stanceHint)) {
            facts.stanceHint = Math.max(-3, Math.min(3, report.stanceHint)) as Stance;
        }
        const reason = cleanText(report.reason, LIMITS.short);
        if (reason) facts.reason = reason;
        const groups = cleanList(report.groups, 8, LIMITS.name)
            .map((group) => (known.length ? known.find((item) => sameLabel(item, group)) : group))
            .filter((group): group is string => !!group);
        if (groups.length) facts.groups = union(groups);
        out.push(facts);
    }
    return out;
}

function sameLabel(a: string, b: string): boolean {
    const x = textKey(a);
    const y = textKey(b);
    return x === y || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)));
}

/* ------------------------------------------------------------------ word heuristics (economy, no pass) */

interface KinWord {
    relation: PlayerRelation;
    label: { en: string; ru: string };
    words: readonly string[];
}

/** Kinship, partner, servant and master words (Russian forms and stems, English words; a trailing * is a prefix). */
const KIN_WORDS: readonly KinWord[] = [
    { relation: 'family', label: { en: 'daughter', ru: 'дочь' }, words: ['доч*', 'daughter*'] },
    {
        relation: 'family',
        label: { en: 'son', ru: 'сын' },
        words: ['сын', 'сына', 'сыну', 'сыном', 'сыне', 'сыновья', 'сыновей', 'сынок', 'сынишк*', 'son', 'sons'],
    },
    {
        relation: 'family',
        label: { en: 'mother', ru: 'мать' },
        words: [
            'мать',
            'матери',
            'матерью',
            'мама',
            'мамы',
            'маме',
            'маму',
            'мамой',
            'мамочк*',
            'матушк*',
            'mother*',
            'mom',
            'mum',
            'mommy',
            'mummy',
            'mama',
        ],
    },
    {
        relation: 'family',
        label: { en: 'father', ru: 'отец' },
        words: [
            'отец',
            'отца',
            'отцу',
            'отцом',
            'отце',
            'папа',
            'папы',
            'папе',
            'папу',
            'папой',
            'папочк*',
            'батюшк*',
            'father*',
            'dad',
            'daddy',
            'papa',
        ],
    },
    { relation: 'family', label: { en: 'sister', ru: 'сестра' }, words: ['сестр*', 'сестер', 'sister*'] },
    {
        relation: 'family',
        label: { en: 'brother', ru: 'брат' },
        words: ['брат', 'брата', 'брату', 'братом', 'брате', 'братья', 'братьев', 'братик*', 'brother*'],
    },
    {
        relation: 'family',
        label: { en: 'aunt', ru: 'тётя' },
        words: ['тетя', 'тети', 'тете', 'тетю', 'тетей', 'тетушк*', 'aunt*'],
    },
    {
        relation: 'family',
        label: { en: 'uncle', ru: 'дядя' },
        words: ['дядя', 'дяди', 'дяде', 'дядю', 'дядей', 'дядюшк*', 'uncle*'],
    },
    { relation: 'family', label: { en: 'cousin', ru: 'кузина' }, words: ['кузин*', 'кузен*', 'cousin*'] },
    {
        relation: 'family',
        label: { en: 'grandmother', ru: 'бабушка' },
        words: ['бабушк*', 'бабул*', 'grandmother*', 'grandma*', 'granny'],
    },
    {
        relation: 'family',
        label: { en: 'grandfather', ru: 'дедушка' },
        words: ['дедушк*', 'дед', 'деда', 'деду', 'дедом', 'grandfather*', 'grandpa*'],
    },
    {
        relation: 'family',
        label: { en: 'grandchild', ru: 'внук' },
        words: ['внучк*', 'внук', 'внука', 'внуку', 'внуком', 'внуки', 'granddaughter*', 'grandson*', 'grandchild*'],
    },
    {
        relation: 'family',
        label: { en: 'relative', ru: 'родственница' },
        words: [
            'племянниц*',
            'племянник*',
            'падчериц*',
            'пасын*',
            'мачех*',
            'отчим*',
            'niece*',
            'nephew*',
            'stepdaughter*',
            'stepson*',
            'stepmother*',
            'stepfather*',
            'stepsister*',
            'stepbrother*',
            'sibling*',
        ],
    },
    {
        relation: 'partner',
        label: { en: 'wife', ru: 'жена' },
        words: ['жена', 'жены', 'жене', 'жену', 'женой', 'женушк*', 'супруг*', 'wife', 'wives', 'spouse*'],
    },
    {
        relation: 'partner',
        label: { en: 'husband', ru: 'муж' },
        words: ['муж', 'мужа', 'мужу', 'мужем', 'муже', 'husband*'],
    },
    {
        relation: 'partner',
        label: { en: 'lover', ru: 'возлюбленная' },
        words: [
            'невест*',
            'жених*',
            'любовниц*',
            'любовник*',
            'fiance*',
            'bride*',
            'lover*',
            'girlfriend*',
            'boyfriend*',
        ],
    },
    {
        relation: 'servant',
        label: { en: 'maid', ru: 'служанка' },
        words: ['служанк*', 'горничн*', 'прислуг*', 'maid*', 'handmaid*', 'housemaid*'],
    },
    {
        relation: 'servant',
        label: { en: 'servant', ru: 'слуга' },
        words: ['слуга', 'слуги', 'слуге', 'слугу', 'слугой', 'слуг', 'servant*', 'butler*', 'valet*'],
    },
    {
        relation: 'servant',
        label: { en: 'slave', ru: 'рабыня' },
        words: [
            'раб',
            'раба',
            'рабу',
            'рабом',
            'рабы',
            'рабов',
            'рабын*',
            'невольниц*',
            'невольник*',
            'наложниц*',
            'slave*',
            'concubine*',
            'thrall*',
        ],
    },
    {
        relation: 'master',
        label: { en: 'master', ru: 'хозяйка' },
        words: [
            'хозяйк*',
            'хозяин',
            'хозяина',
            'хозяину',
            'хозяином',
            'госпож*',
            'господин',
            'господина',
            'господину',
            'господином',
            'владелиц*',
            'повелител*',
            'mistress*',
            'master',
            'owner*',
            'landlady*',
            'landlord*',
        ],
    },
];

/** First and second person possessives: the player's (narration says «твоя», the player says «моя»). */
const PLAYER_POSSESSIVES = new Set([
    'мой',
    'моя',
    'мое',
    'мою',
    'моей',
    'моего',
    'моему',
    'моим',
    'моих',
    'мои',
    'твой',
    'твоя',
    'твое',
    'твою',
    'твоей',
    'твоего',
    'твоему',
    'твоим',
    'твоих',
    'твои',
    'наш',
    'наша',
    'наше',
    'нашу',
    'нашей',
    'нашего',
    'наши',
    'ваш',
    'ваша',
    'ваше',
    'вашу',
    'вашей',
    'вашего',
    'my',
    'your',
    'our',
]);
/** Third person possessives: someone else's. */
const OTHER_POSSESSIVES = new Set(['его', 'ее', 'их', 'his', 'her', 'their']);

interface WordToken {
    raw: string;
    norm: string;
    capitalized: boolean;
}

function tokens(text: string): WordToken[] {
    const out: WordToken[] = [];
    for (const match of text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu)) {
        const raw = match[0];
        const first = raw.charAt(0);
        out.push({
            raw,
            norm: raw.toLowerCase().replace(/ё/g, 'е'),
            capitalized: first !== first.toLowerCase(),
        });
    }
    return out;
}

/** Does a token name someone with these name words (exact or an inflected Russian form)? */
function namesWith(token: WordToken | undefined, nameWords: readonly string[]): boolean {
    if (!token) return false;
    const norm = token.norm.replace(/['’]s$/, '');
    return nameWords.some((word) => norm === word || isInflectionOf(norm, word, false, token.capitalized));
}

const SENTENCE_RE = /(?<=[.!?…])\s+|\n+/u;
/** "John's": an English possessive. */
const POSSESSIVE_RE = /['’]s$/;
/** How far a kinship word may stand from the name (words). */
const KIN_WINDOW = 3;

export interface HeuristicContext {
    /** The player's character name: «дочь Курьера» is his. */
    playerName?: string;
    /** The world's group labels (worldGroups): a family-ish class makes kin in the story the household. */
    groups?: readonly string[];
    lang?: Lang;
}

/**
 * Cheap facts from words (economy, no turn pass): a kinship, partner, servant or master word next to the name in the
 * texts (chat messages, DES details) — «Лиза, твоя сестра», «дочь Джона Лиза», "my maid Anna", "John's daughter". The
 * relation counts when the word is the player's («твоя», «моя», his name) or, for kin, when the world's groups make
 * kin the household (a family scenario); otherwise the role and the words are kept and the relation stays unknown.
 * Null when no word is near the name.
 */
export function heuristicFacts(
    name: string,
    texts: readonly string[],
    ctx: HeuristicContext = {},
): Omit<NewcomerFacts, 'turn'> | null {
    const nameWords = wordsOf(name).filter((word) => word.length >= 2);
    if (!nameWords.length) return null;
    const playerWords = wordsOf(ctx.playerName ?? '').filter((word) => word.length >= 2);
    const lang = ctx.lang ?? 'ru';
    const family = familyWorld(ctx.groups ?? []);
    let best: { facts: Omit<NewcomerFacts, 'turn'>; score: number } | null = null;
    for (const text of texts) {
        for (const sentence of String(text ?? '').split(SENTENCE_RE)) {
            const list = tokens(sentence);
            const at = list.findIndex((token) => namesWith(token, nameWords));
            if (at < 0) continue;
            const named = list[at]!;
            const exact = nameWords.includes(named.norm);
            for (let k = Math.max(0, at - KIN_WINDOW); k <= Math.min(list.length - 1, at + KIN_WINDOW); k++) {
                if (k === at) continue;
                const kin = KIN_WORDS.find((entry) => inWords(list[k]!.norm, entry.words));
                if (!kin) continue;
                // «мама Лизы», "Lisa's mother": the name owns the word, the word is someone else.
                if (k + 1 === at && !exact) continue;
                if (k - 1 === at && POSSESSIVE_RE.test(named.norm)) continue;
                const before = k - 1 !== at ? list[k - 1] : undefined;
                const after = k + 1 !== at ? list[k + 1] : undefined;
                const ownedBefore = !!before && POSSESSIVE_RE.test(before.norm);
                const player =
                    (!!before && PLAYER_POSSESSIVES.has(before.norm)) ||
                    (playerWords.length > 0 &&
                        (namesWith(after, playerWords) || (ownedBefore && namesWith(before, playerWords))));
                const other =
                    !player &&
                    ((!!before && OTHER_POSSESSIVES.has(before.norm)) ||
                        ownedBefore ||
                        (!!after && after.capitalized && !namesWith(after, nameWords)));
                const from =
                    before && (PLAYER_POSSESSIVES.has(before.norm) || OTHER_POSSESSIVES.has(before.norm) || ownedBefore)
                        ? k - 1
                        : k;
                const to = after && (namesWith(after, playerWords) || (after.capitalized && other)) ? k + 1 : k;
                const note = list
                    .slice(from, to + 1)
                    .map((token) => token.raw)
                    .join(' ');
                const relation: PlayerRelation = player
                    ? kin.relation
                    : kin.relation === 'family' && family
                      ? 'family'
                      : 'unknown';
                const facts: Omit<NewcomerFacts, 'turn'> = {
                    name,
                    relation,
                    role: kin.label[lang],
                    relationNote: note,
                    source: 'heuristic',
                };
                const score = (relation !== 'unknown' ? 2 : 0) + (player ? 1 : 0);
                if (!best || score > best.score) best = { facts, score };
            }
        }
    }
    return best?.facts ?? null;
}
