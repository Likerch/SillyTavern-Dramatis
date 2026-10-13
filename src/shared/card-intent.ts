// Card intent v1 (docs/card-intent.md): the author's intent written into the character card itself, at
// `character.data.extensions.dramatis.intent`, for Dramatis to take as the author's word — no guessing, no quotes.
// It says what the intent reading (src/domain/intent-prompt.ts) would otherwise infer from the card's text, field for
// field, in the shape of Dramatis' own model (src/domain/model.ts: Core, Agenda, Appetite, Tie, starts, world tone…).
//
// SELF-CONTAINED: no imports. Neighbours (Officina) copy this file verbatim to write and check intents; the
// vocabularies below are copies of model.ts (a test keeps them equal).
//
// The rules of the format:
// - JSON only; `version: 1`. Every text field is a plain string in the story's language; names as the story writes
//   them; `{{user}}` / `{{char}}` may be used and stay as written.
// - `characters` is keyed by the name as the story writes it (nominative); `aliases`, `english` and `russian` give the
//   other names. The player's character is `PLAYER` (also `{{user}}`) in ties, bounds, anchors and appetite targets.
// - Everything is optional except what an entry cannot be without (a tie's target and stance, a goal's text…). An
//   absent field, an empty string and an empty list all mean «the author does not say»: Dramatis then reads that
//   field from the card's text as before. A field given is the author's: never overwritten by that reading.
// - validateCardIntent keeps every valid part and lists the rest: an unknown field, a value outside its scale or
//   vocabulary, a missing required member, a duplicate entry — dropped; a text over its length or a list over its
//   size — cut. `ok` is true only when nothing had to be dropped or cut.
// - `complete`: the intent covers what the motive card needs (see cardIntentCoverage); Dramatis then does not read the
//   card's text with the model at all.

/** The format version this file describes. */
export const CARD_INTENT_VERSION = 1;
/** The intent lives at `character.data.extensions[CARD_INTENT_EXTENSION][CARD_INTENT_KEY]`. */
export const CARD_INTENT_EXTENSION = 'dramatis';
export const CARD_INTENT_KEY = 'intent';
/** How the intent names the player's character (ties, bounds, anchors, appetite targets). */
export const CARD_INTENT_PLAYER = 'PLAYER';
/**
 * Markers around the human-readable «Замысел» section a workshop writes into creator_notes from the same data: with a
 * structured intent present, Dramatis leaves that section out of its reading (it would count the intent twice).
 */
export const CARD_INTENT_NOTES_BEGIN = '<!-- dramatis:intent -->';
export const CARD_INTENT_NOTES_END = '<!-- /dramatis:intent -->';

/* ------------------------------------------------------------------ vocabularies (copies of model.ts) */

export const CARD_INTENT_VOCABULARY = {
    /** Schwartz basic values. */
    values: [
        'self-direction',
        'stimulation',
        'hedonism',
        'achievement',
        'power',
        'security',
        'conformity',
        'tradition',
        'benevolence',
        'universalism',
    ],
    /** HEXACO axes, each −2 … +2. */
    temperament: ['honesty', 'emotionality', 'extraversion', 'agreeableness', 'conscientiousness', 'openness'],
    /** Reiss basic desires. */
    drives: [
        'power',
        'independence',
        'curiosity',
        'acceptance',
        'order',
        'saving',
        'honor',
        'idealism',
        'social',
        'family',
        'status',
        'vengeance',
        'romance',
        'eating',
        'physical',
        'tranquility',
    ],
    /** PAD mood octants. */
    moods: ['exuberant', 'dependent', 'relaxed', 'docile', 'hostile', 'anxious', 'disdainful', 'bored'],
    coping: ['surrender', 'avoid', 'overcompensate'],
    /** Bandura's moral disengagement mechanisms. */
    justifications: [
        'moral-justification',
        'euphemism',
        'comparison',
        'displacement',
        'diffusion',
        'minimizing',
        'dehumanization',
        'blame',
    ],
    appetiteKinds: [
        'flesh',
        'plunder',
        'dominance',
        'cruelty',
        'hunger',
        'food',
        'drink',
        'substance',
        'thrill',
        'luxury',
        'adoration',
        'other',
    ],
    appetiteSources: ['individual', 'species', 'culture', 'situation', 'world'],
    appetiteTargets: ['thing', 'class', 'player'],
    drift: ['daily', 'seasonal', 'opportunity', 'none'],
    endorsement: ['proud', 'torn', 'fighting'],
    vow: ['none', 'moderate', 'abstinent'],
    visibility: ['open', 'hidden', 'secret'],
    /** Method styles. */
    styles: ['siren', 'buyer', 'insider', 'spider', 'raider', 'shadow', 'shepherd', 'duelist', 'honest'],
    affectionOnset: ['never', 'rare', 'possible', 'common'],
    tieIntents: ['none', 'recruit', 'extract', 'use', 'avenge', 'avoid', 'protect', 'seduce', 'court'],
    gazes: ['person', 'prize', 'instrument', 'property', 'prey', 'mate'],
    goalKinds: ['external', 'internal'],
    kinds: ['character', 'group'],
    genders: ['female', 'male'],
    worldTones: ['hostile', 'indifferent', 'neutral', 'welcoming'],
    ruleSources: ['species', 'culture', 'situation', 'world'],
    exclusivity: ['exclusive', 'shared', 'harem'],
    groupModes: ['solitary', 'pack', 'tribe'],
} as const;

