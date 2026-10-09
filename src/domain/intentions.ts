// BDI intention reconsideration (docs/model.md §4.2, §5.3; research A9). Desires are many, intentions few (≤ 2):
// an intention is reconsidered only on a trigger — achieved, impossible, a drop condition, or an option better by a
// margin set by commitment. Without a trigger the character keeps pursuing it, whatever the player waves around.
import type { Agenda, Clock, Commitment, Goal, Intention } from './model';
import { clamp, uniqueId } from './util';

export const MAX_INTENTIONS = 2;

/** How much better an option must be to switch: stubborn characters need a lot more. */
export const SWITCH_MARGIN: Record<Commitment, number> = { single: 0.5, open: 0.2 };

export interface BetterOption {
    text: string;
    /** Utility advantage over the current intention, 0–1. */
    margin: number;
    goalId?: string;
    nextStep?: string;
    dropIf?: string[];
}

/** What the scene pass noticed about one intention. */
export interface IntentionSignal {
    achieved?: boolean;
    impossible?: boolean;
    /** One of the intention's dropIf conditions came true. */
    dropIfMatched?: boolean;
    betterOption?: BetterOption;
}

export type IntentionChangeKind = 'achieved' | 'impossible' | 'dropped' | 'switched' | 'promoted' | 'trimmed';

export interface IntentionChange {
    kind: IntentionChangeKind;
    /** Intention id (the ended one; for 'promoted' the new one). */
    intention: string;
    goal?: string;
    /** For 'switched': id of the replacing intention. */
    replacedBy?: string;
}

/**
 * Reconsiders the agenda's intentions on signals (keyed by intention id). Achieved and impossible intentions end and
 * their goals leave the agenda; dropped ones end but keep their goal; a better option replaces an intention when its
 * margin reaches the commitment threshold. Freed slots are filled with the next goals by priority.
 */
export function reconsider(
    agenda: Agenda,
    signals: Record<string, IntentionSignal | undefined>,
    commitment: Commitment,
): { agenda: Agenda; changes: IntentionChange[] } {
    const changes: IntentionChange[] = [];
    const doneGoals = new Set<string>();
    const skipGoals = new Set<string>();
    const kept: Intention[] = [];
    const taken = new Set(agenda.intentions.map((i) => i.id));
    const threshold = SWITCH_MARGIN[commitment] ?? SWITCH_MARGIN.single;

    for (const [index, intention] of agenda.intentions.entries()) {
        const ref = { intention: intention.id, ...(intention.goalId ? { goal: intention.goalId } : {}) };
        if (index >= MAX_INTENTIONS) {
            changes.push({ ...ref, kind: 'trimmed' });
            continue;
        }
        const signal = signals[intention.id] ?? {};
        if (signal.achieved || signal.impossible) {
            changes.push({ ...ref, kind: signal.achieved ? 'achieved' : 'impossible' });
            if (intention.goalId) doneGoals.add(intention.goalId);
            continue;
        }
        if (signal.dropIfMatched) {
            changes.push({ ...ref, kind: 'dropped' });
            if (intention.goalId) skipGoals.add(intention.goalId);
            continue;
        }
        const option = signal.betterOption;
        if (option && option.text?.trim() && Number.isFinite(option.margin) && option.margin >= threshold) {
            const busy = option.goalId !== undefined && agenda.intentions.some((i) => i.goalId === option.goalId);
            if (!busy) {
                const id = uniqueId(option.goalId ? `i-${option.goalId}` : 'i-option', taken);
                taken.add(id);
                const next: Intention = {
                    id,
                    text: option.text.trim(),
                    nextStep: option.nextStep ?? '',
                    dropIf: option.dropIf ?? [],
                };
                if (option.goalId) next.goalId = option.goalId;
                changes.push({ ...ref, kind: 'switched', replacedBy: id });
                if (intention.goalId) skipGoals.add(intention.goalId);
                kept.push(next);
                continue;
            }
        }
        kept.push(intention);
    }

    const goals = agenda.goals.filter((g) => !doneGoals.has(g.id));
    const promoted = promote({ ...agenda, goals, intentions: kept }, skipGoals);
    return { agenda: promoted.agenda, changes: [...changes, ...promoted.changes] };
}

/** Goals by priority (1 first), stable for equal priorities. */
export function goalsByPriority(goals: Goal[]): Goal[] {
    return goals
        .map((goal, index) => ({ goal, index }))
        .sort((a, b) => a.goal.priority - b.goal.priority || a.index - b.index)
        .map((x) => x.goal);
}

/** Fills free intention slots with the highest-priority goals nobody pursues yet (except `skip`). */
export function promote(
    agenda: Agenda,
    skip: ReadonlySet<string> = new Set(),
): { agenda: Agenda; changes: IntentionChange[] } {
    const intentions = agenda.intentions.slice(0, MAX_INTENTIONS);
    const changes: IntentionChange[] = [];
    const pursued = new Set(intentions.map((i) => i.goalId).filter((id): id is string => id !== undefined));
    const taken = new Set(intentions.map((i) => i.id));
    for (const goal of goalsByPriority(agenda.goals)) {
        if (intentions.length >= MAX_INTENTIONS) break;
        if (pursued.has(goal.id) || skip.has(goal.id)) continue;
        const id = uniqueId(`i-${goal.id}`, taken);
        taken.add(id);
        pursued.add(goal.id);
        intentions.push({ id, goalId: goal.id, text: goal.text, nextStep: '', dropIf: [] });
        changes.push({ kind: 'promoted', intention: id, goal: goal.id });
    }
    return { agenda: { ...agenda, intentions }, changes };
}

/** Clock advanced by n segments (negative n rolls back), kept within 0 … segments. */
export function advanceClock(clock: Clock, n: number): Clock {
    const segments = Math.max(0, Math.round(clock.segments));
    const step = Number.isFinite(n) ? Math.round(n) : 0;
    return { segments, filled: clamp(Math.round(clock.filled) + step, 0, segments) };
}

export function clockFull(clock: Clock): boolean {
    return clock.segments > 0 && clock.filled >= clock.segments;
}

/** Advances one intention's clock; intentions without a clock are left alone. */
export function advanceIntention(agenda: Agenda, intentionId: string, n: number): Agenda {
    let changed = false;
    const intentions = agenda.intentions.map((i) => {
        if (i.id !== intentionId || !i.clock) return i;
        changed = true;
        return { ...i, clock: advanceClock(i.clock, n) };
    });
    return changed ? { ...agenda, intentions } : agenda;
}
