// The living world (docs/model.md §11, §4.2 fronts, §5.7 schemes and appetites off-screen; research B10 fronts, B11
// clocks, B13 faction turns, C8 gossip). One world tick:
// 1. every important absent character and every faction with a front takes ONE off-screen action toward its front or
//    current intention; the roll uses resources, leverage (what can be used against them) and the clock's momentum;
//    success moves the clock 1–2, a partial success 1 with a price, a failure nothing and maybe a setback; a full
//    front clock is its doom (log line, front done, the consequences listed in the front); a full intention clock
//    means the intention was achieved (the agenda moves on to the next goal);
// 2. schemes of absent owners tick (secrecy breaches → exposed → a rumour); ready schemes against someone far from the
//    player are attempted off-screen;
// 3. appetites of absent characters feel the time and may be sated off-screen (Grukk came back with loot);
// 4. rumours spread one hop over a talk graph of groups, places and ties; whoever now hears of the player knows him —
//    and only then may want him (decision В17).
// Pure: the state is cloned, the rng injected; events carry English lines plus parameters for localized log lines.
import type { Mode, Rng } from '../shared/contracts';
import { tickAppetite } from './appetites';
import type { AppetiteStrength } from './appetites';
import { SEXUAL_KINDS, desirability, pickWeighted } from './group-rules';
import { advanceClock, clockFull, promote, reconsider } from './intentions';
import { PLAYER_ID } from './model';
import type {
    Agenda,
    Appetite,
    AppetiteState,
    Belief,
    CharacterProfile,
    CharacterState,
    ChatState,
    Clock,
    Front,
    OffscreenAttempt,
    Rumour,
    Scale5,
    StateEvent,
    Tie,
} from './model';
import { emptyTie } from './profile-defaults';
import { applyStanceEvents, relationContext } from './relations';
import type { Inertia } from './relations';
import { applyReputation, rumoursReaching, spreadRumours, strangerStance } from './reputation';
import type { RumourGraph, RumourSpread } from './reputation';
import { baseStanceOf } from './scene';
import { resolveAttempt, tickScheme } from './schemes';
import { clamp, clamp01, normalizeText, round3, uniqueId } from './util';

/* ------------------------------------------------------------------ constants */

/** An intention worked on off-screen without a clock gets one this long (Blades: a simple project). */
export const DEFAULT_INTENTION_SEGMENTS = 4;
/** Off-screen attempts kept per character. */
export const MAX_ATTEMPTS = 5;
/** Beliefs kept per tie after gossip. */
export const MAX_BELIEFS = 8;
/** Rumours kept in the chat (oldest dropped). */
export const MAX_RUMOURS = 100;
/** Log lines kept in the chat state. */
export const MAX_LOG = 300;

/** Odds bounds of an off-screen attempt. */
export const MIN_ODDS = 0.15;
export const MAX_ODDS = 0.8;
/** Share of rolls above the success line that still give a partial success. */
export const PARTIAL_BAND = 0.25;
/** A failure costs a segment this often. */
export const SETBACK_CHANCE = 0.35;
/**
 * Chance that a success moves the clock 2 instead of 1, by mode: the pace per committed turn stays similar although
 * economy ticks every 30 turns and cinema every 10.
 */
export const DOUBLE_ADVANCE: Readonly<Record<Mode, number>> = { economy: 0.75, balanced: 0.4, cinema: 0.25 };

/** Which action an actor picks: fronts move the world first, then the first intention. */
const ACTION_WEIGHTS = { front: 2, first: 1.5, second: 1 } as const;

/** Prices of a partial success (English words for the brief; the UI localizes by id). */
export const COMPLICATIONS = {
    cost: 'it cost more than planned',
    noticed: 'someone noticed',
    slow: 'it took longer than hoped',
    balked: 'an ally balked',
    trail: 'it left a trail',
} as const;
export type Complication = keyof typeof COMPLICATIONS;
const COMPLICATION_IDS = Object.keys(COMPLICATIONS) as Complication[];

/** Off-screen chance to sate an appetite at «preoccupied» or above, by how its pressure grows. */
export const OFFSCREEN_OPPORTUNITY: Readonly<Record<Appetite['drift'], number>> = {
    daily: 0.7,
    seasonal: 0.4,
    opportunity: 0.35,
    none: 0.3,
};
/** A group's custom (raids, the victor's right) or a faction makes chances. */
const CUSTOM_BONUS = 0.15;

/** A running scheme gets its chance this often per tick: half the time, a quarter when the target is near the player. */
const SCHEME_OPPORTUNITY = { far: 0.5, near: 0.25 } as const;

/** Mature agendas (director twists): base weights and the closeness bonus. */
export const MATURE_WEIGHTS = { front: 2, scheme: 1.5, intention: 1, full: 1, almost: 0.5 } as const;

/* ------------------------------------------------------------------ types */

export interface WorldTickContext {
    rng: Rng;
    /** Present after the last committed turn (ids): they act on-screen, not here. */
    presentIds: readonly string[];
    /** In-world hours this tick covers (a time skip); undefined = unknown. */
    hours?: number;
    mode: Mode;
    /** The «appetite strength» lever. */
    strength: AppetiteStrength;
    /** The «inertia» lever, for stance consequences of a doom (default high). */
    inertia?: Inertia;
    /** Where the scene is (the player's place); default state.place. */
    place?: string;
    /** The player's character name (rumour texts); default «the player». */
    playerName?: string;
}

