// Doom's Enhancement Suite tracker data, read-only (ported from Maestro src/domain/des-tracker.ts; DES 2.6.0
// sceneHeaders.js, thoughts.js, characterSheet.js). DES stores JSON strings per message and swipe (quests, infoBox,
// characterThoughts); models and DES versions produce several shapes of each, so every reader here accepts the flat
// and nested forms DES's own renderers accept. Pure: parsed objects are never shared with DES.

/** Raw per-swipe record: JSON strings as DES stores them (or already-parsed values, or null). */
export interface DesTrackerStrings {
    quests: unknown;
    infoBox: unknown;
    characterThoughts: unknown;
}

export interface ParsedDesCharacter {
    name: string;
    /**
     * Per-character fields as stored: `toSnakeCase(field name)` keys for English fields, the field name itself for
     * Cyrillic ones (DES-RU restores them). Values flattened to text.
     */
    details: Record<string, string>;
    /** Relationship status (`relationship.status`, a flat `relationship` string or the legacy `Relationship`). */
    relationship?: string;
    thoughts?: string;
    /** `present: false`, or thoughts that DES (English phrases) or DES-RU (`(off-scene)`) mark as off-scene. */
    offScene: boolean;
}

export interface ParsedDesScene {
    location?: string;
    date?: string;
    time?: { start?: string; end?: string };
}

/** DES's English off-scene detector (portraitBar.js getCharacterList); it also matches DES-RU's `(off-scene)`. */
const OFF_SCENE_RE =
    /\b(not\s+(currently\s+)?(in|at|present\s+in|present\s+at)\s+(the\s+)?(scene|area|room|location|vicinity))\b|\b(off[\s-]?scene)\b|\b(not\s+physically\s+present)\b|\b(absent\s+from\s+(the\s+)?(scene|room|area|location))\b|\b(away\s+from\s+(the\s+)?scene)\b/i;
const FENCE_RE = /^```[a-z]*\s*\n?([\s\S]*?)\n?```$/i;

type Dict = Record<string, unknown>;

export function isDict(value: unknown): value is Dict {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Trims and drops brackets that wrap the whole value (`[Friend]`), as DES's renderers do. */
function clean(value: string): string {
    let result = value.trim();
    while (result.length >= 2 && result.startsWith('[') && result.endsWith(']')) result = result.slice(1, -1).trim();
    return result;
}

/** Text of a scalar or of `{value}` / `{text}` / `{description}`; arrays joined with ", ". Empty → undefined. */
function textOf(value: unknown): string | undefined {
    if (typeof value === 'string') return clean(value) || undefined;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
        const parts = value.map(textOf).filter((part): part is string => !!part);
        return parts.length ? parts.join(', ') : undefined;
    }
    if (isDict(value)) {
        for (const key of ['value', 'text', 'description', 'content', 'title']) {
            const inner = textOf(value[key]);
            if (inner) return inner;
        }
    }
    return undefined;
}

/**
 * Parses one tracker section. Strings are JSON (optionally inside a ``` fence); already-parsed values pass through;
 * anything unparseable gives null (DES's legacy text formats are not read).
 */
export function parseTrackerJson(raw: unknown): unknown {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'string') return raw;
    let source = raw.trim();
    if (!source) return null;
    const fenced = FENCE_RE.exec(source);
    if (fenced?.[1] !== undefined) source = fenced[1].trim();
    try {
        return JSON.parse(source) as unknown;
    } catch {
        return null;
    }
}

function detailsOf(raw: unknown): Record<string, string> {
    const details: Record<string, string> = {};
    if (!isDict(raw)) return details;
    for (const [key, value] of Object.entries(raw)) {
        const text = textOf(value);
        if (key && text) details[key] = text;
    }
    return details;
}

function relationshipOf(entry: Dict): string | undefined {
    if (typeof entry.Relationship === 'string') return clean(entry.Relationship) || undefined;
    const relationship = entry.relationship;
    if (isDict(relationship)) return textOf(relationship.status) ?? textOf(relationship);
    return textOf(relationship);
}

