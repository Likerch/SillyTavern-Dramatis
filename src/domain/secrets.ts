// What counts as a secret of a character (docs/model.md §0.1 В3, §14 «Видимость тайного»): agenda secrets, appetites
// the character hides or keeps secret, the doom of a front, schemes, hidden intentions and covert intents toward the
// player. Pure predicates shared by the intent sheet and DRAMATIS_API.describe; how secrets show is the UI's concern.
import { PLAYER_ID } from './model';
import type { Appetite, Intention, Tie, TieIntent } from './model';

/** Intents toward the player a character would not show him. */
export const COVERT_INTENTS: readonly TieIntent[] = ['extract', 'use', 'avenge', 'seduce'];

export function isHiddenAppetite(appetite: Pick<Appetite, 'visibility'>): boolean {
    return appetite.visibility !== 'open';
}

/** An intention marked hidden or secret (an extra flag the generator or the user may set). */
export function isHiddenIntention(intention: Intention): boolean {
    const flags = intention as Intention & { hidden?: unknown; secret?: unknown };
    return flags.hidden === true || flags.secret === true;
}

export function isCovertTie(tie: Pick<Tie, 'target' | 'intent'>): boolean {
    return tie.target === PLAYER_ID && COVERT_INTENTS.includes(tie.intent);
}
