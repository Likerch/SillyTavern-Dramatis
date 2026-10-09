// Applies a committed turn pass to the chat state (docs/model.md §5, §8, §11, §12 «Ход»). The model found the events;
// everything here is code and dice (П5, §12):
// - relevance gate (§5.1): a character the exchange did not touch does not react;
// - events → stance events per tie (ACT_EFFECTS × intensity; key events from `keyMatched`) through the inertia rules of
//   relations.ts; a step across an author bound by an arc-worthy event is held and returned as a proposal for the
//   Inbox (applyArcProposal applies it once approved);
// - emotion → mood (mood.ts), intentions reconsidered (intentions.ts);
// - appetites (§5.7): pressure ticks with the pass's flags, gaze shifts, rivalry claims, then for appetites whose target
//   is at hand the brakes, the ceiling and the method — a line for the motive card or a scheme with a clock (the
//   hunters' budget keeps the player from becoming everyone's prey); in-scene schemes tick;
// - corruption stains for coarse acts and broken vows (corruption.ts, per the lever);
// - drift (§8): findings → corrections for the next card, stress and breaks, or a «redo» note for the feature;
// - reputation (§11): witnessed deeds move it per group and place, weaknesses become known, rumours start;
// - the next turn: attention bands and the initiative roll (§5.4–5.5) into `state.next`.
// commitTurn wraps it with the scene breaks (scene-pass.ts). Every meaningful change leaves a story log line. Pure.
import { CUE_CAP, tickAppetite } from './appetites';
import type { AppetiteEvents } from './appetites';
import { BUSINESS_FLOOR, allocateBands, playerRelevance, tacticIgnores } from './attention';
import type { BandCandidate, Gravity, PlayerRole, RelevanceInput } from './attention';
import { ceilingDetail } from './brakes';
import type { BrakeBreakdown, GroupNorm, RestraintInput } from './brakes';
import { addStain, applyRemorse, coarseProfile } from './corruption';
import type { CorruptionLever, StainAct } from './corruption';
import { correctionFor, driftFindings, addStress, stressBreak } from './drift';
import type { BreakKind, DriftFinding } from './drift';
import { hotGaze, shiftGaze } from './gaze';
import type { GazeEvents } from './gaze';
import { HUNT_WANT, huntersBudget, huntLimit } from './group-rules';
import { rollInitiative } from './initiative';
import { MAX_INTENTIONS, advanceIntention, clockFull, reconsider } from './intentions';
import type { IntentionSignal } from './intentions';
import type { Lang } from './ladders';
import {
    ACT_STEP,
    COARSE_STEP,
    MAX_STEP,
    abstainStress,
    chooseMethod,
    escalate,
    isPatient,
    opportunity,
} from './methods';
import type { MethodChoice } from './methods';
import { PLAYER_ID } from './model';
import type {
    Appetite,
    AppetiteNowState,
    AttentionBand,
    CharacterProfile,
    CharacterState,
    ChatState,
    Emotion,
    Gaze,
    Move,
    NextTurn,
    Stance,
    StateEvent,
    Tie,
    WorldTone,
} from './model';
import { applyEmotion, emotionActive, nextEmotion, relaxMood, CALM_TURNS } from './mood';
import { matchName } from './presence';
import { emptyTie } from './profile-defaults';
import { applyStanceEvents, relationContext, stepStance } from './relations';
import type { Inertia, StanceChange, StanceEvent } from './relations';
import { applyReputation, strangerStance, witnessed } from './reputation';
import type { ReputationDelta } from './reputation';
import { analyzeRivalry } from './rivalry';
import type { Pursuit } from './rivalry';
import { baseStanceOf, sceneBreak, SCENE_SKIP_HOURS } from './scene';
import type { SceneMark } from './scene';
import { runScenePass } from './scene-pass';
import { tickScheme, startScheme } from './schemes';
import { buildCorrectionLines } from './render';
import { ensureCharacterState } from './state-init';
import { TurnLog, appendLog, passThresholds } from './turn-log';
import { ACTS, TURN_PLAYER_REF, emptyTurnPass } from './turn-prompt';
import type { Act, TurnCharacterOut, TurnPass } from './turn-prompt';
import { clamp, clamp01, normalizeText, round3, uniqueId } from './util';
import type { DramatisSettings, Rng } from '../shared/contracts';

/* ------------------------------------------------------------------ levers and inputs */

export type TurnLevers = Pick<
    DramatisSettings,
    'mode' | 'inertia' | 'driftResponse' | 'huntersPerScene' | 'corruption' | 'appetiteStrength' | 'playerGravity'
>;

export const DEFAULT_LEVERS: TurnLevers = {
    mode: 'balanced',
    inertia: 'high',
    driftResponse: 'correct',
    huntersPerScene: 2,
    corruption: 'all',
    appetiteStrength: 'author',
    playerGravity: 'low',
};

const LEVER_VALUES: { [K in keyof TurnLevers]: readonly TurnLevers[K][] } = {
    mode: ['economy', 'balanced', 'cinema'],
    inertia: ['high', 'medium', 'low'],
    driftResponse: ['correct', 'stress', 'redo'],
    huntersPerScene: [0, 1, 2, 3],
    corruption: ['off', 'coarse', 'all'],
    appetiteStrength: ['muted', 'author', 'sharp'],
    playerGravity: ['low', 'medium', 'high'],
};

/** The levers of this chat: the settings, overridden by the chat's own valid values (docs/model.md §14). */
export function leversFor(settings: Partial<TurnLevers>, overrides?: Record<string, unknown>): TurnLevers {
    const out = { ...DEFAULT_LEVERS } as Record<keyof TurnLevers, unknown>;
    for (const key of Object.keys(LEVER_VALUES) as (keyof TurnLevers)[]) {
        const allowed = LEVER_VALUES[key] as readonly unknown[];
        for (const source of [settings as Record<string, unknown>, overrides ?? {}]) {
            const value = source[key];
            if (allowed.includes(value)) out[key] = value;
        }
    }
    return out as TurnLevers;
}

/** What the pass is applied to: the engine's view of the chat (structurally EngineView) plus the reply's DES data. */
export interface TurnInput {
    state: ChatState;
    /** Effective profiles: card characters + the chat's extras. */
    profiles: readonly CharacterProfile[];
    /** Present ids, scene order. */
    present: readonly string[];
    playerName: string;
    /** DES relationship label per present id from the committed reply (drift, §8). */
    desLabels?: Readonly<Record<string, string>>;
    /** Place / time / date of the committed reply (DES), for scene breaks. */
    mark?: SceneMark;
    /** Story name → profile id (the engine's resolver); profiles are matched by name otherwise. */
    resolve?: (name: string) => string | null;
}

export interface TurnContext {
    rng: Rng;
    levers: TurnLevers;
    /** The committed message (source of reasons and log lines). */
    messageIndex?: number;
    /** Turn number after this commit; default state.turn + 1. */
    turn?: number;
    /** Language of the story log (the UI). */
    uiLang?: Lang;
    /** Language of the lines meant for the motive card (corrections, brakes, break moves). */
    cardLang?: Lang;
}

/** A stance step across an author bound, held for the Inbox (§5.2.5, §9). */
export interface ArcProposal {
    character: string;
    target: string;
    dir: 1 | -1;
    from: Stance;
    to: Stance;
    /** The event's story words. */
    text: string;
    /** Reason id on the tie. */
    reason?: string;
    sourceMessage?: number;
    turn: number;
}

export type TurnNote =
    | { kind: 'redo'; character: string; findings: DriftFinding[] }
    | { kind: 'break'; character: string; break: BreakKind }
    | { kind: 'new-names'; names: string[] }
    | { kind: 'scheme-exposed'; character: string; scheme: string }
    | { kind: 'temptation'; character: string; appetite: string };

export interface TurnApplyResult {
    state: ChatState;
    proposals: ArcProposal[];
    notes: TurnNote[];
    /** Story log lines added (also appended to state.log). */
    events: StateEvent[];
}

/* ------------------------------------------------------------------ the act table */

export interface ActEffect {
    /** Stance contribution of a moderate act (intensity 3); scaled by intensity / 3. */
    delta: number;
    /** Scenes the reason lasts. */
    scenes?: number;
    /** A debt or a scar: never fades. */
    permanent?: boolean;
}

/**
 * How an act moves the target's stance toward the actor. Kindness, gifts and money are temporary reasons (§5.2.2:
 * they do not step on their own); a life saved, freedom given, a betrayal or a capture are permanent. Wanting and
 * getting what one craves never raises regard (§4.5): seduce, indulge and satisfy-appetite move nothing.
 */
export const ACT_EFFECTS: Readonly<Record<Act, ActEffect>> = {
    help: { delta: 0.5, scenes: 3 },
    save: { delta: 1, permanent: true },
    gift: { delta: 0.4, scenes: 2 },
    pay: { delta: 0.4, scenes: 2 },
    respect: { delta: 0.5, scenes: 3 },
    free: { delta: 1, permanent: true },
    flirt: { delta: 0.2, scenes: 1 },
    harm: { delta: -0.75, scenes: 4 },
    insult: { delta: -0.5, scenes: 3 },
    threat: { delta: -0.75, scenes: 3 },
    betray: { delta: -1.5, permanent: true },
    lie: { delta: -0.5, scenes: 4 },
    defy: { delta: -0.4, scenes: 2 },
    order: { delta: -0.25, scenes: 1 },
    refuse: { delta: -0.25, scenes: 2 },
    capture: { delta: -2, permanent: true },
    seduce: { delta: 0 },
    indulge: { delta: 0 },
    'satisfy-appetite': { delta: 0 },
    other: { delta: 0 },
};

