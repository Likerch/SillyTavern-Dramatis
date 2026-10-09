// Reputation and rumours (docs/model.md §11; decisions В12, В16, В17). Reputation is kept per group and place:
// what the player did in front of witnesses moves it in small steps, rumours carry it along the ties between groups
// (sometimes distorted), new NPCs start from it, and only those who saw the player or heard of him can want him.
import type { Reputation, Rumour, Stance } from './model';
import { PLAYER_ID } from './model';
import type { Rng } from '../shared/contracts';
import { STACK_FACTOR, stepStance } from './relations';
import { clamp, clamp01, normalizeText, round3 } from './util';

/** Something the player did that people saw. */
export interface WitnessedEvent {
    /** Story words («зарезал стражника у ворот»). */
    text: string;
    /** Stance contribution, ±1 a real step. */
    delta: number;
    /** What people now call him («убийца»). */
    label?: string;
    /** A weakness the event showed («падок на лесть», «пьёт»). */
    weakness?: string;
    /** Where it happened: the place's people hear of it too. */
    place?: string;
}

export interface ReputationDelta {
    among: string;
    text: string;
    delta: number;
    label?: string;
    weakness?: string;
}

/** Deltas for every group or place a witness belongs to, plus the place itself; one per group. */
export function witnessed(
    event: WitnessedEvent,
    witnesses: string[],
    groupsOf: (id: string) => string[],
): ReputationDelta[] {
    if (witnesses.length === 0 || !event.text?.trim()) return [];
    const delta = clamp(Number.isFinite(event.delta) ? event.delta : 0, -3, 3);
    const seen = new Set<string>();
    const result: ReputationDelta[] = [];
    const groups = [...witnesses.flatMap((w) => groupsOf(w) ?? []), ...(event.place ? [event.place] : [])];
    for (const among of groups) {
        const key = normalizeText(among);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const d: ReputationDelta = { among, text: event.text.trim(), delta };
        if (event.label?.trim()) d.label = event.label.trim();
        if (event.weakness?.trim()) d.weakness = event.weakness.trim();
        result.push(d);
    }
    return result;
}

export type ReputationChangeKind = 'created' | 'pending' | 'step' | 'label' | 'weakness';

export interface ReputationChange {
    kind: ReputationChangeKind;
    among: string;
    from?: Stance;
    to?: Stance;
    text?: string;
}

/** Most recent reasons kept per group. */
export const MAX_REPUTATION_REASONS = 8;

/** A deed this weighty moves a group's stance at once, either way. */
const DECISIVE = 2;

function findEntry(list: Reputation[], among: string): number {
    const key = normalizeText(among);
    return list.findIndex((r) => normalizeText(r.among) === key);
}

/**
 * Applies witnessed deltas with the small-step logic of ties (§5.2): one step per deed at most; a step down needs
 * |Σ| ≥ 1, a step up |Σ| ≥ 1 from two different deeds (or one decisive deed, |delta| ≥ 2); a repeated deed counts
 * ×0.9 and is not a new deed; the opposite direction resets the progress. A new group starts from the '*' entry.
 */
export function applyReputation(
    reputation: Reputation[],
    deltas: ReputationDelta[],
): { reputation: Reputation[]; changes: ReputationChange[] } {
    const list = reputation.slice();
    const changes: ReputationChange[] = [];
    for (const d of deltas) {
        let index = findEntry(list, d.among);
        if (index < 0) {
            const everyone = list[findEntry(list, '*')];
            list.push({
                among: d.among,
                label: everyone?.label ?? '',
                stance: everyone?.stance ?? 0,
                weaknesses: [...(everyone?.weaknesses ?? [])],
                reasons: [],
            });
            index = list.length - 1;
            changes.push({ kind: 'created', among: d.among });
        }
        const old = list[index]!;
        let entry: Reputation = { ...old, reasons: old.reasons.slice(), weaknesses: old.weaknesses.slice() };

        if (d.label && d.label !== entry.label) {
            entry.label = d.label;
            changes.push({ kind: 'label', among: entry.among, text: d.label });
        }
        if (d.weakness && !entry.weaknesses.some((w) => normalizeText(w) === normalizeText(d.weakness!))) {
            entry.weaknesses.push(d.weakness);
            changes.push({ kind: 'weakness', among: entry.among, text: d.weakness });
        }

        const repeat = entry.reasons.some((r) => normalizeText(r) === normalizeText(d.text));
        if (!repeat) entry.reasons = [...entry.reasons, d.text].slice(-MAX_REPUTATION_REASONS);
        const effective = round3(repeat ? d.delta * STACK_FACTOR : d.delta);
        if (effective !== 0) entry = stepReputation(entry, effective, !repeat, changes, d.text);
        list[index] = entry;
    }
    return { reputation: list, changes };
}

