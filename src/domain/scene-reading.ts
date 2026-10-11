// Reading a reply's narration for who leaves the scene and who is (still, again) in it (docs/model.md §6.4). Code,
// not AI, and deliberately cautious — a wrong «left» is undone by the next line they speak, a wrong «back» brings a
// character into a scene they left:
// - speech is set aside first (quotes, dash dialogue): talking about leaving is not leaving, a name in someone's line
//   is not that person acting;
// - a mention is a character's name (presence.ts rules: exact, or a Russian case form from the left word boundary —
//   «Лизу», never «близко»); a subject is a mention in the nominative (Russian: the exact form, not after a
//   preposition) or in a subject's place (English: at a clause start, after «and», «then», a speech verb…, never a
//   possessive), or «она / он / she / he» that clearly means one character: the nearest one of that gender looking
//   back (its sentence, then 3 more), with no other of that gender as near and none of unknown gender nearer;
// - an exit verb (ушла, вышел из комнаты, скрылась, направилась прочь, the door closed behind her; left the room,
//   walked out, vanished) with a subject of a matching gender takes them out — the nearest subject before the verb in
//   its clause, then in its sentence, then right after it («ушла Лиза»); «не ушла», «ушла бы», «чтобы ушла», «would
//   leave» do not count, nor «ушла в себя», «вышла замуж», «вышла вперёд»;
// - an entry verb (вернулась, вошёл, появилась; came back, walked in) brings them in; any other sentence with them as
//   the subject keeps them in — unless it is a question or speaks of elsewhere, of the future or of thoughts («где-то»,
//   «тем временем», «вспомнил», «скоро»; meanwhile, remembered, will);
// - per character the last of these in the reply wins.
// Pure.
import { PLAYER_ID } from './model';
import { isInflectionOf, nameVariants, normalizeName } from './presence';
import type { NamedProfile } from './presence';

export type Evidence = 'exit' | 'enter' | 'act';

export interface SceneEvidence {
    kind: Evidence;
    /** By the character's name (false: through a pronoun). */
    named: boolean;
}

/** Profiles as the reading needs them: names and the grammatical gender. */
export type ReadProfile = NamedProfile & { gender?: 'female' | 'male' };

type Gn = 'f' | 'm' | 'pl' | null;

interface Word {
    /** Lower case, ё → е, apostrophes dropped: verbs and small words. */
    low: string;
    /** normalizeName of the word without a possessive: names. */
    norm: string;
    capitalized: boolean;
    possessive: boolean;
    sentence: number;
    clause: number;
    /** What stands between the previous word and this one (spaces trimmed). */
    gap: string;
    cyrillic: boolean;
}

interface Mention {
    id: string;
    /** First and last word index. */
    at: number;
    end: number;
    /** The nominative / plain form (not inflected, not a possessive). */
    exact: boolean;
}

interface Subject {
    id: string;
    at: number;
    named: boolean;
}

/* ------------------------------------------------------------------ speech set aside */

/** Quoted spans, innermost first (nested quotes): «…», “…”, „…“, "…" on one line. */
const QUOTE_RES = [/«[^«»]*»/g, /„[^„“”]*[“”]/g, /“[^“”]*”/g, /"[^"\n]*"/g];