/** An act seen done to someone the character holds dear counts this much. */
export const WITNESS_FACTOR = 0.5;

/** Ladder step of a coarse act done by a character (corruption stains, §5.7). */
export const ACT_LADDER: Readonly<Partial<Record<Act, number>>> = { lie: 5, betray: 5, threat: 7, harm: 8, capture: 8 };

/** Stance delta of an act at an intensity 1–5. */
export function actDelta(act: Act, intensity: number): number {
    const effect = ACT_EFFECTS[act] ?? ACT_EFFECTS.other;
    return round3((effect.delta * clamp(Math.round(Number.isFinite(intensity) ? intensity : 3), 1, 5)) / 3);
}

/** Default stance toward the player of someone with no tie, by world tone (as the motive card). */
const TONE_STANCE: Record<WorldTone, Stance> = { hostile: -1, indifferent: 0, neutral: 0, welcoming: 1 };

/** Focus budget by player gravity (§5.4, §14). */
const FOCUS_BUDGET: Record<Gravity, number> = { low: 2, medium: 2, high: 3 };

/** Turns an emotion lasts by intensity (a scene end clears it anyway). */
function emotionTurns(intensity: number): number {
    return intensity >= 4 ? 4 : intensity >= 2 ? 2 : 1;
}

/** A new aim this much better than the current one replaces it (open-minded characters switch, stubborn ones not). */
export const NEW_INTENTION_MARGIN = 0.35;

/** Stress points per unit of method stress (frustration, abstaining while preoccupied). */
export const METHOD_STRESS = 5;

/** Roles that oblige dealing with a guest or a stranger (§5.4 «роль обязывает»). */
const DUTY_RE =
    /innkeep|tavern|barkeep|bartend|merchant|trader|shopkeep|vendor|guard|sentry|servant|maid|clerk|host|трактир|корчм|хозя|торгов|купец|купч|лавоч|страж|охран|караул|слуг|служан|горнич|писар/i;

/* ------------------------------------------------------------------ resolved events */

interface ResolvedEvent {
    /** Character id, PLAYER_ID, or null (someone without a profile). */
    actor: string | null;
    target: string | null;
    act: Act;
    text: string;
    witnesses: string[];
    intensity: number;
}

/** Name → id: sheet ids, PLAYER, the player's name, the engine's resolver, then name matching. */
export function makeResolver(
    profiles: readonly CharacterProfile[],
    playerName: string,
    resolve?: (name: string) => string | null,
): (name: string) => string | null {
    const ids = new Set(profiles.map((profile) => profile.id));
    const player = normalizeText(playerName);
    return (name: string) => {
        const value = (name ?? '').trim();
        if (!value) return null;
        const bare = value.replace(/^\[(.+)\]$/, '$1');
        if (ids.has(bare)) return bare;
        const norm = normalizeText(bare);
        if (norm === TURN_PLAYER_REF.toLowerCase() || bare === PLAYER_ID || (player && norm === player))
            return PLAYER_ID;
        const viaEngine = resolve?.(bare) ?? null;
        if (viaEngine && (ids.has(viaEngine) || viaEngine === PLAYER_ID)) return viaEngine;
        return matchName(bare, profiles);
    };
}

function resolveEvents(pass: TurnPass, resolve: (name: string) => string | null): ResolvedEvent[] {
    return pass.events
        .filter((event) => (ACTS as readonly string[]).includes(event.act))
        .map((event) => ({
            actor: resolve(event.actor),
            target: resolve(event.target),
            act: event.act,
            text: event.text,
            witnesses: [...new Set(event.witnesses.map(resolve).filter((id): id is string => id !== null))],
            intensity: event.intensity,
        }));
}

/* ------------------------------------------------------------------ the work context */

interface Work {
    state: ChatState;
    turn: number;
    levers: TurnLevers;
    rng: Rng;
    byId: Map<string, CharacterProfile>;
    present: string[];
    presentSet: Set<string>;
    passById: Map<string, TurnCharacterOut>;
    events: ResolvedEvent[];
    resolve: (name: string) => string | null;
    log: TurnLog;
    cardLang: Lang;
    playerName: string;
    pass: TurnPass;
    proposals: ArcProposal[];
    notes: TurnNote[];
    messageIndex?: number;
    /** `${character}\u0000${target}` of ties that stepped up this turn. */
    rose: Set<string>;
    /** Characters whose corruption crossed 5 this turn. */
    crossed5: Set<string>;
    /** Characters intoxicated this turn (the pass's appetite flags). */
    intoxicated: Set<string>;
    /** Characters with a strong reason to keep focus beyond the budget (a ready scheme on the player, a hunt). */
    strong: Set<string>;
    nows: Record<string, AppetiteNowState[]>;
    moves: Record<string, { move: Move; target?: string; text?: string }>;
}

function pairKey(a: string, b: string): string {
    return `${a}\u0000${b}`;
}

function characterOf(w: Work, id: string): CharacterState | undefined {
    return w.state.characters[id];
}

function profileOf(w: Work, id: string): CharacterProfile | undefined {
    return w.byId.get(id);
}

/** Stance a character starts with toward someone it has no tie with yet. */
function startStance(w: Work, character: string, target: string): Stance {
    if (target !== PLAYER_ID) return 0;
    const groups = [...groupsOf(w, character), ...(w.state.place ? [w.state.place] : [])];
    return strangerStance(w.state.reputation, groups)?.stance ?? TONE_STANCE[w.state.worldTone] ?? 0;
}

/** The live tie, created (with its own base) when the character has none yet. */
function tieFor(w: Work, character: string, target: string): Tie {
    const live = characterOf(w, character)!;
    const existing = live.ties[target];
    if (existing) return existing;
    const stance = startStance(w, character, target);
    const tie: Tie = { ...emptyTie(target, stance), base: stance };
    live.ties[target] = tie;
    return tie;
}

/** Groups and places a character belongs to, for reputation: a group profile is its own group; species is a folk. */
function groupsOf(w: Work, id: string): string[] {
    const profile = profileOf(w, id);
    if (!profile) return [];
    if (profile.kind === 'group') return [profile.name];
    return profile.species ? [profile.species] : [];
}

/** Classes a target belongs to, for author bounds («к имперцам не выше нейтрального»). */
function classesOf(w: Work, target: string): string[] {
    if (target === PLAYER_ID) {
        return [...new Set(w.state.reputation.flatMap((entry) => [entry.label]).filter(Boolean))];
    }
    const profile = profileOf(w, target);
    return [profile?.role, profile?.species, ...(profile?.aliases ?? [])].filter((item): item is string => !!item);
}

function anchorsOf(w: Work, id: string): string[] {
    const profile = profileOf(w, id);
    if (!profile) return [];
    return profile.core.anchors.map((anchor) => w.resolve(anchor) ?? anchor);
}

function anchorPresent(w: Work, id: string): boolean {
    return anchorsOf(w, id).some((anchor) => w.presentSet.has(anchor));
}

function playerStance(w: Work, id: string): Stance {
    return characterOf(w, id)?.ties[PLAYER_ID]?.stance ?? TONE_STANCE[w.state.worldTone] ?? 0;
}

/** 0–1: how close the character's own business is to mattering now (the fullest intention clock). */
function urgencyOf(character: CharacterState): number {
    let best = 0;
    for (const intention of character.agenda.intentions) {
        const clock = intention.clock;
        if (clock && clock.segments > 0) best = Math.max(best, clock.filled / clock.segments);
    }
    return clamp01(best);
}

/* ------------------------------------------------------------------ 1. stances */

function isDear(tie: Tie | undefined): boolean {
    return !!tie && (tie.stance >= 2 || tie.intent === 'protect');
}

interface PendingStance {
    event: StanceEvent;
    weight: number;
    /** Arc-worthy: a key event or a full-step act. */
    arcWorthy: boolean;
}

