// The motive card (docs/model.md §6): one short block per present character — what they are doing, what they want
// and from whom, their stance toward the player with the strongest reasons and how it shows, this beat's move in
// decisive words, one signature or tactic — an appetite line when an appetite matters now, the «initiative holds»
// line when the player only hesitated before what they started (§6.5), then «Busy with their own: …» for the
// background, and the «desire is not affection» rule when an appetite line is there. Only those present: whoever left
// the scene has no block, no move and no place in the busy line. With Maestro's scene split one separate line after
// the card names a few absent characters and what they are busy with, for the `<offscreen>` block only (§6.4). Third
// person, words not numbers, secrets and hidden appetites included (spoilers are a UI concern). Built from the stored
// state only: no AI on the send path (П10). Trimmed to a budget of ≈ chars / 4 tokens in a fixed order. Pure.
import { arcCardLine, choiceCardLine } from './arcs';
import {
    appetiteKindLabel,
    appetiteSourceLabel,
    endorsementLabel,
    gazePhrase,
    justificationLabel,
    methodNow,
    moodLabel,
    moveCardPhrase,
    pressureLabel,
    schemingLabel,
    stanceBehaviour,
    stanceLabel,
    stanceNoun,
    valueLabel,
    visibilityLabel,
} from './ladders';
import { sexualBarred } from './group-rules';
import type { Gender, Lang } from './ladders';
import { PLAYER_ID } from './model';
import { identityPhrase } from './thresholds';
import type {
    Agenda,
    Appetite,
    AttentionBand,
    CharacterProfile,
    CharacterState,
    ChatState,
    ElsewhereNote,
    Move,
    Reason,
    Scheme,
    Stance,
    Tie,
    WorldTone,
} from './model';

/** This beat's move of a character (attention / initiative passes). */
export interface CardMove {
    move: Move;
    /** Character id or PLAYER_ID. */
    target?: string;
    /** Short English description («quietly sends Брам to follow him»); wins over the generic move words. */
    text?: string;
}

/** What the appetite passes worked out for one appetite this turn; every field optional. */
export interface AppetiteNow {
    /** Appetite id. */
    appetite: string;
    /** Character id or PLAYER_ID the appetite is aimed at now. */
    target?: string;
    /** Method ladder step 0–8. */
    method?: number;
    /** What they do about it, story words («asks the carters when the caravan leaves»). */
    methodText?: string;
    /** What holds them back now, story words («the chief's ban on raids near the road (chief far away)»). */
    brakes?: string[];
    /** How they justify it, story words. */
    justification?: string;
}

export interface CastCardInput {
    /** Effective profiles: the card's characters plus the chat's extras. */
    profiles: readonly CharacterProfile[];
    state: ChatState;
    /** Ids of those present, in scene order. */
    present: readonly string[];
    /** Attention band per id (attention pass); an id missing here takes the state's band, else 'business'. */
    bands: Readonly<Record<string, AttentionBand>>;
    /** This beat's moves (missing: the state's scene move). */
    moves?: Readonly<Record<string, CardMove>>;
    playerName: string;
    lang: Lang;
    /** ≈ chars / 4; 0 or less = no limit. */
    budgetTokens: number;
    /** Maestro's voice digest of a character (CK LING, MBTI), merged into the block when `mergeVoices`. */
    speech?: (id: string) => string | null;
    /** Drift corrections per id (buildCorrectionLines). */
    corrections?: Readonly<Record<string, readonly string[]>>;
    mergeVoices: boolean;
    /** Appetite passes' view of this turn per character id. */
    appetites?: Readonly<Record<string, readonly AppetiteNow[]>>;
    /** Stage 5, «Кино»: the director's call for this beat per character id (card language); replaces the move. */
    director?: Readonly<Record<string, string>>;
    /** Stage 5: stress breaks of the last turn, the «snaps: …» text per character id (`state.next.snaps`). */
    snaps?: Readonly<Record<string, string>>;
    /** §6.5: present characters whose initiative holds against the player's hesitation, and what he said. */
    hold?: { ids: readonly string[]; said: string };
    /** §6.4, with Maestro's scene split: absent characters for the «Elsewhere» line and the block's tag. */
    elsewhere?: { notes: readonly ElsewhereNote[]; tag: string };
}

export interface CastCard {
    text: string;
    /** Ids that appear in the card (a block or the busy line). */
    included: string[];
    /** Absent ids named on the «Elsewhere» line. */
    elsewhere: string[];
    /** Ids whose block was cut by the budget (they stay named in the busy line). */
    trimmed: string[];
    /** ≈ chars / 4. */
    tokens: number;
}