export type WorldLine =
    | 'attempt.success'
    | 'attempt.partial'
    | 'attempt.failure'
    | 'attempt.setback'
    | 'intention.done'
    | 'front.doom'
    | 'consequence.stance'
    | 'consequence.reputation'
    | 'appetite.sated'
    | 'appetite.withdrawal'
    | 'appetite.lapse'
    | 'scheme.breach'
    | 'scheme.exposed'
    | 'scheme.ready'
    | 'scheme.done'
    | 'scheme.failed'
    | 'rumour.spread'
    | 'player.learned';

/** A story-log line of the tick: English text plus what a localized line needs. */
export interface WorldEvent extends StateEvent {
    /** Localization key suffix (`world.log.<line>`). */
    line: WorldLine;
    /** Names and story words as written; numbers for stances. */
    params: Record<string, string | number>;
}

export interface WorldTickBrief {
    turn: number;
    attempts: { id: string; name: string; attempt: OffscreenAttempt }[];
    dooms: { id: string; name: string; doom: string }[];
    exposed: { scheme: string; owner: string; name: string; text: string; rumour: string }[];
    sated: { id: string; name: string; appetite: string }[];
    achieved: { id: string; name: string; intention: string }[];
    /** Ids that heard of the player this tick. */
    learned: string[];
    spread: RumourSpread[];
    /** Characters whose state the tick changed (the journal snapshot). */
    touched: string[];
}

export interface WorldTickResult {
    state: ChatState;
    events: WorldEvent[];
    brief: WorldTickBrief;
}

/* ------------------------------------------------------------------ small helpers */

function allProfiles(state: ChatState, profiles: readonly CharacterProfile[]): CharacterProfile[] {
    const map = new Map<string, CharacterProfile>();
    for (const profile of [...profiles, ...(state.extras ?? [])])
        if (!map.has(profile.id)) map.set(profile.id, profile);
    return [...map.values()];
}

function nameOf(byId: ReadonlyMap<string, CharacterProfile>, id: string, playerName: string): string {
    if (id === PLAYER_ID) return playerName;
    return byId.get(id)?.name || id;
}

function liveFront(front: Front | undefined): front is Front {
    return !!front && !front.done && front.clock.segments > 0;
}

/** The escalation step the front's clock has reached (the impulse when it has no steps). */
export function frontStep(front: Front): string {
    if (!front.steps.length) return front.impulse;
    const segments = Math.max(1, front.clock.segments);
    const index = Math.floor((Math.max(0, front.clock.filled) * front.steps.length) / segments);
    return front.steps[clamp(index, 0, front.steps.length - 1)]!;
}

/* ------------------------------------------------------------------ who acts off-screen */

/**
 * Whether a profile takes an off-screen action this tick: absent, and important — a faction (group) with a live front
 * or clocked intentions; a character written at draft or portrait level, or with a front, or clocked intentions —
 * and with something to pursue.
 */
export function actsOffscreen(
    profile: CharacterProfile,
    character: CharacterState,
    present: ReadonlySet<string>,
): boolean {
    if (present.has(profile.id)) return false;
    const agenda = character.agenda;
    const front = liveFront(agenda.front) && !clockFull(agenda.front.clock);
    const clocked = agenda.intentions.some((i) => !!i.clock);
    if (profile.kind === 'group') return front || clocked;
    const important = profile.lod !== 'sketch' || front || clocked;
    return important && (front || agenda.intentions.length > 0 || agenda.goals.length > 0);
}

/** Intentions ready for off-screen work: free slots promoted from goals, every intention with a clock. */
export function prepareAgenda(agenda: Agenda): Agenda {
    const promoted = agenda.intentions.length === 0 && agenda.goals.length > 0 ? promote(agenda).agenda : agenda;
    const intentions = promoted.intentions.map((i) =>
        i.clock ? i : { ...i, clock: { segments: DEFAULT_INTENTION_SEGMENTS, filled: 0 } },
    );
    return { ...promoted, intentions };
}

export interface OffscreenAction {
    source: 'front' | 'intention';
    /** Intention id (source 'intention'). */
    intention?: string;
    goal: string;
    attempt: string;
    clock: Clock;
}

/** One action: the front (weight 2) or one of the intentions (1.5, 1), drawn by weight; null when nothing is open. */
export function chooseAction(agenda: Agenda, rng: Rng): OffscreenAction | null {
    const options = new Map<string, OffscreenAction>();
    const weights: Record<string, number> = {};
    const front = agenda.front;
    if (liveFront(front) && !clockFull(front.clock)) {
        options.set('front', { source: 'front', goal: front.impulse, attempt: frontStep(front), clock: front.clock });
        weights.front = ACTION_WEIGHTS.front;
    }
    agenda.intentions.slice(0, 2).forEach((intention, index) => {
        if (!intention.clock || clockFull(intention.clock)) return;
        const key = `i:${intention.id}`;
        options.set(key, {
            source: 'intention',
            intention: intention.id,
            goal: intention.text,
            attempt: intention.nextStep?.trim() || intention.text,
            clock: intention.clock,
        });
        weights[key] = index === 0 ? ACTION_WEIGHTS.first : ACTION_WEIGHTS.second;
    });
    if (options.size === 0) return null;
    if (options.size === 1) return [...options.values()][0]!;
    const key = pickWeighted(weights, rng);
    return (key && options.get(key)) || [...options.values()][0]!;
}

/* ------------------------------------------------------------------ the roll */

export interface OddsInput {
    /** Resources listed in the agenda. */
    resources: number;
    /** What can be used against them (agenda leverage). */
    leverage: number;
    /** Clock progress 0–1: things in motion keep moving. */
    progress: number;
    /** A faction acts with many hands. */
    group?: boolean;
}