function applyStances(w: Work): void {
    for (const id of w.present) {
        const entry = w.passById.get(id);
        const profile = profileOf(w, id);
        const live = characterOf(w, id);
        if (!entry?.relevant || !profile || !live) continue;
        const byTarget = new Map<string, PendingStance[]>();
        const push = (target: string, item: PendingStance) => {
            const list = byTarget.get(target) ?? [];
            list.push(item);
            byTarget.set(target, list);
        };
        for (const event of w.events) {
            if (!event.actor || event.actor === id || !event.target) continue;
            if (event.actor !== PLAYER_ID && !w.byId.has(event.actor)) continue;
            const base = actDelta(event.act, event.intensity);
            if (base === 0) continue;
            const effect = ACT_EFFECTS[event.act];
            let delta = 0;
            if (event.target === id) delta = base;
            else if (event.witnesses.includes(id) && isDear(live.ties[event.target]))
                delta = round3(base * WITNESS_FACTOR);
            if (delta === 0) continue;
            const stanceEvent: StanceEvent = { text: event.text, delta };
            if (effect.permanent && event.target === id) stanceEvent.permanent = true;
            else stanceEvent.scenes = effect.scenes ?? 3;
            if (w.messageIndex !== undefined) stanceEvent.sourceMessage = w.messageIndex;
            push(event.actor, { event: stanceEvent, weight: Math.abs(delta), arcWorthy: Math.abs(delta) >= 1 });
        }
        // The key the pass matched marks the weightiest event aimed at this character (§4.1 «Ключи»).
        if (entry.keyMatched) {
            let best: PendingStance | undefined;
            for (const list of byTarget.values())
                for (const item of list) if (!best || item.weight > best.weight) best = item;
            if (best) {
                best.event.key = true;
                best.arcWorthy = true;
            }
        }
        for (const [target, list] of byTarget) {
            const tie = tieFor(w, id, target);
            const ctx = relationContext({
                core: profile.core,
                targetId: target,
                targetClasses: classesOf(w, target),
                scene: w.state.scene,
                inertia: w.levers.inertia as Inertia,
                baseStance: baseStanceOf(profile, tie),
            });
            const result = applyStanceEvents(
                tie,
                list.map((item) => item.event),
                ctx,
            );
            live.ties[target] = result.tie;
            logStanceChanges(w, id, target, result.changes, list, profile);
        }
    }
}

function logStanceChanges(
    w: Work,
    id: string,
    target: string,
    changes: StanceChange[],
    pending: PendingStance[],
    profile: CharacterProfile,
): void {
    const name = w.log.name(id);
    const targetName = w.log.name(target);
    for (const change of changes) {
        const text = change.text ?? '';
        if (change.kind === 'reason-added' && change.delta) {
            w.log.add('reason', change.delta > 0 ? 'reasonUp' : 'reasonDown', { name, target: targetName, text }, id);
        } else if (change.kind === 'step' && change.from !== undefined && change.to !== undefined) {
            if (change.to > change.from) w.rose.add(pairKey(id, target));
            w.log.add(
                'stance',
                'step',
                {
                    name,
                    target: targetName,
                    from: w.log.stance(change.from, id),
                    to: w.log.stance(change.to, id),
                    text,
                },
                id,
            );
        } else if (change.kind === 'held-bound' && change.from !== undefined && !profile.core.arcLock) {
            const source = pending.find((item) => normalizeText(item.event.text) === normalizeText(text));
            if (!source?.arcWorthy) continue;
            const dir: 1 | -1 = source.event.delta > 0 ? 1 : -1;
            if (w.proposals.some((p) => p.character === id && p.target === target)) continue;
            const proposal: ArcProposal = {
                character: id,
                target,
                dir,
                from: change.from,
                to: stepStance(change.from, dir),
                text,
                turn: w.turn,
            };
            if (change.reason) proposal.reason = change.reason;
            if (w.messageIndex !== undefined) proposal.sourceMessage = w.messageIndex;
            w.proposals.push(proposal);
            w.log.add('arc', 'arc', { name, target: targetName, text }, id);
        }
    }
}

/* ------------------------------------------------------------------ 2. emotion, mood, scene */

function applyFeelings(w: Work): void {
    for (const id of w.present) {
        const live = characterOf(w, id);
        const profile = profileOf(w, id);
        if (!live || !profile) continue;
        const baseline = profile.core.baselineMood;
        const entry = w.passById.get(id);
        if (entry?.relevant && entry.emotion) {
            const target = entry.emotion.target ? (w.resolve(entry.emotion.target) ?? '') : '';
            const incoming: Emotion = {
                type: entry.emotion.type,
                intensity: entry.emotion.intensity,
                target,
                cause: entry.emotion.cause,
                until: w.turn + emotionTurns(entry.emotion.intensity),
            };
            const next = nextEmotion(live.emotion, incoming, w.turn);
            if (next === incoming) live.mood = applyEmotion(live.mood, baseline, incoming);
            live.emotion = next;
        }
        if (live.emotion && !emotionActive(live.emotion, w.turn)) delete live.emotion;
        if (!live.emotion) live.mood = relaxMood(live.mood, baseline, CALM_TURNS);
        if (entry) {
            if (entry.doing) live.scene.doing = entry.doing;
            if (entry.sceneGoal) live.scene.goal = entry.sceneGoal;
            if (entry.obstacle) live.scene.obstacle = entry.obstacle;
        }
    }
}

/* ------------------------------------------------------------------ 3. intentions */

function applyIntentions(w: Work): void {
    for (const id of w.present) {
        const live = characterOf(w, id);
        const profile = profileOf(w, id);
        const entry = w.passById.get(id);
        if (!live || !profile || !entry?.relevant) continue;
        let agenda = live.agenda;
        const before = new Map(agenda.intentions.map((intention) => [intention.id, intention.text] as const));
        const signals: Record<string, IntentionSignal> = {};
        for (const item of entry.intentions) {
            if (!before.has(item.id)) continue;
            if (item.status === 'achieved') signals[item.id] = { achieved: true };
            else if (item.status === 'impossible') signals[item.id] = { impossible: true };
            else if (item.status === 'advanced') {
                agenda = advanceIntention(agenda, item.id, 1);
                const clock = agenda.intentions.find((intention) => intention.id === item.id)?.clock;
                if (clock && clockFull(clock)) signals[item.id] = { achieved: true };
            }
        }
        const fresh = entry.newIntention;
        if (fresh) {
            if (agenda.intentions.length < MAX_INTENTIONS) {
                const intentionId = uniqueId(
                    'i-new',
                    agenda.intentions.map((intention) => intention.id),
                );
                agenda = {
                    ...agenda,
                    intentions: [
                        ...agenda.intentions,
                        { id: intentionId, text: fresh.text, nextStep: fresh.nextStep, dropIf: [] },
                    ],
                };
                w.log.add('intention', 'promoted', { name: w.log.name(id), text: fresh.text }, id);
            } else {
                const last = agenda.intentions[agenda.intentions.length - 1];
                if (last && !signals[last.id]) {
                    signals[last.id] = {
                        betterOption: { text: fresh.text, nextStep: fresh.nextStep, margin: NEW_INTENTION_MARGIN },
                    };
                }
            }
        }
        const result = reconsider(agenda, signals, profile.core.commitment);
        live.agenda = result.agenda;
        const textOf = (intentionId: string) =>
            before.get(intentionId) ??
            result.agenda.intentions.find((item) => item.id === intentionId)?.text ??
            intentionId;
        for (const change of result.changes) {
            const params = { name: w.log.name(id), text: textOf(change.intention) };
            if (change.kind === 'switched') {
                w.log.add('intention', 'switched', { ...params, other: textOf(change.replacedBy ?? '') }, id);
            } else if (change.kind !== 'trimmed') {
                w.log.add('intention', change.kind, params, id);
            }
        }
    }
}

/* ------------------------------------------------------------------ 4. appetites */

/** What a cue adds this tick, as tickAppetite counts it. */
function cueRise(state: CharacterState['appetites'][string], events: AppetiteEvents): number {
    const amplified =
        state.sensitization >= 2 ||
        events.stress === true ||
        events.intoxicated === true ||
        events.otherAppetiteHigh === true;
    return Math.min(CUE_CAP, 1 + (amplified ? 1 : 0));
}

function previousNow(w: Work, id: string, appetite: string): AppetiteNowState | undefined {
    return w.state.next?.appetites?.[id]?.find((now) => now.appetite === appetite);
}

function stain(w: Work, id: string, act: StainAct, what: string): void {
    const live = characterOf(w, id);
    const profile = profileOf(w, id);
    if (!live || !profile) return;
    const who = coarseProfile(profile.appetites, true);
    const result = addStain(live.corruption, act, { lever: w.levers.corruption as CorruptionLever, ...who });
    if (result.added <= 0) return;
    live.corruption = result.state;
    w.log.add('corruption', 'stain', { name: w.log.name(id), text: what }, id);
    if (!result.check) return;
    // A first fall forces the remorse roll now (§5.7).
    const before = live.corruption.level;
    const remorse = applyRemorse(
        live.corruption,
        {
            anchorPresent: anchorPresent(w, id),
            justificationsActive: profile.core.justifications.length,
            cultureEndorses: profile.appetites.some((item) => item.sources.includes('culture')),
        },
        w.rng,
    );
    live.corruption = remorse.state;
    if (remorse.result.success) w.log.add('corruption', 'remorseOk', { name: w.log.name(id) }, id);
    else w.log.add('corruption', 'remorseFail', { name: w.log.name(id), level: remorse.state.level }, id);
    if (remorse.state.level > before) {
        const passed = passThresholds(live.corruption, before, w.rng, w.log, id);
        live.corruption = passed.state;
        if (passed.crossed5) w.crossed5.add(id);
    }
}

