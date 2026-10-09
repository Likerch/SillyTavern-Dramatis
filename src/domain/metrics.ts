// Measurements of docs/model.md §16 «Как поймём, что работает», counted per chat on committed turns:
// - the share of NPC dialogue lines addressed to the player (rule-based: lines in «…», “…”, "…" or dash dialogue that
//   name the player or speak to «you» — unless they name another character instead);
// - unprompted NPC initiative: moves the engine planned that are their own business, start something or get in the way
//   of someone other than the player;
// - drift findings per 20 turns and stance steps up and down (from the turn pass summary);
// - distinguishability of voices: the lexical overlap of a speaker's line with their own previous line against the
//   overlap with other speakers' last lines, as within / (within + across) — 0.5 when everyone sounds alike, toward 1
//   when each speaker keeps their own words. Speakers are found by the names in the narration around a line.
// Rough on purpose: the numbers are for comparing the same scenario with and without the engine. Pure.
import type { Lang } from './ladders';
import { PLAYER_ID } from './model';
import type { MetricsState, MetricsTurn, NextTurn, PassSummary } from './model';
import { matchName } from './presence';
import type { NamedProfile } from './presence';

/** Turns kept for the «recent» numbers. */
export const METRICS_WINDOW = 20;
/** Lines kept per speaker, speakers kept, words kept per line. */
export const VOICE_LINES = 3;
export const VOICE_SPEAKERS = 12;
export const LINE_WORDS = 30;
/** Moves that count as unprompted initiative (when not aimed at the player). */
export const INITIATIVE_MOVES: readonly string[] = ['own', 'initiate', 'obstruct'];

/* ------------------------------------------------------------------ dialogue */

/** A spoken line and where it stands in its paragraph. */
interface Speech {
    text: string;
    start: number;
    end: number;
}

export interface DialogueLine {
    text: string;
    /** Character id or PLAYER_ID, when the narration names who speaks. */
    speaker?: string;
    toPlayer: boolean;
}

