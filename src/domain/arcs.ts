// Arcs and change (docs/model.md §9, Weiland's lie and truth, McKee's choice under pressure). A character's arc moves
// intact → cracking → glimpsed → embraced | rejected only through strong events: key events (the pass matched one of
// their keys) and choices under pressure (a costly choice between two things they value), plus the strain the code saw
// (a temptation to cross a line, a stress break, a broken vow). Strain accumulates per character and decays while
// nothing presses; each step needs STAGE_STRAIN since the last one, «glimpsed» needs at least one real key event or
// choice, and the end — embraced or rejected — is decided by where the revealed choices leaned (toward what they need,
// or toward the lie). A step is only proposed here (the Inbox decides, §9 «Шаг дуги — карточка во „Входящих“») and
// applied by applyArcStage. Characters the author locked (`arcLock`), sketches and groups never move; every revealed
// choice is still kept as a permanent memory — the strongest evidence of character — with a story log line. Pure.
import type { Gender, Lang } from './ladders';
import { arcStageLabel } from './ladders';
import type {
    ArcChoice,
    ArcProgress,
    ArcStage,
    CharacterProfile,
    CharacterState,
    ChatState,
    PassCharacterNote,
    PassSummary,
    PressureChoice,
    StateEvent,
} from './model';
import { appendLog } from './turn-log';

/** Strain each stage step needs (counted from the last step), and the most strain kept. */
export const STAGE_STRAIN = 3;
export const STRAIN_CAP = 6;
/** Strain of a key event and of a choice under pressure. */
export const KEY_STRAIN = 2;
export const CHOICE_STRAIN = 1.5;
/** Strain the code saw in the turn. */
export const SIGNAL_STRAIN: Readonly<Record<'temptation' | 'break' | 'lapse', number>> = {
    temptation: 0.5,
    break: 1,
    lapse: 0.5,
};
/** How a revealed choice leans the arc; a broken vow leans toward the lie. */
export const LEAN: Readonly<Record<PressureChoice['toward'], number>> = { need: 1, lie: -1, unclear: 0 };
export const LAPSE_LEAN = -0.5;
/** The lean an ending needs either way. */
export const RESOLVE_LEAN = 1;
/** Strain lost per committed turn in which nothing pressed. */
export const STRAIN_DECAY = 0.15;
/** Revealed choices kept per character (the oldest go first). */
export const MAX_CHOICES = 12;
/** Turns before the same step is proposed again (the Inbox card was ignored or turned down). */
export const PROPOSAL_LAPSE = 15;

const ORDER: readonly ArcStage[] = ['intact', 'cracking', 'glimpsed'];

/** A stage step waiting for a decision. */
export interface ArcStep {
    character: string;
    from: ArcStage;
    to: ArcStage;
    /** Committed turn it was proposed at. */
    turn: number;
    /** What pressed, story words in the UI language. */
    reason: string;
    messageIndex?: number;
}

export function emptyArc(turn = 0): ArcProgress {
    return { strain: 0, lean: 0, evidence: 0, turn, choices: [] };
}

/** Whether a character's arc may move at all: people the author did not lock, above a sketch. */
export function arcMoves(profile: Pick<CharacterProfile, 'kind' | 'lod' | 'core'>): boolean {
    return profile.kind === 'character' && profile.lod !== 'sketch' && !profile.core.arcLock;
}

/** Strain left at a turn after the decay since the arc last moved. */
export function effectiveStrain(arc: Pick<ArcProgress, 'strain' | 'turn'>, turn: number): number {
    const quiet = Math.max(0, turn - arc.turn);
    return Math.max(0, Math.round((arc.strain - STRAIN_DECAY * quiet) * 100) / 100);
}

/** The step the arc is ripe for, or null (needs STAGE_STRAIN; see the file header for the rest). */
export function nextStage(stage: ArcStage, arc: Pick<ArcProgress, 'strain' | 'lean' | 'evidence'>): ArcStage | null {
    if (arc.strain < STAGE_STRAIN) return null;
    if (stage === 'intact') return 'cracking';
    if (stage === 'cracking') return arc.evidence >= 1 ? 'glimpsed' : null;
    if (stage === 'glimpsed') {
        if (arc.lean >= RESOLVE_LEAN) return 'embraced';
        if (arc.lean <= -RESOLVE_LEAN) return 'rejected';
    }
    return null;
}