function applyAppetites(w: Work): void {
    for (const id of w.present) {
        const live = characterOf(w, id);
        const profile = profileOf(w, id);
        if (!live || !profile || !profile.appetites.length) continue;
        const entry = w.passById.get(id);
        const support = anchorPresent(w, id);
        for (const appetite of profile.appetites) {
            const current = live.appetites[appetite.id];
            if (!current) continue;
            const flags = entry?.appetites.find((item) => item.id === appetite.id);
            if (flags?.intoxicated) w.intoxicated.add(id);
            const sceneCue = current.sceneCue ?? 0;
            const cue = !!flags?.cue && sceneCue < CUE_CAP;
            const otherAppetiteHigh = profile.appetites.some(
                (other) => other.id !== appetite.id && (live.appetites[other.id]?.pressure ?? 0) >= 4,
            );
            const events: AppetiteEvents = {
                cue,
                idleAfterCue: cue && !!flags?.idleAfterCue,
                stress: !!flags?.stress,
                intoxicated: !!flags?.intoxicated,
                otherAppetiteHigh,
                support,
            };
            if (flags && (flags.satisfied > 0 || flags.full)) {
                events.satisfied = { amount: Math.max(1, flags.satisfied), full: flags.full };
            }
            const tick = tickAppetite(appetite, current, events, { turn: w.turn, strength: w.levers.appetiteStrength });
            const next = { ...tick.state };
            if (cue) next.sceneCue = sceneCue + cueRise(current, events);
            live.appetites[appetite.id] = next;
            live.selfControl = clamp(live.selfControl + tick.selfControlDelta, 0, 3);
            const what = appetite.label ?? appetite.id;
            const params = { name: w.log.name(id), what };
            if (tick.notes.includes('binge')) w.log.add('appetite', 'binge', params, id);
            if (tick.notes.includes('recommit')) w.log.add('appetite', 'recommit', params, id);
            else if (tick.notes.includes('lapse')) w.log.add('appetite', 'lapse', params, id);
            if (tick.notes.includes('withdrawal')) w.log.add('appetite', 'withdrawal', params, id);
            if (tick.notes.includes('withdrawal-end')) w.log.add('appetite', 'withdrawalEnd', params, id);
            if (tick.notes.includes('sensitized')) w.log.add('appetite', 'sensitized', params, id);
            if (tick.notes.includes('lapse')) stain(w, id, { brokeVow: 'abstinent' }, what);

            // Refusals make the next attempt coarser; a success clears the escalation (§5.7 «Эскалация»).
            const previous = previousNow(w, id, appetite.id);
            if (flags?.refusedBy) {
                const target = w.resolve(flags.refusedBy);
                const tie = target ? live.ties[target] : undefined;
                if (target && tie) {
                    const tried =
                        previous?.target === target && previous.method !== undefined ? previous.method : ACT_STEP;
                    const escalation = escalate(tie.escalation, tried, 'refused', next.pressure, appetite.style);
                    live.ties[target] = escalation ? { ...tie, escalation } : withoutEscalation(tie);
                }
            }
            if (events.satisfied && previous?.target) {
                const tie = live.ties[previous.target];
                if (tie?.escalation) live.ties[previous.target] = withoutEscalation(tie);
            }
        }
    }
}

function withoutEscalation(tie: Tie): Tie {
    const next = { ...tie };
    delete next.escalation;
    return next;
}

/* ------------------------------------------------------------------ 5. coarse acts → stains */

function applyCoarseActs(w: Work): void {
    for (const event of w.events) {
        if (!event.actor || event.actor === PLAYER_ID || !event.target) continue;
        const step = ACT_LADDER[event.act];
        if (step === undefined || step < COARSE_STEP) continue;
        const live = characterOf(w, event.actor);
        if (!live) continue;
        const tie = live.ties[event.target];
        const act: StainAct = { step, stance: tie?.stance ?? 0 };
        if (tie?.gaze) act.gaze = tie.gaze;
        if (event.act === 'betray' && anchorsOf(w, event.actor).includes(event.target)) act.catalyst = true;
        stain(w, event.actor, act, event.text);
    }
}

/* ------------------------------------------------------------------ 6. gaze */

function outGroup(w: Work, id: string, target: string): boolean {
    if (target === PLAYER_ID) return true;
    const a = profileOf(w, id)?.species;
    const b = profileOf(w, target)?.species;
    return !!a && !!b && normalizeText(a) !== normalizeText(b);
}

function applyGaze(w: Work): void {
    for (const id of w.present) {
        const live = characterOf(w, id);
        if (!live) continue;
        for (const [target, tie] of Object.entries(live.ties)) {
            if (!tie.gaze) continue;
            const events: GazeEvents = { outGroup: outGroup(w, id, target) };
            if (w.crossed5.has(id)) events.corruptionCrossed = true;
            if (w.rose.has(pairKey(id, target))) events.stanceRose = true;
            const saved = w.events.some(
                (event) =>
                    event.actor === target && event.target === id && (event.act === 'save' || event.act === 'free'),
            );
            if (saved) events.agency = 'saved-life';
            if (!events.corruptionCrossed && !events.stanceRose && !events.agency) continue;
            const gaze = shiftGaze(tie.gaze, events);
            if (gaze === tie.gaze) continue;
            live.ties[target] = { ...tie, gaze };
            w.log.add('gaze', 'gaze', { name: w.log.name(id), target: w.log.name(target) }, id);
        }
    }
}

/* ------------------------------------------------------------------ 7. rivalry */

function appetiteFor(profile: CharacterProfile, tie: Tie): Appetite | undefined {
    if (tie.appetite) return profile.appetites.find((item) => item.id === tie.appetite);
    const people = profile.appetites.filter((item) => item.target.mode !== 'thing');
    return people.length === 1 ? people[0] : undefined;
}

/** Claimant guards per pursuer and target from this turn's rivalry rounds. */
function applyRivalry(w: Work): Map<string, number> {
    const pursuits: Pursuit[] = [];
    for (const id of w.present) {
        const live = characterOf(w, id);
        const profile = profileOf(w, id);
        if (!live || !profile) continue;
        for (const [target, tie] of Object.entries(live.ties)) {
            if ((tie.want ?? 0) < 1 || target === id) continue;
            if (target !== PLAYER_ID && !w.presentSet.has(target)) continue;
            const rule = w.state.rules.find((item) => item.id === appetiteFor(profile, tie)?.rule);
            const pursuit: Pursuit = { id, target, want: tie.want ?? 0, claim: tie.claim ?? 'none' };
            if (rule) {
                pursuit.exclusivity = rule.exclusivity;
                pursuit.group = rule.id;
                pursuit.groupMode = rule.groupMode;
            }
            pursuits.push(pursuit);
        }
    }
    const guards = new Map<string, number>();
    const stanceBetween = (a: string, b: string) => characterOf(w, a)?.ties[b]?.stance ?? 0;
    for (const target of new Set(pursuits.map((item) => item.target))) {
        const report = analyzeRivalry(target, pursuits, stanceBetween);
        for (const [id, claim] of Object.entries(report.claims)) {
            const live = characterOf(w, id);
            const tie = live?.ties[target];
            if (!live || !tie || (tie.claim ?? 'none') === claim) continue;
            live.ties[target] = { ...tie, claim };
            if (claim === 'claimed' || claim === 'owned') {
                w.log.add(
                    'claim',
                    claim === 'owned' ? 'owned' : 'claim',
                    { name: w.log.name(id), target: w.log.name(target) },
                    id,
                );
            }
        }
        for (const [id, guard] of Object.entries(report.guards)) guards.set(pairKey(id, target), guard);
    }
    return guards;
}

/* ------------------------------------------------------------------ 8. the scene around a target */

interface Surroundings {
    guardians: number;
    guardianNames: string[];
    witnesses: string[];
    accomplices: string[];
}

function accomplicesOf(w: Work, id: string, appetite: Appetite): string[] {
    return w.present.filter((other) => {
        if (other === id) return false;
        const profile = profileOf(w, other);
        if (!profile) return false;
        return profile.appetites.some(
            (item) =>
                (appetite.rule !== undefined && item.rule === appetite.rule) ||
                (item.kind === appetite.kind &&
                    item.sources.includes('culture') &&
                    appetite.sources.includes('culture')),
        );
    });
}

function surroundings(
    w: Work,
    id: string,
    target: string | undefined,
    appetite: Appetite,
    rivals: Map<string, number>,
): Surroundings {
    const accomplices = accomplicesOf(w, id, appetite);
    const guardianIds = target
        ? w.present.filter((other) => other !== id && other !== target && isDear(characterOf(w, other)?.ties[target]))
        : [];
    const rivalGuard = target ? (rivals.get(pairKey(id, target)) ?? 0) : 0;
    const witnesses = w.present.filter(
        (other) => other !== id && other !== target && !accomplices.includes(other) && !guardianIds.includes(other),
    );
    return {
        guardians: clamp(guardianIds.length + rivalGuard, 0, 3),
        guardianNames: guardianIds.map((other) => w.log.name(other)),
        witnesses,
        accomplices,
    };
}

function witnessesIndulge(w: Work, witnesses: string[], kind: Appetite['kind']): boolean {
    return (
        witnesses.length > 0 &&
        witnesses.every((other) => {
            const profile = profileOf(w, other);
            const live = characterOf(w, other);
            return !!profile?.appetites.some(
                (item) => item.kind === kind && (live?.appetites[item.id]?.pressure ?? item.baseline) >= 2,
            );
        })
    );
}

