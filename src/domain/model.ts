// The personality model of Dramatis (docs/model.md §4–§5). Pure data types and small constants only:
// every rule lives in its own domain file, every store and service elsewhere.
//
// Two levels of data:
// - CharacterProfile — who the character is (card level, file per card): core, appetites, base agenda, base ties.
// - CharacterState  — what the story did to them (chat level, file per chat): current stances with reasons,
//   mood, scene state, appetite pressure, intentions progress, stress, corruption.
// Numbers live here; the model only ever sees words (docs/model.md П6).

/* ------------------------------------------------------------------ ids and provenance */

/** Target id of the player's character in ties, beliefs and appetites. */
export const PLAYER_ID = '@player';

/** Where a value came from: the card/lore, the generator, the story (turn/scene passes) or the user's own edit. */
export type Origin = 'author' | 'generated' | 'story' | 'user';

/**
 * Provenance of one field (key = dotted path inside the profile: 'core.values', 'appetites.drink.baseline',
 * 'ties.@player.stance'). Fields without an entry count as 'generated' and unlocked.
 */
export interface FieldMeta {
    origin: Origin;
    /** Locked fields are never changed by the generator or by story passes (🔒). User edits lock by default. */
    locked?: boolean;
    /** Short quotes from the sources that support the value (author intent, docs/model.md §7). */
    evidence?: string[];
    /** Stable ids of the sources the evidence was quoted from ('card.description', 'greeting:1', 'book#12'). */
    sources?: string[];
}

/* ------------------------------------------------------------------ scales */

/** Stance toward someone: Blades in the Dark ladder −3 (war) … +3 (ally). */
export type Stance = -3 | -2 | -1 | 0 | 1 | 2 | 3;
export const STANCES: readonly Stance[] = [-3, -2, -1, 0, 1, 2, 3];

/** −2 … +2 (temperament axes, attachment, liking). */
export type Level5 = -2 | -1 | 0 | 1 | 2;

/** 0 … 5 (appetite baseline and pressure, desirability). */
export type Scale5 = 0 | 1 | 2 | 3 | 4 | 5;

/** 0 … 3 (tolerance, dependence, sensitization). */
export type Scale3 = 0 | 1 | 2 | 3;

/* ------------------------------------------------------------------ core vocabularies */

/** Schwartz basic values. */
export const VALUES = [
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
] as const;
export type Value = (typeof VALUES)[number];

/** HEXACO axes. */
export const HEXACO = [
    'honesty',
    'emotionality',
    'extraversion',
    'agreeableness',
    'conscientiousness',
    'openness',
] as const;
export type HexacoAxis = (typeof HEXACO)[number];

/** Reiss basic desires (drives). */
export const DRIVES = [
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
] as const;
export type Drive = (typeof DRIVES)[number];

/** PAD mood octants (ALMA). */
export const MOODS = [
    'exuberant',
    'dependent',
    'relaxed',
    'docile',
    'hostile',
    'anxious',
    'disdainful',
    'bored',
] as const;
export type MoodOctant = (typeof MOODS)[number];

export interface Mood {
    octant: MoodOctant;
    /** The author's own words for it («мрачная настороженность»), shown instead of the octant name. */
    label?: string;
}

export type Coping = 'surrender' | 'avoid' | 'overcompensate';
export type Commitment = 'single' | 'open';
export type ArcStage = 'intact' | 'cracking' | 'glimpsed' | 'embraced' | 'rejected';

/** Bandura's moral disengagement mechanisms a character habitually uses. */
export const JUSTIFICATIONS = [
    'moral-justification',
    'euphemism',
    'comparison',
    'displacement',
    'diffusion',
    'minimizing',
    'dehumanization',
    'blame',
] as const;
export type Justification = (typeof JUSTIFICATIONS)[number];

/* ------------------------------------------------------------------ core layer */

export interface StanceBound {
    /** A character id, PLAYER_ID, or a free class label («imperials», «чужаки»). */
    target: string;
    min?: Stance;
    max?: Stance;
}

