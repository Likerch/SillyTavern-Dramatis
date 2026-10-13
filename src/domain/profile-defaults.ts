// Empty profiles, a tolerant normaliser (files from older versions, model output, hand edits) and the provenance
// helpers of docs/model.md §7: meta per dotted path ('core.values', 'ties.@player', 'appetites.drink'), where a lock
// or a user edit on a path also covers everything below it. Pure: every function returns new objects.
import { APPETITE_KINDS, DRIVES, GAZES, HEXACO, JUSTIFICATIONS, MOODS, STYLES, TIE_INTENTS, VALUES } from './model';
import type {
    Agenda,
    Appetite,
    AppetiteRule,
    AppetiteSource,
    AppetiteTarget,
    CardProfiles,
    CharacterProfile,
    Core,
    FieldMeta,
    FrontConsequence,
    Goal,
    HexacoAxis,
    Intention,
    Level5,
    Lod,
    Origin,
    Reason,
    ReputationSeed,
    Scale3,
    Scale5,
    Stance,
    StanceBound,
    Style,
    Tie,
    WorldTone,
} from './model';

/** Version of the card-level profile file. */
export const PROFILES_SCHEMA = 1;

/** Caps of the lists of a profile (docs/model.md §4: ≤ 3 values, ≤ 6 signatures, ≤ 2 intentions…). */
export const LIMITS = {
    values: 3,
    drivesHigh: 4,
    drivesLow: 2,
    signatures: 6,
    tactics: 6,
    keys: 8,
    redLines: 6,
    anchors: 6,
    aliases: 12,
    justifications: 4,
    triggers: 8,
    satisfiers: 6,
    restraints: 4,
    goals: 6,
    intentions: 2,
    steps: 8,
    agendaList: 8,
    appetites: 6,
    ties: 40,
    reasons: 12,
    evaluations: 6,
    beliefs: 12,
    starts: 24,
    bounds: 8,
    evidence: 6,
    name: 80,
    short: 200,
    text: 600,
} as const;

const ORIGINS: readonly Origin[] = ['author', 'inferred', 'generated', 'story', 'user'];
const LODS: readonly Lod[] = ['sketch', 'draft', 'portrait'];
const TONES: readonly WorldTone[] = ['hostile', 'indifferent', 'neutral', 'welcoming'];
const SOURCES: readonly AppetiteSource[] = ['individual', 'species', 'culture', 'situation', 'world'];

type Dict = Record<string, unknown>;

/* ------------------------------------------------------------------ small readers */

export function isDict(value: unknown): value is Dict {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One line of text: whitespace folded, clipped with «…». Non-strings give ''. */
export function cleanText(value: unknown, max: number = LIMITS.text): string {
    if (typeof value !== 'string') return '';
    const folded = value.replace(/\s+/g, ' ').trim();
    return folded.length > max ? `${folded.slice(0, Math.max(1, max - 1)).trimEnd()}…` : folded;
}

/** Comparable key of a text: lower case, ё → е, spaces folded. */
export function textKey(value: string): string {
    return value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/** Non-empty unique texts (case- and ё-insensitive), at most `maxItems`. */
export function cleanList(value: unknown, maxItems: number, maxLength: number = LIMITS.short): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        const text = cleanText(item, maxLength);
        const key = textKey(text);
        if (!text || seen.has(key)) continue;
        seen.add(key);
        out.push(text);
        if (out.length >= maxItems) break;
    }
    return out;
}

export function oneOf<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
    return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Unique members of an enum, at most `max`. */
export function enumList<T extends string>(values: readonly T[], value: unknown, max: number): T[] {
    if (!Array.isArray(value)) return [];
    const out: T[] = [];
    for (const item of value) {
        if (typeof item !== 'string' || !(values as readonly string[]).includes(item)) continue;
        if (out.includes(item as T)) continue;
        out.push(item as T);
        if (out.length >= max) break;
    }
    return out;
}

