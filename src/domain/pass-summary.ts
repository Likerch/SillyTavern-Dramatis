// The short record of a committed turn pass (stage 5) that applyTurnPass leaves in `state.lastPass`: what the modules
// running after the turn read instead of re-running it — the key each character's events matched and the choice under
// pressure the pass found (arcs, docs/model.md §9), the strain the code itself saw this turn (a temptation to cross a
// line, a stress break, a broken vow), the stance steps of the turn and who drifted (metrics, §16). Pure.
import type { CharacterState, ChatState, PassCharacterNote, PassSummary, StateEvent } from './model';
import type { TurnPass } from './turn-prompt';

/** A note of the turn pass as far as the summary cares (structurally TurnNote of turn-apply.ts). */
export interface SummaryNote {
    kind: string;
    character?: string;
}

export interface SummaryInput {
    /** The state the pass was applied to, and the state it produced. */
    before: ChatState;
    after: ChatState;
    pass: TurnPass;
    /** Present ids with a profile, scene order. */
    present: readonly string[];
    turn: number;
    messageIndex?: number;
    notes: readonly SummaryNote[];
    /** The story log lines of the pass. */
    events: readonly StateEvent[];
}

/** Vows broken this turn: an appetite that was not lapsed before and is now. */
function lapsed(before: CharacterState | undefined, after: CharacterState): boolean {
    return Object.entries(after.appetites ?? {}).some(
        ([id, state]) => state.lapsed === true && before?.appetites?.[id]?.lapsed !== true,
    );
}

function add(notes: Record<string, PassCharacterNote>, id: string, strain: 'temptation' | 'break' | 'lapse'): void {
    const note = (notes[id] ??= {});
    const list = (note.strain ??= []);
    if (!list.includes(strain)) list.push(strain);
}

/** The summary of one applied turn pass (see the file header). */
export function summarizePass(input: SummaryInput): PassSummary {
    const present = new Set(input.present);
    const characters: Record<string, PassCharacterNote> = {};
    for (const entry of input.pass.characters) {
        if (!present.has(entry.id)) continue;
        const note: PassCharacterNote = {};
        const key = entry.keyMatched?.trim();
        if (key) note.key = key;
        if (entry.choice?.text) note.choice = { ...entry.choice };
        if (note.key || note.choice) characters[entry.id] = note;
    }
    for (const note of input.notes) {
        if (!note.character || !present.has(note.character)) continue;
        if (note.kind === 'temptation') add(characters, note.character, 'temptation');
        else if (note.kind === 'break') add(characters, note.character, 'break');
    }
    for (const id of input.present) {
        const after = input.after.characters[id];
        if (after && lapsed(input.before.characters[id], after)) add(characters, id, 'lapse');
    }

    const steps: PassSummary['steps'] = [];
    for (const [id, after] of Object.entries(input.after.characters)) {
        const before = input.before.characters[id];
        for (const [target, tie] of Object.entries(after.ties ?? {})) {
            const from = before?.ties?.[target]?.stance ?? tie.base;
            if (from === undefined || from === tie.stance) continue;
            steps.push({ character: id, target, from, to: tie.stance });
        }
    }

    const drift = [
        ...new Set(
            input.events
                .filter((event) => event.kind === 'drift' && event.character)
                .map((event) => event.character as string),
        ),
    ];
    const summary: PassSummary = { turn: input.turn, present: [...input.present], characters, steps, drift };
    if (input.messageIndex !== undefined) summary.messageIndex = input.messageIndex;
    return summary;
}
