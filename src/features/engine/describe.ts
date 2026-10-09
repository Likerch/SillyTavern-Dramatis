// DRAMATIS_API.describe: a display-ready summary of one character of the current chat in the UI language — what
// Maestro shows in the «Dramatis» tab of DES's Character Sheet. Sections in a fixed order, empty ones left out:
// «Отношение к тебе» (the live stance word with its strongest reasons and how it shows, desire / gaze / claim and the
// intent toward the player), «Чего хочет» (goals by priority, intentions with their next step, the dream), «Сейчас»
// (the scene from the chat state, mood, a live emotion, notable stress, corruption), «Влечения» (each appetite with its
// pressure word and target), «Кто это» (values, temperament extremes, drives, the wound, signatures, tactics, keys) and
// «Тайны» (agenda secrets, what happens if nobody intervenes, running schemes).
// Scales come as ladder words; free text (reasons, goals, the scene…) stays as stored, often English. Lines that give a
// secret away carry `secret` (the chat's «Видимость тайного» lever, `secrets`, says how to show them; with «только
// известное» they are left out here already). At most DESCRIBE_MAX_LINES lines: the longest sections give up their
// last lines first.
import { STRESS_BREAK } from '../../domain/drift';
import {
    appetiteKindLabel,
    claimLabel,
    corruptionLabel,
    driveLabel,
    gazePhrase,
    hexacoPole,
    lodLabel,
    moodLabel,
    pressureLabel,
    stanceBehaviour,
    stanceLabel,
    tieIntentLabel,
    valueLabel,
    wantLabel,
} from '../../domain/ladders';
import type { Lang } from '../../domain/ladders';
import { HEXACO, PLAYER_ID } from '../../domain/model';
import type { CharacterProfile, CharacterState } from '../../domain/model';
import { emotionActive } from '../../domain/mood';
import { strongestReasons } from '../../domain/render';
import { isCovertTie, isHiddenAppetite, isHiddenIntention } from '../../domain/secrets';
import type { DramatisCharacterView, DramatisViewLine } from '../../shared/apis';
import type { EngineView } from './api';
import { playerTie } from './view';

/** Lines of one summary at most (all sections together). */
export const DESCRIBE_MAX_LINES = 25;
const MAX_REASONS = 3;
const MAX_GOALS = 3;
const MAX_INTENTIONS = 2;
const MAX_APPETITES = 4;
const MAX_SIGNATURES = 3;
const MAX_SECRETS = 3;
const MAX_SCHEMES = 2;
/** Stress worth a line: half the way to a break. */
const STRESS_NOTABLE = STRESS_BREAK / 2;

export interface DescribeInput {
    view: EngineView;
    /** Profile id (resolved by the caller). */
    id: string;
    lang: Lang;
    t: (key: string, params?: Record<string, string | number>) => string;
    /** The chat's «Видимость тайного» lever. */
    secrets: DramatisCharacterView['secrets'];
    /** The player's name as the story writes it (or the generic word). */
    player: string;
}

type Section = DramatisCharacterView['sections'][number];

interface Ctx extends DescribeInput {
    profile: CharacterProfile;
    live: CharacterState | undefined;
}

/** Stored free text on one line, without trailing punctuation. */
function clean(value: string | undefined): string {
    return (value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[\s.;,]+$/u, '');
}

function line(text: string, secret = false): DramatisViewLine {
    return secret ? { text, secret: true } : { text };
}

function nameOf(ctx: Ctx, id: string | undefined): string {
    if (!id) return '';
    if (id === PLAYER_ID) return ctx.player;
    return ctx.view.byId.get(id)?.name ?? id;
}

function stanceLines(ctx: Ctx): DramatisViewLine[] {
    const { profile, live, lang, t } = ctx;
    const tie = playerTie(profile, live);
    if (!tie) return [];
    const out: DramatisViewLine[] = [];
    const stance = stanceLabel(tie.stance, lang, profile.gender);
    const reasons = strongestReasons(tie.reasons ?? [], MAX_REASONS);
    out.push(line(reasons.length ? t('engine.describe.stance', { stance, reasons: reasons.join('; ') }) : stance));
    out.push(line(t('engine.describe.behaviour', { text: clean(tie.behaviour) || stanceBehaviour(tie.stance, lang) })));

    const appetite = tie.appetite ? profile.appetites.find((item) => item.id === tie.appetite) : undefined;
    const desire: string[] = [];
    if ((tie.want ?? 0) > 0) {
        const want = wantLabel(tie.want ?? 0, lang);
        const gaze = tie.gaze ? gazePhrase(tie.gaze, lang, appetite?.kind) : '';
        desire.push(t('engine.describe.want', { want: gaze ? `${want}, ${gaze}` : want }));
    }
    if (tie.claim && tie.claim !== 'none') {
        desire.push(t('engine.describe.claim', { claim: claimLabel(tie.claim, lang, profile.gender) }));
    }
    if (desire.length) out.push(line(desire.join('; '), !!appetite && isHiddenAppetite(appetite)));
    if (tie.intent && tie.intent !== 'none') {
        out.push(line(t('engine.describe.intent', { intent: tieIntentLabel(tie.intent, lang) }), isCovertTie(tie)));
    }
    return out;
}