/** Whether `to` may follow `from`. */
export function validSuccessor(from: ArcStage, to: ArcStage): boolean {
    if (from === 'glimpsed') return to === 'embraced' || to === 'rejected';
    const index = ORDER.indexOf(from);
    return index >= 0 && index < ORDER.length - 1 && ORDER[index + 1] === to;
}

/** What one turn's note adds: strain, lean and evidence (key events and choices count as evidence). */
export function arcGains(note: PassCharacterNote): { strain: number; lean: number; evidence: number } {
    let strain = 0;
    let lean = 0;
    let evidence = 0;
    if (note.key) {
        strain += KEY_STRAIN;
        evidence += 1;
    }
    if (note.choice) {
        strain += CHOICE_STRAIN;
        lean += LEAN[note.choice.toward] ?? 0;
        evidence += 1;
    }
    for (const signal of note.strain ?? []) {
        strain += SIGNAL_STRAIN[signal] ?? 0;
        if (signal === 'lapse') lean += LAPSE_LEAN;
    }
    return { strain, lean, evidence };
}

/* ------------------------------------------------------------------ words */

type Pair = { en: string; ru: string; ruF?: string };

const LOG: Record<'choice' | 'choicePlain' | 'stage', Pair> = {
    choice: {
        en: '{name} chose «{kept}» over «{gave}»: {text}',
        ru: '{name} выбрал «{kept}», а не «{gave}»: {text}',
        ruF: '{name} выбрала «{kept}», а не «{gave}»: {text}',
    },
    choicePlain: { en: '{name} made a hard choice: {text}', ru: '{name}: трудный выбор — {text}' },
    stage: {
        en: '{name}: the arc moves — {from} → {to} ({text})',
        ru: '{name}: дуга сдвинулась — {from} → {to} ({text})',
    },
};

const PRESSED: Record<Lang, string> = { en: 'under strain', ru: 'под давлением' };

function fill(word: Pair, lang: Lang, params: Record<string, string>, gender?: Gender): string {
    const template = lang === 'en' ? word.en : gender === 'female' && word.ruF ? word.ruF : word.ru;
    return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in params ? params[key]! : whole));
}

function choiceLog(name: string, choice: PressureChoice, lang: Lang, gender?: Gender): string {
    const plain = !choice.kept.trim() || !choice.gave.trim();
    return fill(plain ? LOG.choicePlain : LOG.choice, lang, { name, ...choice }, gender);
}

/* ------------------------------------------------------------------ progress */

export interface ArcContext {
    /** Language of the story log and the step reasons (the UI). */
    lang: Lang;
}

export interface ArcsResult {
    state: ChatState;
    /** Steps to propose. */
    steps: ArcStep[];
    events: StateEvent[];
    /** Characters whose arc record changed. */
    changed: string[];
}

function canProcess(live: CharacterState | undefined, turn: number): boolean {
    return !!live && (live.arc?.turn ?? -1) < turn;
}

/** Whether the summary brings anything to the arcs (a choice, or strain for someone whose arc can move). */
export function arcsPending(
    state: ChatState,
    profiles: readonly CharacterProfile[],
    summary: PassSummary | undefined,
): boolean {
    if (!summary || summary.turn !== state.turn) return false;
    const byId = new Map(profiles.map((profile) => [profile.id, profile] as const));
    return Object.entries(summary.characters).some(([id, note]) => {
        const profile = byId.get(id);
        if (!profile || profile.kind !== 'character' || !canProcess(state.characters[id], summary.turn)) return false;
        return !!note.choice || (arcMoves(profile) && arcGains(note).strain > 0);
    });
}

/**
 * Moves the arcs by one committed turn (see the file header). Each character is processed once per turn (the arc
 * remembers the turn). Returns a new state, the steps to propose and the log lines (already in the state's log).
 */
