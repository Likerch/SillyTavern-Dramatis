// Scene boundaries (docs/model.md §4.4, §5.2, §11, §12). A scene ends when the place changes or time skips; at the
// end every tie ticks (reasons expire, stance drifts home), moods relax to the author's baseline, emotions clear,
// and per-scene fields reset. DES writes place/time/date as free strings in either language; we parse what we can.
import type { AppetiteState, CharacterProfile, CharacterState, ChatState, Mood, MoodOctant, Stance } from './model';
import { relaxMood } from './mood';
import { onSceneEnd } from './relations';
import type { StanceChange } from './relations';
import { normalizeText } from './util';

export interface SceneMark {
    place?: string;
    time?: string;
    date?: string;
}

export interface SceneBreak {
    reason: 'place' | 'time' | 'date';
    /** Hours elapsed when they could be computed (for world ticks, §11). */
    hours?: number;
}

/** Default time skip that ends a scene. */
export const SCENE_SKIP_HOURS = 3;

/** Time-of-day words → hour (English and Russian stems; longer phrases first). */
const TIME_WORDS: [RegExp, number][] = [
    [/midnight|полноч/, 0],
    [/late night|small hours|глубок[а-я]* ноч|поздн[а-я]* ноч/, 2],
    [/before dawn|pre-?dawn|предрассвет/, 5],
    [/dawn|sunrise|daybreak|рассвет|заря|зари|восход/, 6],
    [/early morning|ранн[а-я]* утр/, 7],
    [/late morning|поздн[а-я]* утр/, 11],
    [/morning|утр/, 9],
    // "afternoon" contains "noon" and «полдень» contains «день»: the afternoon forms go first, guarded.
    [/late afternoon|ближе к вечеру|под вечер/, 17],
    [/afternoon|после полудня|(?<!пол)день|днем/, 15],
    [/noon|midday|полдень|полудн/, 12],
    [/late evening|поздн[а-я]* вечер/, 22],
    [/dusk|sunset|twilight|закат|сумерк/, 19],
    [/evening|вечер/, 19],
    [/night|ноч/, 23],
];

/** Hour of the day 0–24 (fractional) from "14:30", "2:30 pm", "7 AM", "Evening", «вечер»; undefined if unknown. */
export function parseTime(text: string | undefined): number | undefined {
    if (typeof text !== 'string') return undefined;
    const t = text.toLowerCase().replace(/ё/g, 'е');
    const clock = /(\d{1,2})\s*[:.]\s*(\d{2})(?:\s*([ap])\.?\s*m\b\.?)?/.exec(t);
    const bare = clock ? null : /(\d{1,2})\s*([ap])\.?\s*m\b/.exec(t);
    const hit = clock ?? bare;
    if (hit) {
        let hour = Number(hit[1]);
        const minutes = clock ? Number(clock[2]) : 0;
        const half = clock ? clock[3] : bare![2];
        if (hour > 24 || minutes > 59) return undefined;
        if (half === 'p' && hour < 12) hour += 12;
        if (half === 'a' && hour === 12) hour = 0;
        return (hour % 24) + minutes / 60;
    }
    return TIME_WORDS.find(([re]) => re.test(t))?.[1];
}

const MONTHS_EN = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
];

/** Russian month words (any case form) and short forms, matched against whole words. */
const MONTHS_RU: RegExp[] = [
    /^(январ|янв$)/,
    /^(феврал|фев$)/,
    /^(март|мар$)/,
    /^(апрел|апр$)/,
    /^(ма[йяею]|маем)$/,
    /^июн/,
    /^июл/,
    /^(август|авг$)/,
    /^(сентябр|сент?$)/,
    /^(октябр|окт$)/,
    /^(ноябр|нояб?$)/,
    /^(декабр|дек$)/,
];

export type ParsedDate = { kind: 'calendar'; y?: number; m: number; d: number } | { kind: 'count'; n: number };

/** Month 1–12 from the first word that names one ("May", "sept", «мая», «дек»). */
function monthOf(text: string): number | undefined {
    for (const word of text.split(/[^\p{L}]+/u)) {
        if (word.length < 3) continue;
        const en = MONTHS_EN.findIndex((m) => m.startsWith(word));
        if (en >= 0) return en + 1;
        const ru = MONTHS_RU.findIndex((re) => re.test(word));
        if (ru >= 0) return ru + 1;
    }
    return undefined;
}