type Vocabulary = typeof CARD_INTENT_VOCABULARY;
type Word<K extends keyof Vocabulary> = Vocabulary[K][number];

/** Sizes Dramatis keeps (src/domain/profile-defaults.ts LIMITS): longer texts and lists are cut. */
export const CARD_INTENT_LIMITS = {
    /** Names, labels, tie targets, aliases. */
    name: 80,
    /** One short line: concept, role, tactics, reasons, behaviour, steps… */
    short: 200,
    /** A sentence: want, need, wound, signatures, goals, secrets, invariants… */
    text: 600,
    characters: 60,
    aliases: 12,
    russian: 4,
    values: 3,
    drivesHigh: 4,
    drivesLow: 2,
    signatures: 6,
    tactics: 6,
    keys: 8,
    redLines: 6,
    anchors: 6,
    justifications: 4,
    triggers: 8,
    satisfiers: 6,
    restraints: 4,
    goals: 6,
    intentions: 2,
    dropIf: 4,
    steps: 8,
    agendaList: 8,
    appetites: 6,
    ties: 40,
    reasons: 6,
    changeIf: 4,
    starts: 24,
    bounds: 8,
    invariants: 24,
    reputation: 30,
    rules: 30,
} as const;

/* ------------------------------------------------------------------ the format */

/** Stance toward someone: −3 war, −2 hostile, −1 interfering, 0 neutral, +1 helpful, +2 friendly, +3 allied. */
export type CardIntentStance = -3 | -2 | -1 | 0 | 1 | 2 | 3;
/** −2 … +2. */
export type CardIntentLevel = -2 | -1 | 0 | 1 | 2;

export interface CardIntentV1 {
    version: 1;
    world?: CardIntentWorld;
    /** Keyed by the name as the story writes it. */
    characters?: Record<string, CardIntentCharacter>;
}

export interface CardIntentWorld {
    /** How the world treats the player's character by default. */
    tone?: Word<'worldTones'>;
    /** What must always hold (the author's hard facts). */
    invariants?: string[];
    /** What a group thinks the player's character is at the start. */
    reputation?: CardIntentReputation[];
    /** Group, species, custom and world appetite rules. */
    rules?: CardIntentRule[];
}

export interface CardIntentReputation {
    /** A group or a place; '*' (the default) = everyone. */
    among?: string;
    /** What they think the player is («беглый каторжник»). */
    label: string;
    /** The stance a stranger of that group starts with. */
    stance: CardIntentStance;
    /** Starting scene: 0 = first_mes, N = alternate greeting N, −1 (the default) = every start. */
    greeting?: number;
}

export interface CardIntentRule {
    /** The rule's name («монстродевы долины»). */
    name: string;
    /** Who has it: a group, a species or a free label (default: the name). */
    holders?: string;
    kind: Word<'appetiteKinds'>;
    /** Story words for the craving. */
    label?: string;
    source?: Word<'ruleSources'>;
    /** class (default): everyone who fits, the player among many; player: exactly the player's character. */
    target?: Word<'appetiteTargets'>;
    targetClass?: string;
    /** Shares of holders by strength (normalised to sum 1). */
    intensity?: { zero?: number; low?: number; mid?: number; high?: number };
    /** Method styles with weights. */
    styles?: Partial<Record<Word<'styles'>, number>>;
    /** 0–5: the least a target must be worth to be pursued. */
    choosiness?: number;
    exclusivity?: Word<'exclusivity'>;
    affectionOnset?: Word<'affectionOnset'>;
    groupMode?: Word<'groupModes'>;
}

export interface CardIntentCharacter {
    /** A group describes many people at once («стража гарнизона»). Default: character. */
    kind?: Word<'kinds'>;
    /** The name in Latin letters. */
    english?: string;
    /** The first name alone, nicknames, titles, short forms. */
    aliases?: string[];
    /** Russian forms of the name for a Russian story («Мирель Варроу», «Мирель»). */
    russian?: string[];
    gender?: Word<'genders'>;
    /** Under 18: never given or made the target of sexual appetites. */
    minor?: boolean;
    role?: string;
    species?: string;
    core?: CardIntentCore;
    agenda?: CardIntentAgenda;
    /** One per kind. */
    appetites?: CardIntentAppetite[];
    /** One per target. */
    ties?: CardIntentTie[];
    /** One per starting scene. */
    starts?: CardIntentStart[];
}

