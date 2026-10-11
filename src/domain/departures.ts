// Who is out of the scene and what the world elsewhere is busy with (docs/model.md §6.4). The model writes a departure
// at the end of a reply while Doom's Enhancement Suite («together» mode) writes its tracker at the start, so the
// tracker of that very reply still lists whoever left; a card built from it gave them a block and a move again, and
// the model kept bringing them back or telling where they were. The chat state now keeps them out (`ChatState.away`):
// - a character in the scene leaves when the committed reply shows them leaving (scene-reading.ts), or when Dramatis
//   gave them the move 'leave' for that beat and the reply did not keep them acting in the scene to its end;
// - a tracker that still lists them does not bring them back; a later reply showing them act or speak in the scene by
//   name, an entry («вернулась», «walked in»), or the player's message calling or addressing them does;
// - a change of place ends the old scene: whoever was out of it is no longer «out» of the new one (the tracker says).
// The «Elsewhere» line (only while Maestro keeps the scene and the world apart) names at most 3 absent characters with
// a live agenda — just departed, a clock moving, a recent off-screen attempt — and never one named on the turn before
// unless what they are busy with changed. Pure.
import { readScene, summonedBy } from './scene-reading';
import type { ReadProfile } from './scene-reading';
import { PLAYER_ID } from './model';
import type { CharacterProfile, ChatState, Departure, ElsewhereNote } from './model';

/** Absent characters on one «Elsewhere» line at most. */
export const ELSEWHERE_MAX = 3;
/** Turns within which a departure or an off-screen attempt counts as recent. */
export const RECENT_TURNS = 3;

export interface DepartureInput {
    /** The committed reply, cleaned (cleanForAnalysis: no tracker JSON, no `<offscreen>` block). */
    narration: string;
    profiles: readonly ReadProfile[];
    playerName?: string;
    /** In the scene while the reply was written (ids). */
    inScene: readonly string[];
    /** Out of the scene before this reply. */
    away: Readonly<Record<string, Departure>>;
    /** Dramatis gave these the move 'leave' in the beat that produced the reply. */
    leaving?: readonly string[];
    /** The player's message the reply answered: whom it calls or brings in. */
    playerMessage?: string;
    /** Committed turn after this reply. */
    turn: number;
    /** What a leaver went off to do, story words (the turn pass, the move's text). */
    doing?: Readonly<Record<string, string>>;
}

export interface DepartureResult {
    away: Record<string, Departure>;
    /** Left the scene in this reply (were in it before). */
    left: string[];
    /** Back in the scene with this reply. */
    returned: string[];
}

/** Who leaves the scene with a committed reply and who comes back (see the file header). */
export function sceneDepartures(input: DepartureInput): DepartureResult {
    const evidence = readScene(input.narration ?? '', input.profiles, input.playerName ?? '');
    const away: Record<string, Departure> = { ...input.away };
    const awayIds = Object.keys(away);
    const called = new Set(
        input.playerMessage ? summonedBy(input.playerMessage, input.profiles, awayIds, input.playerName ?? '') : [],
    );
    const returned: string[] = [];
    for (const id of awayIds) {
        const seen = evidence[id];
        const back = seen?.named === true && (seen.kind === 'act' || seen.kind === 'enter');
        if (called.has(id) || back) {
            delete away[id];
            returned.push(id);
        }
    }
    const leaving = new Set(input.leaving ?? []);
    const left: string[] = [];
    for (const id of new Set([...input.inScene, ...leaving, ...returned])) {
        if (away[id]) continue;
        const seen = evidence[id];
        const stays = seen?.kind === 'act' || seen?.kind === 'enter';
        let by: Departure['by'] | null = null;
        if (seen?.kind === 'exit') by = 'narration';
        else if (leaving.has(id) && !stays && !returned.includes(id)) by = 'move';
        if (!by) continue;
        const departure: Departure = { since: input.turn, by };
        const doing = input.doing?.[id]?.trim();
        if (doing) departure.doing = doing;
        away[id] = departure;
        // Came back and left again within one reply: neither.
        const back = returned.indexOf(id);
        if (back >= 0) returned.splice(back, 1);
        else left.push(id);
    }
    return { away, left, returned };
}