function wantsLines(ctx: Ctx): DramatisViewLine[] {
    const { profile, live, t } = ctx;
    const agenda = live?.agenda ?? profile.agenda;
    const out: DramatisViewLine[] = [];
    /** The stored text of each line of `out` (same index), for spotting an intention that repeats a goal. */
    const keys: string[] = [];
    const goals = [...(agenda.goals ?? [])].sort((a, b) => a.priority - b.priority);
    for (const goal of goals) {
        const text = clean(goal.text);
        const key = text.toLowerCase();
        if (!text || keys.includes(key)) continue;
        keys.push(key);
        out.push(line(text));
        if (out.length >= MAX_GOALS) break;
    }
    let intentions = 0;
    for (const intention of agenda.intentions ?? []) {
        if (intentions >= MAX_INTENTIONS) break;
        const text = clean(intention.text);
        if (!text) continue;
        const next = clean(intention.nextStep);
        const shown = next ? t('engine.describe.intention', { text, next }) : text;
        const hidden = isHiddenIntention(intention);
        const same = keys.indexOf(text.toLowerCase());
        if (same >= 0 && !hidden) {
            // The intention repeats a line already listed: its next step joins that line.
            if (next && !out[same]!.secret) out[same] = line(shown);
            continue;
        }
        keys.push(text.toLowerCase());
        out.push(line(shown, hidden));
        intentions++;
    }
    const dream = clean(agenda.dream);
    if (dream) out.push(line(t('engine.describe.dream', { text: dream })));
    return out;
}

function nowLines(ctx: Ctx): DramatisViewLine[] {
    const { profile, live, lang, t, view } = ctx;
    const out: DramatisViewLine[] = [];
    const scene = live?.scene;
    const doing = clean(scene?.doing);
    const goal = clean(scene?.goal);
    const obstacle = clean(scene?.obstacle);
    if (doing) out.push(line(t('engine.describe.doing', { text: doing })));
    if (goal) out.push(line(t('engine.describe.sceneGoal', { text: goal })));
    if (obstacle) out.push(line(t('engine.describe.obstacle', { text: obstacle })));
    const mood = live?.mood ?? profile.core.baselineMood;
    if (mood) out.push(line(t('engine.describe.mood', { mood: clean(mood.label) || moodLabel(mood.octant, lang) })));
    const emotion = live?.emotion;
    if (emotionActive(emotion, view.state.turn) && clean(emotion.type)) {
        const target = nameOf(ctx, emotion.target);
        const cause = clean(emotion.cause);
        const text = `${clean(emotion.type)}${target ? ` (${target})` : ''}${cause ? ` — ${cause}` : ''}`;
        out.push(line(t('engine.describe.emotion', { text })));
    }
    const stress = live?.stress ?? 0;
    if (Number.isFinite(stress) && stress >= STRESS_NOTABLE) {
        out.push(line(t('engine.describe.stress', { n: Math.round(stress), max: STRESS_BREAK })));
    }
    const corruption = live?.corruption.level ?? profile.core.corruption ?? 0;
    if (Number.isFinite(corruption) && corruption > 0) {
        const level = Math.round(corruption);
        out.push(line(t('engine.describe.corruption', { level, word: corruptionLabel(level, lang, profile.gender) })));
    }
    return out;
}

function appetiteLines(ctx: Ctx): DramatisViewLine[] {
    const { profile, live, lang, t } = ctx;
    return profile.appetites
        .map((appetite, index) => ({
            appetite,
            index,
            pressure: live?.appetites[appetite.id]?.pressure ?? appetite.baseline,
        }))
        .sort((a, b) => b.pressure - a.pressure || a.index - b.index)
        .slice(0, MAX_APPETITES)
        .map(({ appetite, pressure }) => {
            const what = clean(appetite.label) || appetiteKindLabel(appetite.kind, lang);
            const word = pressureLabel(pressure, lang, profile.gender);
            const target =
                appetite.target.mode === 'class'
                    ? clean(appetite.target.class)
                    : appetite.target.mode === 'player'
                      ? ctx.player
                      : '';
            const text = target
                ? t('engine.describe.appetiteTarget', { what, pressure: word, target })
                : t('engine.describe.appetite', { what, pressure: word });
            return line(text, isHiddenAppetite(appetite));
        });
}