export interface CardIntentCore {
    /** One line: who they are at their core. */
    concept?: string;
    /** Top values by priority (≤ 3) and the one they would sacrifice. */
    values?: { top: Word<'values'>[]; sacrifice?: Word<'values'> };
    temperament?: Partial<Record<Word<'temperament'>, CardIntentLevel>>;
    /** Drives the author stresses (2–4) and the ones they are indifferent to (1–2). */
    drives?: { high?: Word<'drives'>[]; low?: Word<'drives'>[] };
    /** ghost = what happened, lie = the false belief it left. */
    wound?: { ghost: string; lie?: string; triggers?: string[]; coping?: Word<'coping'> };
    /** The outer goal. */
    want?: string;
    /** What they truly need. */
    need?: string;
    /** The author means them never to change. */
    arcLock?: boolean;
    /** «if <situation> → <behaviour>». */
    signatures?: string[];
    /** How they get their way. */
    tactics?: string[];
    attachment?: { anxiety?: CardIntentLevel; avoidance?: CardIntentLevel };
    /** 0–10: how often they act unprompted. */
    proactivity?: number;
    /** Where their mood returns to, and the author's own words for it. */
    baselineMood?: { octant: Word<'moods'>; label?: string };
    /** A stance floor or ceiling toward someone or a class (target PLAYER for the player's character). */
    stanceBounds?: { target: string; min?: CardIntentStance; max?: CardIntentStance }[];
    /** What they never do / would do without hesitation. */
    redLines?: { never?: string[]; would?: string[] };
    /** Events able to move them. */
    keys?: string[];
    moralWeakness?: string;
    /** One line of their speech. */
    voice?: string;
    justifications?: Word<'justifications'>[];
    dark?: { ruthless?: boolean; schemer?: boolean; sadist?: boolean; entitled?: boolean };
    /** 0–10. */
    corruption?: number;
    /** People who keep them human (PLAYER for the player's character). */
    anchors?: string[];
}

export interface CardIntentAgenda {
    dream?: string;
    /** «wants X because Y, but Z». */
    goals?: { text: string; kind?: Word<'goalKinds'>; priority?: 1 | 2 | 3 }[];
    /** At most 2 goals in work. */
    intentions?: { text: string; nextStep?: string; dropIf?: string[] }[];
    /** For factions and major NPCs: an agenda that moves the world by itself. */
    front?: { impulse: string; steps?: string[]; doom?: string; segments?: number };
    resources?: string[];
    /** What can be used against them. */
    leverage?: string[];
    /** What they hide and from whom. */
    secrets?: string[];
    ifIgnored?: string;
}

export interface CardIntentAppetite {
    kind: Word<'appetiteKinds'>;
    /** Story words («брага», «кровь живых»). */
    label?: string;
    sources?: Word<'appetiteSources'>[];
    /** thing (default), a class of people (targetClass) or the player's character. */
    target?: Word<'appetiteTargets'>;
    targetClass?: string;
    /** 0–5: how strong the craving is as a trait. */
    baseline?: number;
    triggers?: string[];
    satisfiers?: string[];
    drift?: Word<'drift'>;
    /** 0–3. */
    dependence?: number;
    endorsement?: Word<'endorsement'>;
    vow?: Word<'vow'>;
    visibility?: Word<'visibility'>;
    style?: Word<'styles'>;
    affectionOnset?: Word<'affectionOnset'>;
    /** The habitual self-justification. */
    excuse?: string;
    /** What holds them back. */
    restraints?: string[];
    /** The name of the world rule it comes from. */
    rule?: string;
}

export interface CardIntentTie {
    /** PLAYER, a character's name, or a class («чужаки»). */
    target: string;
    stance: CardIntentStance;
    /** Why, as story facts, the strongest first. */
    reasons?: string[];
    /** How the stance shows in action. */
    behaviour?: string;
    intent?: Word<'tieIntents'>;
    /** What could change the stance (becomes one of the character's keys). */
    changeIf?: string[];
    /** 0–5: appetite aimed at this target. */
    want?: number;
    gaze?: Word<'gazes'>;
    /** The appetite kind it comes from. */
    appetite?: Word<'appetiteKinds'>;
}

export interface CardIntentStart {
    /** 0 = first_mes, N = alternate greeting N, −1 = every start. */
    greeting: number;
    /** Present when the scene begins (default true). */
    present?: boolean;
    /** What their hands are busy with. */
    doing?: string;
    /** What they want in that scene. */
    goal?: string;
}

/* ------------------------------------------------------------------ the JSON Schema */

/** The subset of JSON Schema (2020-12) this file uses; validateCardIntent walks it. */
export interface CardIntentJsonSchema {
    $schema?: string;
    $id?: string;
    title?: string;
    description?: string;
    type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
    const?: string | number | boolean;
    enum?: readonly (string | number)[];
    minimum?: number;
    maximum?: number;
    maxLength?: number;
    maxItems?: number;
    maxProperties?: number;
    items?: CardIntentJsonSchema;
    properties?: Record<string, CardIntentJsonSchema>;
    required?: readonly string[];
    additionalProperties?: boolean | CardIntentJsonSchema;
    propertyNames?: CardIntentJsonSchema;
}

type S = CardIntentJsonSchema;
const L = CARD_INTENT_LIMITS;
const V = CARD_INTENT_VOCABULARY;

const text = (maxLength: number, description: string): S => ({ type: 'string', maxLength, description });
const word = (values: readonly string[], description: string): S => ({ type: 'string', enum: values, description });
const int = (minimum: number, maximum: number, description: string): S => ({
    type: 'integer',
    minimum,
    maximum,
    description,
});
const flag = (description: string): S => ({ type: 'boolean', description });
const list = (items: S, maxItems: number, description: string): S => ({ type: 'array', items, maxItems, description });
const texts = (maxItems: number, maxLength: number, description: string): S =>
    list({ type: 'string', maxLength }, maxItems, description);