export interface Wound {
    /** What happened (the ghost). */
    ghost: string;
    /** The false belief it left (the lie). */
    lie: string;
    /** What touches it. */
    triggers: string[];
    coping: Coping;
}

export interface Core {
    /** One-line concept. */
    concept: string;
    /** Top values by priority (≤ 3) and the one they would sacrifice. */
    values: { top: Value[]; sacrifice?: Value };
    /** Only non-zero axes are stored; the prompt shows only ±2. */
    temperament: Partial<Record<HexacoAxis, Level5>>;
    drives: { high: Drive[]; low: Drive[] };
    wound?: Wound;
    want?: string;
    need?: string;
    /** The author meant this character not to change (villains). */
    arcLock: boolean;
    /** «if <situation> → <behaviour>» lines, 0–6. */
    signatures: string[];
    /** How they pursue what they want (flattery, pressure, lies by omission…). */
    tactics: string[];
    attachment?: { anxiety: Level5; avoidance: Level5 };
    commitment: Commitment;
    /** 0–10: how often they act unprompted. */
    proactivity: number;
    baselineMood: Mood;
    stanceBounds: StanceBound[];
    redLines: { never: string[]; would: string[] };
    /** Events able to move this character (stance up, arc). */
    keys: string[];
    moralWeakness?: string;
    /** One line of speech in the character's voice (as written in the story's language). */
    voice?: string;
    justifications: Justification[];
    /** Dark traits remove brakes (docs/model.md §5.7). */
    dark?: { ruthless?: boolean; schemer?: boolean; sadist?: boolean; entitled?: boolean };
    /** Corruption the character starts with (0–10). */
    corruption: number;
    /** People who keep them human (touchstones), by character id or name. */
    anchors: string[];
}

/* ------------------------------------------------------------------ appetites (§4.5) */

export const APPETITE_KINDS = [
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
] as const;
export type AppetiteKind = (typeof APPETITE_KINDS)[number];

export type AppetiteSource = 'individual' | 'species' | 'culture' | 'situation' | 'world';

/** What the appetite is aimed at: things (any ale), a class of people, or the player specifically. */
export type AppetiteTarget = { mode: 'thing' } | { mode: 'class'; class: string } | { mode: 'player' };

/** Method styles (V5 predator types, docs/model.md §5.7). */
export const STYLES = [
    'siren',
    'buyer',
    'insider',
    'spider',
    'raider',
    'shadow',
    'shepherd',
    'duelist',
    'honest',
] as const;
export type Style = (typeof STYLES)[number];

export type AffectionOnset = 'never' | 'rare' | 'possible' | 'common';

export interface Satisfier {
    what: string;
    /** How much pressure one satisfaction removes before tolerance (1–5). */
    amount: number;
    /** Only this kind of act brings pressure to 0 (special hunger: the "worst" act). */
    full?: boolean;
}

export interface Appetite {
    /** Stable id within the character ('drink', 'flesh-1'). */
    id: string;
    kind: AppetiteKind;
    /** Story words for it («брага», «кровь», «пленники»). */
    label?: string;
    sources: AppetiteSource[];
    target: AppetiteTarget;
    baseline: Scale5;
    liking: Level5;
    triggers: string[];
    satisfiers: Satisfier[];
    /** How pressure grows by itself. */
    drift: 'daily' | 'seasonal' | 'opportunity' | 'none';
    tolerance: Scale3;
    dependence: Scale3;
    sensitization: Scale3;
    endorsement: 'proud' | 'torn' | 'fighting';
    vow: 'none' | 'moderate' | 'abstinent';
    visibility: 'open' | 'hidden' | 'secret';
    style: Style;
    affectionOnset: AffectionOnset;
    /** Id of the group rule this appetite was drawn from, if any. */
    rule?: string;
    /** The habitual self-justification, story words («кто бросает добро без присмотра, тот его отдал»). */
    excuse?: string;
    /** What holds them back as the author wrote it (story words); live brakes are computed by the engine. */
    restraints?: string[];
}

