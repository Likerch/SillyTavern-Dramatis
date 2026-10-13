// Applies the intent reading (docs/model.md §7) to the card's profiles. The answer is untrusted: every value is
// validated and clamped and quotes are checked against the sources. A field backed by a verified quote is the
// author's; a field the reading filled without one is kept as 'inferred' («из карточки, без цитаты») — evidence decides
// the provenance, never whether the reading is kept (fidelity 'strict' only refuses quotes it cannot find). The code
// itself refuses softening — when the evidence speaks of hostility, contempt or cruelty toward the player or
// strangers (not of what they do to third parties for the player's sake), the intended stance cannot be above −1, and
// 'strict' fidelity adds the author's ceiling; devotion the author wrote about the player gets the author's floor.
// The user's edits and locks are never overwritten: a re-read lists them as differences instead; a full re-read
// (`replaceGenerated`) drops what the generator wrote for the characters it reads, so the new reading and a grounded
// fill take its place. Characters merge with existing profiles by name and alias; their English name, first name,
// nicknames and Russian forms become names the story can call them by; groups become kind 'group'; minors are flagged
// and never get, or become the target of, sexual appetites. What the card's structured intent wrote (card-intent.ts,
// meta source 'card.intent') is the author's word: this reading skips those fields silently. Pure.
import {
    APPETITE_KINDS,
    DRIVES,
    GAZES,
    HEXACO,
    JUSTIFICATIONS,
    MOODS,
    PLAYER_ID,
    STYLES,
    TIE_INTENTS,
    VALUES,
} from './model';
import type {
    AffectionOnset,
    Agenda,
    Appetite,
    AppetiteKind,
    AppetiteRule,
    CardProfiles,
    CharacterProfile,
    Core,
    FieldMeta,
    Gaze,
    Reason,
    ReputationSeed,
    Stance,
    StanceBound,
    Style,
    Tie,
    TieIntent,
    WorldTone,
} from './model';
import { PLAYER_REF, QUOTE_MAX } from './intent-prompt';
import type { Fidelity, IntentSource } from './intent-prompt';
import { clearGenerated } from './intent-reread';
import { matchName, normalizeName } from './presence';
import { SEXUAL_KINDS } from './group-rules';
import {
    LIMITS,
    cleanList,
    cleanText,
    emptyProfile,
    emptyTie,
    enumList,
    getPath,
    intIn,
    isCardAuthored,
    isDict,
    isEmptyValue,
    isLocked,
    isProtected,
    metaAt,
    normalizeAppetite,
    normalizeCardProfiles,
    normalizeCore,
    normalizeIntensity,
    oneOf,
    setMeta,
    setPath,
    slugId,
    textKey,
    toStance,
} from './profile-defaults';

export type { Fidelity };

export interface ApplyOptions {
    fidelity: Fidelity;
    /** Epoch ms of the reading (stored in `intent.at`). */
    now: number;
    sourcesHash: string;
    /** The sources sent (refs → stable ids, quote checks). Without them quotes are taken on trust. */
    sources?: readonly IntentSource[];
    /** The player's persona name (matches ties written with it). */
    personaName?: string;
    /** The card's character name ({{char}} in quotes; the main character becomes a portrait). */
    cardName?: string;
    model?: string;
    /**
     * A full re-read («Перечитать полностью»): what the generator wrote for the characters this reading covers is
     * dropped first, so the reading (and later a grounded gap fill) takes its place. The user's edits, locks, the
     * author's and inferred values, group-rule draws and BunnyMo hints stay.
     */
    replaceGenerated?: boolean;
    /** The version of the card's structured intent taken alongside (stored in `intent.fromCard`). */
    fromCard?: number;
}

export interface IntentDiff {
    /** Character id; '' for the card level (world tone, rules, reputation, invariants). */
    character: string;
    name: string;
    path: string;
    before: unknown;
    after: unknown;
    /** updated: the new reading replaced an older author/generated value; kept-*: the user's value stayed. */
    status: 'updated' | 'kept-user' | 'kept-locked';
    /** The new value is the card's structured intent («Взять авторское» marks it so again). */
    fromCard?: boolean;
}

export type IntentWarningCode =
    | 'bad-answer'
    | 'inferred'
    | 'quote-unverified'
    | 'stance-capped'
    | 'stranger-stance'
    | 'rule-target'
    | 'minor-appetite'
    | 'minor-target';

export interface IntentWarning {
    code: IntentWarningCode;
    /** Character or rule name as the story writes it. */
    name?: string;
    path?: string;
    detail?: string;
}

export interface ApplyResult {
    profiles: CardProfiles;
    diff: IntentDiff[];
    warnings: IntentWarning[];
}

/* ------------------------------------------------------------------ the parsed answer */

export interface Evidence {
    path: string;
    quote: string;
    /** Stable source id when the sources are known, else the ref as written. */
    source: string;
    verified: boolean;
}

export interface ParsedTie {
    target: string;
    stance: Stance;
    reasons: string[];
    behaviour: string;
    intent: TieIntent;
    changeIf: string[];
    want: number;
    gaze: Gaze | '';
    appetite: AppetiteKind | '';
}

export interface ParsedAppetite {
    kind: AppetiteKind;
    label: string;
    sources: Appetite['sources'];
    target: 'thing' | 'class' | 'player';
    targetClass: string;
    baseline: number;
    triggers: string[];
    satisfiers: string[];
    drift: Appetite['drift'];
    dependence: number;
    endorsement: Appetite['endorsement'];
    vow: Appetite['vow'];
    visibility: Appetite['visibility'];
    style: Style | '';
    affectionOnset: AffectionOnset | '';
    excuse: string;
    restraints: string[];
    rule: string;
}

export interface ParsedCharacter {
    name: string;
    english: string;
    aliases: string[];
    /** Russian forms of the name (a Russian story), stored as aliases. */
    russian: string[];
    kind: 'character' | 'group';
    gender: '' | 'female' | 'male';
    minor: boolean;
    role: string;
    species: string;
    /** Core in the profile's shape (normalizeCore input) plus the answer's unknown markers. */
    core: Record<string, unknown>;
    appetites: ParsedAppetite[];
    agenda: Record<string, unknown>;
    ties: ParsedTie[];
    starts: { greeting: number; present: boolean; doing: string; goal: string }[];
    evidence: Evidence[];
}

export interface ParsedRule {
    name: string;
    holders: string;
    kind: AppetiteKind;
    label: string;
    source: AppetiteRule['source'];
    target: 'class' | 'player' | 'thing';
    targetClass: string;
    intensity: AppetiteRule['intensity'];
    styles: Partial<Record<Style, number>>;
    choosiness: number;
    exclusivity: AppetiteRule['exclusivity'];
    affectionOnset: AffectionOnset;
    groupMode: AppetiteRule['groupMode'];
    evidence: Evidence[];
}

export interface ParsedIntent {
    worldTone: { tone: WorldTone | ''; evidence: Evidence[] };
    characters: ParsedCharacter[];
    rules: ParsedRule[];
    reputation: { greeting: number; among: string; label: string; stance: Stance; evidence: Evidence[] }[];
    invariants: { text: string; evidence: Evidence[] }[];
}

type Dict = Record<string, unknown>;

const records = (value: unknown, max = 60): Dict[] => (Array.isArray(value) ? value.filter(isDict).slice(0, max) : []);
const text = (value: unknown, max: number = LIMITS.text) => cleanText(value, max);
const short = (value: unknown) => cleanText(value, LIMITS.short);
const names = (value: unknown, max: number = LIMITS.aliases) => cleanList(value, max, LIMITS.name);

/* ------------------------------------------------------------------ quotes */

/** Comparable text for quote checks: lower case, ё → е, quotes and dashes unified, punctuation folded. */
export function quoteKey(value: string): string {
    return value
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/\{\{(char|user)\}\}/g, ' $1 ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function quoteWords(value: string): string[] {
    return quoteKey(value)
        .split(' ')
        .filter((word) => word.length >= 3);
}

/** The names the card reader put in place of `{{char}}` / `{{user}}` in the sources. */
export interface MacroNames {
    char?: string;
    user?: string;
}

/** The quote as written and with `{{char}}` / `{{user}}` replaced by the names the sources carry instead. */
function quoteVariants(quote: string, names: MacroNames): string[] {
    const out = [quote];
    if (!/\{\{(char|user)\}\}/i.test(quote)) return out;
    const replaced = quote
        .replace(/\{\{char\}\}/gi, names.char?.trim() || '{{char}}')
        .replace(/\{\{user\}\}/gi, names.user?.trim() || '{{user}}');
    if (replaced !== quote) out.push(replaced);
    return out;
}

/**
 * The quote occurs in the text: as a whole (punctuation and case aside), as fragments around «…», or with at least
 * 85 % of its words (≥ 3 letters, at least 3 of them) found in the text — macros written back for the names the
 * sources carry, small edits pass, invented quotes do not.
 */
export function quoteFound(
    quote: string,
    sourceText: string,
    aliases: readonly string[] = [],
    names: MacroNames = {},
): boolean {
    const haystack = quoteKey(sourceText);
    for (const variant of quoteVariants(quote, names)) {
        const fragments = variant
            .split(/…|\.\.\./)
            .map(quoteKey)
            .filter((fragment) => fragment.length >= 4);
        if (fragments.length && fragments.every((fragment) => haystack.includes(fragment))) return true;
    }
    const words = quoteWords(quote);
    if (words.length < 3) return false;
    const pool = new Set([...quoteWords(sourceText), 'char', 'user', ...aliases.flatMap(quoteWords)]);
    const found = words.filter((word) => pool.has(word)).length;
    return found / words.length >= 0.85;
}

