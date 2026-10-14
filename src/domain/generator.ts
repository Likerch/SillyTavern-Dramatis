// The generator (docs/model.md §10; research A1–A3, B2, B8, B12, C1): personalities for the people the story brings in
// and for the gaps the author left. Pure; the feature (src/features/generator) sends the requests and saves.
// - «Сначала выбор, потом текст» (§10.3, П7): values, temperament, drives, stance toward strangers, tactics, style,
//   initiative, persistence and mood are DRAWN from the role's priors and the world tone before any text exists; a new
//   character too close to someone present is drawn again (stricter when diversity is 'varied'), and among those present
//   at least one pair holds opposing values (ready friction). The model only writes text around the draw.
// - Levels (§10.2): a sketch is made here from role templates without any model; a draft and a portrait come from three
//   model candidates, one picked at random by weight. Promotion (scenes, interactions, canon, a pin) adds fields and
//   never rewrites them; a gap fill writes only the empty fields it asked for. Author, inferred, user, story and locked
//   fields are never touched.
// - New faces on the story (§10.2 «Эскиз по истории»): the stance toward the player comes from what the story showed
//   (newcomer facts, origin 'story'), then the reputation of the face's groups, then a world rule aimed at the player
//   (wanting, not hating), then a mild default — the tone's dice only for a stranger, hostility at −2/−3 only with a
//   reason (StanceBasis). The dice's and the templates' fields are provisional guesses (sources 'dice', 'template',
//   'default'): a grounded promotion (applyGenerated `ground`) may replace them with what the model read from the
//   story ('grounded'); the repair of faces an older build drew (needsGrounding) takes every generated field as a
//   guess; later facts ground a face without a model (groundWithFacts).
// - Authored characters (a card character the reading or the card's text knows: isAuthored) get no dice: their gaps,
//   the core included, are filled from the card's own text (groundedPaths, generator-prompt.ts groundedMessages).
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
    NewcomerFacts,
    Reason,
    Stance,
    Style,
    Tie,
    TieIntent,
    Value,
    WorldTone,
} from './model';
import {
    DEFAULT_SOURCE,
    DICE_SOURCE,
    GROUNDED_SOURCE,
    REPUTATION_SOURCE,
    RELATION_STANCE,
    relationGroups,
    TEMPLATE_SOURCE,
    WORLD_SOURCE,
    isProvisional,
    relationWords,
    storyRelation,
} from './newcomers';
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
import { presentFromText } from './presence';

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
    /** Where the stance toward the player came from (sampleParams); absent: a stranger's dice (older callers). */
    basis?: StanceBasis;
    /**
     * The parameters the story, the author or the user decided (paramsFromProfile): only these must hold; the rest are
     * the dice's provisional guesses a promotion may replace. Absent: every parameter is fixed (the dice prompt).
     */
    fixed?: ParamKey[];
}

/** One parameter of GenParams as a promotion sees it: fixed or a provisional guess. */
export type ParamKey =
    | 'role'
    | 'values'
    | 'temperament'
    | 'drives'
    | 'stance'
    | 'tactics'
    | 'style'
    | 'proactivity'
    | 'commitment'
    | 'baselineMood';

/**
 * Why a new face meets the player as it does (docs/model.md §10.2 «Эскиз по истории»), in this order: what the story
 * showed (the relation and its stance, origin 'story'); the reputation of the player among their groups; what the
 * world's rules make of him for them (an appetite rule aimed at his class: they want him, they need not hate him);
 * a mild default when nothing is known; the tone's dice only for a stranger.
 */