export function progressArcs(
    state: ChatState,
    profiles: readonly CharacterProfile[],
    summary: PassSummary,
    ctx: ArcContext,
): ArcsResult {
    const next: ChatState = structuredClone(state);
    const byId = new Map(profiles.map((profile) => [profile.id, profile] as const));
    const steps: ArcStep[] = [];
    const events: StateEvent[] = [];
    const changed: string[] = [];
    const turn = summary.turn;
    for (const [id, note] of Object.entries(summary.characters)) {
        const profile = byId.get(id);
        const live = next.characters[id];
        if (!profile || profile.kind !== 'character' || !live || !canProcess(live, turn)) continue;
        const moves = arcMoves(profile);
        const gains = arcGains(note);
        if (!note.choice && (!moves || gains.strain <= 0)) continue;
        const arc: ArcProgress = live.arc ? { ...live.arc, choices: [...live.arc.choices] } : emptyArc(turn - 1);
        const event = (text: string): StateEvent => {
            const line: StateEvent = { turn, kind: 'arc', character: id, text };
            if (summary.messageIndex !== undefined) line.messageIndex = summary.messageIndex;
            return line;
        };

        if (note.choice) {
            const memory: ArcChoice = { ...note.choice, turn };
            if (summary.messageIndex !== undefined) memory.messageIndex = summary.messageIndex;
            arc.choices = [...arc.choices, memory].slice(-MAX_CHOICES);
            events.push(event(choiceLog(profile.name, note.choice, ctx.lang, profile.gender)));
        }
        if (moves) {
            arc.strain = Math.min(STRAIN_CAP, effectiveStrain(arc, turn - 1) + gains.strain);
            arc.lean = Math.round((arc.lean + gains.lean) * 100) / 100;
            arc.evidence += gains.evidence;
            const due = nextStage(live.arcStage, arc);
            const waiting = arc.proposed && arc.proposed.to === due && turn - arc.proposed.turn < PROPOSAL_LAPSE;
            if (due && !waiting) {
                const step: ArcStep = {
                    character: id,
                    from: live.arcStage,
                    to: due,
                    turn,
                    reason: note.key || note.choice?.text || PRESSED[ctx.lang],
                };
                if (summary.messageIndex !== undefined) step.messageIndex = summary.messageIndex;
                steps.push(step);
                arc.proposed = { to: due, turn };
            }
        }
        arc.turn = turn;
        live.arc = arc;
        changed.push(id);
    }
    appendLog(next, events);
    return { state: next, steps, events, changed };
}

/* ------------------------------------------------------------------ applying a step */

/** Whether a step still fits: the character is where it was proposed from. */
export function arcStepValid(state: ChatState, step: Pick<ArcStep, 'character' | 'from' | 'to'>): boolean {
    const live = state.characters[step.character];
    return !!live && live.arcStage === step.from && validSuccessor(step.from, step.to);
}

/**
 * The approved step: the stage moves, the strain and evidence start over for the next step (the lean stays: it decides
 * the ending), a story log line. Unchanged state (applied: false) when the step no longer fits.
 */
export function applyArcStage(
    state: ChatState,
    step: ArcStep,
    ctx: ArcContext & { profiles?: readonly CharacterProfile[] },
): { state: ChatState; applied: boolean; events: StateEvent[] } {
    if (!arcStepValid(state, step)) return { state, applied: false, events: [] };
    const next: ChatState = structuredClone(state);
    const live = next.characters[step.character]!;
    live.arcStage = step.to;
    const arc = live.arc ? { ...live.arc } : emptyArc(next.turn);
    arc.strain = 0;
    arc.evidence = 0;
    arc.turn = Math.max(arc.turn, next.turn);
    delete arc.proposed;
    live.arc = arc;
    const profile = ctx.profiles?.find((item) => item.id === step.character);
    const text = fill(
        LOG.stage,
        ctx.lang,
        {
            name: profile?.name ?? step.character,
            from: arcStageLabel(step.from, ctx.lang),
            to: arcStageLabel(step.to, ctx.lang),
            text: step.reason,
        },
        profile?.gender,
    );
    const event: StateEvent = { turn: next.turn, kind: 'arc', character: step.character, text };
    if (step.messageIndex !== undefined) event.messageIndex = step.messageIndex;
    appendLog(next, [event]);
    return { state: next, applied: true, events: [event] };
}