const BRAKE_WORDS = {
    guardians: { en: (names: string) => `${names} nearby`, ru: (names: string) => `рядом ${names}` },
    eyes: { en: 'other eyes around', ru: 'чужие глаза' },
    fear: { en: 'fear of being found out', ru: 'страх разоблачения' },
    values: { en: 'their own principles', ru: 'собственные принципы' },
    group: { en: 'what their own people would say', ru: 'что скажут свои' },
    regard: { en: (name: string) => `regard for ${name}`, ru: (name: string) => `расположение (${name})` },
    self: { en: 'self-control', ru: 'самообладание' },
} as const;

/** What holds them back now, in the card's language: the author's words first, then the brakes that held. */
function brakeWords(
    w: Work,
    appetite: Appetite,
    blocked: BrakeBreakdown | undefined,
    around: Surroundings,
    target: string | undefined,
): string[] {
    const lang = w.cardLang;
    const out = (appetite.restraints ?? [])
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 2);
    if (blocked) {
        if (blocked.guardian > 0) {
            out.push(
                around.guardianNames.length
                    ? BRAKE_WORDS.guardians[lang](around.guardianNames.join(', '))
                    : BRAKE_WORDS.eyes[lang],
            );
        }
        if (blocked.fear > 0) out.push(BRAKE_WORDS.fear[lang]);
        if (blocked.values > 0) out.push(BRAKE_WORDS.values[lang]);
        if (blocked.group > 0) out.push(BRAKE_WORDS.group[lang]);
        if (blocked.regard > 0 && target) out.push(BRAKE_WORDS.regard[lang](w.log.name(target)));
        if (blocked.selfControl > 0) out.push(BRAKE_WORDS.self[lang]);
    }
    return [...new Set(out)].slice(0, 3);
}

/** Captives, cruelty, a creature hunger and power over a body are rarely for sale: bargaining seldom works. */
const UNBOUGHT_KINDS: readonly Appetite['kind'][] = ['plunder', 'cruelty', 'hunger', 'dominance'];

/** How a character without a gaze on record sees a target of this kind of appetite. */
const DEFAULT_GAZE: Partial<Record<Appetite['kind'], Gaze>> = {
    plunder: 'property',
    hunger: 'prey',
    cruelty: 'prey',
    flesh: 'prize',
    dominance: 'property',
    adoration: 'instrument',
};

/** What a character does about a craving for a thing (drink, a substance), by method step, in the card's language. */
const THING_METHODS: Record<Lang, readonly string[]> = {
    en: [
        'keeps away from it',
        'settles for something else',
        'waits for a chance at it',
        'asks for it',
        'pays or trades for it',
        'gets it by a lie',
        'gets it on the sly',
        'takes it by threats',
        'grabs it',
    ],
    ru: [
        'держится подальше',
        'обходится заменой',
        'ждёт случая',
        'просит',
        'покупает или выменивает',
        'добывает враньём',
        'добывает тайком',
        'отбирает угрозами',
        'хватает силой',
    ],
};

const SCHEME_VERBS: Record<number, string> = {
    5: 'trick',
    6: 'wear down and cut off',
    7: 'force the hand of',
    8: 'seize',
};

/** Short English plan of a scheme («plans to seize Мира»). */
export function schemeText(step: number, targetName: string): string {
    return `plans to ${SCHEME_VERBS[clamp(Math.round(step), 5, MAX_STEP)] ?? 'trap'} ${targetName}`;
}

/* ------------------------------------------------------------------ 9. schemes in the scene */

function tickSchemes(w: Work, rivals: Map<string, number>): void {
    w.state.schemes = w.state.schemes.map((scheme) => {
        if (scheme.state !== 'running' || scheme.startedTurn >= w.turn) return scheme;
        if (!w.presentSet.has(scheme.owner)) return scheme;
        if (scheme.target !== PLAYER_ID && !w.presentSet.has(scheme.target)) return scheme;
        const profile = profileOf(w, scheme.owner);
        const appetite = profile?.appetites.find((item) => item.id === scheme.appetite) ?? profile?.appetites[0];
        const guards = appetite ? surroundings(w, scheme.owner, scheme.target, appetite, rivals).guardians : 0;
        const tick = tickScheme(
            scheme,
            {
                opportunity: guards < 2,
                accomplices: scheme.accomplices.filter((id) => w.presentSet.has(id)).length,
                guarded: guards >= 2,
            },
            w.rng,
        );
        const name = w.log.name(scheme.owner);
        if (tick.notes.includes('ready')) {
            w.log.add('scheme', 'schemeReady', { name, text: scheme.text }, scheme.owner);
            if (scheme.target === PLAYER_ID) w.strong.add(scheme.owner);
        }
        if (tick.notes.includes('exposed')) {
            w.log.add('scheme', 'schemeExposed', { name, text: scheme.text }, scheme.owner);
            w.notes.push({ kind: 'scheme-exposed', character: scheme.owner, scheme: scheme.id });
            exposeTo(w, scheme.target, scheme.owner, scheme.text);
        }
        return tick.scheme;
    });
}

/** The target of an exposed scheme learns of it: a lasting reason against the schemer. */
function exposeTo(w: Work, target: string, owner: string, text: string): void {
    const live = characterOf(w, target);
    const profile = profileOf(w, target);
    if (!live || !profile) return;
    const tie = tieFor(w, target, owner);
    const ctx = relationContext({
        core: profile.core,
        targetId: owner,
        targetClasses: classesOf(w, owner),
        scene: w.state.scene,
        inertia: w.levers.inertia as Inertia,
        baseStance: baseStanceOf(profile, tie),
    });
    const result = applyStanceEvents(tie, [{ text: `uncovered a scheme: ${text}`, delta: -1, permanent: true }], ctx);
    live.ties[owner] = result.tie;
}

/* ------------------------------------------------------------------ 10. methods */

interface Pursued {
    id: string;
    appetite: Appetite;
    /** Character id or PLAYER_ID; undefined for things. */
    target?: string;
    want: number;
}

/** The target an appetite aims at now: the most wanted one at hand (things have none). */
function pursuedTarget(w: Work, id: string, appetite: Appetite): { target?: string; want: number } | null {
    const live = characterOf(w, id)!;
    const profile = profileOf(w, id)!;
    if (appetite.target.mode === 'thing') return { want: live.appetites[appetite.id]?.pressure ?? 0 };
    const ties = Object.entries(live.ties)
        .filter(
            ([target, tie]) =>
                target !== id && (tie.want ?? 0) >= HUNT_WANT && appetiteFor(profile, tie)?.id === appetite.id,
        )
        .filter(([target]) => target === PLAYER_ID || w.presentSet.has(target))
        .sort((a, b) => (b[1].want ?? 0) - (a[1].want ?? 0));
    const first = ties[0];
    return first ? { target: first[0], want: first[1].want ?? 0 } : null;
}

function activeScheme(w: Work, id: string, appetite: string, target: string | undefined) {
    return w.state.schemes.find(
        (scheme) =>
            scheme.owner === id &&
            (scheme.appetite === appetite || !scheme.appetite) &&
            (target === undefined || scheme.target === target) &&
            (scheme.state === 'running' || scheme.state === 'ready'),
    );
}

function addNow(w: Work, id: string, now: AppetiteNowState): void {
    (w.nows[id] ??= []).push(now);
}