const words = (values: readonly string[], maxItems: number, description: string): S =>
    list({ type: 'string', enum: values }, maxItems, description);
const object = (description: string, properties: Record<string, S>, required: readonly string[] = []): S => ({
    type: 'object',
    description,
    additionalProperties: false,
    properties,
    ...(required.length ? { required } : {}),
});

const STANCE = int(-3, 3, '−3 war, −2 hostile, −1 interfering, 0 neutral, +1 helpful, +2 friendly, +3 allied.');
const LEVEL = (description: string): S => int(-2, 2, description);
const GREETING = int(-1, 999, 'Starting scene: 0 = first_mes, N = alternate greeting N, −1 = every start.');

const CORE: S = object('Who they are (src/domain/model.ts Core).', {
    concept: text(L.short, 'One line: who they are at their core, as the author frames them.'),
    values: object(
        'Top values by priority and the one they would sacrifice.',
        {
            top: words(V.values, L.values, 'Top values by priority (Schwartz).'),
            sacrifice: word(V.values, 'The value they would give up first; not one of the top.'),
        },
        ['top'],
    ),
    temperament: object(
        'HEXACO axes −2…+2; honesty and agreeableness are separate (a polite schemer: low honesty, high agreeableness).',
        Object.fromEntries(V.temperament.map((axis) => [axis, LEVEL(axis)])),
    ),
    drives: object('Reiss drives: what they live for and what leaves them cold.', {
        high: words(V.drives, L.drivesHigh, 'The 2–4 drives the author stresses.'),
        low: words(V.drives, L.drivesLow, 'The 1–2 drives they are shown indifferent to.'),
    }),
    wound: object(
        'The wound.',
        {
            ghost: text(L.text, 'What happened.'),
            lie: text(L.text, 'The false belief it left.'),
            triggers: texts(L.triggers, L.short, 'What touches it.'),
            coping: word(V.coping, 'surrender, avoid, or overcompensate (attacks).'),
        },
        ['ghost'],
    ),
    want: text(L.text, 'The outer goal.'),
    need: text(L.text, 'What they truly need.'),
    arcLock: flag('The author means them never to change.'),
    signatures: texts(L.signatures, L.text, '«if <situation> → <behaviour>» as concrete actions.'),
    tactics: texts(L.tactics, L.short, 'How they get their way (flattery, bargaining, pressure, lies by omission…).'),
    attachment: object('Attachment, −2…+2 each.', {
        anxiety: LEVEL('Attachment anxiety.'),
        avoidance: LEVEL('Attachment avoidance.'),
    }),
    proactivity: int(0, 10, 'How often they act unprompted.'),
    baselineMood: object(
        'Where their mood returns to.',
        {
            octant: word(V.moods, 'PAD mood octant.'),
            label: text(L.name, 'The author’s own words for it («мрачная настороженность»).'),
        },
        ['octant'],
    ),
    stanceBounds: list(
        object(
            'A stance floor (min) or ceiling (max); unconditional devotion is a floor of 3.',
            {
                target: text(L.name, 'PLAYER, a name, or a class («имперцы»).'),
                min: STANCE,
                max: STANCE,
            },
            ['target'],
        ),
        L.bounds,
        'Stance limits; each gives min, max or both.',
    ),
    redLines: object('Red lines.', {
        never: texts(L.redLines, L.short, 'What they never do.'),
        would: texts(L.redLines, L.short, 'What they would do without hesitation.'),
    }),
    keys: texts(L.keys, L.short, 'Events able to move them («уважает только дела»).'),
    moralWeakness: text(L.short, 'Their moral weakness.'),
    voice: text(L.short, 'One line of their speech.'),
    justifications: words(V.justifications, L.justifications, 'Moral disengagement they habitually use.'),
    dark: object('Dark traits remove brakes.', {
        ruthless: flag('Ruthless.'),
        schemer: flag('A schemer.'),
        sadist: flag('A sadist.'),
        entitled: flag('Entitled.'),
    }),
    corruption: int(0, 10, 'Corruption they start with.'),
    anchors: texts(L.anchors, L.name, 'People who keep them human or whom they live for (PLAYER for the player).'),
});