/** Undo of an applied step: back to `from` when the character is still at `to`. */
export function revertArcStage(
    state: ChatState,
    character: string,
    from: ArcStage,
    to: ArcStage,
): { state: ChatState; reverted: boolean } {
    const live = state.characters[character];
    if (!live || live.arcStage !== to || !validSuccessor(from, to)) return { state, reverted: false };
    const next: ChatState = structuredClone(state);
    next.characters[character]!.arcStage = from;
    return { state: next, reverted: true };
}

const STAGES: readonly ArcStage[] = ['intact', 'cracking', 'glimpsed', 'embraced', 'rejected'];

function isStage(value: unknown): value is ArcStage {
    return typeof value === 'string' && (STAGES as readonly string[]).includes(value);
}

/** An Inbox payload back into a step (null when it is not one). */
export function parseArcStep(payload: unknown): ArcStep | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const raw = payload as Record<string, unknown>;
    if (typeof raw.character !== 'string' || !raw.character || !isStage(raw.from) || !isStage(raw.to)) return null;
    if (!validSuccessor(raw.from, raw.to)) return null;
    const step: ArcStep = {
        character: raw.character,
        from: raw.from,
        to: raw.to,
        turn: typeof raw.turn === 'number' ? raw.turn : 0,
        reason: typeof raw.reason === 'string' ? raw.reason : '',
    };
    if (typeof raw.messageIndex === 'number') step.messageIndex = raw.messageIndex;
    return step;
}

/* ------------------------------------------------------------------ the motive card */

function quoted(text: string, lang: Lang): string {
    return lang === 'ru' ? `«${text}»` : `"${text}"`;
}

/** Where the arc stands, for the motive card (card language); '' while the lie holds. */
export function arcCardLine(
    profile: Pick<CharacterProfile, 'core' | 'gender'>,
    live: Pick<CharacterState, 'arcStage'> | undefined,
    lang: Lang,
): string {
    const stage = live?.arcStage ?? 'intact';
    if (stage === 'intact') return '';
    const lie = profile.core.wound?.lie?.replace(/\s+/g, ' ').trim();
    const need = profile.core.need?.replace(/\s+/g, ' ').trim();
    const f = profile.gender === 'female';
    if (lang === 'ru') {
        const belief = lie ? `старая вера (${quoted(lie, lang)})` : 'старая вера';
        const it = lie ? quoted(lie, lang) : 'старую веру';
        switch (stage) {
            case 'cracking':
                return `${belief} дала трещину — под давлением проступают сомнения`;
            case 'glimpsed':
                return `${f ? 'увидела' : 'увидел'}, что ${lie ? `${quoted(lie, lang)} — неправда` : 'старая вера лжёт'}; разрывается между старым и новым`;
            case 'embraced':
                return `${f ? 'отпустила' : 'отпустил'} ${it} — теперь действует из того, что нужно на деле${need ? ` (${need})` : ''}`;
            default:
                return `держится за ${it} крепче прежнего — правду ${f ? 'отвергла' : 'отверг'}`;
        }
    }
    const belief = lie ? `the old belief (${quoted(lie, lang)})` : 'the old belief';
    const it = lie ? quoted(lie, lang) : 'the old belief';
    switch (stage) {
        case 'cracking':
            return `${belief} is cracking — doubts show under pressure`;
        case 'glimpsed':
            return `has seen that ${lie ? `${quoted(lie, lang)} is false` : 'the old belief lies'} — torn between the old way and the new`;
        case 'embraced':
            return `has let go of ${it} — acts from what they truly need${need ? ` (${need})` : ''}`;
        default:
            return `clings to ${it} harder than ever — has turned away from the truth`;
    }
}

/** The latest revealed choice for the motive card (card language), '' when none. */
export function choiceCardLine(live: Pick<CharacterState, 'arc'> | undefined, lang: Lang): string {
    const choice = live?.arc?.choices.at(-1);
    if (!choice) return '';
    const text = choice.text
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[\s.;,]+$/u, '');
    if (!choice.kept.trim() || !choice.gave.trim()) return text;
    return lang === 'ru'
        ? `${quoted(choice.kept, lang)}, а не ${quoted(choice.gave, lang)} — ${text}`
        : `${choice.kept} over ${choice.gave} — ${text}`;
}
