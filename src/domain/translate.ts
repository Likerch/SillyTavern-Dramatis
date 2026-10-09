// Display translation of Dramatis' free text. Dramatis stores descriptive text in English by design: the intent
// reading, the generator and the turn passes write concepts, roles, doings, goals, reasons, behaviour, signatures,
// tactics, wounds, schemes… as English sentences with the names as the story writes them, and the motive card stays
// English with Russian names. What the player reads — the «Лист замысла» window and DRAMATIS_API.describe (Maestro's
// «Dramatis» tab in DES) — is shown in Russian when the story is Russian: every English string is translated once by
// the background model (task 'dramatis.translate') and kept in a per-card cache, hash of the cleaned English → Russian.
// Russian text (a user's own edit) is never translated. Pure: the display language, which strings need translating,
// the cache document, the batches, the prompt and the reading of the reply.
import { hashText } from './intent-prompt';
import type { CardProfiles, CharacterProfile, CharacterState, ChatState, Tie } from './model';
import type { LlmMessage } from '../shared/contracts';

export const TRANSLATE_TASK = 'dramatis.translate';
export const TRANSLATE_SCHEMA_NAME = 'dramatis_translation';
/** Schema of the cache document. */
export const TRANSLATIONS_SCHEMA = 1;
/** Entries one card keeps: the least recently used go first. */
export const MAX_ENTRIES = 2000;
/** One request translates at most this many strings… */
export const BATCH_ITEMS = 40;
/** …of at most this many characters together (a longer single string goes alone). */
export const BATCH_CHARS = 3500;
/** Longer strings are shown as stored (no field of Dramatis is this long). */
export const MAX_SOURCE = 800;

export type DisplayLanguage = 'ru' | 'en';

/**
 * The language free text is shown in: the user's choice («Язык описаний в окнах»), else the story's language as
 * Maestro reports it, else the UI language.
 */
export function displayLanguage(
    choice: 'auto' | 'ru' | 'en' | undefined,
    story: unknown,
    ui: DisplayLanguage,
): DisplayLanguage {
    if (choice === 'ru' || choice === 'en') return choice;
    if (story === 'ru' || story === 'en') return story;
    return ui;
}

/* ------------------------------------------------------------------ which strings */

/** One line, trimmed, without trailing full stops or commas: the form a translation is keyed and shown by. */
export function normalizeSource(text: string): string {
    return text
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[\s.;,]+$/u, '');
}

/** The cache key of a string: the hash of its normalized form. */
export function translationKey(text: string): string {
    return hashText(normalizeSource(text));
}

const LATIN = /[A-Za-z]/;
const CYRILLIC = /[Ѐ-ӿ]/;

interface Script {
    /** Words starting with a lower-case Latin / Cyrillic letter: the prose (names are capitalised). */
    latinWords: number;
    cyrillicWords: number;
    latin: number;
    cyrillic: number;
}

function script(text: string): Script {
    const out: Script = { latinWords: 0, cyrillicWords: 0, latin: 0, cyrillic: 0 };
    for (const char of text) {
        if (LATIN.test(char)) out.latin++;
        else if (CYRILLIC.test(char)) out.cyrillic++;
    }
    for (const match of text.matchAll(/\p{L}+/gu)) {
        const first = match[0][0] ?? '';
        if (first === first.toUpperCase()) continue;
        if (LATIN.test(first)) out.latinWords++;
        else if (CYRILLIC.test(first)) out.cyrillicWords++;
    }
    return out;
}

/**
 * The language of a short text: English prose with Russian names («Wants Сота out of this town») is English, Russian
 * prose with an English name («Не доверяет Kael») Russian. Lower-case words decide (names are capitalised); a text of
 * names only goes by its letters. null when it has no letters of either.
 */
export function textLanguage(text: string): DisplayLanguage | null {
    const counts = script(text);
    if (counts.latin + counts.cyrillic === 0) return null;
    if (counts.latinWords + counts.cyrillicWords > 0) return counts.latinWords > counts.cyrillicWords ? 'en' : 'ru';
    return counts.latin > counts.cyrillic ? 'en' : 'ru';
}

