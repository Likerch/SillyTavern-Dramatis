// Who is in the scene: story names → profile ids (docs/model.md §6.1 «only those present»). Names are matched by name,
// aliases and the English name, case- and ё-insensitive, with Russian case endings tolerated: the same stem (≥ 4
// letters, or 3 for a capitalised word of a name of ≥ 4 letters) plus a common ending, from the left word boundary.
// An exact match always beats an inflected one, and a tie between two profiles is no match at all. The strict mode
// (DES names, which are nominative) also refuses «Александра» for «Александр» and the bare stem for «Александра».
// Pure.
import type { CharacterProfile } from './model';
import type { DesCharacter } from '../shared/contracts';

export type NamedProfile = Pick<CharacterProfile, 'id' | 'name' | 'aliases'> &
    Partial<Pick<CharacterProfile, 'english' | 'kind'>>;

export interface MatchOptions {
    /** Nominative names (DES): no gender-pair endings, no bare stems, no possessives. */
    strict?: boolean;
}

const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
/** Final letters dropped to get a Russian stem. */
const STEM_END_RE = /[аяоеыиуюйь]$/;
/** Case endings after the stem of a name in -а/-я (Ильва, Мария, Илья): Ильвы, Ильве, Ильву, Ильвой… */
const FEMININE_ENDINGS = new Set([
    'ы',
    'и',
    'е',
    'у',
    'ю',
    'ой',
    'ей',
    'ою',
    'ею',
    'ам',
    'ям',
    'ами',
    'ями',
    'ах',
    'ях',
]);
/** Case endings after the stem of a name in a consonant, -й or -ь (Брам, Дмитрий, Игорь): Брама, Браму, Брамом… */
const MASCULINE_ENDINGS = new Set([
    'а',
    'я',
    'у',
    'ю',
    'е',
    'ом',
    'ем',
    'и',
    'ы',
    'ов',
    'ев',
    'ам',
    'ям',
    'ами',
    'ями',
    'ах',
    'ях',
]);
/** Possessive adjectives («Ильвин трактир», «Брамов нож»); not in the strict mode. */
const POSSESSIVE_ENDINGS = new Set([
    'ин',
    'ина',
    'ину',
    'иной',
    'ины',
    'ино',
    'иных',
    'ов',
    'ова',
    'ову',
    'овой',
    'овы',
]);
/** Small words that never identify anyone on their own. */
const STOP_WORDS = new Set(['the', 'old', 'young', 'lady', 'sir', 'and', 'of', 'старый', 'старая', 'молодой', 'юная']);
const MIN_STEM = 4;