export interface StanceBasis {
    source: 'story' | 'reputation' | 'world' | 'default' | 'dice';
    stance: Stance;
    /** The reason in story words (the story's, the reputation's label, the rule's words); none for a default. */
    reason?: string;
    /** story: who read it. */
    read?: NewcomerFacts['source'];
    /** world: how the rule makes them look at the player, and the rule. */
    gaze?: Gaze;
    rule?: string;
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

/**
 * Share of new faces who meet the player as his reputation among them says when nothing grounds the sketch (an older
 * caller without facts). A grounded sketch follows the reputation of its groups always (§11 «Новые NPC начинают не с
 * нуля»).
 */
export const REPUTATION_WEIGHT = 0.7;

function toneStance(tone: WorldTone, rng: Rng, priors?: RolePriors): number {
    const shares: Record<string, number> = {};
    for (const [key, weight] of Object.entries(toneStances(tone, priors))) shares[key] = weight ?? 0;
    return Number(pickWeighted(shares, rng) ?? 0);
}

/**
 * The tone's dice for a stranger. `floor`: the lowest stance the dice may give (a grounded stranger outside a hostile
 * world: hostility at −2/−3 needs a story or a world reason).
 */
function drawStance(
    tone: WorldTone,
    prior: RolePrior,
    rng: Rng,
    priors?: RolePriors,
    reputation?: Stance,
    floor = -3,
): Stance {
    let stance: number;
    const known = reputation !== undefined && rng() < REPUTATION_WEIGHT;
    if (known) stance = reputation;
    else stance = toneStance(tone, rng, priors);
    if (prior.strangerBias !== 0 && rng() < Math.abs(prior.strangerBias)) stance += Math.sign(prior.strangerBias);
    // The floor holds the dice, not what his reputation says.
    return clampStance(known ? stance : Math.max(floor, stance));
}

/** How an appetite rule aimed at the player makes a holder look at him, and what they mean to do. */
export interface PlayerRule {
    rule: AppetiteRule;
    gaze: Gaze;
}

/** The style a rule gives most of its holders. */
function leadingStyle(rule: AppetiteRule): Style {
    let best: Style = 'honest';
    let weight = 0;
    for (const style of STYLES) {
        const value = rule.styles[style] ?? 0;
        if (value > weight) {
            best = style;
            weight = value;
        }
    }
    return best;
}

/**
 * The first world / group / species rule this person holds (species, role, role words, groups) that aims at the
 * player: his class («humans», «чужаки») or him by name. Sexual rules never for a minor. Null when none does.
 */
export function playerRuleFor(
    rules: readonly AppetiteRule[],
    person: Pick<CharacterProfile, 'species' | 'role' | 'groups' | 'minor'>,
    player: RulePerson = { id: PLAYER_ID },
): PlayerRule | null {
    for (const rule of rules) {
        if (person.minor && SEXUAL_KINDS.includes(rule.kind)) continue;
        if (!holderMatches(rule.holders, person)) continue;
        const aimed =
            rule.target.mode === 'player' || (rule.target.mode === 'class' && fitsClass(rule.target.class, player));
        if (!aimed) continue;
        const style = leadingStyle(rule);
        const gaze: Gaze =
            rule.kind === 'flesh' && rule.source === 'species' && (style === 'honest' || style === 'duelist')
                ? 'mate'
                : STYLE_GAZE[style];
        return { rule, gaze };
    }
    return null;
}

/** The words of a rule for a reason: its label, else its holders and kind. */
function ruleWords(rule: AppetiteRule): string {
    return cleanText(rule.label, LIMITS.short) || `${rule.holders}: ${rule.kind}`;
}

/** The story's reason for a relation: its words, else the relation named. */
function storyWords(facts: NewcomerFacts, lang: Lang): string {
    return facts.reason || facts.relationNote || relationWords(facts.relation, lang);
}

/**
 * A grounded sketch's stance (StanceBasis), or null when the tone's dice decide (a stranger). The order: the story
 * (its stance hint; else its relation, at the reputation of the face's groups when there is one, else at the stance
 * the relation stands for), the reputation, an appetite rule aimed at the player (the dice within −1…+1: wanting is
 * not hating), a mild default (0) when the relation is not clear.
 */
function groundedBasis(tone: WorldTone, rng: Rng, options: SampleOptions): StanceBasis | null {
    const facts = options.facts ?? undefined;
    const lang = options.lang ?? 'en';
    if (facts && (facts.stanceHint !== undefined || storyRelation(facts.relation))) {
        const stance = facts.stanceHint ?? options.reputation ?? RELATION_STANCE[facts.relation] ?? (0 as Stance);
        return { source: 'story', stance: clampStance(stance), reason: storyWords(facts, lang), read: facts.source };
    }
    const stranger = facts?.relation === 'stranger';
    if (options.reputation !== undefined && !(options.reputationGeneral && stranger)) {
        const basis: StanceBasis = { source: 'reputation', stance: options.reputation };
        if (options.reputationLabel?.trim()) basis.reason = options.reputationLabel.trim();
        return basis;
    }
    if (options.rule) {
        const stance = clampStance(Math.max(-1, Math.min(1, toneStance(tone, rng, options.priors))));
        return {
            source: 'world',
            stance,
            reason: ruleWords(options.rule.rule),
            gaze: options.rule.gaze,
            rule: options.rule.rule.id,
        };
    }
    if (stranger) return null;
    return { source: 'default', stance: 0 };
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
    /** The stance his reputation gives someone of this character's groups (reputation.strangerStance). */
    reputation?: Stance;
    /** That reputation's label («беглый каторжник»), the reason of a grounded stance. */
    reputationLabel?: string;
    /**
     * The reputation is the everyone's one ('*'), not a group of theirs: a grounded stranger then meets him by it only
     * as often as an ungrounded one (REPUTATION_WEIGHT), the dice decide the rest.
     */
    reputationGeneral?: boolean;
    /**
     * Ground the stance (docs/model.md §10.2): the story's facts, then the reputation (always), then a rule aimed at
     * the player, a mild default when the relation is not clear, the tone's dice only for a stranger — and hostility at
     * −2/−3 only with a story or world reason. Without it (older callers) the dice decide, the reputation 70 % of the
     * time.
     */
    grounded?: boolean;
    /** What the story showed about this face (the turn pass's newcomers, the word heuristics). */
    facts?: NewcomerFacts | null;
    /** An appetite rule this face holds that aims at the player (playerRuleFor). */
    rule?: PlayerRule | null;
    /** Language of the reasons the code words (a relation with no story words). */
    lang?: Lang;
    /** Priors other than the bundled ones (tests). */
    priors?: RolePriors;
}

function drawOnce(
    prior: RolePrior,
    tone: WorldTone,
    cast: readonly CastMember[],
    rng: Rng,
    options: SampleOptions,
    basis: StanceBasis | null,
): GenParams {
    const values = drawValues(prior, rng);
    const temperament = drawTemperament(prior, rng);
    const drives = drawDrives(prior, rng);
    // A grounded stranger: the dice, but hostility at −2/−3 needs a hostile world (the world's reason) or the story.
    const floor = options.grounded && tone !== 'hostile' ? -1 : -3;
    const reputation = !options.grounded || options.reputationGeneral ? options.reputation : undefined;
    const stance = basis ? basis.stance : drawStance(tone, prior, rng, options.priors, reputation, floor);
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
        basis: basis ?? { source: 'dice', stance },
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
 * present. With `options.grounded` the stance toward the player has a basis first (the story's facts, the reputation,
 * a rule, a default — `basis` of the result) and the dice decide it only for a stranger. Deterministic for a seeded rng.
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
    const basis = options.grounded ? groundedBasis(tone, rng, options) : null;
    let best: GenParams | null = null;
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < Math.max(1, rule.attempts); attempt++) {
        const params = drawOnce(prior, tone, cast, rng, options, basis);
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

/** Where an existing tie to the player came from, as a basis (for the prompt's words). */
function tieBasis(profile: CharacterProfile, tie: Tie): StanceBasis {
    const meta = metaAt(profile, `ties.${PLAYER_ID}`);
    const sources = meta?.sources ?? [];
    const reason = [...tie.reasons].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0]?.text;
    let source: StanceBasis['source'] = 'story';
    if (meta?.origin === 'generated') {
        const stranger = tie.reasons.length > 0 && tie.reasons.every((item) => item.id === 'gen-stranger');
        if (sources.includes(DICE_SOURCE) || stranger) source = 'dice';
        else if (sources.includes(DEFAULT_SOURCE)) source = 'default';
        else if (sources.includes(REPUTATION_SOURCE)) source = 'reputation';
        else if (sources.includes(WORLD_SOURCE)) source = 'world';
    }
    const basis: StanceBasis = { source, stance: tie.stance };
    if (reason && source !== 'dice') basis.reason = reason;
    return basis;
}

export interface ProfileParamsOptions {
    /** Every generated field counts as a guess (the repair of a face an older build made from dice). */
    everyGenerated?: boolean;
}

/**
 * The parameters to write around for an existing character: what the profile already holds wins over the fresh draw,
 * so a promotion or a gap fill never contradicts what is there. Only the author's, the inferred, the story's and the
 * user's fields (and what a model already wrote from the story) are fixed (`fixed`): the dice's and the templates'
 * values stay as provisional guesses the model may replace (docs/model.md §10.2 «Повышение»). A provisional stance
 * gives way to the fresh draw when that one is grounded (the story, the reputation, a rule).
 */
export function paramsFromProfile(
    profile: CharacterProfile,
    sampled: GenParams,
    options: ProfileParamsOptions = {},
): GenParams {
    const core = profile.core;
    const set = (path: string) => !!metaAt(profile, path);
    const fixed: ParamKey[] = [];
    const hold = (key: ParamKey, path: string) => {
        if (!isProvisional(profile, path, options.everyGenerated)) fixed.push(key);
    };
    const temperament = { ...sampled.temperament };
    if (Object.keys(core.temperament).length || set('core.temperament')) {
        for (const axis of HEXACO) temperament[axis] = core.temperament[axis] ?? 0;
        hold('temperament', 'core.temperament');
    }
    let values = sampled.values;
    if (core.values.top.length) {
        const sacrifice =
            core.values.sacrifice ??
            (core.values.top.includes(sampled.values.sacrifice)
                ? (VALUES.find((value) => !core.values.top.includes(value)) ?? sampled.values.sacrifice)
                : sampled.values.sacrifice);
        values = { top: [...core.values.top], sacrifice };
        hold('values', 'core.values');
    }
    let drives = sampled.drives;
    if (core.drives.high.length || core.drives.low.length) {
        drives = { ...core.drives };
        hold('drives', 'core.drives');
    }
    let tactics = sampled.tactics;
    if (core.tactics.length) {
        tactics = [...core.tactics];
        hold('tactics', 'core.tactics');
    }
    const tiePath = `ties.${PLAYER_ID}`;
    const player = profile.ties.find((tie) => tie.target === PLAYER_ID);
    let stance = sampled.stance;
    let basis = sampled.basis;
    if (player) {
        const guess = isProvisional(profile, tiePath, options.everyGenerated);
        const grounded = !!basis && basis.source !== 'dice' && basis.source !== 'default';
        if (!guess) {
            stance = player.stance;
            basis = tieBasis(profile, player);
            fixed.push('stance');
        } else if (!grounded) {
            stance = player.stance;
            basis = tieBasis(profile, player);
        }
    }
    // What the story showed of the relation is the story's: it holds like the author's.
    if (basis?.source === 'story' && !fixed.includes('stance')) fixed.push('stance');
    const roleMeta = metaAt(profile, 'role');
    if (profile.role && roleMeta && roleMeta.origin !== 'generated') fixed.push('role');
    if (profile.appetites[0]) fixed.push('style');
    const keep = (path: string, key: ParamKey) => {
        if (!set(path)) return false;
        hold(key, path);
        return true;
    };
    const params: GenParams = {
        role: profile.role ?? sampled.role,
        values,
        temperament,
        drives,
        stance,
        tactics,
        style: profile.appetites[0]?.style ?? sampled.style,
        proactivity: keep('core.proactivity', 'proactivity') ? core.proactivity : sampled.proactivity,
        commitment: keep('core.commitment', 'commitment') ? core.commitment : sampled.commitment,
        baselineMood: keep('core.baselineMood', 'baselineMood') ? core.baselineMood.octant : sampled.baselineMood,
        duty: sampled.duty,
        fixed,
    };
    if (basis) params.basis = basis;
    return params;
}

/* ------------------------------------------------------------------ sketches (no model) */

export { DEFAULT_SOURCE, DICE_SOURCE, TEMPLATE_SOURCE };
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
    /** What the story showed about them: their role and kind in story words (origin 'story'). */
    facts?: NewcomerFacts | null;
    /** Groups / classes of the world they belong to (the story's, the relation's): rules and reputation match them. */
    groups?: readonly string[];
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

/** The reason of a stance the model read from the card or the story (a fill, a grounded promotion), not drawn. */
function contextReason(stance: Stance, text: string): Reason {
    return { id: 'gen-context', text, delta: stance, scenesLeft: null, stacks: 1 };
}

/** Reason ids the generator writes on a player tie (the story's relation is not among them: it is the story's). */
export const GENERATOR_REASONS: readonly string[] = ['gen-stranger', 'gen-context', 'gen-reputation', 'gen-world'];

/** Reason id of a stance the story showed for a new face (its relation, its stance). */
export const STORY_REASON = 'story-relation';

function permanentReason(id: string, stance: Stance, text: string): Reason {
    return { id, text, delta: stance, scenesLeft: null, stacks: 1 };
}

/**
 * A player tie the dice made for a stranger (reasons only `gen-stranger`, generated): on a card character it is a gap —
 * the card knows how they relate to the player, so a fill asks the model instead (older builds drew it).
 */
export function isDiceStrangerTie(profile: CharacterProfile): boolean {
    const tie = profile.ties.find((item) => item.target === PLAYER_ID);
    if (!tie || !tie.reasons.length || !tie.reasons.every((reason) => reason.id === 'gen-stranger')) return false;
    const meta = metaAt(profile, `ties.${PLAYER_ID}`);
    return !meta || (meta.origin === 'generated' && !meta.locked);
}

/**
 * A face an older build drew from dice (docs/model.md §10.2 «Починка»): its tie to the player is a dice-made
 * stranger's from before the dice were marked (no 'dice' source), and nothing on it came from the author, the reading
 * or the story. Its generated fields are all guesses (the user's edits stay); the generator rebuilds it from the story
 * once (GeneratorState.regrounded).
 */
export function needsGrounding(profile: CharacterProfile): boolean {
    if (profile.kind === 'group' || !isDiceStrangerTie(profile)) return false;
    if (metaAt(profile, `ties.${PLAYER_ID}`)?.sources?.includes(DICE_SOURCE)) return false;
    return !Object.values(profile.meta).some(
        (meta) => meta.origin === 'author' || meta.origin === 'inferred' || meta.origin === 'story',
    );
}

export interface FactsGrounding {
    lang?: Lang;
    /** The world's group labels (newcomers.worldGroups): the relation's groups are taken from them. */
    groups?: readonly string[];
    /** The player's reputation among the face's groups, when there is one. */
    reputation?: { stance: Stance; label?: string };
}

/**
 * What the story showed about an existing face, written without a model (after a turn): the groups, the kind and the
 * role it gave join the profile (origin 'story'); a provisional tie to the player (dice, a default) gives way to the
 * relation and the stance the story showed. Author, user, locked and story fields stay. `written`: the paths changed.
 */
export function groundWithFacts(
    start: CharacterProfile,
    facts: NewcomerFacts,
    ctx: FactsGrounding = {},
): { profile: CharacterProfile; written: string[] } {
    let profile = start;
    const written: string[] = [];
    const lang = ctx.lang ?? 'en';
    const read: FieldMeta = { origin: 'story', sources: [facts.source] };
    const groups = cleanList(
        [...(profile.groups ?? []), ...(facts.groups ?? []), ...relationGroups(facts.relation, ctx.groups ?? [])],
        LIMITS.aliases,
        LIMITS.name,
    );
    if (groups.length > (profile.groups?.length ?? 0) && !isProtected(profile, 'groups')) {
        profile = setMeta({ ...profile, groups }, 'groups', read);
        written.push('groups');
    }
    const species = cleanText(facts.species, LIMITS.name);
    if (species && !profile.species && !isProtected(profile, 'species')) {
        profile = setMeta({ ...profile, species }, 'species', read);
        written.push('species');
    }
    const role = cleanText(facts.role, LIMITS.short);
    if (role && !profile.role && !isProtected(profile, 'role')) {
        profile = setMeta({ ...profile, role }, 'role', read);
        written.push('role');
    }
    const tiePath = `ties.${PLAYER_ID}`;
    const known = facts.stanceHint !== undefined || storyRelation(facts.relation);
    const existing = profile.ties.find((tie) => tie.target === PLAYER_ID);
    // A face an older build drew from dice: its whole tie is a guess.
    if (known && (!existing || isProvisional(profile, tiePath, needsGrounding(profile)))) {
        const stance = clampStance(
            facts.stanceHint ?? ctx.reputation?.stance ?? RELATION_STANCE[facts.relation] ?? (0 as Stance),
        );
        const made = basisTie({ source: 'story', stance, reason: storyWords(facts, lang), read: facts.source }, lang);
        const others = (existing?.reasons ?? []).filter(
            (reason) => !GENERATOR_REASONS.includes(reason.id) && reason.id !== STORY_REASON,
        );
        const tie: Tie = { ...made.tie, ...pursuitOf(existing), reasons: [...made.tie.reasons, ...others] };
        profile = setMeta(setPath(profile, tiePath, tie), tiePath, made.meta);
        written.push(tiePath);
    }
    return { profile, written };
}

/** What an appetite rule aimed at the player makes a holder mean to do with him (gaze → tie intent). */
const GAZE_INTENT: Readonly<Record<Gaze, TieIntent>> = {
    property: 'use',
    prey: 'use',
    instrument: 'use',
    prize: 'seduce',
    mate: 'court',
    person: 'none',
};

/** How that shows toward the player, for the tie's behaviour (the card's language). */
const GAZE_BEHAVIOUR: Readonly<Record<Gaze, { en: string; ru: string }>> = {
    property: { en: 'means to take them and keep them as their own', ru: 'хочет захватить его и оставить себе' },
    prey: { en: 'stalks them as prey to catch', ru: 'выслеживает его как добычу' },
    instrument: { en: 'weighs what use they could be', ru: 'прикидывает, какая от него польза' },
    prize: { en: 'wants to win them as a prize', ru: 'хочет заполучить его как трофей' },
    mate: { en: 'eyes them as a mate', ru: 'присматривается к нему как к паре' },
    person: { en: '', ru: '' },
};

/** A face whose tie to the player is not clear yet: a mild default, not hostility. */
const UNCLEAR_BEHAVIOUR = { en: 'not clear yet: still sizing them up', ru: 'ещё не ясно: пока присматривается к нему' };

/**
 * The player tie a stance basis makes (sketchProfile, a grounding by the story), with its provenance: the story's
 * relation (origin 'story'), the reputation or a world rule (generated from the card's world), a default or a
 * stranger's dice (provisional guesses).
 */
export function basisTie(basis: StanceBasis, lang: Lang = 'en'): { tie: Tie; meta: FieldMeta } {
    const stance = basis.stance;
    const tie: Tie = emptyTie(PLAYER_ID, stance);
    switch (basis.source) {
        case 'story':
            tie.reasons = [permanentReason(STORY_REASON, stance, basis.reason || relationWords('unknown', lang))];
            return { tie, meta: { origin: 'story', sources: [basis.read ?? 'turn'] } };
        case 'reputation':
            tie.reasons = [
                permanentReason('gen-reputation', stance, basis.reason || (lang === 'ru' ? 'по слухам' : 'by repute')),
            ];
            return { tie, meta: generated([REPUTATION_SOURCE]) };
        case 'world': {
            tie.reasons = [permanentReason('gen-world', stance, basis.reason || '')];
            const gaze = basis.gaze ?? 'person';
            if (GAZE_INTENT[gaze] !== 'none') tie.intent = GAZE_INTENT[gaze];
            const words = GAZE_BEHAVIOUR[gaze][lang];
            if (words) tie.behaviour = words;
            return { tie, meta: generated([WORLD_SOURCE]) };
        }
        case 'default':
            tie.behaviour = UNCLEAR_BEHAVIOUR[lang];
            return { tie, meta: generated([DEFAULT_SOURCE]) };
        default: {
            tie.reasons = [strangerReason(stance, stanceReason(stance, lang))];
            const words = stanceTell(stance, lang);
            if (words) tie.behaviour = words;
            return { tie, meta: generated([DICE_SOURCE, TEMPLATE_SOURCE]) };
        }
    }
}

/**
 * A sketch (§10.2): what they do, one want, their stance toward the player and one tell — from the role's templates,
 * no model — plus the drawn core, so contrast and later levels write around the same dice. The stance follows its
 * basis (StanceBasis: the story, the reputation, a world rule, a default, a stranger's dice); the role, kind and
 * groups the story showed are the story's. Template fields are placeholders (sources 'template'), the drawn ones
 * provisional guesses (sources 'dice'): the story and a promotion may replace both.
 */
export function sketchProfile(name: string, params: GenParams, ctx: SketchContext = {}): CharacterProfile {
    const lang = ctx.lang ?? 'en';
    const rng = ctx.rng ?? seedOf(`${name}|${params.role}`);
    const prior = rolePrior(params.role);
    const facts = ctx.facts ?? undefined;
    const storyRole = params.role === UNKNOWN_ROLE ? cleanText(facts?.role, LIMITS.short) : '';
    const base = emptyProfile(name, {
        ...(ctx.id ? { id: ctx.id } : {}),
        ...(ctx.taken ? { taken: ctx.taken } : {}),
        lod: 'sketch',
        ...(params.role !== UNKNOWN_ROLE ? { role: params.role } : storyRole ? { role: storyRole } : {}),
    });
    const doing = cleanText(ctx.doing, LIMITS.short) || choose(prior.doing[lang], rng);
    const want = choose(prior.want[lang], rng);
    const tell = choose(prior.tell[lang], rng);
    const temperament: Partial<Record<HexacoAxis, Level5>> = {};
    for (const axis of HEXACO) if (params.temperament[axis] !== 0) temperament[axis] = params.temperament[axis];
    const { tie, meta: tieMeta } = basisTie(params.basis ?? { source: 'dice', stance: params.stance }, lang);
    const species = cleanText(ctx.species, LIMITS.name) || cleanText(facts?.species, LIMITS.name);
    const groups = cleanList([...(ctx.groups ?? [])], LIMITS.aliases, LIMITS.name);
    let profile: CharacterProfile = {
        ...base,
        ...(ctx.gender ? { gender: ctx.gender } : {}),
        ...(species ? { species } : {}),
        ...(ctx.minor ? { minor: true } : {}),
        ...(groups.length ? { groups } : {}),
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
        profile = setMeta(profile, path, generated([DICE_SOURCE]));
    }
    for (const path of ['core.want', 'core.signatures']) {
        profile = setMeta(profile, path, generated([TEMPLATE_SOURCE]));
    }
    profile = setMeta(profile, `ties.${PLAYER_ID}`, tieMeta);
    if (!ctx.doing) profile = setMeta(profile, 'starts', generated([TEMPLATE_SOURCE]));
    const read: FieldMeta | null = facts ? { origin: 'story', sources: [facts.source] } : null;
    if (read && storyRole && profile.role === storyRole) profile = setMeta(profile, 'role', read);
    if (read && species && !ctx.species) profile = setMeta(profile, 'species', read);
    if (read && groups.length) profile = setMeta(profile, 'groups', read);
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

/** The fit a new face's candidate must claim to be picked when another claims it (the story and the world). */
export const MIN_FIT = 3;

/**
 * A new face's candidate: only those that say they fit the story, the world and the fixed values (fit ≥ MIN_FIT) are
 * in the draw while there is one; then by weight as pickCandidate.
 */
export function pickFitting<T extends Pick<GenCandidate, 'fit' | 'typicality'>>(
    candidates: readonly T[],
    rng: Rng,
): T | undefined {
    const fitting = candidates.filter((candidate) => candidate.fit >= MIN_FIT);
    return pickCandidate(fitting.length ? fitting : candidates, rng);
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
    /**
     * Only these profile paths are written (a fill writes the gaps it asked for, whatever else the answer holds); the
     * level still rises. Absent = every path the generator may write.
     */
    only?: readonly string[];
    lang?: Lang;
    /** Defence style from BunnyMo (MBTI -U): beats the candidate's. */
    coping?: Coping;
    /** A draft writes only a draft's fields (§10.2), a sketch a sketch's, whatever else the answer holds. */
    kind?: GeneratorKind | 'sketch';
    /**
     * A new face grounded in the story (docs/model.md §10.2 «Повышение»): the provisional guesses (dice, templates, a
     * default) are open too; the candidate's core (values, temperament, drives, tactics, initiative, mood), its stance
     * toward the player and its role replace them, what it leaves out stays as the dice had it. Author, inferred,
     * story, user and locked fields are never touched.
     */
    ground?: boolean;
    /** With `ground`: every generated field counts as a guess (the repair of a face an older build drew from dice). */
    everyGenerated?: boolean;
}

/** The part of a candidate a sketch keeps (§10.2: what they do, one want, the stance, one tell — and the core). */
function sketchPart(candidate: GenCandidate): GenCandidate {
    return {
        ...draftPart(candidate),
        concept: '',
        need: '',
        goals: [],
        keys: [],
    };
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

/** Fields of a tie that belong to appetites and pursuit, not to the stance: a new stance keeps them. */
function pursuitOf(tie: Tie | undefined): Partial<Tie> {
    if (!tie) return {};
    const out: Partial<Tie> = {};
    if (tie.want !== undefined) out.want = tie.want;
    if (tie.gaze) out.gaze = tie.gaze;
    if (tie.claim) out.claim = tie.claim;
    if (tie.appetite) out.appetite = tie.appetite;
    if (tie.escalation) out.escalation = tie.escalation;
    if (tie.intent !== 'none') out.intent = tie.intent;
    return out;
}

/**
 * A grounded promotion's player tie, when the old one was a guess: the stance the model read from the story (a hostile
 * −2/−3 only with a reason, else −1), else the fresh grounded basis (the story's facts, the reputation, a rule), else
 * only the candidate's words for the guess. What the tie holds of appetites and pursuit stays. Null: nothing to write.
 */
function groundTie(
    profile: CharacterProfile,
    candidate: GenCandidate,
    params: GenParams | undefined,
    lang: Lang,
): { tie: Tie; meta: FieldMeta } | null {
    const existing = profile.ties.find((tie) => tie.target === PLAYER_ID);
    const behaviour = cleanText(candidate.stanceBehaviour, LIMITS.short);
    const why = cleanText(candidate.stanceReason, LIMITS.short);
    const others = (existing?.reasons ?? []).filter(
        (reason) => !GENERATOR_REASONS.includes(reason.id) && reason.id !== STORY_REASON,
    );
    const basis = params?.basis;
    // What the story showed of the relation holds: the model only words it.
    const story = basis?.source === 'story' && !!params?.fixed?.includes('stance');
    if (typeof candidate.playerStance === 'number' && !story) {
        let stance = clampStance(candidate.playerStance);
        if (stance <= -2 && !why) stance = -1;
        const tie: Tie = {
            ...emptyTie(PLAYER_ID, stance),
            ...pursuitOf(existing),
            reasons: [contextReason(stance, why || relationWords('unknown', lang)), ...others].slice(0, LIMITS.reasons),
        };
        if (behaviour) tie.behaviour = behaviour;
        return { tie, meta: generated([GROUNDED_SOURCE]) };
    }
    if (basis && basis.source !== 'dice' && basis.source !== 'default') {
        const made = basisTie(basis, lang);
        const tie: Tie = { ...made.tie, ...pursuitOf(existing) };
        if (made.tie.intent !== 'none') tie.intent = made.tie.intent;
        tie.reasons = [...made.tie.reasons, ...others].slice(0, LIMITS.reasons);
        if (behaviour) tie.behaviour = behaviour;
        return { tie, meta: made.meta };
    }
    if (existing && behaviour && behaviour !== existing.behaviour) {
        return { tie: { ...existing, behaviour }, meta: metaAt(profile, `ties.${PLAYER_ID}`) ?? generated() };
    }
    return null;
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
    const candidate =
        options.kind === 'draft' ? draftPart(input) : options.kind === 'sketch' ? sketchPart(input) : input;
    let profile = start;
    const written: string[] = [];
    const lang = options.lang ?? 'en';
    const ground = !!options.ground;
    const asked = (path: string) => !options.only || options.only.includes(path);
    const open = (path: string) =>
        canGenerate(profile, path) || (ground && isProvisional(profile, path, options.everyGenerated));
    // What a grounded promotion writes, the model wrote from the story: no longer a guess.
    const madeMeta = (): FieldMeta => (ground ? generated([GROUNDED_SOURCE]) : generated());
    const write = (path: string, value: unknown) => {
        if (isEmptyValue(value) || !asked(path) || !open(path)) return;
        profile = setMeta(setPath(profile, path, value), path, madeMeta());
        written.push(path);
    };
    const params = options.params;
    if (params && !ground) {
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
    } else {
        // A grounded fill: the core comes from the card's text, not from dice; a grounded promotion: from the story.
        const top = (candidate.values ?? []).slice(0, LIMITS.values);
        if (top.length) {
            const sacrifice = candidate.sacrifice && !top.includes(candidate.sacrifice) ? candidate.sacrifice : '';
            write('core.values', sacrifice ? { top, sacrifice } : { top });
        }
        const temperament: Partial<Record<HexacoAxis, Level5>> = {};
        for (const axis of HEXACO) {
            const level = candidate.temperament?.[axis];
            if (level) temperament[axis] = level;
        }
        write('core.temperament', temperament);
        if (candidate.drives?.high.length) {
            const high = candidate.drives.high.slice(0, LIMITS.drivesHigh);
            write('core.drives', {
                high,
                low: candidate.drives.low.filter((drive) => !high.includes(drive)).slice(0, LIMITS.drivesLow),
            });
        }
        write('core.tactics', cleanList(candidate.tactics ?? [], LIMITS.tactics));
        if (typeof candidate.proactivity === 'number' && candidate.proactivity >= 0) {
            write('core.proactivity', clamp(Math.round(candidate.proactivity), 0, 10));
        }
        if (candidate.moodOctant) {
            const label = cleanText(candidate.moodLabel, LIMITS.name);
            write(
                'core.baselineMood',
                label ? { octant: candidate.moodOctant, label } : { octant: candidate.moodOctant },
            );
        }
        if (params) {
            // What the candidate left out of an empty core: the dice, still a guess.
            const guess = (path: string, value: unknown) => {
                if (isEmptyValue(value) || !asked(path) || !isEmptyValue(getPath(profile, path))) return;
                if (!canGenerate(profile, path)) return;
                profile = setMeta(setPath(profile, path, value), path, generated([DICE_SOURCE]));
                written.push(path);
            };
            guess('core.values', { top: [...params.values.top], sacrifice: params.values.sacrifice });
            guess('core.drives', { high: [...params.drives.high], low: [...params.drives.low] });
            guess('core.tactics', [...params.tactics]);
        }
        const role = cleanText(candidate.role, LIMITS.short);
        const roleMeta = metaAt(profile, 'role');
        if (
            ground &&
            role &&
            asked('role') &&
            !isProtected(profile, 'role') &&
            (!roleMeta || roleMeta.origin === 'generated') &&
            textKey(role) !== textKey(profile.role ?? '')
        ) {
            profile = setMeta({ ...profile, role }, 'role', generated([GROUNDED_SOURCE]));
            written.push('role');
        }
        const species = cleanText(candidate.species, LIMITS.name);
        if (ground && species && !profile.species && asked('species') && !isProtected(profile, 'species')) {
            profile = setMeta({ ...profile, species }, 'species', generated([GROUNDED_SOURCE]));
            written.push('species');
        }
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
    if (label && asked('core.baselineMood') && !core.baselineMood.label && !written.includes('core.baselineMood')) {
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
    if ((doing || goal) && asked('starts') && canGenerate(profile, 'starts')) {
        const others = profile.starts.filter((start) => start.greeting !== -1);
        const old = profile.starts.find((start) => start.greeting === -1);
        const any: CharacterProfile['starts'][number] = { greeting: -1, present: old?.present ?? true };
        const keptDoing = doing || old?.doing;
        const keptGoal = goal || old?.goal;
        if (keptDoing) any.doing = keptDoing;
        if (keptGoal) any.goal = keptGoal;
        profile = setMeta({ ...profile, starts: [...others, any] }, 'starts', madeMeta());
        written.push('starts');
    }

    /* the stance toward the player: the drawn one, with the candidate's words for it */
    const tiePath = `ties.${PLAYER_ID}`;
    const behaviour = cleanText(candidate.stanceBehaviour, LIMITS.short);
    const reasonText = cleanText(candidate.stanceReason, LIMITS.short);
    const fill = options.kind === 'fill';
    const redraw = fill && isDiceStrangerTie(profile) && !isProtected(profile, tiePath);
    if (ground) {
        if (asked(tiePath) && open(tiePath)) {
            const made = groundTie(profile, candidate, params, lang);
            if (made) {
                profile = setMeta(setPath(profile, tiePath, made.tie), tiePath, made.meta);
                written.push(tiePath);
            }
        }
    } else if ((params || behaviour || redraw) && asked(tiePath) && (canGenerate(profile, tiePath) || redraw)) {
        // A fill reads the stance from the card (the model's playerStance), replacing a dice-made stranger tie;
        // drafts and portraits keep the drawn stance, the candidate only words it.
        const replace = fill && (!profile.ties.some((tie) => tie.target === PLAYER_ID) || isDiceStrangerTie(profile));
        const existing = replace ? undefined : profile.ties.find((tie) => tie.target === PLAYER_ID);
        const read = typeof candidate.playerStance === 'number' ? clampStance(candidate.playerStance) : undefined;
        const stance = fill ? (existing?.stance ?? read) : (existing?.stance ?? params?.stance);
        if (stance !== undefined) {
            const kept = (existing?.reasons ?? []).filter(
                (reason) => reason.id !== 'gen-stranger' && reason.id !== 'gen-context',
            );
            const text =
                reasonText ||
                existing?.reasons.find((reason) => reason.id === 'gen-stranger' || reason.id === 'gen-context')?.text;
            const why = text || stanceReason(stance, lang);
            const tie: Tie = {
                ...(existing ?? profile.ties.find((item) => item.target === PLAYER_ID) ?? emptyTie(PLAYER_ID, stance)),
                stance,
                reasons: [
                    fill && existing === undefined ? contextReason(stance, why) : strangerReason(stance, why),
                    ...kept,
                ].slice(0, LIMITS.reasons),
            };
            const words = behaviour || existing?.behaviour || stanceTell(stance, lang);
            if (words) tie.behaviour = words;
            profile = setMeta(setPath(profile, tiePath, tie), tiePath, generated());
            written.push(tiePath);
        }
    }

    /* appetites the candidate gives (portraits), never a sexual one for a minor, never one craving twice */
    for (const raw of candidate.appetites) {
        if (raw.baseline <= 0) continue;
        if (profile.minor && SEXUAL_KINDS.includes(raw.kind)) continue;
        const label = textKey(raw.label);
        if (
            profile.appetites.some(
                (appetite) => appetite.kind === raw.kind || (!!label && textKey(appetite.label ?? '') === label),
            )
        ) {
            continue;
        }
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
    const missing: string[] = GAP_PATHS.filter(
        (path) => canGenerate(profile, path) && isEmptyValue(getPath(profile, path)),
    );
    // How a card character relates to the player: a gap when the author gave nothing, or the dice drew a stranger.
    const tiePath = `ties.${PLAYER_ID}`;
    const noTie = !profile.ties.some((tie) => tie.target === PLAYER_ID);
    if ((noTie && canGenerate(profile, tiePath)) || (isDiceStrangerTie(profile) && !isProtected(profile, tiePath))) {
        missing.push(tiePath);
    }
    return missing;
}

/** Defaulted core paths a grounded fill reads from the card when nobody set them yet. */
const GROUNDED_DEFAULTED = ['core.proactivity', 'core.baselineMood'] as const;

/**
 * The paths a grounded fill of an authored character writes at this level: the gaps of missingFields, the resting
 * mood and initiative nobody set, and for a portrait the secrets and intentions the card may give. Appetites never:
 * the reading owns them.
 */
export function groundedPaths(profile: CharacterProfile, lod: Lod = profile.lod): string[] {
    const paths = missingFields(profile);
    for (const path of GROUNDED_DEFAULTED) if (!metaAt(profile, path) && canGenerate(profile, path)) paths.push(path);
    if (lod === 'portrait') {
        for (const path of ['agenda.secrets', 'agenda.intentions']) {
            if (canGenerate(profile, path) && isEmptyValue(getPath(profile, path))) paths.push(path);
        }
    }
    return paths;
}

/**
 * A character the author wrote: the intent reading gave it fields (author or inferred), or the card's own text names
 * it. Its gaps are filled from that text, never around dice (docs/model.md §10.1).
 */
export function isAuthored(profile: CharacterProfile, sourcesText = ''): boolean {
    if (Object.values(profile.meta).some((meta) => meta.origin === 'author' || meta.origin === 'inferred')) return true;
    if (!sourcesText.trim()) return false;
    return presentFromText([sourcesText], [profile]).length > 0;
}

/** A character whose core has holes the generator may fill (groups are left to the author). */
export function needsFill(profile: CharacterProfile): boolean {
    if (profile.kind === 'group') return false;
    const missing = missingFields(profile);
    return CORE_GAPS.some((path) => missing.includes(path)) || isDiceStrangerTie(profile);
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
    // The story has not touched the live tie: only the generator's reasons, no step taken, no progress toward one.
    const untouched =
        !!liveTie &&
        !!oldTie &&
        liveTie.stance === oldTie.stance &&
        !liveTie.moved &&
        !liveTie.progress &&
        liveTie.reasons.every((reason) => GENERATOR_REASONS.includes(reason.id) || reason.id === STORY_REASON);
    if (tie && !liveTie) {
        next.ties[PLAYER_ID] = structuredClone(tie);
        next.knowsPlayer = true;
    } else if (tie && liveTie && untouched && tie.stance !== oldTie!.stance) {
        // A grounding moved the stance the dice had guessed: the live tie follows (the story had not moved it).
        const moved: Tie = {
            ...liveTie,
            stance: tie.stance,
            reasons: structuredClone(tie.reasons),
            intent: tie.intent !== 'none' ? tie.intent : liveTie.intent,
        };
        delete moved.base;
        if (tie.behaviour) moved.behaviour = tie.behaviour;
        next.ties[PLAYER_ID] = moved;
    } else if (tie && liveTie && untouched) {
        const moved: Tie = {
            ...liveTie,
            reasons: structuredClone(tie.reasons),
            intent: tie.intent !== 'none' ? tie.intent : liveTie.intent,
        };
        if (tie.behaviour) moved.behaviour = tie.behaviour;
        next.ties[PLAYER_ID] = moved;
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

/**
 * Labels a character answers to for a rule: species, role, the role's own words, the groups they belong to (the
 * profile's own — what the story showed of a new face — and those given).
 */
function labelsOf(profile: Pick<CharacterProfile, 'species' | 'role' | 'groups'>, groups: readonly string[]): string[] {
    return [profile.species ?? '', profile.role ?? '', ...(profile.groups ?? []), ...groups].flatMap(tokens);
}

/** Does a rule's «holders» («гоблины-налётчики», "the garrison guards") describe this character? */
export function holderMatches(
    holders: string,
    profile: Pick<CharacterProfile, 'species' | 'role' | 'groups'>,
    groups: readonly string[] = [],
): boolean {
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
    const labels = labelsOf(person, []);
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
    /**
     * A new face's tie to the player gets the intent the rule gives (gaze: property, prey → use; prize → seduce; mate
     * → court) when it has none: they mean to take him, not to strike him.
     */
    intents?: boolean;
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
                if (ctx.intents && target === PLAYER_ID && tie.intent === 'none' && GAZE_INTENT[gaze] !== 'none') {
                    tie.intent = GAZE_INTENT[gaze];
                }
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