/** A finite number rounded and clamped; `fallback` for anything else. */
export function intIn(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

export const toStance = (value: unknown, fallback: Stance = 0): Stance => intIn(value, -3, 3, fallback) as Stance;
export const toLevel5 = (value: unknown, fallback: Level5 = 0): Level5 => intIn(value, -2, 2, fallback) as Level5;
export const toScale5 = (value: unknown, fallback: Scale5 = 0): Scale5 => intIn(value, 0, 5, fallback) as Scale5;
export const toScale3 = (value: unknown, fallback: Scale3 = 0): Scale3 => intIn(value, 0, 3, fallback) as Scale3;

/** Drops keys whose value is undefined (optional fields stay absent). */
function compact<T extends object>(value: T): T {
    const out: Dict = {};
    for (const [key, item] of Object.entries(value)) if (item !== undefined) out[key] = item;
    return out as T;
}

function optionalText(value: unknown, max: number = LIMITS.text): string | undefined {
    return cleanText(value, max) || undefined;
}

/* ------------------------------------------------------------------ ids */

const TRANSLIT: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'kh',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'shch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
    і: 'i',
    ї: 'yi',
    є: 'ye',
    ґ: 'g',
};

/**
 * A stable slug for a name, unique among `taken`: Cyrillic transliterated («Ильва» → 'ilva'), other letters and
 * digits kept, the rest folded into '-', ≤ 40 chars; 'character' for an empty name; '-2', '-3'… on a clash.
 */
