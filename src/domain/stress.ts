// Stress and breaks beyond the drift response (docs/model.md §8 «Стресс», §5.7 «Досада», CK3 mental breaks). Stress
// builds from drift in the «stress» mode, from frustration and from holding back a strong craving (turn-apply.ts); once
// it reaches the threshold the character breaks in their coping style — whatever the stress came from — and the next
// motive card shows it as a «snaps: …» line instead of a plain move. Rest at a chapter end eases stress, more with an
// anchor near. Pure.
import { stressBreak } from './drift';
import type { BreakKind } from './drift';
import type { Lang } from './ladders';
import { PLAYER_ID } from './model';
import type { CharacterProfile, CharacterState, ChatState, Move } from './model';
import { clamp } from './util';

/** Stress a chapter's rest takes away, and the extra when an anchor is near. */
export const STRESS_REST = 25;
export const STRESS_ANCHOR_REST = 15;

/** Stress after a chapter end (rest), never below 0. */
export function relieveStress(stress: number, anchorPresent = false): number {
    const current = Number.isFinite(stress) ? stress : 0;
    return clamp(current - STRESS_REST - (anchorPresent ? STRESS_ANCHOR_REST : 0), 0, 100);
}

/** The move of a break, as the drift response writes it (turn-apply.ts). */
export const BREAK_MOVES: Readonly<Record<BreakKind, { move: Move; en: string; ru: string; aimed?: boolean }>> = {
    withdraw: {
        move: 'watch',
        en: 'withdraws into silence, will not engage',
        ru: 'замыкается и молчит, ни во что не вступает',
    },
    leave: { move: 'leave', en: 'walks out to get away from it all', ru: 'уходит, чтобы не быть здесь' },
    'lash-out': { move: 'obstruct', en: 'lashes out', ru: 'срывается и бьёт словом', aimed: true },
};

const SNAP: Readonly<Record<BreakKind, Record<Lang, string>>> = {
    withdraw: {
        en: 'shuts down — goes quiet and gives way on anything just to be left alone',
        ru: 'закрывается — замолкает и уступает в чём угодно, лишь бы оставили в покое',
    },
    leave: {
        en: 'bolts — makes an excuse and gets away, or buries themselves in work',
        ru: 'сбегает — под любым предлогом уходит или прячется в работу',
    },
    'lash-out': {
        en: 'lashes out at {target} — a cutting word or a cruelty out of all proportion',
        ru: 'срывается — резкое слово или жестокость не по поводу, достаётся: {target}',
    },
};

const CAUSE: Readonly<Record<'drift' | 'strain', Record<Lang, string>>> = {
    drift: {
        en: 'the strain of acting against themselves breaks through',
        ru: 'прорывается напряжение: слишком долго приходилось идти против себя',
    },
    strain: {
        en: 'everything held back too long breaks through',
        ru: 'прорывается всё, что слишком долго сдерживалось',
    },
};

/** The «snaps: …» text of a break (without the label), in the card's language. */
export function snapLine(
    kind: BreakKind,
    lang: Lang,
    options: { target?: string; cause?: 'drift' | 'strain' },
): string {
    const fallback = lang === 'ru' ? 'тот, кто рядом' : 'whoever is nearest';
    const what = SNAP[kind][lang].replace('{target}', options.target?.trim() || fallback);
    return `${what}; ${CAUSE[options.cause ?? 'strain'][lang]}`;
}

/** Whom a break lashes out at: the present character (or the player) they hold the lowest stance toward. */
export function lashTarget(character: CharacterState, present: readonly string[]): string {
    let best: { id: string; stance: number } = { id: PLAYER_ID, stance: character.ties[PLAYER_ID]?.stance ?? 0 };
    for (const id of present) {
        if (id === character.id) continue;
        const stance = character.ties[id]?.stance;
        if (stance !== undefined && stance < best.stance) best = { id, stance };
    }
    return best.id;
}

/** A break note as turn-apply.ts writes it ({ kind: 'break', character, break }). */
export interface BreakNote {
    kind: string;
    character?: string;
    break?: BreakKind;
}

export interface BreakContext {
    /** The state after the turn pass, with `next` already set (changed in place). */
    state: ChatState;
    present: readonly string[];
    byId: ReadonlyMap<string, CharacterProfile>;
    /** The pass's notes: breaks the drift response took this turn; new breaks are added. */
    notes: BreakNote[];
    /** Characters the drift control flagged this turn (the cause of their break). */
    drifted: ReadonlySet<string>;
    cardLang: Lang;
    playerName: string;
    /** Writes the story log line of a new break (`what`: the break in both languages). */
    logBreak(id: string, kind: BreakKind, what: Readonly<Record<Lang, string>>): void;
}

/**
 * Breaks of the turn (see the file header): characters at the threshold who did not break through the drift response
 * break now in their coping style (stress back to 30, the move set for the next beat); every break of the turn gets
 * its «snaps: …» line in `state.next.snaps`. Returns the lines by character id.
 */
export function finishBreaks(ctx: BreakContext): Record<string, string> {
    const { state } = ctx;
    const next = state.next;
    const snaps: Record<string, string> = {};
    if (!next) return snaps;
    const name = (id: string) => (id === PLAYER_ID ? ctx.playerName.trim() : (ctx.byId.get(id)?.name ?? id));
    for (const id of ctx.present) {
        const live = state.characters[id];
        const profile = ctx.byId.get(id);
        if (!live || !profile) continue;
        let kind = ctx.notes.find((note) => note.kind === 'break' && note.character === id)?.break;
        let target = next.moves?.[id]?.target;
        if (!kind) {
            const broke = stressBreak(live.stress, profile.core.wound?.coping);
            if (!broke) continue;
            kind = broke.kind;
            live.stress = broke.stress;
            const spec = BREAK_MOVES[kind];
            target = spec.aimed ? lashTarget(live, ctx.present) : undefined;
            const move: { move: Move; target?: string; text?: string } = { move: spec.move, text: spec[ctx.cardLang] };
            if (target) move.target = target;
            next.moves = { ...(next.moves ?? {}), [id]: move };
            live.scene.move = move.move;
            if (target) live.scene.moveTarget = target;
            else delete live.scene.moveTarget;
            live.scene.moveText = spec[ctx.cardLang];
            ctx.notes.push({ kind: 'break', character: id, break: kind });
            ctx.logBreak(id, kind, { en: spec.en, ru: spec.ru });
        }
        snaps[id] = snapLine(kind, ctx.cardLang, {
            ...(target ? { target: name(target) } : {}),
            cause: ctx.drifted.has(id) ? 'drift' : 'strain',
        });
    }
    if (Object.keys(snaps).length) next.snaps = snaps;
    return snaps;
}