export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/* ------------------------------------------------------------------ fixed words */

interface Words {
    /** `named`: the player has a name (else `player` is the generic word). */
    header: (player: string, named: boolean) => string;
    toward: (player: string) => string;
    thisTurn: string;
    pattern: string;
    tactic: string;
    secret: string;
    mood: string;
    withTie: (name: string) => string;
    busy: string;
    ignores: (player: string) => string;
    appetite: string;
    wants: (target: string) => string;
    heldBack: string;
    now: string;
    justifies: string;
    rule: string;
    correction: string;
    voice: string;
    says: string;
    withdrawal: string;
    vowAbstinent: string;
    vowModerate: string;
    regard: (stance: number, want: number) => string;
    emotionAt: (type: string, target: string) => string;
    quote: (text: string) => string;
    directed: string;
    snaps: string;
    arc: string;
    choice: string;
    /** §6.5. `pos`: the character's possessive (her / his / their). */
    hold: (name: string, player: string, said: string, pos: string) => string;
    /** §6.4. */
    elsewhere: (tag: string, list: string) => string;
}

const EN: Words = {
    header: (player) =>
        `[Cast minds — what drives each present character now. They act from these motives; the world does not revolve around ${player}. Keep stances as given; attention to ${player} only as stated.]`,
    toward: (player) => `Toward ${player}:`,
    thisTurn: 'This turn:',
    pattern: 'Pattern:',
    tactic: 'Tactic:',
    secret: 'Secret:',
    mood: 'Mood:',
    withTie: (name) => `With ${name}:`,
    busy: 'Busy with their own:',
    ignores: (player) => `ignores ${player}`,
    appetite: 'appetite:',
    wants: (target) => `Wants ${target}`,
    heldBack: 'Held back by:',
    now: 'Now:',
    justifies: 'Justifies it:',
    rule: 'Desire is not affection: wanting or getting what they crave never raises regard. Show wanting through attention, calculation, preparation and justification, not warmth. Prefer cunning to shouting.',
    correction: 'correction:',
    voice: 'voice:',
    says: 'says things like:',
    withdrawal: 'in withdrawal',
    vowAbstinent: 'a vow to stay off it',
    vowModerate: 'keeping to a measure',
    regard: (stance, want) =>
        stance <= -2
            ? 'hostility, not liking'
            : stance < 0
              ? 'contempt, not liking'
              : stance === 0
                ? 'no liking involved'
                : want >= 4
                  ? 'fond as well — and will not let go'
                  : 'fondness beside the wanting',
    emotionAt: (type, target) => (target ? `${type} at ${target}` : type),
    quote: (text) => (/[«"“]/.test(text.charAt(0)) ? text : `"${text}"`),
    directed: "This beat, director's call:",
    snaps: 'snaps:',
    arc: 'Arc:',
    choice: 'Defining choice:',
    hold: (name, player, said, pos) =>
        `${name} — initiative holds: ${player}'s ${said} is a beat of the scene, not its end. ${name} keeps pursuing it, as ${pos} nature and goal demand — insists, persuades, teases or takes control, and stops only if stopping is truly in ${pos} nature. Only a clear, decisive act of ${player} or an out-of-character request ends it.`,
    elsewhere: (tag, list) =>
        `[Elsewhere — not in this scene. Never bring them into it; at most one line about them in the <${tag}> block at the end, if something happens: ${list}.]`,
};

const RU: Words = {
    header: (player, named) =>
        `[Мотивы персонажей — что движет каждым из присутствующих сейчас. Они действуют из этих мотивов; мир не вращается вокруг игрока${named ? ` (${player})` : ''}. Позиции держать как заданы; внимание к игроку — только как указано.]`,
    toward: () => 'К игроку:',
    thisTurn: 'В этот ход:',
    pattern: 'Привычка:',
    tactic: 'Тактика:',
    secret: 'Тайна:',
    mood: 'Настроение:',
    withTie: (name) => `Связь — ${name}:`,
    busy: 'Заняты своим:',
    ignores: () => 'не замечает игрока',
    appetite: 'влечение:',
    wants: (target) => `Цель — ${target}`,
    heldBack: 'Сдерживает:',
    now: 'Сейчас:',
    justifies: 'Оправдание:',
    rule: 'Желание — не симпатия: хотеть или получить желаемое никогда не повышает расположения. Хотение видно по вниманию, расчёту, подготовке и оправданиям, а не по теплу. Хитрость прежде крика.',
    correction: 'поправка:',
    voice: 'речь:',
    says: 'говорит так:',
    withdrawal: 'ломка',
    vowAbstinent: 'обет завязать',
    vowModerate: 'знает меру',
    regard: (stance, want) =>
        stance <= -2
            ? 'вражда, а не симпатия'
            : stance < 0
              ? 'презрение, а не симпатия'
              : stance === 0
                ? 'симпатии тут нет'
                : want >= 4
                  ? 'есть и тепло — и не отпустит'
                  : 'тепло рядом с хотением',
    emotionAt: (type, target) => (target ? `${type} (${target})` : type),
    quote: (text) => (/[«"“]/.test(text.charAt(0)) ? text : `«${text}»`),
    directed: 'В этот такт, решение режиссёра:',
    snaps: 'срыв:',
    arc: 'Дуга:',
    choice: 'Главный выбор:',
    hold: (name, _player, said) =>
        `${name} — держит инициативу: ${said} игрока — часть сцены, а не её конец. Добивается своего, как велят природа и цель, — настаивает, уговаривает, дразнит или берёт верх; отступает, только если это и правда в характере. Закончить это может лишь ясный решительный поступок игрока или просьба вне роли.`,
    elsewhere: (tag, list) =>
        `[В других местах — не в этой сцене. Не вводить их в сцену; самое большее одна строка о них в блоке <${tag}> в конце, если что-то происходит: ${list}.]`,
};

/** Default stance toward the player when no tie exists yet, by world tone. */
const TONE_STANCE: Record<WorldTone, Stance> = { hostile: -1, indifferent: 0, neutral: 0, welcoming: 1 };

/* ------------------------------------------------------------------ text helpers */

/** A clause inside a sentence: no trailing full stop or semicolon. */
function clause(text: string | undefined): string {
    return (text ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[\s.;,]+$/u, '');
}

/** A whole sentence: ends with . ! ? … or a closing quote. */
function sentence(text: string): string {
    const value = text.replace(/\s+/g, ' ').trim();
    if (!value) return '';
    return /[.!?…»"”]$/u.test(value) ? value : `${value}.`;
}

/* ------------------------------------------------------------------ the view of one character */

interface AppetiteLine {
    text: string;
}

interface View {
    id: string;
    name: string;
    band: AttentionBand;
    /** Has a reason to keep a block even in the background (a move or a live appetite). */
    active: boolean;
    head: string;
    toward: string;
    reasons: string[];
    behaviour: string;
    stance: number;
    move: string;
    habit: string;
    secret: string;
    other: string;
    mood: string;
    voice: string;
    sample: string;
    appetites: AppetiteLine[];
    corrections: string[];
    busy: string;
    /** The move is the director's call. */
    directed: boolean;
    /** The «initiative holds» line (§6.5), or ''. */
    hold: string;
    snap: string;
    arc: string;
    identity: string;
    choice: string;
}

interface Context {
    input: CastCardInput;
    words: Words;
    player: string;
    named: boolean;
    byId: Map<string, CharacterProfile>;
}

function nameOf(ctx: Context, id: string | undefined): string {
    if (!id) return '';
    if (id === PLAYER_ID) return ctx.player;
    return ctx.byId.get(id)?.name ?? id;
}

/** Live tie (chat state) or the profile's base tie. */
export function tieOf(profile: CharacterProfile, live: CharacterState | undefined, target: string): Tie | undefined {
    return live?.ties[target] ?? profile.ties.find((tie) => tie.target === target);
}

/** Every tie of a character, live ones replacing base ones. */
function allTies(profile: CharacterProfile, live: CharacterState | undefined): Tie[] {
    const out = new Map<string, Tie>();
    for (const tie of profile.ties) out.set(tie.target, tie);
    if (live) for (const [target, tie] of Object.entries(live.ties)) out.set(target, tie);
    return [...out.values()];
}

/** Strongest first: |delta| × stacks, permanent ones before fading ones on a tie. */
export function strongestReasons(reasons: readonly Reason[], max: number): string[] {
    return [...reasons]
        .map((reason, index) => ({ reason, index, weight: Math.abs(reason.delta) * Math.max(1, reason.stacks) }))
        .sort(
            (a, b) =>
                b.weight - a.weight ||
                Number(a.reason.scenesLeft !== null) - Number(b.reason.scenesLeft !== null) ||
                a.index - b.index,
        )
        .slice(0, Math.max(0, max))
        .map((item) => clause(item.reason.text))
        .filter(Boolean);
}

function startOf(profile: CharacterProfile, greeting: number) {
    return (
        profile.starts.find((start) => start.greeting === greeting) ??
        profile.starts.find((start) => start.greeting === -1)
    );
}

function wantOf(agenda: Agenda): string {
    if (agenda.intentions[0]?.text) return agenda.intentions[0].text;
    const goals = [...agenda.goals].sort((a, b) => a.priority - b.priority);
    return goals[0]?.text ?? '';
}

function schemeFor(state: ChatState, owner: string, appetite: string): Scheme | undefined {
    return state.schemes.find(
        (scheme) =>
            scheme.owner === owner &&
            (scheme.appetite === appetite || !scheme.appetite) &&
            (scheme.state === 'running' || scheme.state === 'ready'),
    );
}

function appetiteLine(
    ctx: Context,
    profile: CharacterProfile,
    live: CharacterState | undefined,
    appetite: Appetite,
    now: AppetiteNow | undefined,
): AppetiteLine | null {
    const { words, input } = ctx;
    if (sexualBarred(appetite.kind, profile)) return null;
    const lang = input.lang;
    const gender: Gender | undefined = profile.gender;
    const pressure = live?.appetites[appetite.id]?.pressure ?? appetite.baseline;
    const withdrawal = live?.appetites[appetite.id]?.withdrawal === true;
    const ties = allTies(profile, live).filter(
        (tie) =>
            tie.want !== undefined &&
            tie.want > 0 &&
            (tie.appetite === appetite.id || (!tie.appetite && appetite.target.mode !== 'thing')) &&
            !sexualBarred(appetite.kind, profile, ctx.byId.get(tie.target)),
    );
    const present = new Set([...input.present, PLAYER_ID]);
    let tie: Tie | undefined = now?.target ? ties.find((item) => item.target === now.target) : undefined;
    if (!tie) {
        const ranked = [...ties].sort(
            (a, b) => Number(present.has(b.target)) - Number(present.has(a.target)) || (b.want ?? 0) - (a.want ?? 0),
        );
        tie = ranked[0];
    }
    const want = tie?.want ?? 0;
    if (!now && pressure < 2 && want < 3) return null;

    const first: string[] = [];
    const label = appetite.label ? ` (${words.quote(appetite.label)})` : '';
    first.push(
        `${appetiteKindLabel(appetite.kind, lang)}${label}, ${pressureLabel(pressure, lang, gender)}${withdrawal ? `, ${words.withdrawal}` : ''}`,
    );
    const sources = appetite.sources.map((source) => appetiteSourceLabel(source, lang, gender)).join(' + ');
    if (sources) first.push(sources);
    if (appetite.endorsement !== 'proud') first.push(endorsementLabel(appetite.endorsement, lang));
    if (appetite.visibility !== 'open') first.push(visibilityLabel(appetite.visibility, lang));
    const parts: string[] = [sentence(`${words.appetite} ${first.join('; ')}`)];

    const targetId = tie?.target ?? now?.target ?? (appetite.target.mode === 'player' ? PLAYER_ID : undefined);
    const targetName = targetId ? nameOf(ctx, targetId) : appetite.target.mode === 'class' ? appetite.target.class : '';
    if (targetName) {
        const gaze = tie?.gaze ? ` ${gazePhrase(tie.gaze, lang, appetite.kind)}` : '';
        const regardTie = targetId ? tieOf(profile, live, targetId) : undefined;
        const regard = regardTie ? ` — ${words.regard(regardTie.stance, want)}` : '';
        parts.push(sentence(`${words.wants(targetName)}${gaze}${regard}`));
    }

    const brakes = (now?.brakes?.length ? now.brakes : (appetite.restraints ?? [])).map(clause).filter(Boolean);
    if (appetite.vow === 'abstinent') brakes.push(words.vowAbstinent);
    else if (appetite.vow === 'moderate') brakes.push(words.vowModerate);
    if (brakes.length) parts.push(sentence(`${words.heldBack} ${brakes.join('; ')}`));

    const scheme = schemeFor(input.state, profile.id, appetite.id);
    const doing = clause(now?.methodText) || clause(scheme?.text);
    const how = scheme ? schemingLabel(lang) : now?.method !== undefined ? methodNow(now.method, lang) : '';
    if (how || doing) parts.push(sentence(`${words.now} ${[how, doing].filter(Boolean).join(' — ')}`));

    const excuse =
        clause(now?.justification) ||
        clause(appetite.excuse) ||
        (profile.core.justifications[0] ? justificationLabel(profile.core.justifications[0], lang) : '');
    if (excuse) parts.push(`${words.justifies} ${words.quote(excuse)}.`);
    return { text: `${profile.name} — ${parts.join(' ')}` };
}

function buildView(ctx: Context, id: string): View | null {
    const { input, words } = ctx;
    const profile = ctx.byId.get(id);
    if (!profile) return null;
    const { state, lang } = input;
    const live = state.characters[id];
    const start = startOf(profile, state.greeting);
    const agenda = live?.agenda ?? profile.agenda;
    const doing = clause(live?.scene.doing ?? start?.doing);
    const goal = clause(live?.scene.goal ?? start?.goal ?? wantOf(agenda));
    const band = input.bands[id] ?? live?.scene.attention ?? 'business';

    const toPlayer = tieOf(profile, live, PLAYER_ID);
    const stance: number = toPlayer?.stance ?? TONE_STANCE[state.worldTone] ?? 0;
    const toward =
        lang === 'ru'
            ? profile.gender
                ? stanceLabel(stance, lang, profile.gender).toLowerCase()
                : stanceNoun(stance, lang)
            : stanceLabel(stance, lang);

    const moveSpec: CardMove | undefined =
        input.moves?.[id] ??
        (live?.scene.move
            ? { move: live.scene.move, target: live.scene.moveTarget, text: live.scene.moveText }
            : undefined);
    const call = clause(input.director?.[id]);
    const snap = clause(input.snaps?.[id]);
    const planned = moveSpec
        ? clause(moveSpec.text) ||
          (moveSpec.move !== 'own' ? moveCardPhrase(moveSpec.move, lang, nameOf(ctx, moveSpec.target)) : '')
        : '';
    // The director's call wins over the engine's move; a break's «snaps» line stands for its move.
    const move = call || (snap ? '' : planned);
    const identity = live?.corruption?.identity;

    // One signature or tactic, rotating with the turn so the card stays fresh.
    const habits = [
        ...profile.core.signatures.map((text) => `${words.pattern} ${clause(text)}`),
        ...profile.core.tactics.map((text) => `${words.tactic} ${clause(text)}`),
    ];
    const habit = habits.length ? habits[Math.abs(state.turn) % habits.length]! : '';

    const presentSet = new Set(input.present);
    const npc = allTies(profile, live)
        .filter((tie) => tie.target !== PLAYER_ID && tie.target !== id && presentSet.has(tie.target))
        .filter((tie) => Math.abs(tie.stance) >= 2 || tie.intent !== 'none')
        .sort((a, b) => Math.abs(b.stance) - Math.abs(a.stance))[0];
    const other = npc
        ? `${words.withTie(nameOf(ctx, npc.target))} ${stanceNoun(npc.stance, lang)}${
              strongestReasons(npc.reasons, 1)[0] ? ` (${strongestReasons(npc.reasons, 1)[0]})` : ''
          }`
        : '';

    const mood = live?.mood ?? profile.core.baselineMood;
    const moodWord = mood.label?.trim() || moodLabel(mood.octant, lang);
    const emotion =
        live?.emotion && live.emotion.until >= state.turn
            ? `${words.emotionAt(clause(live.emotion.type), nameOf(ctx, live.emotion.target))}${
                  clause(live.emotion.cause) ? ` (${clause(live.emotion.cause)})` : ''
              }`
            : '';

    const nows = input.appetites?.[id] ?? [];
    const appetites = profile.appetites
        .map((appetite) =>
            appetiteLine(
                ctx,
                profile,
                live,
                appetite,
                nows.find((now) => now.appetite === appetite.id),
            ),
        )
        .filter((line): line is AppetiteLine => !!line);

    const speech = input.mergeVoices ? clause(input.speech?.(id) ?? '') : '';
    const busyBits = [doing, stance <= -1 ? `${words.ignores(ctx.player)}, ${stanceNoun(stance, lang)}` : ''];
    const possessive = profile.gender === 'female' ? 'her' : profile.gender === 'male' ? 'his' : 'their';
    const hold =
        input.hold?.ids.includes(id) && input.hold.said.trim()
            ? words.hold(profile.name, ctx.player, words.quote(input.hold.said.trim()), possessive)
            : '';
    return {
        id,
        name: profile.name,
        band,
        active: !!move || !!snap || !!hold || appetites.length > 0,
        head: [doing, goal].filter(Boolean).join('; '),
        toward,
        reasons: strongestReasons(toPlayer?.reasons ?? [], 2),
        behaviour: clause(toPlayer?.behaviour) || stanceBehaviour(stance, lang),
        stance,
        move,
        habit,
        secret: clause(agenda.secrets[0]),
        other,
        mood: [moodWord, emotion].filter(Boolean).join('; '),
        voice: speech,
        sample: (profile.core.voice ?? '').replace(/\s+/g, ' ').trim(),
        appetites,
        corrections: (input.corrections?.[id] ?? []).map(clause).filter(Boolean),
        busy: busyBits.filter(Boolean).join('; '),
        directed: !!call,
        hold,
        snap,
        arc: clause(arcCardLine(profile, live, lang)),
        identity: identity ? clause(identityPhrase(identity, lang, profile.gender)) : '',
        choice: clause(choiceCardLine(live, lang)),
    };
}

function capital(text: string): string {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/* ------------------------------------------------------------------ rendering with a trim level */

interface Level {
    maxReasons: number;
    /** Signature/tactic, secret, a tie to another present character, mood, voice sample. */
    extras: boolean;
    busyDetails: boolean;
    /** Speech digests and appetite lines of those not in focus (the focus character's always stay). */
    sideLines: boolean;
}

const LEVELS: Level[] = [
    { maxReasons: 2, extras: true, busyDetails: true, sideLines: true },
    { maxReasons: 1, extras: true, busyDetails: true, sideLines: true },
    { maxReasons: 1, extras: false, busyDetails: true, sideLines: true },
    { maxReasons: 1, extras: false, busyDetails: false, sideLines: true },
    { maxReasons: 1, extras: false, busyDetails: false, sideLines: false },
];

function renderBlock(ctx: Context, view: View, level: Level): { lines: string[]; appetite: boolean } {
    const { words } = ctx;
    const reasons = view.reasons.slice(0, level.maxReasons);
    const toward = `${words.toward(ctx.player)} ${view.toward}${reasons.length ? ` (${reasons.join('; ')})` : ''} — ${view.behaviour}`;
    const main = [view.head ? sentence(view.head) : '', sentence(toward)];
    if (view.move) main.push(sentence(`${view.directed ? words.directed : words.thisTurn} ${view.move}`));
    if (view.identity) main.push(sentence(capital(view.identity)));
    if (view.arc) main.push(sentence(`${words.arc} ${view.arc}`));
    if (level.extras) {
        if (view.choice) main.push(sentence(`${words.choice} ${view.choice}`));
        if (view.habit) main.push(sentence(view.habit));
        if (view.secret) main.push(sentence(`${words.secret} ${view.secret}`));
        if (view.other) main.push(sentence(view.other));
        if (view.mood) main.push(sentence(`${words.mood} ${view.mood}`));
    }
    const lines = [`${view.name} — ${main.filter(Boolean).join(' ')}`];
    if (view.hold) lines.push(view.hold);
    const side = level.sideLines || view.band === 'focus';
    const voice = [
        side ? view.voice : '',
        level.extras && view.sample ? `${words.says} ${words.quote(view.sample)}` : '',
    ]
        .filter(Boolean)
        .join('; ');
    if (voice) lines.push(`${view.name} — ${words.voice} ${sentence(voice)}`);
    if (view.snap) lines.push(`${view.name} — ${words.snaps} ${sentence(view.snap)}`);
    const appetites = side ? view.appetites : [];
    for (const line of appetites) lines.push(line.text);
    for (const correction of view.corrections) lines.push(`${view.name} — ${words.correction} ${sentence(correction)}`);
    return { lines, appetite: appetites.length > 0 };
}

function renderCard(ctx: Context, views: View[], level: Level, dropped: ReadonlySet<string>): string {
    const lines = [ctx.words.header(ctx.player, ctx.named)];
    const busy: string[] = [];
    let appetite = false;
    for (const view of views) {
        const blocked = (view.band !== 'background' || view.active) && !dropped.has(view.id);
        if (blocked) {
            const block = renderBlock(ctx, view, level);
            lines.push(...block.lines);
            appetite ||= block.appetite;
        } else {
            busy.push(
                level.busyDetails && view.busy && !dropped.has(view.id) ? `${view.name} (${view.busy})` : view.name,
            );
        }
    }
    if (busy.length) lines.push(sentence(`${ctx.words.busy} ${busy.join(', ')}`));
    if (appetite) lines.push(ctx.words.rule);
    return lines.join('\n');
}

const BAND_RANK: Record<AttentionBand, number> = { background: 0, business: 1, focus: 2 };

/** Names of absent characters on the «Elsewhere» line, as many as fit (most important first). */
function withElsewhere(ctx: Context, text: string, fits: (text: string) => boolean): { text: string; ids: string[] } {
    const spec = ctx.input.elsewhere;
    const notes = (spec?.notes ?? []).filter(
        (note) => ctx.byId.has(note.id) && !ctx.input.present.includes(note.id) && clause(note.text),
    );
    for (let count = notes.length; count > 0; count--) {
        const chosen = notes.slice(0, count);
        const list = chosen.map((note) => `${nameOf(ctx, note.id)} (${clause(note.text)})`).join('; ');
        const full = `${text}\n${ctx.words.elsewhere(spec!.tag.trim() || 'offscreen', list)}`;
        if (fits(full)) return { text: full, ids: chosen.map((note) => note.id) };
    }
    return { text, ids: [] };
}

/**
 * The motive card for this generation. Trims in order until it fits `budgetTokens`: reasons beyond the first, the
 * extras (signature or tactic, secret, tie to another present character, mood, voice sample), the details of the busy
 * line, the speech digests and appetite lines of those not in focus, then whole blocks of the lowest band (background,
 * business, focus last; without a move first; later ones first; one whose initiative holds after them all) — their
 * names move to the busy line. One block always stays; the move, the appetite lines of the focus and the «initiative
 * holds» line go only with their block. The «Elsewhere» line comes last and only in what the budget leaves.
 */
export function buildCastCard(input: CastCardInput): CastCard {
    const byId = new Map(input.profiles.map((profile) => [profile.id, profile] as const));
    const ctx: Context = {
        input,
        words: input.lang === 'ru' ? RU : EN,
        player: input.playerName.trim() || (input.lang === 'ru' ? 'игрок' : 'the player'),
        named: !!input.playerName.trim(),
        byId,
    };
    const ids = [...new Set(input.present)];
    const views = ids.map((id) => buildView(ctx, id)).filter((view): view is View => !!view);
    const fits = (text: string) => input.budgetTokens <= 0 || estimateTokens(text) <= input.budgetTokens;
    const finish = (card: string, dropped: ReadonlySet<string>): CastCard => {
        const { text, ids } = withElsewhere(ctx, card, fits);
        return {
            text,
            included: views.map((view) => view.id),
            elsewhere: ids,
            trimmed: views.filter((view) => dropped.has(view.id)).map((view) => view.id),
            tokens: estimateTokens(text),
        };
    };
    if (!views.length) return { text: '', included: [], elsewhere: [], trimmed: [], tokens: 0 };
    const none = new Set<string>();
    for (const level of LEVELS) {
        const text = renderCard(ctx, views, level, none);
        if (fits(text)) return finish(text, none);
    }
    const last = LEVELS[LEVELS.length - 1]!;
    const order = views
        .map((view, index) => ({ view, index }))
        .filter(({ view }) => view.band !== 'background' || view.active)
        .sort(
            (a, b) =>
                Number(!!a.view.hold) - Number(!!b.view.hold) ||
                BAND_RANK[a.view.band] - BAND_RANK[b.view.band] ||
                Number(a.view.active) - Number(b.view.active) ||
                b.index - a.index,
        )
        .map(({ view }) => view.id);
    const dropped = new Set<string>();
    let text = renderCard(ctx, views, last, dropped);
    for (const id of order.slice(0, Math.max(0, order.length - 1))) {
        if (fits(text)) break;
        dropped.add(id);
        text = renderCard(ctx, views, last, dropped);
    }
    return finish(text, dropped);
}

/* ------------------------------------------------------------------ drift corrections (§8, «Поправка») */

/** What the next card must stress (the drift module's emphasis). */
export type CorrectionEmphasis = 'stance' | 'appetite-separation' | 'withdrawal' | 'values';

/** One correction per character and target (structurally the drift module's `DriftCorrection`). */
export interface CorrectionNote {
    /** Character id. */
    character: string;
    /** Whom the drift was about (default: the player). */
    target?: string;
    emphasise: readonly CorrectionEmphasis[];
    /** The reply played the tie warmer (or colder) than the engine holds it. */
    drift?: 'warmer' | 'colder';
}

export interface CorrectionContext {
    profiles: readonly CharacterProfile[];
    state: ChatState;
    playerName: string;
    lang: Lang;
}

/** Lines per character at most. */
const CORRECTIONS_MAX = 3;

/**
 * Lines that remind the next card harder of the stance and its reason after a drift (the model warmed up without a
 * cause, a predator turned tender, a dependence vanished, someone acted against themselves). The engine's state does
 * not change: warmth without a cause is not counted. Keyed by character id, for `CastCardInput.corrections`.
 */
export function buildCorrectionLines(
    notes: readonly CorrectionNote[],
    ctx: CorrectionContext,
): Record<string, string[]> {
    const { lang, state } = ctx;
    const ru = lang === 'ru';
    const words = ru ? RU : EN;
    const player = ctx.playerName.trim() || (ru ? 'игрок' : 'the player');
    const byId = new Map(ctx.profiles.map((profile) => [profile.id, profile] as const));
    const nameOf = (id: string) => (id === PLAYER_ID ? player : (byId.get(id)?.name ?? id));
    const out: Record<string, string[]> = {};
    const add = (id: string, line: string) => {
        const list = (out[id] ??= []);
        if (!list.includes(line) && list.length < CORRECTIONS_MAX) list.push(line);
    };
    for (const note of notes) {
        const profile = byId.get(note.character);
        if (!profile) continue;
        const live = state.characters[note.character];
        const target = note.target ?? PLAYER_ID;
        const toTarget = ru ? (target === PLAYER_ID ? 'к игроку' : `к: ${nameOf(target)}`) : `toward ${nameOf(target)}`;
        const tie = tieOf(profile, live, target);
        const stance = tie?.stance ?? 0;
        const reason = strongestReasons(tie?.reasons ?? [], 1)[0];
        const why = reason ? ` (${reason})` : '';
        const behaviour = clause(tie?.behaviour) || stanceBehaviour(stance, lang);
        for (const emphasis of note.emphasise) {
            if (emphasis === 'stance') {
                const colder = note.drift === 'colder';
                add(
                    note.character,
                    ru
                        ? `по-прежнему ${stanceNoun(stance, lang)} ${toTarget}${why} — ${colder ? 'причины для холода нет' : 'тепла без причины нет'}; ${behaviour}`
                        : `still ${stanceLabel(stance, lang)} ${toTarget}${why} — ${colder ? 'nothing has turned them cold' : 'nothing has earned warmth'}; ${behaviour}`,
                );
            } else if (emphasis === 'appetite-separation') {
                const appetite = profile.appetites.find((item) => item.id === tie?.appetite);
                const gaze = tie?.gaze ? ` ${gazePhrase(tie.gaze, lang, appetite?.kind)}` : '';
                add(
                    note.character,
                    ru
                        ? `хотение — не привязанность: цель — ${nameOf(target)}${gaze}; нежности без причины нет`
                        : `wanting is not affection — still wants ${nameOf(target)}${gaze}; no tenderness without a cause`,
                );
            } else if (emphasis === 'withdrawal') {
                const appetite =
                    profile.appetites.find((item) => item.dependence > 0 && live?.appetites[item.id]?.withdrawal) ??
                    profile.appetites.find((item) => item.dependence > 0);
                if (!appetite) continue;
                const now = live?.appetites[appetite.id];
                const pressure = pressureLabel(now?.pressure ?? appetite.baseline, lang, profile.gender);
                const what = appetite.label ? words.quote(appetite.label) : appetiteKindLabel(appetite.kind, lang);
                const withdrawal = now?.withdrawal ? `, ${words.withdrawal}` : '';
                add(
                    note.character,
                    ru
                        ? `тяга (${what}) по-прежнему: ${pressure}${withdrawal} — сама не проходит, без опоры и причины не отказаться`
                        : `the craving for ${what} is still ${pressure}${withdrawal} — it does not vanish without help or a reason`,
                );
            } else {
                const values = profile.core.values.top.map((value) => valueLabel(value, lang)).join(', ');
                const goal = clause(live?.scene.goal ?? wantOf(live?.agenda ?? profile.agenda));
                const anchor = [values, goal].filter(Boolean).join('; ');
                add(
                    note.character,
                    ru
                        ? `действует из своего${anchor ? ` (${anchor})` : ''} — против себя без причины не идёт`
                        : `acts from what they value${anchor ? ` (${anchor})` : ''} — never against themselves without a cause`,
                );
            }
        }
    }
    return out;
}