/** A placeholder for a line of speech: a sentence end when the line ended one, else a clause break. */
function placeholder(speech: string): string {
    return /[.!?…][\s»"”“]*$/u.test(speech) ? ' . ' : ' , ';
}

/** A dialogue line opened by a dash: speech and the author's words alternate between « — ». */
function dashLine(line: string): string {
    if (!/^\s*[—–-]\s*\S/.test(line)) return line;
    const body = line.replace(/^\s*[—–-]\s*/, '');
    return body
        .split(/\s+[—–]\s+|\s+-\s+/)
        .map((part, index) => (index % 2 === 0 ? placeholder(part) : part))
        .join(' ');
}

/** The narration of a text: speech replaced by punctuation, so that «"Bye," she said» keeps «she said». */
export function narrationOnly(text: string): string {
    let out = String(text ?? '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map(dashLine)
        .join('\n');
    for (const re of QUOTE_RES) {
        for (let guard = 0; guard < 5; guard++) {
            const next = out.replace(re, (speech) => placeholder(speech.slice(0, -1)));
            if (next === out) break;
            out = next;
        }
    }
    return out;
}

/* ------------------------------------------------------------------ words */

const CYRILLIC_RE = /\p{Script=Cyrillic}/u;

function isCapitalized(raw: string): boolean {
    const first = raw.charAt(0);
    return first !== '' && first === first.toUpperCase() && first !== first.toLowerCase();
}

function lowOf(raw: string): string {
    return raw.toLowerCase().replace(/ё/g, 'е').replace(/['’]/g, '');
}

/** Words with their sentence and clause numbers; `questions`: sentences that end in «?». */
function wordsOf(text: string): { words: Word[]; questions: Set<number> } {
    const words: Word[] = [];
    const questions = new Set<number>();
    let sentence = 0;
    let clause = 0;
    let last = 0;
    const close = (gap: string) => {
        if (gap.includes('?')) questions.add(sentence);
    };
    for (const match of text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu)) {
        const raw = match[0];
        const start = match.index ?? 0;
        const between = text.slice(last, start);
        last = start + raw.length;
        if (words.length) {
            if (/[.!?…\n]/.test(between)) {
                close(between);
                sentence++;
                clause++;
            } else if (/[,;:—–()[\]«»"“”„]|\s-\s/.test(between)) {
                clause++;
            }
        }
        const possessive = /['’]s$/i.test(raw);
        const bare = possessive ? raw.slice(0, -2) : raw;
        words.push({
            low: lowOf(raw),
            norm: normalizeName(bare),
            capitalized: isCapitalized(raw),
            possessive,
            sentence,
            clause,
            gap: between.trim(),
            cyrillic: CYRILLIC_RE.test(raw),
        });
    }
    close(text.slice(last));
    return { words, questions };
}

/* ------------------------------------------------------------------ names */

/** Small words that never identify anyone on their own (as presence.ts). */
const STOP_WORDS = new Set(['the', 'old', 'young', 'lady', 'sir', 'and', 'of', 'старый', 'старая', 'молодой', 'юная']);

interface NameEntry {
    id: string;
    /** Words of one name, normalised. */
    words: string[];
    /** The name is written with capitals: only capitalised words of the text are read as it. */
    capital: boolean;
    /** A group needs its whole name. */
    whole: boolean;
}

function entriesOf(profile: ReadProfile): NameEntry[] {
    const group = profile.kind === 'group';
    const out: NameEntry[] = [];
    for (const variant of nameVariants(profile)) {
        const raw = variant.split(/[\s-]+/).filter(Boolean);
        const capital = raw.filter(isCapitalized);
        const chosen = (group ? raw : capital.length ? capital : raw)
            .map(normalizeName)
            .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
        if (chosen.length)
            out.push({ id: profile.id, words: chosen, capital: !group && capital.length > 0, whole: group });
    }
    return out;
}

function wordMatches(word: Word, base: string, exactWords: ReadonlySet<string>): 0 | 1 | 2 {
    if (word.norm === base) return word.possessive ? 1 : 2;
    if (exactWords.has(word.norm)) return 0;
    return isInflectionOf(word.norm, base, false, word.capitalized) ? 1 : 0;
}

/** Every mention of a profile (or of the player, as PLAYER_ID) in the words; two equally good matches give none. */
function mentionsOf(words: readonly Word[], entries: readonly NameEntry[]): Mention[] {
    const exactWords = new Set(entries.flatMap((entry) => entry.words));
    const out: Mention[] = [];
    for (let i = 0; i < words.length; i++) {
        let best = 0;
        let ids: string[] = [];
        let span = 1;
        for (const entry of entries) {
            let score = 0;
            let length = 1;
            if (entry.whole) {
                if (i + entry.words.length > words.length) continue;
                const scores = entry.words.map((base, j) => wordMatches(words[i + j]!, base, exactWords));
                if (scores.some((item) => item === 0)) continue;
                score = scores.every((item) => item === 2) ? 2 : 1;
                length = entry.words.length;
            } else {
                const word = words[i]!;
                if (entry.capital && !word.capitalized) continue;
                for (const base of entry.words) score = Math.max(score, wordMatches(word, base, exactWords));
            }
            if (score === 0 || score < best) continue;
            if (score > best) {
                best = score;
                ids = [entry.id];
                span = length;
            } else if (!ids.includes(entry.id)) {
                ids.push(entry.id);
            }
        }
        if (ids.length !== 1) continue;
        const id = ids[0]!;
        const previous = out[out.length - 1];
        // «Ильва Хольм»: the words of one name side by side are one mention.
        if (previous && previous.id === id && previous.end === i - 1 && !words[i]!.gap) {
            previous.end = i + span - 1;
            previous.exact &&= best === 2;
            i += span - 1;
            continue;
        }
        out.push({ id, at: i, end: i + span - 1, exact: best === 2 });
        i += span - 1;
    }
    return out;
}

/* ------------------------------------------------------------------ verbs */

const RU_EXIT: Record<string, Gn> = {
    ушел: 'm',
    ушла: 'f',
    ушли: 'pl',
    уходит: null,
    уходят: 'pl',
    покинул: 'm',
    покинула: 'f',
    покинули: 'pl',
    покидает: null,
    удалился: 'm',
    удалилась: 'f',
    удалились: 'pl',
    удаляется: null,
    скрылся: 'm',
    скрылась: 'f',
    скрылись: 'pl',
    исчез: 'm',
    исчезла: 'f',
    исчезли: 'pl',
    исчезает: null,
    отправился: 'm',
    отправилась: 'f',
    отправились: 'pl',
    уехал: 'm',
    уехала: 'f',
    уехали: 'pl',
    уезжает: null,
    ускакал: 'm',
    ускакала: 'f',
    ускакали: 'pl',
    убежал: 'm',
    убежала: 'f',
    убежали: 'pl',
    умчался: 'm',
    умчалась: 'f',
    умчались: 'pl',
    удрал: 'm',
    удрала: 'f',
    удрали: 'pl',
};

/** Exit verbs that need an «away» after them (вышла из комнаты, направился прочь) or nothing after them in the clause. */
const RU_EXIT_AIMED: Record<string, Gn> = {
    вышел: 'm',
    вышла: 'f',
    вышли: 'pl',
    направился: 'm',
    направилась: 'f',
    направились: 'pl',
};

const RU_ENTER: Record<string, Gn> = {
    вернулся: 'm',
    вернулась: 'f',
    вернулись: 'pl',
    возвращается: null,
    возвратился: 'm',
    возвратилась: 'f',
    вошел: 'm',
    вошла: 'f',
    вошли: 'pl',
    входит: null,
    пришел: 'm',
    пришла: 'f',
    пришли: 'pl',
    приходит: null,
    появился: 'm',
    появилась: 'f',
    появились: 'pl',
    появляется: null,
    ворвался: 'm',
    ворвалась: 'f',
    ворвались: 'pl',
    вбежал: 'm',
    вбежала: 'f',
    вбежали: 'pl',
    заглянул: 'm',
    заглянула: 'f',
    зашел: 'm',
    зашла: 'f',
    зашли: 'pl',
    заходит: null,
};

/** Words right after an aimed exit verb that make it a way out (вышла прочь / вон / наружу). */
const RU_AWAY_WORDS = new Set(['прочь', 'вон', 'наружу', 'восвояси', 'домой']);
/** «из …» after «вышла»: a room, a house, an inn. */
const RU_ROOM_STEMS = [
    'комнат',
    'зал',
    'дом',
    'изб',
    'таверн',
    'трактир',
    'кабинет',
    'кухн',
    'спальн',
    'помещени',
    'палатк',
    'шатр',
    'здани',
    'лавк',
    'хижин',
    'поко',
    'кают',
    'библиотек',
    'корчм',
    'бар',
    'гостин',
    'кабак',
    'харчевн',
    'мастерск',
    'кузниц',
    'сара',
    'подвал',
    'башн',
];
/** What makes «ушла / пришла …» something else: «ушла в себя», «вышла замуж», «пришла в ярость», «зашла за угол». */
const RU_NOT_AFTER: [string, string][] = [
    ['в', 'себ'],
    ['в', 'мысл'],
    ['в', 'воспомин'],
    ['в', 'работ'],
    ['в', 'сторон'],
    ['в', 'ярост'],
    ['в', 'ужас'],
    ['в', 'восторг'],
    ['в', 'голов'],
    ['с', 'голов'],
    ['от', 'ответ'],
    ['от', 'тем'],
    ['от', 'разговор'],
    ['от', 'вопрос'],
    ['под', 'вод'],
    ['к', 'вывод'],
    ['за', 'угол'],
    ['из', 'себ'],
    ['из', 'тен'],
    ['из', 'за'],
];
const RU_NOT_AFTER_WORDS = new Set(['замуж', 'вперед', 'навстречу']);
/** The word right before a verb that makes it not happen («не ушла», «почти ушла»). */
const RU_NOT = new Set(['не', 'почти', 'едва']);
/** Words a little before a verb (same clause) that make it unreal («ушла бы», «чтобы ушла», «будто ушла»). */
const RU_UNREAL = new Set(['бы', 'б', 'чтобы', 'чтоб', 'если', 'будто', 'словно']);
const RU_PREPOSITIONS = new Set([
    'в',
    'во',
    'на',
    'о',
    'об',
    'обо',
    'с',
    'со',
    'к',
    'ко',
    'у',
    'для',
    'без',
    'про',
    'за',
    'от',
    'ото',
    'до',
    'из',
    'над',
    'под',
    'перед',
    'при',
    'через',
    'по',
    'между',
    'возле',
    'около',
    'мимо',
    'вокруг',
    'кроме',
    'среди',
]);
const RU_PRONOUNS: Record<string, 'female' | 'male'> = { она: 'female', он: 'male' };
/** «за ней / ним / ними» after a closed door. */
const RU_BEHIND: Record<string, 'female' | 'male' | 'pl'> = { ней: 'female', нею: 'female', ним: 'male', ними: 'pl' };

/** English verb phrases (lower case, apostrophes dropped). */
const EN_EXIT: string[][] = [
    ...['walked', 'walks', 'stormed', 'storms', 'slipped', 'slips', 'headed', 'heads', 'hurried', 'hurries'].flatMap(
        (verb) => ['out', 'away', 'off'].map((away) => [verb, away]),
    ),
    ...['strode', 'strides', 'marched', 'marches', 'ran', 'runs', 'rode', 'rides', 'drove', 'drives'].flatMap((verb) =>
        ['out', 'away', 'off'].map((away) => [verb, away]),
    ),
    ...['went', 'goes'].flatMap((verb) => ['away', 'off', 'out', 'home'].map((away) => [verb, away])),
    ...['headed', 'heads', 'made', 'makes'].map((verb) => [verb, 'for', 'the', 'door']),
    ...['excused', 'excuses'].flatMap((verb) => ['herself', 'himself', 'themselves'].map((self) => [verb, self])),
    ['stepped', 'out'],
    ['steps', 'out'],
    ['backed', 'out'],
    ['ducked', 'out'],
    ['departed'],
    ['departs'],
    ['disappeared'],
    ['disappears'],
    ['vanished'],
    ['vanishes'],
    ['exited'],
    ['exits'],
    ['took', 'her', 'leave'],
    ['took', 'his', 'leave'],
    ['took', 'their', 'leave'],
    ['takes', 'her', 'leave'],
    ['takes', 'his', 'leave'],
    ['was', 'gone'],
    ['is', 'gone'],
];
const EN_ENTER: string[][] = [
    ['came', 'back'],
    ['comes', 'back'],
    ['came', 'in'],
    ['comes', 'in'],
    ['walked', 'in'],
    ['walks', 'in'],
    ['walked', 'back'],
    ['walks', 'back'],
    ['stepped', 'in'],
    ['steps', 'in'],
    ['burst', 'in'],
    ['bursts', 'in'],
    ['showed', 'up'],
    ['shows', 'up'],
    ['entered'],
    ['enters'],
    ['arrived'],
    ['arrives'],
    ['rejoined'],
    ['rejoins'],
    ['reappeared'],
    ['reappears'],
];
/** «returned» / «appeared» only as an entry: not «returned his gaze», not «appeared tired». */
const EN_RETURN = new Set(['returned', 'returns']);
const EN_APPEAR = new Set(['appeared', 'appears']);
const EN_DETERMINERS = new Set(['his', 'her', 'their', 'the', 'a', 'an', 'my', 'your', 'its', 'our', 'that', 'this']);
const EN_APPEAR_NEXT = new Set(['in', 'at', 'from', 'behind', 'beside', 'through', 'out', 'again', 'on', 'by', 'near']);
/** «left» / «leaves» as leaving: «left.», «left the room», «left without a word» — not «left the cup on the table». */
const EN_LEFT = new Set(['left', 'leaves']);
const EN_LEFT_NEXT = new Set([
    'without',
    'for',
    'through',
    'via',
    'quickly',
    'silently',
    'quietly',
    'abruptly',
    'hastily',
    'immediately',
    'then',
    'and',
    'with',
    'after',
    'before',
    'too',
    'again',
    'soon',
    'early',
    'alone',
    'together',
    'at',
]);
const EN_PLACES = new Set([
    'room',
    'house',
    'hall',
    'tavern',
    'inn',
    'kitchen',
    'building',
    'bar',
    'camp',
    'chamber',
    'chambers',
    'office',
    'scene',
    'table',
    'shop',
    'store',
    'library',
    'study',
    'cabin',
    'tent',
    'courtyard',
    'garden',
    'party',
    'clearing',
    'square',
    'village',
    'town',
    'city',
    'bedroom',
    'hut',
    'church',
    'temple',
    'stable',
    'yard',
    'castle',
    'palace',
    'cell',
    'ship',
    'deck',
]);
const EN_NOT_BEFORE_LEFT = new Set([
    'the',
    'her',
    'his',
    'their',
    'my',
    'your',
    'its',
    'our',
    'on',
    'to',
    'was',
    'were',
    'is',
    'are',
    'be',
    'been',
    'being',
    'get',
    'got',
    'nothing',
    'something',
    'anything',
    'one',
    'far',
]);
const EN_UNREAL = new Set([
    'not',
    'never',
    'didnt',
    'doesnt',
    'dont',
    'wont',
    'cant',
    'couldnt',
    'wouldnt',
    'hasnt',
    'hadnt',
    'would',
    'will',
    'could',
    'might',
    'should',
    'must',
    'can',
    'may',
    'to',
    'almost',
    'nearly',
]);
const EN_PRONOUNS: Record<string, 'female' | 'male'> = { she: 'female', he: 'male' };
const EN_BEHIND: Record<string, 'female' | 'male' | 'pl'> = { her: 'female', him: 'male', them: 'pl' };
/** Words after which an English name is a subject. */
const EN_STARTERS = new Set([
    'and',
    'but',
    'then',
    'so',
    'as',
    'while',
    'when',
    'before',
    'after',
    'until',
    'once',
    'finally',
    'suddenly',
    'quietly',
    'slowly',
    'now',
    'soon',
    'that',
    'who',
    'because',
    'though',
    'although',
    'yet',
    'instead',
    'only',
    'still',
]);
const SPEECH_VERBS = new Set([
    'said',
    'says',
    'asked',
    'asks',
    'replied',
    'replies',
    'answered',
    'answers',
    'whispered',
    'whispers',
    'murmured',
    'murmurs',
    'added',
    'adds',
    'called',
    'calls',
    'shouted',
    'shouts',
    'snapped',
    'snaps',
    'muttered',
    'mutters',
    'сказал',
    'сказала',
    'сказали',
    'спросил',
    'спросила',
    'ответил',
    'ответила',
    'прошептал',
    'прошептала',
    'бросил',
    'бросила',
    'добавил',
    'добавила',
    'крикнул',
    'крикнула',
    'пробормотал',
    'пробормотала',
    'усмехнулся',
    'усмехнулась',
]);
const DOOR_WORDS = new Set(['дверь', 'двери', 'door']);
const DOOR_CLOSED = /^(закрыл|захлопнул|затворил|закрывает|захлопывает|closed|shut|slammed|closes|shuts|slams)/;

/** Sentences of memories, thoughts and wishes: nothing in them happens now — neither an exit nor an act. */
const THOUGHT_RE =
    /(вспомина|вспомн|подума|дума[лвея]|мечта|надея|представил|remember|thought|thinking|imagined|wished|wishing|hoped|hoping|dreamed|dreamt)/;
/** Sentences that speak of elsewhere, of the future or of absence: no one acts in the scene there. */
const NOT_HERE_RE =
    /(где то|тем временем|в это время|далеко отсюда|не было|нигде|нет рядом|интересно|скоро|завтра|будет|вернется|придет|уйдет|meanwhile|elsewhere|somewhere|far away|wondered|wonders|will |would |soon|later|tomorrow|wasnt there|was not there|no sign of|nowhere)/;

/* ------------------------------------------------------------------ the reading */

interface VerbHit {
    kind: 'exit' | 'enter';
    at: number;
    /** Index of the verb's last word. */
    end: number;
    gender: Gn;
}

function startsWithAny(word: string | undefined, stems: readonly string[]): boolean {
    return !!word && stems.some((stem) => word.startsWith(stem));
}

function sameClauseNext(words: readonly Word[], at: number, ahead: number): Word | undefined {
    const word = words[at + ahead];
    return word && word.clause === words[at]!.clause ? word : undefined;
}

function unrealRu(words: readonly Word[], at: number): boolean {
    const previous = words[at - 1];
    if (previous && previous.clause === words[at]!.clause && RU_NOT.has(previous.low)) return true;
    for (let j = at - 1; j >= Math.max(0, at - 4); j--) {
        if (words[j]!.clause !== words[at]!.clause) break;
        if (RU_UNREAL.has(words[j]!.low)) return true;
    }
    const next = sameClauseNext(words, at, 1);
    return next?.low === 'бы' || next?.low === 'б';
}

function unrealEn(words: readonly Word[], at: number): boolean {
    for (let j = at - 1; j >= Math.max(0, at - 2); j--) {
        if (words[j]!.clause !== words[at]!.clause) break;
        if (EN_UNREAL.has(words[j]!.low)) return true;
    }
    return false;
}

function ruNotAfter(words: readonly Word[], at: number): boolean {
    const next = sameClauseNext(words, at, 1);
    if (!next) return false;
    if (RU_NOT_AFTER_WORDS.has(next.low)) return true;
    const then = sameClauseNext(words, at, 2)?.low;
    return RU_NOT_AFTER.some(([word, stem]) => next.low === word && !!then && then.startsWith(stem));
}

/** An aimed exit verb leads away: «прочь», «из комнаты», «на улицу», «за дверь», «к выходу», or ends its clause. */
function ruAimedAway(words: readonly Word[], at: number): boolean {
    const next = sameClauseNext(words, at, 1);
    if (!next) return true;
    const then = sameClauseNext(words, at, 2)?.low;
    if (RU_AWAY_WORDS.has(next.low)) return true;
    if (next.low === 'из') return startsWithAny(then, RU_ROOM_STEMS);
    if (next.low === 'на') return startsWithAny(then, ['улиц', 'двор', 'воздух', 'выход', 'крыльц']);
    if (next.low === 'за') return startsWithAny(then, ['двер', 'порог', 'ворот']);
    if (next.low === 'к') return startsWithAny(then, ['выход', 'двер', 'себе']);
    return false;
}

function phraseAt(words: readonly Word[], at: number, phrase: readonly string[]): boolean {
    for (let j = 0; j < phrase.length; j++) {
        const word = words[at + j];
        if (!word || word.low !== phrase[j] || (j > 0 && word.sentence !== words[at]!.sentence)) return false;
    }
    return true;
}

function enLeftIsLeaving(words: readonly Word[], at: number): boolean {
    const before = words[at - 1];
    if (before && before.sentence === words[at]!.sentence && EN_NOT_BEFORE_LEFT.has(before.low)) return false;
    const next = sameClauseNext(words, at, 1);
    if (!next) return true;
    if (EN_LEFT_NEXT.has(next.low)) return true;
    const then = sameClauseNext(words, at, 2)?.low;
    return EN_DETERMINERS.has(next.low) && !!then && EN_PLACES.has(then);
}

/** Exit and entry verbs of the words, in order. */
function verbsOf(words: readonly Word[]): VerbHit[] {
    const out: VerbHit[] = [];
    for (let i = 0; i < words.length; i++) {
        const word = words[i]!;
        if (word.cyrillic) {
            const exit = RU_EXIT[word.low];
            const aimed = RU_EXIT_AIMED[word.low];
            const enter = RU_ENTER[word.low];
            if (exit === undefined && aimed === undefined && enter === undefined) continue;
            if (unrealRu(words, i) || ruNotAfter(words, i)) continue;
            if (exit !== undefined) out.push({ kind: 'exit', at: i, end: i, gender: exit });
            else if (aimed !== undefined && ruAimedAway(words, i))
                out.push({ kind: 'exit', at: i, end: i, gender: aimed });
            else if (enter !== undefined) out.push({ kind: 'enter', at: i, end: i, gender: enter });
            continue;
        }
        let hit: VerbHit | null = null;
        for (const phrase of EN_EXIT) {
            if (phraseAt(words, i, phrase)) {
                hit = { kind: 'exit', at: i, end: i + phrase.length - 1, gender: null };
                break;
            }
        }
        if (!hit && EN_LEFT.has(word.low) && enLeftIsLeaving(words, i))
            hit = { kind: 'exit', at: i, end: i, gender: null };
        if (!hit) {
            for (const phrase of EN_ENTER) {
                if (phraseAt(words, i, phrase)) {
                    hit = { kind: 'enter', at: i, end: i + phrase.length - 1, gender: null };
                    break;
                }
            }
        }
        if (!hit && (EN_RETURN.has(word.low) || EN_APPEAR.has(word.low))) {
            const next = sameClauseNext(words, i, 1);
            const ok = EN_RETURN.has(word.low)
                ? !next || !EN_DETERMINERS.has(next.low)
                : !next || EN_APPEAR_NEXT.has(next.low);
            if (ok) hit = { kind: 'enter', at: i, end: i, gender: null };
        }
        if (!hit || unrealEn(words, i)) continue;
        out.push(hit);
        i = hit.end;
    }
    return out;
}

/** Index of the verb that ends a phrase «the door closed behind her» / «дверь за ней закрылась», or -1. */
function doorClosedAt(words: readonly Word[], sentence: number): number {
    const indexes = words.map((word, index) => index).filter((index) => words[index]!.sentence === sentence);
    if (!indexes.some((index) => DOOR_WORDS.has(words[index]!.low))) return -1;
    return indexes.find((index) => DOOR_CLOSED.test(words[index]!.low)) ?? -1;
}

interface Reading {
    words: Word[];
    questions: Set<number>;
    mentions: Mention[];
    genders: ReadonlyMap<string, 'female' | 'male' | undefined>;
}

/**
 * The one character a pronoun of this gender at `at` clearly means, or null: looking back from it — its own sentence,
 * then up to 3 earlier ones — the first character of that gender, unless another of that gender stands as near or one
 * of unknown gender stands nearer. Characters of the other gender are passed over; the player never counts.
 */
function resolvePronoun(r: Reading, at: number, gender: 'female' | 'male'): string | null {
    const sentence = r.words[at]!.sentence;
    const unknown = new Set<string>();
    for (let s = sentence; s >= Math.max(0, sentence - 3); s--) {
        const ids = [
            ...new Set(
                r.mentions
                    .filter((mention) => mention.id !== PLAYER_ID && r.words[mention.at]!.sentence === s)
                    .filter((mention) => s !== sentence || mention.at < at)
                    .map((mention) => mention.id),
            ),
        ];
        const gendered = ids.filter((id) => r.genders.get(id) === gender);
        if (gendered.length) return gendered.length === 1 && !unknown.size ? gendered[0]! : null;
        for (const id of ids) if (r.genders.get(id) === undefined) unknown.add(id);
    }
    return unknown.size === 1 ? [...unknown][0]! : null;
}

/** Is a mention in a subject's place (see the file header)? */
function subjectPlace(r: Reading, mention: Mention): boolean {
    const word = r.words[mention.at]!;
    if (word.possessive || !mention.exact) return false;
    const before = r.words[mention.at - 1];
    if (!before || before.sentence !== word.sentence || word.gap) return true;
    if (word.cyrillic) return !RU_PREPOSITIONS.has(before.low);
    return EN_STARTERS.has(before.low) || SPEECH_VERBS.has(before.low);
}

/** Subjects of a sentence: named ones in a subject's place and resolved pronouns, in order. */
function subjectsOf(r: Reading, sentence: number): Subject[] {
    const out: Subject[] = [];
    for (const mention of r.mentions) {
        if (mention.id === PLAYER_ID || r.words[mention.at]!.sentence !== sentence) continue;
        if (subjectPlace(r, mention)) out.push({ id: mention.id, at: mention.at, named: true });
    }
    r.words.forEach((word, index) => {
        if (word.sentence !== sentence) return;
        const gender = RU_PRONOUNS[word.low] ?? EN_PRONOUNS[word.low];
        if (!gender) return;
        const id = resolvePronoun(r, index, gender);
        if (id) out.push({ id, at: index, named: false });
    });
    return out.sort((a, b) => a.at - b.at);
}

function genderFits(r: Reading, id: string, gender: Gn): boolean {
    if (gender === null || gender === 'pl') return true;
    const own = r.genders.get(id);
    return own === undefined || own === (gender === 'f' ? 'female' : 'male');
}

/** Who a verb is about: see the file header. */
function subjectsOfVerb(r: Reading, verb: VerbHit, subjects: readonly Subject[]): Subject[] {
    const word = r.words[verb.at]!;
    const fitting = subjects.filter((subject) => genderFits(r, subject.id, verb.gender));
    const sameClause = fitting.filter((subject) => r.words[subject.at]!.clause === word.clause);
    const before = sameClause.filter((subject) => subject.at < verb.at);
    const after = sameClause.filter((subject) => subject.at > verb.end && subject.at - verb.end <= 4);
    if (verb.gender === 'pl') return before.length ? before : after;
    if (before.length) return [before[before.length - 1]!];
    // «Марк смотрел, как уходит Лиза»: the subject after the verb in its own clause comes before an earlier clause's.
    if (after.length) return [after[0]!];
    const earlier = fitting.filter((subject) => subject.at < verb.at);
    return earlier.length ? [earlier[earlier.length - 1]!] : [];
}

/** «The door closed behind her / Liza», «дверь за ней / за Лизой закрылась»: who it closed behind. */
function doorSubjects(r: Reading, sentence: number): Subject[] {
    const verb = doorClosedAt(r.words, sentence);
    if (verb < 0) return [];
    const out: Subject[] = [];
    r.words.forEach((word, index) => {
        if (word.sentence !== sentence || index === 0) return;
        const before = r.words[index - 1]!.low;
        if (before !== 'за' && before !== 'behind') return;
        const pronoun = RU_BEHIND[word.low] ?? EN_BEHIND[word.low];
        if (pronoun === 'female' || pronoun === 'male') {
            const id = resolvePronoun(r, index, pronoun);
            if (id) out.push({ id, at: verb, named: false });
            return;
        }
        const mention = r.mentions.find((item) => item.at === index && item.id !== PLAYER_ID);
        if (mention) out.push({ id: mention.id, at: verb, named: true });
    });
    return out;
}

function readText(text: string, profiles: readonly ReadProfile[], playerName = ''): Reading {
    const { words, questions } = wordsOf(text);
    const entries = profiles.flatMap((profile) => entriesOf(profile));
    if (playerName.trim()) entries.push(...entriesOf({ id: PLAYER_ID, name: playerName, aliases: [] }));
    return {
        words,
        questions,
        mentions: mentionsOf(words, entries),
        genders: new Map(profiles.map((profile) => [profile.id, profile.gender] as const)),
    };
}

/**
 * What a reply's narration shows of each character: the last exit, entry or act in it (see the file header), by
 * profile id. Characters it shows nothing of are missing.
 */
export function readScene(
    narration: string,
    profiles: readonly ReadProfile[],
    playerName = '',
): Record<string, SceneEvidence> {
    const r = readText(narrationOnly(narration), profiles, playerName);
    const out: Record<string, SceneEvidence & { at: number }> = {};
    const note = (id: string, kind: Evidence, at: number, named: boolean) => {
        const previous = out[id];
        if (previous && previous.at > at) return;
        out[id] = { kind, named, at };
    };
    const sentences = r.words.length ? r.words[r.words.length - 1]!.sentence + 1 : 0;
    const verbs = verbsOf(r.words);
    for (let s = 0; s < sentences; s++) {
        const text = r.words
            .filter((word) => word.sentence === s)
            .map((word) => word.low)
            .join(' ');
        // A question («Куда ушла Лиза?») or a memory tells nothing of the scene now.
        if (r.questions.has(s) || THOUGHT_RE.test(text)) continue;
        const subjects = subjectsOf(r, s);
        const moved = new Set<string>();
        for (const verb of verbs) {
            if (r.words[verb.at]!.sentence !== s) continue;
            for (const subject of subjectsOfVerb(r, verb, subjects)) {
                note(subject.id, verb.kind, verb.at, subject.named);
                moved.add(subject.id);
            }
        }
        for (const subject of doorSubjects(r, s)) {
            note(subject.id, 'exit', subject.at, subject.named);
            moved.add(subject.id);
        }
        if (NOT_HERE_RE.test(`${text} `)) continue;
        for (const subject of subjects) if (!moved.has(subject.id)) note(subject.id, 'act', subject.at, subject.named);
    }
    const result: Record<string, SceneEvidence> = {};
    for (const [id, item] of Object.entries(out)) result[id] = { kind: item.kind, named: item.named };
    return result;
}

/* ------------------------------------------------------------------ the player's message */

/** Verbs of calling or bringing someone (зову, позвал, окликнул, привёл; call, summon, bring, beckon). */
const SUMMON_RE =
    /^(зов|позв|подзыв|подозв|оклика|окликн|клич|приглаша|приглас|привож|привел|привед|приведу|возвраща|call|summon|beckon|invite|bring|brought|fetch|wave)/;

/**
 * Of `ids` (characters out of the scene), those the player's message brings or calls in: addressed by name at the
 * start or end of a clause («Лиза, иди сюда», «Иди сюда, Лиза!», «Liza?»), named with a verb of calling or bringing
 * in the same sentence («зову Лизу», «I call Liza over»), or written coming back («Лиза возвращается»).
 */
export function summonedBy(
    text: string,
    profiles: readonly ReadProfile[],
    ids: readonly string[],
    playerName = '',
): string[] {
    if (!ids.length || !text?.trim()) return [];
    const wanted = new Set(ids);
    const r = readText(text, profiles, playerName);
    const found = new Set<string>();
    for (const mention of r.mentions) {
        if (!wanted.has(mention.id)) continue;
        const word = r.words[mention.at]!;
        const before = r.words[mention.at - 1];
        const after = r.words[mention.end + 1];
        // A name alone in its clause is an address: «Лиза, иди сюда», «Иди сюда, Лиза!», «Liza?».
        const opens = !before || before.clause !== word.clause;
        const closes = !after || after.clause !== word.clause;
        if (mention.exact && opens && closes) {
            found.add(mention.id);
            continue;
        }
        const calls = r.words.some(
            (other, index) =>
                other.clause === word.clause &&
                SUMMON_RE.test(other.low) &&
                !(index > 0 && (RU_NOT.has(r.words[index - 1]!.low) || EN_UNREAL.has(r.words[index - 1]!.low))),
        );
        if (calls) found.add(mention.id);
    }
    const scene = readScene(text, profiles, playerName);
    for (const [id, evidence] of Object.entries(scene)) {
        if (wanted.has(id) && evidence.kind === 'enter' && evidence.named) found.add(id);
    }
    // The player writing them gone («Лиза, конечно, ушла») is no call.
    return ids.filter((id) => found.has(id) && scene[id]?.kind !== 'exit');
}
