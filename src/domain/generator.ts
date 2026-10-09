// The generator (docs/model.md §10; research A1–A3, B2, B8, B12, C1): personalities for the people the story brings in
// and for the gaps the author left. Pure; the feature (src/features/generator) sends the requests and saves.
// - «Сначала выбор, потом текст» (§10.3, П7): values, temperament, drives, stance toward strangers, tactics, style,
//   initiative, persistence and mood are DRAWN from the role's priors and the world tone before any text exists; a new
//   character too close to someone present is drawn again (stricter when diversity is 'varied'), and among those present
//   at least one pair holds opposing values (ready friction). The model only writes text around the draw.
// - Levels (§10.2): a sketch is made here from role templates without any model; a draft and a portrait come from three
//   model candidates, one picked at random by weight. Promotion (scenes, interactions, canon, a pin) adds fields and
//   never rewrites them; a gap fill writes only empty fields. Author, user, story and locked fields are never touched.
// - Group rules (§4.5, В17): an individual matching a rule's holders draws its own appetite from it; a class target
//   spreads over everyone who fits (NPCs too), a player target reaches only someone who knows the player, and minors
//   never hold or receive sexual appetites.
// - The BunnyMo bridge (§10.5) lives in bunnymo-bridge.ts; tags read from an archive are applied here as hints.
import type { DramatisSettings, Rng } from '../shared/contracts';
import type { AppetiteStrength } from './appetites';
import { BUNNYMO_VOCABULARY, fieldsToTags, sheetTags, tagsToFields } from './bunnymo-bridge';
import type { TagFields } from './bunnymo-bridge';
import type { GenCandidate, GeneratorKind } from './generator-prompt';
import { SEXUAL_KINDS, desirability, drawFromRule, pickWeighted } from './group-rules';
import { DRIVES, HEXACO, MOODS, PLAYER_ID, STYLES, VALUES } from './model';
import type {
    Appetite,
    CharacterState,
    CharacterStats,
    AppetiteRule,
    CharacterProfile,
    Commitment,
    Coping,
    Drive,
    FieldMeta,
    Gaze,
    HexacoAxis,
    Level5,
    Lod,
    MoodOctant,
    Reason,
    Stance,
    Style,
    Tie,
    Value,
    WorldTone,
} from './model';
import {
    LIMITS,
    cleanList,
    cleanText,
    emptyProfile,
    emptyTie,
    getPath,
    isEmptyValue,
    isProtected,
    metaAt,
    normalizeAppetite,
    setMeta,
    setPath,
    slugId,
    textKey,
} from './profile-defaults';
import { UNKNOWN_ROLE, detectRole, rolePrior, stanceReason, stanceTell, toneStances } from './role-priors';
import type { Lang, RolePrior, RolePriors } from './role-priors';
import { clamp, clampStance, normalizeText } from './util';

export { BUNNYMO_VOCABULARY, fieldsToTags, sheetTags, tagsToFields };
export type { TagFields };
export * from './generator-prompt';

export type Diversity = DramatisSettings['diversity'];

/* ------------------------------------------------------------------ parameters */

/** What the dice chose for one character before any text (§10.3). */
export interface GenParams {
    role: string;
    /** Top three values by priority and the one they would sacrifice. */
    values: { top: Value[]; sacrifice: Value };
    /** All six axes, −2 … +2. */
    temperament: Record<HexacoAxis, Level5>;
    drives: { high: Drive[]; low: Drive[] };
    /** Stance toward strangers — the player too, at the first meeting. */
    stance: Stance;
    tactics: string[];
    /** How they pursue an appetite (V5 predator types). */
    style: Style;
    /** 0–10. */
    proactivity: number;
    commitment: Commitment;
    baselineMood: MoodOctant;
    /** The role obliges them to deal with newcomers. */
    duty: boolean;
}

/** What contrast needs to know about someone already present. */
export interface CastMember {
    id: string;
    /** Top values, priority order. */
    values: Value[];
    sacrifice?: Value;
    temperament: Partial<Record<HexacoAxis, Level5>>;
    tactics: string[];
}

export function castMember(profile: CharacterProfile): CastMember {
    const member: CastMember = {
        id: profile.id,
        values: [...profile.core.values.top],
        temperament: { ...profile.core.temperament },
        tactics: [...profile.core.tactics],
    };
    if (profile.core.values.sacrifice) member.sacrifice = profile.core.values.sacrifice;
    return member;
}

/* ------------------------------------------------------------------ the value circle (Schwartz) */

/** Steps between two values on the Schwartz circle (VALUES is in circle order): 0 … 5. */
export function valueCircleDistance(a: Value, b: Value): number {
    const d = Math.abs(VALUES.indexOf(a) - VALUES.indexOf(b));
    return Math.min(d, VALUES.length - d);
}

/** Values this far apart on the circle conflict (power ↔ universalism, tradition ↔ hedonism…). */
export const OPPOSED_DISTANCE = 4;

/** One of the two leading values of each is across the circle from the other's. */
export function valuesOppose(a: readonly Value[], b: readonly Value[]): boolean {
    for (const x of a.slice(0, 2))
        for (const y of b.slice(0, 2)) if (valueCircleDistance(x, y) >= OPPOSED_DISTANCE) return true;
    return false;
}

/** Some pair among these value lists opposes (empty lists never count). */
export function castHasOpposition(lists: readonly (readonly Value[])[]): boolean {
    const filled = lists.filter((list) => list.length > 0);
    for (let i = 0; i < filled.length; i++)
        for (let j = i + 1; j < filled.length; j++) if (valuesOppose(filled[i]!, filled[j]!)) return true;
    return false;
}

/* ------------------------------------------------------------------ distance */

const RANK_WEIGHT = [3, 2, 1];

/** 0 (same values in the same order) … 1 (nothing shared). */
export function valueDistance(a: readonly Value[], b: readonly Value[]): number {
    if (!a.length || !b.length) return 1;
    const weight = (list: readonly Value[], value: Value) => {
        const at = list.indexOf(value);
        return at < 0 ? 0 : (RANK_WEIGHT[at] ?? 0);
    };
    let shared = 0;
    for (const value of VALUES) shared += Math.min(weight(a, value), weight(b, value));
    return 1 - shared / 6;
}