function stepReputation(
    entry: Reputation,
    effective: number,
    newDeed: boolean,
    changes: ReputationChange[],
    text: string,
): Reputation {
    const dir: 1 | -1 = effective > 0 ? 1 : -1;
    const prev = entry.progress?.dir === dir ? entry.progress : { dir, sum: 0, events: 0 };
    const progress = { dir, sum: round3(prev.sum + Math.abs(effective)), events: prev.events + (newDeed ? 1 : 0) };
    const ready = Math.abs(effective) >= DECISIVE || (progress.sum >= 1 && (dir < 0 || progress.events >= 2));
    if (!ready) {
        changes.push({ kind: 'pending', among: entry.among, text });
        return { ...entry, progress };
    }
    const next = stepStance(entry.stance, dir);
    // At the end of the ladder there is nothing left to accumulate toward.
    if (next === entry.stance) return withoutProgress(entry);
    changes.push({ kind: 'step', among: entry.among, from: entry.stance, to: next, text });
    return withoutProgress({ ...entry, stance: next });
}

function withoutProgress(entry: Reputation): Reputation {
    const next = { ...entry };
    delete next.progress;
    return next;
}

/* ------------------------------------------------------------------ rumours */

/** Group/place adjacency: who talks to whom. Links are treated as two-way. */
export type RumourGraph = Record<string, string[]>;

export interface RumourSpread {
    tick: number;
    rumour: string;
    group: string;
    distorted: boolean;
    /** Id of the distorted retelling when `distorted`. */
    variant?: string;
}

export const RUMOUR_CHANCE = 0.35;
export const DISTORT_CHANCE = 0.1;

function forkId(id: string, taken: ReadonlySet<string>): string {
    for (let n = 1; ; n++) if (!taken.has(`${id}~${n}`)) return `${id}~${n}`;
}

function neighbours(graph: RumourGraph): Map<string, string[]> {
    const map = new Map<string, string[]>();
    const add = (a: string, b: string): void => {
        if (a === b) return;
        const list = map.get(a) ?? [];
        if (!list.includes(b)) list.push(b);
        map.set(a, list);
    };
    for (const [from, tos] of Object.entries(graph)) {
        for (const to of tos ?? []) {
            add(from, to);
            add(to, from);
        }
    }
    return map;
}

/**
 * Spreads rumours for `ticks` world ticks: each tick, every rumour reaches each not-yet-reached neighbour of the
 * groups it already reached with `chance`. With `distortChance` the neighbour hears a distorted retelling instead —
 * a forked rumour with `false: true` (false rumours stay false). A rumour moves one hop per tick at most.
 */