const AGENDA: S = object('What they are after (src/domain/model.ts Agenda).', {
    dream: text(L.text, 'The dream.'),
    goals: list(
        object(
            'A goal.',
            {
                text: text(L.text, '«wants X because Y, but Z».'),
                kind: word(V.goalKinds, 'external (default) or internal.'),
                priority: int(1, 3, '1 highest … 3 (default 2).'),
            },
            ['text'],
        ),
        L.goals,
        'Goals.',
    ),
    intentions: list(
        object(
            'A goal in work.',
            {
                text: text(L.text, 'What they mean to do.'),
                nextStep: text(L.short, 'The next step.'),
                dropIf: texts(L.dropIf, L.short, 'What would make them drop it.'),
            },
            ['text'],
        ),
        L.intentions,
        'At most 2 goals in work.',
    ),
    front: object(
        'For factions and major NPCs: an agenda that moves the world by itself.',
        {
            impulse: text(L.short, 'What drives it.'),
            steps: texts(L.steps, L.short, 'The escalation ladder, in order.'),
            doom: text(L.short, 'What happens if nobody intervenes.'),
            segments: int(4, 8, 'Clock segments (default 6).'),
        },
        ['impulse'],
    ),
    resources: texts(L.agendaList, L.short, 'Resources.'),
    leverage: texts(L.agendaList, L.short, 'What can be used against them.'),
    secrets: texts(L.agendaList, L.text, 'What they hide and from whom («скрывает прошлое от PLAYER»).'),
    ifIgnored: text(L.text, 'What they do if nobody pays attention.'),
});

const APPETITE: S = object(
    'A craving that acts apart from liking (src/domain/model.ts Appetite); one per kind.',
    {
        kind: word(V.appetiteKinds, 'The kind of craving.'),
        label: text(L.name, 'Story words for it («брага», «кровь живых»).'),
        sources: words(V.appetiteSources, V.appetiteSources.length, 'Where it comes from (default individual).'),
        target: word(V.appetiteTargets, 'thing (default), class (named in targetClass) or player.'),
        targetClass: text(L.name, 'The class of people it aims at, with target class.'),
        baseline: int(0, 5, 'How strong the craving is as a trait (default 2).'),
        triggers: texts(L.triggers, L.short, 'What wakes it.'),
        satisfiers: texts(L.satisfiers, L.short, 'What satisfies it.'),
        drift: word(V.drift, 'How its pressure grows by itself (default opportunity).'),
        dependence: int(0, 3, 'Dependence (default 0).'),
        endorsement: word(V.endorsement, 'How they feel about it (default proud).'),
        vow: word(V.vow, 'A vow against it (default none).'),
        visibility: word(V.visibility, 'Who knows of it (default open).'),
        style: word(V.styles, 'How they usually get it.'),
        affectionOnset: word(V.affectionOnset, 'Whether getting it can turn into affection.'),
        excuse: text(L.short, 'The habitual self-justification.'),
        restraints: texts(L.restraints, L.short, 'What holds them back.'),
        rule: text(L.name, 'The name of the world rule (world.rules) it comes from.'),
    },
    ['kind'],
);

const TIE: S = object(
    'How the character treats someone (src/domain/model.ts Tie); one per target.',
    {
        target: text(L.name, 'PLAYER, a character’s name, or a class («чужаки», «все остальные»).'),
        stance: STANCE,
        reasons: texts(L.reasons, L.short, 'Why, as story facts, the strongest first.'),
        behaviour: text(L.short, 'How the stance shows in action.'),
        intent: word(V.tieIntents, 'What they mean to do with them (default none).'),
        changeIf: texts(L.changeIf, L.short, 'What could change the stance, or what the author says will not.'),
        want: int(0, 5, 'Appetite aimed at this target.'),
        gaze: word(V.gazes, 'How they see the target as an object of appetite.'),
        appetite: word(V.appetiteKinds, 'The appetite kind the want comes from.'),
    },
    ['target', 'stance'],
);

const START: S = object(
    'Where they are when a starting scene begins; one per greeting.',
    {
        greeting: GREETING,
        present: flag('Present when the scene begins (default true).'),
        doing: text(L.short, 'What their hands are busy with.'),
        goal: text(L.short, 'What they want in that scene.'),
    },
    ['greeting'],
);

const CHARACTER: S = object('One character or group, keyed by the name as the story writes it.', {
    kind: word(V.kinds, 'character (default) or group.'),
    english: text(L.name, 'The name in Latin letters.'),
    aliases: texts(L.aliases, L.name, 'The first name alone, nicknames, titles, short forms.'),
    russian: texts(L.russian, L.name, 'Russian forms of the name for a Russian story.'),
    gender: word(V.genders, 'For grammar.'),
    minor: flag('Under 18.'),
    role: text(L.short, 'Their role in the story.'),
    species: text(L.name, 'Species or folk, when it matters.'),
    core: CORE,
    agenda: AGENDA,
    appetites: list(APPETITE, L.appetites, 'Appetites, one per kind.'),
    ties: list(TIE, L.ties, 'Ties, one per target.'),
    starts: list(START, L.starts, 'Starting scenes, one per greeting.'),
});