/** Success odds and the partial band of an off-screen attempt. */
export function attemptOdds(input: OddsInput): { success: number; partial: number } {
    const success =
        0.4 +
        0.06 * clamp(input.resources, 0, 4) -
        0.04 * clamp(input.leverage, 0, 3) +
        0.15 * clamp01(input.progress) +
        (input.group ? 0.05 : 0);
    return { success: round3(clamp(success, MIN_ODDS, MAX_ODDS)), partial: PARTIAL_BAND };
}

export type Outcome = OffscreenAttempt['outcome'];

/** One roll: below the success line a success, within the band above it a partial success, else a failure. */
export function rollOutcome(odds: { success: number; partial: number }, rng: Rng): Outcome {
    const roll = rng();
    if (roll < odds.success) return 'success';
    if (roll < odds.success + odds.partial) return 'partial';
    return 'failure';
}

export interface ResolvedAttempt {
    outcome: Outcome;
    /** Segments gained (negative = lost ground). */
    advance: number;
    complication?: Complication;
    setback?: boolean;
    chance: number;
}

/** Rolls an action: success +1 (+2 with the mode's chance), partial +1 with a price, failure 0 or a setback −1. */
export function resolveAction(action: OffscreenAction, odds: OddsInput, mode: Mode, rng: Rng): ResolvedAttempt {
    const chances = attemptOdds(odds);
    const outcome = rollOutcome(chances, rng);
    if (outcome === 'success') {
        const advance = rng() < (DOUBLE_ADVANCE[mode] ?? DOUBLE_ADVANCE.balanced) ? 2 : 1;
        return { outcome, advance, chance: chances.success };
    }
    if (outcome === 'partial') {
        const complication = COMPLICATION_IDS[Math.floor(rng() * COMPLICATION_IDS.length)] ?? 'cost';
        return { outcome, advance: 1, complication, chance: chances.success };
    }
    const setback = action.clock.filled > 0 && rng() < SETBACK_CHANCE;
    return { outcome, advance: setback ? -1 : 0, setback, chance: chances.success };
}

/* ------------------------------------------------------------------ the talk graph */

export interface SocialIndex {
    /** Nodes each character belongs to: its own name, its groups (ties ≥ +1 to a group), the scene place if present. */
    nodesOf: Map<string, string[]>;
    graph: RumourGraph;
    /** Any name, alias or id (normalised) → its node. */
    canon: Map<string, string>;
}

/**
 * Who talks to whom (§11: rumours run along ties). Nodes are group names, places and each character's own name (a
 * group of one); edges join a character to its groups and place, and to everyone it has a tie with that is not
 * hostile (enemies do not trade news).
 */
export function socialIndex(
    state: ChatState,
    profiles: readonly CharacterProfile[],
    ctx: { presentIds: readonly string[]; place?: string },
): SocialIndex {
    const list = allProfiles(state, profiles);
    const byId = new Map(list.map((p) => [p.id, p]));
    const node = (p: CharacterProfile) => p.name || p.id;
    const canon = new Map<string, string>();
    for (const p of list) {
        for (const key of [p.id, p.name, ...p.aliases]) {
            const k = normalizeText(key ?? '');
            if (k && !canon.has(k)) canon.set(k, node(p));
        }
    }
    const place = ctx.place?.trim() || state.place?.trim() || '';
    if (place && !canon.has(normalizeText(place))) canon.set(normalizeText(place), place);
    const present = new Set(ctx.presentIds);

    const edges = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
        if (!a || !b || a === b) return;
        const set = edges.get(a) ?? new Set<string>();
        set.add(b);
        edges.set(a, set);
    };
    const nodesOf = new Map<string, string[]>();
    for (const p of list) {
        const character = state.characters[p.id];
        if (!character) continue;
        const own = node(p);
        const nodes = [own];
        for (const tie of Object.values(character.ties)) {
            const other = byId.get(tie.target);
            if (!other || tie.target === PLAYER_ID) continue;
            if (other.kind === 'group' && tie.stance >= 1 && !nodes.includes(node(other))) nodes.push(node(other));
            if (tie.stance >= -1) link(own, node(other));
        }
        if (present.has(p.id) && place && !nodes.includes(place)) nodes.push(place);
        for (const other of nodes.slice(1)) link(own, other);
        nodesOf.set(p.id, nodes);
    }
    const graph: RumourGraph = {};
    for (const [from, tos] of edges) graph[from] = [...tos];
    return { nodesOf, graph, canon };
}

function canonical(index: SocialIndex, name: string): string {
    return index.canon.get(normalizeText(name)) ?? name;
}

/* ------------------------------------------------------------------ ties and beliefs */

function ensureTie(character: CharacterState, target: string, stance: Tie['stance'] = 0): Tie {
    const existing = character.ties[target];
    if (existing) return existing;
    const created: Tie = { ...emptyTie(target, stance), base: stance };
    character.ties[target] = created;
    return created;
}

/** Adds a belief unless the same claim is already held; keeps the last MAX_BELIEFS. */
export function addBelief(tie: Tie, belief: Belief): Tie {
    const key = normalizeText(belief.claim);
    if (!key || tie.beliefs.some((b) => normalizeText(b.claim) === key)) return tie;
    return { ...tie, beliefs: [...tie.beliefs, belief].slice(-MAX_BELIEFS) };
}

function heardBelief(rumour: Rumour): Belief {
    const belief: Belief = { claim: rumour.text, source: 'heard', confidence: 0.5 };
    if (rumour.false) belief.false = true;
    return belief;
}