function thoughtsOf(entry: Dict): string | undefined {
    const thoughts = entry.thoughts;
    if (isDict(thoughts)) return textOf(thoughts.content) ?? textOf(thoughts);
    return textOf(thoughts);
}

function characterOf(raw: unknown): ParsedDesCharacter | null {
    if (!isDict(raw) || typeof raw.name !== 'string' || !raw.name.trim()) return null;
    const thoughts = thoughtsOf(raw);
    const character: ParsedDesCharacter = {
        name: raw.name.trim(),
        details: detailsOf(raw.details),
        offScene: raw.present === false || (thoughts !== undefined && OFF_SCENE_RE.test(thoughts)),
    };
    const relationship = relationshipOf(raw);
    if (relationship) character.relationship = relationship;
    if (thoughts) character.thoughts = thoughts;
    return character;
}

/**
 * Characters from `characterThoughts`: an array (DES 2.6 parse) or `{characters: [...]}` (legacy, defaults).
 * Null when the section is missing or not JSON (as opposed to [] = the tracker lists nobody).
 */
export function parseDesCharacters(raw: unknown): ParsedDesCharacter[] | null {
    const data = parseTrackerJson(raw);
    if (data === null) return null;
    const list = Array.isArray(data) ? data : isDict(data) && Array.isArray(data.characters) ? data.characters : null;
    if (list === null) return null;
    const characters: ParsedDesCharacter[] = [];
    for (const item of list) {
        const character = characterOf(item);
        if (character) characters.push(character);
    }
    return characters;
}

function timeOf(raw: unknown): ParsedDesScene['time'] | undefined {
    if (isDict(raw)) {
        const start = textOf(raw.start) ?? textOf(raw.value);
        const end = textOf(raw.end);
        if (!start && !end) return undefined;
        const time: NonNullable<ParsedDesScene['time']> = {};
        if (start) time.start = start;
        if (end) time.end = end;
        return time;
    }
    const flat = textOf(raw);
    return flat ? { start: flat } : undefined;
}

/** Place, date and time from `infoBox`; null when the section is missing or not a JSON object. */
export function parseDesScene(raw: unknown): ParsedDesScene | null {
    const data = parseTrackerJson(raw);
    if (!isDict(data)) return null;
    const scene: ParsedDesScene = {};
    const location = textOf(data.location);
    if (location) scene.location = location;
    const date = textOf(data.date);
    if (date) scene.date = date;
    const time = timeOf(data.time);
    if (time) scene.time = time;
    return scene;
}

function swipeRecordOf(swipes: unknown, swipeId: number): DesTrackerStrings | null {
    const record = Array.isArray(swipes) ? swipes[swipeId] : isDict(swipes) ? swipes[String(swipeId)] : undefined;
    if (!isDict(record)) return null;
    const { quests = null, infoBox = null, characterThoughts = null } = record;
    if (quests === null && infoBox === null && characterThoughts === null) return null;
    return { quests, infoBox, characterThoughts };
}

/**
 * The raw tracker record of a chat message for its current swipe: `extra.dooms_tracker_swipes[swipe_id]`, with
 * `swipe_info[swipe_id].extra.dooms_tracker_swipes[swipe_id]` as the fallback DES itself uses (persistence.js,
 * injector.js). Null for user messages and messages without tracker data.
 */
export function desSwipeRecord(message: unknown): DesTrackerStrings | null {
    if (!isDict(message) || message.is_user === true) return null;
    const swipeId = typeof message.swipe_id === 'number' && message.swipe_id >= 0 ? message.swipe_id : 0;
    const extra = isDict(message.extra) ? message.extra : undefined;
    const direct = swipeRecordOf(extra?.dooms_tracker_swipes, swipeId);
    if (direct) return direct;
    const info = Array.isArray(message.swipe_info) ? (message.swipe_info[swipeId] as unknown) : undefined;
    const infoExtra = isDict(info) && isDict(info.extra) ? info.extra : undefined;
    return swipeRecordOf(infoExtra?.dooms_tracker_swipes, swipeId);
}