/** English free text worth translating: not Russian, not a stray letter, not unreasonably long. */
export function needsTranslation(text: string | null | undefined): boolean {
    if (typeof text !== 'string') return false;
    const clean = normalizeSource(text);
    if (clean.length < 2 || clean.length > MAX_SOURCE || !/[A-Za-z]{2}/.test(clean)) return false;
    return textLanguage(clean) === 'en';
}

/**
 * A line with English parts in quotes or brackets (the story log: «Ильва → Курьер: новая причина «paid generously»
 * (теплее)»): the whole line through `tr` when its frame — the line without those parts — is English, else each
 * English «…» and (…) part.
 */
export function translateSegments(text: string, tr: (part: string) => string): string {
    const frame = text.replace(/«[^«»]*»/g, '«»').replace(/\([^()]*\)/g, '()');
    if (needsTranslation(frame)) return tr(text);
    return text
        .replace(/«([^«»]+)»/g, (whole, inner: string) => (needsTranslation(inner) ? `«${tr(inner)}»` : whole))
        .replace(/\(([^()]+)\)/g, (whole, inner: string) => (needsTranslation(inner) ? `(${tr(inner)})` : whole));
}

/* ------------------------------------------------------------------ the cache document */

export interface TranslationEntry {
    ru: string;
    /** Last written or used (ms): the oldest go first when the cache is full. */
    at: number;
}

/** `dramatis-card-<hash>-ru.json`: the translations of one card's free text (its characters, its chats' extras). */
export interface TranslationDoc {
    schema: number;
    card: string;
    entries: Record<string, TranslationEntry>;
}

export function emptyTranslations(card: string): TranslationDoc {
    return { schema: TRANSLATIONS_SCHEMA, card, entries: {} };
}