/** Want toward the player of appetites aimed at him, once the character knows of him (§4.5, decision В17). */
export function wantOnLearning(
    profile: CharacterProfile,
    character: CharacterState,
    rules: ChatState['rules'],
): { want: Scale5; appetite: string } | null {
    let best: { want: Scale5; appetite: string } | null = null;
    for (const appetite of profile.appetites) {
        if (appetite.target.mode !== 'player') continue;
        if (profile.minor && SEXUAL_KINDS.includes(appetite.kind)) continue;
        const pressure = character.appetites[appetite.id]?.pressure ?? appetite.baseline;
        const rule = rules.find((r) => r.id === appetite.rule);
        const want = desirability(
            { kind: appetite.kind, choosiness: rule?.choosiness ?? 0 },
            { value: appetite.baseline },
            { pressure, available: 1 },
        );
        if (want > 0 && (!best || want > best.want)) best = { want, appetite: appetite.id };
    }
    return best;
}

/* ------------------------------------------------------------------ the tick */

interface TickScope {
    next: ChatState;
    byId: Map<string, CharacterProfile>;
    present: Set<string>;
    ctx: WorldTickContext;
    playerName: string;
    events: WorldEvent[];
    brief: WorldTickBrief;
    touched: Set<string>;
}

function event(
    scope: TickScope,
    line: WorldLine,
    text: string,
    params: WorldEvent['params'],
    character?: string,
): void {
    const item: WorldEvent = { turn: scope.next.turn, kind: `world.${line.split('.')[0]}`, text, line, params };
    if (character) item.character = character;
    scope.events.push(item);
}

/**
 * One world tick (see the file header). Returns the new state, the story-log events and a structured brief; the
 * input state is not touched.
 */
export function worldTick(
    state: ChatState,
    profiles: readonly CharacterProfile[],
    ctx: WorldTickContext,
): WorldTickResult {
    const next = structuredClone(state);
    next.rumours ??= [];
    next.schemes ??= [];
    next.reputation ??= [];
    next.rules ??= [];
    const list = allProfiles(next, profiles);
    const scope: TickScope = {
        next,
        byId: new Map(list.map((p) => [p.id, p])),
        present: new Set(ctx.presentIds),
        ctx,
        playerName: ctx.playerName?.trim() || 'the player',
        events: [],
        brief: {
            turn: next.turn,
            attempts: [],
            dooms: [],
            exposed: [],
            sated: [],
            achieved: [],
            learned: [],
            spread: [],
            touched: [],
        },
        touched: new Set(),
    };
    const index = socialIndex(next, list, { presentIds: ctx.presentIds, ...(ctx.place ? { place: ctx.place } : {}) });

    // Those in the scene see the player with their own eyes.
    for (const id of scope.present) {
        const character = next.characters[id];
        if (character && !character.knowsPlayer) {
            character.knowsPlayer = true;
            scope.touched.add(id);
        }
    }

    // A front filled on-screen (the turn pass) comes due here, present owner or not: it is a world event.
    for (const profile of list) {
        const character = next.characters[profile.id];
        const front = character?.agenda.front;
        if (!character || !liveFront(front) || !clockFull(front.clock)) continue;
        const done: Front = { ...front, done: true };
        character.agenda = { ...character.agenda, front: done };
        scope.touched.add(profile.id);
        doom(scope, profile, done);
    }
    for (const profile of list) {
        const character = next.characters[profile.id];
        if (!character || !actsOffscreen(profile, character, scope.present)) continue;
        offscreenAction(scope, profile, character);
    }
    const satedByScheme = offscreenSchemes(scope, index);
    for (const profile of list) {
        const character = next.characters[profile.id];
        if (!character || scope.present.has(profile.id) || profile.appetites.length === 0) continue;
        offscreenAppetites(scope, profile, character, satedByScheme.get(profile.id));
    }
    gossip(scope, index);

    if (next.rumours.length > MAX_RUMOURS) next.rumours = next.rumours.slice(-MAX_RUMOURS);
    scope.brief.touched = [...scope.touched];
    return { state: next, events: scope.events, brief: scope.brief };
}

/* ------------------------------------------------------------------ 1. actions */

function achieved(scope: TickScope, profile: CharacterProfile, agenda: Agenda, ids: string[]): Agenda {
    if (ids.length === 0) return agenda;
    const name = profile.name || profile.id;
    const signals = Object.fromEntries(ids.map((id) => [id, { achieved: true }]));
    for (const id of ids) {
        const text = agenda.intentions.find((i) => i.id === id)?.text ?? id;
        scope.brief.achieved.push({ id: profile.id, name, intention: text });
        event(scope, 'intention.done', `${name} achieved off-screen: ${text}.`, { name, intention: text }, profile.id);
    }
    return reconsider(agenda, signals, profile.core.commitment).agenda;
}

