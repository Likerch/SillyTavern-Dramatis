// The card's structured intent (src/shared/card-intent.ts, docs/card-intent.md): the author's intent written into the
// card itself at `data.extensions.dramatis.intent`, taken as the author's word. Pure.
//
// - readCardIntent validates what the card carries: the valid parts are kept, the rest listed (the reader logs it).
// - applyCardIntent writes it onto the card's profiles 1:1 in the shapes the intent reading writes (intent-apply.ts):
//   every field given becomes origin 'author' with the source 'card.intent' and no quote — no anti-softening, no quote
//   checks: it is what the author says. A unit is the reading's unit ('core.values', 'agenda.goals', 'ties.@player',
//   'appetites.<id>', 'starts', 'worldTone', 'rules.<id>'…): ties and appetites are the author's one target / one kind
//   at a time, everything else whole. The user's edits and locks still win (listed as differences). What the card's
//   intent said before and no longer says goes back to empty, so the reading of the text can fill it again. The
//   content boundary (minors) holds as everywhere.
// - The reading of the card's text (intent-apply.ts) runs after it and skips every field marked 'card.intent'.
// - stripIntentNotes: the human-readable «Замысел» section a workshop writes into creator_notes from the same data is
//   left out of that reading while the structured intent is there (it would count the intent twice).
// - cardIntentHash: the intent object joins the card's fingerprint, so a changed intent asks for a re-read.
import { PLAYER_ID } from './model';
import type { Agenda, AppetiteKind, AppetiteRule, CardProfiles, CharacterProfile, Core, FieldMeta, Tie } from './model';
import { hashText } from './intent-prompt';
import {
    DEFAULT_ONSET,
    DEFAULT_STYLE,
    MINOR_CLASS_RE,
    authorReasons,
    enforceMinors,
    isPlayerRef,
} from './intent-apply';
import type { ApplyResult, IntentDiff, IntentWarning } from './intent-apply';
import { clearGenerated } from './intent-reread';
import { matchName, normalizeName } from './presence';
import { SEXUAL_KINDS } from './group-rules';
import {
    LIMITS,
    cardIntentMeta,
    cleanList,
    cleanText,
    emptyAgenda,
    emptyCore,
    emptyProfile,
    emptyTie,
    getPath,
    isCardMeta,
    isEmptyValue,
    isLocked,
    isProtected,
    metaAt,
    normalizeAgenda,
    normalizeAppetite,
    normalizeCardProfiles,
    normalizeCore,
    normalizeIntensity,
    setMeta,
    setPath,
    slugId,
    textKey,
} from './profile-defaults';
import {
    CARD_INTENT_NOTES_BEGIN,
    CARD_INTENT_NOTES_END,
    CARD_INTENT_VERSION,
    validateCardIntent,
} from '../shared/card-intent';
import type { CardIntentCharacter, CardIntentError, CardIntentRule, CardIntentV1 } from '../shared/card-intent';
import type { CardSource } from '../shared/contracts';

type Dict = Record<string, unknown>;

/* ------------------------------------------------------------------ reading the card */

export interface AuthoredIntent {
    /** The card carries `extensions.dramatis.intent` (valid or not). */
    present: boolean;
    /** Its valid parts; null when there is nothing usable in it. */
    intent: CardIntentV1 | null;
    /** What validation dropped or cut. */
    errors: CardIntentError[];
    /** The valid parts cover what the motive card needs: the card's text is not read with the model. */
    complete: boolean;
    /** What `complete` still lacks. */
    missing: string[];
}

/** The card's structured intent, validated (see the file header). */
export function readCardIntent(raw: unknown): AuthoredIntent {
    if (raw === undefined || raw === null)
        return { present: false, intent: null, errors: [], complete: false, missing: [] };
    const check = validateCardIntent(raw);
    const usable = check.intent && (check.intent.world || check.intent.characters) ? check.intent : null;
    return {
        present: true,
        intent: usable,
        errors: check.errors,
        complete: !!usable && check.complete,
        missing: check.missing,
    };
}