function isDict(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** A stored document, tolerant of damage: malformed entries are dropped, the size bounded. */
export function readTranslations(raw: unknown, card: string): TranslationDoc {
    const doc = emptyTranslations(card);
    const entries = isDict(raw) && isDict(raw.entries) ? raw.entries : {};
    for (const [key, value] of Object.entries(entries)) {
        if (!isDict(value) || typeof value.ru !== 'string' || !value.ru.trim()) continue;
        const at = typeof value.at === 'number' && Number.isFinite(value.at) ? value.at : 0;
        doc.entries[key] = { ru: value.ru, at };
    }
    boundTranslations(doc);
    return doc;
}

/** The cached Russian of an English text; `now` marks the entry as used (it stays when the cache is trimmed). */
export function lookupTranslation(doc: TranslationDoc, text: string, now?: number): string | undefined {
    const entry = doc.entries[translationKey(text)];
    if (!entry) return undefined;
    if (now !== undefined) entry.at = now;
    return entry.ru;
}

/** Stores translations (key → Russian); returns how many were new or different. The size stays bounded. */
export function storeTranslations(
    doc: TranslationDoc,
    items: readonly { key: string; ru: string }[],
    now: number,
    max = MAX_ENTRIES,
): number {
    let changed = 0;
    for (const item of items) {
        const before = doc.entries[item.key];
        if (before?.ru !== item.ru) changed++;
        doc.entries[item.key] = { ru: item.ru, at: now };
    }
    boundTranslations(doc, max);
    return changed;
}

/** Drops the least recently used entries above `max`; returns how many went. */
export function boundTranslations(doc: TranslationDoc, max = MAX_ENTRIES): number {
    const keys = Object.keys(doc.entries);
    if (keys.length <= max) return 0;
    const oldest = keys
        .map((key) => ({ key, at: doc.entries[key]!.at }))
        .sort((a, b) => a.at - b.at)
        .slice(0, keys.length - max);
    for (const { key } of oldest) delete doc.entries[key];
    return oldest.length;
}

/** Two copies of one card's cache (another tab wrote it meanwhile): per key the newer entry wins, then bounded. */
export function mergeTranslations(ours: TranslationDoc, theirs: TranslationDoc, max = MAX_ENTRIES): TranslationDoc {
    const merged: TranslationDoc = { schema: TRANSLATIONS_SCHEMA, card: ours.card, entries: { ...theirs.entries } };
    for (const [key, entry] of Object.entries(ours.entries)) {
        const other = merged.entries[key];
        if (!other || other.at <= entry.at) merged.entries[key] = entry;
    }
    boundTranslations(merged, max);
    return merged;
}

/* ------------------------------------------------------------------ batches */

/** A string shown to the player, with whom it is about (name and gender: the Russian endings depend on it). */
export interface TranslationSource {
    text: string;
    who?: string;
}

export interface BatchItem {
    /** '1', '2'… within its batch. */
    id: string;
    key: string;
    /** The normalized English. */
    text: string;
    who?: string;
}

export interface BatchOptions {
    /** Keys to leave out: cached, already being translated, failed a moment ago. */
    skip?: (key: string) => boolean;
    maxItems?: number;
    maxChars?: number;
    /** Batches at most; the rest waits for the next time. */
    maxBatches?: number;
}

/** «Ильва (she)», «Брам (he)», «стража (group)»: whom a note is about, for the Russian endings. */
export function whoOf(profile: Pick<CharacterProfile, 'name' | 'gender' | 'kind'>): string {
    const mark =
        profile.kind === 'group'
            ? 'group'
            : profile.gender === 'female'
              ? 'she'
              : profile.gender === 'male'
                ? 'he'
                : '';
    return mark ? `${profile.name} (${mark})` : profile.name;
}

/**
 * The English strings among `sources` that still need a translation, deduplicated (a later source may add the `who`
 * an earlier one lacked), packed in order into batches of at most `maxItems` strings and `maxChars` characters.
 */
export function buildBatches(sources: readonly TranslationSource[], options: BatchOptions = {}): BatchItem[][] {
    const maxItems = Math.max(1, options.maxItems ?? BATCH_ITEMS);
    const maxChars = Math.max(1, options.maxChars ?? BATCH_CHARS);
    const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY;
    const wanted = new Map<string, Omit<BatchItem, 'id'>>();
    for (const source of sources) {
        if (!source || !needsTranslation(source.text)) continue;
        const text = normalizeSource(source.text);
        const key = hashText(text);
        const known = wanted.get(key);
        if (known) {
            if (!known.who && source.who) known.who = source.who;
            continue;
        }
        if (options.skip?.(key)) continue;
        const item: Omit<BatchItem, 'id'> = { key, text };
        if (source.who) item.who = source.who;
        wanted.set(key, item);
    }
    const batches: BatchItem[][] = [];
    let batch: BatchItem[] = [];
    let chars = 0;
    for (const item of wanted.values()) {
        const size = item.text.length + (item.who?.length ?? 0);
        if (batch.length && (batch.length >= maxItems || chars + size > maxChars)) {
            batches.push(batch);
            if (batches.length >= maxBatches) return batches;
            batch = [];
            chars = 0;
        }
        batch.push({ id: String(batch.length + 1), ...item });
        chars += size;
    }
    if (batch.length && batches.length < maxBatches) batches.push(batch);
    return batches;
}

/* ------------------------------------------------------------------ the request */

export const TRANSLATE_SCHEMA: Record<string, unknown> = {
    type: 'object',
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                properties: { id: { type: 'string' }, ru: { type: 'string' } },
                required: ['id', 'ru'],
                additionalProperties: false,
            },
        },
    },
    required: ['items'],
    additionalProperties: false,
};

const SYSTEM_PROMPT = [
    'You translate short notes about the characters of a role-play story from English into Russian. The player reads them in the character sheet; the story itself is told in Russian.',
    'Rules:',
    '- Natural, idiomatic Russian, the way a Russian novel would put it. Keep the meaning and the tone; do not soften anything.',
    '- Keep it short: about as long as the original. A fragment stays a fragment, a list stays a list. Add nothing, explain nothing, leave nothing out.',
    '- Names of people, places and groups: as the story writes them. Use the Russian forms given in "names"; a word already in Russian stays as it is (decline it as the sentence needs).',
    '- "who" tells whom a note is about (she, he or a group): use it for the endings of verbs and adjectives.',
    '- "the player" is the player\'s character: «игрок» in the right case.',
    'Reply with JSON only: {"items":[{"id":"<id>","ru":"<the translation>"}]}, one item for every id you were given.',
].join('\n');

/**
 * Russian names of the English ones in the batch («Ilva = Ильва»): the cast's English names and Latin aliases that
 * occur in the texts, written as the story writes them.
 */