function offscreenAction(scope: TickScope, profile: CharacterProfile, character: CharacterState): void {
    const { next, ctx } = scope;
    let agenda = prepareAgenda(character.agenda);
    // Intentions whose clocks filled on-screen are done by now.
    const full = agenda.intentions.filter((i) => i.clock && clockFull(i.clock)).map((i) => i.id);
    if (full.length) {
        agenda = prepareAgenda(achieved(scope, profile, agenda, full));
        character.agenda = agenda;
        scope.touched.add(profile.id);
    }
    const action = chooseAction(agenda, ctx.rng);
    if (!action) return;
    const progress = action.clock.segments > 0 ? action.clock.filled / action.clock.segments : 0;
    const rolled = resolveAction(
        action,
        {
            resources: agenda.resources.length,
            leverage: agenda.leverage.length,
            progress,
            group: profile.kind === 'group',
        },
        ctx.mode,
        ctx.rng,
    );
    const clock = advanceClock(action.clock, rolled.advance);
    const name = profile.name || profile.id;

    if (action.source === 'front' && agenda.front) {
        agenda = { ...agenda, front: { ...agenda.front, clock } };
    } else if (action.intention) {
        agenda = {
            ...agenda,
            intentions: agenda.intentions.map((i) => (i.id === action.intention ? { ...i, clock } : i)),
        };
    }

    const attempt: OffscreenAttempt = {
        turn: next.turn,
        goal: action.goal,
        attempt: action.attempt,
        outcome: rolled.outcome,
        advanced: clock.filled - action.clock.filled,
        clock,
        source: action.source,
        chance: rolled.chance,
    };
    if (rolled.complication) attempt.complication = COMPLICATIONS[rolled.complication];
    else if (rolled.setback) attempt.complication = 'lost ground';
    character.offscreen = [...(character.offscreen ?? []), attempt].slice(-MAX_ATTEMPTS);
    scope.touched.add(profile.id);
    scope.brief.attempts.push({ id: profile.id, name, attempt });

    const params = { name, attempt: action.attempt, goal: action.goal };
    if (rolled.outcome === 'success') {
        event(scope, 'attempt.success', `${name} off-screen: ${action.attempt} — succeeded.`, params, profile.id);
    } else if (rolled.outcome === 'partial') {
        const price = rolled.complication ?? 'cost';
        event(
            scope,
            'attempt.partial',
            `${name} off-screen: ${action.attempt} — partly, but ${COMPLICATIONS[price]}.`,
            { ...params, complication: price },
            profile.id,
        );
    } else if (rolled.setback) {
        event(
            scope,
            'attempt.setback',
            `${name} off-screen: ${action.attempt} — failed and lost ground.`,
            params,
            profile.id,
        );
    } else {
        event(scope, 'attempt.failure', `${name} off-screen: ${action.attempt} — failed.`, params, profile.id);
    }

    if (action.source === 'front' && agenda.front && clockFull(clock)) {
        const front: Front = { ...agenda.front, done: true };
        agenda = { ...agenda, front };
        character.agenda = agenda;
        doom(scope, profile, front);
        return;
    }
    if (action.source === 'intention' && action.intention && clockFull(clock)) {
        agenda = achieved(scope, profile, agenda, [action.intention]);
    }
    character.agenda = agenda;
}

/** The doom of a front: the log line and the consequences listed in the front. */
function doom(scope: TickScope, profile: CharacterProfile, front: Front): void {
    const { next } = scope;
    const name = profile.name || profile.id;
    scope.brief.dooms.push({ id: profile.id, name, doom: front.doom || front.impulse });
    event(
        scope,
        'front.doom',
        `${name}: ${front.doom || front.impulse}`,
        { name, doom: front.doom || front.impulse },
        profile.id,
    );

    for (const consequence of front.consequences ?? []) {
        const text = consequence.text?.trim() || front.doom || front.impulse;
        if (consequence.kind === 'reputation') {
            const applied = applyReputation(next.reputation, [
                {
                    among: consequence.among,
                    text,
                    delta: consequence.delta,
                    ...(consequence.label ? { label: consequence.label } : {}),
                },
            ]);
            next.reputation = applied.reputation;
            for (const change of applied.changes) {
                if (change.kind !== 'step') continue;
                event(
                    scope,
                    'consequence.reputation',
                    `Reputation among ${change.among}: ${change.from} → ${change.to} (${text}).`,
                    { among: change.among, from: change.from ?? 0, to: change.to ?? 0, text },
                );
            }
            continue;
        }
        const who = consequence.who?.trim() || profile.id;
        const holder = next.characters[who];
        if (!holder) continue;
        const holderProfile = scope.byId.get(who);
        const tie = ensureTie(holder, consequence.target);
        const rc = relationContext({
            core: holderProfile?.core ?? { stanceBounds: [], temperament: {} },
            targetId: consequence.target,
            scene: next.scene,
            inertia: scope.ctx.inertia ?? 'high',
            baseStance: baseStanceOf(holderProfile, tie),
        });
        const applied = applyStanceEvents(tie, [{ text, delta: consequence.delta, key: true, permanent: true }], rc);
        holder.ties[consequence.target] = applied.tie;
        scope.touched.add(who);
        for (const change of applied.changes) {
            if (change.kind !== 'step') continue;
            const holderName = holderProfile?.name || who;
            const targetName = nameOf(scope.byId, consequence.target, scope.playerName);
            event(
                scope,
                'consequence.stance',
                `${holderName} toward ${targetName}: ${change.from} → ${change.to} (${text}).`,
                { name: holderName, target: targetName, from: change.from ?? 0, to: change.to ?? 0, text },
                who,
            );
        }
    }
}

/* ------------------------------------------------------------------ 2. schemes */

function schemeRumour(scope: TickScope, index: SocialIndex, scheme: ChatState['schemes'][number]): Rumour {
    const { next } = scope;
    const owner = nameOf(scope.byId, scheme.owner, scope.playerName);
    const target = nameOf(scope.byId, scheme.target, scope.playerName);
    const reached: string[] = [];
    for (const id of [scheme.owner, ...scheme.accomplices]) {
        for (const node of index.nodesOf.get(id) ?? [owner]) if (!reached.includes(node)) reached.push(node);
    }
    const rumour: Rumour = {
        id: uniqueId(
            `scheme-${scheme.id}`,
            next.rumours.map((r) => r.id),
        ),
        text: `${owner} schemes against ${target}: ${scheme.text}`,
        about: scheme.owner,
        origin: reached[0] ?? owner,
        carriers: [],
        reached,
        turn: next.turn,
    };
    next.rumours.push(rumour);
    return rumour;
}