/** Chooses the method for one appetite toward one target (§5.7 «Как выбирается способ»). */
function decide(w: Work, pursued: Pursued, rivals: Map<string, number>): void {
    const { id, appetite, target } = pursued;
    const live = characterOf(w, id)!;
    const profile = profileOf(w, id)!;
    const state = live.appetites[appetite.id]!;
    const tie = target ? live.ties[target] : undefined;
    const stance = tie?.stance ?? 0;
    const around = surroundings(w, id, target, appetite, rivals);
    const groupNorm: GroupNorm = appetite.sources.includes('culture') ? 'endorse' : 'neutral';
    const gaze = target
        ? hotGaze(tie?.gaze ?? DEFAULT_GAZE[appetite.kind] ?? 'instrument', state.pressure, stance)
        : undefined;
    const restraint: RestraintInput = {
        core: profile.core,
        appetite,
        pressure: state.pressure,
        withdrawal: state.withdrawal,
        intoxicated: w.intoxicated.has(id),
        selfControl: live.selfControl,
        stance,
        outGroup: target ? outGroup(w, id, target) : false,
        justifications: profile.core.justifications,
        fear: clamp((around.witnesses.length > 0 ? 1 : 0) + (appetite.visibility !== 'open' ? 1 : 0), 0, 3),
        guardians: around.guardians,
        witnesses: clamp(around.witnesses.length, 0, 3),
        witnessesIndulge: witnessesIndulge(w, around.witnesses, appetite.kind),
        groupNorm,
        corruption: live.corruption.level,
    };
    if (gaze) restraint.gaze = gaze;
    const detail = ceilingDetail(restraint);
    const cueNow = w.passById.get(id)?.appetites.some((item) => item.id === appetite.id && item.cue) ?? false;
    const chance = target
        ? opportunity({
              value: pursued.want,
              inertia: target === PLAYER_ID ? 2 : profileOf(w, target)?.kind === 'group' ? 3 : 1,
              visible: true,
              access: clamp(0.9 - 0.1 * around.witnesses.length, 0.3, 0.9),
              guardians: around.guardians,
              capability: 1 + (profile.core.dark?.schemer ? 1 : 0),
              accomplices: around.accomplices.length,
              escape: around.witnesses.length < 2,
          })
        : opportunity({
              value: state.pressure,
              inertia: 0,
              visible: cueNow,
              access: cueNow ? 0.8 : 0.3,
              guardians: 0,
              capability: 1,
              escape: true,
          });
    const receptive =
        target && target !== PLAYER_ID ? clamp01(0.5 + 0.15 * (characterOf(w, target)?.ties[id]?.stance ?? 0)) : 0.5;
    const alternatives = Object.entries(live.ties).some(
        ([other, item]) =>
            other !== target && (item.want ?? 0) >= HUNT_WANT && appetiteFor(profile, item)?.id === appetite.id,
    );
    const choice: MethodChoice = chooseMethod(
        {
            opportunity: chance,
            receptive,
            means: UNBOUGHT_KINDS.includes(appetite.kind) ? 0.2 : 0.5,
            pressure: state.pressure,
            ceiling: detail.step,
            style: appetite.style,
            withdrawal: state.withdrawal,
            patient: isPatient(profile.core),
            minStep: tie?.escalation?.step,
            substitute: alternatives || appetite.satisfiers.length > 1,
        },
        w.rng,
    );
    if (choice.reason === 'gate') return;
    const brakes = brakeWords(w, appetite, detail.blocked, around, target);
    const now: AppetiteNowState = { appetite: appetite.id, method: choice.step };
    if (target) now.target = target;
    if (brakes.length) now.brakes = brakes;

    if (choice.mode === 'scheme' && target) {
        if (!activeScheme(w, id, appetite.id, target)) {
            const text = schemeText(choice.step, w.log.name(target));
            const scheme = startScheme({
                id: uniqueId(
                    `sc-${id}`,
                    w.state.schemes.map((item) => item.id),
                ),
                owner: id,
                target,
                appetite: appetite.id,
                method: choice.step,
                text,
                inertia: target === PLAYER_ID ? 2 : 1,
                guardians: around.guardians,
                accomplices: around.accomplices,
                turn: w.turn,
            });
            w.state.schemes = [...w.state.schemes, scheme];
            w.log.add('scheme', 'schemeStarted', { name: w.log.name(id), text }, id);
        }
    } else if (choice.mode === 'scheme') {
        now.method = 2;
    }
    if (!target) now.methodText = THING_METHODS[w.cardLang][now.method ?? 2] ?? '';
    if (choice.mode === 'frustrated' || (choice.step === 0 && abstainStress(state.pressure) > 0)) {
        const units = (choice.stress ?? 0) + (choice.step === 0 ? abstainStress(state.pressure) : 0);
        live.stress = clamp(live.stress + METHOD_STRESS * Math.max(1, units), 0, 100);
        live.selfControl = clamp(live.selfControl - 1, 0, 3);
        if (choice.temptation) {
            w.log.add('temptation', 'temptation', { name: w.log.name(id), what: appetite.label ?? appetite.id }, id);
            w.notes.push({ kind: 'temptation', character: id, appetite: appetite.id });
        }
    }
    if (target === PLAYER_ID && choice.mode === 'now' && choice.step >= 6) w.strong.add(id);
    addNow(w, id, now);
}

function planAppetites(w: Work, rivals: Map<string, number>): void {
    const towardPlayer: Pursued[] = [];
    for (const id of w.present) {
        const live = characterOf(w, id);
        const profile = profileOf(w, id);
        if (!live || !profile) continue;
        for (const appetite of profile.appetites) {
            const state = live.appetites[appetite.id];
            if (!state || (state.pressure < 2 && !state.withdrawal)) continue;
            const pursued = pursuedTarget(w, id, appetite);
            if (!pursued) continue;
            const scheme = activeScheme(w, id, appetite.id, pursued.target);
            if (scheme) {
                const now: AppetiteNowState = { appetite: appetite.id, target: scheme.target, method: scheme.method };
                if (scheme.state === 'ready') now.methodText = scheme.text;
                addNow(w, id, now);
                continue;
            }
            const item: Pursued = { id, appetite, want: pursued.want };
            if (pursued.target) item.target = pursued.target;
            if (pursued.target === PLAYER_ID) towardPlayer.push(item);
            else decide(w, item, rivals);
        }
    }
    if (!towardPlayer.length) return;

    // The hunters' budget (§5.7 «Против перекосов»): the keenest per character; last turn's hunters keep their slot.
    const best = new Map<string, Pursued>();
    for (const item of towardPlayer) {
        const other = best.get(item.id);
        if (!other || item.want > other.want) best.set(item.id, item);
    }
    const pressureOf = (item: Pursued) => characterOf(w, item.id)?.appetites[item.appetite.id]?.pressure ?? 0;
    const options = {
        perScene: w.levers.huntersPerScene,
        ruleTargetsPlayer: w.state.rules.some((rule) => rule.target.mode === 'player'),
    };
    const limit = huntLimit(options);
    const previous = [...best.keys()].filter((id) =>
        (w.state.next?.appetites?.[id] ?? []).some((now) => now.target === PLAYER_ID && (now.method ?? 0) >= ACT_STEP),
    );
    const hunters = previous.slice(0, limit);
    const rest = [...best.values()].filter((item) => !hunters.includes(item.id));
    if (hunters.length < limit && rest.length) {
        const budget = huntersBudget(
            rest.map((item) => ({ id: item.id, want: item.want, pressure: pressureOf(item) })),
            { ...options, perScene: (limit - hunters.length) as TurnLevers['huntersPerScene'] },
            w.rng,
        );
        hunters.push(...budget.hunters);
    }
    for (const item of towardPlayer) {
        if (hunters.includes(item.id) && best.get(item.id) === item) {
            decide(w, item, rivals);
            continue;
        }
        // No slot: another target at hand, or they bide their time.
        const live = characterOf(w, item.id)!;
        const profile = profileOf(w, item.id)!;
        const other = Object.entries(live.ties)
            .filter(
                ([target, tie]) =>
                    target !== PLAYER_ID &&
                    target !== item.id &&
                    w.presentSet.has(target) &&
                    (tie.want ?? 0) >= HUNT_WANT &&
                    appetiteFor(profile, tie)?.id === item.appetite.id,
            )
            .sort((a, b) => (b[1].want ?? 0) - (a[1].want ?? 0))[0];
        if (other)
            decide(w, { id: item.id, appetite: item.appetite, target: other[0], want: other[1].want ?? 0 }, rivals);
        else addNow(w, item.id, { appetite: item.appetite.id, method: 2 });
    }
}

/* ------------------------------------------------------------------ 11. drift */

/** Positive acts toward the character (or someone dear to it) by the player this turn: a cause, not drift (§8). */
function hasCause(events: readonly ResolvedEvent[], id: string): boolean {
    return events.some(
        (event) => event.actor === PLAYER_ID && event.target === id && actDelta(event.act, event.intensity) > 0,
    );
}

function findingsFor(
    id: string,
    stance: Stance,
    entry: TurnCharacterOut | undefined,
    label: string | undefined,
    cause: boolean,
): DriftFinding[] {
    const findings = driftFindings({
        character: id,
        stance,
        desLabel: label,
        warmthWithoutCause: entry?.drift.warmthWithoutCause,
        appetiteBecameLove: entry?.drift.appetiteBecameLove,
        dependenceVanished: entry?.drift.dependenceVanished,
        actedAgainstValues: entry?.drift.actedAgainstValues,
    });
    if (!cause) return findings;
    return findings.filter(
        (finding) =>
            finding.kind !== 'warmth' &&
            finding.kind !== 'appetite-love' &&
            !(finding.kind === 'label-mismatch' && finding.direction === 'warmer'),
    );
}

/**
 * Drift findings for every present character after a reply (DES label against the engine's stance toward the player
 * and the pass's flags); warmth the player earned with a positive act this turn does not count. The feature uses it on
 * the draft to offer «Переделать» before the turn is committed.
 */
export function detectDrift(input: TurnInput, pass: TurnPass): DriftFinding[] {
    const resolve = makeResolver(input.profiles, input.playerName, input.resolve);
    const events = resolveEvents(pass, resolve);
    const entries = new Map(pass.characters.map((entry) => [entry.id, entry] as const));
    const profiles = new Set(input.profiles.map((profile) => profile.id));
    const out: DriftFinding[] = [];
    for (const id of new Set(input.present)) {
        if (!profiles.has(id)) continue;
        const stance =
            input.state.characters[id]?.ties[PLAYER_ID]?.stance ??
            input.profiles.find((profile) => profile.id === id)?.ties.find((tie) => tie.target === PLAYER_ID)?.stance ??
            TONE_STANCE[input.state.worldTone] ??
            0;
        out.push(...findingsFor(id, stance, entries.get(id), input.desLabels?.[id], hasCause(events, id)));
    }
    return out;
}