/** JSON with sorted keys: the same object always gives the same text. */
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        const dict = value as Dict;
        return `{${Object.keys(dict)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonical(dict[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

/** Hash of the intent object as the card stores it (key order aside), for the card's fingerprint. */
export function cardIntentHash(raw: unknown): string {
    return hashText(canonical(raw));
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MARKED_RE = new RegExp(`${escape(CARD_INTENT_NOTES_BEGIN)}[\\s\\S]*?(?:${escape(CARD_INTENT_NOTES_END)}|$)`, 'g');
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
/** «Замысел», «Замысел автора», «Intent», «Author's intent», with anything after them («Замысел (Dramatis)»). */
const INTENT_TITLE_RE = /^(?:замысел(?:\s+автора)?|(?:author['’]?s?\s+)?intent)(?![\p{L}\p{N}])/iu;

/**
 * Creator's notes without the «Замысел» section: everything between CARD_INTENT_NOTES_BEGIN and _END (to the end
 * when the end marker is missing); without markers, a Markdown heading «Замысел» / «Intent» up to the next heading of
 * the same or a higher level.
 */
export function stripIntentNotes(text: string): string {
    const value = text ?? '';
    const tidy = (out: string) => out.replace(/\n{3,}/g, '\n\n').trim();
    const marked = value.replace(MARKED_RE, '\n');
    if (marked !== value) return tidy(marked);
    const kept: string[] = [];
    let skipping = 0;
    for (const line of value.split('\n')) {
        const heading = HEADING_RE.exec(line);
        if (heading) {
            const level = heading[1]!.length;
            if (skipping && level <= skipping) skipping = 0;
            if (!skipping && INTENT_TITLE_RE.test(heading[2]!.replace(/[*_`]/g, '').trim())) {
                skipping = level;
                continue;
            }
        }
        if (!skipping) kept.push(line);
    }
    return kept.length === value.split('\n').length ? value.trim() : tidy(kept.join('\n'));
}

/** The card as the reading of its text sees it while a structured intent is there: notes without «Замысел». */
export function withoutIntentNotes(card: CardSource): CardSource {
    return { ...card, creatorNotes: stripIntentNotes(card.creatorNotes) };
}

/** Some field of the card's profiles came from a structured intent. */
export function hasCardMarks(profiles: CardProfiles): boolean {
    const marked = (meta: Record<string, FieldMeta>) => Object.values(meta).some((item) => isCardMeta(item));
    return marked(profiles.meta) || profiles.characters.some((profile) => marked(profile.meta));
}

/* ------------------------------------------------------------------ applying */

export interface CardIntentOptions {
    /** Epoch ms (stored in `intent.at`). */
    now: number;
    sourcesHash: string;
    /** The player's persona name (a tie written with it is the tie to the player). */
    personaName?: string;
    /** The card's character name (that character becomes a portrait). */
    cardName?: string;
    /** A full re-read: what the generator wrote for the characters the intent describes gives way first. */
    replaceGenerated?: boolean;
}

export interface CardIntentResult extends ApplyResult {
    /** Profile ids of the characters and groups the intent describes. */
    characters: string[];
}

interface Holder {
    meta: Record<string, FieldMeta>;
}

interface Session {
    diff: IntentDiff[];
    warnings: IntentWarning[];
}

interface Where {
    id: string;
    name: string;
}

interface Plan {
    id: string;
    name: string;
    character: CardIntentCharacter;
}