const RULE: S = object(
    'A group, species, custom or world appetite rule (src/domain/model.ts AppetiteRule).',
    {
        name: text(L.name, 'The rule’s name.'),
        holders: text(L.name, 'Who has it (default: the name).'),
        kind: word(V.appetiteKinds, 'The kind of craving.'),
        label: text(L.name, 'Story words for it.'),
        source: word(V.ruleSources, 'species (default), culture, situation or world.'),
        target: word(
            V.appetiteTargets,
            'class (default): everyone who fits shares it; player: exactly the player’s character; thing.',
        ),
        targetClass: text(L.name, 'The class it aims at (default: the holders).'),
        intensity: object('Shares of holders by strength (normalised to sum 1).', {
            zero: { type: 'number', minimum: 0, description: 'None (sated, taken, busy).' },
            low: { type: 'number', minimum: 0, description: 'Low.' },
            mid: { type: 'number', minimum: 0, description: 'Middle.' },
            high: { type: 'number', minimum: 0, description: 'High.' },
        }),
        styles: object(
            'Method styles with weights.',
            Object.fromEntries(V.styles.map((style) => [style, { type: 'number', minimum: 0, description: style }])),
        ),
        choosiness: int(0, 5, 'The least a target must be worth to be pursued (default 2).'),
        exclusivity: word(V.exclusivity, 'exclusive (default), shared or harem.'),
        affectionOnset: word(V.affectionOnset, 'Whether getting it can turn into affection (default possible).'),
        groupMode: word(V.groupModes, 'solitary (default), pack or tribe.'),
    },
    ['name', 'kind'],
);

const WORLD: S = object('The card level.', {
    tone: word(V.worldTones, 'How the world treats the player’s character by default.'),
    invariants: texts(L.invariants, L.text, 'What must always hold.'),
    reputation: list(
        object(
            'What a group thinks the player’s character is at the start.',
            {
                among: text(L.name, 'A group or a place; * (default) = everyone.'),
                label: text(L.short, 'What they think the player is.'),
                stance: STANCE,
                greeting: GREETING,
            },
            ['label', 'stance'],
        ),
        L.reputation,
        'Starting reputation.',
    ),
    rules: list(RULE, L.rules, 'Appetite rules.'),
});

function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object') {
        for (const item of Object.values(value)) deepFreeze(item);
        Object.freeze(value);
    }
    return value;
}

/** The JSON Schema of card intent v1. Absent fields, empty strings and empty lists mean «the author does not say». */
export const CARD_INTENT_SCHEMA: CardIntentJsonSchema = deepFreeze({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://github.com/Likerch/SillyTavern-Dramatis/card-intent-v1.json',
    title: 'Dramatis card intent v1',
    description:
        'The author’s intent at character.data.extensions.dramatis.intent. Text in the story’s language; PLAYER is the player’s character.',
    type: 'object',
    additionalProperties: false,
    required: ['version'],
    properties: {
        version: { type: 'integer', const: CARD_INTENT_VERSION, description: 'Always 1.' },
        world: WORLD,
        characters: {
            type: 'object',
            description: 'Characters and groups keyed by the name as the story writes it (nominative).',
            maxProperties: L.characters,
            propertyNames: { type: 'string', maxLength: L.name },
            additionalProperties: CHARACTER,
        },
    },
});

/* ------------------------------------------------------------------ validation */

export type CardIntentErrorCode =
    /** Not an object, not a version Dramatis reads. */
    | 'format'
    | 'version'
    /** A value of the wrong type. */
    | 'type'
    /** A word outside its vocabulary. */
    | 'enum'
    /** A number outside its scale. */
    | 'range'
    /** A field the format does not have. */
    | 'unknown'
    /** A required member is missing: the entry is dropped. */
    | 'missing'
    /** A second entry for the same target, kind, greeting, name… */
    | 'duplicate'
    /** A text over its length (cut). */
    | 'length'
    /** A list over its size (cut). */
    | 'size'
    /** Members that do not fit together (a bound without min and max, min above max, a sacrifice among the top). */
    | 'conflict';

export interface CardIntentError {
    /** Where: `characters["Ильва"].ties[0].stance`; '' for the whole intent. */
    path: string;
    code: CardIntentErrorCode;
    /** English, for logs and developers. */
    message: string;
}

export interface CardIntentCheck {
    /** Nothing had to be dropped or cut. */
    ok: boolean;
    errors: CardIntentError[];
    /** The valid parts (texts trimmed, empty ones left out); null when nothing is usable (not an object, version). */
    intent: CardIntentV1 | null;
    /** The valid parts cover what the motive card needs: Dramatis does not read the card's text with the model. */
    complete: boolean;
    /** What `complete` still lacks, as paths («characters["Ильва"].core.drives.high»). */
    missing: string[];
}

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function show(value: unknown): string {
    const raw = typeof value === 'string' ? JSON.stringify(value) : String(JSON.stringify(value) ?? value);
    return raw.length > 60 ? `${raw.slice(0, 57)}…` : raw;
}

function child(path: string, key: string): string {
    return /^[A-Za-z_$][\w$]*$/.test(key) ? (path ? `${path}.${key}` : key) : `${path}[${JSON.stringify(key)}]`;
}