export function nameHints(
    profiles: readonly Pick<CharacterProfile, 'name' | 'english' | 'aliases'>[],
    texts: readonly string[],
    max = 30,
): string[] {
    const haystack = texts.join('\n').toLowerCase();
    const out: string[] = [];
    const seen = new Set<string>();
    for (const profile of profiles) {
        const name = profile.name?.trim();
        if (!name || textLanguage(name) !== 'ru') continue;
        for (const form of [profile.english, ...(profile.aliases ?? [])]) {
            const english = form?.trim();
            if (!english || !LATIN.test(english) || CYRILLIC.test(english)) continue;
            const key = english.toLowerCase();
            if (seen.has(key) || !containsWord(haystack, key)) continue;
            seen.add(key);
            out.push(`${english} = ${name}`);
            if (out.length >= max) return out;
        }
    }
    return out;
}

function containsWord(haystack: string, word: string): boolean {
    let from = 0;
    for (;;) {
        const at = haystack.indexOf(word, from);
        if (at < 0) return false;
        const before = at > 0 ? haystack[at - 1]! : ' ';
        const after = haystack[at + word.length] ?? ' ';
        if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
        from = at + 1;
    }
}

/** The system rules and the batch as JSON: `names` (when any) and `items` [{id, text, who?}]. */
export function translateMessages(batch: readonly BatchItem[], names: readonly string[] = []): LlmMessage[] {
    const payload: Record<string, unknown> = {};
    if (names.length) payload.names = names;
    payload.items = batch.map((item) =>
        item.who ? { id: item.id, text: item.text, who: item.who } : { id: item.id, text: item.text },
    );
    return [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(payload) },
    ];
}

/** Answer budget: Russian runs a little longer than English and costs more tokens per character. */
export function translateMaxTokens(batch: readonly BatchItem[]): number {
    const chars = batch.reduce((sum, item) => sum + item.text.length, 0);
    return Math.min(4000, Math.max(300, Math.ceil(chars * 0.7) + 15 * batch.length + 100));
}

/* ------------------------------------------------------------------ the reply */

export interface ParsedTranslations {
    /** Usable translations by cache key. */
    translated: { key: string; ru: string }[];
    /** Keys of the batch without a usable translation (missing, not Russian, much longer than the original). */
    missing: string[];
}

const WRAPPERS: [string, string][] = [
    ['«', '»'],
    ['"', '"'],
    ['“', '”'],
    ['„', '“'],
];

/** The translation as it is kept: quotes the original did not have removed, then normalized like a source. */
function cleanTranslation(ru: string, source: string): string {
    let text = ru.replace(/\s+/g, ' ').trim();
    for (const [open, close] of WRAPPERS) {
        if (text.length > 2 && text.startsWith(open) && text.endsWith(close) && !source.startsWith(open)) {
            text = text.slice(open.length, text.length - close.length).trim();
            break;
        }
    }
    return normalizeSource(text);
}

/**
 * Reads the model's answer ({items:[{id, ru}]}, or its JSON text) against the batch: unknown ids and repeats are
 * ignored; a translation counts only when it reads as Russian and is not padded far beyond the original.
 */
export function parseTranslations(data: unknown, batch: readonly BatchItem[]): ParsedTranslations {
    let value = data;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value) as unknown;
        } catch {
            value = undefined;
        }
    }
    const byId = new Map(batch.map((item) => [item.id, item] as const));
    const done = new Map<string, string>();
    const items = isDict(value) && Array.isArray(value.items) ? value.items : [];
    for (const raw of items) {
        if (!isDict(raw)) continue;
        const id = typeof raw.id === 'string' ? raw.id.trim() : typeof raw.id === 'number' ? String(raw.id) : '';
        const item = byId.get(id);
        if (!item || done.has(item.key) || typeof raw.ru !== 'string') continue;
        const ru = cleanTranslation(raw.ru, item.text);
        if (!ru || textLanguage(ru) !== 'ru' || ru.length > item.text.length * 2.5 + 40) continue;
        done.set(item.key, ru);
    }
    return {
        translated: [...done].map(([key, ru]) => ({ key, ru })),
        missing: batch.filter((item) => !done.has(item.key)).map((item) => item.key),
    };
}

/* ------------------------------------------------------------------ everything of a card */