/** Mean absolute difference over the six axes, 0 … 1 (missing axes count as 0). */
export function temperamentDistance(
    a: Partial<Record<HexacoAxis, number>>,
    b: Partial<Record<HexacoAxis, number>>,
): number {
    let sum = 0;
    for (const axis of HEXACO) sum += Math.abs((a[axis] ?? 0) - (b[axis] ?? 0));
    return sum / (HEXACO.length * 4);
}

/** How different a drawn character is from someone present: half values, half temperament, 0 … 1. */
export function paramsDistance(params: Pick<GenParams, 'values' | 'temperament'>, member: CastMember): number {
    const values = member.values.length ? valueDistance(params.values.top, member.values) : 1;
    return 0.5 * values + 0.5 * temperamentDistance(params.temperament, member.temperament);
}

/** Minimum distance to everyone present and the number of draws allowed, by the diversity lever (§14). */
export const CONTRAST: Readonly<Record<Diversity, { minDistance: number; attempts: number }>> = {
    even: { minDistance: 0.25, attempts: 6 },
    varied: { minDistance: 0.4, attempts: 12 },
};

/* ------------------------------------------------------------------ drawing */

/** Weighted draw without replacement. */
function drawDistinct<T extends string>(weights: Partial<Record<T, number>>, count: number, rng: Rng): T[] {
    const pool: Partial<Record<T, number>> = { ...weights };
    const out: T[] = [];
    while (out.length < count) {
        const pick = pickWeighted(pool, rng);
        if (!pick) break;
        out.push(pick);
        delete pool[pick];
    }
    return out;
}

function intBetween(min: number, max: number, rng: Rng): number {
    return Math.min(max, min + Math.floor(rng() * (max - min + 1)));
}

/** Axes the role says nothing about: most people sit near the middle. */
const BELL: Record<string, number> = { '-2': 1, '-1': 2, '0': 3, '1': 2, '2': 1 };

function drawTemperament(prior: RolePrior, rng: Rng): Record<HexacoAxis, Level5> {
    const out = {} as Record<HexacoAxis, Level5>;
    for (const axis of HEXACO) {
        const range = prior.temperament[axis];
        out[axis] = (range ? intBetween(range[0], range[1], rng) : Number(pickWeighted(BELL, rng) ?? 0)) as Level5;
    }
    return out;
}

function drawValues(prior: RolePrior, rng: Rng): GenParams['values'] {
    const top = drawDistinct<Value>(prior.values, 3, rng);
    const leader = top[0] ?? 'security';
    const rest: Partial<Record<Value, number>> = {};
    // What they would sacrifice sits across the circle from what they hold highest.
    for (const value of VALUES) if (!top.includes(value)) rest[value] = (1 + valueCircleDistance(leader, value)) ** 2;
    return { top, sacrifice: pickWeighted(rest, rng) ?? 'stimulation' };
}

function drawDrives(prior: RolePrior, rng: Rng): GenParams['drives'] {
    const high = drawDistinct<Drive>(prior.drives, rng() < 0.5 ? 2 : 3, rng);
    const rest: Partial<Record<Drive, number>> = {};
    // Indifference falls on what the role does not care about.
    for (const drive of DRIVES) if (!high.includes(drive)) rest[drive] = 1 / prior.drives[drive] ** 2;
    return { high, low: drawDistinct(rest, rng() < 0.6 ? 1 : 2, rng) };
}

/** Share of new faces who meet the player as his reputation among them says (§11 «Новые NPC начинают не с нуля»). */
export const REPUTATION_WEIGHT = 0.7;

function drawStance(tone: WorldTone, prior: RolePrior, rng: Rng, priors?: RolePriors, reputation?: Stance): Stance {
    let stance: number;
    if (reputation !== undefined && rng() < REPUTATION_WEIGHT) stance = reputation;
    else {
        const shares: Record<string, number> = {};
        for (const [key, weight] of Object.entries(toneStances(tone, priors))) shares[key] = weight ?? 0;
        stance = Number(pickWeighted(shares, rng) ?? 0);
    }
    if (prior.strangerBias !== 0 && rng() < Math.abs(prior.strangerBias)) stance += Math.sign(prior.strangerBias);
    return clampStance(stance);
}

/** Tactics anybody might use when the role's own are taken by those present. */
export const GENERAL_TACTICS = [
    'bluntness',
    'bargaining',
    'flattery',
    'lies by omission',
    'pressure',
    'evasion',
    'favours owed',
    'gossip',
    'silence',
    'charm',
];

function drawTactics(prior: RolePrior, cast: readonly CastMember[], rng: Rng): string[] {
    // §10.3: two NPCs in one scene never share a tactic.
    const used = new Set(cast.flatMap((member) => member.tactics.map(textKey)));
    let pool = prior.tactics.filter((tactic) => !used.has(textKey(tactic)));
    if (!pool.length) pool = GENERAL_TACTICS.filter((tactic) => !used.has(textKey(tactic)));
    if (!pool.length) pool = [...prior.tactics, ...GENERAL_TACTICS];
    const weights: Record<string, number> = {};
    for (const tactic of pool) weights[tactic] = 1;
    return drawDistinct(weights, rng() < 0.6 ? 1 : 2, rng);
}

function drawMood(prior: RolePrior, stance: Stance, rng: Rng): MoodOctant {
    const weights: Partial<Record<MoodOctant, number>> = { ...prior.moods };
    const bump = (octant: MoodOctant, by: number) => {
        weights[octant] = (weights[octant] ?? 0) + by;
    };
    if (stance < 0) {
        bump('hostile', -stance * 0.5);
        bump('disdainful', -stance * 0.5);
    } else if (stance > 0) {
        bump('relaxed', stance * 0.5);
        bump('exuberant', stance * 0.5);
    }
    return pickWeighted(weights, rng) ?? 'relaxed';
}

export interface SampleOptions {
    /** The stance his reputation gives a stranger of this character's groups (reputation.strangerStance). */
    reputation?: Stance;
    /** Priors other than the bundled ones (tests). */
    priors?: RolePriors;
}