/** A group / species / world appetite rule («every monster girl sees the hero as a mate», §4.5). */
export interface AppetiteRule {
    id: string;
    /** Who has it: a group id, a species or a free label. */
    holders: string;
    kind: AppetiteKind;
    label?: string;
    source: Exclude<AppetiteSource, 'individual'>;
    /** class: shared by everyone who fits (incl. NPCs); player: only when the scenario names the player. */
    target: Exclude<AppetiteTarget, { mode: 'thing' }> | { mode: 'thing' };
    /** Shares of holders by strength; must sum to ~1. «zero» = sated, taken, busy, not interested now. */
    intensity: { zero: number; low: number; mid: number; high: number };
    styles: Partial<Record<Style, number>>;
    /** 0–5: minimum target value that triggers pursuit; falls when targets are scarce. */
    choosiness: number;
    exclusivity: 'exclusive' | 'shared' | 'harem';
    affectionOnset: AffectionOnset;
    groupMode: 'solitary' | 'pack' | 'tribe';
    evidence?: string[];
}

/** How A sees B as an object of appetite (Nussbaum, §4.5). */
export const GAZES = ['person', 'prize', 'instrument', 'property', 'prey', 'mate'] as const;
export type Gaze = (typeof GAZES)[number];

export type Claim = 'none' | 'interest' | 'claimed' | 'owned';

/* ------------------------------------------------------------------ agenda (§4.2) */

export interface Clock {
    segments: number;
    filled: number;
}

export interface Goal {
    id: string;
    /** GMC sentence: wants X because Y, but Z. */
    text: string;
    kind: 'external' | 'internal';
    /** 1 (highest) … 3. */
    priority: number;
}

export interface Intention {
    id: string;
    goalId?: string;
    text: string;
    nextStep: string;
    dropIf: string[];
    clock?: Clock;
}

/** A front (Apocalypse World): an agenda that moves the world by itself (§11). */
export interface Front {
    impulse: string;
    /** Escalation ladder, in order. */
    steps: string[];
    /** What happens if nobody intervenes. */
    doom: string;
    clock: Clock;
}

export interface Agenda {
    dream?: string;
    goals: Goal[];
    intentions: Intention[];
    front?: Front;
    resources: string[];
    leverage: string[];
    secrets: string[];
    ifIgnored?: string;
}

/* ------------------------------------------------------------------ ties (§4.3) */

export const TIE_INTENTS = ['none', 'recruit', 'extract', 'use', 'avenge', 'avoid', 'protect', 'seduce', 'court'] as const;
export type TieIntent = (typeof TIE_INTENTS)[number];

export interface Reason {
    id: string;
    /** Story words: «ты сорвал ей поставку». */
    text: string;
    /** Stance contribution (may be fractional before rounding). */
    delta: number;
    /** Scenes left before it fades; null = permanent (a scar, a debt). */
    scenesLeft: number | null;
    /** Times the same reason repeated (diminishing returns ×0.9). */
    stacks: number;
    /** Message index it came from (story reasons). */
    sourceMessage?: number;
    /** A key event (matches the character's keys) — allows a step up. */
    key?: boolean;
    /** Scene counter when it was added. */
    scene?: number;
}

export interface Belief {
    claim: string;
    source: 'saw' | 'heard' | 'assumed';
    /** Who it was heard from (character id). */
    from?: string;
    /** 0–1. */
    confidence: number;
    /** True when the claim is false in the story (rumours). */
    false?: boolean;
}

