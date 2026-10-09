// Module `generator` (stage 3, docs/model.md §10): personalities for the faces the story brings in and for the gaps the
// author left. Works on the story state only through the engine (`app.modules.api<EngineApi>(ENGINE_API)`).
// - New faces: a name in the DES cast of a committed reply (the one the user's last message answered) without a profile
//   gets a sketch — no model: role from DES details, «Мысли» and the name, parameters drawn against those present, role
//   templates — saved as a chat extra with its live state, group rules applied, a journal record and a notice «Новое
//   лицо: …». A reply still open to swipes leaves nothing behind (П11): its faces wait for its commit.
// - Promotion: committed turns count scenes and the player's direct address per character (CharacterState.stats);
//   a character who earned a draft or a portrait gets one from the background model once the next reply is in (leader
//   tab only, never during a generation; refusals such as 'not-leader' or 'cap' are skipped and retried on a later
//   turn). Portraits read the character's CK archive as hints, or, without one, give Maestro ready BunnyMo tags
//   («Оформить», settings.autoArchives); goals go to the canon.
// - Gaps: authored characters present in the scene with an empty core get a fill after the intent reading (balanced
//   and cinema modes; economy skips it; not while a generation runs) — only empty fields, never the author's, the
//   user's or locked ones.
// - Rules: group / species / world appetite rules are drawn for new faces and again whenever the rules change.
// - API `generator` (api.ts) for the sheet UI: fillGaps, promote, pin — interactive requests.
// Needs Maestro (background model, journal, notices); sketches themselves are code only.
import { lodLabel, stanceLabel } from '../../domain/ladders';
import { chatLevers } from '../../domain/levers';
import {
    GENERATE_TASK,
    applyGenerated,
    applyRules,
    applyTagFields,
    castMember,
    countTurn,
    emptyCandidate,
    fieldsToTags,
    fillFields,
    generatorMessages,
    generatorSchema,
    holderMatches,
    maxLod,
    missingFields,
    needsFill,
    paramsFromProfile,
    parseCandidates,
    pickCandidate,
    sampleParams,
    saidAbout,
    sheetTags,
    shouldPromote,
    sketchProfile,
    syncLiveState,
    tagsToFields,
} from '../../domain/generator';
import type {
    ApplyGeneratedOptions,
    CastMember,
    GenCandidate,
    GenContext,
    GenSubject,
    GeneratorKind,
    RuleContext,
    RuleGrant,
    TagFields,
} from '../../domain/generator';
import { PLAYER_ID } from '../../domain/model';
import type { CharacterProfile, ChatState, Lod, Scale5 } from '../../domain/model';
import { matchName, normalizeName, presentFromDes, presentFromText } from '../../domain/presence';
import { strangerStance } from '../../domain/reputation';
import { UNKNOWN_ROLE, detectRole, roleIds } from '../../domain/role-priors';
import type { RoleSource } from '../../domain/role-priors';
import { ensureCharacterState } from '../../domain/state-init';
import { leversFor } from '../../domain/turn-apply';
import type { ApiJournalChange } from '../../shared/apis';
import type { DesCharacter, DramatisModule, ModuleContext, Unsubscribe } from '../../shared/contracts';
import { ENGINE_API } from '../engine/api';
import type { EngineApi, EngineView } from '../engine/api';
import { TURN_API } from '../turn/api';
import { GENERATOR_API } from './api';
import type { GeneratorApi, GeneratorOutcome } from './api';
import { GENERATOR_STRINGS } from './strings';

export interface GeneratorSettings {
    /** Sketch new faces (code only). */
    sketches: boolean;
    /** Promote characters by scenes and interactions in the background. */
    promotion: boolean;
    /** Fill the gaps of authored characters after the intent reading. */
    gapFill: boolean;
    /** Draw group / species / world appetite rules for individuals. */
    rules: boolean;
}

export const JOURNAL_KIND = 'dramatis.generate';
export const JOURNAL_TARGET = 'dramatis.profile';
/** Background attempts per character, level and session (a model that keeps failing is not asked forever). */
export const MAX_ATTEMPTS = 3;
/** Messages read for «what the chat said» about a character. */
const SAID_MESSAGES = 30;

const ROLE_KEY_RE = /role|occupation|job|profession|class|title|роль|занят|профес|должн|ремесл|звани/i;
const SPECIES_KEY_RE = /species|race|folk|раса|вид|народ/i;
const GENDER_KEY_RE = /gender|sex|^пол$|^пол_|_пол$/i;
const TRANSIENT = new Set(['not-leader', 'cap', 'maestro-stopped']);