function drawOnce(
    prior: RolePrior,
    tone: WorldTone,
    cast: readonly CastMember[],
    rng: Rng,
    options: SampleOptions,
): GenParams {
    const values = drawValues(prior, rng);
    const temperament = drawTemperament(prior, rng);
    const drives = drawDrives(prior, rng);
    const stance = drawStance(tone, prior, rng, options.priors, options.reputation);
    const tactics = drawTactics(prior, cast, rng);
    const style = pickWeighted(prior.styles, rng) ?? 'honest';
    const proactivity = intBetween(prior.proactivity[0], prior.proactivity[1], rng);
    const single = clamp(0.5 + 0.15 * temperament.conscientiousness, 0.1, 0.9);
    const commitment: Commitment = rng() < single ? 'single' : 'open';
    const baselineMood = drawMood(prior, stance, rng);
    return {
        role: prior.id,
        values,
        temperament,
        drives,
        stance,
        tactics,
        style,
        proactivity,
        commitment,
        baselineMood,
        duty: prior.duty,
    };
}

/**
 * Forces one opposing pair among those present: the drawn character's second value becomes one across the circle
 * from a present character's leading value (picked by the role's own weights, so a guard still sounds like a guard).
 */
function ensureOpposition(params: GenParams, members: readonly CastMember[], prior: RolePrior, rng: Rng): GenParams {
    const withValues = members.filter((member) => member.values.length);
    if (!withValues.length) return params;
    if (castHasOpposition([...withValues.map((member) => member.values), params.values.top])) return params;
    const other = withValues[Math.min(withValues.length - 1, Math.floor(rng() * withValues.length))]!;
    const anchor = other.values[0]!;
    const weights: Partial<Record<Value, number>> = {};
    for (const value of VALUES) {
        if (valueCircleDistance(anchor, value) >= OPPOSED_DISTANCE && value !== params.values.top[0]) {
            weights[value] = prior.values[value];
        }
    }
    const chosen = pickWeighted(weights, rng);
    if (!chosen) return params;
    const top = params.values.top.filter((value) => value !== chosen);
    if (top.length >= 2) top.splice(1, 0, chosen);
    else top.push(chosen);
    const values = { top: top.slice(0, 3), sacrifice: params.values.sacrifice };
    if (values.top.includes(values.sacrifice)) {
        values.sacrifice = VALUES.filter((value) => !values.top.includes(value)).reduce((best, value) =>
            valueCircleDistance(values.top[0]!, value) > valueCircleDistance(values.top[0]!, best) ? value : best,
        );
    }
    return { ...params, values };
}

/**
 * Draws a character's parameters for a role in a world of this tone (§10.3): values top 3 + sacrifice, temperament,
 * drives high/low, stance toward strangers, tactics (none shared with those present), style, proactivity,
 * persistence and baseline mood. Too close to someone present (values and temperament) → drawn again, up to the
 * lever's attempts, keeping the most distinct; then at least one pair with opposing values is ensured among those
 * present. Deterministic for a seeded rng.
 */
export function sampleParams(
    role: string,
    tone: WorldTone,
    cast: readonly CastMember[],
    rng: Rng,
    diversity: Diversity = 'varied',
    options: SampleOptions = {},
): GenParams {
    const prior = rolePrior(role, options.priors);
    const rule = CONTRAST[diversity] ?? CONTRAST.varied;
    const members = cast.filter((member) => member.values.length || Object.keys(member.temperament).length);
    const needsOpposition = members.some((member) => member.values.length > 0);
    let best: GenParams | null = null;
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < Math.max(1, rule.attempts); attempt++) {
        const params = drawOnce(prior, tone, cast, rng, options);
        const nearest = members.length ? Math.min(...members.map((member) => paramsDistance(params, member))) : 1;
        const opposes =
            !needsOpposition || castHasOpposition([...members.map((member) => member.values), params.values.top]);
        if (nearest >= rule.minDistance && opposes) return params;
        const score = nearest + (opposes ? 0.1 : 0);
        if (score > bestScore) {
            best = params;
            bestScore = score;
        }
    }
    return ensureOpposition(best!, members, prior, rng);
}

/** True for a field nobody filled in a fresh profile (a default value without meta). */
const DEFAULTED_PATHS = new Set([
    'core.proactivity',
    'core.commitment',
    'core.baselineMood',
    'core.arcLock',
    'core.corruption',
]);

/**
 * The parameters to write around for an existing character: what the profile already holds (author's, user's or an
 * earlier draw) wins over the fresh draw, so a promotion or a gap fill never contradicts what is there.
 */
export function paramsFromProfile(profile: CharacterProfile, sampled: GenParams): GenParams {
    const core = profile.core;
    const set = (path: string) => !!metaAt(profile, path);
    const temperament = { ...sampled.temperament };
    if (Object.keys(core.temperament).length || set('core.temperament')) {
        for (const axis of HEXACO) temperament[axis] = core.temperament[axis] ?? 0;
    }
    let values = sampled.values;
    if (core.values.top.length) {
        const sacrifice =
            core.values.sacrifice ??
            (core.values.top.includes(sampled.values.sacrifice)
                ? (VALUES.find((value) => !core.values.top.includes(value)) ?? sampled.values.sacrifice)
                : sampled.values.sacrifice);
        values = { top: [...core.values.top], sacrifice };
    }
    const player = profile.ties.find((tie) => tie.target === PLAYER_ID);
    return {
        role: profile.role ?? sampled.role,
        values,
        temperament,
        drives: core.drives.high.length || core.drives.low.length ? { ...core.drives } : sampled.drives,
        stance: player ? player.stance : sampled.stance,
        tactics: core.tactics.length ? [...core.tactics] : sampled.tactics,
        style: profile.appetites[0]?.style ?? sampled.style,
        proactivity: set('core.proactivity') ? core.proactivity : sampled.proactivity,
        commitment: set('core.commitment') ? core.commitment : sampled.commitment,
        baselineMood: set('core.baselineMood') ? core.baselineMood.octant : sampled.baselineMood,
        duty: sampled.duty,
    };
}

/* ------------------------------------------------------------------ sketches (no model) */

/** Marks a field written from a template: a placeholder that a draft or a portrait may replace. */
export const TEMPLATE_SOURCE = 'template';
/** Marks a field taken from BunnyMo tags. */
export const BUNNYMO_SOURCE = 'bunnymo';

export interface SketchContext {
    lang?: Lang;
    /** Profile id; else a slug of the name avoiding `taken`. */
    id?: string;
    taken?: Iterable<string>;
    gender?: 'female' | 'male';
    species?: string;
    minor?: boolean;
    /** What the chat shows them doing (DES); beats the template. */
    doing?: string;
    /** Template choice; without it a hash of the name decides (same name, same sketch). */
    rng?: Rng;
}

