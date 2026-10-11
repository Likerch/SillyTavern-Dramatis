// The initiative holds (docs/model.md §6.5). A character who started something with the player — an intimate scene, a
// deal, a duel — must not drop it at one word of hesitation: «нет», «подожди», «not now» is a beat of the scene, and
// the character answers it from their nature and goal (insists, persuades, teases, takes control, or stops only if
// that is truly who they are). Only a clear, decisive act of the player or an out-of-character request ends it — an
// OOC message always wins.
// - pursuing (at a commit): who was driving something toward the player in the committed reply — their move that
//   beat was 'initiate' at him; or the reply showed them pressing an appetite (seduce, flirt, indulge…) or an aim
//   (order, threat, capture) on him; or the player was the target of their intention and it advanced; or they want
//   him and the reply showed them acting on him or him refusing their approach. Minors never hold (the content
//   boundary, group-rules.ts).
// - holders (at a generation): of those present, the pursuing ones and those whose move this beat is 'initiate' at
//   the player, when the player's latest message is a short hesitation (≤ 8 words) with no OOC mark and no decisive act.
// Pure.
import { PLAYER_ID } from './model';
import type { CharacterProfile, Move } from './model';

/** Words in a message that still counts as a short hesitation. */
export const HESITATION_MAX_WORDS = 8;

/**
 * Out-of-character marks: ((…)) as a pair (a lone «))» is a Russian smile), OOC, ООС (Cyrillic), [OOC], (OOC: …),
 * a leading «//».
 */
const OOC_RE = /\(\([\s\S]*?\)\)|(^|[^\p{L}])(ooc|ООС|ОOC)(?![\p{L}])|^\s*\/\//iu;

/** Short hesitations and refusals, RU and EN (lower case, ё → е). */
const HESITATION_RE = new RegExp(
    [
        'нет',
        'не надо',
        'не нужно',
        'не стоит',
        'не сейчас',
        'не здесь',
        'не так быстро',
        'подожди',
        'подождите',
        'погоди',
        'погодите',
        'постой',
        'постойте',
        'стой',
        'стойте',
        'стоп',
        'хватит',
        'перестань',
        'прекрати',
        'остановись',
        'полегче',
        'не уверен',
        'не уверена',
        'я не готов',
        'я не готова',
        'рано',
        'ну',
        'эм+',
        'хм+',
        'ой',
        'может не',
        'no',
        'nope',
        'wait',
        'stop',
        'not now',
        'not here',
        'not yet',
        'hold on',
        'slow down',
        'dont',
        'please dont',
        'enough',
        'not sure',
        'im not sure',
        'i cant',
        'easy',
        'h+m+',
        'u+m+',
        'u+h+',
    ]
        .map((item) => item.replace(/ /g, '\\s+'))
        .map((item) => `(?:^|[^\\p{L}])${item}(?![\\p{L}])`)
        .join('|'),
    'u',
);

/** A clear, decisive act of the player ends what was started: leaving, pushing away, striking, running. */
const DECISIVE_RE =
    /(^|[^\p{L}])(ухож|уйду|ушел|ушла|выхож|вышел|вышла|отталкив|оттолкн|ударя|ударил|бью|убега|убежал|вырыва|вырвал|даю пощечин|влепил|i leave|i walk away|i walk out|i push|i shove|i slap|i hit|i punch|i run|i storm out|i get up and leave)/u;

function folded(text: string): string {
    return String(text ?? '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/['’]/g, '');
}

/** The message steps out of the story (((…)), OOC, ООС, [OOC]). */
export function isOoc(text: string | null | undefined): boolean {
    return !!text && OOC_RE.test(text);
}

/**
 * The player's message as a short hesitation or refusal (≤ 8 words: «нет», «подожди», «ну…», «not now», «I'm not
 * sure»), trimmed for quoting; null for anything else — a longer message, an OOC one, a decisive act.
 */
export function hesitation(text: string | null | undefined): string | null {
    if (!text?.trim() || isOoc(text)) return null;
    const words = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? [];
    if (!words.length || words.length > HESITATION_MAX_WORDS) return null;
    const plain = folded(text);
    if (DECISIVE_RE.test(plain) || !HESITATION_RE.test(plain)) return null;
    return text
        .replace(/[*_~`]/g, '')
        .replace(/^[\s—–-]+/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Acts by which a character presses something on the player (turn pass events). */
export const PURSUIT_ACTS: ReadonlySet<string> = new Set([
    'seduce',
    'flirt',
    'indulge',
    'satisfy-appetite',
    'order',
    'threat',
    'capture',
]);

export interface PursuitInput {
    /** In the scene after the reply. */
    ids: readonly string[];
    byId: ReadonlyMap<string, Pick<CharacterProfile, 'minor'>>;
    /** The moves of the beat that produced the reply. */
    moves?: Readonly<Record<string, { move: Move; target?: string }>>;
    /** The reply's events, resolved to ids (PLAYER_ID for the player). */
    events: readonly { actor: string | null; target: string | null; act: string }[];
    /** The turn pass per id: the player's role in their intention, intention statuses, refusals by the player. */
    pass: ReadonlyMap<string, { playerRole?: string; advanced?: boolean; refusedByPlayer?: boolean } | undefined>;
    /** Desirability of the player per id (the tie's want). */
    want: (id: string) => number;
}

/** Who was driving something toward the player in the committed reply (see the file header). */
export function pursuingIds(input: PursuitInput): string[] {
    return input.ids.filter((id) => {
        if (input.byId.get(id)?.minor) return false;
        const move = input.moves?.[id];
        if (move?.move === 'initiate' && (!move.target || move.target === PLAYER_ID)) return true;
        const own = input.events.filter((event) => event.actor === id && event.target === PLAYER_ID);
        if (own.some((event) => PURSUIT_ACTS.has(event.act))) return true;
        const pass = input.pass.get(id);
        if (pass?.playerRole === 'target' && pass.advanced) return true;
        return input.want(id) >= 2 && (own.length > 0 || pass?.refusedByPlayer === true);
    });
}

export interface HoldInput {
    /** The player's latest message (the one this generation answers). */
    playerMessage: string;
    /** Present ids (the card's). */
    present: readonly string[];
    /** This beat's moves. */
    moves?: Readonly<Record<string, { move: Move; target?: string }>>;
    /** `state.next.pursuing`. */
    pursuing?: readonly string[];
    byId: ReadonlyMap<string, Pick<CharacterProfile, 'minor'>>;
}

/** Whose initiative holds against the player's hesitation now, and the words he said; null when nobody's does. */
export function initiativeHolds(input: HoldInput): { ids: string[]; said: string } | null {
    const said = hesitation(input.playerMessage);
    if (!said) return null;
    const pursuing = new Set(input.pursuing ?? []);
    const ids = input.present.filter((id) => {
        if (input.byId.get(id)?.minor) return false;
        const move = input.moves?.[id];
        return pursuing.has(id) || (move?.move === 'initiate' && move.target === PLAYER_ID);
    });
    return ids.length ? { ids, said } : null;
}