export function slugId(name: string, taken: Iterable<string> = []): string {
    const latin = [...name.toLowerCase()].map((char) => TRANSLIT[char] ?? char).join('');
    const base =
        latin
            .normalize('NFKD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40)
            .replace(/-+$/g, '') || 'character';
    const used = new Set(taken);
    if (!used.has(base)) return base;
    for (let n = 2; ; n++) {
        const id = `${base}-${n}`;
        if (!used.has(id)) return id;
    }
}

/* ------------------------------------------------------------------ empty objects */

export function emptyCore(): Core {
    return {
        concept: '',
        values: { top: [] },
        temperament: {},
        drives: { high: [], low: [] },
        arcLock: false,
        signatures: [],
        tactics: [],
        commitment: 'single',
        proactivity: 5,
        baselineMood: { octant: 'relaxed' },
        stanceBounds: [],
        redLines: { never: [], would: [] },
        keys: [],
        justifications: [],
        corruption: 0,
        anchors: [],
    };
}

export function emptyAgenda(): Agenda {
    return { goals: [], intentions: [], resources: [], leverage: [], secrets: [] };
}

export function emptyTie(target: string, stance: Stance = 0): Tie {
    return { target, stance, reasons: [], evaluations: [], intent: 'none', debts: [], encounters: [], beliefs: [] };
}

export interface EmptyProfileOptions {
    id?: string;
    /** Ids already used in the store (the slug avoids them). */
    taken?: Iterable<string>;
    kind?: CharacterProfile['kind'];
    lod?: Lod;
    english?: string;
    aliases?: string[];
    role?: string;
}

export function emptyProfile(name: string, options: EmptyProfileOptions = {}): CharacterProfile {
    const clean = cleanText(name, LIMITS.name);
    return compact({
        id: options.id?.trim() || slugId(clean || options.english || '', options.taken),
        name: clean,
        aliases: cleanList(options.aliases ?? [], LIMITS.aliases, LIMITS.name),
        english: optionalText(options.english, LIMITS.name),
        kind: options.kind ?? 'character',
        lod: options.lod ?? 'sketch',
        role: optionalText(options.role, LIMITS.short),
        core: emptyCore(),
        appetites: [],
        agenda: emptyAgenda(),
        ties: [],
        starts: [],
        meta: {},
    });
}

/** The profile file of a card before anything was read (world tone «indifferent», decision В8). */
export function emptyCardProfiles(card: string): CardProfiles {
    return {
        schema: PROFILES_SCHEMA,
        card,
        worldTone: 'indifferent',
        invariants: [],
        characters: [],
        rules: [],
        reputation: [],
        meta: {},
    };
}

/* ------------------------------------------------------------------ normalisers */

function normalizeMeta(value: unknown): Record<string, FieldMeta> {
    const out: Record<string, FieldMeta> = {};
    if (!isDict(value)) return out;
    for (const [path, raw] of Object.entries(value)) {
        if (!path.trim() || !isDict(raw)) continue;
        const evidence = cleanList(raw.evidence, LIMITS.evidence, LIMITS.short);
        const sources = cleanList(raw.sources, LIMITS.evidence * 2, LIMITS.name);
        out[path] = compact({
            origin: oneOf(ORIGINS, raw.origin, 'generated'),
            locked: raw.locked === true ? true : undefined,
            evidence: evidence.length ? evidence : undefined,
            sources: sources.length ? sources : undefined,
        });
    }
    return out;
}

function normalizeBound(raw: unknown): StanceBound | null {
    if (!isDict(raw)) return null;
    const target = cleanText(raw.target, LIMITS.name);
    if (!target) return null;
    const min = raw.min === undefined || raw.min === null ? undefined : toStance(raw.min);
    const max = raw.max === undefined || raw.max === null ? undefined : toStance(raw.max);
    if (min === undefined && max === undefined) return null;
    if (min !== undefined && max !== undefined && min > max) return { target, min: max, max: min };
    return compact({ target, min, max });
}

export function normalizeCore(raw: unknown): Core {
    const base = emptyCore();
    if (!isDict(raw)) return base;
    const values = isDict(raw.values) ? raw.values : {};
    const top = enumList(VALUES, values.top, LIMITS.values);
    const sacrifice = oneOf(['', ...VALUES] as const, values.sacrifice, '');
    const temperament: Partial<Record<HexacoAxis, Level5>> = {};
    if (isDict(raw.temperament)) {
        for (const axis of HEXACO) {
            const level = toLevel5(raw.temperament[axis]);
            if (level !== 0) temperament[axis] = level;
        }
    }
    const drives = isDict(raw.drives) ? raw.drives : {};
    const high = enumList(DRIVES, drives.high, LIMITS.drivesHigh);
    const low = enumList(DRIVES, drives.low, LIMITS.drivesLow).filter((drive) => !high.includes(drive));
    const wound = isDict(raw.wound) ? raw.wound : null;
    const woundGhost = wound ? cleanText(wound.ghost) : '';
    const attachment = isDict(raw.attachment) ? raw.attachment : null;
    const mood = isDict(raw.baselineMood) ? raw.baselineMood : {};
    const redLines = isDict(raw.redLines) ? raw.redLines : {};
    const dark = isDict(raw.dark) ? raw.dark : null;
    const darkFlags = dark
        ? compact({
              ruthless: dark.ruthless === true || undefined,
              schemer: dark.schemer === true || undefined,
              sadist: dark.sadist === true || undefined,
              entitled: dark.entitled === true || undefined,
          })
        : {};
    const bounds: StanceBound[] = [];
    if (Array.isArray(raw.stanceBounds)) {
        for (const item of raw.stanceBounds) {
            const bound = normalizeBound(item);
            if (bound && !bounds.some((other) => textKey(other.target) === textKey(bound.target))) bounds.push(bound);
            if (bounds.length >= LIMITS.bounds) break;
        }
    }
    return compact({
        ...raw,
        concept: cleanText(raw.concept, LIMITS.short),
        values: compact({ top, sacrifice: sacrifice && !top.includes(sacrifice) ? sacrifice : undefined }),
        temperament,
        drives: { high, low },
        wound:
            wound && woundGhost
                ? {
                      ghost: woundGhost,
                      lie: cleanText(wound.lie),
                      triggers: cleanList(wound.triggers, LIMITS.triggers),
                      coping: oneOf(['surrender', 'avoid', 'overcompensate'] as const, wound.coping, 'avoid'),
                  }
                : undefined,
        want: optionalText(raw.want),
        need: optionalText(raw.need),
        arcLock: raw.arcLock === true,
        signatures: cleanList(raw.signatures, LIMITS.signatures, LIMITS.text),
        tactics: cleanList(raw.tactics, LIMITS.tactics),
        attachment: attachment
            ? { anxiety: toLevel5(attachment.anxiety), avoidance: toLevel5(attachment.avoidance) }
            : undefined,
        commitment: oneOf(['single', 'open'] as const, raw.commitment, 'single'),
        proactivity: intIn(raw.proactivity, 0, 10, base.proactivity),
        baselineMood: compact({
            octant: oneOf(MOODS, mood.octant, base.baselineMood.octant),
            label: optionalText(mood.label, LIMITS.name),
        }),
        stanceBounds: bounds,
        redLines: {
            never: cleanList(redLines.never, LIMITS.redLines),
            would: cleanList(redLines.would, LIMITS.redLines),
        },
        keys: cleanList(raw.keys, LIMITS.keys),
        moralWeakness: optionalText(raw.moralWeakness, LIMITS.short),
        voice: optionalText(raw.voice, LIMITS.short),
        justifications: enumList(JUSTIFICATIONS, raw.justifications, LIMITS.justifications),
        dark: Object.keys(darkFlags).length ? darkFlags : undefined,
        corruption: intIn(raw.corruption, 0, 10, 0),
        anchors: cleanList(raw.anchors, LIMITS.anchors, LIMITS.name),
    } as Core);
}

function normalizeTarget(raw: unknown): AppetiteTarget {
    if (!isDict(raw)) return { mode: 'thing' };
    if (raw.mode === 'player') return { mode: 'player' };
    const label = cleanText(raw.class, LIMITS.name);
    if (raw.mode === 'class' && label) return { mode: 'class', class: label };
    return { mode: 'thing' };
}

export function normalizeAppetite(raw: unknown, taken: Iterable<string> = []): Appetite | null {
    if (!isDict(raw)) return null;
    const kind = oneOf(APPETITE_KINDS, raw.kind, 'other');
    const label = optionalText(raw.label, LIMITS.name);
    const wanted = cleanText(raw.id, LIMITS.name);
    const used = new Set(taken);
    const id = wanted && !used.has(wanted) ? wanted : slugId(wanted || kind, used);
    const sources = enumList(SOURCES, raw.sources, SOURCES.length);
    const satisfiers = Array.isArray(raw.satisfiers)
        ? raw.satisfiers
              .map((item) => {
                  if (typeof item === 'string') return { what: cleanText(item, LIMITS.short), amount: 2 };
                  if (!isDict(item)) return null;
                  return compact({
                      what: cleanText(item.what, LIMITS.short),
                      amount: intIn(item.amount, 1, 5, 2),
                      full: item.full === true || undefined,
                  });
              })
              .filter((item): item is Appetite['satisfiers'][number] => !!item && !!item.what)
              .slice(0, LIMITS.satisfiers)
        : [];
    const restraints = cleanList(raw.restraints, LIMITS.restraints);
    return compact({
        ...raw,
        id,
        kind,
        label,
        sources: sources.length ? sources : ['individual'],
        target: normalizeTarget(raw.target),
        baseline: toScale5(raw.baseline, 2),
        liking: toLevel5(raw.liking, 1),
        triggers: cleanList(raw.triggers, LIMITS.triggers),
        satisfiers,
        drift: oneOf(['daily', 'seasonal', 'opportunity', 'none'] as const, raw.drift, 'opportunity'),
        tolerance: toScale3(raw.tolerance),
        dependence: toScale3(raw.dependence),
        sensitization: toScale3(raw.sensitization),
        endorsement: oneOf(['proud', 'torn', 'fighting'] as const, raw.endorsement, 'proud'),
        vow: oneOf(['none', 'moderate', 'abstinent'] as const, raw.vow, 'none'),
        visibility: oneOf(['open', 'hidden', 'secret'] as const, raw.visibility, 'open'),
        style: oneOf(STYLES, raw.style, 'honest'),
        affectionOnset: oneOf(['never', 'rare', 'possible', 'common'] as const, raw.affectionOnset, 'possible'),
        rule: optionalText(raw.rule, LIMITS.name),
        excuse: optionalText(raw.excuse, LIMITS.short),
        restraints: restraints.length ? restraints : undefined,
    } as Appetite);
}

function normalizeReason(raw: unknown, index: number): Reason | null {
    if (!isDict(raw)) return null;
    const text = cleanText(raw.text, LIMITS.short);
    if (!text) return null;
    const delta =
        typeof raw.delta === 'number' && Number.isFinite(raw.delta) ? Math.max(-6, Math.min(6, raw.delta)) : 0;
    return compact({
        ...raw,
        id: cleanText(raw.id, LIMITS.name) || `r${index + 1}`,
        text,
        delta,
        scenesLeft: raw.scenesLeft === null || raw.scenesLeft === undefined ? null : intIn(raw.scenesLeft, 0, 999, 0),
        stacks: intIn(raw.stacks, 1, 99, 1),
        key: raw.key === true || undefined,
    } as Reason);
}

export function normalizeTie(raw: unknown): Tie | null {
    if (!isDict(raw)) return null;
    const target = cleanText(raw.target, LIMITS.name);
    if (!target) return null;
    const reasons = Array.isArray(raw.reasons)
        ? raw.reasons
              .map((item, i) => normalizeReason(item, i))
              .filter((item): item is Reason => !!item)
              .slice(0, LIMITS.reasons)
        : [];
    const want = raw.want === undefined || raw.want === null ? undefined : toScale5(raw.want);
    const beliefs = Array.isArray(raw.beliefs)
        ? raw.beliefs
              .filter(isDict)
              .map((item) =>
                  compact({
                      ...item,
                      claim: cleanText(item.claim, LIMITS.short),
                      source: oneOf(['saw', 'heard', 'assumed'] as const, item.source, 'assumed'),
                      confidence:
                          typeof item.confidence === 'number' && Number.isFinite(item.confidence)
                              ? Math.max(0, Math.min(1, item.confidence))
                              : 0.5,
                  }),
              )
              .filter((item) => item.claim)
              .slice(0, LIMITS.beliefs)
        : [];
    return compact({
        ...raw,
        target,
        stance: toStance(raw.stance),
        reasons,
        evaluations: cleanList(raw.evaluations, LIMITS.evaluations),
        intent: oneOf(TIE_INTENTS, raw.intent, 'none'),
        debts: cleanList(raw.debts, LIMITS.evaluations),
        encounters: cleanList(raw.encounters, LIMITS.evaluations),
        beliefs: beliefs as Tie['beliefs'],
        want,
        gaze:
            raw.gaze === undefined
                ? undefined
                : GAZES.includes(raw.gaze as never)
                  ? (raw.gaze as Tie['gaze'])
                  : undefined,
        claim:
            raw.claim === undefined
                ? undefined
                : oneOf(['none', 'interest', 'claimed', 'owned'] as const, raw.claim, 'none'),
        appetite: optionalText(raw.appetite, LIMITS.name),
        behaviour: optionalText(raw.behaviour, LIMITS.short),
        base: raw.base === undefined || raw.base === null ? undefined : toStance(raw.base),
    } as Tie);
}

/** Front consequences (stage 4): stance or reputation changes applied at the doom; garbage dropped. */
export function normalizeConsequences(raw: unknown): FrontConsequence[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const out: FrontConsequence[] = [];
    for (const item of raw) {
        if (!isDict(item)) continue;
        const delta = intIn(item.delta, -3, 3, 0);
        if (delta === 0) continue;
        const text = optionalText(item.text, LIMITS.short);
        if (item.kind === 'stance') {
            const target = cleanText(item.target, LIMITS.name);
            if (!target) continue;
            out.push(compact({ kind: 'stance', who: optionalText(item.who, LIMITS.name), target, delta, text }));
        } else if (item.kind === 'reputation') {
            const among = cleanText(item.among, LIMITS.name);
            if (!among) continue;
            out.push(compact({ kind: 'reputation', among, delta, label: optionalText(item.label, LIMITS.name), text }));
        }
        if (out.length >= LIMITS.steps) break;
    }
    return out.length ? out : undefined;
}

function normalizeClock(raw: unknown, fallbackSegments: number): { segments: number; filled: number } {
    const dict = isDict(raw) ? raw : {};
    const segments = intIn(dict.segments, 2, 12, fallbackSegments);
    return { segments, filled: intIn(dict.filled, 0, segments, 0) };
}

export function normalizeAgenda(raw: unknown): Agenda {
    if (!isDict(raw)) return emptyAgenda();
    const goals: Goal[] = [];
    if (Array.isArray(raw.goals)) {
        for (const item of raw.goals) {
            if (!isDict(item)) continue;
            const text = cleanText(item.text);
            if (!text || goals.some((goal) => textKey(goal.text) === textKey(text))) continue;
            goals.push({
                id: cleanText(item.id, LIMITS.name) || `g${goals.length + 1}`,
                text,
                kind: oneOf(['external', 'internal'] as const, item.kind, 'external'),
                priority: intIn(item.priority, 1, 3, 2),
            });
            if (goals.length >= LIMITS.goals) break;
        }
    }
    const intentions: Intention[] = [];
    if (Array.isArray(raw.intentions)) {
        for (const item of raw.intentions) {
            if (!isDict(item)) continue;
            const text = cleanText(item.text);
            if (!text) continue;
            intentions.push(
                compact({
                    id: cleanText(item.id, LIMITS.name) || `i${intentions.length + 1}`,
                    goalId: optionalText(item.goalId, LIMITS.name),
                    text,
                    nextStep: cleanText(item.nextStep, LIMITS.short),
                    dropIf: cleanList(item.dropIf, 4),
                    clock: isDict(item.clock) ? normalizeClock(item.clock, 4) : undefined,
                }),
            );
            if (intentions.length >= LIMITS.intentions) break;
        }
    }
    const front = isDict(raw.front) ? raw.front : null;
    const impulse = front ? cleanText(front.impulse, LIMITS.short) : '';
    return compact({
        ...raw,
        dream: optionalText(raw.dream),
        goals,
        intentions,
        front:
            front && impulse
                ? compact({
                      impulse,
                      steps: cleanList(front.steps, LIMITS.steps),
                      doom: cleanText(front.doom, LIMITS.short),
                      clock: normalizeClock(front.clock, 6),
                      consequences: normalizeConsequences(front.consequences),
                      done: front.done === true ? true : undefined,
                  })
                : undefined,
        resources: cleanList(raw.resources, LIMITS.agendaList),
        leverage: cleanList(raw.leverage, LIMITS.agendaList),
        secrets: cleanList(raw.secrets, LIMITS.agendaList, LIMITS.text),
        ifIgnored: optionalText(raw.ifIgnored),
    } as Agenda);
}

function normalizeStarts(value: unknown): CharacterProfile['starts'] {
    if (!Array.isArray(value)) return [];
    const out: CharacterProfile['starts'] = [];
    for (const item of value) {
        if (!isDict(item)) continue;
        const greeting = intIn(item.greeting, -1, 999, -1);
        if (out.some((start) => start.greeting === greeting)) continue;
        out.push(
            compact({
                greeting,
                present: item.present !== false,
                doing: optionalText(item.doing, LIMITS.short),
                goal: optionalText(item.goal, LIMITS.short),
            }),
        );
        if (out.length >= LIMITS.starts) break;
    }
    return out;
}

/**
 * Any stored or hand-made profile → a valid one: missing lists and fields filled, scales clamped, enums checked,
 * lists deduplicated and capped, ties unique per target, appetite ids unique. Unknown extra keys are kept (other
 * modules may add fields).
 */
export function normalizeProfile(raw: unknown, options: { taken?: Iterable<string> } = {}): CharacterProfile {
    const dict = isDict(raw) ? raw : {};
    const english = optionalText(dict.english, LIMITS.name);
    const name = cleanText(dict.name, LIMITS.name) || english || cleanText(dict.id, LIMITS.name) || 'Unnamed';
    const appetites: Appetite[] = [];
    if (Array.isArray(dict.appetites)) {
        for (const item of dict.appetites) {
            const appetite = normalizeAppetite(
                item,
                appetites.map((other) => other.id),
            );
            if (appetite) appetites.push(appetite);
            if (appetites.length >= LIMITS.appetites) break;
        }
    }
    const ties: Tie[] = [];
    if (Array.isArray(dict.ties)) {
        for (const item of dict.ties) {
            const tie = normalizeTie(item);
            if (!tie || ties.some((other) => other.target === tie.target)) continue;
            ties.push(tie);
            if (ties.length >= LIMITS.ties) break;
        }
    }
    const aliases = cleanList(dict.aliases, LIMITS.aliases, LIMITS.name).filter(
        (alias) => textKey(alias) !== textKey(name),
    );
    return compact({
        ...dict,
        id: cleanText(dict.id, LIMITS.name) || slugId(english || name, options.taken),
        name,
        aliases,
        english,
        kind: oneOf(['character', 'group'] as const, dict.kind, 'character'),
        lod: oneOf(LODS, dict.lod, 'sketch'),
        role: optionalText(dict.role, LIMITS.short),
        species: optionalText(dict.species, LIMITS.name),
        gender: dict.gender === 'female' || dict.gender === 'male' ? dict.gender : undefined,
        core: normalizeCore(dict.core),
        appetites,
        agenda: normalizeAgenda(dict.agenda),
        ties,
        starts: normalizeStarts(dict.starts),
        meta: normalizeMeta(dict.meta),
        minor: dict.minor === true || undefined,
    } as CharacterProfile);
}

/** Shares normalised to sum 1; all zero (or garbage) → 20 % none, 25 % low, 25 % mid, 30 % high (§4.5). */
export function normalizeIntensity(raw: unknown): AppetiteRule['intensity'] {
    const dict = isDict(raw) ? raw : {};
    const read = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
    const shares = { zero: read(dict.zero), low: read(dict.low), mid: read(dict.mid), high: read(dict.high) };
    const sum = shares.zero + shares.low + shares.mid + shares.high;
    if (sum <= 0) return { zero: 0.2, low: 0.25, mid: 0.25, high: 0.3 };
    const round = (value: number) => Math.round((value / sum) * 1000) / 1000;
    return { zero: round(shares.zero), low: round(shares.low), mid: round(shares.mid), high: round(shares.high) };
}

export function normalizeRule(raw: unknown, taken: Iterable<string> = []): AppetiteRule | null {
    if (!isDict(raw)) return null;
    const holders = cleanText(raw.holders, LIMITS.name);
    if (!holders) return null;
    const kind = oneOf(APPETITE_KINDS, raw.kind, 'other');
    const used = new Set(taken);
    const wanted = cleanText(raw.id, LIMITS.name);
    const target = normalizeTarget(raw.target);
    const styles: Partial<Record<Style, number>> = {};
    if (isDict(raw.styles)) {
        for (const style of STYLES) {
            const weight = raw.styles[style];
            if (typeof weight === 'number' && Number.isFinite(weight) && weight > 0) styles[style] = weight;
        }
    }
    const evidence = cleanList(raw.evidence, LIMITS.evidence, LIMITS.short);
    return compact({
        ...raw,
        id: wanted && !used.has(wanted) ? wanted : slugId(wanted || `${holders} ${kind}`, used),
        holders,
        kind,
        label: optionalText(raw.label, LIMITS.name),
        source: oneOf(['species', 'culture', 'situation', 'world'] as const, raw.source, 'species'),
        target,
        intensity: normalizeIntensity(raw.intensity),
        styles,
        choosiness: intIn(raw.choosiness, 0, 5, 2),
        exclusivity: oneOf(['exclusive', 'shared', 'harem'] as const, raw.exclusivity, 'exclusive'),
        affectionOnset: oneOf(['never', 'rare', 'possible', 'common'] as const, raw.affectionOnset, 'possible'),
        groupMode: oneOf(['solitary', 'pack', 'tribe'] as const, raw.groupMode, 'solitary'),
        evidence: evidence.length ? evidence : undefined,
    } as AppetiteRule);
}

export function normalizeSeed(raw: unknown): ReputationSeed | null {
    if (!isDict(raw)) return null;
    const label = cleanText(raw.label, LIMITS.short);
    if (!label) return null;
    const evidence = cleanList(raw.evidence, LIMITS.evidence, LIMITS.short);
    return compact({
        among: cleanText(raw.among, LIMITS.name) || '*',
        label,
        stance: toStance(raw.stance),
        greeting: intIn(raw.greeting, -1, 999, -1),
        evidence: evidence.length ? evidence : undefined,
    });
}

/** A whole card file: every character normalised with unique ids, rules and seeds checked. */
export function normalizeCardProfiles(raw: unknown, card: string): CardProfiles {
    const dict = isDict(raw) ? raw : {};
    const base = emptyCardProfiles(cleanText(dict.card, 400) || card);
    const characters: CharacterProfile[] = [];
    if (Array.isArray(dict.characters)) {
        for (const item of dict.characters) {
            const taken = characters.map((other) => other.id);
            const profile = normalizeProfile(item, { taken });
            characters.push(taken.includes(profile.id) ? { ...profile, id: slugId(profile.id, taken) } : profile);
        }
    }
    const rules: AppetiteRule[] = [];
    if (Array.isArray(dict.rules)) {
        for (const item of dict.rules) {
            const rule = normalizeRule(
                item,
                rules.map((other) => other.id),
            );
            if (rule) rules.push(rule);
        }
    }
    const reputation = Array.isArray(dict.reputation)
        ? dict.reputation.map(normalizeSeed).filter((item): item is ReputationSeed => !!item)
        : [];
    const intent = isDict(dict.intent) ? dict.intent : null;
    return compact({
        ...dict,
        schema: PROFILES_SCHEMA,
        card: base.card,
        worldTone: oneOf(TONES, dict.worldTone, base.worldTone),
        invariants: cleanList(dict.invariants, 24, LIMITS.text),
        characters,
        rules,
        reputation,
        intent:
            intent && typeof intent.sourcesHash === 'string'
                ? compact({
                      at: intIn(intent.at, 0, Number.MAX_SAFE_INTEGER, 0),
                      sourcesHash: intent.sourcesHash,
                      model: optionalText(intent.model, LIMITS.name),
                      fromCard: intent.fromCard === undefined ? undefined : intIn(intent.fromCard, 1, 99, 1),
                  })
                : undefined,
        meta: normalizeMeta(dict.meta),
    } as CardProfiles);
}

/* ------------------------------------------------------------------ provenance (meta paths) */

interface MetaHolder {
    meta: Record<string, FieldMeta>;
}

/** The path and every ancestor, nearest first: 'ties.@player.stance' → [itself, 'ties.@player', 'ties']. */
export function pathChain(path: string): string[] {
    const parts = path.split('.').filter(Boolean);
    const out: string[] = [];
    for (let i = parts.length; i > 0; i--) out.push(parts.slice(0, i).join('.'));
    return out;
}

/** Meta of a path, or of its nearest ancestor that has one. */
export function metaAt(holder: MetaHolder, path: string): FieldMeta | undefined {
    for (const candidate of pathChain(path)) {
        const meta = holder.meta[candidate];
        if (meta) return meta;
    }
    return undefined;
}

/** A copy with meta of `path` replaced (null removes it). */
export function setMeta<T extends MetaHolder>(holder: T, path: string, meta: FieldMeta | null): T {
    const next = { ...holder.meta };
    if (meta) next[path] = meta;
    else delete next[path];
    return { ...holder, meta: next };
}

/** Locked on the path itself or on any ancestor (🔒 on 'core' locks 'core.values'). */
export function isLocked(holder: MetaHolder, path: string): boolean {
    return pathChain(path).some((candidate) => holder.meta[candidate]?.locked === true);
}

/** The user edited the path or an ancestor: his edit outweighs any author quote (§7). */
export function isUserEdited(holder: MetaHolder, path: string): boolean {
    return pathChain(path).some((candidate) => holder.meta[candidate]?.origin === 'user');
}

/** Neither the intent reading nor the generator may overwrite it. */
export function isProtected(holder: MetaHolder, path: string): boolean {
    return isLocked(holder, path) || isUserEdited(holder, path);
}

/** The source id of fields the author wrote into the card itself (`extensions.dramatis.intent`). */
export const CARD_INTENT_SOURCE = 'card.intent';

/** The meta of a field taken from the card's structured intent: the author's, no quote needed. */
export function cardIntentMeta(): FieldMeta {
    return { origin: 'author', sources: [CARD_INTENT_SOURCE] };
}

/** This meta marks a field the author wrote into the card's structured intent. */
export function isCardMeta(meta: FieldMeta | undefined): boolean {
    return meta?.origin === 'author' && !!meta.sources?.includes(CARD_INTENT_SOURCE);
}

/**
 * The path (or its nearest ancestor with meta) holds the card's structured intent: the reading of the card's text
 * leaves it as the author wrote it — only a new structured intent, the user's edit or his lock changes it.
 */
export function isCardAuthored(holder: MetaHolder, path: string): boolean {
    return isCardMeta(metaAt(holder, path));
}

/* ------------------------------------------------------------------ path access */

function findIn(list: unknown[], key: string): number {
    return list.findIndex((item) => isDict(item) && (item.id === key || item.target === key));
}

/**
 * Value at a dotted path of a profile; arrays of objects are addressed by `id` or `target`
 * ('ties.@player.stance', 'appetites.drink.baseline'). Undefined when missing.
 */
export function getPath(root: unknown, path: string): unknown {
    let current: unknown = root;
    for (const part of path.split('.').filter(Boolean)) {
        if (Array.isArray(current)) {
            const at = findIn(current, part);
            current = at >= 0 ? current[at] : undefined;
        } else if (isDict(current)) {
            current = current[part];
        } else {
            return undefined;
        }
    }
    return current;
}

/**
 * A copy with the value at a dotted path replaced. Missing objects on the way are created; a missing array element
 * is appended only when it is the last segment (`setPath(p, 'ties.@player', tie)`), otherwise nothing changes.
 * `undefined` removes the field (or the array element).
 */
export function setPath<T>(root: T, path: string, value: unknown): T {
    const parts = path.split('.').filter(Boolean);
    const write = (node: unknown, depth: number): unknown => {
        const part = parts[depth]!;
        const last = depth === parts.length - 1;
        if (Array.isArray(node)) {
            const at = findIn(node, part);
            if (last) {
                if (value === undefined) return at >= 0 ? node.filter((_, i) => i !== at) : node;
                return at >= 0 ? node.map((item, i) => (i === at ? value : item)) : [...node, value];
            }
            if (at < 0) return node;
            return node.map((item, i) => (i === at ? write(item, depth + 1) : item));
        }
        const dict: Dict = isDict(node) ? { ...node } : {};
        if (last) {
            if (value === undefined) delete dict[part];
            else dict[part] = value;
            return dict;
        }
        dict[part] = write(dict[part], depth + 1);
        return dict;
    };
    return parts.length ? (write(root, 0) as T) : root;
}

/** True for '', [], {}, null, undefined and objects made only of such values. */
export function isEmptyValue(value: unknown): boolean {
    if (value === undefined || value === null || value === '') return true;
    if (Array.isArray(value)) return value.length === 0;
    if (isDict(value)) return Object.values(value).every(isEmptyValue);
    return false;
}