/** Lower case, ё → е, possessive 's dropped, punctuation folded into spaces. */
export function normalizeName(text: string): string {
    return text
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/['’]s\b/g, '')
        .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function words(text: string): string[] {
    return normalizeName(text)
        .split(/[\s-]+/)
        .filter(Boolean);
}

/** «Ильва» → 'ильв', «Дмитрий» → 'дмитри', «Брам» → 'брам' (normalised input). */
export function russianStem(word: string): string {
    return word.replace(STEM_END_RE, '');
}

function isCapitalized(original: string | undefined): boolean {
    if (!original) return false;
    const first = original.trim().charAt(0);
    return first !== '' && first === first.toUpperCase() && first !== first.toLowerCase();
}

/**
 * Is `form` (one normalised word) an inflected form of `base` (one normalised word)? Cyrillic only.
 * `capitalized`: the form was written with a capital letter (a 3-letter stem is accepted then).
 */
export function isInflectionOf(form: string, base: string, strict = false, capitalized = false): boolean {
    if (!form || !base || form === base) return false;
    if (!CYRILLIC_RE.test(base) || !CYRILLIC_RE.test(form)) return false;
    const stem = russianStem(base);
    const minStem = capitalized && base.length >= MIN_STEM ? MIN_STEM - 1 : MIN_STEM;
    if (stem.length < minStem || !form.startsWith(stem)) return false;
    const ending = form.slice(stem.length);
    if (!ending) return false;
    const masculine = !/[ая]$/.test(base);
    const endings = masculine ? MASCULINE_ENDINGS : FEMININE_ENDINGS;
    if (strict) {
        // Александр → «Александра», Евгений → «Евгения»: a different (female) name in the nominative.
        if (masculine && (ending === 'а' || ending === 'я')) return false;
        return endings.has(ending);
    }
    return endings.has(ending) || POSSESSIVE_ENDINGS.has(ending);
}

/** How well a name matches one of a profile's names: 3 exact, 2 same words, 1 inflected, 0 none. */
export function nameScore(query: string, candidate: string, options: MatchOptions = {}, capitalized = false): number {
    const q = normalizeName(query);
    const c = normalizeName(candidate);
    if (!q || !c) return 0;
    if (q === c) return 3;
    const qWords = words(q);
    const cWords = words(c);
    const useful = (word: string) => word.length >= 3 && !STOP_WORDS.has(word);
    // «Ильва» ⊂ «Ильва Хольм» and «старый Фенн» ⊃ «Фенн»: every word of the shorter one is a word of the longer one.
    const [short, long] = qWords.length <= cWords.length ? [qWords, cWords] : [cWords, qWords];
    const shortUseful = short.filter(useful);
    if (shortUseful.length && shortUseful.every((word) => long.includes(word))) return 2;
    // Inflected: every useful query word is a word or an inflected word of the candidate.
    const qUseful = qWords.filter(useful);
    if (!qUseful.length) return 0;
    const inflected = qUseful.every((word) =>
        cWords.some((base) => base === word || isInflectionOf(word, base, options.strict, capitalized)),
    );
    return inflected ? 1 : 0;
}

/** Every name a profile answers to: the story name, the aliases, the English name. */
export function nameVariants(profile: NamedProfile): string[] {
    return [profile.name, ...(profile.aliases ?? []), profile.english ?? ''].filter((item) => item && item.trim());
}

/** Best score of a name against every name of a profile. */
function profileScore(name: string, profile: NamedProfile, options: MatchOptions): number {
    const capitalized = isCapitalized(name);
    return Math.max(0, ...nameVariants(profile).map((variant) => nameScore(name, variant, options, capitalized)));
}

/**
 * The profile id a story name refers to, or null. Exact beats same-words beats inflected; two profiles with the
 * same best score are ambiguous (null).
 */
export function matchName(name: string, profiles: readonly NamedProfile[], options: MatchOptions = {}): string | null {
    if (!name.trim()) return null;
    let best = 0;
    let found: string[] = [];
    for (const profile of profiles) {
        const score = profileScore(name, profile, options);
        if (score === 0 || score < best) continue;
        if (score > best) {
            best = score;
            found = [profile.id];
        } else if (!found.includes(profile.id)) {
            found.push(profile.id);
        }
    }
    return found.length === 1 ? found[0]! : null;
}

export interface PresentResult {
    /** Profile ids of those present, in cast order, unique. */
    present: string[];
    /** Present names with no profile (as written; for the generator), unique. */
    unknown: string[];
}

/** Present cast of a DES tracker → profile ids, plus the names nobody has a profile for. */
export function presentFromDes(cast: readonly DesCharacter[], profiles: readonly NamedProfile[]): PresentResult {
    const present: string[] = [];
    const unknown: string[] = [];
    const seenUnknown = new Set<string>();
    for (const member of cast) {
        if (!member.present || !member.name?.trim()) continue;
        const id = matchName(member.name, profiles, { strict: true });
        if (id) {
            if (!present.includes(id)) present.push(id);
            continue;
        }
        const key = normalizeName(member.name);
        if (key && !seenUnknown.has(key)) {
            seenUnknown.add(key);
            unknown.push(member.name.trim());
        }
    }
    return { present, unknown };
}

interface Token {
    norm: string;
    capitalized: boolean;
}

function tokenize(text: string): Token[] {
    const out: Token[] = [];
    for (const match of text.matchAll(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)) {
        const raw = match[0];
        const norm = normalizeName(raw);
        for (const part of norm.split(/[\s-]+/).filter(Boolean))
            out.push({ norm: part, capitalized: isCapitalized(raw) });
    }
    return out;
}

/** Words of a profile's names that identify it in prose: capitalised ones (or all, when none is), normalised. */
export function nameWords(profile: NamedProfile): string[][] {
    return nameVariants(profile).map((variant) => {
        const raw = variant.split(/[\s-]+/).filter(Boolean);
        const capital = raw.filter((word) => isCapitalized(word));
        return (capital.length ? capital : raw).map(normalizeName).filter((word) => word.length >= 2);
    });
}

/** Does the phrase (all words of a name, in order) occur in the tokens? */
function phraseAt(tokens: Token[], phrase: string[], exactOnly: boolean): boolean {
    if (!phrase.length) return false;
    for (let i = 0; i + phrase.length <= tokens.length; i++) {
        const ok = phrase.every((word, j) => {
            const token = tokens[i + j]!;
            return token.norm === word || (!exactOnly && isInflectionOf(token.norm, word, false, token.capitalized));
        });
        if (ok) return true;
    }
    return false;
}

/**
 * Who is present without DES: the card's main character plus everyone mentioned in the last 3 messages (by any of
 * their names, inflected forms included). A word that exactly names someone is never read as another's inflection.
 * Groups need their whole name. Main character first, then profile order.
 */
export function presentFromText(
    lastMessages: readonly string[],
    profiles: readonly NamedProfile[],
    mainCharacterId?: string,
): string[] {
    const tokens = lastMessages.slice(-3).flatMap((message) => tokenize(message ?? ''));
    const exactWords = new Set<string>();
    for (const profile of profiles)
        for (const phrase of nameWords(profile)) for (const word of phrase) exactWords.add(word);
    const found = new Set<string>();
    for (const profile of profiles) {
        if (profile.kind === 'group') {
            const whole = nameVariants(profile).map(words);
            if (whole.some((phrase) => phraseAt(tokens, phrase, false))) found.add(profile.id);
            continue;
        }
        const hit = nameWords(profile).some((phrase) => {
            if (phraseAt(tokens, phrase, true)) return true;
            // A single identifying word, exact or inflected, unless the token is exactly someone's name word.
            return phrase.some((word) =>
                tokens.some(
                    (token) =>
                        token.norm === word ||
                        (!exactWords.has(token.norm) && isInflectionOf(token.norm, word, false, token.capitalized)),
                ),
            );
        });
        if (hit) found.add(profile.id);
    }
    const out: string[] = [];
    if (mainCharacterId && profiles.some((profile) => profile.id === mainCharacterId)) out.push(mainCharacterId);
    for (const profile of profiles) if (found.has(profile.id) && !out.includes(profile.id)) out.push(profile.id);
    return out;
}