export interface Tie {
    /** Character id, PLAYER_ID, or a group id. */
    target: string;
    stance: Stance;
    /** Inner axes −100…100 (optional detail). */
    axes?: { affection: number; trust: number; respect: number; fear: number };
    reasons: Reason[];
    /** «кто он мне» with a reason: «плохой союзник — сбежал у моста». */
    evaluations: string[];
    intent: TieIntent;
    debts: string[];
    encounters: string[];
    beliefs: Belief[];
    /** Appetite toward this target (§4.5); absent when none. */
    want?: Scale5;
    gaze?: Gaze;
    claim?: Claim;
    appetite?: string;
    /** Method escalation toward this target (§5.7): lowest step of the next attempt and refusals/failures so far. */
    escalation?: { step: number; failures: number };
    /** How the stance shows in action toward this target, a behavioural anchor («takes his coin, gives nothing back»). */
    behaviour?: string;
    /** Stance this tie relaxes back to (§5.2.6); absent = the profile's base tie, else 0. */
    base?: Stance;
    /** Net stance movement in one scene (inertia cap, §5.2.1); dropped at scene end. */
    moved?: { scene: number; delta: number };
    /** Agreeing events still waiting to add up to a step (§5.2.2–3); one direction at a time. */
    progress?: StanceProgress;
}

/** One reason counted toward the next stance step. */
export interface StanceProgressItem {
    /** Reason id on the tie. */
    reason: string;
    scene: number;
    /** Effective (already diminished) contribution, signed. */
    delta: number;
    key?: boolean;
}

export interface StanceProgress {
    dir: 1 | -1;
    items: StanceProgressItem[];
}

/* ------------------------------------------------------------------ the profile */

/** Level of detail (§10.2). */
export type Lod = 'sketch' | 'draft' | 'portrait';

export interface CharacterProfile {
    /** Stable slug within its store. */
    id: string;
    /** As the story writes it (Russian story → Russian, nominative). */
    name: string;
    aliases: string[];
    english?: string;
    /** A group profile describes many people at once («стража гарнизона»). */
    kind: 'character' | 'group';
    lod: Lod;
    role?: string;
    /** Species / folk, when it matters (lamia, goblin). */
    species?: string;
    /** Grammatical gender for Russian labels and English pronouns in the motive card; absent = unknown. */
    gender?: 'female' | 'male';
    core: Core;
    appetites: Appetite[];
    agenda: Agenda;
    /** Base ties (author / generated); the chat copies them on first use. */
    ties: Tie[];
    /** Where they are and what they do when a starting scene begins (by greeting index; -1 = any). */
    starts: { greeting: number; present: boolean; doing?: string; goal?: string }[];
    meta: Record<string, FieldMeta>;
    /** Minors are excluded from sexual appetites by the content boundary (Maestro rule, docs/model.md §5.7). */
    minor?: boolean;
}

/** World-level reading of a card (§7). */
export type WorldTone = 'hostile' | 'indifferent' | 'neutral' | 'welcoming';

export interface ReputationSeed {
    /** A group or a place («стража», «долина»); '*' = everyone. */
    among: string;
    /** What they think the player is («беглый каторжник»). */
    label: string;
    /** Stance a stranger of this group starts with. */
    stance: Stance;
    /** By greeting index; -1 = every start. */
    greeting: number;
    evidence?: string[];
}

/** Everything Dramatis keeps for one card (file per card). */
export interface CardProfiles {
    schema: number;
    /** Card avatar file name (the key). */
    card: string;
    worldTone: WorldTone;
    /** Things that must always hold (author invariants). */
    invariants: string[];
    characters: CharacterProfile[];
    rules: AppetiteRule[];
    reputation: ReputationSeed[];
    /** When and from what the intent was read (hash of the sources), for re-read diffs. */
    intent?: { at: number; sourcesHash: string; model?: string };
    meta: Record<string, FieldMeta>;
}

/* ------------------------------------------------------------------ chat state (§4.4, §5) */

export type AttentionBand = 'background' | 'business' | 'focus';

export const MOVES = ['own', 'respond', 'initiate', 'obstruct', 'watch', 'leave'] as const;
export type Move = (typeof MOVES)[number];

export interface Emotion {
    /** OCC-ish label: anger, fear, hope, shame, gratitude, suspicion, contempt… (English, free). */
    type: string;
    /** 1–5. */
    intensity: number;
    /** Character id, PLAYER_ID, or ''. */
    target: string;
    cause: string;
    /** Turn counter after which it fades. */
    until: number;
}