function same(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/** Writes one unit as the author's (card meta), unless the user owns it or it is locked (then a difference). */
function put<T extends Holder>(session: Session, holder: T, where: Where, path: string, value: unknown): T {
    const before = getPath(holder, path);
    if (isProtected(holder, path)) {
        if (!same(before, value)) {
            session.diff.push({
                character: where.id,
                name: where.name,
                path,
                before,
                after: value,
                status: isLocked(holder, path) ? 'kept-locked' : 'kept-user',
                fromCard: true,
            });
        }
        return holder;
    }
    if (metaAt(holder, path) && !isEmptyValue(before) && !same(before, value)) {
        session.diff.push({
            character: where.id,
            name: where.name,
            path,
            before,
            after: value,
            status: 'updated',
            fromCard: true,
        });
    }
    return setMeta(setPath(holder, path, value), path, cardIntentMeta());
}

/**
 * Units the card's intent wrote before and does not give now go back to empty (who they are keeps its value), so the
 * reading of the text may fill them again; locked ones stay.
 */
function clearStale<T extends Holder>(
    session: Session,
    holder: T,
    where: Where,
    given: ReadonlySet<string>,
    reset: (holder: T, path: string) => T,
): T {
    let out = holder;
    for (const [path, meta] of Object.entries(holder.meta)) {
        if (!isCardMeta(meta) || given.has(path) || isLocked(holder, path)) continue;
        const before = getPath(out, path);
        out = setMeta(reset(out, path), path, null);
        const after = getPath(out, path);
        if (!same(before, after)) {
            session.diff.push({ character: where.id, name: where.name, path, before, after, status: 'updated' });
        }
    }
    return out;
}

function resetProfile(profile: CharacterProfile, path: string): CharacterProfile {
    const [head = '', key = ''] = path.split('.');
    if (head === 'core') return setPath(profile, path, structuredClone((emptyCore() as unknown as Dict)[key]));
    if (head === 'agenda') return setPath(profile, path, structuredClone((emptyAgenda() as unknown as Dict)[key]));
    if (head === 'ties' || head === 'appetites') return setPath(profile, path, undefined);
    if (head === 'starts') return { ...profile, starts: [] };
    return profile;
}

function resetCard(card: CardProfiles, path: string): CardProfiles {
    if (path === 'invariants') return { ...card, invariants: [] };
    if (path === 'reputation') return { ...card, reputation: [] };
    if (path.startsWith('rules.')) return setPath(card, path, undefined);
    return card;
}

interface RulePlan {
    rule: CardIntentRule;
    id: string;
    holders: string;
    target: AppetiteRule['target'];
    /** A sexual rule aimed at children: never written (the content boundary). */
    blocked: boolean;
}

/** Applies the card's structured intent (null: only clears what an earlier one wrote). See the file header. */
export function applyCardIntent(
    current: CardProfiles,
    intent: CardIntentV1 | null,
    options: CardIntentOptions,
): CardIntentResult {
    const session: Session = { diff: [], warnings: [] };
    let card = normalizeCardProfiles(current, current.card);
    const persona = options.personaName?.trim() ?? '';
    const cardWhere: Where = { id: '', name: '' };

    /* characters: match or create */
    const plans: Plan[] = [];
    for (const [key, character] of Object.entries(intent?.characters ?? {})) {
        const name = cleanText(key, LIMITS.name);
        if (!name) continue;
        const names = [name, character.english ?? '', ...(character.aliases ?? []), ...(character.russian ?? [])];
        let id: string | null = null;
        for (const candidate of names.filter(Boolean)) {
            id = matchName(candidate, card.characters, { strict: true });
            if (id) break;
        }
        if (!id) {
            const main = !!options.cardName && normalizeName(options.cardName) === normalizeName(name);
            const profile = emptyProfile(name, {
                taken: card.characters.map((item) => item.id),
                kind: character.kind ?? 'character',
                lod: main ? 'portrait' : 'draft',
                english: character.english,
                aliases: [...(character.aliases ?? []), ...(character.russian ?? [])],
            });
            card = { ...card, characters: [...card.characters, profile] };
            id = profile.id;
        }
        // Two entries that land on one profile (validation refuses the same names): the first one stands.
        if (plans.some((plan) => plan.id === id)) continue;
        plans.push({ id, name, character });
    }

    const resolveTarget = (target: string): string => {
        if (isPlayerRef(target, persona)) return PLAYER_ID;
        const bare = target.replace(/\s*\([^)]*\)\s*$/, '').trim() || target;
        return matchName(bare, card.characters, { strict: true }) ?? cleanText(bare, LIMITS.name);
    };

    /* rules: ids first (appetites point at them) */
    const world = intent?.world ?? {};
    const rulePlans: RulePlan[] = [];
    for (const rule of world.rules ?? []) {
        const holders = cleanText(rule.holders ?? '', LIMITS.name) || rule.name;
        const existing = card.rules.find(
            (other) =>
                textKey(other.label ?? '') === textKey(rule.name) ||
                (textKey(other.holders) === textKey(holders) && other.kind === rule.kind),
        );
        const taken = [...card.rules.map((other) => other.id), ...rulePlans.map((plan) => plan.id)];
        const id = existing?.id ?? slugId(rule.name, taken);
        const target: AppetiteRule['target'] =
            rule.target === 'player'
                ? { mode: 'player' }
                : rule.target === 'thing'
                  ? { mode: 'thing' }
                  : { mode: 'class', class: cleanText(rule.targetClass ?? '', LIMITS.name) || holders };
        const blocked =
            SEXUAL_KINDS.includes(rule.kind) && target.mode === 'class' && MINOR_CLASS_RE.test(target.class);
        rulePlans.push({ rule, id, holders, target, blocked });
    }
    const ruleIds = new Map(rulePlans.map((plan) => [textKey(plan.rule.name), plan.id] as const));

    /* the units the intent gives */
    const givenCard = new Set<string>();
    if (world.tone) givenCard.add('worldTone');
    if (world.invariants) givenCard.add('invariants');
    if (world.reputation) givenCard.add('reputation');
    for (const plan of rulePlans) if (!plan.blocked) givenCard.add(`rules.${plan.id}`);
    const units = new Map<string, Set<string>>();
    const appetiteIds = new Map<string, Map<AppetiteKind, string>>();
    for (const plan of plans) {
        const profile = card.characters.find((item) => item.id === plan.id)!;
        const c = plan.character;
        const given = new Set<string>();
        for (const key of ['kind', 'english', 'gender', 'role', 'species', 'minor'] as const) {
            if (c[key] !== undefined) given.add(key);
        }
        if (c.aliases || c.russian) given.add('aliases');
        for (const key of Object.keys(c.core ?? {})) given.add(`core.${key}`);
        if (c.ties?.some((tie) => tie.changeIf?.length)) given.add('core.keys');
        for (const key of Object.keys(c.agenda ?? {})) given.add(`agenda.${key}`);
        const ids = new Map<AppetiteKind, string>();
        const taken = profile.appetites.map((item) => item.id);
        for (const appetite of c.appetites ?? []) {
            const id =
                profile.appetites.find((item) => item.kind === appetite.kind)?.id ?? slugId(appetite.kind, taken);
            taken.push(id);
            ids.set(appetite.kind, id);
            given.add(`appetites.${id}`);
        }
        appetiteIds.set(plan.id, ids);
        for (const tie of c.ties ?? []) {
            const target = resolveTarget(tie.target);
            if (target !== plan.id) given.add(`ties.${target}`);
        }
        if (c.starts) given.add('starts');
        units.set(plan.id, given);
    }

    /* a full re-read: what the generator wrote for these characters gives way */
    const cleared = new Map<string, Map<string, unknown>>();
    if (options.replaceGenerated) {
        const ids = new Set(plans.map((plan) => plan.id));
        card = {
            ...card,
            characters: card.characters.map((profile) => {
                if (!ids.has(profile.id)) return profile;
                const out = clearGenerated(profile);
                if (out.cleared.size) cleared.set(profile.id, out.cleared);
                return out.profile;
            }),
        };
    }

    /* what the card's intent no longer says */
    card = clearStale(session, card, cardWhere, givenCard, resetCard);
    card = {
        ...card,
        characters: card.characters.map((profile) =>
            clearStale(
                session,
                profile,
                { id: profile.id, name: profile.name },
                units.get(profile.id) ?? new Set(),
                resetProfile,
            ),
        ),
    };

    /* card level */
    if (world.tone) card = put(session, card, cardWhere, 'worldTone', world.tone);
    if (world.invariants) {
        card = put(session, card, cardWhere, 'invariants', cleanList(world.invariants, 24, LIMITS.text));
    }
    if (world.reputation) {
        const seeds = world.reputation.map((seed) => ({
            among: cleanText(seed.among ?? '', LIMITS.name) || '*',
            label: cleanText(seed.label, LIMITS.short),
            stance: seed.stance,
            greeting: seed.greeting ?? -1,
        }));
        card = put(session, card, cardWhere, 'reputation', seeds);
    }
    for (const plan of rulePlans) {
        const rule = plan.rule;
        if (plan.blocked) {
            session.warnings.push({ code: 'minor-target', name: rule.name });
            continue;
        }
        const styles: AppetiteRule['styles'] = {};
        for (const [style, weight] of Object.entries(rule.styles ?? {}) as [keyof AppetiteRule['styles'], number][]) {
            if (weight > 0) styles[style] = Math.round(Math.min(weight, 100) * 1000) / 1000;
        }
        const value: AppetiteRule = {
            id: plan.id,
            holders: plan.holders,
            kind: rule.kind,
            label: cleanText(rule.label ?? '', LIMITS.name) || rule.name,
            source: rule.source ?? 'species',
            target: plan.target,
            intensity: normalizeIntensity(rule.intensity),
            styles,
            choosiness: rule.choosiness ?? 2,
            exclusivity: rule.exclusivity ?? 'exclusive',
            affectionOnset: rule.affectionOnset ?? 'possible',
            groupMode: rule.groupMode ?? 'solitary',
        };
        card = put(session, card, { id: '', name: rule.name }, `rules.${plan.id}`, value);
    }

    /* characters */
    const profiles = new Map(card.characters.map((profile) => [profile.id, profile] as const));
    for (const plan of plans) {
        const after = writeCharacter(session, profiles.get(plan.id)!, plan, resolveTarget, ruleIds, appetiteIds);
        profiles.set(plan.id, after);
        // What the full re-read dropped: replaced by the intent, or left empty for the reading and a grounded fill.
        for (const [path, old] of cleared.get(plan.id) ?? []) {
            const now = getPath(after, path);
            if (!same(old, now)) {
                session.diff.push({
                    character: after.id,
                    name: after.name,
                    path,
                    before: old,
                    after: now,
                    status: 'updated',
                });
            }
        }
    }
    card = { ...card, characters: card.characters.map((profile) => profiles.get(profile.id) ?? profile) };
    card = enforceMinors(session, card);
    card = {
        ...card,
        intent: {
            at: options.now,
            sourcesHash: options.sourcesHash,
            ...(intent ? { fromCard: CARD_INTENT_VERSION } : {}),
        },
    };
    return { profiles: card, diff: session.diff, warnings: session.warnings, characters: plans.map((plan) => plan.id) };
}