/**
 * Schemes of absent owners: a ready scheme against someone far from the player is attempted off-screen (the attempt
 * waits a tick after the clock fills, so the director can still use it); running ones tick. Returns the appetites a
 * done scheme sated, by owner.
 */
function offscreenSchemes(scope: TickScope, index: SocialIndex): Map<string, Set<string>> {
    const { next, ctx, present } = scope;
    const sated = new Map<string, Set<string>>();
    next.schemes = next.schemes.map((scheme) => {
        if (present.has(scheme.owner)) return scheme;
        const near = scheme.target === PLAYER_ID || present.has(scheme.target);
        const name = nameOf(scope.byId, scheme.owner, scope.playerName);
        const targetName = nameOf(scope.byId, scheme.target, scope.playerName);
        const params = { name, scheme: scheme.text, target: targetName };
        const exposed = (updated: typeof scheme) => {
            const rumour = schemeRumour(scope, index, updated);
            scope.brief.exposed.push({
                scheme: updated.id,
                owner: updated.owner,
                name,
                text: updated.text,
                rumour: rumour.id,
            });
            event(
                scope,
                'scheme.exposed',
                `${name}'s scheme against ${targetName} is exposed: ${updated.text}.`,
                params,
                updated.owner,
            );
        };

        if (scheme.state === 'ready' && !near) {
            const resources = scope.next.characters[scheme.owner]?.agenda.resources.length ?? 0;
            const result = resolveAttempt(
                scheme,
                { guardians: 1, caution: 1, capability: clamp(resources, 0, 3) },
                ctx.rng,
            );
            scope.touched.add(scheme.owner);
            if (result.outcome === 'done') {
                event(
                    scope,
                    'scheme.done',
                    `${name} carried out the scheme against ${targetName}: ${scheme.text}.`,
                    params,
                    scheme.owner,
                );
                if (scheme.appetite) {
                    const set = sated.get(scheme.owner) ?? new Set<string>();
                    set.add(scheme.appetite);
                    sated.set(scheme.owner, set);
                }
            } else if (result.outcome === 'exposed') {
                exposed(result.scheme);
            } else {
                event(
                    scope,
                    'scheme.failed',
                    `${name}'s scheme against ${targetName} failed: ${scheme.text}.`,
                    params,
                    scheme.owner,
                );
            }
            return result.scheme;
        }
        if (scheme.state !== 'running') return scheme;

        const opportunity = ctx.rng() < (near ? SCHEME_OPPORTUNITY.near : SCHEME_OPPORTUNITY.far);
        const ticked = tickScheme(scheme, { opportunity, guarded: near }, ctx.rng);
        if (ticked.notes.length) scope.touched.add(scheme.owner);
        if (ticked.notes.includes('breach') && !ticked.notes.includes('exposed')) {
            event(scope, 'scheme.breach', `Someone noticed ${name} preparing: ${scheme.text}.`, params, scheme.owner);
        }
        if (ticked.notes.includes('exposed')) exposed(ticked.scheme);
        if (ticked.notes.includes('ready')) {
            event(
                scope,
                'scheme.ready',
                `${name} is ready to strike at ${targetName}: ${scheme.text}.`,
                params,
                scheme.owner,
            );
        }
        return ticked.scheme;
    });
    return sated;
}

/* ------------------------------------------------------------------ 3. appetites */

/** Off-screen chance to sate an appetite (§11: «утоляется за кадром»); 0 below «present» or when aimed at the player. */
export function offscreenSatiation(appetite: Appetite, state: AppetiteState, profile: CharacterProfile): number {
    if (appetite.target.mode === 'player' || state.pressure < 2) return 0;
    let chance = OFFSCREEN_OPPORTUNITY[appetite.drift] ?? OFFSCREEN_OPPORTUNITY.none;
    if (appetite.sources.includes('culture') || profile.kind === 'group') chance += CUSTOM_BONUS;
    if (state.pressure < 3) chance *= 0.5;
    if (appetite.vow === 'abstinent') chance *= 0.3;
    else if (appetite.vow === 'moderate') chance *= 0.7;
    return clamp01(chance);
}

function bestSatisfier(appetite: Appetite): { amount: number; full?: boolean } {
    const best = appetite.satisfiers.reduce<Appetite['satisfiers'][number] | undefined>(
        (top, s) => (!top || s.amount > top.amount ? s : top),
        undefined,
    );
    if (!best) return { amount: 3 };
    return best.full ? { amount: best.amount, full: true } : { amount: best.amount };
}

function offscreenAppetites(
    scope: TickScope,
    profile: CharacterProfile,
    character: CharacterState,
    satedByScheme: Set<string> | undefined,
): void {
    const { next, ctx } = scope;
    const name = profile.name || profile.id;
    for (const appetite of profile.appetites) {
        const current = character.appetites[appetite.id];
        if (!current) continue;
        const forced = satedByScheme?.has(appetite.id) === true;
        const chance = forced ? 1 : offscreenSatiation(appetite, current, profile);
        const satisfied = chance > 0 && (forced || ctx.rng() < chance) ? bestSatisfier(appetite) : undefined;
        const tick = tickAppetite(
            appetite,
            current,
            {
                ...(ctx.hours !== undefined ? { hoursPassed: ctx.hours } : {}),
                ...(satisfied ? { satisfied } : {}),
            },
            { turn: next.turn, strength: ctx.strength },
        );
        if (JSON.stringify(tick.state) !== JSON.stringify(current)) scope.touched.add(profile.id);
        character.appetites[appetite.id] = tick.state;
        if (tick.selfControlDelta) {
            character.selfControl = clamp(character.selfControl + tick.selfControlDelta, 0, 3);
        }
        const params = { name, appetite: appetite.label ?? '', kind: appetite.kind };
        const what = appetite.label || appetite.kind;
        if (tick.notes.includes('sated')) {
            scope.brief.sated.push({ id: profile.id, name, appetite: appetite.id });
            event(scope, 'appetite.sated', `${name} sated ${what} off-screen.`, params, profile.id);
        }
        if (tick.notes.includes('lapse')) {
            event(scope, 'appetite.lapse', `${name} broke the vow off-screen: ${what}.`, params, profile.id);
        }
        if (tick.notes.includes('withdrawal')) {
            event(scope, 'appetite.withdrawal', `${name} is in withdrawal: ${what}.`, params, profile.id);
        }
    }
}