type Target = 'fill' | 'draft' | 'portrait';

interface ProfileRef {
    store: 'extras' | 'card';
    id: string;
    card: string;
    chat: string | null;
}

function isProfile(value: CharacterProfile | undefined): value is CharacterProfile {
    return value !== undefined;
}

function namesOf(profile: CharacterProfile): string[] {
    return [profile.name, ...profile.aliases, profile.english ?? ''].filter((name) => name.trim());
}

/** A JSON answer that came back as text (a provider without structured output). */
function parseJson(text: string | undefined): unknown {
    if (!text) return undefined;
    const body = text.replace(/```(?:json)?/gi, '').trim();
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
        return JSON.parse(body.slice(start, end + 1));
    } catch {
        return undefined;
    }
}

/** Role hints of a DES character: the name, «role»-like details first, other details, then the thoughts. */
export function roleSources(name: string, member?: DesCharacter): RoleSource[] {
    const sources: RoleSource[] = [{ text: name, weight: 3 }];
    for (const [key, value] of Object.entries(member?.details ?? {})) {
        sources.push({ text: value, weight: ROLE_KEY_RE.test(key) ? 3 : 1 });
    }
    if (member?.thoughts) sources.push({ text: member.thoughts, weight: 0.5 });
    return sources;
}

/** Gender and species from DES details, when a detail names them. */
export function identityOf(member?: DesCharacter): { gender?: 'female' | 'male'; species?: string } {
    const out: { gender?: 'female' | 'male'; species?: string } = {};
    for (const [key, value] of Object.entries(member?.details ?? {})) {
        if (!out.species && SPECIES_KEY_RE.test(key) && value.trim()) out.species = value.trim();
        if (!out.gender && GENDER_KEY_RE.test(key)) {
            if (/female|woman|жен|девуш/i.test(value)) out.gender = 'female';
            else if (/male|\bman\b|муж|парен/i.test(value)) out.gender = 'male';
        }
    }
    return out;
}

function startGenerator({ app, settings, log, own }: ModuleContext<GeneratorSettings>): GeneratorApi {
    const engine = (): EngineApi | null => app.modules.api<EngineApi>(ENGINE_API) ?? null;
    const maestro = () => app.maestro.api();
    const t = (key: string, params?: Record<string, string | number>) => app.i18n.t(key, params);
    const inflight = new Set<string>();
    const attempts = new Map<string, { commit: number; count: number }>();
    /** Committed turns seen in this session: retries wait for the next one (state.turn belongs to the turn module). */
    let commits = 0;
    const rulesSeen = new Map<string, string>();
    /** Names sketched in this session per chat: never twice, even if the engine still lists them. */
    const sketched = new Set<string>();
    let queue: Promise<void> = Promise.resolve();
    let pending = false;
    let alive = true;
    /** A real generation is under way (Maestro's generation:before … generation:ended): no model calls now. */
    let generating = false;
    /** Turns were counted since the last promotion check: it runs once the next reply is in. */
    let promotionsDue = false;
    let attached: EngineApi | null = null;
    let offEngine: Unsubscribe | null = null;

    const levers = () => chatLevers(app.settings.get(), engine()?.view()?.state.overrides);
    const lang = () => levers().cardLanguage;
    const chatOf = (state: Pick<ChatState, 'card'>) => `${app.host.chatId() ?? ''}|${state.card}`;

    function enqueue(job: () => Promise<void>): Promise<void> {
        const next = queue
            .then(() => (alive ? job() : undefined))
            .catch((error: unknown) => log.error('generator job failed', error));
        queue = next;
        return next;
    }

    function attach(): void {
        const current = engine();
        if (current === attached) return;
        offEngine?.();
        offEngine = null;
        attached = current;
        if (current) offEngine = current.onChange(() => schedule());
    }

    function schedule(): void {
        if (pending) return;
        pending = true;
        void enqueue(async () => {
            pending = false;
            const view = engine()?.view();
            if (view) await onView(view);
        });
    }

    function roleLabel(role: string | undefined): string {
        if (role && roleIds().includes(role)) return t(`generator.role.${role}`);
        return role?.trim() || t(`generator.role.${UNKNOWN_ROLE}`);
    }

    function notice(text: string): void {
        const api = maestro();
        if (api) api.notice(text, { importance: 'info' });
        else app.ui.notice(text);
    }

    async function record(summary: string, changes: ApiJournalChange[]): Promise<void> {
        try {
            await maestro()?.journal.record({ kind: JOURNAL_KIND, summary, changes });
        } catch (error) {
            log.debug('journal record failed', error);
        }
    }

    function change(ref: ProfileRef, before: CharacterProfile | null, after: CharacterProfile): ApiJournalChange {
        return { target: JOURNAL_TARGET, ref: { ...ref }, before, after };
    }

    /* ---------------------------------------------------------------- attempts */

    function attemptKey(view: EngineView, id: string, target: Target): string {
        return `${chatOf(view.state)}|${id}|${target}`;
    }

    function mayTry(view: EngineView, id: string, target: Target): boolean {
        const last = attempts.get(attemptKey(view, id, target));
        return !last || (last.count < MAX_ATTEMPTS && commits > last.commit);
    }

    function noteAttempt(view: EngineView, id: string, target: Target, counts: boolean): void {
        const key = attemptKey(view, id, target);
        const last = attempts.get(key);
        attempts.set(key, { commit: commits, count: (last?.count ?? 0) + (counts ? 1 : 0) });
    }

    /* ---------------------------------------------------------------- rules */

    function ruleContext(state: ChatState, profiles: readonly CharacterProfile[]): RuleContext {
        return {
            population: [
                ...profiles.map((profile) => ({
                    id: profile.id,
                    ...(profile.species ? { species: profile.species } : {}),
                    ...(profile.role ? { role: profile.role } : {}),
                    ...(profile.gender ? { gender: profile.gender } : {}),
                    ...(profile.minor ? { minor: true } : {}),
                })),
                { id: PLAYER_ID },
            ],
            knowsPlayer: (id) => state.characters[id]?.knowsPlayer ?? true,
            strength: leversFor(app.settings.get(), state.overrides).appetiteStrength,
        };
    }

    /** Starting pressure of drawn appetites in the live state. */
    function grantPressure(
        state: ChatState,
        grants: readonly RuleGrant[],
        profiles: readonly CharacterProfile[],
    ): void {
        for (const grant of grants) {
            const profile = profiles.find((item) => item.id === grant.holder);
            const live = profile ? ensureCharacterState(state, profile) : state.characters[grant.holder];
            const appetite = profile?.appetites.find((item) => item.id === grant.appetite);
            if (!live || !appetite) continue;
            live.appetites[appetite.id] = {
                pressure: grant.pressure as Scale5,
                tolerance: appetite.tolerance,
                dependence: appetite.dependence,
                sensitization: appetite.sensitization,
                lastSated: -1,
                edgeCount: 0,
                withdrawal: false,
            };
            for (const tie of profile!.ties) {
                if (tie.appetite !== appetite.id) continue;
                const liveTie = live.ties[tie.target];
                live.ties[tie.target] = liveTie
                    ? {
                          ...liveTie,
                          ...(tie.want !== undefined ? { want: tie.want } : {}),
                          ...(tie.gaze ? { gaze: tie.gaze } : {}),
                          appetite: appetite.id,
                      }
                    : structuredClone(tie);
            }
        }
    }

    function lacksRule(profiles: readonly CharacterProfile[], state: ChatState): boolean {
        return profiles.some(
            (profile) =>
                profile.kind !== 'group' &&
                state.rules.some(
                    (rule) =>
                        holderMatches(rule.holders, profile) &&
                        !profile.appetites.some((appetite) => appetite.rule === rule.id),
                ),
        );
    }

    /** When the chat's rules changed (or first seen in this session): every holder without a draw draws now. */
    async function applyRulesOnChange(view: EngineView): Promise<void> {
        const key = chatOf(view.state);
        const hash = JSON.stringify(view.state.rules);
        if (rulesSeen.get(key) === hash) return;
        rulesSeen.set(key, hash);
        const eng = engine();
        if (!eng || !view.state.rules.length) return;
        const changes: ApiJournalChange[] = [];
        const names: string[] = [];
        const chat = app.host.chatId();
        if (lacksRule(view.state.extras, view.state)) {
            await eng.updateState((state) => {
                if (chatOf(state) !== key) return;
                const before = state.extras;
                const result = applyRules(
                    before,
                    state.rules,
                    ruleContext(state, [...view.card.characters, ...before]),
                    app.rng,
                );
                state.extras = result.profiles;
                grantPressure(state, result.grants, result.profiles);
                for (const grant of result.grants) {
                    const after = result.profiles.find((profile) => profile.id === grant.holder)!;
                    if (!names.includes(after.name)) names.push(after.name);
                    const old = before.find((profile) => profile.id === grant.holder) ?? null;
                    changes.push(change({ store: 'extras', id: after.id, card: state.card, chat }, old, after));
                }
            });
        }
        if (lacksRule(view.card.characters, view.state)) {
            let grants: RuleGrant[] = [];
            let profiles: CharacterProfile[] = [];
            const saved = await eng.updateProfiles((card) => {
                const before = card.characters;
                const result = applyRules(
                    before,
                    view.state.rules,
                    ruleContext(view.state, [...before, ...view.state.extras]),
                    app.rng,
                );
                card.characters = result.profiles;
                grants = result.grants;
                profiles = result.profiles;
                for (const grant of result.grants) {
                    const after = result.profiles.find((profile) => profile.id === grant.holder)!;
                    if (!names.includes(after.name)) names.push(after.name);
                    const old = before.find((profile) => profile.id === grant.holder) ?? null;
                    changes.push(change({ store: 'card', id: after.id, card: card.card, chat }, old, after));
                }
            });
            if (saved && grants.length) await eng.updateState((state) => grantPressure(state, grants, profiles));
        }
        if (changes.length) await record(t('generator.journal.rules', { names: names.join(', ') }), changes);
    }

    /* ---------------------------------------------------------------- new faces */

    /** The reply the user's last message answered (committed, П11), or -1. */
    function committedIndex(): number {
        const chat = app.host.ctx().chat;
        if (!Array.isArray(chat)) return -1;
        for (let i = chat.length - 1; i >= 0; i--) {
            const message = chat[i];
            if (!message?.is_user || message.is_system) continue;
            for (let j = i - 1; j >= 0; j--) {
                const before = chat[j];
                if (before && !before.is_user && !before.is_system) return j;
            }
            return -1;
        }
        return -1;
    }

    /** The DES cast of a committed reply and the names in it that no profile (nor Maestro's gluing) answers to. */
    function facesAt(view: EngineView, index: number): { names: string[]; cast: DesCharacter[] } {
        if (index < 0 || !app.readers.des.available()) return { names: [], cast: [] };
        const cast = app.readers.des.castAt(index);
        const eng = engine();
        const names = presentFromDes(cast, view.profiles).unknown.filter((name) => !eng?.resolve(name));
        return { names, cast };
    }

    async function sketchUnknown(view: EngineView, messageIndex: number): Promise<void> {
        const eng = engine();
        if (!eng) return;
        const key = chatOf(view.state);
        const dismissed = new Set((view.state.generator?.dismissed ?? []).map(normalizeName));
        const known = [...view.profiles, ...view.state.extras];
        const faces = facesAt(view, messageIndex);
        const names = faces.names.filter((name) => {
            const norm = normalizeName(name);
            return (
                norm &&
                !dismissed.has(norm) &&
                !sketched.has(`${key}|${norm}`) &&
                !matchName(name, known, { strict: true })
            );
        });
        if (!names.length) return;
        const des = faces.cast;
        const taken = new Set(known.map((profile) => profile.id));
        const cast: CastMember[] = view.present
            .map((id) => view.byId.get(id))
            .filter(isProfile)
            .map(castMember);
        const sketches: { profile: CharacterProfile; role: string }[] = [];
        for (const name of names) {
            sketched.add(`${key}|${normalizeName(name)}`);
            if (sketches.some((item) => matchName(name, [item.profile], { strict: true }))) continue;
            const member = des.find((item) => normalizeName(item.name) === normalizeName(name));
            const role = detectRole(roleSources(name, member));
            const reputation = strangerStance(view.state.reputation, role === UNKNOWN_ROLE ? [] : [role])?.stance;
            const params = sampleParams(
                role,
                view.state.worldTone,
                cast,
                app.rng,
                levers().diversity,
                reputation === undefined ? {} : { reputation },
            );
            const profile = sketchProfile(name, params, { lang: lang(), taken, ...identityOf(member) });
            taken.add(profile.id);
            cast.push(castMember(profile));
            sketches.push({ profile, role });
        }
        if (!sketches.length) return;
        const created: CharacterProfile[] = [];
        const chat = app.host.chatId();
        eng.log(
            sketches.map(({ profile }) => ({
                turn: view.state.turn,
                character: profile.id,
                kind: 'generator.new',
                text: profile.name,
            })),
        );
        const saved = await eng.updateState((state) => {
            if (chatOf(state) !== key) return;
            let fresh = sketches
                .map((item) => item.profile)
                .filter(
                    (profile) =>
                        !state.extras.some((other) => other.id === profile.id) &&
                        !matchName(profile.name, [...state.extras, ...view.card.characters], { strict: true }),
                );
            if (!fresh.length) return;
            let grants: RuleGrant[] = [];
            if (settings.rules && state.rules.length) {
                const result = applyRules(
                    fresh,
                    state.rules,
                    ruleContext(state, [...view.card.characters, ...state.extras, ...fresh]),
                    app.rng,
                );
                fresh = result.profiles;
                grants = result.grants;
            }
            for (const profile of fresh) {
                state.extras.push(profile);
                const live = ensureCharacterState(state, profile);
                live.present = true;
                live.lastSeenTurn = state.turn;
                live.knowsPlayer = true;
                live.stats = countTurn(live.stats, state.scene, true, false);
                created.push(profile);
            }
            grantPressure(state, grants, fresh);
        });
        if (!saved) {
            // Not saved (no chat, another tab won): let a later change try these names again.
            for (const name of names) sketched.delete(`${key}|${normalizeName(name)}`);
            return;
        }
        if (!created.length) return;
        for (const profile of created) {
            const role = sketches.find((item) => item.profile.id === profile.id)?.role;
            await record(t('generator.journal.new', { name: profile.name, role: roleLabel(role) }), [
                change({ store: 'extras', id: profile.id, card: view.state.card, chat }, null, profile),
            ]);
        }
        if (created.length === 1) {
            const only = created[0]!;
            notice(
                only.role
                    ? t('generator.notice.newRole', { name: only.name, role: roleLabel(only.role) })
                    : t('generator.notice.new', { name: only.name }),
            );
        } else {
            notice(t('generator.notice.newMany', { names: created.map((profile) => profile.name).join(', ') }));
        }
    }

    /* ---------------------------------------------------------------- generation */

    function recentMessages(count: number): string[] {
        const chat = app.host.ctx().chat;
        if (!Array.isArray(chat)) return [];
        return chat
            .slice(-count)
            .filter((message) => message && !message.is_system)
            .map((message) => String(message.mes ?? ''));
    }

    function contextOf(view: EngineView, profile: CharacterProfile): GenContext {
        const des = app.readers.des.available() ? app.readers.des.lastCast() : [];
        const member = des.find((item) => matchName(item.name, [profile], { strict: true }) === profile.id);
        const said = [
            ...Object.entries(member?.details ?? {}).map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`),
            member?.thoughts ? `Thoughts: ${member.thoughts}` : '',
            ...saidAbout(namesOf(profile), recentMessages(SAID_MESSAGES)),
        ].filter(Boolean);
        const relations: string[] = [];
        for (const id of view.present) {
            if (id === profile.id) continue;
            const other = view.byId.get(id);
            if (!other) continue;
            const toward =
                view.state.characters[id]?.ties[profile.id] ?? other.ties.find((tie) => tie.target === profile.id);
            const from = view.state.characters[profile.id]?.ties[id] ?? profile.ties.find((tie) => tie.target === id);
            if (toward) relations.push(`${other.name} → ${profile.name}: ${stanceLabel(toward.stance, 'en')}`);
            if (from) relations.push(`${profile.name} → ${other.name}: ${stanceLabel(from.stance, 'en')}`);
            if (!toward && !from) relations.push(`${other.name} is present`);
        }
        const card = app.readers.card.current();
        const story = card ? [`Card: ${card.name}`, card.scenario.trim().slice(0, 600)].filter(Boolean).join('\n') : '';
        return {
            worldTone: view.state.worldTone,
            playerName: view.playerName,
            lang: lang(),
            said,
            canon: view.card.invariants,
            relations,
            ...(story ? { story } : {}),
        };
    }

    function subjectOf(profile: CharacterProfile, missing: string[], tags: string[]): GenSubject {
        return {
            name: profile.name,
            ...(profile.role ? { role: profile.role } : {}),
            ...(profile.species ? { species: profile.species } : {}),
            ...(profile.gender ? { gender: profile.gender } : {}),
            profile,
            ...(missing.length ? { missing } : {}),
            ...(tags.length ? { tags } : {}),
        };
    }

    /** Asks the model for three candidates and picks one; a fill the dice alone can answer needs no model. */
    async function candidateFor(
        target: Target,
        view: EngineView,
        profile: CharacterProfile,
        params: ReturnType<typeof paramsFromProfile>,
        tags: string[],
        background: boolean,
    ): Promise<{ candidate?: GenCandidate; error?: string }> {
        const missing = target === 'fill' ? missingFields(profile) : [];
        if (target === 'fill' && !fillFields(missing).length) return { candidate: emptyCandidate() };
        const kind: GeneratorKind = target;
        const schema = generatorSchema(kind);
        const result = await app.llm.request<unknown>({
            task: GENERATE_TASK,
            messages: generatorMessages(kind, subjectOf(profile, missing, tags), params, contextOf(view, profile)),
            maxTokens: kind === 'draft' ? 1800 : 4000,
            temperature: 0.9,
            schema: { name: schema.name, schema: schema.schema },
            background,
        });
        if (!result.ok) return { error: result.error ?? 'failed' };
        const candidate = pickCandidate(parseCandidates(result.data ?? parseJson(result.text)), app.rng);
        return candidate ? { candidate } : { error: 'no-candidates' };
    }

    async function generate(id: string, target: Target, background: boolean): Promise<GeneratorOutcome> {
        const fail = (error: string): GeneratorOutcome => ({ ok: false, written: [], error });
        const eng = engine();
        const api = maestro();
        if (!eng) return fail('no-engine');
        const view = eng.view();
        if (!view) return fail('no-chat');
        const profile = view.byId.get(id);
        if (!profile) return fail('unknown');
        if (target !== 'fill' && maxLod(profile.lod, target) === profile.lod) return { ok: true, written: [] };
        if (background && (!api || !api.leader.isLeader())) return fail('not-leader');
        if (inflight.has(id)) return fail('busy');
        inflight.add(id);
        const key = chatOf(view.state);
        const extra = view.state.extras.some((item) => item.id === id);
        try {
            let tags: string[] = [];
            let tagFields: TagFields | null = null;
            if (target !== 'draft') {
                const [sheet] = await app.readers.lore.archives(namesOf(profile));
                if (sheet) {
                    tags = sheetTags(sheet);
                    tagFields = tagsToFields(tags);
                }
            }
            const hinted = tagFields ? applyTagFields(profile, tagFields).profile : profile;
            const cast = view.present
                .filter((other) => other !== id)
                .map((other) => view.byId.get(other))
                .filter(isProfile)
                .map(castMember);
            const role = hinted.role ?? detectRole([hinted.name]);
            const sampled = sampleParams(role, view.state.worldTone, cast, app.rng, levers().diversity);
            const params = paramsFromProfile(hinted, sampled);
            const answer = await candidateFor(target, view, hinted, params, tags, background);
            if (!answer.candidate) {
                const error = answer.error ?? 'failed';
                if (background) noteAttempt(view, id, target, !TRANSIENT.has(error));
                if (!TRANSIENT.has(error)) log.debug(`generation for ${profile.name} failed`, error);
                return fail(error);
            }
            const candidate = answer.candidate;
            const options: ApplyGeneratedOptions = {
                lod: target === 'fill' ? profile.lod : target,
                origin: 'generated',
                kind: target,
                params,
                lang: lang(),
                ...(tagFields?.coping ? { coping: tagFields.coping } : {}),
            };
            const out: { before?: CharacterProfile; after?: CharacterProfile; written: string[] } = { written: [] };
            const rewrite = (fresh: CharacterProfile): CharacterProfile => {
                const hints = tagFields ? applyTagFields(fresh, tagFields) : { profile: fresh, written: [] };
                const applied = applyGenerated(hints.profile, candidate, options);
                out.before = fresh;
                out.after = applied.profile;
                out.written = [...hints.written, ...applied.written];
                return applied.profile;
            };
            let saved: boolean;
            if (extra) {
                saved = await eng.updateState((state) => {
                    if (chatOf(state) !== key) return;
                    const at = state.extras.findIndex((item) => item.id === id);
                    if (at < 0) return;
                    const next = rewrite(state.extras[at]!);
                    state.extras[at] = next;
                    const live = state.characters[id];
                    if (live) state.characters[id] = syncLiveState(live, out.before ?? null, next);
                });
            } else {
                saved = await eng.updateProfiles((card) => {
                    const at = card.characters.findIndex((item) => item.id === id);
                    if (at >= 0) card.characters[at] = rewrite(card.characters[at]!);
                });
                const after = out.after;
                if (saved && after) {
                    await eng.updateState((state) => {
                        const live = state.characters[id];
                        if (live) state.characters[id] = syncLiveState(live, out.before ?? null, after);
                    });
                }
            }
            const before = out.before;
            const after = out.after;
            if (!saved || !before || !after) return fail('not-saved');
            if (background) attempts.delete(attemptKey(view, id, target));
            if (!out.written.length) return { ok: true, written: [] };
            const ref: ProfileRef = {
                store: extra ? 'extras' : 'card',
                id,
                card: extra ? view.state.card : view.card.card,
                chat: app.host.chatId(),
            };
            const locale = app.i18n.locale();
            if (target === 'fill') {
                await record(t('generator.journal.filled', { name: after.name, count: out.written.length }), [
                    change(ref, before, after),
                ]);
                notice(t('generator.notice.filled', { name: after.name }));
            } else {
                await record(
                    t('generator.journal.promoted', {
                        name: after.name,
                        from: lodLabel(before.lod, locale),
                        to: lodLabel(after.lod, locale),
                    }),
                    [change(ref, before, after)],
                );
                notice(t('generator.notice.promoted', { name: after.name, lod: lodLabel(after.lod, locale) }));
            }
            await afterwards(target, after, tags.length > 0);
            return { ok: true, written: out.written };
        } catch (error) {
            log.error(`generation for ${profile.name} failed`, error);
            return fail('error');
        } finally {
            inflight.delete(id);
        }
    }

    /** Portraits get BunnyMo tags through Maestro «Оформить» unless an archive exists; drafts and portraits give goals to the canon. */
    async function afterwards(target: Target, profile: CharacterProfile, hasArchive: boolean): Promise<void> {
        const api = maestro();
        if (!api || target === 'fill') return;
        try {
            if (target === 'portrait' && !hasArchive && levers().autoArchives && api.styleUp) {
                const tags = fieldsToTags(profile);
                if (tags.length) await api.styleUp(profile.name, tags);
            }
            const goals = profile.agenda.goals.map((goal) => goal.text).slice(0, 3);
            if (goals.length && api.setCanonGoals) await api.setCanonGoals(profile.name, goals);
        } catch (error) {
            log.debug(`bridging ${profile.name} to Maestro failed`, error);
        }
    }

    /* ---------------------------------------------------------------- gaps and turns */

    async function fillAuthored(view: EngineView | null): Promise<void> {
        if (!view || generating || !view.card.intent) return;
        if (leversFor(app.settings.get(), view.state.overrides).mode === 'economy') return;
        const extras = new Set(view.state.extras.map((item) => item.id));
        for (const id of view.present) {
            if (extras.has(id) || inflight.has(id)) continue;
            const profile = view.byId.get(id);
            if (!profile || !needsFill(profile) || !mayTry(view, id, 'fill')) continue;
            await generate(id, 'fill', true);
        }
    }

    async function onView(view: EngineView): Promise<void> {
        if (settings.sketches) await sketchUnknown(view, committedIndex());
        const current = engine()?.view();
        if (!current) return;
        if (settings.rules) await applyRulesOnChange(current);
        if (settings.gapFill) await fillAuthored(engine()?.view() ?? null);
    }

    function userTextAfter(messageIndex: number): string[] {
        const chat = app.host.ctx().chat;
        if (!Array.isArray(chat)) return [];
        return chat
            .slice(Math.max(0, messageIndex + 1))
            .filter((message) => message?.is_user)
            .map((message) => String(message.mes ?? ''));
    }

    /** Writes driven by turns happen in Maestro's leading tab only: two tabs must not count one turn twice. */
    function leads(): boolean {
        try {
            return maestro()?.leader.isLeader() === true;
        } catch (error) {
            log.debug('leader check failed', error);
            return false;
        }
    }

    async function onCommitted(messageIndex: number): Promise<void> {
        commits += 1;
        const eng = engine();
        if (!eng || !leads()) return;
        const view = (await eng.ready()) ?? eng.view();
        if (!view) return;
        if (settings.sketches) await sketchUnknown(view, messageIndex);
        const current = eng.view();
        if (!current) return;
        const present = current.present.map((id) => current.byId.get(id)).filter(isProfile);
        const addressed = new Set(presentFromText(userTextAfter(messageIndex), present));
        const key = chatOf(current.state);
        await eng.updateState((state) => {
            if (chatOf(state) !== key) return;
            // Everyone counted before is counted again (absent now: a later return is a new scene).
            for (const [id, live] of Object.entries(state.characters)) {
                const here = current.present.includes(id);
                if (here || live.stats) live.stats = countTurn(live.stats, state.scene, here, addressed.has(id));
            }
        });
        // The model is asked once the next reply is in: the generation this message started runs now.
        if (settings.promotion) promotionsDue = true;
    }

    /** Promotions earned by the counted turns (the pause after a reply: no generation runs). */
    async function promote(): Promise<void> {
        promotionsDue = false;
        const eng = engine();
        const after = eng?.view();
        if (!eng || !after || !leads()) return;
        const names = maestro()?.names;
        for (const id of after.present) {
            const profile = after.byId.get(id);
            const stats = after.state.characters[id]?.stats;
            if (!profile || !stats || profile.kind === 'group' || inflight.has(id)) continue;
            const target = shouldPromote({
                lod: profile.lod,
                scenes: stats.scenes,
                interactions: stats.interactions,
                canon: !!names?.resolve(profile.name),
                ...(stats.pinned ? { pinned: true } : {}),
            });
            if (!target || target === 'sketch' || !mayTry(after, id, target)) continue;
            await generate(id, target, true);
        }
    }

    /* ---------------------------------------------------------------- undo */

    async function undo(entry: ApiJournalChange): Promise<boolean> {
        const eng = engine();
        const ref = entry.ref as Partial<ProfileRef>;
        if (!eng || typeof ref.id !== 'string') return false;
        const before = entry.before as CharacterProfile | null;
        if (ref.store === 'extras') {
            if ((ref.chat ?? null) !== app.host.chatId()) return false;
            return eng.updateState((state) => {
                const at = state.extras.findIndex((item) => item.id === ref.id);
                if (at < 0) return;
                if (before) {
                    state.extras[at] = before;
                    return;
                }
                const [removed] = state.extras.splice(at, 1);
                delete state.characters[ref.id!];
                const dismissed = state.generator?.dismissed ?? [];
                if (removed && !dismissed.includes(removed.name)) dismissed.push(removed.name);
                state.generator = { ...(state.generator ?? {}), dismissed };
            });
        }
        if (ref.store === 'card' && before) {
            return eng.updateProfiles((card) => {
                if (ref.card && card.card !== ref.card) return;
                const at = card.characters.findIndex((item) => item.id === ref.id);
                if (at >= 0) card.characters[at] = before;
            });
        }
        return false;
    }

    /* ---------------------------------------------------------------- wiring */

    const api = maestro();
    if (api) {
        own(
            api.llm.registerTask(GENERATE_TASK, {
                ru: GENERATOR_STRINGS.ru['generator.task']!,
                en: GENERATOR_STRINGS.en['generator.task']!,
            }),
        );
        own(api.journal.registerUndo(JOURNAL_TARGET, undo));
    }
    own(() => {
        alive = false;
        offEngine?.();
        offEngine = null;
        attached = null;
    });
    const onTurn = (messageIndex: number): void => {
        attach();
        void enqueue(() => onCommitted(messageIndex));
    };
    // Counting reads the scene counter the turn module sets: it follows that module's commit (`turn:applied`, leader
    // tab only). Only with the turn module switched off is the user's message itself the cue.
    own(app.bus.on('turn:applied', ({ messageIndex }) => onTurn(messageIndex)));
    own(
        app.bus.on('turn:committed', ({ messageIndex }) => {
            if (!app.modules.api(TURN_API)) onTurn(messageIndex);
        }),
    );
    own(
        app.bus.on('chat:changed', () => {
            attach();
            schedule();
        }),
    );
    own(app.bus.on('state:changed', () => attach()));
    own(
        app.bus.on('generation:before', ({ quiet, dryRun }) => {
            if (!quiet && !dryRun) generating = true;
        }),
    );
    /** The generation is over (its reply is in, or it ended without one): background work may start. */
    const pause = (): void => {
        generating = false;
        attach();
        // Queued behind the counting of a turn still in progress: it decides whether anything is due.
        void enqueue(async () => {
            if (promotionsDue && settings.promotion && !generating) await promote();
        });
        schedule();
    };
    own(app.bus.on('generation:ended', pause));
    own(app.bus.on('reply:ready', pause));
    own(app.bus.on('profiles:changed', () => attach()));
    attach();
    schedule();

    return {
        fillGaps: (id) => generate(id, 'fill', false),
        promote: (id, lod: Lod) =>
            lod === 'sketch' ? Promise.resolve({ ok: true, written: [] }) : generate(id, lod, false),
        async pin(id, pinned) {
            const eng = engine();
            if (!eng) return { ok: false, written: [], error: 'no-engine' };
            const saved = await eng.updateState((state) => {
                const live = state.characters[id];
                if (!live) return;
                live.stats = { ...(live.stats ?? { scenes: 0, lastScene: -1, interactions: 0 }), pinned };
            });
            if (!saved) return { ok: false, written: [], error: 'not-saved' };
            return pinned ? generate(id, 'portrait', false) : { ok: true, written: [] };
        },
        busy: () => [...inflight],
        idle: () => queue,
    };
}

export const generatorModule: DramatisModule<GeneratorSettings> = {
    key: 'generator',
    stage: 3,
    titleKey: 'generator.title',
    enabledByDefault: true,
    needsMaestro: true,
    defaults: () => ({ sketches: true, promotion: true, gapFill: true, rules: true }),
    i18n: GENERATOR_STRINGS,
    init(ctx) {
        ctx.app.modules.expose(GENERATOR_API, startGenerator(ctx));
    },
};