export function spreadRumours(
    rumours: Rumour[],
    graph: RumourGraph,
    rng: Rng,
    ticks: number,
    options: { chance?: number; distortChance?: number } = {},
): { rumours: Rumour[]; spread: RumourSpread[] } {
    const chance = clamp01(options.chance ?? RUMOUR_CHANCE);
    const distortChance = clamp01(options.distortChance ?? DISTORT_CHANCE);
    const links = neighbours(graph);
    let list = rumours.map((r) => ({ ...r, reached: r.reached.slice() }));
    const spread: RumourSpread[] = [];
    const ids = new Set(list.map((r) => r.id));
    const count = Math.max(0, Math.floor(Number.isFinite(ticks) ? ticks : 0));

    for (let tick = 1; tick <= count; tick++) {
        const forks: Rumour[] = [];
        // A group that heard any version of a story (original or retelling) doesn't hear it again as news.
        const heardByRoot = new Map<string, Set<string>>();
        for (const r of list) {
            const root = r.variantOf ?? r.id;
            const set = heardByRoot.get(root) ?? new Set<string>();
            for (const g of r.reached) set.add(g);
            heardByRoot.set(root, set);
        }
        list = list.map((rumour) => {
            const heard = heardByRoot.get(rumour.variantOf ?? rumour.id)!;
            const reached = rumour.reached.slice();
            for (const group of rumour.reached) {
                for (const next of links.get(group) ?? []) {
                    if (heard.has(next)) continue;
                    if (rng() >= chance) continue;
                    heard.add(next);
                    if (!rumour.false && rng() < distortChance) {
                        const id = forkId(rumour.id, ids);
                        ids.add(id);
                        forks.push({
                            id,
                            text: rumour.text,
                            about: rumour.about,
                            origin: next,
                            carriers: [],
                            reached: [next],
                            false: true,
                            turn: rumour.turn,
                            variantOf: rumour.id,
                        });
                        spread.push({ tick, rumour: rumour.id, group: next, distorted: true, variant: id });
                    } else {
                        reached.push(next);
                        spread.push({ tick, rumour: rumour.id, group: next, distorted: false });
                    }
                }
            }
            return reached.length === rumour.reached.length ? rumour : { ...rumour, reached };
        });
        list = [...list, ...forks];
    }
    return { rumours: list, spread };
}

/* ------------------------------------------------------------------ strangers and knowledge */

export interface StrangerView {
    stance: Stance;
    label: string;
    among: string;
    /** Player weaknesses known in these groups. */
    weaknesses: string[];
}

/**
 * How a new NPC of these groups/places meets the player: from the reputation among them ('*' as the fallback).
 * Bad news travels best: if any group thinks ill of him, the worst view wins; otherwise the best one.
 * Undefined when nobody there has heard of him.
 */
export function strangerStance(reputation: Reputation[], groups: string[]): StrangerView | undefined {
    const keys = new Set(groups.map(normalizeText));
    let matches = reputation.filter((r) => keys.has(normalizeText(r.among)));
    if (matches.length === 0) matches = reputation.filter((r) => r.among.trim() === '*');
    if (matches.length === 0) return undefined;
    const negative = matches.some((r) => r.stance < 0);
    const pick = matches.reduce((best, r) => ((negative ? r.stance < best.stance : r.stance > best.stance) ? r : best));
    const weaknesses: string[] = [];
    const known = new Set<string>();
    for (const r of [...matches, ...reputation.filter((x) => x.among.trim() === '*')]) {
        for (const w of r.weaknesses) {
            if (known.has(normalizeText(w))) continue;
            known.add(normalizeText(w));
            weaknesses.push(w);
        }
    }
    return { stance: pick.stance, label: pick.label, among: pick.among, weaknesses };
}

/** Rumours about `about` (default the player) that reached any of these groups or are carried by this character. */
export function rumoursReaching(
    character: { id: string; groups: string[] },
    rumours: Rumour[],
    about: string = PLAYER_ID,
): Rumour[] {
    const keys = new Set(character.groups.map(normalizeText));
    return rumours.filter(
        (r) =>
            r.about === about &&
            (r.carriers.includes(character.id) || r.reached.some((g) => keys.has(normalizeText(g)))),
    );
}

/**
 * Whether a character knows of the player (В17): saw him, or a rumour about him reached one of the character's
 * groups or places. Desirability toward the player exists only for those who know of him.
 */
export function knowsPlayer(
    character: { id: string; groups: string[] },
    rumours: Rumour[],
    witnessedBy: Iterable<string>,
): boolean {
    for (const id of witnessedBy) if (id === character.id) return true;
    return rumoursReaching(character, rumours).length > 0;
}
