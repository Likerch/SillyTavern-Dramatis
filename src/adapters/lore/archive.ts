// CarrotKernel character archives (BunnyMo V3.0): a lorebook entry with a `<BunnymoTags>…</BunnymoTags>` block —
// `<Name:…>`, `<KEY:VALUE>` tags, a bare MBTI archetype `<ENTJ-U>`, group wrappers `<PHYSICAL>`… — and prose sections
// such as `<Linguistics>…</Linguistics>`. Detection ported from Maestro src/domain/bunnymo.ts (itself from DES-RU,
// same author and licence) so all three classify the same entries the same way; reading follows Maestro's
// bunnymo-mode-sheet.ts. Pure: no DOM, no SillyTavern.
import type { ArchiveSheet } from '../../shared/contracts';

/** The parts of a World Info entry read here. Every field is optional and may hold junk. */
export interface LoreEntryLike {
    uid?: unknown;
    key?: unknown;
    keysecondary?: unknown;
    comment?: unknown;
    content?: unknown;
    disable?: unknown;
}

/** Sheet commands of the BunnyMo core lorebook. */
const SHEET_COMMANDS: readonly string[] = [
    '!fullsheet',
    '!quicksheet',
    '!tagsheet',
    '!memsheet',
    '!updatesheet',
    '!physheet',
];
/** Comment prefixes of core entries; titles are stable between BunnyMo versions, uids are not. */
const CORE_COMMENT_RE = /Master - |AUTO-TRIGGER:|AUTO-FILTRATION:|ANTI[\s-]*CLANKER|HawThorne Link/i;
const TAG_BLOCK_RE = /<bunnymotags>([\s\S]*?)<\/bunnymotags>/i;
const TAG_RE = /<([A-Za-z][A-Za-z0-9_-]*):([^<>\n]+)>/g;
/** Bare MBTI archetype without a colon: `<ESFP-H>`, `<INTJ-U>`. */
const MBTI_BARE_RE = /<([EI][NS][FT][JP])-([UH])>/i;
/** An MBTI tag value: `ENTJ`, `ENTJ-U`. */
const MBTI_VALUE_RE = /^([EI][NS][FT][JP])(?:-([UH]))?$/i;
/** A titled prose section (`<Linguistics>…</Linguistics>`); structural wrappers are not prose. */
const SECTION_RE = /<([A-Za-z][A-Za-z_]*)>([\s\S]*?)<\/\1\s*>/gi;
const STRUCTURAL: ReadonlySet<string> = new Set(['bunnymotags', 'physical', 'personality', 'nsfw', 'health']);
const LINGUISTICS_RE = /<linguistics>([\s\S]*?)<\/linguistics\s*>/i;
/** Template placeholders in place of a tag value or name: `<Name:NAME>`, `<GENRE:BLANK>`, `<Dere:NEW>`. */
const PLACEHOLDER_RE = /^(?:BLANK|NEW|VALUE|TARGET|NAME|NAME[\s_]HERE|PLACEHOLDER|TBD|X{3,})$/i;
const REGEX_KEY_RE = /^\/[\s\S]+\/[gimsuy]*$/;

function text(value: unknown): string {
    return value === undefined || value === null ? '' : String(value);
}

/** Primary and secondary keys of an entry, trimmed, without empty ones. */
export function entryKeys(entry: LoreEntryLike | null | undefined): string[] {
    const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
    return [...list(entry?.key), ...list(entry?.keysecondary)].map((key) => text(key).trim()).filter(Boolean);
}

/** An entry of the BunnyMo core lorebook (by a sheet command in its keys or a known entry title). */
export function isBunnyMoCoreEntry(entry: LoreEntryLike | null | undefined): boolean {
    if (entryKeys(entry).some((key) => SHEET_COMMANDS.includes(key.toLowerCase()))) return true;
    return CORE_COMMENT_RE.test(text(entry?.comment));
}

/** The block's text with titled prose sections cut out (their tags are prose, not the character's tags). */
function blockTagArea(block: string): string {
    return block.replace(SECTION_RE, (whole, title: string) => (STRUCTURAL.has(title.toLowerCase()) ? whole : ' '));
}

/** `<Name:…>` and the `<KEY:VALUE>` tags of the first block (keys upper case, placeholders skipped). */
function blockTags(content: string): { name: string | null; tags: { key: string; value: string }[]; area: string } {
    const block = TAG_BLOCK_RE.exec(content);
    if (!block?.[1]) return { name: null, tags: [], area: '' };
    const area = blockTagArea(block[1]);
    let name: string | null = null;
    const tags: { key: string; value: string }[] = [];
    const seen = new Set<string>();
    for (const match of area.matchAll(TAG_RE)) {
        const key = (match[1] ?? '').trim().toUpperCase();
        const value = (match[2] ?? '').trim();
        if (key === 'NAME') {
            name ??= value;
            continue;
        }
        if (!value || PLACEHOLDER_RE.test(value)) continue;
        const id = `${key}:${value.toUpperCase()}`;
        if (seen.has(id)) continue;
        seen.add(id);
        tags.push({ key, value });
    }
    return { name, tags, area };
}

/**
 * A character archive: an entry with a `<BunnymoTags>` block holding a real name or tags. Not archives: sheet
 * templates of the core (`<Name:NAME>`, `<…:BLANK>`) and any block whose name is a placeholder.
 */
export function isCharacterArchive(entry: LoreEntryLike | null | undefined): boolean {
    const content = text(entry?.content);
    if (!TAG_BLOCK_RE.test(content) || isBunnyMoCoreEntry(entry)) return false;
    const { name, tags, area } = blockTags(content);
    if (name !== null) return !PLACEHOLDER_RE.test(name);
    return tags.length > 0 || MBTI_BARE_RE.test(area);
}

/** Reads an archive entry; null when it is not a character archive. */
export function parseArchive(entry: LoreEntryLike, book: string): ArchiveSheet | null {
    if (!isCharacterArchive(entry)) return null;
    const content = text(entry.content);
    const { name, tags, area } = blockTags(content);
    const fallbackName = text(entry.comment).trim() || entryKeys(entry)[0] || '';
    const sheet: ArchiveSheet = {
        name: name && !PLACEHOLDER_RE.test(name) ? name : fallbackName,
        book,
        uid: Number.isFinite(Number(entry.uid)) ? Number(entry.uid) : -1,
        tags: tags.filter((tag) => tag.key !== 'MBTI'),
    };
    const bare = MBTI_BARE_RE.exec(area);
    const tagged = tags.find((tag) => tag.key === 'MBTI');
    const value = bare ? `${bare[1]}-${bare[2]}` : tagged?.value;
    const mbti = value ? MBTI_VALUE_RE.exec(value.trim()) : null;
    if (mbti?.[1]) {
        const variant = mbti[2]?.toUpperCase();
        sheet.mbti = { type: mbti[1].toUpperCase() };
        if (variant === 'H' || variant === 'U') sheet.mbti.variant = variant;
    }
    const linguistics = LINGUISTICS_RE.exec(content)?.[1]?.trim();
    if (linguistics) sheet.linguistics = linguistics;
    return sheet;
}

/** Lower case, ё → е, single spaces: how names are compared. */
export function normalizeName(value: string): string {
    return value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/** Names an archive answers to: its `<Name:…>` and the entry's plain (non-regex) keys. */
export function archiveNames(entry: LoreEntryLike, sheet: ArchiveSheet): string[] {
    const names = [sheet.name, ...entryKeys(entry).filter((key) => !REGEX_KEY_RE.test(key))];
    return [...new Set(names.map(normalizeName).filter(Boolean))];
}
