// A full re-read of a card («Перечитать полностью», docs/model.md §7): what the generator wrote for a character the
// reading covers gives way (clearGenerated, before intent-apply.ts writes the reading), and a chat that already
// copied the old profile follows the new one wherever its story has not touched the copy (refreshLiveState). Pure.
import { PLAYER_ID } from './model';
import type { AppetiteState, CharacterProfile, CharacterState } from './model';
import { emptyAgenda, emptyCore, getPath, isEmptyValue, isProtected, setMeta, setPath } from './profile-defaults';

function same(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/** The value a fresh profile holds at a provenance unit ('core.values' → { top: [] }, 'agenda.dream' → none). */
function emptyValueOf(path: string): unknown {
    const [head = '', key = '', ...rest] = path.split('.');
    if (rest.length) return undefined;
    if (head === 'core') return structuredClone((emptyCore() as unknown as Record<string, unknown>)[key]);
    if (head === 'agenda') return structuredClone((emptyAgenda() as unknown as Record<string, unknown>)[key]);
    if (head === 'starts' && !key) return [];
    return undefined;
}

/**
 * Drops what the generator wrote into a profile (unlocked meta 'generated', not from BunnyMo tags, not an appetite
 * drawn from a group rule, not a tie such a draw wrote): the value goes back to what a fresh profile holds and its
 * meta goes, so the reading and then a grounded fill write it anew. Returns the dropped values by path.
 */
export function clearGenerated(start: CharacterProfile): { profile: CharacterProfile; cleared: Map<string, unknown> } {
    let profile = start;
    const cleared = new Map<string, unknown>();
    for (const [path, meta] of Object.entries(start.meta)) {
        if (meta.origin !== 'generated' || isProtected(start, path)) continue;
        if (meta.sources?.includes('bunnymo')) continue;
        const [head = '', key = ''] = path.split('.');
        if (!['core', 'agenda', 'appetites', 'ties', 'starts'].includes(head)) continue;
        if (head !== 'starts' && !key) continue;
        if (head === 'appetites' && profile.appetites.find((item) => item.id === key)?.rule) continue;
        if (head === 'ties' && key !== PLAYER_ID) continue;
        const before = getPath(profile, path);
        const empty = emptyValueOf(path);
        if (!isEmptyValue(before) && !same(before, empty)) cleared.set(path, before);
        profile = setMeta(setPath(profile, path, empty), path, null);
    }
    return { profile, cleared };
}

/**
 * Carries a re-read into a chat that already copied the old profile (state-init.ts copies ties, agenda, mood and
 * appetites on first use): wherever the live value still equals what the old profile held — the story has not
 * touched it — the new reading takes its place; what the story changed stays. Appetites the profile no longer has
 * leave the live state; new ones start at their baseline. Pure.
 */
export function refreshLiveState(
    live: CharacterState,
    before: CharacterProfile | undefined,
    after: CharacterProfile,
): CharacterState {
    const next: CharacterState = structuredClone(live);
    const untouched = (now: unknown, old: unknown) => now === undefined || same(now, old);
    for (const old of before?.ties ?? []) {
        const now = next.ties[old.target];
        if (now && same(now, old) && !after.ties.some((tie) => tie.target === old.target)) delete next.ties[old.target];
    }
    for (const tie of after.ties) {
        const old = before?.ties.find((item) => item.target === tie.target);
        const now = next.ties[tie.target];
        if (!now) {
            next.ties[tie.target] = structuredClone(tie);
            if (tie.target === PLAYER_ID) next.knowsPlayer = true;
        } else if (old && same(now, old) && !same(old, tie)) {
            next.ties[tie.target] = structuredClone(tie);
        }
    }
    const agenda = next.agenda as unknown as Record<string, unknown>;
    const oldAgenda = (before?.agenda ?? {}) as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(after.agenda as unknown as Record<string, unknown>)) {
        const now = agenda[key];
        if ((isEmptyValue(now) || untouched(now, oldAgenda[key])) && !same(now, value)) {
            agenda[key] = structuredClone(value);
        }
    }
    for (const key of Object.keys(agenda)) {
        if (!(key in (after.agenda as object)) && same(agenda[key], oldAgenda[key])) delete agenda[key];
    }
    if (before && same(next.mood, before.core.baselineMood)) next.mood = structuredClone(after.core.baselineMood);
    const kept = new Set(after.appetites.map((appetite) => appetite.id));
    for (const id of Object.keys(next.appetites)) if (!kept.has(id)) delete next.appetites[id];
    for (const appetite of after.appetites) {
        if (next.appetites[appetite.id]) continue;
        const state: AppetiteState = {
            pressure: appetite.baseline,
            tolerance: appetite.tolerance,
            dependence: appetite.dependence,
            sensitization: appetite.sensitization,
            lastSated: -1,
            edgeCount: 0,
            withdrawal: false,
        };
        next.appetites[appetite.id] = state;
    }
    return next;
}
