// Role priors of the generator (docs/model.md §10.3 «Сначала выбор, потом текст»; research A1–A3, B8, B12, C1): what
// a guard, an innkeeper or a raider tends to value, how they tend to be, what drives them, how they get their way, and
// how a world of a given tone meets a stranger. The data lives in src/data/role-priors.json; this file checks it once
// into typed tables (bad weights and unknown enums are dropped, never thrown on) and finds a role in story words
// (English words and Russian stems from DES details, «Мысли», names and text). Pure.
import rawPriors from '../data/role-priors.json';
import { DRIVES, HEXACO, MOODS, STYLES, VALUES } from './model';
import type { Drive, HexacoAxis, Level5, MoodOctant, Stance, Style, Value, WorldTone } from './model';
import { normalizeText } from './util';

export type Lang = 'en' | 'ru';

/** Story-word templates in both card languages. */
export interface Templates {
    en: string[];
    ru: string[];
}

export interface RolePrior {
    id: string;
    /** Detection patterns, normalised (lower case, ё → е); a trailing * marks a prefix. */
    words: { en: string[]; ru: string[] };
    /** Weight of every Schwartz value (1 + the role's lean). */
    values: Record<Value, number>;
    /** Ranges of the axes the role leans on; other axes use the default bell. */
    temperament: Partial<Record<HexacoAxis, [Level5, Level5]>>;
    /** Weight of every Reiss desire (1 + the role's lean). */
    drives: Record<Drive, number>;
    tactics: string[];
    /** The role obliges them to deal with newcomers (§5.4 «его роль обязывает»). */
    duty: boolean;
    proactivity: [number, number];
    styles: Partial<Record<Style, number>>;
    moods: Partial<Record<MoodOctant, number>>;
    /** −1 … +1: chance to move the stance toward strangers a step down (−) or up (+). */
    strangerBias: number;
    doing: Templates;
    want: Templates;
    tell: Templates;
}

export interface RolePriors {
    roles: ReadonlyMap<string, RolePrior>;
    /** Stance toward strangers by world tone, shares summing to 1. */
    tones: Record<WorldTone, Partial<Record<Stance, number>>>;
    stanceTells: Partial<Record<Stance, { en: string; ru: string }>>;
    stanceReasons: Record<'negative' | 'neutral' | 'positive', { en: string; ru: string }>;
}

export const UNKNOWN_ROLE = 'unknown';
const TONES: readonly WorldTone[] = ['hostile', 'indifferent', 'neutral', 'welcoming'];

/** Default stance shares when a tone is missing from the data (the «indifferent» world, decision В8). */
const FALLBACK_TONE: Partial<Record<Stance, number>> = { [-2]: 0.08, [-1]: 0.27, 0: 0.5, 1: 0.12, 2: 0.03 };

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()).map((item) => item.trim())
        : [];
}

function templates(value: unknown): Templates {
    const dict = isDict(value) ? value : {};
    return { en: strings(dict.en), ru: strings(dict.ru) };
}