function seedOf(text: string): Rng {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    let state = h >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function choose(list: readonly string[], rng: Rng): string {
    if (!list.length) return '';
    return list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!;
}

function generated(sources?: string[]): FieldMeta {
    return sources ? { origin: 'generated', sources } : { origin: 'generated' };
}

/** The «stranger» reason behind a drawn stance toward the player (permanent, like an author reason). */
function strangerReason(stance: Stance, text: string): Reason {
    return { id: 'gen-stranger', text, delta: stance, scenesLeft: null, stacks: 1 };
}

/**
 * A sketch (§10.2): what they do, one want, their stance toward the player (a stranger) and one tell — from the
 * role's templates, no model — plus the drawn core, so contrast and later levels write around the same dice.
 * Template fields are placeholders (sources 'template'); the drawn ones are 'generated'.
 */
export function sketchProfile(name: string, params: GenParams, ctx: SketchContext = {}): CharacterProfile {
    const lang = ctx.lang ?? 'en';
    const rng = ctx.rng ?? seedOf(`${name}|${params.role}`);
    const prior = rolePrior(params.role);
    const base = emptyProfile(name, {
        ...(ctx.id ? { id: ctx.id } : {}),
        ...(ctx.taken ? { taken: ctx.taken } : {}),
        lod: 'sketch',
        ...(params.role !== UNKNOWN_ROLE ? { role: params.role } : {}),
    });
    const doing = cleanText(ctx.doing, LIMITS.short) || choose(prior.doing[lang], rng);
    const want = choose(prior.want[lang], rng);
    const tell = choose(prior.tell[lang], rng);
    const temperament: Partial<Record<HexacoAxis, Level5>> = {};
    for (const axis of HEXACO) if (params.temperament[axis] !== 0) temperament[axis] = params.temperament[axis];
    const tie: Tie = {
        ...emptyTie(PLAYER_ID, params.stance),
        reasons: [strangerReason(params.stance, stanceReason(params.stance, lang))],
        behaviour: stanceTell(params.stance, lang),
    };
    let profile: CharacterProfile = {
        ...base,
        ...(ctx.gender ? { gender: ctx.gender } : {}),
        ...(ctx.species ? { species: cleanText(ctx.species, LIMITS.name) } : {}),
        ...(ctx.minor ? { minor: true } : {}),
        core: {
            ...base.core,
            values: { top: [...params.values.top], sacrifice: params.values.sacrifice },
            temperament,
            drives: { high: [...params.drives.high], low: [...params.drives.low] },
            tactics: [...params.tactics],
            proactivity: params.proactivity,
            commitment: params.commitment,
            baselineMood: { octant: params.baselineMood },
            ...(want ? { want } : {}),
            signatures: tell ? [tell] : [],
        },
        ties: [tie],
        starts: [{ greeting: -1, present: true, ...(doing ? { doing } : {}) }],
    };
    for (const path of [
        'core.values',
        'core.temperament',
        'core.drives',
        'core.tactics',
        'core.proactivity',
        'core.commitment',
        'core.baselineMood',
    ]) {
        profile = setMeta(profile, path, generated());
    }
    for (const path of ['core.want', 'core.signatures', `ties.${PLAYER_ID}`]) {
        profile = setMeta(profile, path, generated([TEMPLATE_SOURCE]));
    }
    if (!ctx.doing) profile = setMeta(profile, 'starts', generated([TEMPLATE_SOURCE]));
    return profile;
}

/* ------------------------------------------------------------------ candidates */

/** Weight of a candidate: how well it fits × how far from the stock take (Verbalized Sampling's tail). */
export function candidateWeight(candidate: Pick<GenCandidate, 'fit' | 'typicality'>): number {
    const fit = clamp(Math.round(candidate.fit || 3), 1, 5);
    const typicality = clamp(Math.round(candidate.typicality || 3), 1, 5);
    return fit * (6 - typicality);
}

/** One of the model's candidates, at random by weight (§10.3 «движок берёт один случайно с весами»). */
export function pickCandidate<T extends Pick<GenCandidate, 'fit' | 'typicality'>>(
    candidates: readonly T[],
    rng: Rng,
): T | undefined {
    if (!candidates.length) return undefined;
    const weights: Record<string, number> = {};
    candidates.forEach((candidate, index) => {
        weights[String(index)] = candidateWeight(candidate);
    });
    const index = pickWeighted(weights, rng);
    return candidates[Number(index ?? 0)];
}

/* ------------------------------------------------------------------ writing generated fields */

const LOD_RANK: Record<Lod, number> = { sketch: 0, draft: 1, portrait: 2 };

/** Higher of two levels. */
export function maxLod(a: Lod, b: Lod): Lod {
    return LOD_RANK[b] > LOD_RANK[a] ? b : a;
}

/**
 * May the generator write this path? Never over a lock, a user edit, the author's or the story's value. Empty fields
 * and template placeholders are open; a default value nobody set (proactivity 5, mood «relaxed») counts as empty.
 * Promotion builds up, it does not rewrite: an earlier generated value stays.
 */
export function canGenerate(profile: CharacterProfile, path: string): boolean {
    if (isProtected(profile, path)) return false;
    const meta = metaAt(profile, path);
    if (meta && meta.origin !== 'generated') return false;
    if (meta?.sources?.includes(TEMPLATE_SOURCE)) return true;
    if (DEFAULTED_PATHS.has(path)) return !meta;
    return isEmptyValue(getPath(profile, path));
}

export interface ApplyGeneratedOptions {
    lod: Lod;
    origin: 'generated';
    /** The drawn parameters to write as well (values, temperament, drives, tactics, stance…). */
    params?: GenParams;
    lang?: Lang;
    /** Defence style from BunnyMo (MBTI -U): beats the candidate's. */
    coping?: Coping;
    /** A draft writes only a draft's fields (§10.2), whatever else the answer holds. */
    kind?: GeneratorKind;
}

/** The part of a candidate a draft may write: no wound, red lines, voice, dream, intentions, secrets or appetites. */
function draftPart(candidate: GenCandidate): GenCandidate {
    const { wound: _wound, ...rest } = candidate;
    return {
        ...rest,
        dream: '',
        intentions: [],
        redLines: { never: [], would: [] },
        voice: '',
        secrets: [],
        leverage: [],
        resources: [],
        ifIgnored: '',
        appetites: [],
    };
}

export interface ApplyGeneratedResult {
    profile: CharacterProfile;
    /** Paths written. */
    written: string[];
}

/** Signatures kept per level (§10.2: a draft has two). */
const SIGNATURES: Record<Lod, number> = { sketch: 1, draft: 2, portrait: LIMITS.signatures };

/**
 * Writes a picked candidate (and the parameters) into a profile where the generator may write (canGenerate): a sketch
 * gains a draft's or a portrait's fields, an authored character gets only its gaps. Raises the level, never lowers it.
 */
export function applyGenerated(
    start: CharacterProfile,
    input: GenCandidate,
    options: ApplyGeneratedOptions,
): ApplyGeneratedResult {
    const candidate = options.kind === 'draft' ? draftPart(input) : input;
    let profile = start;
    const written: string[] = [];
    const lang = options.lang ?? 'en';
    const write = (path: string, value: unknown) => {
        if (isEmptyValue(value) || !canGenerate(profile, path)) return;
        profile = setMeta(setPath(profile, path, value), path, generated());
        written.push(path);
    };
    const params = options.params;
    if (params) {
        write('core.values', { top: [...params.values.top], sacrifice: params.values.sacrifice });
        const temperament: Partial<Record<HexacoAxis, Level5>> = {};
        for (const axis of HEXACO) if (params.temperament[axis] !== 0) temperament[axis] = params.temperament[axis];
        write('core.temperament', temperament);
        write('core.drives', { high: [...params.drives.high], low: [...params.drives.low] });
        write('core.tactics', [...params.tactics]);
        write('core.proactivity', params.proactivity);
        write('core.commitment', params.commitment);
        const label = cleanText(candidate.moodLabel, LIMITS.name);
        write('core.baselineMood', label ? { octant: params.baselineMood, label } : { octant: params.baselineMood });
    }
    const core = profile.core;
    write('core.concept', cleanText(candidate.concept, LIMITS.short));
    write('core.want', cleanText(candidate.want));
    write('core.need', cleanText(candidate.need));
    if (candidate.wound && cleanText(candidate.wound.ghost)) {
        const coping = options.coping ?? (candidate.wound.coping || 'avoid');
        write('core.wound', {
            ghost: cleanText(candidate.wound.ghost),
            lie: cleanText(candidate.wound.lie),
            triggers: cleanList(candidate.wound.triggers, LIMITS.triggers),
            coping,
        });
    }
    write(
        'core.signatures',
        cleanList(candidate.signatures, SIGNATURES[maxLod(profile.lod, options.lod)], LIMITS.text),
    );
    write('core.keys', cleanList(candidate.keys, LIMITS.keys));
    const never = cleanList(candidate.redLines.never, LIMITS.redLines);
    const would = cleanList(candidate.redLines.would, LIMITS.redLines);
    if (never.length || would.length) write('core.redLines', { never, would });
    write('core.voice', cleanText(candidate.voice, LIMITS.short));
    // The mood label alone, when the octant was there already (a sketch's draw).
    const label = cleanText(candidate.moodLabel, LIMITS.name);
    if (label && !core.baselineMood.label && !written.includes('core.baselineMood')) {
        const meta = metaAt(profile, 'core.baselineMood');
        if (meta?.origin === 'generated' && !isProtected(profile, 'core.baselineMood')) {
            profile = setPath(profile, 'core.baselineMood', { ...profile.core.baselineMood, label });
            written.push('core.baselineMood.label');
        }
    }

    write('agenda.dream', cleanText(candidate.dream));
    write(
        'agenda.goals',
        candidate.goals
            .map((goal) => ({ ...goal, text: cleanText(goal.text) }))
            .filter((goal) => goal.text)
            .slice(0, LIMITS.goals)
            .map((goal, i) => ({
                id: `g${i + 1}`,
                text: goal.text,
                kind: goal.kind,
                priority: clamp(goal.priority, 1, 3),
            })),
    );
    write(
        'agenda.intentions',
        candidate.intentions
            .map((item) => ({
                text: cleanText(item.text),
                nextStep: cleanText(item.nextStep, LIMITS.short),
                dropIf: cleanList(item.dropIf, 4),
            }))
            .filter((item) => item.text)
            .slice(0, LIMITS.intentions)
            .map((item, i) => ({ id: `i${i + 1}`, ...item })),
    );
    write('agenda.secrets', cleanList(candidate.secrets, LIMITS.agendaList, LIMITS.text));
    write('agenda.leverage', cleanList(candidate.leverage, LIMITS.agendaList));
    write('agenda.resources', cleanList(candidate.resources, LIMITS.agendaList));
    write('agenda.ifIgnored', cleanText(candidate.ifIgnored));

    /* where they are when met: the «any greeting» start */
    const doing = cleanText(candidate.doing, LIMITS.short);
    const goal = cleanText(candidate.sceneGoal, LIMITS.short);
    if ((doing || goal) && canGenerate(profile, 'starts')) {
        const others = profile.starts.filter((start) => start.greeting !== -1);
        const old = profile.starts.find((start) => start.greeting === -1);
        const any: CharacterProfile['starts'][number] = { greeting: -1, present: old?.present ?? true };
        const keptDoing = doing || old?.doing;
        const keptGoal = goal || old?.goal;
        if (keptDoing) any.doing = keptDoing;
        if (keptGoal) any.goal = keptGoal;
        profile = setMeta({ ...profile, starts: [...others, any] }, 'starts', generated());
        written.push('starts');
    }

    /* the stance toward the player: the drawn one, with the candidate's words for it */
    const tiePath = `ties.${PLAYER_ID}`;
    const behaviour = cleanText(candidate.stanceBehaviour, LIMITS.short);
    const reasonText = cleanText(candidate.stanceReason, LIMITS.short);
    if ((params || behaviour) && canGenerate(profile, tiePath)) {
        const existing = profile.ties.find((tie) => tie.target === PLAYER_ID);
        // A drawn stance already on the tie stays: the candidate only words it.
        const stance = existing?.stance ?? params?.stance;
        if (stance !== undefined) {
            const kept = (existing?.reasons ?? []).filter((reason) => reason.id !== 'gen-stranger');
            const text = reasonText || existing?.reasons.find((reason) => reason.id === 'gen-stranger')?.text;
            const tie: Tie = {
                ...(existing ?? emptyTie(PLAYER_ID, stance)),
                stance,
                reasons: [strangerReason(stance, text || stanceReason(stance, lang)), ...kept].slice(0, LIMITS.reasons),
            };
            const words = behaviour || existing?.behaviour || stanceTell(stance, lang);
            if (words) tie.behaviour = words;
            profile = setMeta(setPath(profile, tiePath, tie), tiePath, generated());
            written.push(tiePath);
        }
    }

    /* appetites the candidate gives (portraits), never a sexual one for a minor */
    for (const raw of candidate.appetites) {
        if (raw.baseline <= 0) continue;
        if (profile.minor && SEXUAL_KINDS.includes(raw.kind)) continue;
        if (profile.appetites.some((appetite) => appetite.kind === raw.kind)) continue;
        const id = slugId(
            raw.kind,
            profile.appetites.map((appetite) => appetite.id),
        );
        const appetite = normalizeAppetite({
            id,
            kind: raw.kind,
            label: raw.label || undefined,
            sources: ['individual'],
            target:
                raw.target === 'class' && raw.targetClass
                    ? { mode: 'class', class: raw.targetClass }
                    : { mode: 'thing' },
            baseline: raw.baseline,
            triggers: raw.triggers,
            satisfiers: [],
            style: params?.style,
            excuse: raw.excuse || undefined,
        });
        if (appetite) write(`appetites.${id}`, appetite);
    }

    if (LOD_RANK[options.lod] > LOD_RANK[profile.lod]) {
        profile = { ...profile, lod: options.lod };
        written.push('lod');
    }
    return { profile, written };
}

/**
 * BunnyMo tags of the character's CK archive as hints (§10.5): an archive is someone's deliberate choice, so it beats
 * the dice (fields the generator drew may change) but never the author, the story or the user. Empty fields are
 * filled; temperament axes and dark traits merge.
 */
export function applyTagFields(start: CharacterProfile, fields: TagFields): ApplyGeneratedResult {
    let profile = start;
    const written: string[] = [];
    const canHint = (path: string) => {
        if (isProtected(profile, path)) return false;
        const meta = metaAt(profile, path);
        return !meta || meta.origin === 'generated';
    };
    const write = (path: string, value: unknown) => {
        if (isEmptyValue(value) || !canHint(path)) return;
        profile = setMeta(setPath(profile, path, value), path, generated([BUNNYMO_SOURCE]));
        written.push(path);
    };
    if (fields.species && !profile.species) {
        profile = { ...profile, species: fields.species };
        written.push('species');
    }
    if (fields.gender && !profile.gender) {
        profile = { ...profile, gender: fields.gender };
        written.push('gender');
    }
    if (fields.attachment) write('core.attachment', fields.attachment);
    if (Object.keys(fields.temperament).length) {
        write('core.temperament', { ...profile.core.temperament, ...fields.temperament });
    }
    if (Object.values(fields.dark).some(Boolean)) write('core.dark', { ...(profile.core.dark ?? {}), ...fields.dark });
    if (fields.keys.length) write('core.keys', cleanList([...profile.core.keys, ...fields.keys], LIMITS.keys));
    if (fields.tactics.length)
        write('core.tactics', cleanList([...fields.tactics, ...profile.core.tactics], LIMITS.tactics));
    if (fields.coping && profile.core.wound) write('core.wound', { ...profile.core.wound, coping: fields.coping });
    for (const appetite of fields.appetites) {
        if (profile.minor && SEXUAL_KINDS.includes(appetite.kind)) continue;
        if (profile.appetites.some((other) => other.kind === appetite.kind)) continue;
        const id = slugId(
            appetite.kind,
            profile.appetites.map((other) => other.id),
        );
        write(`appetites.${id}`, { ...appetite, id });
    }
    return { profile, written };
}

/* ------------------------------------------------------------------ gaps */

/** Fields a gap fill looks at (§10.1 «Дописывает прописанных»). */
export const GAP_PATHS = [
    'core.concept',
    'core.values',
    'core.temperament',
    'core.drives',
    'core.want',
    'core.need',
    'core.signatures',
    'core.tactics',
    'core.keys',
    'core.wound',
    'core.redLines',
    'core.voice',
    'agenda.dream',
    'agenda.goals',
] as const;

/** The core of the core: when any of these is empty the character needs a fill. */
export const CORE_GAPS: readonly string[] = [
    'core.values',
    'core.temperament',
    'core.drives',
    'core.want',
    'core.signatures',
    'core.tactics',
    'core.keys',
];

/** Gap paths the generator may still fill. */
export function missingFields(profile: CharacterProfile): string[] {
    return GAP_PATHS.filter((path) => canGenerate(profile, path) && isEmptyValue(getPath(profile, path)));
}

/** A character whose core has holes the generator may fill (groups are left to the author). */
export function needsFill(profile: CharacterProfile): boolean {
    if (profile.kind === 'group') return false;
    const missing = missingFields(profile);
    return CORE_GAPS.some((path) => missing.includes(path));
}

/* ------------------------------------------------------------------ promotion */

export interface PromotionStats {
    lod: Lod;
    /** Distinct scenes they were present in. */
    scenes: number;
    /** Turns the player addressed them directly. */
    interactions: number;
    /** They entered a quest. */
    quest?: boolean;
    /** They are in the canon (Maestro's world model knows them). */
    canon?: boolean;
    /** The user pinned them. */
    pinned?: boolean;
}

/** Thresholds of §10.2 «Повышение уровня». */
export const PROMOTION = {
    draftScenes: 3,
    draftInteractions: 4,
    portraitScenes: 6,
    portraitInteractions: 10,
    /** Canon alone is not enough: Maestro's world model may know anyone named once. */
    canonScenes: 2,
} as const;

/** The level a character has earned, when above the current one; null otherwise. */
export function shouldPromote(stats: PromotionStats): Lod | null {
    let target: Lod = 'sketch';
    if (stats.pinned) target = 'portrait';
    else if (
        stats.scenes >= PROMOTION.portraitScenes ||
        stats.interactions >= PROMOTION.portraitInteractions ||
        ((stats.quest || stats.canon) && stats.scenes >= PROMOTION.draftScenes)
    ) {
        target = 'portrait';
    } else if (
        stats.scenes >= PROMOTION.draftScenes ||
        stats.interactions >= PROMOTION.draftInteractions ||
        stats.quest ||
        (stats.canon && stats.scenes >= PROMOTION.canonScenes)
    ) {
        target = 'draft';
    }
    return LOD_RANK[target] > LOD_RANK[stats.lod] ? target : null;
}

/**
 * Counts one committed turn: a new scene for someone present (the scene counter moved, or they are back after being
 * absent), an interaction when the player addressed them while present.
 */
export function countTurn(
    stats: CharacterStats | undefined,
    scene: number,
    present: boolean,
    addressed: boolean,
): CharacterStats {
    const next: CharacterStats = stats ? { ...stats } : { scenes: 0, lastScene: -1, interactions: 0 };
    // A new scene: the scene counter moved, or they come back after being away (when no scene pass runs).
    if (present && (next.lastScene !== scene || next.present === false)) {
        next.scenes += 1;
        next.lastScene = scene;
    }
    next.present = present;
    if (present && addressed) next.interactions += 1;
    return next;
}

function startOf(profile: CharacterProfile | null): CharacterProfile['starts'][number] | undefined {
    return profile?.starts.find((start) => start.greeting === -1);
}

/**
 * Carries what a promotion or a fill added into the live state of the chat, where the story has not changed it yet:
 * new appetites get their pressure, a template «doing» and the stranger tie's words are replaced, an agenda field the
 * story left empty is copied. Story changes always stay.
 */
export function syncLiveState(
    live: CharacterState,
    before: CharacterProfile | null,
    after: CharacterProfile,
): CharacterState {
    const next: CharacterState = structuredClone(live);
    for (const appetite of after.appetites) {
        if (next.appetites[appetite.id]) continue;
        next.appetites[appetite.id] = {
            pressure: appetite.baseline,
            tolerance: appetite.tolerance,
            dependence: appetite.dependence,
            sensitization: appetite.sensitization,
            lastSated: -1,
            edgeCount: 0,
            withdrawal: false,
        };
    }
    const oldDoing = startOf(before)?.doing;
    const newDoing = startOf(after)?.doing;
    if (newDoing && (!next.scene.doing || next.scene.doing === oldDoing)) next.scene.doing = newDoing;
    const newGoal = startOf(after)?.goal;
    if (newGoal && !next.scene.goal) next.scene.goal = newGoal;
    const tie = after.ties.find((item) => item.target === PLAYER_ID);
    const oldTie = before?.ties.find((item) => item.target === PLAYER_ID);
    const liveTie = next.ties[PLAYER_ID];
    if (tie && !liveTie) {
        next.ties[PLAYER_ID] = structuredClone(tie);
        next.knowsPlayer = true;
    } else if (tie && liveTie && liveTie.stance === tie.stance && liveTie.behaviour === oldTie?.behaviour) {
        const reasons = liveTie.reasons.map((reason) =>
            reason.id === 'gen-stranger' ? (tie.reasons.find((item) => item.id === 'gen-stranger') ?? reason) : reason,
        );
        next.ties[PLAYER_ID] = { ...liveTie, reasons, ...(tie.behaviour ? { behaviour: tie.behaviour } : {}) };
    }
    const agenda = next.agenda as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(after.agenda)) {
        if (isEmptyValue(agenda[key]) && !isEmptyValue(value)) agenda[key] = structuredClone(value);
    }
    return next;
}