/* ------------------------------------------------------------------ 4. rumours */

/**
 * One hop of gossip over the talk graph; whoever's node a rumour reached gets a «heard» belief about its subject
 * (ties to the player are created, other ties only updated); anyone a rumour about the player now reaches knows
 * of him, and appetites aimed at him wake toward him.
 */
function gossip(scope: TickScope, index: SocialIndex): void {
    const { next, ctx } = scope;
    const rumours = next.rumours.map((r) => {
        const reached = [...new Set(r.reached.map((g) => canonical(index, g)))];
        return reached.length === r.reached.length && reached.every((g, i) => g === r.reached[i])
            ? r
            : { ...r, reached };
    });
    const spread = spreadRumours(rumours, index.graph, ctx.rng, 1);
    next.rumours = spread.rumours;
    scope.brief.spread = spread.spread;

    // Node → the characters in it.
    const members = new Map<string, string[]>();
    for (const [id, nodes] of index.nodesOf) {
        for (const node of nodes) {
            const key = normalizeText(node);
            members.set(key, [...(members.get(key) ?? []), id]);
        }
    }
    const byRumour = new Map(next.rumours.map((r) => [r.id, r]));
    const perRumour = new Map<string, string[]>();
    for (const item of spread.spread) {
        const id = item.distorted && item.variant ? item.variant : item.rumour;
        perRumour.set(id, [...(perRumour.get(id) ?? []), item.group]);
        const rumour = byRumour.get(id);
        if (!rumour) continue;
        for (const hearer of members.get(normalizeText(item.group)) ?? []) hear(scope, index, hearer, rumour);
    }
    for (const [id, groups] of perRumour) {
        const rumour = byRumour.get(id);
        if (!rumour) continue;
        event(scope, 'rumour.spread', `Rumour «${rumour.text}» reached ${groups.join(', ')}.`, {
            text: rumour.text,
            groups: groups.join(', '),
        });
    }

    for (const [id, character] of Object.entries(next.characters)) {
        if (character.knowsPlayer) continue;
        const nodes = index.nodesOf.get(id) ?? [];
        const reaching = rumoursReaching({ id, groups: nodes }, next.rumours);
        if (reaching.length === 0) continue;
        learn(scope, id, character, nodes, reaching[0]!);
    }
}

/** A character heard a rumour: a belief on the tie toward its subject (created toward the player). */
function hear(scope: TickScope, index: SocialIndex, hearer: string, rumour: Rumour): void {
    const character = scope.next.characters[hearer];
    if (!character || rumour.about === hearer) return;
    if (rumour.about !== PLAYER_ID && !character.ties[rumour.about]) return;
    // Someone who has not heard of the player yet learns of him below (learn() makes the tie).
    if (rumour.about === PLAYER_ID && !character.knowsPlayer) return;
    const stranger = strangerStance(scope.next.reputation, index.nodesOf.get(hearer) ?? []);
    const tie = ensureTie(character, rumour.about, stranger?.stance ?? 0);
    const updated = addBelief(tie, heardBelief(rumour));
    if (updated !== tie) {
        character.ties[rumour.about] = updated;
        scope.touched.add(hearer);
    }
}

/** The character hears of the player for the first time (decision В17): the tie, the belief and the want wake. */
function learn(scope: TickScope, id: string, character: CharacterState, nodes: string[], rumour: Rumour): void {
    const { next } = scope;
    character.knowsPlayer = true;
    scope.touched.add(id);
    scope.brief.learned.push(id);
    const view = strangerStance(next.reputation, nodes);
    const tie = ensureTie(character, PLAYER_ID, view?.stance ?? 0);
    let updated = addBelief(tie, heardBelief(rumour));
    const profile = scope.byId.get(id);
    const want = profile ? wantOnLearning(profile, character, next.rules) : null;
    if (want && want.want > (updated.want ?? 0)) updated = { ...updated, want: want.want, appetite: want.appetite };
    character.ties[PLAYER_ID] = updated;
    const name = profile?.name || id;
    event(
        scope,
        'player.learned',
        `${name} heard of ${scope.playerName}: «${rumour.text}».`,
        { name, rumour: rumour.text },
        id,
    );
}

/* ------------------------------------------------------------------ for Maestro */

/**
 * Agendas close to their end (clock ≥ segments − 1): director twist sources (§13, M14). Fronts weigh most, then
 * schemes, then intentions; a full clock adds more than an almost-full one.
 */
