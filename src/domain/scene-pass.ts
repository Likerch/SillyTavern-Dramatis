// The scene pass without AI (docs/model.md §5.2, §5.7, §12 «Сцена»): what happens when a scene breaks — DES changed
// the place, time skipped, the date changed, or the turn pass saw the scene end. Every tie ticks (temporary reasons
// expire, stances drift home), moods relax, emotions clear (scene.endScene); appetites live through the time that
// passed (hunger and withdrawal grow, unfed cravings cool); a long skip or a new day ends a chapter — remorse can wash
// corruption stains away or cost a level, slow recovery, self-control restored; focus characters take up their next
// goal (the sequel step: intentions promote). The LLM scene pass (dilemma → decision) is a later stage. Pure.
import { tickAppetite } from './appetites';
import type { AppetiteStrength } from './appetites';
import { applyRemorse, corruptionApplies, coarseProfile, recover } from './corruption';
import type { CorruptionLever } from './corruption';
import { promote } from './intentions';
import type { Lang } from './ladders';
import { PLAYER_ID } from './model';
import type { AppetiteState, CharacterProfile, ChatState, StateEvent } from './model';
import { endScene } from './scene';
import type { SceneBreak } from './scene';
import { FULL_SELF_CONTROL } from './state-init';
import { relieveStress } from './stress';
import { isOutGroup, shiftGazesOnCorruption } from './thresholds';
import { TurnLog, appendLog, passThresholds } from './turn-log';
import type { Rng } from '../shared/contracts';

/** A skip this long (hours), or a new day, ends a chapter: remorse and recovery are rolled. */
export const CHAPTER_HOURS = 8;
/** Hours assumed for a date change that cannot be counted («Monday» → «Tuesday»). */
export const DATE_CHANGE_HOURS = 24;

export interface ScenePassInput {
    state: ChatState;
    /** Effective profiles (card + extras). */
    profiles: readonly CharacterProfile[];
    /** Present ids (anchors near, focus characters). */
    present: readonly string[];
    playerName?: string;
}

export interface ScenePassContext {
    rng: Rng;
    levers: { appetiteStrength: AppetiteStrength; corruption: CorruptionLever };
    /** Why the scene broke: a DES break or the turn pass saw it end. */
    reason: SceneBreak['reason'] | 'ended';
    /** Hours that passed, when known. */
    hours?: number;
    /** Turn the break belongs to (log lines). */
    turn?: number;
    messageIndex?: number;
    uiLang?: Lang;
}

export interface ScenePassResult {
    state: ChatState;
    events: StateEvent[];
    chapterEnd: boolean;
    /** Hours of time passing applied to appetites. */
    hours: number;
}

/** Whether a break ends a chapter: a new day, or a skip of CHAPTER_HOURS or more. */
export function isChapterEnd(reason: ScenePassContext['reason'], hours: number | undefined): boolean {
    return reason === 'date' || (hours ?? 0) >= CHAPTER_HOURS;
}

/** Hours of in-world time a break stands for (a date change without hours counts as a day). */
export function breakHours(reason: ScenePassContext['reason'], hours: number | undefined): number {
    if (hours !== undefined && Number.isFinite(hours) && hours > 0) return hours;
    return reason === 'date' ? DATE_CHANGE_HOURS : 0;
}

function withoutSceneCue(_character: string, _appetite: string, state: AppetiteState): AppetiteState {
    if (state.sceneCue === undefined) return state;
    const next = { ...state };
    delete next.sceneCue;
    return next;
}