interface ParseContext {
    sources?: readonly IntentSource[];
    /** Names a quote may use for {{char}} / {{user}}. */
    aliases: string[];
    /** What the sources carry instead of the macros (the card reader replaced them). */
    names: MacroNames;
}

function readEvidence(value: unknown, context: ParseContext): Evidence[] {
    const out: Evidence[] = [];
    for (const raw of records(value, 80)) {
        const quote = cleanText(raw.quote, QUOTE_MAX * 2)
            .replace(/^["'«“„]+|["'»”]+$/g, '')
            .trim();
        const path = cleanText(raw.path, 120);
        const ref = cleanText(raw.source, 40)
            .replace(/^\[|\]$/g, '')
            .toUpperCase();
        if (!quote) continue;
        const clipped = quote.length > QUOTE_MAX ? `${quote.slice(0, QUOTE_MAX - 1).trimEnd()}…` : quote;
        if (!context.sources) {
            out.push({ path, quote: clipped, source: ref, verified: true });
            continue;
        }
        const cited = context.sources.find((source) => source.ref.toUpperCase() === ref);
        if (cited && quoteFound(quote, cited.text, context.aliases, context.names)) {
            out.push({ path, quote: clipped, source: cited.id, verified: true });
            continue;
        }
        const elsewhere = context.sources.find((source) =>
            quoteFound(quote, source.text, context.aliases, context.names),
        );
        if (elsewhere) out.push({ path, quote: clipped, source: elsewhere.id, verified: true });
        else out.push({ path, quote: clipped, source: cited?.id ?? ref, verified: false });
    }
    return out;
}

/* ------------------------------------------------------------------ the reader */

function readTie(raw: Dict): ParsedTie | null {
    const target = cleanText(raw.target, LIMITS.name);
    if (!target) return null;
    return {
        target,
        stance: toStance(raw.stance),
        reasons: cleanList(raw.reasons, 4),
        behaviour: short(raw.behaviour),
        intent: oneOf(TIE_INTENTS, raw.intent, 'none'),
        changeIf: cleanList(raw.changeIf, 4),
        want: intIn(raw.want, 0, 5, 0),
        gaze: oneOf(['', ...GAZES] as const, raw.gaze, ''),
        appetite: oneOf(['', ...APPETITE_KINDS] as const, raw.appetite, ''),
    };
}

function readAppetite(raw: Dict): ParsedAppetite {
    return {
        kind: oneOf(APPETITE_KINDS, raw.kind, 'other'),
        label: cleanText(raw.label, LIMITS.name),
        sources: enumList(['individual', 'species', 'culture', 'situation', 'world'] as const, raw.sources, 5),
        target: oneOf(['thing', 'class', 'player'] as const, raw.target, 'thing'),
        targetClass: cleanText(raw.targetClass, LIMITS.name),
        baseline: intIn(raw.baseline, 0, 5, 2),
        triggers: cleanList(raw.triggers, LIMITS.triggers),
        satisfiers: cleanList(raw.satisfiers, LIMITS.satisfiers),
        drift: oneOf(['daily', 'seasonal', 'opportunity', 'none'] as const, raw.drift, 'opportunity'),
        dependence: intIn(raw.dependence, 0, 3, 0),
        endorsement: oneOf(['proud', 'torn', 'fighting'] as const, raw.endorsement, 'proud'),
        vow: oneOf(['none', 'moderate', 'abstinent'] as const, raw.vow, 'none'),
        visibility: oneOf(['open', 'hidden', 'secret'] as const, raw.visibility, 'open'),
        style: oneOf(['', ...STYLES] as const, raw.style, ''),
        affectionOnset: oneOf(['', 'never', 'rare', 'possible', 'common'] as const, raw.affectionOnset, ''),
        excuse: short(raw.excuse),
        restraints: cleanList(raw.restraints, LIMITS.restraints),
        rule: cleanText(raw.rule, LIMITS.name),
    };
}

/** The answer's core → the profile's core shape; unknowns (−1, '') become absent. */
function readCore(raw: Dict): Record<string, unknown> {
    const temperament: Dict = {};
    const rawTemperament = isDict(raw.temperament) ? raw.temperament : {};
    for (const axis of HEXACO) temperament[axis] = intIn(rawTemperament[axis], -2, 2, 0);
    const wound = isDict(raw.wound) ? raw.wound : {};
    const attachment = isDict(raw.attachment) ? raw.attachment : {};
    const anxiety = intIn(attachment.anxiety, -2, 2, 0);
    const avoidance = intIn(attachment.avoidance, -2, 2, 0);
    const mood = isDict(raw.mood) ? raw.mood : {};
    const octant = oneOf(['', ...MOODS] as const, mood.octant, '');
    const dark = isDict(raw.dark) ? raw.dark : {};
    const proactivity = intIn(raw.proactivity, -1, 10, -1);
    const corruption = intIn(raw.corruption, -1, 10, -1);
    const coping = oneOf(['', 'surrender', 'avoid', 'overcompensate'] as const, wound.coping, '');
    return {
        concept: short(raw.concept),
        values: {
            top: enumList(VALUES, raw.values, LIMITS.values),
            sacrifice: oneOf(['', ...VALUES] as const, raw.sacrifice, '') || undefined,
        },
        temperament,
        drives: {
            high: enumList(DRIVES, raw.drivesHigh, LIMITS.drivesHigh),
            low: enumList(DRIVES, raw.drivesLow, LIMITS.drivesLow),
        },
        wound: {
            ghost: text(wound.ghost),
            lie: text(wound.lie),
            triggers: cleanList(wound.triggers, LIMITS.triggers),
            coping: coping || 'avoid',
        },
        want: text(raw.want),
        need: text(raw.need),
        arcLock: raw.arcLock === true,
        signatures: cleanList(raw.signatures, LIMITS.signatures, LIMITS.text),
        tactics: cleanList(raw.tactics, LIMITS.tactics),
        attachment: anxiety || avoidance ? { anxiety, avoidance } : undefined,
        proactivity: proactivity >= 0 ? proactivity : undefined,
        baselineMood:
            octant || cleanText(mood.label, LIMITS.name)
                ? { octant, label: cleanText(mood.label, LIMITS.name) }
                : undefined,
        stanceBounds: records(raw.bounds, LIMITS.bounds)
            .map((bound) => ({
                target: cleanText(bound.target, LIMITS.name),
                min: typeof bound.min === 'number' ? toStance(bound.min) : undefined,
                max: typeof bound.max === 'number' ? toStance(bound.max) : undefined,
            }))
            .filter((bound) => bound.target && (bound.min !== undefined || bound.max !== undefined)),
        redLines: {
            never: cleanList(raw.redLinesNever, LIMITS.redLines),
            would: cleanList(raw.redLinesWould, LIMITS.redLines),
        },
        keys: cleanList(raw.keys, LIMITS.keys),
        moralWeakness: short(raw.weakness),
        voice: short(raw.voice),
        justifications: enumList(JUSTIFICATIONS, raw.justifications, LIMITS.justifications),
        dark: {
            ruthless: dark.ruthless === true,
            schemer: dark.schemer === true,
            sadist: dark.sadist === true,
            entitled: dark.entitled === true,
        },
        corruption: corruption >= 0 ? corruption : undefined,
        anchors: names(raw.anchors, LIMITS.anchors),
    };
}

function readAgenda(raw: Dict): Record<string, unknown> {
    const front = isDict(raw.front) ? raw.front : {};
    return {
        dream: text(raw.dream),
        goals: records(raw.goals, LIMITS.goals)
            .map((goal) => ({
                text: text(goal.text),
                kind: oneOf(['external', 'internal'] as const, goal.kind, 'external'),
                priority: intIn(goal.priority, 1, 3, 2),
            }))
            .filter((goal) => goal.text),
        intentions: records(raw.intentions, LIMITS.intentions)
            .map((item) => ({
                text: text(item.text),
                nextStep: short(item.nextStep),
                dropIf: cleanList(item.dropIf, 4),
            }))
            .filter((item) => item.text),
        front: {
            impulse: short(front.impulse),
            steps: cleanList(front.steps, LIMITS.steps),
            doom: short(front.doom),
            segments: intIn(front.segments, 0, 8, 0),
        },
        resources: cleanList(raw.resources, LIMITS.agendaList),
        leverage: cleanList(raw.leverage, LIMITS.agendaList),
        secrets: cleanList(raw.secrets, LIMITS.agendaList, LIMITS.text),
        ifIgnored: text(raw.ifIgnored),
    };
}

function readCharacter(raw: Dict, context: ParseContext): ParsedCharacter | null {
    const english = cleanText(raw.english, LIMITS.name);
    const name = cleanText(raw.name, LIMITS.name) || english;
    if (!name) return null;
    const ties: ParsedTie[] = [];
    for (const row of records(raw.ties, LIMITS.ties)) {
        const tie = readTie(row);
        if (tie && !ties.some((other) => textKey(other.target) === textKey(tie.target))) ties.push(tie);
    }
    const starts: ParsedCharacter['starts'] = [];
    for (const row of records(raw.starts, LIMITS.starts)) {
        const greeting = intIn(row.greeting, -1, 999, -1);
        if (starts.some((start) => start.greeting === greeting)) continue;
        starts.push({ greeting, present: row.present !== false, doing: short(row.doing), goal: short(row.goal) });
    }
    return {
        name,
        english,
        aliases: names(raw.aliases).filter((alias) => textKey(alias) !== textKey(name)),
        russian: names(raw.russian, 4).filter((alias) => textKey(alias) !== textKey(name)),
        kind: raw.kind === 'group' ? 'group' : 'character',
        gender: oneOf(['', 'female', 'male'] as const, raw.gender, ''),
        minor: raw.minor === true,
        role: short(raw.role),
        species: cleanText(raw.species, LIMITS.name),
        core: readCore(isDict(raw.core) ? raw.core : {}),
        appetites: dedupeAppetites(records(raw.appetites, LIMITS.appetites * 2).map(readAppetite)),
        agenda: readAgenda(isDict(raw.agenda) ? raw.agenda : {}),
        ties,
        starts,
        evidence: readEvidence(raw.evidence, { ...context, aliases: [...context.aliases, name, english] }),
    };
}

/**
 * One appetite per kind and per craving: a later entry of a kind already listed, or with the same label under another
 * kind («teaching caution» as thrill and as other), is the same craving twice and is dropped.
 */
export function dedupeAppetites<T extends { kind: AppetiteKind; label?: string }>(list: readonly T[]): T[] {
    const out: T[] = [];
    for (const item of list) {
        const label = textKey(item.label ?? '');
        const twin = out.some((other) => other.kind === item.kind || (label && textKey(other.label ?? '') === label));
        if (!twin) out.push(item);
    }
    return out.slice(0, LIMITS.appetites);
}

function readRule(raw: Dict, context: ParseContext): ParsedRule | null {
    const holders = cleanText(raw.holders, LIMITS.name);
    const name = cleanText(raw.name, LIMITS.name) || holders;
    if (!holders && !name) return null;
    const styles: Partial<Record<Style, number>> = {};
    for (const row of records(raw.styles, STYLES.length * 2)) {
        const style = oneOf(['', ...STYLES] as const, row.style, '');
        const weight = typeof row.weight === 'number' && Number.isFinite(row.weight) ? row.weight : 0;
        if (style && weight > 0) styles[style] = Math.round(Math.min(weight, 100) * 1000) / 1000;
    }
    return {
        name,
        holders: holders || name,
        kind: oneOf(APPETITE_KINDS, raw.kind, 'other'),
        label: cleanText(raw.label, LIMITS.name),
        source: oneOf(['species', 'culture', 'situation', 'world'] as const, raw.source, 'species'),
        target: oneOf(['class', 'player', 'thing'] as const, raw.target, 'class'),
        targetClass: cleanText(raw.targetClass, LIMITS.name),
        intensity: normalizeIntensity(raw.intensity),
        styles,
        choosiness: intIn(raw.choosiness, 0, 5, 2),
        exclusivity: oneOf(['exclusive', 'shared', 'harem'] as const, raw.exclusivity, 'exclusive'),
        affectionOnset: oneOf(['never', 'rare', 'possible', 'common'] as const, raw.affectionOnset, 'possible'),
        groupMode: oneOf(['solitary', 'pack', 'tribe'] as const, raw.groupMode, 'solitary'),
        evidence: readEvidence(raw.evidence, context),
    };
}

/** One part's answer → typed, clamped data; null when it is not an object. */
export function parseIntentResult(
    raw: unknown,
    options: { sources?: readonly IntentSource[]; cardName?: string; personaName?: string } = {},
): ParsedIntent | null {
    if (!isDict(raw)) return null;
    const context: ParseContext = {
        sources: options.sources,
        aliases: [options.cardName ?? '', options.personaName ?? ''].filter(Boolean),
        names: { char: options.cardName, user: options.personaName },
    };
    const tone = isDict(raw.worldTone) ? raw.worldTone : {};
    const characters: ParsedCharacter[] = [];
    for (const row of records(raw.characters, 60)) {
        const character = readCharacter(row, context);
        if (character) characters.push(character);
    }
    return {
        worldTone: {
            tone: oneOf(['', 'hostile', 'indifferent', 'neutral', 'welcoming'] as const, tone.tone, ''),
            evidence: readEvidence(tone.evidence, context),
        },
        characters,
        rules: records(raw.rules, 30)
            .map((row) => readRule(row, context))
            .filter((rule): rule is ParsedRule => !!rule),
        reputation: records(raw.reputation, 30)
            .map((row) => ({
                greeting: intIn(row.greeting, -1, 999, -1),
                among: cleanText(row.among, LIMITS.name) || '*',
                label: short(row.label),
                stance: toStance(row.stance),
                evidence: readEvidence(row.evidence, context),
            }))
            .filter((seed) => seed.label),
        invariants: records(raw.invariants, 30)
            .map((row) => ({ text: text(row.text), evidence: readEvidence(row.evidence, context) }))
            .filter((item) => item.text),
    };
}

/* ------------------------------------------------------------------ merging parts */

function firstText(a: string, b: string): string {
    return a || b;
}

function unionList(a: readonly string[], b: readonly string[], max: number): string[] {
    return cleanList([...a, ...b], max, LIMITS.text);
}

function mergeDeep(a: unknown, b: unknown): unknown {
    if (Array.isArray(a) && Array.isArray(b)) {
        const out = [...a];
        for (const item of b) if (!out.some((other) => JSON.stringify(other) === JSON.stringify(item))) out.push(item);
        return out;
    }
    if (isDict(a) && isDict(b)) {
        const out: Dict = { ...a };
        for (const [key, value] of Object.entries(b)) out[key] = key in a ? mergeDeep(a[key], value) : value;
        return out;
    }
    if (typeof a === 'boolean' && typeof b === 'boolean') return a || b;
    if (typeof a === 'number' && typeof b === 'number') return a !== 0 ? a : b;
    return isEmptyValue(a) ? b : a;
}

function mergeCharacter(a: ParsedCharacter, b: ParsedCharacter): ParsedCharacter {
    const ties = [...a.ties];
    for (const tie of b.ties) {
        const at = ties.findIndex((other) => textKey(other.target) === textKey(tie.target));
        if (at < 0) {
            ties.push(tie);
            continue;
        }
        const old = ties[at]!;
        // Two readings disagree: the colder stance wins (anti-softening).
        ties[at] = {
            ...old,
            stance: Math.min(old.stance, tie.stance) as Stance,
            reasons: unionList(old.reasons, tie.reasons, 4),
            behaviour: firstText(old.behaviour, tie.behaviour),
            intent: old.intent !== 'none' ? old.intent : tie.intent,
            changeIf: unionList(old.changeIf, tie.changeIf, 4),
            want: Math.max(old.want, tie.want),
            gaze: old.gaze || tie.gaze,
            appetite: old.appetite || tie.appetite,
        };
    }
    const appetites = [...a.appetites];
    for (const appetite of b.appetites) {
        const label = textKey(appetite.label);
        const at = appetites.findIndex(
            (other) => other.kind === appetite.kind || (!!label && textKey(other.label) === label),
        );
        if (at < 0) appetites.push(appetite);
        else appetites[at] = mergeDeep(appetites[at], appetite) as ParsedAppetite;
    }
    const starts = [...a.starts];
    for (const start of b.starts) if (!starts.some((other) => other.greeting === start.greeting)) starts.push(start);
    const english = firstText(a.english, b.english);
    return {
        name: a.name,
        english,
        aliases: cleanList(
            [...a.aliases, ...b.aliases, b.name].filter(
                (alias) => textKey(alias) !== textKey(a.name) && textKey(alias) !== textKey(english),
            ),
            LIMITS.aliases,
            LIMITS.name,
        ),
        russian: cleanList(
            [...a.russian, ...b.russian].filter((alias) => textKey(alias) !== textKey(a.name)),
            4,
            LIMITS.name,
        ),
        kind: a.kind === 'group' || b.kind === 'group' ? 'group' : 'character',
        gender: a.gender || b.gender,
        minor: a.minor || b.minor,
        role: firstText(a.role, b.role),
        species: firstText(a.species, b.species),
        core: mergeDeep(a.core, b.core) as Dict,
        appetites,
        agenda: mergeDeep(a.agenda, b.agenda) as Dict,
        ties,
        starts,
        evidence: [...a.evidence, ...b.evidence],
    };
}

/** Several parts' answers → one: characters by name or alias, rules by name, colder stances win. */
export function mergeIntentResults(parts: readonly (ParsedIntent | null)[]): ParsedIntent {
    const out: ParsedIntent = {
        worldTone: { tone: '', evidence: [] },
        characters: [],
        rules: [],
        reputation: [],
        invariants: [],
    };
    for (const part of parts) {
        if (!part) continue;
        if (!out.worldTone.tone && part.worldTone.tone) out.worldTone = part.worldTone;
        for (const character of part.characters) {
            const pseudo = out.characters.map((item, i) => ({
                id: String(i),
                name: item.name,
                aliases: item.aliases,
                english: item.english,
            }));
            const at =
                matchName(character.name, pseudo, { strict: true }) ??
                (character.english ? matchName(character.english, pseudo, { strict: true }) : null);
            if (at === null) out.characters.push(character);
            else out.characters[Number(at)] = mergeCharacter(out.characters[Number(at)]!, character);
        }
        for (const rule of part.rules) {
            const at = out.rules.findIndex((other) => textKey(other.name) === textKey(rule.name));
            if (at < 0) out.rules.push(rule);
            else out.rules[at] = { ...out.rules[at]!, evidence: [...out.rules[at]!.evidence, ...rule.evidence] };
        }
        for (const seed of part.reputation) {
            if (
                !out.reputation.some(
                    (other) => other.greeting === seed.greeting && textKey(other.among) === textKey(seed.among),
                )
            ) {
                out.reputation.push(seed);
            }
        }
        for (const item of part.invariants) {
            if (!out.invariants.some((other) => textKey(other.text) === textKey(item.text))) out.invariants.push(item);
        }
    }
    return out;
}

/* ------------------------------------------------------------------ anti-softening */

const HOSTILE_EN =
    /\b(hostil\w*|hates?|hated|hating|hatred|despis\w*|contempt\w*|disdain\w*|scorn\w*|loath\w*|cruel\w*|sadis\w*|spite\w*|resent\w*|distrust\w*|mistrust\w*|suspicio\w*|sneer\w*|threat\w*|menac\w*|enem(?:y|ies)|enmity|kill\w*|murder\w*|torment\w*|tortur\w*|abus\w*|mock\w*|humiliat\w*|revil\w*|bull(?:y|ies|ied|ying)|vicious\w*|merciless\w*|ruthless\w*|bloodthirst\w*|venom\w*|coldly|icy|unwelcom\w*|cold (?:to|toward|towards)|looks? down on)\b/gi;
const HOSTILE_RU =
    /(?:^|[^\p{L}])(ненавид\p{L}*|ненавист\p{L}*|презир\p{L}*|презр\p{L}*|враждеб\p{L}*|вражд\p{L}*|враг\p{L}*|жесток\p{L}*|садис\p{L}*|злоб\p{L}*|недовер\p{L}*|неприязн\p{L}*|издева\p{L}*|униж\p{L}*|угрож\p{L}*|глум\p{L}*|пренебреж\p{L}*|брезг\p{L}*|отвращ\p{L}*|высокомер\p{L}*|свысока|подозрит\p{L}*|с подозрением|безжалост\p{L}*|кровожад\p{L}*|оскорб\p{L}*|насмеха\p{L}*|истяза\p{L}*|убь[её]т|убить|прикончит\p{L}*|холод(?:н\p{L}*|ен) к|холодна|холоден|не терпит|терпеть не может|не любит|не доверя\p{L}*)/giu;
const NEGATION_EN = /\b(not|never|no|isn't|aren't|wasn't|doesn't|don't|didn't|hardly|without|longer)\s+(?:\w+\s+)?$/i;
const NEGATION_RU = /(?:^|[^\p{L}])(не|ни|нет|без|никогда)\s+(?:\p{L}+\s+)?$/iu;
const STRANGER_RE =
    /(stranger|outsider|newcomer|foreigner|traveller|traveler|visitor|intruder|чужак|чужих|чужие|чужим|незнаком|приезж|пришл|чужезем|путник|гост)/iu;

/** Some text matches one of the patterns outside a negation («not cruel», «не любит» do not count). */
function signalIn(texts: readonly string[], patterns: readonly RegExp[]): boolean {
    for (const value of texts) {
        if (!value) continue;
        for (const re of patterns) {
            re.lastIndex = 0;
            for (let match = re.exec(value); match; match = re.exec(value)) {
                const word = match[1] ?? match[0];
                const at = match.index + match[0].length - word.length;
                const before = value.slice(Math.max(0, at - 30), at);
                const negation = /\p{Script=Cyrillic}/u.test(word) ? NEGATION_RU : NEGATION_EN;
                if (!negation.test(before)) return true;
            }
        }
    }
    return false;
}

/** Some text speaks of hostility, contempt or cruelty (English and Russian; «not cruel» does not count). */
export function hostileSignal(texts: readonly string[]): boolean {
    return signalIn(texts, [HOSTILE_EN, HOSTILE_RU]);
}

const WARM_EN =
    /\b(lov(?:e|es|ed|ing)|beloved|adore\w*|devot\w*|cherish\w*|dot(?:e|es|ed|ing) on|affection\w*|protect\w*|cares? (?:only )?(?:for|about)|caring|safety|mother\w*|father\w*|parent\w*|adopt\w*|loyal\w*|her child|his child|their child|would die for|sake)\b/gi;
const WARM_RU =
    /(?:^|[^\p{L}])(люб(?:ит|ят|ила|ил|овь|ви|имый|имая|имого|имой|ящ\p{L}*)|обожа\p{L}*|предан\p{L}*|защищ\p{L}*|защит\p{L}*|забот\p{L}*|нежн\p{L}*|ласков\p{L}*|матер\p{L}*|мать|мама|отец|приёмн\p{L}*|приемн\p{L}*|усынов\p{L}*|удочер\p{L}*|верност\p{L}*|безопасност\p{L}*|ради (?:него|неё|нее|них|тебя))/giu;

/** Some text speaks of love, devotion, protection or parenthood (English and Russian, negations aside). */
export function warmSignal(texts: readonly string[]): boolean {
    return signalIn(texts, [WARM_EN, WARM_RU]);
}

/**
 * Clauses about other people or about a danger to the one they are tied to: «kills anyone who threatens Kai», «cold
 * to everyone else», «when Kai's life is threatened», «убьёт любого, кто угрожает Каю», «холодна ко всем остальным».
 * Hostility there is aimed elsewhere — often for the sake of the target — and says nothing against the target.
 */
const ELSEWHERE_EN = [
    // «becomes merciless whenever Kai is threatened», «if anyone endangers him, …» (the whole sentence after it).
    /(?:\b\w+\s+){0,6}\b(?:when|whenever|if|once)\b[^.;!?]*?\b(?:threatened|threatens|endangered|endangers|in danger|at risk|under threat|in peril|attacked)\b[^.;!?]*/gi,
    // «would burn the world for him», «would kill for Kai».
    /\b(?:\w+\s+){0,2}(?:kill|murder|destroy|burn|fight|slaughter|die)\w*\s+(?:(?:the|a|an|whole|entire|anything|anyone|everything|everyone|world|cities|kingdoms|it|all)\s+){0,3}for\b[^.;!?,]*/gi,
    // «kills anyone who threatens Kai», «cold to everyone else».
    /\b(?:\w+\s+){0,2}(?:anyone|anybody|whoever|everyone|everybody|those|others|other people|the rest|all who|all that)\b(?:\s+(?:else|who|that|but|except))?[^.;!?,]*/gi,
    /\b(?:is|are|was|were|be|being|gets?|got|feels?)\s+(?:\w+\s+)?(?:threatened|endangered|attacked|harmed|hurt|in danger|at risk)\b/gi,
    /\bthreats?\s+(?:to|against)\b[^.;!?,]*/gi,
];
const ELSEWHERE_RU = [
    // «когда Каю угрожает опасность, становится безжалостной».
    /(?:\p{L}+\s+){0,6}(?<![\p{L}])(?:когда|если|стоит)(?![\p{L}])[^.;!?]*?(?:угрожа\p{L}*|опасност\p{L}*|под угрозой)[^.;!?]*/giu,
    // «уничтожит весь мир ради Кая».
    /(?:\p{L}+\s+){0,3}(?<![\p{L}])ради\s+(?:него|неё|нее|них|тебя|вас|\p{Lu}\p{L}*)/gu,
    // «убьёт любого, кто угрожает Каю», «холодна ко всем остальным».
    /(?:\p{L}+\s+){0,2}(?:любо(?:го|й|му|м)|всяко(?:го|му)|кажд\p{L}*|всех|всем|всеми|тех|кто угодно|остальн\p{L}*|други(?:х|м|ми|е)|прочи(?:х|м|ми|е))(?:,?\s*(?:кто|кроме))?[^.;!?,]*/giu,
    /\p{L}*\s*угрожа\p{L}*\s+опасност\p{L}*/giu,
    /(?:в|под)\s+(?:опасности|угрозой)/giu,
];

/** The text without clauses whose hostility is aimed at third parties or at a danger to the target. */
export function aimedAtTarget(text: string): string {
    let out = text;
    for (const re of [...ELSEWHERE_EN, ...ELSEWHERE_RU]) out = out.replace(re, ' ');
    return out;
}

/** A tie target that means newcomers in general («strangers», «чужаки»). */
export function isStrangerClass(target: string): boolean {
    return STRANGER_RE.test(target);
}

/* ------------------------------------------------------------------ evidence paths */

const CORE_FIELDS: Record<string, string> = {
    concept: 'core.concept',
    values: 'core.values',
    sacrifice: 'core.values',
    temperament: 'core.temperament',
    drives: 'core.drives',
    driveshigh: 'core.drives',
    driveslow: 'core.drives',
    wound: 'core.wound',
    want: 'core.want',
    need: 'core.need',
    arclock: 'core.arcLock',
    signatures: 'core.signatures',
    tactics: 'core.tactics',
    attachment: 'core.attachment',
    proactivity: 'core.proactivity',
    mood: 'core.baselineMood',
    baselinemood: 'core.baselineMood',
    bounds: 'core.stanceBounds',
    stancebounds: 'core.stanceBounds',
    redlines: 'core.redLines',
    redlinesnever: 'core.redLines',
    redlineswould: 'core.redLines',
    keys: 'core.keys',
    weakness: 'core.moralWeakness',
    moralweakness: 'core.moralWeakness',
    voice: 'core.voice',
    justifications: 'core.justifications',
    dark: 'core.dark',
    corruption: 'core.corruption',
    anchors: 'core.anchors',
};

const AGENDA_FIELDS: Record<string, string> = {
    dream: 'agenda.dream',
    goals: 'agenda.goals',
    intentions: 'agenda.intentions',
    front: 'agenda.front',
    resources: 'agenda.resources',
    leverage: 'agenda.leverage',
    secrets: 'agenda.secrets',
    ifignored: 'agenda.ifIgnored',
};

const IDENTITY_FIELDS = ['name', 'english', 'aliases', 'russian', 'kind', 'gender', 'minor', 'role', 'species'];

/** Sub-fields of a tie an evidence path may name after the target ('ties.PLAYER.stance'). */
const TIE_FIELDS = new Set([
    'stance',
    'reasons',
    'reason',
    'behaviour',
    'behavior',
    'intent',
    'changeif',
    'want',
    'gaze',
]);

/** What a character's answer lists, for paths that name its entries by index or by label. */
export interface PathEntries {
    /** Appetite kinds in the answer's order, and their labels. */
    appetites: readonly { kind: AppetiteKind; label?: string }[];
    /** Tie targets in the answer's order, as written. */
    ties?: readonly string[];
}

/**
 * The answer's evidence path → the profile path it backs: 'core.drivesHigh' → 'core.drives', 'values' →
 * 'core.values', 'appetites.drink' → 'appetites.drink' (kind; also by index or by the appetite's label),
 * 'ties.PLAYER' and 'ties.PLAYER.stance' → 'ties.@player', 'ties[1]' → that tie's target, 'starts.1'. Null when it
 * names nothing known.
 */
export function canonicalPath(
    path: string,
    resolveTarget: (target: string) => string,
    entries: readonly AppetiteKind[] | PathEntries,
): string | null {
    const list: PathEntries = Array.isArray(entries)
        ? { appetites: (entries as readonly AppetiteKind[]).map((kind) => ({ kind })) }
        : (entries as PathEntries);
    const cleaned = path
        .trim()
        .replace(/^["'«“]+|["'»”]+$/g, '')
        .replace(/\[(\d+)\]/g, '.$1')
        .replace(/^characters?\.\d+\./i, '')
        .replace(/^characters?\./i, '');
    const parts = cleaned.split('.').filter(Boolean);
    if (!parts.length) return null;
    const head = parts[0]!.toLowerCase();
    const second = (parts[1] ?? '').toLowerCase().replace(/[_\s-]/g, '');
    if (head === 'core') return CORE_FIELDS[second] ?? null;
    if (head === 'agenda') return AGENDA_FIELDS[second] ?? null;
    if (head === 'ties' || head === 'tie') {
        const rest = parts.slice(1);
        while (rest.length > 1 && TIE_FIELDS.has(rest[rest.length - 1]!.toLowerCase().replace(/[_\s-]/g, ''))) {
            rest.pop();
        }
        if (rest.length === 2 && /^\d+$/.test(rest[1]!)) rest.pop();
        const target = rest.join('.');
        if (!target) return list.ties?.length === 1 ? `ties.${resolveTarget(list.ties[0]!)}` : null;
        if (/^\d+$/.test(target) && list.ties?.[Number(target)])
            return `ties.${resolveTarget(list.ties[Number(target)]!)}`;
        return `ties.${resolveTarget(target)}`;
    }
    if (head === 'appetites' || head === 'appetite') {
        const key = (parts[1] ?? '').toLowerCase();
        if ((APPETITE_KINDS as readonly string[]).includes(key)) return `appetites.${key}`;
        if (/^\d+$/.test(key) && list.appetites[Number(key)]) return `appetites.${list.appetites[Number(key)]!.kind}`;
        const labelled = key ? list.appetites.find((item) => item.label && textKey(item.label) === textKey(key)) : null;
        if (labelled) return `appetites.${labelled.kind}`;
        return list.appetites.length === 1 ? `appetites.${list.appetites[0]!.kind}` : null;
    }
    if (head === 'starts' || head === 'start') return /^-?\d+$/.test(parts[1] ?? '') ? `starts.${parts[1]}` : 'starts';
    const flat = head.replace(/[_\s-]/g, '');
    if (CORE_FIELDS[flat]) return CORE_FIELDS[flat];
    if (AGENDA_FIELDS[flat]) return AGENDA_FIELDS[flat];
    if (IDENTITY_FIELDS.includes(head)) return head;
    // A bare player reference ("PLAYER", "{{user}}") names the tie to him.
    if (parts.length === 1 && resolveTarget(parts[0]!) === PLAYER_ID) return `ties.${PLAYER_ID}`;
    return null;
}

/**
 * Every profile path one evidence path backs: several fields may share a quote ("core.values, core.drives",
 * "core.values; agenda.goals", "core.values and core.drives"). Duplicates and unknown names are left out.
 */
export function canonicalPaths(
    path: string,
    resolveTarget: (target: string) => string,
    entries: readonly AppetiteKind[] | PathEntries,
): string[] {
    const out: string[] = [];
    const pieces = path
        .split(/\s*[,;|&+]\s*/)
        .flatMap((piece) => piece.split(/\s+and\s+(?=(?:core|agenda|ties?|appetites?|starts?)\.)/i));
    for (const piece of pieces) {
        if (!piece.trim()) continue;
        const canonical = canonicalPath(piece, resolveTarget, entries);
        if (canonical && !out.includes(canonical)) out.push(canonical);
    }
    return out;
}

/* ------------------------------------------------------------------ applying */

/** A class of people that means children (no sexual rule may aim at it). */
export const MINOR_CLASS_RE =
    /(child|children|kid|minor|underage|teen|ребен|ребён|дет|малолет|несовершеннолет|подрост)/iu;
const PLAYER_WORDS = [
    'player',
    'the player',
    "player's character",
    "the player's character",
    'player character',
    'the player character',
    'user',
    '{{user}}',
    'you',
    'игрок',
    'игрока',
    'персонаж игрока',
    PLAYER_REF.toLowerCase(),
    PLAYER_ID,
];
const PLAYER_QUOTE_RE =
    /(\{\{user\}\}|\bhero\b|\bthe player\b|\byou\b|\byour\b|геро[йяюе]\p{L}*|(?:^|[^\p{L}])(?:ты|тебя|тебе|тобой|вас|вам)(?=[^\p{L}]|$))/iu;

/** The method style of an appetite whose source names none. */
export const DEFAULT_STYLE: Record<AppetiteKind, Style> = {
    flesh: 'siren',
    plunder: 'raider',
    dominance: 'raider',
    cruelty: 'raider',
    hunger: 'shadow',
    food: 'buyer',
    drink: 'buyer',
    substance: 'buyer',
    thrill: 'buyer',
    luxury: 'buyer',
    adoration: 'siren',
    other: 'buyer',
};

/** Whether getting it may turn into affection, when the source does not say (else 'possible'). */
export const DEFAULT_ONSET: Partial<Record<AppetiteKind, AffectionOnset>> = {
    plunder: 'rare',
    cruelty: 'rare',
    hunger: 'rare',
};

function same(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function diffWhere(where: { id: string; name: string }): Pick<IntentDiff, 'character' | 'name'> {
    return { character: where.id, name: where.name };
}

interface Session {
    options: ApplyOptions;
    diff: IntentDiff[];
    warnings: IntentWarning[];
    /** Fields written without a quote, per character name (one note per character, not one per field). */
    inferred: Map<string, number>;
}

/** Meta of an applied field: the author's with quotes, or inferred when the reading had no quote for it. */
function metaOf(evidence: readonly Evidence[]): FieldMeta {
    if (!evidence.length) return { origin: 'inferred' };
    const quotes = cleanList(
        evidence.map((item) => item.quote),
        LIMITS.evidence,
        QUOTE_MAX,
    );
    const sources = [...new Set(evidence.map((item) => item.source).filter(Boolean))].slice(0, LIMITS.evidence * 2);
    return { origin: 'author', evidence: quotes, sources };
}

/**
 * Writes one field unless the user owns it or it is locked; records a difference when an older value changes or
 * when the user's value stays against a different reading.
 */
function writeField<T extends { meta: Record<string, FieldMeta> }>(
    session: Session,
    holder: T,
    where: { id: string; name: string },
    path: string,
    value: unknown,
    evidence: readonly Evidence[],
): T {
    // The card's structured intent is the author's word: the reading of the text leaves it as written.
    if (isCardAuthored(holder, path)) return holder;
    const before = getPath(holder, path);
    if (isProtected(holder, path)) {
        if (!same(before, value)) {
            session.diff.push({
                character: where.id,
                name: where.name,
                path,
                before,
                after: value,
                status: isLocked(holder, path) ? 'kept-locked' : 'kept-user',
            });
        }
        return holder;
    }
    // A value nobody set (no meta) is a default: replacing it is not a difference worth showing.
    if (metaAt(holder, path) && !isEmptyValue(before) && !same(before, value)) {
        session.diff.push({ character: where.id, name: where.name, path, before, after: value, status: 'updated' });
    }
    return setMeta(setPath(holder, path, value), path, metaOf(evidence));
}

/**
 * Evidence usable under the fidelity: a quote not found in the sources is dropped when strict, kept with a warning
 * when balanced (a paraphrase or a translation), kept silently when free.
 */
function usable(session: Session, evidence: readonly Evidence[], name: string): Evidence[] {
    const out: Evidence[] = [];
    const fidelity = session.options.fidelity;
    for (const item of evidence) {
        if (!item.verified && fidelity !== 'free') {
            session.warnings.push({ code: 'quote-unverified', name, path: item.path, detail: item.quote });
            if (fidelity === 'strict') continue;
        }
        out.push(item);
    }
    return out;
}

/**
 * Evidence for a field. A field without any is still the reading's — kept as inferred (the prompt forbids invention
 * beyond the sources; a missing quote only says no single line could be cited) and counted for the character's note.
 */
function gate(session: Session, evidence: readonly Evidence[], name: string): Evidence[] {
    // Card-level fields (name '') show their badge in the sheet; the note counts the characters' fields.
    if (!evidence.length && name) session.inferred.set(name, (session.inferred.get(name) ?? 0) + 1);
    return [...evidence];
}

interface CharacterPlan {
    parsed: ParsedCharacter;
    id: string;
    evidence: Map<string, Evidence[]>;
}

/**
 * A tie target, bound or anchor that means the player's character: PLAYER, {{user}}, «the player's character», the
 * persona's name (any case form: «Тарена» of «Тарен»), also with a parenthesis («PLAYER (Тарен)»).
 */
export function isPlayerRef(target: string, persona: string): boolean {
    const raw = target.trim();
    const bare = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
    for (const value of [raw, bare]) {
        const key = value.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ');
        if (PLAYER_WORDS.includes(key)) return true;
    }
    if (!persona) return false;
    return (
        normalizeName(bare) === normalizeName(persona) ||
        matchName(bare, [{ id: PLAYER_ID, name: persona, aliases: [] }]) === PLAYER_ID
    );
}

/** A verified quote of the author that names the player's character and speaks of love, devotion or protection. */
function devotionQuoted(evidence: readonly Evidence[], persona: string): boolean {
    return evidence.some(
        (item) =>
            item.verified &&
            (PLAYER_QUOTE_RE.test(item.quote) || (!!persona && quoteKey(item.quote).includes(quoteKey(persona)))) &&
            warmSignal([item.quote]),
    );
}

/** The author's reasons of a tie: permanent, sharing the stance between them. */
export function authorReasons(texts: readonly string[], stance: number): Reason[] {
    if (!texts.length || stance === 0) {
        return texts.map((value, i) => ({ id: `author-${i + 1}`, text: value, delta: 0, scenesLeft: null, stacks: 1 }));
    }
    const delta = Math.round((stance / texts.length) * 1000) / 1000;
    return texts.map((value, i) => ({ id: `author-${i + 1}`, text: value, delta, scenesLeft: null, stacks: 1 }));
}

/**
 * Applies the model's answer — one part's JSON, or an array of the parts' answers — to the card's profiles. See the
 * file header for the rules.
 */
export function applyIntent(current: CardProfiles, result: unknown, options: ApplyOptions): ApplyResult {
    const parseOptions = { sources: options.sources, cardName: options.cardName, personaName: options.personaName };
    const parts = (Array.isArray(result) ? result : [result]).map((part) => parseIntentResult(part, parseOptions));
    const applied = applyParsedIntent(current, mergeIntentResults(parts), options);
    if (!parts.length || parts.some((part) => part === null)) applied.warnings.unshift({ code: 'bad-answer' });
    return applied;
}

/** Applies an already parsed (and merged) reading. */
export function applyParsedIntent(current: CardProfiles, parsed: ParsedIntent, options: ApplyOptions): ApplyResult {
    const session: Session = { options, diff: [], warnings: [], inferred: new Map() };
    let card = normalizeCardProfiles(current, current.card);
    const persona = options.personaName?.trim() ?? '';

    /* characters: match or create */
    const plans: CharacterPlan[] = [];
    for (const character of parsed.characters) {
        const candidates = [character.name, character.english, ...character.aliases, ...character.russian].filter(
            Boolean,
        );
        let id: string | null = null;
        for (const candidate of candidates) {
            id = matchName(candidate, card.characters, { strict: true });
            if (id) break;
        }
        if (id && plans.some((plan) => plan.id === id)) {
            const plan = plans.find((item) => item.id === id)!;
            plan.parsed = mergeCharacter(plan.parsed, character);
            continue;
        }
        if (!id) {
            const main = !!options.cardName && normalizeName(options.cardName) === normalizeName(character.name);
            const profile = emptyProfile(character.name, {
                taken: card.characters.map((item) => item.id),
                kind: character.kind,
                lod: main ? 'portrait' : 'draft',
                english: character.english,
                aliases: character.aliases,
            });
            card = { ...card, characters: [...card.characters, profile] };
            id = profile.id;
        }
        plans.push({ parsed: character, id, evidence: new Map() });
    }

    const resolveTarget = (target: string): string => {
        if (isPlayerRef(target, persona)) return PLAYER_ID;
        const bare = target.replace(/\s*\([^)]*\)\s*$/, '').trim() || target;
        return matchName(bare, card.characters, { strict: true }) ?? cleanText(bare, LIMITS.name);
    };

    for (const plan of plans) {
        const entries: PathEntries = {
            appetites: plan.parsed.appetites.map((appetite) => ({ kind: appetite.kind, label: appetite.label })),
            ties: plan.parsed.ties.map((tie) => tie.target),
        };
        for (const item of usable(session, plan.parsed.evidence, plan.parsed.name)) {
            for (const path of canonicalPaths(item.path, resolveTarget, entries)) {
                const list = plan.evidence.get(path) ?? [];
                list.push(item);
                plan.evidence.set(path, list);
            }
        }
    }

    /* a full re-read: what the generator wrote for these characters gives way to the reading */
    const cleared = new Map<string, Map<string, unknown>>();
    if (options.replaceGenerated) {
        const ids = new Set(plans.map((plan) => plan.id));
        card = {
            ...card,
            characters: card.characters.map((profile) => {
                if (!ids.has(profile.id)) return profile;
                const out = clearGenerated(profile);
                if (out.cleared.size) cleared.set(profile.id, out.cleared);
                return out.profile;
            }),
        };
    }

    /* card level: world tone, invariants, rules, reputation */
    const cardWhere = { id: '', name: '' };
    const tone = parsed.worldTone;
    if (tone.tone) {
        const evidence = gate(session, usable(session, tone.evidence, ''), '');
        card = writeField(session, card, cardWhere, 'worldTone', tone.tone, evidence);
    }
    const invariants: string[] = [];
    const invariantEvidence: Evidence[] = [];
    for (const item of parsed.invariants) {
        invariants.push(item.text);
        invariantEvidence.push(...gate(session, usable(session, item.evidence, ''), ''));
    }
    if (invariants.length) {
        const union = cleanList([...card.invariants, ...invariants], 24, LIMITS.text);
        card = writeField(session, card, cardWhere, 'invariants', union, invariantEvidence);
    }
    const ruleIds = new Map<string, string>();
    for (const rule of parsed.rules) {
        let evidence = gate(session, usable(session, rule.evidence, rule.name), '');
        let target: AppetiteRule['target'] =
            rule.target === 'player'
                ? { mode: 'player' }
                : rule.target === 'thing'
                  ? { mode: 'thing' }
                  : { mode: 'class', class: rule.targetClass || rule.holders };
        // Decision В17: «exactly the player» only when the scenario names him; otherwise the class.
        if (
            target.mode === 'player' &&
            !evidence.some((item) => PLAYER_QUOTE_RE.test(item.quote) || (persona && item.quote.includes(persona)))
        ) {
            session.warnings.push({ code: 'rule-target', name: rule.name });
            target = { mode: 'class', class: rule.targetClass || 'people like the player' };
        }
        if (SEXUAL_KINDS.includes(rule.kind) && target.mode === 'class' && MINOR_CLASS_RE.test(target.class)) {
            session.warnings.push({ code: 'minor-target', name: rule.name });
            continue;
        }
        const existing = card.rules.find(
            (other) =>
                textKey(other.label ?? '') === textKey(rule.name) ||
                (textKey(other.holders) === textKey(rule.holders) && other.kind === rule.kind),
        );
        const id =
            existing?.id ??
            slugId(
                rule.name || `${rule.holders} ${rule.kind}`,
                card.rules.map((other) => other.id),
            );
        ruleIds.set(textKey(rule.name), id);
        evidence = evidence.slice(0, LIMITS.evidence);
        const value: AppetiteRule = {
            ...(existing ?? {}),
            id,
            holders: rule.holders,
            kind: rule.kind,
            label: rule.label || rule.name,
            source: rule.source,
            target,
            intensity: rule.intensity,
            styles: rule.styles,
            choosiness: rule.choosiness,
            exclusivity: rule.exclusivity,
            affectionOnset: rule.affectionOnset,
            groupMode: rule.groupMode,
            ...(evidence.length ? { evidence: metaOf(evidence).evidence } : {}),
        };
        const path = `rules.${id}`;
        if (isCardAuthored(card, path)) continue;
        if (isProtected(card, path)) {
            if (existing && !same(existing, value)) {
                session.diff.push({
                    character: '',
                    name: rule.name,
                    path,
                    before: existing,
                    after: value,
                    status: isLocked(card, path) ? 'kept-locked' : 'kept-user',
                });
            }
            continue;
        }
        if (existing && !same(existing, value)) {
            session.diff.push({
                character: '',
                name: rule.name,
                path,
                before: existing,
                after: value,
                status: 'updated',
            });
        }
        card = setMeta(
            {
                ...card,
                rules: existing ? card.rules.map((other) => (other.id === id ? value : other)) : [...card.rules, value],
            },
            path,
            metaOf(evidence),
        );
    }
    const seeds: ReputationSeed[] = [];
    const seedEvidence: Evidence[] = [];
    for (const seed of parsed.reputation) {
        const evidence = gate(session, usable(session, seed.evidence, ''), '');
        seeds.push({
            among: seed.among,
            label: seed.label,
            stance: seed.stance,
            greeting: seed.greeting,
            ...(evidence.length ? { evidence: metaOf(evidence).evidence } : {}),
        });
        seedEvidence.push(...evidence);
    }
    if (seeds.length) {
        const kept = card.reputation.filter(
            (old) =>
                !seeds.some((seed) => seed.greeting === old.greeting && textKey(seed.among) === textKey(old.among)),
        );
        card = writeField(session, card, cardWhere, 'reputation', [...kept, ...seeds], seedEvidence);
    }

    /* characters: fields */
    const profiles = new Map(card.characters.map((profile) => [profile.id, profile] as const));
    for (const plan of plans) {
        const before = profiles.get(plan.id)!;
        const after = applyCharacter(session, before, plan, resolveTarget, ruleIds);
        profiles.set(plan.id, after);
        // What the full re-read dropped: replaced by the reading, or left empty for a grounded fill.
        for (const [path, old] of cleared.get(plan.id) ?? []) {
            const now = getPath(after, path);
            if (!same(old, now)) {
                session.diff.push({
                    character: after.id,
                    name: after.name,
                    path,
                    before: old,
                    after: now,
                    status: 'updated',
                });
            }
        }
    }
    card = { ...card, characters: card.characters.map((profile) => profiles.get(profile.id) ?? profile) };
    card = enforceMinors(session, card);
    card = {
        ...card,
        intent: {
            at: options.now,
            sourcesHash: options.sourcesHash,
            ...(options.model ? { model: options.model } : {}),
            ...(options.fromCard ? { fromCard: options.fromCard } : {}),
        },
    };
    for (const [name, count] of session.inferred) {
        session.warnings.push({ code: 'inferred', name, detail: String(count) });
    }
    return { profiles: card, diff: session.diff, warnings: session.warnings };
}

/** One field of a character: backed by the evidence of any of its paths (inferred without), then written. */
function field(
    session: Session,
    profile: CharacterProfile,
    plan: CharacterPlan,
    path: string,
    value: unknown,
    backing: readonly string[] = [path],
): CharacterProfile {
    if (isEmptyValue(value) || isCardAuthored(profile, path)) return profile;
    const evidence = backing.flatMap((key) => plan.evidence.get(key) ?? []);
    const gated = gate(session, evidence, plan.parsed.name);
    return writeField(session, profile, { id: profile.id, name: profile.name }, path, value, gated);
}

const LATIN_NAME_RE = /^[\p{Script=Latin}\s'’.-]+$/u;
/** Words before a name that are no name on their own («Lady Mirelle» is never just «Lady»). */
const TITLES = new Set([
    'lady',
    'lord',
    'sir',
    'dame',
    'king',
    'queen',
    'prince',
    'princess',
    'captain',
    'master',
    'mistress',
    'mr',
    'mrs',
    'miss',
    'dr',
    'леди',
    'лорд',
    'сэр',
    'госпожа',
    'господин',
    'король',
    'королева',
    'принц',
    'принцесса',
    'капитан',
    'мастер',
]);

/**
 * The first word of a full name, when the sources call the character by it alone («Mirelle» of «Mirelle Varrow»): at
 * least three letters, and found more often than the full name itself.
 */
export function firstNameAlias(name: string, sources: readonly Pick<IntentSource, 'text'>[]): string | null {
    const words = name.trim().split(/\s+/);
    const first = words[0] ?? '';
    if (words.length < 2 || first.length < 3 || !/^\p{Lu}/u.test(first)) return null;
    if (TITLES.has(first.toLowerCase().replace(/\.$/, ''))) return null;
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const count = (needle: string) => {
        const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(needle)}(?![\\p{L}\\p{N}])`, 'gu');
        return sources.reduce((sum, source) => sum + (source.text.match(re)?.length ?? 0), 0);
    };
    return count(first) > count(name.trim()) ? first : null;
}

/**
 * A friendly stance the texts contradict (anti-softening): the author's verified quotes speak of hostility, or the
 * reading's own words do while not speaking of love. Toward the player, hostility aimed elsewhere for his sake («kills
 * anyone who threatens him», «merciless when he is in danger») does not count, and the author's own words of devotion
 * to him outweigh the rest.
 */
function softened(tie: ParsedTie, evidence: readonly Evidence[], player: boolean, persona: string): boolean {
    const aim = (text: string) => (player ? aimedAtTarget(text) : text);
    if (player && devotionQuoted(evidence, persona)) return false;
    const quoted = evidence.filter((item) => item.verified).map((item) => aim(item.quote));
    if (hostileSignal(quoted)) return true;
    const own = [...tie.reasons, tie.behaviour, ...evidence.filter((item) => !item.verified).map((item) => item.quote)];
    if (!hostileSignal(own.map(aim))) return false;
    // The reading's own warm words for a close bond outweigh its own harsh ones (no line of the author says otherwise).
    return !(player && tie.stance >= 2 && warmSignal([...tie.reasons, tie.behaviour]));
}

function applyCharacter(
    session: Session,
    start: CharacterProfile,
    plan: CharacterPlan,
    resolveTarget: (target: string) => string,
    ruleIds: ReadonlyMap<string, string>,
): CharacterProfile {
    const { parsed } = plan;
    const fidelity = session.options.fidelity;
    const persona = session.options.personaName?.trim() ?? '';
    let profile = start;
    const where = { id: profile.id, name: profile.name };
    // Who they are needs no quote; it keeps its old provenance unless a quote backs it.
    const identity = (path: string, value: unknown) => {
        if (isEmptyValue(value) || same(getPath(profile, path), value) || isCardAuthored(profile, path)) return;
        const evidence = plan.evidence.get(path) ?? [];
        if (evidence.length || isProtected(profile, path)) {
            profile = writeField(session, profile, where, path, value, evidence);
            return;
        }
        if (!isEmptyValue(getPath(profile, path))) {
            session.diff.push({
                ...diffWhere(where),
                path,
                before: getPath(profile, path),
                after: value,
                status: 'updated',
            });
        }
        profile = setPath(profile, path, value);
    };

    /* identity: no evidence needed */
    identity('kind', parsed.kind);
    identity('role', parsed.role);
    identity('species', parsed.species);
    identity('gender', parsed.gender || undefined);
    // The English name: as read, else the name itself when it is written in Latin letters.
    const english = parsed.english || (LATIN_NAME_RE.test(profile.name) ? profile.name : '');
    identity('english', english || undefined);
    // Every name the story may call them by: the reading's aliases, its Russian forms, the first name the sources use.
    const first = session.options.sources ? firstNameAlias(profile.name, session.options.sources) : null;
    const aliases = cleanList(
        [...profile.aliases, ...parsed.aliases, ...parsed.russian, ...(first ? [first] : [])],
        LIMITS.aliases,
        LIMITS.name,
    ).filter((alias) => textKey(alias) !== textKey(profile.name));
    identity('aliases', aliases);
    if (parsed.minor && !profile.minor && !isCardAuthored(profile, 'minor')) profile = { ...profile, minor: true };

    /* core, field by field (the answer's shape → the profile's) */
    const core: Core = normalizeCore(parsed.core);
    const raw = parsed.core;
    const coreField = (key: keyof Core, value: unknown, backing?: string[]) => {
        profile = field(session, profile, plan, `core.${key}`, value, backing);
    };
    coreField('concept', core.concept);
    coreField('values', core.values.top.length ? core.values : undefined);
    coreField('temperament', Object.keys(core.temperament).length ? core.temperament : undefined);
    coreField('drives', core.drives.high.length || core.drives.low.length ? core.drives : undefined);
    coreField('wound', core.wound);
    coreField('want', core.want);
    coreField('need', core.need);
    coreField('arcLock', core.arcLock ? true : undefined);
    coreField('signatures', core.signatures);
    coreField('tactics', core.tactics);
    coreField('attachment', core.attachment);
    coreField('proactivity', raw.proactivity === undefined ? undefined : core.proactivity);
    coreField('baselineMood', raw.baselineMood === undefined ? undefined : core.baselineMood);
    coreField('redLines', core.redLines.never.length || core.redLines.would.length ? core.redLines : undefined);
    coreField('moralWeakness', core.moralWeakness);
    coreField('voice', core.voice);
    coreField('justifications', core.justifications);
    coreField('dark', core.dark);
    coreField('corruption', raw.corruption === undefined ? undefined : core.corruption);
    coreField(
        'anchors',
        cleanList(
            core.anchors.map((anchor) => {
                const id = resolveTarget(anchor);
                return id === anchor ? anchor : id;
            }),
            LIMITS.anchors,
            LIMITS.name,
        ),
    );

    /* agenda */
    const agenda = parsed.agenda;
    const agendaField = (key: keyof Agenda, value: unknown) => {
        profile = field(session, profile, plan, `agenda.${key}`, value);
    };
    agendaField('dream', agenda.dream);
    agendaField(
        'goals',
        (agenda.goals as { text: string; kind: 'external' | 'internal'; priority: number }[]).map((goal, i) => ({
            id: `g${i + 1}`,
            ...goal,
        })),
    );
    agendaField(
        'intentions',
        (agenda.intentions as { text: string; nextStep: string; dropIf: string[] }[])
            .slice(0, LIMITS.intentions)
            .map((item, i) => ({
                id: `i${i + 1}`,
                ...item,
            })),
    );
    const front = agenda.front as { impulse: string; steps: string[]; doom: string; segments: number };
    agendaField(
        'front',
        front.impulse
            ? {
                  impulse: front.impulse,
                  steps: front.steps,
                  doom: front.doom,
                  clock: { segments: front.segments >= 4 ? front.segments : 6, filled: 0 },
              }
            : undefined,
    );
    agendaField('resources', agenda.resources);
    agendaField('leverage', agenda.leverage);
    agendaField('secrets', agenda.secrets);
    agendaField('ifIgnored', agenda.ifIgnored);

    /* appetites (before ties: ties point at them); one per craving, never a twin of one the profile holds */
    const appetiteIds = new Map<AppetiteKind, string>();
    for (const appetite of parsed.appetites) {
        const label = textKey(appetite.label);
        const existing =
            profile.appetites.find((item) => item.kind === appetite.kind) ??
            (label ? profile.appetites.find((item) => textKey(item.label ?? '') === label) : undefined);
        if (existing && existing.kind !== appetite.kind) continue;
        const id =
            existing?.id ??
            slugId(
                appetite.kind,
                profile.appetites.map((item) => item.id),
            );
        appetiteIds.set(appetite.kind, id);
        const value = normalizeAppetite({
            ...(existing ?? {}),
            id,
            kind: appetite.kind,
            label: appetite.label || existing?.label,
            sources: appetite.sources.length ? appetite.sources : ['individual'],
            target:
                appetite.target === 'player'
                    ? { mode: 'player' }
                    : appetite.target === 'class' && appetite.targetClass
                      ? { mode: 'class', class: appetite.targetClass }
                      : { mode: 'thing' },
            baseline: appetite.baseline,
            triggers: appetite.triggers,
            satisfiers: appetite.satisfiers.map((what) => ({ what, amount: 2 })),
            drift: appetite.drift,
            dependence: appetite.dependence,
            endorsement: appetite.endorsement,
            vow: appetite.vow,
            visibility: appetite.visibility,
            style: appetite.style || existing?.style || DEFAULT_STYLE[appetite.kind],
            affectionOnset:
                appetite.affectionOnset || existing?.affectionOnset || DEFAULT_ONSET[appetite.kind] || 'possible',
            excuse: appetite.excuse || undefined,
            restraints: appetite.restraints.length ? appetite.restraints : undefined,
            rule: appetite.rule ? (ruleIds.get(textKey(appetite.rule)) ?? slugId(appetite.rule)) : existing?.rule,
        })!;
        const path = `appetites.${id}`;
        if (isCardAuthored(profile, path)) continue;
        const evidence = gate(session, plan.evidence.get(`appetites.${appetite.kind}`) ?? [], parsed.name);
        profile = writeField(session, profile, where, path, value, evidence);
    }

    /* ties */
    const keys: string[] = [];
    let playerTie: { tie: ParsedTie; evidence: Evidence[] } | null = null;
    let strangerTie: { tie: ParsedTie; evidence: Evidence[] } | null = null;
    const ties: { id: string; tie: ParsedTie; evidence: Evidence[] }[] = [];
    for (const tie of parsed.ties) {
        const id = resolveTarget(tie.target);
        if (id === profile.id || isCardAuthored(profile, `ties.${id}`)) continue;
        const evidence = plan.evidence.get(`ties.${id}`) ?? [];
        let stance = tie.stance;
        const guarded = id === PLAYER_ID || isStrangerClass(id);
        if (guarded && stance > -1 && softened(tie, evidence, id === PLAYER_ID, persona)) {
            session.warnings.push({
                code: 'stance-capped',
                name: parsed.name,
                path: `ties.${id}`,
                detail: `${stance} → -1`,
            });
            stance = -1;
        }
        const entry = { id, tie: { ...tie, stance: stance as Stance }, evidence };
        if (id === PLAYER_ID) playerTie = { tie: entry.tie, evidence };
        else if (isStrangerClass(id) && !strangerTie) strangerTie = { tie: entry.tie, evidence };
        ties.push(entry);
    }
    // The player is a stranger at the start: when the author quoted nothing about him but spoke of strangers coldly —
    // unless the reading made him someone close (a stance above +1 is a bond, not a stranger's welcome).
    if (
        strangerTie &&
        strangerTie.tie.stance < 0 &&
        !isCardAuthored(profile, `ties.${PLAYER_ID}`) &&
        (!playerTie || (!playerTie.evidence.length && playerTie.tie.stance <= 1))
    ) {
        const stance = Math.min(strangerTie.tie.stance, playerTie?.tie.stance ?? 0) as Stance;
        const derived: ParsedTie = { ...strangerTie.tie, target: PLAYER_REF, stance, want: 0, gaze: '', appetite: '' };
        session.warnings.push({ code: 'stranger-stance', name: parsed.name, path: `ties.${PLAYER_ID}` });
        const at = ties.findIndex((entry) => entry.id === PLAYER_ID);
        const entry = { id: PLAYER_ID, tie: derived, evidence: strangerTie.evidence };
        if (at >= 0) ties[at] = entry;
        else ties.push(entry);
        playerTie = { tie: derived, evidence: strangerTie.evidence };
    }
    for (const entry of ties) {
        const path = `ties.${entry.id}`;
        if (isCardAuthored(profile, path)) continue;
        const gated = gate(session, entry.evidence, parsed.name);
        const existing = profile.ties.find((item) => item.target === entry.id);
        const base: Tie = existing ?? emptyTie(entry.id);
        const kept = base.reasons.filter((reason) => !reason.id.startsWith('author-'));
        const appetiteId = entry.tie.appetite
            ? (appetiteIds.get(entry.tie.appetite) ??
              profile.appetites.find((item) => item.kind === entry.tie.appetite)?.id)
            : undefined;
        const value: Tie = {
            ...base,
            stance: entry.tie.stance,
            reasons: [...authorReasons(entry.tie.reasons, entry.tie.stance), ...kept].slice(0, LIMITS.reasons),
            intent: entry.tie.intent,
            ...(entry.tie.behaviour ? { behaviour: entry.tie.behaviour } : {}),
            ...(entry.tie.want > 0 ? { want: entry.tie.want as Tie['want'] } : {}),
            ...(entry.tie.want > 0 && entry.tie.gaze ? { gaze: entry.tie.gaze } : {}),
            ...(entry.tie.want > 0 && appetiteId ? { appetite: appetiteId } : {}),
        };
        profile = writeField(session, profile, where, path, value, gated);
        keys.push(...entry.tie.changeIf);
    }
    // What could change a stance is a key of the character (§4.1); the ties' quotes back them too.
    coreField('keys', cleanList([...core.keys, ...keys], LIMITS.keys), [
        'core.keys',
        ...ties.filter((entry) => entry.tie.changeIf.length).map((entry) => `ties.${entry.id}`),
    ]);

    /*
     * stance bounds: the answer's, plus (strict) the author's ceiling for a hostile start and the author's floor for
     * devotion to the player the sources state in so many words
     */
    const bounds: StanceBound[] = core.stanceBounds.map((bound) => ({ ...bound, target: resolveTarget(bound.target) }));
    const boundEvidence = [...(plan.evidence.get('core.stanceBounds') ?? [])];
    const playerBound = bounds.some((bound) => bound.target === PLAYER_ID);
    // The author's own tie to the player (the card's structured intent) is not this reading's to bound.
    const playerAuthored = isCardAuthored(profile, `ties.${PLAYER_ID}`);
    if (fidelity === 'strict' && playerTie && !playerBound && !playerAuthored && playerTie.evidence.length > 0) {
        if (playerTie.tie.stance <= -1) {
            bounds.push({ target: PLAYER_ID, max: 0 });
            boundEvidence.push(...playerTie.evidence);
        } else if (playerTie.tie.stance >= 3 && devotionQuoted(playerTie.evidence, persona)) {
            bounds.push({ target: PLAYER_ID, min: 2 });
            boundEvidence.push(...playerTie.evidence);
        }
    }
    if (bounds.length && !isCardAuthored(profile, 'core.stanceBounds')) {
        const gated = gate(session, boundEvidence, parsed.name);
        profile = writeField(session, profile, where, 'core.stanceBounds', bounds.slice(0, LIMITS.bounds), gated);
    }

    /* starts per greeting */
    if (parsed.starts.length && !isCardAuthored(profile, 'starts')) {
        const evidence = parsed.starts
            .flatMap((start) => [...(plan.evidence.get(`starts.${start.greeting}`) ?? [])])
            .concat(plan.evidence.get('starts') ?? []);
        const merged = [
            ...profile.starts.filter((old) => !parsed.starts.some((start) => start.greeting === old.greeting)),
            ...parsed.starts.map((start) => ({
                greeting: start.greeting,
                present: start.present,
                ...(start.doing ? { doing: start.doing } : {}),
                ...(start.goal ? { goal: start.goal } : {}),
            })),
        ].sort((a, b) => a.greeting - b.greeting);
        profile = writeField(session, profile, where, 'starts', merged, gate(session, evidence, parsed.name));
    }
    return profile;
}

/**
 * The content boundary: minors have no sexual appetites, and nobody's sexual appetite (or a mate's gaze) aims at a
 * minor. Applies to the whole card, whatever the origin of the data.
 */
export function enforceMinors(session: { warnings: IntentWarning[] }, card: CardProfiles): CardProfiles {
    const minors = new Set(card.characters.filter((profile) => profile.minor).map((profile) => profile.id));
    if (!minors.size) return card;
    const characters = card.characters.map((profile) => {
        let next = profile;
        if (minors.has(profile.id)) {
            const kept = profile.appetites.filter((appetite) => !SEXUAL_KINDS.includes(appetite.kind));
            if (kept.length !== profile.appetites.length) {
                session.warnings.push({ code: 'minor-appetite', name: profile.name });
                const dropped = new Set(
                    profile.appetites.filter((appetite) => !kept.includes(appetite)).map((appetite) => appetite.id),
                );
                next = {
                    ...next,
                    appetites: kept,
                    ties: next.ties.map((tie) => (tie.appetite && dropped.has(tie.appetite) ? stripWant(tie) : tie)),
                };
            }
        }
        const sexual = new Set(
            next.appetites.filter((appetite) => SEXUAL_KINDS.includes(appetite.kind)).map((appetite) => appetite.id),
        );
        const ties = next.ties.map((tie) => {
            if (!minors.has(tie.target) || tie.want === undefined) return tie;
            if (tie.gaze === 'mate' || (tie.appetite && sexual.has(tie.appetite)) || (!tie.appetite && sexual.size)) {
                session.warnings.push({ code: 'minor-target', name: profile.name, path: `ties.${tie.target}` });
                return stripWant(tie);
            }
            return tie;
        });
        return { ...next, ties };
    });
    return { ...card, characters };
}

function stripWant(tie: Tie): Tie {
    const { want: _want, gaze: _gaze, claim: _claim, appetite: _appetite, ...rest } = tie;
    return rest;
}