const DRIFT_WORDS: Record<DriftFinding['kind'], { en: string; ru: string }> = {
    'label-mismatch': { en: 'relationship label', ru: 'ярлык отношения' },
    warmth: { en: 'warmth without cause', ru: 'тепло без причины' },
    'appetite-love': { en: 'craving turned tender', ru: 'влечение стало нежностью' },
    'dependence-vanished': { en: 'craving vanished', ru: 'зависимость пропала' },
    'against-self': { en: 'against own values', ru: 'против себя' },
};

const BREAK_MOVES: Record<BreakKind, { move: Move; en: string; ru: string; toPlayer?: boolean }> = {
    withdraw: {
        move: 'watch',
        en: 'withdraws into silence, will not engage',
        ru: 'замыкается и молчит, ни во что не вступает',
    },
    leave: { move: 'leave', en: 'walks out to get away from it all', ru: 'уходит, чтобы не быть здесь' },
    'lash-out': { move: 'obstruct', en: 'lashes out', ru: 'срывается и бьёт словом', toPlayer: true },
};

function applyDrift(w: Work, input: TurnInput): Record<string, string[]> {
    const all: DriftFinding[] = [];
    for (const id of w.present) {
        if (!profileOf(w, id)) continue;
        const findings = findingsFor(
            id,
            playerStance(w, id),
            w.passById.get(id),
            input.desLabels?.[id],
            hasCause(w.events, id),
        );
        if (!findings.length) continue;
        const what = [...new Set(findings.map((finding) => DRIFT_WORDS[finding.kind][w.log.lang]))].join(', ');
        w.log.add('drift', 'driftFound', { name: w.log.name(id), what }, id);
        all.push(...findings);
        if (w.levers.driftResponse === 'stress') {
            const live = characterOf(w, id)!;
            const stressed = addStress(live, findings);
            const broke = stressBreak(stressed.stress, profileOf(w, id)?.core.wound?.coping);
            live.stress = broke ? broke.stress : stressed.stress;
            if (broke) {
                const spec = BREAK_MOVES[broke.kind];
                const move: { move: Move; target?: string; text?: string } = {
                    move: spec.move,
                    text: spec[w.cardLang],
                };
                if (spec.toPlayer) move.target = PLAYER_ID;
                w.moves[id] = move;
                w.log.add('break', 'break', { name: w.log.name(id), what: spec[w.log.lang] }, id);
                w.notes.push({ kind: 'break', character: id, break: broke.kind });
            }
        } else if (w.levers.driftResponse === 'redo') {
            w.notes.push({ kind: 'redo', character: id, findings });
        }
    }
    if (!all.length || w.levers.driftResponse === 'stress') return {};
    return buildCorrectionLines(correctionFor(all), {
        profiles: [...w.byId.values()],
        state: w.state,
        playerName: w.playerName,
        lang: w.cardLang,
    });
}

/* ------------------------------------------------------------------ 12. reputation */

function applyReputationStep(w: Work): void {
    const deltas: ReputationDelta[] = [];
    const known = (ids: Iterable<string>) => {
        for (const id of ids) {
            const live = characterOf(w, id);
            if (live) live.knowsPlayer = true;
        }
    };
    const groups = (id: string) => groupsOf(w, id);
    for (const event of w.events) {
        if (event.actor !== PLAYER_ID) continue;
        const onlookers = event.witnesses.filter((id) => id !== PLAYER_ID && id !== event.target && w.byId.has(id));
        known([...onlookers, ...(event.target ? [event.target] : [])]);
        const delta = actDelta(event.act, event.intensity);
        if (!onlookers.length || delta === 0) continue;
        const place = w.state.place;
        deltas.push(...witnessed({ text: event.text, delta, ...(place ? { place } : {}) }, onlookers, groups));
    }
    for (const id of w.present) if (w.passById.get(id)?.addressedByPlayer) known([id]);

    for (const deed of w.pass.playerDeeds) {
        const ids = [...new Set(deed.witnesses.map(w.resolve).filter((id): id is string => !!id && w.byId.has(id)))];
        known(ids);
        if (!ids.length) continue;
        const place = deed.place || w.state.place || '';
        if (deed.weakness) {
            deltas.push(
                ...witnessed(
                    { text: deed.text, delta: 0, weakness: deed.weakness, ...(place ? { place } : {}) },
                    ids,
                    groups,
                ),
            );
        }
        const reached = [...new Set([...ids.flatMap(groups), ...(place ? [place] : [])])];
        const existing = w.state.rumours.find(
            (rumour) => rumour.about === PLAYER_ID && normalizeText(rumour.text) === normalizeText(deed.text),
        );
        if (existing) {
            existing.carriers = [...new Set([...existing.carriers, ...ids])];
            existing.reached = [...new Set([...existing.reached, ...reached])];
            continue;
        }
        w.state.rumours = [
            ...w.state.rumours,
            {
                id: uniqueId(
                    `rm${w.turn}`,
                    w.state.rumours.map((rumour) => rumour.id),
                ),
                text: deed.text,
                about: PLAYER_ID,
                origin: place || reached[0] || '',
                carriers: ids,
                reached,
                turn: w.turn,
            },
        ];
        w.log.add('rumour', 'rumour', { text: deed.text });
    }
    if (!deltas.length) return;
    const result = applyReputation(w.state.reputation, deltas);
    w.state.reputation = result.reputation;
    for (const change of result.changes) {
        if (change.kind === 'step' && change.from !== undefined && change.to !== undefined) {
            w.log.add('reputation', 'repStep', {
                among: change.among,
                from: w.log.stance(change.from, ''),
                to: w.log.stance(change.to, ''),
                text: change.text ?? '',
            });
        } else if (change.kind === 'label') {
            w.log.add('reputation', 'repLabel', { among: change.among, text: change.text ?? '' });
        } else if (change.kind === 'weakness') {
            w.log.add('reputation', 'repWeakness', { among: change.among, text: change.text ?? '' });
        }
    }
}

/* ------------------------------------------------------------------ 13. the next turn */

function relevanceInput(w: Work, id: string): RelevanceInput {
    const live = characterOf(w, id)!;
    const profile = profileOf(w, id)!;
    const entry = w.passById.get(id);
    const tie = live.ties[PLAYER_ID];
    const appetite = tie ? appetiteFor(profile, tie) : undefined;
    return {
        roleInIntention: (entry?.playerRole ?? 'none') as PlayerRole,
        stance: tie?.stance ?? TONE_STANCE[w.state.worldTone] ?? 0,
        openDebts: tie?.debts.length ?? 0,
        grudges: tie?.reasons.filter((reason) => reason.delta < 0 && reason.scenesLeft === null).length ?? 0,
        needPull: 0.25 * Math.max(0, profile.core.attachment?.anxiety ?? 0),
        want: tie?.want ?? 0,
        pressure: appetite ? (live.appetites[appetite.id]?.pressure ?? 0) : 0,
        addressed: entry?.addressedByPlayer === true,
        near: true,
        roleDuty: DUTY_RE.test(profile.role ?? ''),
        agendaUrgency: urgencyOf(live),
        proactivity: profile.core.proactivity,
        ignores: tacticIgnores(profile.core.tactics),
    };
}

function planNext(w: Work): { bands: Record<string, AttentionBand>; moves: NextTurn['moves'] } {
    const gravity = w.levers.playerGravity as Gravity;
    const ids = w.present.filter((id) => characterOf(w, id) && profileOf(w, id));
    const candidates: BandCandidate[] = ids.map((id) => {
        const candidate: BandCandidate = { id, score: playerRelevance(relevanceInput(w, id)) };
        if (w.strong.has(id)) candidate.strong = true;
        return candidate;
    });
    const bands: Record<string, AttentionBand> = {};
    for (const allocation of allocateBands(candidates, { focusBudget: FOCUS_BUDGET[gravity], gravity })) {
        // A strong reason keeps a character at least «по делу» (a ready scheme, a hunt in progress).
        const band = w.strong.has(allocation.id) && allocation.score < BUSINESS_FLOOR ? 'business' : allocation.band;
        bands[allocation.id] = band;
        characterOf(w, allocation.id)!.scene.attention = band;
    }
    const max = w.levers.mode === 'economy' ? 1 : w.levers.mode === 'cinema' ? 2 : ids.length >= 4 ? 2 : 1;
    const picks = rollInitiative(
        ids
            .filter((id) => !w.moves[id])
            .map((id) => {
                const live = characterOf(w, id)!;
                const profile = profileOf(w, id)!;
                return {
                    id,
                    proactivity: profile.core.proactivity,
                    urgency: urgencyOf(live),
                    pressure: Math.max(0, ...Object.values(live.appetites).map((item) => item.pressure)),
                    mood: live.mood.octant,
                    band: bands[id] ?? 'background',
                    ties: Object.values(live.ties).map((tie) => ({
                        target: tie.target,
                        intent: tie.intent,
                        stance: tie.stance,
                        ...(tie.want !== undefined ? { want: tie.want } : {}),
                    })),
                };
            }),
        w.rng,
        { max, present: [...ids] },
    );
    for (const pick of picks) {
        const move: { move: Move; target?: string } = { move: pick.move };
        if (pick.target) move.target = pick.target;
        w.moves[pick.id] = move;
    }
    for (const id of ids) {
        const scene = characterOf(w, id)!.scene;
        const move = w.moves[id];
        delete scene.move;
        delete scene.moveTarget;
        delete scene.moveText;
        if (!move) continue;
        scene.move = move.move;
        if (move.target) scene.moveTarget = move.target;
        if (move.text) scene.moveText = move.text;
    }
    return { bands, moves: { ...w.moves } };
}