function push(out: TranslationSource[], who: string | undefined, ...texts: (string | null | undefined)[]): void {
    for (const text of texts) {
        if (typeof text === 'string' && text.trim()) out.push(who ? { text, who } : { text });
    }
}

function tieSources(out: TranslationSource[], who: string, tie: Tie | undefined): void {
    if (!tie) return;
    push(out, who, ...(tie.reasons ?? []).map((reason) => reason.text), tie.behaviour);
    push(out, who, ...(tie.evaluations ?? []), ...(tie.debts ?? []), ...(tie.encounters ?? []));
    push(out, who, ...(tie.beliefs ?? []).map((belief) => belief.claim));
}

/**
 * Every free text of one character the sheet can show: identity, core, appetites, agenda and ties of the profile, and
 * the live state of this chat (scene, mood, emotion, agenda and ties as the story moved them, corruption marks).
 */
export function characterSources(profile: CharacterProfile, live?: CharacterState): TranslationSource[] {
    const out: TranslationSource[] = [];
    const who = whoOf(profile);
    const core = profile.core;
    push(out, who, profile.role, profile.species, core.concept, core.want, core.need, core.moralWeakness);
    push(out, who, core.baselineMood?.label, core.wound?.ghost, core.wound?.lie, ...(core.wound?.triggers ?? []));
    push(out, who, ...(core.signatures ?? []), ...(core.tactics ?? []), ...(core.keys ?? []));
    push(out, who, ...(core.redLines?.never ?? []), ...(core.redLines?.would ?? []));
    for (const appetite of profile.appetites ?? []) {
        push(out, who, appetite.label, appetite.excuse, ...(appetite.triggers ?? []), ...(appetite.restraints ?? []));
        push(out, who, ...(appetite.satisfiers ?? []).map((satisfier) => satisfier.what));
        if (appetite.target.mode === 'class') push(out, who, appetite.target.class);
    }
    for (const agenda of live ? [profile.agenda, live.agenda] : [profile.agenda]) {
        push(out, who, agenda.dream, agenda.ifIgnored, ...(agenda.goals ?? []).map((goal) => goal.text));
        for (const intention of agenda.intentions ?? []) {
            push(out, who, intention.text, intention.nextStep, ...(intention.dropIf ?? []));
        }
        push(out, who, ...(agenda.resources ?? []), ...(agenda.leverage ?? []), ...(agenda.secrets ?? []));
        if (agenda.front) push(out, who, agenda.front.impulse, agenda.front.doom, ...(agenda.front.steps ?? []));
    }
    for (const start of profile.starts ?? []) push(out, who, start.doing, start.goal);
    for (const tie of profile.ties ?? []) tieSources(out, who, tie);
    if (live) {
        for (const tie of Object.values(live.ties ?? {})) tieSources(out, who, tie);
        push(out, who, live.mood?.label, live.emotion?.type, live.emotion?.cause);
        push(out, who, live.scene?.doing, live.scene?.goal, live.scene?.obstacle, live.scene?.moveText);
        push(out, who, ...(live.corruption?.gifts ?? []), ...(live.corruption?.brands ?? []));
    }
    return out;
}

/**
 * Everything the player can read about a card in one chat: every character (the card's and the chat's extras) with
 * its live state, the schemes, the group rules, the reputation and its seeds, the rumours and the invariants.
 */
export function cardSources(card: CardProfiles, state: ChatState | null): TranslationSource[] {
    const out: TranslationSource[] = [];
    const profiles = [...card.characters, ...(state?.extras ?? [])];
    const names = new Map(profiles.map((profile) => [profile.id, whoOf(profile)] as const));
    for (const profile of profiles) out.push(...characterSources(profile, state?.characters[profile.id]));
    for (const scheme of state?.schemes ?? []) push(out, names.get(scheme.owner), scheme.text);
    for (const rule of [...card.rules, ...(state?.rules ?? [])]) push(out, undefined, rule.holders, rule.label);
    for (const seed of card.reputation) push(out, undefined, seed.among, seed.label);
    for (const item of state?.reputation ?? []) {
        push(out, undefined, item.among, item.label, ...(item.weaknesses ?? []), ...(item.reasons ?? []));
    }
    for (const rumour of state?.rumours ?? []) push(out, undefined, rumour.text);
    push(out, undefined, ...card.invariants);
    return out;
}