function coreLines(ctx: Ctx): DramatisViewLine[] {
    const { profile, lang, t } = ctx;
    const core = profile.core;
    const out: DramatisViewLine[] = [];
    const values = (core.values?.top ?? []).map((value) => valueLabel(value, lang)).filter(Boolean);
    if (values.length) {
        const list = values.join(', ');
        const sacrifice = core.values.sacrifice ? valueLabel(core.values.sacrifice, lang) : '';
        out.push(
            line(
                sacrifice
                    ? t('engine.describe.valuesSacrifice', { list, sacrifice })
                    : t('engine.describe.values', { list }),
            ),
        );
    }
    const poles = HEXACO.map((axis) => hexacoPole(axis, core.temperament?.[axis] ?? 0, lang, 2, profile.gender)).filter(
        Boolean,
    );
    if (poles.length) out.push(line(t('engine.describe.temperament', { list: poles.join(', ') })));
    const drives = (core.drives?.high ?? []).map((drive) => driveLabel(drive, lang)).filter(Boolean);
    if (drives.length) out.push(line(t('engine.describe.drives', { list: drives.join(', ') })));
    const ghost = clean(core.wound?.ghost);
    const lie = clean(core.wound?.lie);
    if (ghost) out.push(line(t('engine.describe.wound', { text: ghost })));
    if (lie) out.push(line(t('engine.describe.lie', { text: lie }), true));
    for (const signature of (core.signatures ?? []).map(clean).filter(Boolean).slice(0, MAX_SIGNATURES)) {
        out.push(line(t('engine.describe.signature', { text: signature })));
    }
    const tactics = (core.tactics ?? []).map(clean).filter(Boolean);
    if (tactics.length) out.push(line(t('engine.describe.tactics', { list: tactics.join(', ') })));
    const keys = (core.keys ?? []).map(clean).filter(Boolean);
    if (keys.length) out.push(line(t('engine.describe.keys', { list: keys.join('; ') })));
    return out;
}

function secretLines(ctx: Ctx): DramatisViewLine[] {
    const { profile, live, t, view } = ctx;
    const agenda = live?.agenda ?? profile.agenda;
    const out: DramatisViewLine[] = (agenda.secrets ?? [])
        .map(clean)
        .filter(Boolean)
        .slice(0, MAX_SECRETS)
        .map((text) => line(text, true));
    const front = agenda.front && !agenda.front.done ? agenda.front : undefined;
    const doom = clean(front?.doom) || clean(agenda.ifIgnored);
    if (doom) out.push(line(t('engine.describe.doom', { text: doom }), true));
    const schemes = (view.state.schemes ?? []).filter(
        (scheme) => scheme.owner === profile.id && (scheme.state === 'running' || scheme.state === 'ready'),
    );
    for (const scheme of schemes.slice(0, MAX_SCHEMES)) {
        const text = clean(scheme.text);
        if (text) out.push(line(t('engine.describe.scheme', { target: nameOf(ctx, scheme.target), text }), true));
    }
    return out;
}

/** Cuts the sections down to `max` lines: the longest one (the later one on a tie) loses its last line first. */
export function fitSections(sections: Section[], max: number): Section[] {
    let total = sections.reduce((sum, section) => sum + section.lines.length, 0);
    while (total > max) {
        let longest = 0;
        sections.forEach((section, index) => {
            if (section.lines.length >= sections[longest]!.lines.length) longest = index;
        });
        sections[longest]!.lines.pop();
        total--;
    }
    return sections.filter((section) => section.lines.length > 0);
}

/** The summary of one character, or null when the view has no profile with this id. */
export function describeCharacter(input: DescribeInput): DramatisCharacterView | null {
    const profile = input.view.byId.get(input.id);
    if (!profile) return null;
    const ctx: Ctx = { ...input, profile, live: input.view.state.characters[profile.id] };
    const { t, lang } = ctx;
    const build: [string, (ctx: Ctx) => DramatisViewLine[]][] = [
        ['stance', stanceLines],
        ['wants', wantsLines],
        ['now', nowLines],
        ['appetites', appetiteLines],
        ['core', coreLines],
        ['secrets', secretLines],
    ];
    const sections: Section[] = build.map(([id, lines]) => ({
        id,
        title: t(`engine.describe.section.${id}`),
        lines: lines(ctx).filter((item) => item.text && !(input.secrets === 'known' && item.secret)),
    }));
    const view: DramatisCharacterView = {
        name: profile.name,
        sections: fitSections(sections, DESCRIBE_MAX_LINES),
        secrets: input.secrets,
    };
    const headline = clean(profile.core.concept) || clean(profile.role);
    if (headline) view.headline = headline;
    view.detail = lodLabel(profile.lod, lang).toLocaleLowerCase(lang);
    return view;
}