export function matureAgendas(
    state: ChatState,
    profiles: readonly CharacterProfile[],
    options: { playerName?: string } = {},
): { text: string; weight: number }[] {
    const list = allProfiles(state, profiles);
    const byId = new Map(list.map((p) => [p.id, p]));
    const playerName = options.playerName?.trim() || 'the player';
    const out: { text: string; weight: number }[] = [];
    const closeness = (clock: Clock) => (clock.filled >= clock.segments ? MATURE_WEIGHTS.full : MATURE_WEIGHTS.almost);
    const mature = (clock: Clock | undefined): clock is Clock =>
        !!clock && clock.segments > 0 && clock.filled >= clock.segments - 1;

    for (const profile of list) {
        const character = state.characters[profile.id];
        if (!character) continue;
        const name = profile.name || profile.id;
        const front = character.agenda.front;
        if (liveFront(front) && mature(front.clock)) {
            const doomText = front.doom ? ` — if nobody intervenes: ${front.doom}` : '';
            out.push({
                text: `${name}: ${frontStep(front)} (${front.impulse})${doomText}`,
                weight: MATURE_WEIGHTS.front + closeness(front.clock),
            });
        }
        for (const intention of character.agenda.intentions) {
            if (!mature(intention.clock)) continue;
            const step = intention.nextStep?.trim();
            out.push({
                text: step ? `${name}: ${step} (${intention.text})` : `${name}: ${intention.text}`,
                weight: MATURE_WEIGHTS.intention + closeness(intention.clock),
            });
        }
    }
    for (const scheme of state.schemes ?? []) {
        if (scheme.state !== 'running' && scheme.state !== 'ready') continue;
        if (!mature(scheme.clock)) continue;
        const owner = nameOf(byId, scheme.owner, playerName);
        const target = nameOf(byId, scheme.target, playerName);
        out.push({
            text: `${owner}: scheme against ${target} — ${scheme.text}`,
            weight: MATURE_WEIGHTS.scheme + (scheme.state === 'ready' ? MATURE_WEIGHTS.full : closeness(scheme.clock)),
        });
    }
    return out.sort((a, b) => b.weight - a.weight);
}

function outcomeWords(attempt: OffscreenAttempt): string {
    if (attempt.outcome === 'success') return 'succeeded';
    if (attempt.outcome === 'partial') return `partly succeeded, but ${attempt.complication ?? 'at a price'}`;
    return attempt.complication ? `failed and ${attempt.complication}` : 'failed';
}

/**
 * One English paragraph for Maestro's offscreen writer (M16): what the character wants, its front, what it attempted
 * since it was last seen and how the rolls went, appetites sated off-screen, schemes in progress. Null when there is
 * nothing to tell.
 */
export function offscreenBrief(
    state: ChatState,
    profile: CharacterProfile,
    options: { profiles?: readonly CharacterProfile[]; playerName?: string } = {},
): string | null {
    const character = state.characters[profile.id];
    if (!character) return null;
    const byId = new Map(allProfiles(state, options.profiles ?? [profile]).map((p) => [p.id, p]));
    const playerName = options.playerName?.trim() || 'the player';
    const parts: string[] = [];
    const agenda = character.agenda;

    const wants = agenda.intentions.length
        ? agenda.intentions.slice(0, 2).map((i) => i.text)
        : [...agenda.goals]
              .sort((a, b) => a.priority - b.priority)
              .slice(0, 2)
              .map((g) => g.text);
    if (wants.length) parts.push(`Wants: ${wants.join('; ')}.`);

    const front = agenda.front;
    if (front?.done) {
        parts.push(`Their agenda came to pass: ${front.doom || front.impulse}.`);
    } else if (front && front.clock.segments > 0) {
        const doomText = front.doom ? `; if nobody intervenes: ${front.doom}` : '';
        parts.push(
            `Agenda: ${front.impulse} (${front.clock.filled}/${front.clock.segments}), next: ${frontStep(front)}${doomText}.`,
        );
    }

    const since = (character.offscreen ?? []).filter((a) => a.turn > character.lastSeenTurn).slice(-3);
    if (since.length) {
        const lines = since.map((a) => {
            const clock = a.clock ? ` (${a.clock.filled}/${a.clock.segments})` : '';
            return `tried to ${a.attempt} — ${outcomeWords(a)}${clock}`;
        });
        parts.push(`Since last seen: ${lines.join('; ')}.`);
    }

    const sated: string[] = [];
    const withdrawal: string[] = [];
    for (const appetite of profile.appetites) {
        const live = character.appetites[appetite.id];
        if (!live) continue;
        const what = appetite.label || appetite.kind;
        if (live.lastSated > character.lastSeenTurn && !character.present) sated.push(what);
        if (live.withdrawal) withdrawal.push(what);
    }
    if (sated.length) parts.push(`Sated off-screen: ${sated.join(', ')}.`);
    if (withdrawal.length) parts.push(`In withdrawal: ${withdrawal.join(', ')}.`);

    for (const scheme of state.schemes ?? []) {
        if (scheme.owner !== profile.id) continue;
        const target = nameOf(byId, scheme.target, playerName);
        if (scheme.state === 'running' || scheme.state === 'ready') {
            parts.push(
                `Scheming against ${target}: ${scheme.text} (${scheme.clock.filled}/${scheme.clock.segments}${scheme.state === 'ready' ? ', ready' : ''}).`,
            );
        } else if (scheme.state === 'exposed') {
            parts.push(`Their scheme against ${target} was exposed: ${scheme.text}.`);
        }
    }

    if (!parts.length) return null;
    return `${profile.name || profile.id} — ${parts.join(' ')}`;
}

/** Appends the tick's events to the chat log (kept to MAX_LOG lines), without their localization fields. */
export function appendLog(state: ChatState, events: readonly StateEvent[]): ChatState {
    if (events.length === 0) return state;
    const lines = events.map((e) => {
        const line: StateEvent = { turn: e.turn, kind: e.kind, text: e.text };
        if (e.character !== undefined) line.character = e.character;
        if (e.messageIndex !== undefined) line.messageIndex = e.messageIndex;
        return line;
    });
    return { ...state, log: [...(state.log ?? []), ...lines].slice(-MAX_LOG) };
}