const QUOTE_RE = /«([^«»]+)»|“([^“”]+)”|„([^„“”]+)[“”]|"([^"\n]+)"/g;
const DASH_START_RE = /^\s*(?:[—–]|-(?=\s))\s*/;
const DASH_SPLIT_RE = /\s[—–-]\s/g;
const WORD_RE = /[\p{L}][\p{L}\p{N}'’-]*/gu;
const SENTENCE_END_RE = /[.!?…]/;

/** Words that speak to «you», English and Russian (lower case, ё → е, apostrophes dropped). */
const SECOND_PERSON = new Set([
    'you',
    'your',
    'yours',
    'yourself',
    'yourselves',
    'youre',
    'youve',
    'youll',
    'youd',
    'ya',
    'yall',
    'ты',
    'тебя',
    'тебе',
    'тобой',
    'тобою',
    'твой',
    'твоя',
    'твое',
    'твои',
    'твоего',
    'твоей',
    'твоему',
    'твоим',
    'твоими',
    'твоих',
    'твою',
    'вы',
    'вас',
    'вам',
    'вами',
    'ваш',
    'ваша',
    'ваше',
    'ваши',
    'вашего',
    'вашей',
    'вашему',
    'вашим',
    'вашими',
    'ваших',
    'вашу',
]);

function fold(word: string): string {
    return word.toLowerCase().replace(/ё/g, 'е').replace(/['’]/g, '');
}

function isCapitalized(word: string): boolean {
    const first = word.charAt(0);
    return first !== first.toLowerCase() && first === first.toUpperCase();
}

/** Lower-case words of a line for the overlap (ё → е), the first LINE_WORDS. */
export function lineWords(text: string): string[] {
    const out: string[] = [];
    for (const match of text.matchAll(WORD_RE)) {
        const word = fold(match[0]);
        if (word.length >= 2) out.push(word);
        if (out.length >= LINE_WORDS) break;
    }
    return out;
}

/** Jaccard overlap of two word lists (as sets); 0 when either is empty. */
export function overlap(a: readonly string[], b: readonly string[]): number {
    if (!a.length || !b.length) return 0;
    const left = new Set(a);
    const right = new Set(b);
    let shared = 0;
    for (const word of left) if (right.has(word)) shared++;
    return shared / (left.size + right.size - shared);
}

/** Spoken lines of one paragraph: dash dialogue (speech and author's words alternate) or quoted lines. */
function speechesOf(paragraph: string): Speech[] {
    const dash = DASH_START_RE.exec(paragraph);
    if (dash) {
        const out: Speech[] = [];
        let start = dash[0].length;
        let speaking = true;
        const cuts = [...paragraph.slice(start).matchAll(DASH_SPLIT_RE)].map((m) => ({
            at: start + (m.index ?? 0),
            length: m[0].length,
        }));
        for (const cut of [...cuts, { at: paragraph.length, length: 0 }]) {
            if (speaking) {
                const text = paragraph.slice(start, cut.at).trim();
                if (text) out.push({ text, start, end: cut.at });
            }
            speaking = !speaking;
            start = cut.at + cut.length;
        }
        return out;
    }
    const out: Speech[] = [];
    for (const match of paragraph.matchAll(QUOTE_RE)) {
        const text = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? '').trim();
        const words = text.match(WORD_RE) ?? [];
        // A single word without punctuation is a name or a title («Рог»), not speech.
        if (!words.length || (words.length === 1 && !/[.!?…,]$/.test(text))) continue;
        const start = match.index ?? 0;
        out.push({ text, start, end: start + match[0].length });
    }
    return out;
}

interface Mention {
    id: string;
    start: number;
}

/** Names in the narration of a paragraph (outside the spoken lines), in order. */
function mentionsOf(paragraph: string, speeches: readonly Speech[], people: readonly NamedProfile[]): Mention[] {
    const out: Mention[] = [];
    for (const match of paragraph.matchAll(WORD_RE)) {
        const start = match.index ?? 0;
        if (speeches.some((speech) => start >= speech.start && start < speech.end)) continue;
        const word = match[0];
        if (word.length < 2) continue;
        const id = matchName(word, people);
        // Characters are named with a capital in prose; the player may be a role word («курьер»).
        if (id && (id === PLAYER_ID || isCapitalized(word))) out.push({ id, start });
    }
    return out;
}

/** Where the sentence holding `index` starts: after the last sentence end before it that is not inside a spoken line. */
function sentenceStart(paragraph: string, index: number, speeches: readonly Speech[]): number {
    for (let i = index - 1; i >= 0; i--) {
        if (SENTENCE_END_RE.test(paragraph[i]!) && !speeches.some((item) => i >= item.start && i < item.end))
            return i + 1;
    }
    return 0;
}

/**
 * Who speaks a line: the first name in the author's words right after it («…», — сказал Брам), else the first name of
 * its own sentence before it (Брам кивнул: «…»), else the first name of the last sentence before it that names
 * someone (Ильва вытерла стойку. «…»).
 */
function speakerOf(
    paragraph: string,
    speech: Speech,
    speeches: readonly Speech[],
    mentions: Mention[],
): string | undefined {
    const nextSpeech = speeches.find((item) => item.start >= speech.end)?.start ?? paragraph.length;
    let afterEnd = nextSpeech;
    const stop = paragraph.slice(speech.end, nextSpeech).search(SENTENCE_END_RE);
    if (stop >= 0) afterEnd = speech.end + stop;
    const after = mentions.find((mention) => mention.start >= speech.end && mention.start < afterEnd);
    if (after) return after.id;
    const before = mentions.filter((mention) => mention.start < speech.start);
    const own = sentenceStart(paragraph, speech.start, speeches);
    const inSentence = before.find((mention) => mention.start >= own);
    if (inSentence) return inSentence.id;
    const last = before.at(-1);
    if (!last) return undefined;
    const from = sentenceStart(paragraph, last.start, speeches);
    return before.find((mention) => mention.start >= from)?.id;
}

/**
 * The NPC lines of a reply with their speaker (when named) and whether they speak to the player. Lines the narration
 * gives to the player's character are left out.
 */
export function dialogueLines(reply: string, people: readonly NamedProfile[], playerName: string): DialogueLine[] {
    const player: NamedProfile = { id: PLAYER_ID, name: playerName.trim(), aliases: [] };
    const everyone = player.name ? [...people, player] : [...people];
    const out: DialogueLine[] = [];
    for (const paragraph of reply.split(/\n+/)) {
        const speeches = speechesOf(paragraph);
        if (!speeches.length) continue;
        const mentions = mentionsOf(paragraph, speeches, everyone);
        for (const speech of speeches) {
            const speaker = speakerOf(paragraph, speech, speeches, mentions);
            if (speaker === PLAYER_ID) continue;
            const words = speech.text.match(WORD_RE) ?? [];
            const namesPlayer = !!player.name && words.some((word) => matchName(word, [player]) === PLAYER_ID);
            const others = people.filter((person) => person.id !== speaker);
            const namesOther = words.some((word) => isCapitalized(word) && matchName(word, others) !== null);
            const second = words.some((word) => SECOND_PERSON.has(fold(word)));
            const line: DialogueLine = { text: speech.text, toPlayer: namesPlayer || (second && !namesOther) };
            if (speaker) line.speaker = speaker;
            out.push(line);
        }
    }
    return out;
}

/* ------------------------------------------------------------------ counting */

export function emptyMetrics(lastTurn = 0): MetricsState {
    return {
        lastTurn,
        turns: 0,
        totals: { lines: 0, toPlayer: 0, initiatives: 0, initiativeTurns: 0, drift: 0, up: 0, down: 0 },
        recent: [],
        voices: [],
        overlap: { within: 0, withinN: 0, across: 0, acrossN: 0 },
    };
}

export interface MetricsInput {
    /** The committed turn. */
    turn: number;
    /** The committed reply, cleaned. */
    reply: string;
    playerName: string;
    /** Present characters (the possible speakers). */
    people: readonly NamedProfile[];
    /** Moves the engine planned after this turn (`state.next.moves`). */
    moves?: NextTurn['moves'];
    summary?: PassSummary;
}

/** Unprompted moves: own business, starting something or getting in the way — of anyone but the player. */
export function countInitiatives(moves: NextTurn['moves'] | undefined): number {
    return Object.values(moves ?? {}).filter(
        (move) => INITIATIVE_MOVES.includes(move.move) && move.target !== PLAYER_ID,
    ).length;
}

function round(value: number): number {
    return Math.round(value * 10000) / 10000;
}

/** Counts one committed turn (once: a turn already counted leaves the record as it is). */
export function updateMetrics(previous: MetricsState | undefined, input: MetricsInput): MetricsState {
    const base = previous ?? emptyMetrics(input.turn - 1);
    if (base.lastTurn >= input.turn) return base;
    const metrics: MetricsState = structuredClone(base);
    const lines = dialogueLines(input.reply, input.people, input.playerName);
    const steps = input.summary?.turn === input.turn ? input.summary.steps : [];
    const record: MetricsTurn = {
        turn: input.turn,
        lines: lines.length,
        toPlayer: lines.filter((line) => line.toPlayer).length,
        initiatives: countInitiatives(input.moves),
        drift: input.summary?.turn === input.turn ? input.summary.drift.length : 0,
        up: steps.filter((step) => step.to > step.from).length,
        down: steps.filter((step) => step.to < step.from).length,
    };
    const totals = metrics.totals;
    totals.lines += record.lines;
    totals.toPlayer += record.toPlayer;
    totals.initiatives += record.initiatives;
    if (record.initiatives > 0) totals.initiativeTurns += 1;
    totals.drift += record.drift;
    totals.up += record.up;
    totals.down += record.down;
    metrics.recent = [...metrics.recent, record].slice(-METRICS_WINDOW);

    for (const line of lines) {
        if (!line.speaker) continue;
        const words = lineWords(line.text);
        if (!words.length) continue;
        const own = metrics.voices.find((voice) => voice.id === line.speaker);
        const last = own?.lines.at(-1);
        if (last) {
            metrics.overlap.within = round(metrics.overlap.within + overlap(words, last));
            metrics.overlap.withinN += 1;
        }
        for (const voice of metrics.voices) {
            const theirs = voice.lines.at(-1);
            if (voice.id === line.speaker || !theirs) continue;
            metrics.overlap.across = round(metrics.overlap.across + overlap(words, theirs));
            metrics.overlap.acrossN += 1;
        }
        const kept = { id: line.speaker, lines: [...(own?.lines ?? []), words].slice(-VOICE_LINES) };
        metrics.voices = [...metrics.voices.filter((voice) => voice.id !== line.speaker), kept].slice(-VOICE_SPEAKERS);
    }
    metrics.turns += 1;
    metrics.lastTurn = input.turn;
    return metrics;
}

/* ------------------------------------------------------------------ the report */

export interface MetricsReport {
    turns: number;
    lines: number;
    toPlayer: number;
    /** Share of NPC lines addressed to the player, all turns and the recent window; null without lines. */
    share: number | null;
    recentTurns: number;
    recentLines: number;
    recentShare: number | null;
    /** Unprompted NPC moves per 10 turns; turns of the window that had at least one. */
    initiativesPer10: number | null;
    recentInitiativeTurns: number;
    /** Drift findings in the window, and per 20 turns over the whole chat. */
    recentDrift: number;
    driftPer20: number | null;
    up: number;
    down: number;
    /** within / (within + across); null until both kinds of pairs were seen. */
    distinguishability: number | null;
}

export function metricsReport(metrics: MetricsState | undefined): MetricsReport {
    const m = metrics ?? emptyMetrics();
    const recent = m.recent;
    const sum = (key: keyof Omit<MetricsTurn, 'turn'>) => recent.reduce((total, item) => total + item[key], 0);
    const recentLines = sum('lines');
    const within = m.overlap.withinN ? m.overlap.within / m.overlap.withinN : null;
    const across = m.overlap.acrossN ? m.overlap.across / m.overlap.acrossN : null;
    let distinguishability: number | null = null;
    if (within !== null && across !== null) {
        distinguishability = within + across > 0 ? within / (within + across) : 0.5;
    }
    return {
        turns: m.turns,
        lines: m.totals.lines,
        toPlayer: m.totals.toPlayer,
        share: m.totals.lines ? m.totals.toPlayer / m.totals.lines : null,
        recentTurns: recent.length,
        recentLines,
        recentShare: recentLines ? sum('toPlayer') / recentLines : null,
        initiativesPer10: m.turns ? (m.totals.initiatives / m.turns) * 10 : null,
        recentInitiativeTurns: recent.filter((item) => item.initiatives > 0).length,
        recentDrift: sum('drift'),
        driftPer20: m.turns ? (m.totals.drift / m.turns) * 20 : null,
        up: m.totals.up,
        down: m.totals.down,
        distinguishability: distinguishability === null ? null : Math.round(distinguishability * 100) / 100,
    };
}

/** One row of the report in words. */
export interface MetricsRow {
    key: 'turns' | 'share' | 'initiative' | 'drift' | 'stances' | 'voices';
    label: string;
    value: string;
    hint: string;
}

function decimal(value: number, lang: Lang, digits = 1): string {
    const text = (Math.round(value * 10 ** digits) / 10 ** digits).toFixed(digits);
    return lang === 'ru' ? text.replace('.', ',') : text;
}

function percent(value: number): string {
    return `${Math.round(value * 100)}%`;
}

/** The report as rows of story words in the UI language (the sheet's «Замеры» page and /dramatis-stats). */
export function metricsRows(report: MetricsReport, lang: Lang): MetricsRow[] {
    const ru = lang === 'ru';
    const none = ru ? 'пока нет данных' : 'no data yet';
    const window = report.recentTurns;
    const share =
        report.share === null
            ? none
            : ru
              ? `${percent(report.share)} (${report.toPlayer} из ${report.lines})${report.recentShare !== null ? ` · за последние ${window}: ${percent(report.recentShare)}` : ''}`
              : `${percent(report.share)} (${report.toPlayer} of ${report.lines})${report.recentShare !== null ? ` · last ${window} turns: ${percent(report.recentShare)}` : ''}`;
    const initiative =
        report.initiativesPer10 === null
            ? none
            : ru
              ? `${decimal(report.initiativesPer10, lang)} на 10 ходов (ходов с инициативой — ${report.recentInitiativeTurns} из последних ${window})`
              : `${decimal(report.initiativesPer10, lang)} per 10 turns (${report.recentInitiativeTurns} of the last ${window} turns had one)`;
    const drift =
        report.driftPer20 === null
            ? none
            : ru
              ? `${report.recentDrift} за последние ${window} (в среднем ${decimal(report.driftPer20, lang)} на 20 ходов)`
              : `${report.recentDrift} in the last ${window} turns (${decimal(report.driftPer20, lang)} per 20 turns on average)`;
    const voices =
        report.distinguishability === null
            ? ru
                ? 'пока мало реплик'
                : 'not enough lines yet'
            : decimal(report.distinguishability, lang, 2);
    return [
        {
            key: 'turns',
            label: ru ? 'Учтено ходов' : 'Turns counted',
            value: String(report.turns),
            hint: ru
                ? 'Считаются только отправленные ходы: свайпы и правки ничего не добавляют.'
                : 'Only committed turns count: swipes and edits add nothing.',
        },
        {
            key: 'share',
            label: ru ? 'Реплики NPC, обращённые к тебе' : 'NPC lines addressed to you',
            value: share,
            hint: ru
                ? 'С движком доля падает: занятые своим говорят друг с другом, а не с тобой.'
                : 'With the engine the share falls: characters busy with their own talk to each other, not to you.',
        },
        {
            key: 'initiative',
            label: ru ? 'Инициатива NPC' : 'NPC initiative',
            value: initiative,
            hint: ru
                ? 'Ходы по своей повестке без повода от тебя. Цель — хотя бы один на каждые 10 ходов.'
                : 'Moves on their own agenda with no prompt from you. Goal: at least one per 10 turns.',
        },
        {
            key: 'drift',
            label: ru ? 'Дрейф' : 'Drift',
            value: drift,
            hint: ru
                ? 'Ответы, где персонаж повёл себя не так, как его держит движок. Чем реже, тем лучше.'
                : 'Replies that played a character against the engine. The rarer, the better.',
        },
        {
            key: 'stances',
            label: ru ? 'Перемены отношений' : 'Stance changes',
            value: ru
                ? `теплее — ${report.up}, холоднее — ${report.down}`
                : `warmer ${report.up}, colder ${report.down}`,
            hint: ru
                ? 'Шаги отношений после событий. Враждебный по замыслу без сработавших ключей остаётся враждебным.'
                : 'Stance steps after events. Someone hostile by design stays hostile unless a key fires.',
        },
        {
            key: 'voices',
            label: ru ? 'Различимость голосов' : 'Distinguishable voices',
            value: voices,
            hint: ru
                ? '0,5 — голоса сливаются; ближе к 1 — легко узнать, кто говорит.'
                : '0.5 — voices blur together; closer to 1 — easy to tell who speaks.',
        },
    ];
}