/* ------------------------------------------------------------------ group rules */

const HOLDER_STOP = new Set([
    'the',
    'all',
    'every',
    'each',
    'any',
    'of',
    'and',
    'in',
    'from',
    'who',
    'все',
    'всех',
    'весь',
    'вся',
    'каждый',
    'каждая',
    'каждое',
    'любой',
    'любая',
    'из',
    'и',
    'в',
]);
const GENERIC_WORDS = [
    'people',
    'person',
    'folk',
    'anyone',
    'everyone',
    'strangers',
    'stranger',
    'travellers',
    'travelers',
    'traveller',
    'traveler',
    'outsiders',
    'outsider',
    'newcomers',
    'люди',
    'людей',
    'путник*',
    'чужак*',
    'чужаки',
    'приезж*',
    'странник*',
];
const MALE_WORDS = ['man', 'men', 'male', 'males', 'guy', 'guys', 'мужчин*', 'мужик*', 'парн*', 'парен*', 'самц*'];
const FEMALE_WORDS = ['woman', 'women', 'female', 'females', 'девушк*', 'женщин*', 'баб*', 'самк*'];
const HUMAN_WORDS = ['human', 'humans', 'mortal', 'mortals', 'человек*', 'человеч*', 'люд*'];

function tokens(text: string): string[] {
    return normalizeText(text)
        .split(' ')
        .filter((word) => word && !HOLDER_STOP.has(word));
}