function positive(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** 1 + lean for every member of an enum. */
function weights<T extends string>(members: readonly T[], value: unknown): Record<T, number> {
    const dict = isDict(value) ? value : {};
    const out = {} as Record<T, number>;
    for (const member of members) out[member] = 1 + positive(dict[member]);
    return out;
}

/** Only positive weights of known members. */
function sparse<T extends string>(members: readonly T[], value: unknown): Partial<Record<T, number>> {
    const dict = isDict(value) ? value : {};
    const out: Partial<Record<T, number>> = {};
    for (const member of members) {
        const weight = positive(dict[member]);
        if (weight > 0) out[member] = weight;
    }
    return out;
}

function level(value: unknown): Level5 {
    const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
    return Math.max(-2, Math.min(2, n)) as Level5;
}

function range(value: unknown, min: number, max: number, fallback: [number, number]): [number, number] {
    if (!Array.isArray(value) || value.length !== 2) return fallback;
    const [a, b] = value.map((item) =>
        typeof item === 'number' && Number.isFinite(item) ? Math.max(min, Math.min(max, Math.round(item))) : NaN,
    );
    if (a === undefined || b === undefined || Number.isNaN(a) || Number.isNaN(b)) return fallback;
    return a <= b ? [a, b] : [b, a];
}

function pattern(word: string): string {
    const prefix = word.endsWith('*');
    const body = normalizeText(prefix ? word.slice(0, -1) : word);
    return body ? `${body}${prefix ? '*' : ''}` : '';
}

function readRole(id: string, raw: unknown): RolePrior {
    const dict = isDict(raw) ? raw : {};
    const words = isDict(dict.words) ? dict.words : {};
    const temperament: Partial<Record<HexacoAxis, [Level5, Level5]>> = {};
    if (isDict(dict.temperament)) {
        for (const axis of HEXACO) {
            const value = dict.temperament[axis];
            if (Array.isArray(value)) {
                const [low, high] = range(value, -2, 2, [-2, 2]);
                temperament[axis] = [level(low), level(high)];
            }
        }
    }
    const bias = typeof dict.strangerBias === 'number' && Number.isFinite(dict.strangerBias) ? dict.strangerBias : 0;
    return {
        id,
        words: {
            en: [...new Set(strings(words.en).map(pattern).filter(Boolean))],
            ru: [...new Set(strings(words.ru).map(pattern).filter(Boolean))],
        },
        values: weights(VALUES, dict.values),
        temperament,
        drives: weights(DRIVES, dict.drives),
        tactics: strings(dict.tactics),
        duty: dict.duty === true,
        proactivity: range(dict.proactivity, 0, 10, [2, 7]),
        styles: sparse(STYLES, dict.styles),
        moods: sparse(MOODS, dict.moods),
        strangerBias: Math.max(-1, Math.min(1, bias)),
        doing: templates(dict.doing),
        want: templates(dict.want),
        tell: templates(dict.tell),
    };
}

function readStances(raw: unknown): Partial<Record<Stance, number>> {
    const dict = isDict(raw) ? raw : {};
    const out: Partial<Record<Stance, number>> = {};
    let sum = 0;
    for (const stance of [-3, -2, -1, 0, 1, 2, 3] as Stance[]) {
        const weight = positive(dict[String(stance)]);
        if (weight > 0) {
            out[stance] = weight;
            sum += weight;
        }
    }
    if (sum <= 0) return { ...FALLBACK_TONE };
    for (const key of Object.keys(out)) {
        const stance = Number(key) as Stance;
        out[stance] = Math.round((out[stance]! / sum) * 1000) / 1000;
    }
    return out;
}

function wordPair(raw: unknown, fallback: { en: string; ru: string }): { en: string; ru: string } {
    const dict = isDict(raw) ? raw : {};
    const en = typeof dict.en === 'string' && dict.en.trim() ? dict.en.trim() : fallback.en;
    const ru = typeof dict.ru === 'string' && dict.ru.trim() ? dict.ru.trim() : fallback.ru;
    return { en, ru };
}

/** Checks a priors document (the bundled JSON, or a test fixture) into typed tables. Always has 'unknown'. */
export function loadRolePriors(raw: unknown): RolePriors {
    const dict = isDict(raw) ? raw : {};
    const roles = new Map<string, RolePrior>();
    if (isDict(dict.roles)) {
        for (const [id, role] of Object.entries(dict.roles)) {
            const key = id.trim().toLowerCase();
            if (key) roles.set(key, readRole(key, role));
        }
    }
    if (!roles.has(UNKNOWN_ROLE)) roles.set(UNKNOWN_ROLE, readRole(UNKNOWN_ROLE, {}));
    const tonesRaw = isDict(dict.tones) ? dict.tones : {};
    const tones = {} as RolePriors['tones'];
    for (const tone of TONES) tones[tone] = readStances(tonesRaw[tone]);
    const tellsRaw = isDict(dict.stanceTells) ? dict.stanceTells : {};
    const stanceTells: RolePriors['stanceTells'] = {};
    for (const stance of [-3, -2, -1, 0, 1, 2, 3] as Stance[]) {
        const value = tellsRaw[String(stance)];
        if (isDict(value)) stanceTells[stance] = wordPair(value, { en: '', ru: '' });
    }
    const reasonsRaw = isDict(dict.stanceReasons) ? dict.stanceReasons : {};
    return {
        roles,
        tones,
        stanceTells,
        stanceReasons: {
            negative: wordPair(reasonsRaw.negative, { en: 'a stranger', ru: 'чужак' }),
            neutral: wordPair(reasonsRaw.neutral, { en: 'a stranger', ru: 'чужак' }),
            positive: wordPair(reasonsRaw.positive, { en: 'a newcomer', ru: 'новичок' }),
        },
    };
}

/** The bundled priors. */
export const ROLE_PRIORS: RolePriors = loadRolePriors(rawPriors);

/** Every known role id, 'unknown' last. */
export function roleIds(priors: RolePriors = ROLE_PRIORS): string[] {
    return [...priors.roles.keys()].filter((id) => id !== UNKNOWN_ROLE).concat(UNKNOWN_ROLE);
}

/** A role's priors; anything unknown falls back to 'unknown'. */
export function rolePrior(role: string | undefined, priors: RolePriors = ROLE_PRIORS): RolePrior {
    const key = (role ?? '').trim().toLowerCase();
    return priors.roles.get(key) ?? priors.roles.get(UNKNOWN_ROLE)!;
}

/** Stance shares toward strangers in a world of this tone. */
export function toneStances(tone: WorldTone, priors: RolePriors = ROLE_PRIORS): Partial<Record<Stance, number>> {
    return { ...(priors.tones[tone] ?? FALLBACK_TONE) };
}

/** How a stance toward a stranger shows (story words), for sketches. */
export function stanceTell(stance: Stance, lang: Lang, priors: RolePriors = ROLE_PRIORS): string {
    return priors.stanceTells[stance]?.[lang] ?? '';
}

/** Why a sketched character holds that stance toward a stranger (a permanent «stranger» reason). */
export function stanceReason(stance: Stance, lang: Lang, priors: RolePriors = ROLE_PRIORS): string {
    const key = stance < 0 ? 'negative' : stance > 0 ? 'positive' : 'neutral';
    return priors.stanceReasons[key][lang];
}

/* ------------------------------------------------------------------ role detection */

export interface RoleSource {
    text: string;
    /** How much a hit here counts (a DES «role» detail or the name > demeanour > thoughts). Default 1. */
    weight?: number;
}

/** An English word matches its pattern whole or in a plural (-s, -es, -y → -ies, -man → -men). */
function englishHit(token: string, word: string): boolean {
    if (token === word || token === `${word}s` || token === `${word}es`) return true;
    if (word.endsWith('y') && token === `${word.slice(0, -1)}ies`) return true;
    if (word.endsWith('man') && token === `${word.slice(0, -3)}men`) return true;
    if (word.endsWith('f') && token === `${word.slice(0, -1)}ves`) return true;
    return false;
}

function hit(tokens: readonly string[], word: string, english: boolean): number {
    const prefix = word.endsWith('*');
    const body = prefix ? word.slice(0, -1) : word;
    const parts = body.split(' ');
    let count = 0;
    for (let i = 0; i + parts.length <= tokens.length; i++) {
        const ok = parts.every((part, j) => {
            const token = tokens[i + j]!;
            const last = j === parts.length - 1;
            if (prefix && last) return token.startsWith(part);
            return english ? englishHit(token, part) : token === part;
        });
        if (ok) count++;
    }
    return count;
}

/** Score of every role in the sources (weighted hits). */
export function roleScores(
    sources: readonly (string | RoleSource)[],
    priors: RolePriors = ROLE_PRIORS,
): Map<string, number> {
    const scores = new Map<string, number>();
    const prepared = sources
        .map((source) => (typeof source === 'string' ? { text: source, weight: 1 } : source))
        .map((source) => ({
            tokens: normalizeText(source.text ?? '')
                .split(' ')
                .filter(Boolean),
            weight: source.weight ?? 1,
        }))
        .filter((source) => source.tokens.length && source.weight > 0);
    for (const role of priors.roles.values()) {
        let score = 0;
        for (const source of prepared) {
            for (const word of role.words.en) score += hit(source.tokens, word, true) * source.weight;
            for (const word of role.words.ru) score += hit(source.tokens, word, false) * source.weight;
        }
        if (score > 0) scores.set(role.id, score);
    }
    return scores;
}

/**
 * The role story words point at: the best weighted score, ties to the role listed first; 'unknown' when nothing
 * matches. «Стражник у ворот», "Role: innkeeper", «Мысли: опять эти налётчики…» (low weight) all count.
 */
export function detectRole(sources: readonly (string | RoleSource)[], priors: RolePriors = ROLE_PRIORS): string {
    let best = UNKNOWN_ROLE;
    let top = 0;
    for (const [id, score] of roleScores(sources, priors)) {
        if (score > top) {
            top = score;
            best = id;
        }
    }
    return best;
}