/** Out of the scene now: the chat's departures less those the player's messages since the last commit call back. */
export function outOfScene(
    state: Pick<ChatState, 'away'>,
    profiles: readonly ReadProfile[],
    playerMessages: readonly string[] = [],
    playerName = '',
): Set<string> {
    const ids = Object.keys(state.away ?? {});
    if (!ids.length) return new Set();
    const called = new Set(playerMessages.flatMap((text) => summonedBy(text, profiles, ids, playerName)));
    return new Set(ids.filter((id) => !called.has(id)));
}

/* ------------------------------------------------------------------ the world elsewhere */

function clockShare(clock: { segments: number; filled: number } | undefined): number {
    return clock && clock.segments > 0 ? Math.min(1, Math.max(0, clock.filled) / clock.segments) : 0;
}

function clause(text: string | undefined): string {
    return (text ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[\s.;,]+$/u, '');
}

/** What an absent character is busy with, and how much it matters now (0: not a live agenda). */
function busyWith(state: ChatState, profile: CharacterProfile, turn: number): { text: string; weight: number } {
    const live = state.characters[profile.id];
    if (!live || profile.kind === 'group') return { text: '', weight: 0 };
    const departure = state.away?.[profile.id];
    const attempts = (live.offscreen ?? []).filter(
        (attempt) => attempt.turn > (departure?.since ?? -Infinity) || attempt.turn >= turn - RECENT_TURNS,
    );
    const attempt = attempts[attempts.length - 1];
    const front = live.agenda.front && !live.agenda.front.done ? live.agenda.front : undefined;
    const moving = live.agenda.intentions.find((intention) => (intention.clock?.filled ?? 0) > 0);
    const urgency = Math.max(clockShare(front?.clock), ...live.agenda.intentions.map((item) => clockShare(item.clock)));
    let weight = 0;
    if (departure && departure.since >= turn - RECENT_TURNS) weight += 3;
    else if (departure) weight += 1;
    if (attempt && attempt.turn >= turn - RECENT_TURNS) weight += 1.5;
    weight += 2 * urgency;
    const alive = !!departure || !!attempt || (!!front && clockShare(front.clock) >= 0.5) || !!moving;
    if (!alive) return { text: '', weight: 0 };
    const tie = live.ties[PLAYER_ID];
    if (tie && (Math.abs(tie.stance) >= 2 || (tie.want ?? 0) >= 3 || tie.intent !== 'none')) weight += 1;
    if (profile.lod === 'portrait') weight += 0.5;
    else if (profile.lod === 'draft') weight += 0.25;
    const text =
        clause(attempt?.attempt) ||
        clause(departure?.doing) ||
        clause(moving?.nextStep || moving?.text) ||
        clause(live.agenda.intentions[0]?.nextStep || live.agenda.intentions[0]?.text) ||
        clause(front?.impulse);
    return text ? { text, weight } : { text: '', weight: 0 };
}

export interface ElsewhereInput {
    /** The state after the commit (its `away` and agendas). */
    state: ChatState;
    profiles: readonly CharacterProfile[];
    /** In the scene for the next generation. */
    here: ReadonlySet<string>;
    /** Committed turn after this reply. */
    turn: number;
    /** The line of the turn before (`state.next.elsewhere` it followed). */
    previous?: readonly ElsewhereNote[];
    max?: number;
}

/** Absent characters for the «Elsewhere» line (see the file header), most important first. */
export function pickElsewhere(input: ElsewhereInput): ElsewhereNote[] {
    const previous = new Map((input.previous ?? []).map((note) => [note.id, note.text] as const));
    const candidates: { note: ElsewhereNote; weight: number; index: number }[] = [];
    input.profiles.forEach((profile, index) => {
        if (input.here.has(profile.id)) return;
        const busy = busyWith(input.state, profile, input.turn);
        if (!busy.weight || !busy.text) return;
        // Named on the turn before for the same thing: not again now.
        if (previous.get(profile.id) === busy.text) return;
        candidates.push({ note: { id: profile.id, text: busy.text }, weight: busy.weight, index });
    });
    return candidates
        .sort((a, b) => b.weight - a.weight || a.index - b.index)
        .slice(0, Math.max(0, input.max ?? ELSEWHERE_MAX))
        .map((item) => item.note);
}