function inList(token: string, list: readonly string[]): boolean {
    return list.some((word) => (word.endsWith('*') ? token.startsWith(word.slice(0, -1)) : token === word));
}

/** Same word up to an ending: «goblins» ~ «goblin», «гоблины» ~ «гоблин», «lamias» ~ «lamia». */
function sameStem(a: string, b: string): boolean {
    if (a === b) return true;
    const short = a.length <= b.length ? a : b;
    const long = a.length <= b.length ? b : a;
    if (short.length < 4) return false;
    let common = 0;
    while (common < short.length && short[common] === long[common]) common++;
    return common >= Math.max(4, short.length - 1) && long.length - common <= 3;
}

/** Labels a character answers to for a rule: species, role, the role's own words, the groups they belong to. */
function labelsOf(profile: Pick<CharacterProfile, 'species' | 'role'>, groups: readonly string[]): string[] {
    return [profile.species ?? '', profile.role ?? '', ...groups].flatMap(tokens);
}

/** Does a rule's «holders» («гоблины-налётчики», "the garrison guards") describe this character? */
export function holderMatches(holders: string, profile: CharacterProfile, groups: readonly string[] = []): boolean {
    const words = tokens(holders);
    if (!words.length) return false;
    const labels = labelsOf(profile, groups);
    if (words.some((word) => labels.some((label) => sameStem(word, label)))) return true;
    const role = detectRole([holders]);
    return role !== UNKNOWN_ROLE && role === profile.role;
}