/* ------------------------------------------------------------------ the pass */

/** Applies a turn pass to the state of a committed turn (see the file header). Returns a new state. */
export function applyTurnPass(input: TurnInput, pass: TurnPass | null, ctx: TurnContext): TurnApplyResult {
    const turnPass = pass ?? emptyTurnPass();
    const state: ChatState = structuredClone(input.state);
    const turn = ctx.turn ?? state.turn + 1;
    const byId = new Map<string, CharacterProfile>();
    for (const profile of [...input.profiles, ...state.extras])
        if (!byId.has(profile.id)) byId.set(profile.id, profile);
    const present = [...new Set(input.present)].filter((id) => byId.has(id));
    for (const id of present) ensureCharacterState(state, byId.get(id)!);
    const resolve = makeResolver([...byId.values()], input.playerName, input.resolve);
    const passById = new Map<string, TurnCharacterOut>();
    for (const entry of turnPass.characters)
        if (byId.has(entry.id) && !passById.has(entry.id)) passById.set(entry.id, entry);
    const w: Work = {
        state,
        turn,
        levers: ctx.levers,
        rng: ctx.rng,
        byId,
        present,
        presentSet: new Set(present),
        passById,
        events: resolveEvents(turnPass, resolve),
        resolve,
        log: new TurnLog(ctx.uiLang ?? 'en', turn, byId, input.playerName, ctx.messageIndex),
        cardLang: ctx.cardLang ?? 'en',
        playerName: input.playerName,
        proposals: [],
        notes: [],
        rose: new Set(),
        crossed5: new Set(),
        intoxicated: new Set(),
        strong: new Set(),
        nows: {},
        moves: {},
        pass: turnPass,
    };
    if (ctx.messageIndex !== undefined) w.messageIndex = ctx.messageIndex;

    applyStances(w);
    applyFeelings(w);
    applyIntentions(w);
    applyAppetites(w);
    applyCoarseActs(w);
    applyGaze(w);
    const rivals = applyRivalry(w);
    tickSchemes(w, rivals);
    planAppetites(w, rivals);
    const corrections = applyDrift(w, input);
    applyReputationStep(w);
    const { bands, moves } = planNext(w);

    for (const id of present) characterOf(w, id)!.lastSeenTurn = turn;
    state.turn = turn;
    const next: NextTurn = { turn, bands };
    if (moves && Object.keys(moves).length) next.moves = moves;
    if (Object.keys(w.nows).length) next.appetites = w.nows;
    if (Object.keys(corrections).length) next.corrections = corrections;
    state.next = next;
    if (turnPass.newNames.length) w.notes.push({ kind: 'new-names', names: [...turnPass.newNames] });
    appendLog(state, w.log.events);
    return { state, proposals: w.proposals, notes: w.notes, events: w.log.events };
}

/* ------------------------------------------------------------------ commit with scene breaks */

export interface CommitResult extends TurnApplyResult {
    /** The scene broke this turn (before or after the reply's events). */
    sceneBreak: 'before' | 'after' | null;
    chapterEnd: boolean;
}

/**
 * A committed turn: a scene break the reply opened with (DES place/date/time changed, or the pass saw a time skip)
 * ends the old scene first; then the pass is applied; a scene the reply closed (`sceneEnded`) ends after it. The
 * reply's place, time and date become the scene's.
 */
export function commitTurn(input: TurnInput, pass: TurnPass | null, ctx: TurnContext): CommitResult {
    const turnPass = pass ?? emptyTurnPass();
    const prev: SceneMark = {};
    if (input.state.place) prev.place = input.state.place;
    if (input.state.time) prev.time = input.state.time;
    if (input.state.date) prev.date = input.state.date;
    const mark = input.mark ?? {};
    const desBreak = sceneBreak(prev, mark);
    const skip = turnPass.timeSkipHours;
    const turn = ctx.turn ?? input.state.turn + 1;
    const levers = ctx.levers;
    const sceneCtx = {
        rng: ctx.rng,
        levers: { appetiteStrength: levers.appetiteStrength, corruption: levers.corruption },
        turn,
        ...(ctx.messageIndex !== undefined ? { messageIndex: ctx.messageIndex } : {}),
        ...(ctx.uiLang ? { uiLang: ctx.uiLang } : {}),
    };
    let state = input.state;
    let when: CommitResult['sceneBreak'] = null;
    let chapterEnd = false;
    const sceneEvents: StateEvent[] = [];
    if (desBreak || skip >= SCENE_SKIP_HOURS) {
        const hours = desBreak?.hours ?? (skip > 0 ? skip : undefined);
        const scene = runScenePass(
            { state, profiles: input.profiles, present: input.present, playerName: input.playerName },
            { ...sceneCtx, reason: desBreak?.reason ?? 'time', ...(hours !== undefined ? { hours } : {}) },
        );
        state = scene.state;
        sceneEvents.push(...scene.events);
        chapterEnd = scene.chapterEnd;
        when = 'before';
    }
    const applied = applyTurnPass({ ...input, state }, turnPass, { ...ctx, turn });
    state = applied.state;
    if (!when && turnPass.sceneEnded) {
        const scene = runScenePass(
            { state, profiles: input.profiles, present: input.present, playerName: input.playerName },
            { ...sceneCtx, reason: 'ended', ...(skip > 0 ? { hours: skip } : {}) },
        );
        state = scene.state;
        sceneEvents.push(...scene.events);
        chapterEnd = scene.chapterEnd;
        when = 'after';
    }
    if (mark.place?.trim()) state.place = mark.place.trim();
    if (mark.time?.trim()) state.time = mark.time.trim();
    if (mark.date?.trim()) state.date = mark.date.trim();
    return { ...applied, state, events: [...sceneEvents, ...applied.events], sceneBreak: when, chapterEnd };
}

/* ------------------------------------------------------------------ arc proposals */

/** Whether an arc proposal still fits the state: the tie is where it was when the step was held. */
export function arcProposalValid(state: ChatState, proposal: ArcProposal): boolean {
    const tie = state.characters[proposal.character]?.ties[proposal.target];
    return !!tie && tie.stance === proposal.from && proposal.to === stepStance(proposal.from, proposal.dir);
}

/** Parses an Inbox payload back into an arc proposal (null when it is not one). */
export function parseArcProposal(payload: unknown): ArcProposal | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const raw = payload as Record<string, unknown>;
    const stance = (value: unknown): Stance | null =>
        typeof value === 'number' && Number.isInteger(value) && value >= -3 && value <= 3 ? (value as Stance) : null;
    const from = stance(raw.from);
    const to = stance(raw.to);
    if (typeof raw.character !== 'string' || typeof raw.target !== 'string' || from === null || to === null)
        return null;
    if (raw.dir !== 1 && raw.dir !== -1) return null;
    const proposal: ArcProposal = {
        character: raw.character,
        target: raw.target,
        dir: raw.dir,
        from,
        to,
        text: typeof raw.text === 'string' ? raw.text : '',
        turn: typeof raw.turn === 'number' ? raw.turn : 0,
    };
    if (typeof raw.reason === 'string') proposal.reason = raw.reason;
    if (typeof raw.sourceMessage === 'number') proposal.sourceMessage = raw.sourceMessage;
    return proposal;
}

/**
 * The approved arc event crosses the author's bound (§5.2.5, §9): the tie steps once in its direction. The event's
 * reason was recorded when the turn was applied, so it is not added again; pending progress toward the step is spent.
 * Unchanged state (and applied: false) when the proposal no longer fits.
 */
export function applyArcProposal(
    state: ChatState,
    proposal: ArcProposal,
    options: { profiles?: readonly CharacterProfile[]; playerName?: string; uiLang?: Lang } = {},
): { state: ChatState; applied: boolean; events: StateEvent[] } {
    if (!arcProposalValid(state, proposal)) return { state, applied: false, events: [] };
    const next: ChatState = structuredClone(state);
    const live = next.characters[proposal.character]!;
    const tie = { ...live.ties[proposal.target]!, stance: proposal.to };
    delete tie.progress;
    tie.moved = { scene: next.scene, delta: (tie.moved?.scene === next.scene ? tie.moved.delta : 0) + proposal.dir };
    live.ties[proposal.target] = tie;
    const byId = new Map((options.profiles ?? []).map((profile) => [profile.id, profile] as const));
    const log = new TurnLog(options.uiLang ?? 'en', next.turn, byId, options.playerName ?? '', proposal.sourceMessage);
    log.add(
        'arc',
        'arcApplied',
        {
            name: log.name(proposal.character),
            target: log.name(proposal.target),
            from: log.stance(proposal.from, proposal.character),
            to: log.stance(proposal.to, proposal.character),
            text: proposal.text,
        },
        proposal.character,
    );
    appendLog(next, log.events);
    return { state: next, applied: true, events: log.events };
}