/** Ends the current scene and lets the time of the break pass (see the file header). Returns a new state. */
export function runScenePass(input: ScenePassInput, ctx: ScenePassContext): ScenePassResult {
    const byId = new Map<string, CharacterProfile>();
    for (const profile of [...input.profiles, ...input.state.extras])
        if (!byId.has(profile.id)) byId.set(profile.id, profile);
    const turn = ctx.turn ?? input.state.turn;
    const log = new TurnLog(ctx.uiLang ?? 'en', turn, byId, input.playerName ?? '', ctx.messageIndex);
    const present = new Set(input.present);
    const hours = breakHours(ctx.reason, ctx.hours);
    const chapterEnd = isChapterEnd(ctx.reason, hours);

    // The sequel step for those who had the player (or their own business) in focus: the next goal moves up.
    let state: ChatState = structuredClone(input.state);
    const focus = Object.entries(state.next?.bands ?? {})
        .filter(([, band]) => band === 'focus')
        .map(([id]) => id);
    for (const id of focus) {
        const character = state.characters[id];
        if (!character) continue;
        const promoted = promote(character.agenda);
        character.agenda = promoted.agenda;
        for (const change of promoted.changes) {
            const intention = promoted.agenda.intentions.find((item) => item.id === change.intention);
            log.add('intention', 'promoted', { name: log.name(id), text: intention?.text ?? change.intention }, id);
        }
    }

    // Ties tick, moods relax, emotions clear, the per-scene cue counters reset.
    const ended = endScene(state, { profiles: [...byId.values()], appetiteSceneEnd: withoutSceneCue });
    state = ended.state;
    for (const change of ended.changes) {
        if (change.kind !== 'drift' || change.to === undefined) continue;
        log.add(
            'stance',
            'drift',
            {
                name: log.name(change.character),
                target: log.name(change.target),
                to: log.stance(change.to, change.character),
            },
            change.character,
        );
    }
    log.add('scene', hours > 0 ? 'chapterEnd' : 'sceneEnd', { hours: Math.round(hours) });

    for (const [id, character] of Object.entries(state.characters)) {
        const profile = byId.get(id);
        if (!profile) continue;

        // Time passes for everyone, present or not.
        if (hours > 0) {
            for (const appetite of profile.appetites) {
                const current = character.appetites[appetite.id];
                if (!current) continue;
                const tick = tickAppetite(
                    appetite,
                    current,
                    { hoursPassed: hours },
                    { turn, strength: ctx.levers.appetiteStrength },
                );
                character.appetites[appetite.id] = tick.state;
                character.selfControl = Math.max(
                    0,
                    Math.min(FULL_SELF_CONTROL, character.selfControl + tick.selfControlDelta),
                );
                const what = appetite.label ?? appetite.id;
                if (tick.notes.includes('withdrawal'))
                    log.add('appetite', 'withdrawal', { name: log.name(id), what }, id);
                if (tick.notes.includes('binge')) log.add('appetite', 'binge', { name: log.name(id), what }, id);
            }
        }

        if (!chapterEnd) continue;
        // Rest restores self-control (§5.7 «Сдержки») and eases stress, more with an anchor near.
        character.selfControl = FULL_SELF_CONTROL;
        const anchorPresent = profile.core.anchors.some((anchor) => anchor === PLAYER_ID || present.has(anchor));
        character.stress = relieveStress(character.stress, anchorPresent);
        const tracked = corruptionApplies(ctx.levers.corruption, coarseProfile(profile.appetites));
        if (!tracked && character.corruption.stains <= 0) continue;
        const before = character.corruption.level;
        if (character.corruption.stains > 0) {
            const { state: corruption, result } = applyRemorse(
                character.corruption,
                {
                    anchorPresent,
                    justificationsActive: profile.core.justifications.length,
                    cultureEndorses: profile.appetites.some((item) => item.sources.includes('culture')),
                },
                ctx.rng,
            );
            character.corruption = corruption;
            if (result.success) log.add('corruption', 'remorseOk', { name: log.name(id) }, id);
            else log.add('corruption', 'remorseFail', { name: log.name(id), level: corruption.level }, id);
            if (corruption.level > before) {
                const passed = passThresholds(corruption, before, ctx.rng, log, id, { profile, anchorPresent });
                character.corruption = passed.state;
                // The gaze on outsiders slides toward the thing (the turn pass does the same for its own crossings).
                if (passed.crossed5 && shiftGazesOnCorruption(character, (t) => isOutGroup(profile, t, byId)).length)
                    log.add('gaze', 'gazeFall', { name: log.name(id) }, id);
            }
        } else {
            // Abstinence: no vowed craving was fed within the last day (a chapter with nothing to resist counts too).
            const abstinence = profile.appetites
                .filter((item) => item.vow !== 'none')
                .every((item) => {
                    const live = character.appetites[item.id];
                    return !live || live.lastSated < 0 || (live.daysUnsated ?? 0) >= 1;
                });
            const recovered = recover(character.corruption, { abstinence, anchor: anchorPresent });
            if (recovered.level < character.corruption.level) {
                log.add('corruption', 'recovered', { name: log.name(id), level: recovered.level }, id);
            }
            character.corruption = recovered;
        }
    }

    appendLog(state, log.events);
    return { state, events: log.events, chapterEnd, hours };
}