export interface RulePerson {
    id: string;
    species?: string;
    role?: string;
    gender?: 'female' | 'male';
    minor?: boolean;
    groups?: string[];
}

/**
 * Does someone fit a rule's class target («human men», «чужаки»)? Gender words must match a known gender (the player,
 * whose gender is often unknown, gets the benefit of the doubt); other words must match species, role or a group —
 * an unknown species counts as human. Generic words (people, strangers) fit everyone.
 */
export function fitsClass(label: string, person: RulePerson): boolean {
    const words = tokens(label);
    const male = words.some((word) => inList(word, MALE_WORDS));
    const female = words.some((word) => inList(word, FEMALE_WORDS));
    if (male !== female) {
        const wanted = male ? 'male' : 'female';
        if (person.gender ? person.gender !== wanted : person.id !== PLAYER_ID) return false;
    }
    const content = words.filter(
        (word) => !inList(word, MALE_WORDS) && !inList(word, FEMALE_WORDS) && !inList(word, GENERIC_WORDS),
    );
    if (!content.length) return true;
    const labels = labelsOf(person, person.groups ?? []);
    const human = !person.species || tokens(person.species).some((word) => inList(word, HUMAN_WORDS));
    return content.some(
        (word) =>
            labels.some((label) => sameStem(word, label)) ||
            (human && inList(word, HUMAN_WORDS)) ||
            (person.role !== undefined && detectRole([word]) === person.role),
    );
}