function writeCharacter(
    session: Session,
    start: CharacterProfile,
    plan: Plan,
    resolveTarget: (target: string) => string,
    ruleIds: ReadonlyMap<string, string>,
    appetiteIds: ReadonlyMap<string, ReadonlyMap<AppetiteKind, string>>,
): CharacterProfile {
    const c = plan.character;
    let profile = start;
    const where: Where = { id: profile.id, name: profile.name };
    const set = (path: string, value: unknown) => {
        profile = put(session, profile, where, path, value);
    };

    /* who they are */
    if (c.kind) set('kind', c.kind);
    if (c.english) set('english', c.english);
    if (c.aliases || c.russian) {
        // The intent's own key is a name of theirs too when the profile was found under another one.
        const key = textKey(plan.name) !== textKey(profile.name) ? [plan.name] : [];
        const aliases = cleanList([...(c.aliases ?? []), ...(c.russian ?? []), ...key], LIMITS.aliases, LIMITS.name);
        set(
            'aliases',
            aliases.filter((alias) => textKey(alias) !== textKey(profile.name)),
        );
    }
    if (c.gender) set('gender', c.gender);
    if (c.role) set('role', c.role);
    if (c.species) set('species', c.species);
    if (c.minor !== undefined) set('minor', c.minor ? true : undefined);

    /* core: the profile's own shape, field by field */
    const raw = c.core ?? {};
    const tieKeys = (c.ties ?? []).flatMap((tie) => tie.changeIf ?? []);
    const core = normalizeCore({
        ...raw,
        stanceBounds: (raw.stanceBounds ?? []).map((bound) => ({ ...bound, target: resolveTarget(bound.target) })),
        anchors: (raw.anchors ?? []).map((anchor) => resolveTarget(anchor)),
        keys: [...(raw.keys ?? []), ...tieKeys],
    });
    for (const key of Object.keys(raw) as (keyof Core)[]) set(`core.${key}`, core[key]);
    // What could change a stance is a key of the character (§4.1), as the reading makes it.
    if (!raw.keys && tieKeys.length) set('core.keys', core.keys);

    /* agenda */
    const agendaRaw = c.agenda ?? {};
    const front = agendaRaw.front;
    const agenda = normalizeAgenda({
        dream: agendaRaw.dream,
        goals: (agendaRaw.goals ?? []).map((goal, i) => ({
            id: `g${i + 1}`,
            text: goal.text,
            kind: goal.kind ?? 'external',
            priority: goal.priority ?? 2,
        })),
        intentions: (agendaRaw.intentions ?? []).map((item, i) => ({
            id: `i${i + 1}`,
            text: item.text,
            nextStep: item.nextStep ?? '',
            dropIf: item.dropIf ?? [],
        })),
        front: front
            ? {
                  impulse: front.impulse,
                  steps: front.steps ?? [],
                  doom: front.doom ?? '',
                  clock: { segments: front.segments ?? 6, filled: 0 },
              }
            : undefined,
        resources: agendaRaw.resources,
        leverage: agendaRaw.leverage,
        secrets: agendaRaw.secrets,
        ifIgnored: agendaRaw.ifIgnored,
    });
    for (const key of Object.keys(agendaRaw) as (keyof Agenda)[]) set(`agenda.${key}`, agenda[key]);

    /* appetites (before ties: ties point at them) */
    const ids = appetiteIds.get(plan.id) ?? new Map<AppetiteKind, string>();
    for (const appetite of c.appetites ?? []) {
        const id =
            ids.get(appetite.kind) ??
            slugId(
                appetite.kind,
                profile.appetites.map((item) => item.id),
            );
        const existing = profile.appetites.find((item) => item.id === id);
        const value = normalizeAppetite(
            {
                ...(existing ?? {}),
                id,
                kind: appetite.kind,
                label: appetite.label,
                sources: appetite.sources ?? ['individual'],
                target:
                    appetite.target === 'player'
                        ? { mode: 'player' }
                        : appetite.target === 'class' && appetite.targetClass
                          ? { mode: 'class', class: appetite.targetClass }
                          : { mode: 'thing' },
                baseline: appetite.baseline ?? 2,
                triggers: appetite.triggers ?? [],
                satisfiers: (appetite.satisfiers ?? []).map((what) => ({ what, amount: 2 })),
                drift: appetite.drift ?? 'opportunity',
                dependence: appetite.dependence ?? 0,
                endorsement: appetite.endorsement ?? 'proud',
                vow: appetite.vow ?? 'none',
                visibility: appetite.visibility ?? 'open',
                style: appetite.style ?? DEFAULT_STYLE[appetite.kind],
                affectionOnset: appetite.affectionOnset ?? DEFAULT_ONSET[appetite.kind] ?? 'possible',
                excuse: appetite.excuse,
                restraints: appetite.restraints,
                rule: appetite.rule ? (ruleIds.get(textKey(appetite.rule)) ?? slugId(appetite.rule)) : undefined,
            },
            profile.appetites.filter((item) => item.id !== id).map((item) => item.id),
        )!;
        set(`appetites.${id}`, value);
    }

    /* ties: the author's tie replaces the reading's and the generator's whole */
    for (const tie of c.ties ?? []) {
        const id = resolveTarget(tie.target);
        if (id === profile.id) continue;
        const base: Tie = profile.ties.find((item) => item.target === id) ?? emptyTie(id);
        const { behaviour: _behaviour, want: _want, gaze: _gaze, claim: _claim, appetite: _appetite, ...rest } = base;
        const kept = base.reasons.filter((reason) => !reason.id.startsWith('author-') && !reason.id.startsWith('gen-'));
        const want = tie.want ?? 0;
        const appetiteId = tie.appetite
            ? (ids.get(tie.appetite) ?? profile.appetites.find((item) => item.kind === tie.appetite)?.id)
            : undefined;
        const value: Tie = {
            ...rest,
            stance: tie.stance,
            reasons: [...authorReasons(tie.reasons ?? [], tie.stance), ...kept].slice(0, LIMITS.reasons),
            intent: tie.intent ?? 'none',
            ...(tie.behaviour ? { behaviour: tie.behaviour } : {}),
            ...(want > 0 ? { want: want as NonNullable<Tie['want']> } : {}),
            ...(want > 0 && tie.gaze ? { gaze: tie.gaze } : {}),
            ...(want > 0 && appetiteId ? { appetite: appetiteId } : {}),
        };
        set(`ties.${id}`, value);
    }

    /* starting scenes, whole */
    if (c.starts) {
        set(
            'starts',
            [...c.starts]
                .sort((a, b) => a.greeting - b.greeting)
                .map((item) => ({
                    greeting: item.greeting,
                    present: item.present !== false,
                    ...(item.doing ? { doing: item.doing } : {}),
                    ...(item.goal ? { goal: item.goal } : {}),
                })),
        );
    }
    return profile;
}