/** Walks a value along the schema: what is valid comes back (cut where too long), the rest is listed and dropped. */
function walk(value: unknown, schema: S, path: string, errors: CardIntentError[]): unknown {
    if (value === undefined || value === null) return undefined;
    const fail = (code: CardIntentErrorCode, message: string): undefined => {
        errors.push({ path, code, message });
        return undefined;
    };
    switch (schema.type) {
        case 'string': {
            if (typeof value !== 'string') return fail('type', `expected text, got ${show(value)}`);
            const trimmed = value.trim();
            if (!trimmed) return undefined;
            if (schema.enum && !schema.enum.includes(trimmed)) {
                return fail('enum', `${show(trimmed)} is not one of: ${schema.enum.join(', ')}`);
            }
            if (schema.maxLength !== undefined && trimmed.length > schema.maxLength) {
                errors.push({ path, code: 'length', message: `longer than ${schema.maxLength} characters: cut` });
                return `${trimmed.slice(0, schema.maxLength - 1).trimEnd()}…`;
            }
            return trimmed;
        }
        case 'integer':
        case 'number': {
            const whole = schema.type === 'integer';
            if (typeof value !== 'number' || !Number.isFinite(value) || (whole && !Number.isInteger(value))) {
                return fail('type', `expected ${whole ? 'a whole number' : 'a number'}, got ${show(value)}`);
            }
            if (schema.const !== undefined && value !== schema.const) return fail('range', `must be ${schema.const}`);
            if (schema.minimum !== undefined && value < schema.minimum) {
                return fail('range', `${value} is below the minimum ${schema.minimum}`);
            }
            if (schema.maximum !== undefined && value > schema.maximum) {
                return fail('range', `${value} is above the maximum ${schema.maximum}`);
            }
            return value;
        }
        case 'boolean':
            return typeof value === 'boolean' ? value : fail('type', `expected true or false, got ${show(value)}`);
        case 'array': {
            if (!Array.isArray(value)) return fail('type', `expected a list, got ${show(value)}`);
            const out: unknown[] = [];
            value.forEach((item, index) => {
                const kept = schema.items ? walk(item, schema.items, `${path}[${index}]`, errors) : item;
                if (kept !== undefined) out.push(kept);
            });
            if (schema.maxItems !== undefined && out.length > schema.maxItems) {
                errors.push({ path, code: 'size', message: `more than ${schema.maxItems} items: the rest dropped` });
                out.length = schema.maxItems;
            }
            return out.length ? out : undefined;
        }
        case 'object': {
            if (!isDict(value)) return fail('type', `expected an object, got ${show(value)}`);
            const out: Dict = {};
            let count = 0;
            for (const [key, item] of Object.entries(value)) {
                const at = child(path, key);
                const known = schema.properties?.[key];
                if (known) {
                    const kept = walk(item, known, at, errors);
                    if (kept !== undefined) out[key] = kept;
                    continue;
                }
                const extra = schema.additionalProperties;
                if (!extra || extra === true) {
                    if (extra !== true)
                        errors.push({ path: at, code: 'unknown', message: 'not a field of the format' });
                    continue;
                }
                const name = key.trim();
                if (!name) {
                    errors.push({ path: at, code: 'missing', message: 'an empty name' });
                    continue;
                }
                if (schema.propertyNames?.maxLength !== undefined && name.length > schema.propertyNames.maxLength) {
                    errors.push({
                        path: at,
                        code: 'length',
                        message: `a name longer than ${schema.propertyNames.maxLength} characters`,
                    });
                    continue;
                }
                if (schema.maxProperties !== undefined && count >= schema.maxProperties) {
                    errors.push({ path: at, code: 'size', message: `more than ${schema.maxProperties} entries` });
                    continue;
                }
                if (name in out) {
                    errors.push({ path: at, code: 'duplicate', message: 'the same name twice' });
                    continue;
                }
                const kept = walk(item, extra, child(path, name), errors);
                if (kept !== undefined) {
                    out[name] = kept;
                    count++;
                }
            }
            for (const key of schema.required ?? []) {
                if (!(key in out)) return fail('missing', `"${key}" is missing: left out`);
            }
            return Object.keys(out).length ? out : undefined;
        }
        default:
            return value;
    }
}

const fold = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/** Keeps the first entry of each key; later ones are listed as duplicates. */
function unique<T>(items: T[] | undefined, key: (item: T) => string, path: string, errors: CardIntentError[]): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    (items ?? []).forEach((item, index) => {
        const id = key(item);
        if (seen.has(id)) {
            errors.push({ path: `${path}[${index}]`, code: 'duplicate', message: 'a second entry for the same one' });
            return;
        }
        seen.add(id);
        out.push(item);
    });
    return out;
}

/** Sets or deletes (an empty list or object goes). */
function put(holder: Dict, key: string, value: unknown): void {
    const empty =
        value === undefined || (Array.isArray(value) && !value.length) || (isDict(value) && !Object.keys(value).length);
    if (empty) delete holder[key];
    else holder[key] = value;
}