/** How a pursuit style looks at its target (§4.5 «Взгляд»). */
export const STYLE_GAZE: Readonly<Record<Style, Gaze>> = {
    siren: 'prize',
    buyer: 'instrument',
    insider: 'instrument',
    spider: 'prey',
    raider: 'prey',
    shadow: 'prey',
    shepherd: 'property',
    duelist: 'mate',
    honest: 'person',
};

/** Base ties a rule writes at most per holder (the rest of a class stays in `targets`, wanted when met). */
export const RULE_TIES = 6;

export interface RuleContext {
    /** Everyone a class target may fall on: the cast (profiles and extras) and the player. */
    population: readonly RulePerson[];
    /** Has this character seen or heard of the player (CharacterState.knowsPlayer, rumours)? */
    knowsPlayer: (id: string) => boolean;
    /** Groups a character belongs to (group profiles, factions). */
    groups?: (id: string) => string[];
    strength?: AppetiteStrength;
    /** Only these holders (a new extra); default every character. */
    only?: readonly string[];
}

export interface RuleGrant {
    holder: string;
    rule: string;
    /** Appetite id on the holder. */
    appetite: string;
    pressure: number;
    /** Everyone it points at (class: every fitting candidate; player: him, if known). */
    targets: string[];
}

export interface RuleApplication {
    profiles: CharacterProfile[];
    grants: RuleGrant[];
}

/**
 * Applies group / species / world rules to individuals (§4.5, В17) with group-rules.drawFromRule: each matching
 * character (by species, role or group) without an appetite of that rule yet draws its own — strength with real
 * zeros, style, targets. Idempotent: a holder who already drew from a rule (even a zero) is skipped. Desire toward up
 * to RULE_TIES targets is written on the base ties; protected appetites or ties are left alone.
 */
export function applyRules(
    profiles: readonly CharacterProfile[],
    rules: readonly AppetiteRule[],
    ctx: RuleContext,
    rng: Rng,
): RuleApplication {
    const grants: RuleGrant[] = [];
    const only = ctx.only ? new Set(ctx.only) : null;
    const out = profiles.map((start) => {
        if (start.kind === 'group' || (only && !only.has(start.id))) return start;
        let profile = start;
        const groups = ctx.groups?.(profile.id) ?? [];
        for (const rule of rules) {
            if (!holderMatches(rule.holders, profile, groups)) continue;
            if (profile.appetites.some((appetite) => appetite.rule === rule.id)) continue;
            if (isProtected(profile, 'appetites')) continue;
            const candidates =
                rule.target.mode === 'class'
                    ? ctx.population
                          .filter(
                              (person) =>
                                  person.id !== profile.id &&
                                  rule.target.mode === 'class' &&
                                  fitsClass(rule.target.class, person),
                          )
                          .map((person) => ({ id: person.id, ...(person.minor ? { minor: true } : {}) }))
                    : [];
            const drawn = drawFromRule(
                rule,
                {
                    id: profile.id,
                    knowsPlayer: ctx.knowsPlayer(profile.id),
                    ...(profile.minor ? { minor: true } : {}),
                },
                rng,
                { candidates, ...(ctx.strength ? { strength: ctx.strength } : {}) },
            );
            if (!drawn) continue;
            const id = slugId(
                drawn.appetite.id,
                profile.appetites.map((appetite) => appetite.id),
            );
            const appetite: Appetite = { ...drawn.appetite, id };
            profile = setMeta(
                { ...profile, appetites: [...profile.appetites, appetite] },
                `appetites.${id}`,
                generated(),
            );
            grants.push({
                holder: profile.id,
                rule: rule.id,
                appetite: id,
                pressure: drawn.pressure,
                targets: drawn.targets,
            });
            if (appetite.baseline <= 0) continue;
            const byId = new Map(ctx.population.map((person) => [person.id, person] as const));
            const wanted = drawn.targets
                .map((target) => ({
                    target,
                    want: desirability(
                        { kind: rule.kind, choosiness: rule.choosiness },
                        { value: 3, ...(byId.get(target)?.minor ? { minor: true } : {}) },
                        { pressure: drawn.pressure, available: drawn.targets.length },
                    ),
                    order: rng(),
                }))
                .filter((item) => item.want > 0)
                .sort((a, b) => (a.target === PLAYER_ID ? -1 : b.target === PLAYER_ID ? 1 : a.order - b.order))
                .slice(0, RULE_TIES);
            const gaze: Gaze =
                rule.kind === 'flesh' &&
                rule.source === 'species' &&
                (appetite.style === 'honest' || appetite.style === 'duelist')
                    ? 'mate'
                    : STYLE_GAZE[appetite.style];
            for (const { target, want } of wanted) {
                const path = `ties.${target}`;
                if (isProtected(profile, path)) continue;
                const existing = profile.ties.find((tie) => tie.target === target);
                if (existing && existing.want !== undefined) continue;
                const tie: Tie = { ...(existing ?? emptyTie(target)), want, gaze, appetite: id };
                profile = setPath(profile, path, tie);
                if (!existing) profile = setMeta(profile, path, generated());
            }
        }
        return profile;
    });
    return { profiles: out, grants };
}

/** Every value of the enums the generator draws from (tests, UI). */
export const DRAWN = { values: VALUES, drives: DRIVES, hexaco: HEXACO, moods: MOODS, styles: STYLES } as const;