/**
 * Date from "1024-05-12", "12.05.1024", "12/05", "12 мая 1024", "May 12", "Day 3", «День 3», «3-й день».
 * Calendar dates and day counts are not comparable with each other.
 */
export function parseDate(text: string | undefined): ParsedDate | undefined {
    if (typeof text !== 'string') return undefined;
    const t = text.toLowerCase().replace(/ё/g, 'е');
    const iso = /(\d{3,4})-(\d{1,2})-(\d{1,2})/.exec(t);
    if (iso) return calendar(Number(iso[2]), Number(iso[3]), Number(iso[1]));
    const dotted = /(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/.exec(t);
    if (dotted) return calendar(Number(dotted[2]), Number(dotted[1]), dotted[3] ? Number(dotted[3]) : undefined);
    const count = /(?:\bday|день)\s*(\d{1,4})|(\d{1,4})\s*(?:-?(?:st|nd|rd|th|й|ой|ий))?\s*(?:day\b|день)/.exec(t);
    if (count) return { kind: 'count', n: Number(count[1] ?? count[2]) };
    const month = monthOf(t);
    if (month === undefined) return undefined;
    const year = /(\d{3,4})/.exec(t);
    const rest = year ? t.replace(year[0], ' ') : t;
    const day = /(\d{1,2})/.exec(rest);
    if (!day) return undefined;
    return calendar(month, Number(day[1]), year ? Number(year[1]) : undefined);
}

function calendar(m: number, d: number, y?: number): ParsedDate | undefined {
    if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
    return y === undefined ? { kind: 'calendar', m, d } : { kind: 'calendar', y, m, d };
}

/** Days from a to b (b later = positive); undefined when the two can't be compared. */
export function dayDiff(a: ParsedDate, b: ParsedDate): number | undefined {
    if (a.kind === 'count' && b.kind === 'count') return b.n - a.n;
    if (a.kind !== 'calendar' || b.kind !== 'calendar') return undefined;
    // A missing year on either side: compare within the year (models often drop it).
    const years = a.y !== undefined && b.y !== undefined ? (b.y - a.y) * 365 : 0;
    return years + dayOfYear(b) - dayOfYear(a);
}

const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

function dayOfYear(d: { m: number; d: number }): number {
    return MONTH_START[d.m - 1]! + d.d;
}

function sameText(a: string | undefined, b: string | undefined): boolean {
    return normalizeText(a ?? '') === normalizeText(b ?? '');
}

/**
 * Hours from prev to next. Dates give whole days; times add the hour difference. Without dates, a time that went
 * backwards means midnight passed. With the same date and an earlier time it is a correction: undefined.
 */
export function elapsedHours(prev: SceneMark, next: SceneMark): number | undefined {
    const tp = parseTime(prev.time);
    const tn = parseTime(next.time);
    const dp = parseDate(prev.date);
    const dn = parseDate(next.date);
    const days = dp && dn ? dayDiff(dp, dn) : undefined;
    if (days !== undefined) {
        const hours = days * 24 + (tp !== undefined && tn !== undefined ? tn - tp : 0);
        return hours >= 0 ? hours : undefined;
    }
    if (tp === undefined || tn === undefined) return undefined;
    const hasDates = !!prev.date?.trim() && !!next.date?.trim();
    // Different days we cannot count: unknown (sceneBreak treats it as a new day).
    if (hasDates && !sameText(prev.date, next.date)) return undefined;
    if (tn >= tp) return tn - tp;
    return hasDates ? undefined : tn + 24 - tp;
}

/** Same place, ignoring punctuation; a sub-place of the same place ("Tavern" → "Tavern, kitchen") counts as same. */
export function samePlace(a: string, b: string): boolean {
    const x = normalizeText(a);
    const y = normalizeText(b);
    if (x === y) return true;
    return x.length > 0 && y.length > 0 && (x.startsWith(`${y} `) || y.startsWith(`${x} `));
}

/**
 * Why the scene changed between two DES readings, or null. Missing values on either side never break a scene.
 * 'place' wins; then a skip of ≥ `hours` (default 3) is 'time', or 'date' from 24 h on; dates that differ but
 * cannot be counted ("Monday" → "Tuesday") are 'date' without hours. Going back in time is not a break.
 */
export function sceneBreak(prev: SceneMark, next: SceneMark, options: { hours?: number } = {}): SceneBreak | null {
    const threshold = options.hours ?? SCENE_SKIP_HOURS;
    const hours = elapsedHours(prev, next);
    const withHours = (reason: SceneBreak['reason']): SceneBreak =>
        hours !== undefined ? { reason, hours } : { reason };
    if (prev.place?.trim() && next.place?.trim() && !samePlace(prev.place, next.place)) return withHours('place');
    if (hours !== undefined && hours >= threshold) return withHours(hours >= 24 ? 'date' : 'time');
    if (prev.date?.trim() && next.date?.trim() && !sameText(prev.date, next.date) && hours === undefined) {
        const dp = parseDate(prev.date);
        const dn = parseDate(next.date);
        // Unparseable or incomparable dates that differ: a new day as far as we can tell.
        if (!dp || !dn || dayDiff(dp, dn) === undefined) return { reason: 'date' };
    }
    return null;
}

export function isNewScene(prev: SceneMark, next: SceneMark, options: { hours?: number } = {}): boolean {
    return sceneBreak(prev, next, options) !== null;
}

/* ------------------------------------------------------------------ scene end */

export interface EndSceneContext {
    /** Card profiles; the chat's extras are added automatically. */
    profiles: CharacterProfile[];
    /** Optional per-scene appetite reset owned by the appetite rules (§5.7: «не больше +2 за сцену»). */
    appetiteSceneEnd?: (characterId: string, appetiteId: string, state: AppetiteState) => AppetiteState;
}

export type SceneEndChange =
    | (StanceChange & { character: string })
    | { kind: 'mood-relaxed'; character: string; scene: number; from: MoodOctant; to: MoodOctant }
    | { kind: 'emotion-cleared'; character: string; scene: number; emotion: string };

/** Base stance of a tie: its own base, else the profile's base tie, else neutral. */
export function baseStanceOf(profile: CharacterProfile | undefined, tie: { target: string; base?: Stance }): Stance {
    return tie.base ?? profile?.ties.find((t) => t.target === tie.target)?.stance ?? 0;
}

/**
 * Ends the current scene: every tie ticks (relations.onSceneEnd), moods relax to the baseline, emotions clear,
 * scene fields reset (attention back to background), the scene counter goes up. Returns structured changes.
 */
export function endScene(state: ChatState, ctx: EndSceneContext): { state: ChatState; changes: SceneEndChange[] } {
    const profiles = new Map<string, CharacterProfile>();
    for (const p of [...ctx.profiles, ...state.extras]) profiles.set(p.id, p);
    const scene = state.scene;
    const changes: SceneEndChange[] = [];
    const characters: Record<string, CharacterState> = {};

    for (const [id, character] of Object.entries(state.characters)) {
        const profile = profiles.get(id);
        const ties: CharacterState['ties'] = {};
        for (const [key, tie] of Object.entries(character.ties)) {
            const r = onSceneEnd(tie, { scene, baseStance: baseStanceOf(profile, tie) });
            ties[key] = r.tie;
            for (const c of r.changes) changes.push({ ...c, character: id });
        }

        const baseline: Mood = profile?.core.baselineMood ?? character.mood;
        const mood = relaxMood(character.mood, baseline, 0, { sceneEnd: true });
        if (mood.octant !== character.mood.octant) {
            changes.push({ kind: 'mood-relaxed', character: id, scene, from: character.mood.octant, to: mood.octant });
        }

        const { emotion, ...rest } = character;
        if (emotion) changes.push({ kind: 'emotion-cleared', character: id, scene, emotion: emotion.type });

        let appetites = character.appetites;
        if (ctx.appetiteSceneEnd) {
            appetites = {};
            for (const [key, a] of Object.entries(character.appetites))
                appetites[key] = ctx.appetiteSceneEnd(id, key, a);
        }

        characters[id] = { ...rest, ties, mood, appetites, scene: { attention: 'background' } };
    }
    return { state: { ...state, characters, scene: scene + 1 }, changes };
}