export interface SceneState {
    doing?: string;
    goal?: string;
    obstacle?: string;
    attention: AttentionBand;
    move?: Move;
    /** Whom the move is aimed at (character id or PLAYER_ID). */
    moveTarget?: string;
    /** Short English description of the move («sends Брам to follow him»). */
    moveText?: string;
}

/** Pressure ladder (§4.5): 0 sated … 5 obsessed. */
export const PRESSURE_WORDS = ['sated', 'background', 'present', 'preoccupied', 'driving', 'obsessed'] as const;

export interface AppetiteState {
    pressure: Scale5;
    tolerance: Scale3;
    dependence: Scale3;
    sensitization: Scale3;
    /** Turn of the last satisfaction (-1 never). */
    lastSated: number;
    /** Satisfactions «on edge» (pressure ≥ 4) since the last sensitization step. */
    edgeCount: number;
    withdrawal: boolean;
    /** The abstinent character lapsed this chapter (abstinence violation effect pending). */
    lapsed?: boolean;
    /** In-world days since the last satisfaction (withdrawal onset, tolerance fade); absent = 0. */
    daysUnsated?: number;
}

/** A scheme with a clock (§5.7): kidnapping, a seduction with a hook, an undermining. */
export interface Scheme {
    id: string;
    owner: string;
    target: string;
    appetite?: string;
    /** Ladder step of the method (0–8). */
    method: number;
    text: string;
    clock: Clock;
    /** 0–100. */
    secrecy: number;
    breaches: number;
    accomplices: string[];
    state: 'running' | 'ready' | 'done' | 'failed' | 'exposed';
    startedTurn: number;
}

export interface CharacterState {
    id: string;
    /** Live ties (copied from the profile on first use, then changed by the story). */
    ties: Record<string, Tie>;
    mood: Mood;
    emotion?: Emotion;
    scene: SceneState;
    appetites: Record<string, AppetiteState>;
    /** Agenda as the story changed it (copied from the profile on first use). */
    agenda: Agenda;
    stress: number;
    /** `bonusDice`: extra remorse dice earned by refusing threshold gifts (§5.7), spent on the next roll. */
    corruption: { level: number; stains: number; gifts: string[]; brands: string[]; bonusDice?: number };
    arcStage: ArcStage;
    /** Present in the scene after the last committed turn. */
    present: boolean;
    lastSeenTurn: number;
    /** Self-control reserve 0–3 (spent by resisting, fatigue, drink, stress). */
    selfControl: number;
    /** Places this character knows the player from / heard about him (desirability spreads with knowledge). */
    knowsPlayer: boolean;
}

export interface Rumour {
    id: string;
    /** What is said, story words. */
    text: string;
    about: string;
    /** Where it started and who carries it. */
    origin: string;
    carriers: string[];
    /** Groups / places it reached. */
    reached: string[];
    false?: boolean;
    turn: number;
    /** A distorted retelling forked from this rumour id while spreading. */
    variantOf?: string;
}

export interface Reputation {
    among: string;
    label: string;
    stance: Stance;
    /** Weaknesses of the player people there know about (§11). */
    weaknesses: string[];
    reasons: string[];
    /** Witnessed deeds still adding up to the next step (same small-step logic as ties). */
    progress?: { dir: 1 | -1; sum: number; events: number };
}

/** One line of the story log shown in the UI (stance changes, schemes, lapses…). */
export interface StateEvent {
    turn: number;
    messageIndex?: number;
    character?: string;
    kind: string;
    text: string;
}

export interface ChatState {
    schema: number;
    /** Card the chat belongs to. */
    card: string;
    worldTone: WorldTone;
    /** Characters created in this chat (generated NPCs), full profiles. */
    extras: CharacterProfile[];
    characters: Record<string, CharacterState>;
    rules: AppetiteRule[];
    reputation: Reputation[];
    rumours: Rumour[];
    schemes: Scheme[];
    /** Turn and scene counters (committed turns). */
    turn: number;
    scene: number;
    /** Where and when the current scene is (DES). */
    place?: string;
    time?: string;
    /** Starting greeting the chat began with. */
    greeting: number;
    log: StateEvent[];
}