/** What the schema cannot say: one entry per target, kind, greeting and name; members that must fit together. */
function refine(intent: CardIntentV1, errors: CardIntentError[]): CardIntentV1 {
    const world = intent.world;
    if (world) {
        put(
            world as Dict,
            'reputation',
            unique(
                world.reputation,
                (seed) => `${seed.greeting ?? -1}\u0000${fold(seed.among ?? '*')}`,
                'world.reputation',
                errors,
            ),
        );
        put(
            world as Dict,
            'rules',
            unique(world.rules, (rule) => fold(rule.name), 'world.rules', errors),
        );
        if (!Object.keys(world).length) delete intent.world;
    }
    const names = new Map<string, string>();
    for (const [name, character] of Object.entries(intent.characters ?? {})) {
        const at = child('characters', name);
        // The same person twice under two names: a name or alias of one entry is a name or alias of another.
        const own = [name, character.english ?? '', ...(character.aliases ?? []), ...(character.russian ?? [])]
            .map(fold)
            .filter(Boolean);
        const clash = own.find((key) => names.has(key) && names.get(key) !== name);
        if (clash) {
            errors.push({ path: at, code: 'duplicate', message: `the same person as "${names.get(clash)}"` });
            delete intent.characters![name];
            continue;
        }
        for (const key of own) names.set(key, name);
        const core = character.core;
        if (core?.values?.sacrifice && core.values.top.includes(core.values.sacrifice)) {
            errors.push({ path: `${at}.core.values.sacrifice`, code: 'conflict', message: 'one of the top values' });
            delete core.values.sacrifice;
        }
        if (core?.drives?.high && core.drives.low) {
            const high = core.drives.high;
            const low = core.drives.low.filter((drive) => !high.includes(drive));
            if (low.length !== core.drives.low.length) {
                errors.push({ path: `${at}.core.drives.low`, code: 'conflict', message: 'a drive both high and low' });
                put(core.drives as Dict, 'low', low);
            }
        }
        if (core?.stanceBounds) {
            const bounds = core.stanceBounds.filter((bound, index) => {
                const where = `${at}.core.stanceBounds[${index}]`;
                if (bound.min === undefined && bound.max === undefined) {
                    errors.push({ path: where, code: 'conflict', message: 'neither min nor max' });
                    return false;
                }
                if (bound.min !== undefined && bound.max !== undefined && bound.min > bound.max) {
                    errors.push({ path: where, code: 'conflict', message: 'min above max' });
                    return false;
                }
                return true;
            });
            put(
                core as Dict,
                'stanceBounds',
                unique(bounds, (bound) => fold(bound.target), `${at}.core.stanceBounds`, errors),
            );
        }
        for (const [index, appetite] of (character.appetites ?? []).entries()) {
            if (appetite.target === 'class' && !appetite.targetClass) {
                errors.push({
                    path: `${at}.appetites[${index}].targetClass`,
                    code: 'missing',
                    message: 'target class names no class: aimed at things',
                });
                delete appetite.target;
            }
        }
        put(
            character as Dict,
            'appetites',
            unique(character.appetites, (item) => item.kind, `${at}.appetites`, errors),
        );
        put(
            character as Dict,
            'ties',
            unique(character.ties, (tie) => fold(tie.target), `${at}.ties`, errors),
        );
        put(
            character as Dict,
            'starts',
            unique(character.starts, (start) => String(start.greeting), `${at}.starts`, errors),
        );
    }
    if (intent.characters && !Object.keys(intent.characters).length) delete intent.characters;
    return intent;
}

/** A tie target, bound or anchor that names the player's character in the intent. */
export function isCardIntentPlayer(target: string): boolean {
    const key = target.trim().toLowerCase();
    return key === CARD_INTENT_PLAYER.toLowerCase() || key === '{{user}}';
}

/**
 * What the motive card needs from the author for Dramatis to skip reading the card's text with the model: the world's
 * tone, at least one character, and for each character the concept, top values, high drives, the want or a goal and
 * the stance toward PLAYER (a group: the concept and the stance toward PLAYER).
 */
export function cardIntentCoverage(intent: CardIntentV1): { complete: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!intent.world?.tone) missing.push('world.tone');
    const characters = Object.entries(intent.characters ?? {});
    if (!characters.length) missing.push('characters');
    for (const [name, character] of characters) {
        const at = child('characters', name);
        const core = character.core ?? {};
        if (!core.concept) missing.push(`${at}.core.concept`);
        if (!character.ties?.some((tie) => isCardIntentPlayer(tie.target))) missing.push(`${at}.ties[PLAYER]`);
        if (character.kind === 'group') continue;
        if (!core.values?.top.length) missing.push(`${at}.core.values.top`);
        if (!core.drives?.high?.length) missing.push(`${at}.core.drives.high`);
        if (!core.want && !character.agenda?.goals?.length) missing.push(`${at}.core.want|agenda.goals`);
    }
    return { complete: missing.length === 0, missing };
}

/**
 * Checks a card intent (pure). Every valid part is kept, the rest listed in `errors` (see the file header); `intent`
 * is null only when nothing is usable: not an object, or not version 1.
 */
export function validateCardIntent(value: unknown): CardIntentCheck {
    const errors: CardIntentError[] = [];
    const none = (error: CardIntentError): CardIntentCheck => ({
        ok: false,
        errors: [error],
        intent: null,
        complete: false,
        missing: [],
    });
    if (!isDict(value)) return none({ path: '', code: 'format', message: 'the intent must be a JSON object' });
    if (value.version !== CARD_INTENT_VERSION) {
        return none({
            path: 'version',
            code: 'version',
            message: `version ${CARD_INTENT_VERSION} is read; got ${show(value.version)}`,
        });
    }
    const walked = walk(value, CARD_INTENT_SCHEMA, '', errors) as CardIntentV1 | undefined;
    const intent = refine(walked ?? { version: CARD_INTENT_VERSION }, errors);
    return { ok: errors.length === 0, errors, intent, ...cardIntentCoverage(intent) };
}
