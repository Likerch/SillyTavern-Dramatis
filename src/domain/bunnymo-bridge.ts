// The bridge to BunnyMo (docs/model.md §10.5; research/bunnymo-drives.md, stack-recon.md). BunnyMo/CK own the «how»
// (manner, speech, style); Dramatis reads their tags as hints and, for portraits without an archive, picks tags for
// one from the closed lists of the packs (src/data/bunnymo-vocabulary.json, taken from BunnyMo V3.0 and its packs).
// - tags → fields: ATTACHMENT → attachment axes, TRUST/LOYALTY → keys, CONFLICT → tactics, MBTI -U → coping,
//   VICE / TRAIT:ALCOHOLIC / BSM / REC → drink or substance appetites (BSM and REC with dependence), TRAIT:LUSTFUL /
//   HEDONISTIC / GLUTTONOUS → appetite baselines, COMFORT:SUBSTANCE / FOOD → coping appetites fed by stress,
//   SPECIES / GENDER → identity; KINK, POWER, AROUSAL… stay BunnyMo's style: remembered, never duplicated.
// - fields → tags: DERE, MBTI with -H/-U, TRAIT ×2, ATTACHMENT, CONFLICT, BOUNDARIES, DECISION, COMFORT, VICE, LOYALTY,
//   TRUST, MASK, LING, plus SPECIES and GENDER when known — every value checked against the vocabulary.
// Pure.
import rawVocabulary from '../data/bunnymo-vocabulary.json';
import { defaultDrift } from './appetites';
import type { Appetite, AppetiteKind, CharacterProfile, Coping, HexacoAxis, Level5 } from './model';
import { normalizeAppetite } from './profile-defaults';
import type { ArchiveSheet } from '../shared/contracts';

/* ------------------------------------------------------------------ vocabulary */

export const VOCABULARY_LISTS = [
    'DERE',
    'TRAIT',
    'ATTACHMENT',
    'CONFLICT',
    'BOUNDARIES',
    'DECISION',
    'COMFORT',
    'VICE',
    'LOYALTY',
    'TRUST',
    'MASK',
    'LING',
    'SPECIES',
] as const;
export type VocabularyList = (typeof VOCABULARY_LISTS)[number];

export interface BunnymoVocabulary {
    lists: Record<VocabularyList, readonly string[]>;
    mbti: { types: readonly string[]; variants: readonly string[] };
}

function upperList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
        if (typeof item !== 'string') continue;
        const tag = item.trim().toUpperCase();
        if (tag && !out.includes(tag)) out.push(tag);
    }
    return out;
}

/** Checks a vocabulary document (the bundled JSON or a fixture): upper-case unique values per list. */
export function loadVocabulary(raw: unknown): BunnymoVocabulary {
    const dict = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const lists = {} as Record<VocabularyList, readonly string[]>;
    for (const name of VOCABULARY_LISTS) lists[name] = upperList(dict[name]);
    const mbti = typeof dict.MBTI === 'object' && dict.MBTI !== null ? (dict.MBTI as Record<string, unknown>) : {};
    return { lists, mbti: { types: upperList(mbti.types), variants: upperList(mbti.variants) } };
}

export const BUNNYMO_VOCABULARY: BunnymoVocabulary = loadVocabulary(rawVocabulary);

/* ------------------------------------------------------------------ tags */

export interface Tag {
    key: string;
    value: string;
}

export type TagInput = string | Tag;

const MBTI_RE = /^([EI][NS][FT][JP])(?:-([HU]))?$/i;

/** `<KEY:VALUE>`, `KEY:VALUE`, a bare `<ENTJ-U>` (→ MBTI) or {key, value} → upper-case key and value; null for junk. */
export function parseTag(input: TagInput): Tag | null {
    if (typeof input !== 'string') {
        const key = String(input?.key ?? '')
            .trim()
            .toUpperCase();
        const value = String(input?.value ?? '')
            .trim()
            .toUpperCase()
            .replace(/\s+/g, '_');
        return key && value ? { key, value } : null;
    }
    const text = input.trim().replace(/^<|>$/g, '').trim();
    const bare = MBTI_RE.exec(text);
    if (bare) return { key: 'MBTI', value: text.toUpperCase() };
    const colon = text.indexOf(':');
    if (colon <= 0) return null;
    const key = text.slice(0, colon).trim().toUpperCase();
    const value = text
        .slice(colon + 1)
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '_');
    return key && value ? { key, value } : null;
}

/** Every tag of a CK archive as `KEY:VALUE`, its MBTI included (`MBTI:ENTJ-U`). */
export function sheetTags(sheet: Pick<ArchiveSheet, 'tags' | 'mbti'>): string[] {
    const out = sheet.tags.map((tag) => `${tag.key.toUpperCase()}:${tag.value.toUpperCase()}`);
    if (sheet.mbti?.type)
        out.push(`MBTI:${sheet.mbti.type.toUpperCase()}${sheet.mbti.variant ? `-${sheet.mbti.variant}` : ''}`);
    return out;
}

/* ------------------------------------------------------------------ tags → fields */

export interface TagFields {
    species?: string;
    gender?: 'female' | 'male';
    attachment?: { anxiety: Level5; avoidance: Level5 };
    /** Events able to move them («trusts only deeds»). */
    keys: string[];
    tactics: string[];
    coping?: Coping;
    temperament: Partial<Record<HexacoAxis, Level5>>;
    dark: { ruthless?: boolean; schemer?: boolean; sadist?: boolean; entitled?: boolean };
    appetites: Appetite[];
    /** Tags BunnyMo keeps as style (KINK, POWER, AROUSAL, ORIENTATION, CHEMISTRY, FLIRTING, JEALOUSY): only remembered. */
    style: string[];
    mbti?: { type: string; variant?: 'H' | 'U' };
    /** Every tag read, `KEY:VALUE`. */
    tags: string[];
}

const ATTACHMENT_AXES: Record<string, { anxiety: Level5; avoidance: Level5 }> = {
    SECURE: { anxiety: 0, avoidance: 0 },
    EARNED_SECURE: { anxiety: 0, avoidance: 0 },
    NATURAL_SECURE: { anxiety: 0, avoidance: 0 },
    ANXIOUS: { anxiety: 2, avoidance: 0 },
    ANXIOUS_CLINGY: { anxiety: 2, avoidance: -1 },
    ANXIOUS_PERFORMING: { anxiety: 2, avoidance: 0 },
    ANXIOUS_JEALOUS: { anxiety: 2, avoidance: 0 },
    ANXIOUS_PREOCCUPIED: { anxiety: 2, avoidance: -1 },
    AVOIDANT: { anxiety: -1, avoidance: 2 },
    DISMISSIVE: { anxiety: -1, avoidance: 2 },
    DISMISSIVE_AVOIDANT: { anxiety: -1, avoidance: 2 },
    FEARFUL: { anxiety: 2, avoidance: 2 },
    FEARFUL_AVOIDANT: { anxiety: 2, avoidance: 2 },
    DISORGANIZED: { anxiety: 2, avoidance: 1 },
    CHAOTIC_DISORGANIZED: { anxiety: 2, avoidance: 1 },
    FROZEN_DISORGANIZED: { anxiety: 1, avoidance: 2 },
};

/** Keys (what moves them) from TRUST and LOYALTY. TRUST:EARNED is the docs' name for «only deeds count». */
const TRUST_KEYS: Record<string, string> = {
    'TRUST:EARNED': 'Trusts only deeds, never words; trust is earned slowly',
    'TRUST:SLOW': 'Trusts only deeds, never words; trust is earned slowly',
    'LOYALTY:EARNED': 'Trusts only deeds, never words; trust is earned slowly',
    'TRUST:SUSPICIOUS': 'Assumes betrayal until proven otherwise; only proof earns trust',
    'TRUST:SHATTERED': 'Whoever betrays them once is never trusted again',
    'TRUST:TESTING': 'Tests people before trusting them; whoever stays through the test is trusted',
    'TRUST:CONDITIONAL': 'Trusts people in some matters and never in others',
    'LOYALTY:CONDITIONAL': 'Loyalty follows advantage: a better offer can turn them',
    'LOYALTY:SHIFTING': 'Loyalty follows advantage: a better offer can turn them',
    'LOYALTY:CODE': 'Moved by what their code demands, not by friendship',
    'LOYALTY:RIDE_OR_DIE': 'Loyal without condition to their own; harm to them is never forgiven',
    'LOYALTY:BROKEN': 'Betrayed once; loyalty has to be proven over a long time',
};

const CONFLICT_TACTICS: Record<string, string> = {
    COMPETING: 'pressure',
    COMPETITIVE: 'pressure',
    ACCOMMODATING: 'giving way to keep the peace',
    AVOIDING: 'evasion',
    AVOIDANT: 'evasion',
    COMPROMISING: 'bargaining',
    COLLABORATING: 'negotiation',
};

/** TRAIT values → temperament and dark traits (a hint the generator writes around). */
const TRAIT_HINTS: Record<
    string,
    { axis?: HexacoAxis; level?: Level5; dark?: keyof TagFields['dark']; tactic?: string }[]
> = {};
function traitHint(values: string[], hint: (typeof TRAIT_HINTS)[string][number]): void {
    for (const value of values) (TRAIT_HINTS[value] ??= []).push(hint);
}
traitHint(['HONEST', 'SINCERE', 'TRUTHFUL', 'FAIR', 'EQUITABLE', 'IMPARTIAL'], { axis: 'honesty', level: 2 });
traitHint(['MANIPULATIVE', 'MACHIAVELLIAN', 'CALCULATING'], { axis: 'honesty', level: -2 });
traitHint(['MANIPULATIVE', 'MACHIAVELLIAN', 'CALCULATING'], { dark: 'schemer', tactic: 'manipulation' });
traitHint(['ARROGANT', 'HAUGHTY', 'CONCEITED', 'VAIN', 'NARCISSISTIC', 'SELF_ABSORBED'], {
    axis: 'honesty',
    level: -2,
});
traitHint(['ARROGANT', 'HAUGHTY', 'CONCEITED', 'NARCISSISTIC'], { dark: 'entitled' });
traitHint(['KIND', 'GENTLE', 'AFFECTIONATE', 'PATIENT', 'TOLERANT', 'CALM'], { axis: 'agreeableness', level: 2 });
traitHint(['WRATHFUL', 'ANGRY', 'FURIOUS', 'VINDICTIVE', 'SPITEFUL', 'VENGEFUL', 'BITTER', 'RESENTFUL'], {
    axis: 'agreeableness',
    level: -2,
});
traitHint(['CRUEL', 'BRUTAL', 'RUTHLESS'], { axis: 'agreeableness', level: -2 });
traitHint(['CRUEL', 'BRUTAL', 'RUTHLESS'], { dark: 'ruthless' });
traitHint(['ANXIOUS', 'NERVOUS', 'WORRIED', 'PARANOID'], { axis: 'emotionality', level: 2 });
traitHint(['STOIC', 'IMPASSIVE', 'UNFLAPPABLE', 'COLD', 'ALOOF'], { axis: 'emotionality', level: -2 });
traitHint(['SHY', 'BASHFUL', 'TIMID'], { axis: 'extraversion', level: -2 });
traitHint(['GREGARIOUS', 'OUTGOING', 'SOCIABLE', 'BOISTEROUS', 'ROWDY'], { axis: 'extraversion', level: 2 });
traitHint(['DILIGENT', 'HARDWORKING', 'DEDICATED', 'METICULOUS', 'PERFECTIONIST', 'EXACTING'], {
    axis: 'conscientiousness',
    level: 2,
});
traitHint(['LAZY', 'INDOLENT', 'SLOTHFUL', 'RECKLESS', 'IMPULSIVE', 'CHAOTIC'], {
    axis: 'conscientiousness',
    level: -2,
});
traitHint(['CURIOUS', 'INQUISITIVE', 'ECCENTRIC', 'UNCONVENTIONAL', 'PHILOSOPHICAL'], { axis: 'openness', level: 2 });

/** Drug → dependence (BunnyRX classes: opioids and stimulants bind hardest). */
const REC_DEPENDENCE: Record<string, number> = {
    HEROIN: 3,
    FENTANYL: 3,
    OPIOID: 3,
    OXY: 3,
    CRACK: 3,
    METH: 3,
    COCAINE: 2,
    LEAN: 2,
    WEED: 1,
    NICOTINE: 1,
};

const STYLE_KEYS = new Set(['KINK', 'POWER', 'AROUSAL', 'ORIENTATION', 'CHEMISTRY', 'FLIRTING', 'JEALOUSY']);

interface AppetiteSeed {
    kind: AppetiteKind;
    label?: string;
    baseline: number;
    dependence?: number;
    triggers?: string[];
    target?: Appetite['target'];
}

function addSeed(seeds: Map<AppetiteKind, AppetiteSeed>, seed: AppetiteSeed): void {
    const existing = seeds.get(seed.kind);
    if (!existing) {
        seeds.set(seed.kind, { ...seed, triggers: [...(seed.triggers ?? [])] });
        return;
    }
    existing.baseline = Math.max(existing.baseline, seed.baseline);
    existing.dependence = Math.max(existing.dependence ?? 0, seed.dependence ?? 0);
    existing.label ??= seed.label;
    for (const trigger of seed.triggers ?? [])
        if (!existing.triggers!.includes(trigger)) existing.triggers!.push(trigger);
}

function seedAppetite(seed: AppetiteSeed): Appetite {
    return normalizeAppetite({
        id: seed.kind,
        kind: seed.kind,
        label: seed.label,
        sources: ['individual'],
        target: seed.target ?? { mode: 'thing' },
        baseline: seed.baseline,
        liking: 1,
        triggers: seed.triggers ?? [],
        satisfiers: [],
        drift: defaultDrift(seed.kind),
        dependence: seed.dependence ?? 0,
        endorsement: (seed.dependence ?? 0) >= 2 ? 'torn' : 'proud',
        vow: 'none',
        visibility: 'open',
        style: seed.kind === 'flesh' ? 'siren' : 'buyer',
        affectionOnset: 'possible',
    })!;
}

const STRESS_TRIGGERS = ['stress', 'anger'];

/** Copes by MBTI -U (the unhealthy variant): introverts withdraw, extraverted thinkers attack, extraverted feelers give in. */
function copingOf(type: string): Coping {
    if (type.startsWith('I')) return 'avoid';
    return type[2] === 'T' ? 'overcompensate' : 'surrender';
}

/** Reads BunnyMo tags (strings or {key, value}) into Dramatis fields; see the file header. */
export function tagsToFields(input: readonly TagInput[]): TagFields {
    const fields: TagFields = { keys: [], tactics: [], temperament: {}, dark: {}, appetites: [], style: [], tags: [] };
    const seeds = new Map<AppetiteKind, AppetiteSeed>();
    const tags = input.map(parseTag).filter((tag): tag is Tag => tag !== null);
    let substanceUse = false;
    let addicted = false;
    const addKey = (key: string) => {
        if (!fields.keys.includes(key)) fields.keys.push(key);
    };
    const addTactic = (tactic: string) => {
        if (!fields.tactics.includes(tactic)) fields.tactics.push(tactic);
    };
    for (const { key, value } of tags) {
        const id = `${key}:${value}`;
        if (!fields.tags.includes(id)) fields.tags.push(id);
        if (STYLE_KEYS.has(key)) {
            fields.style.push(id);
            continue;
        }
        if (TRUST_KEYS[id]) addKey(TRUST_KEYS[id]);
        switch (key) {
            case 'SPECIES':
                fields.species = value.toLowerCase().replace(/_/g, ' ');
                break;
            case 'GENDER':
                if (/^(MALE|MAN|M)$/.test(value)) fields.gender = 'male';
                else if (/^(FEMALE|WOMAN|F)$/.test(value)) fields.gender = 'female';
                break;
            case 'ATTACHMENT':
                if (ATTACHMENT_AXES[value]) fields.attachment = { ...ATTACHMENT_AXES[value] };
                break;
            case 'CONFLICT':
                if (CONFLICT_TACTICS[value]) addTactic(CONFLICT_TACTICS[value]);
                break;
            case 'MBTI': {
                const match = MBTI_RE.exec(value);
                if (!match?.[1]) break;
                const type = match[1].toUpperCase();
                const variant = match[2]?.toUpperCase() as 'H' | 'U' | undefined;
                fields.mbti = variant ? { type, variant } : { type };
                if (variant === 'U') fields.coping = copingOf(type);
                break;
            }
            case 'VICE':
                if (value === 'DRINKING') addSeed(seeds, { kind: 'drink', label: 'drink', baseline: 3 });
                else if (value === 'SMOKING') addSeed(seeds, { kind: 'substance', label: 'tobacco', baseline: 2 });
                else if (value === 'EATING') addSeed(seeds, { kind: 'food', baseline: 3, triggers: ['stress'] });
                else if (value === 'GAMBLING' || value === 'THRILLS') addSeed(seeds, { kind: 'thrill', baseline: 3 });
                else if (value === 'SHOPPING' || value === 'COLLECTING')
                    addSeed(seeds, { kind: 'luxury', baseline: 2 });
                break;
            case 'COMFORT':
                if (value === 'SUBSTANCE') {
                    const kind: AppetiteKind = seeds.has('substance') && !seeds.has('drink') ? 'substance' : 'drink';
                    addSeed(seeds, {
                        kind,
                        label: kind === 'drink' ? 'drink' : undefined,
                        baseline: 2,
                        triggers: STRESS_TRIGGERS,
                    });
                } else if (value === 'FOOD') addSeed(seeds, { kind: 'food', baseline: 2, triggers: ['stress'] });
                break;
            case 'BSM':
                if (value === 'ALCOHOLISM')
                    addSeed(seeds, { kind: 'drink', label: 'drink', baseline: 4, dependence: 2 });
                else if (value === 'SUBSTANCE_USE' || value === 'SUD') substanceUse = true;
                else if (value === 'GAMBLING')
                    addSeed(seeds, { kind: 'thrill', label: 'gambling', baseline: 4, dependence: 2 });
                else if (value === 'BINGE_EATING') addSeed(seeds, { kind: 'food', baseline: 4, dependence: 1 });
                break;
            case 'REC':
                addSeed(seeds, {
                    kind: 'substance',
                    label: value.toLowerCase().replace(/_/g, ' '),
                    baseline: 3,
                    dependence: REC_DEPENDENCE[value] ?? 2,
                });
                break;
            case 'TRAIT':
                if (['ALCOHOLIC', 'DRUNKARD', 'LUSH'].includes(value)) {
                    addSeed(seeds, { kind: 'drink', label: 'drink', baseline: 4, dependence: 2 });
                } else if (['LUSTFUL', 'LASCIVIOUS', 'LIBIDINOUS'].includes(value)) {
                    addSeed(seeds, {
                        kind: 'flesh',
                        baseline: 4,
                        target: { mode: 'class', class: 'attractive people' },
                    });
                } else if (
                    [
                        'HEDONISTIC',
                        'HEDONIST',
                        'INDULGENT',
                        'PLEASURE_SEEKING',
                        'PLEASURE_SEEKER',
                        'EPICUREAN',
                    ].includes(value)
                ) {
                    addSeed(seeds, { kind: 'luxury', baseline: 3 });
                } else if (['GLUTTONOUS', 'INSATIABLE', 'VORACIOUS'].includes(value)) {
                    addSeed(seeds, { kind: 'food', baseline: 4 });
                } else if (['ADDICTED', 'COMPULSIVE', 'DEPENDENT'].includes(value)) {
                    addicted = true;
                }
                for (const hint of TRAIT_HINTS[value] ?? []) {
                    if (hint.axis && hint.level !== undefined) fields.temperament[hint.axis] = hint.level;
                    if (hint.dark) fields.dark[hint.dark] = true;
                    if (hint.tactic) addTactic(hint.tactic);
                }
                break;
            case 'DERE':
                if (value === 'SADODERE') fields.dark.sadist = true;
                break;
            default:
                break;
        }
    }
    // A substance use disorder binds whatever they take: the drug of a REC tag, else the drink, else «a substance».
    if (substanceUse) {
        const target = seeds.get('substance') ?? seeds.get('drink');
        if (target) target.dependence = Math.max(target.dependence ?? 0, 2);
        else addSeed(seeds, { kind: 'substance', baseline: 4, dependence: 2 });
    }
    if (addicted) {
        const target = seeds.get('substance') ?? seeds.get('drink');
        if (target) target.dependence = Math.max(target.dependence ?? 0, 2);
    }
    fields.appetites = [...seeds.values()].map(seedAppetite);
    return fields;
}

/* ------------------------------------------------------------------ fields → tags */

type Core = CharacterProfile['core'];

function temper(core: Core, axis: HexacoAxis): number {
    return core.temperament[axis] ?? 0;
}

function appetiteOf(profile: CharacterProfile, kind: AppetiteKind): Appetite | undefined {
    return profile.appetites.find((appetite) => appetite.kind === kind && appetite.baseline > 0);
}

function chooseDere(profile: CharacterProfile): string {
    const core = profile.core;
    const t = (axis: HexacoAxis) => temper(core, axis);
    const top = core.values.top;
    if (core.dark?.sadist) return 'SADODERE';
    if (core.dark?.schemer) return t('agreeableness') >= 0 ? 'DORODERE' : 'KURODERE';
    if (top[0] === 'power' && t('extraversion') >= 0) return profile.gender === 'female' ? 'HIMEDERE' : 'OUJIDERE';
    if (core.drives.high.includes('saving') && top.includes('achievement')) return 'KANEDERE';
    if (t('agreeableness') <= -1 && t('extraversion') >= 1) return 'TSUNDERE';
    if (t('honesty') <= -1 && t('agreeableness') <= -1) return 'HINEDERE';
    if (t('emotionality') <= -1 || (t('extraversion') <= -1 && t('agreeableness') <= 0)) return 'KUUDERE';
    if (t('extraversion') <= -1 && t('emotionality') >= 1) return 'DANDERE';
    if (t('extraversion') >= 2) return 'GENKIDERE';
    if (t('agreeableness') >= 2) return 'DEREDERE';
    if (t('conscientiousness') <= -2) return 'DARUDERE';
    return t('extraversion') >= 0 ? 'HIYAKASUDERE' : 'KUUDERE';
}

/** MBTI letters from the temperament, ties broken by the values; -U for the dark, the corrupted and the bitter. */
export function chooseMbti(profile: CharacterProfile): { type: string; variant: 'H' | 'U' } {
    const core = profile.core;
    const t = (axis: HexacoAxis) => temper(core, axis);
    const top = core.values.top;
    const e = t('extraversion') > 0 || (t('extraversion') === 0 && t('agreeableness') >= 0);
    const n =
        t('openness') > 0 ||
        (t('openness') === 0 && top.some((value) => ['self-direction', 'universalism', 'stimulation'].includes(value)));
    const warmth = t('agreeableness') + t('emotionality');
    const f = warmth > 0 || (warmth === 0 && !top.some((value) => value === 'power' || value === 'achievement'));
    const j =
        t('conscientiousness') > 0 ||
        (t('conscientiousness') === 0 && top.some((value) => ['conformity', 'tradition', 'security'].includes(value)));
    const type = `${e ? 'E' : 'I'}${n ? 'N' : 'S'}${f ? 'F' : 'T'}${j ? 'J' : 'P'}`;
    const dark = !!core.dark && Object.values(core.dark).some(Boolean);
    const bitter = core.wound?.coping === 'overcompensate' && t('agreeableness') <= -1;
    return { type, variant: dark || core.corruption >= 3 || bitter ? 'U' : 'H' };
}

function chooseTraits(profile: CharacterProfile): string[] {
    const core = profile.core;
    const t = (axis: HexacoAxis) => temper(core, axis);
    const top = core.values.top;
    const scores: [string, number][] = [];
    const add = (trait: string, score: number, when: boolean) => {
        if (when) scores.push([trait, score]);
    };
    const drink = appetiteOf(profile, 'drink');
    add('ALCOHOLIC', 3, !!drink && drink.dependence >= 2);
    add('CRUEL', 3, !!core.dark?.ruthless || !!core.dark?.sadist);
    add('MANIPULATIVE', 3, !!core.dark?.schemer);
    add('LUSTFUL', 2.5, (appetiteOf(profile, 'flesh')?.baseline ?? 0) >= 4);
    add('GLUTTONOUS', 2.5, (appetiteOf(profile, 'food')?.baseline ?? 0) >= 4);
    add('VENGEFUL', 2, core.drives.high.includes('vengeance'));
    add('MANIPULATIVE', 2, t('honesty') <= -2);
    add('HONEST', 2, t('honesty') >= 2);
    add('WRATHFUL', 2, t('agreeableness') <= -2);
    add('PATIENT', 2, t('agreeableness') >= 2);
    add('ANXIOUS', 2, t('emotionality') >= 2);
    add('STOIC', 2, t('emotionality') <= -2);
    add('HEDONISTIC', 2, (appetiteOf(profile, 'luxury')?.baseline ?? 0) >= 3 || top[0] === 'hedonism');
    add('DOMINANT', 1.5, top[0] === 'power');
    add('AMBITIOUS', 1.5, top[0] === 'achievement' || core.drives.high.includes('status'));
    add('CURIOUS', 1.5, t('openness') >= 2 || core.drives.high.includes('curiosity'));
    add('SHY', 1.5, t('extraversion') <= -2);
    add('GREGARIOUS', 1.5, t('extraversion') >= 2);
    add('DILIGENT', 1.5, t('conscientiousness') >= 2);
    add('LAZY', 1.5, t('conscientiousness') <= -2);
    add('COLD', 1.5, t('agreeableness') <= -1 && t('extraversion') <= -1);
    add('PROTECTIVE', 1.5, core.drives.high.includes('family') && top.includes('benevolence'));
    add('MISERLY', 1.2, core.drives.high.includes('saving'));
    add('SUSPICIOUS', 1, (core.attachment?.avoidance ?? 0) >= 1);
    add('PROUD', 1, core.drives.high.includes('honor'));
    const out: string[] = [];
    for (const [trait] of [...scores].sort((a, b) => b[1] - a[1])) {
        if (!out.includes(trait)) out.push(trait);
        if (out.length >= 2) break;
    }
    return out;
}

function chooseAttachment(core: Core): string {
    const attachment = core.attachment;
    if (attachment) {
        if (attachment.anxiety >= 1 && attachment.avoidance >= 1) return 'FEARFUL_AVOIDANT';
        if (attachment.anxiety >= 2 && attachment.avoidance <= -1) return 'ANXIOUS_CLINGY';
        if (attachment.anxiety >= 1) return 'ANXIOUS';
        if (attachment.avoidance >= 1) return 'DISMISSIVE_AVOIDANT';
        return 'SECURE';
    }
    if (temper(core, 'agreeableness') <= -1 && temper(core, 'extraversion') <= -1) return 'DISMISSIVE_AVOIDANT';
    if (temper(core, 'emotionality') >= 2) return 'ANXIOUS';
    return 'SECURE';
}

const CONFLICT_WORDS: [RegExp, string][] = [
    [/pressur|intimidat|threat|force|blunt|fist|ambush|давлен|угроз|запуг|сил/i, 'COMPETING'],
    [/bargain|trade|haggl|deal|торг|сделк/i, 'COMPROMISING'],
    [/evasi|stonewall|silence|delay|avoid|feign|уклон|молч|тян/i, 'AVOIDING'],
    [/flatter|obedien|plead|giving way|лест|покорн|уступ/i, 'ACCOMMODATING'],
    [/negotiat|persua|argument|убежд|переговор|довод/i, 'COLLABORATING'],
];

function chooseConflict(core: Core): string {
    for (const tactic of core.tactics) {
        for (const [re, tag] of CONFLICT_WORDS) if (re.test(tactic)) return tag;
    }
    const a = temper(core, 'agreeableness');
    return a <= -1 ? 'COMPETING' : a >= 1 ? 'ACCOMMODATING' : 'COMPROMISING';
}

function chooseBoundaries(core: Core): string {
    if ((core.attachment?.avoidance ?? 0) >= 1) return 'RIGID';
    if (temper(core, 'agreeableness') <= -1 && temper(core, 'extraversion') <= 0) return 'RIGID';
    if ((core.attachment?.anxiety ?? 0) >= 2) return 'POROUS';
    return 'HEALTHY';
}

function chooseDecision(core: Core): string {
    const t = (axis: HexacoAxis) => temper(core, axis);
    if (core.dark?.schemer) return 'CALCULATED';
    if (t('conscientiousness') >= 2) return 'DELIBERATE';
    if (t('conscientiousness') <= -1 && t('emotionality') >= 1) return 'IMPULSIVE';
    if (t('conscientiousness') <= -1) return 'GUT';
    if (t('emotionality') >= 2) return 'EMOTIONAL';
    if (core.values.top[0] === 'conformity') return 'DEFERRED';
    if (t('extraversion') >= 1) return 'DECISIVE';
    return 'GUT';
}

function chooseComfort(profile: CharacterProfile): string[] {
    const core = profile.core;
    const out: string[] = [];
    const add = (tag: string, when: boolean) => {
        if (when && !out.includes(tag) && out.length < 2) out.push(tag);
    };
    add('SUBSTANCE', !!appetiteOf(profile, 'drink') || !!appetiteOf(profile, 'substance'));
    add('FOOD', !!appetiteOf(profile, 'food'));
    add('ISOLATION', temper(core, 'extraversion') <= -1);
    add('SOCIAL', temper(core, 'extraversion') >= 1);
    add(
        'RITUAL',
        core.values.top.some((value) => value === 'tradition' || value === 'conformity'),
    );
    add('ACTIVITY', core.drives.high.includes('physical'));
    add('CREATIVE', temper(core, 'openness') >= 1);
    add('NATURE', out.length === 0);
    return out;
}

function chooseVice(profile: CharacterProfile): string | null {
    const core = profile.core;
    const substance = appetiteOf(profile, 'substance');
    if (appetiteOf(profile, 'drink')) return 'DRINKING';
    if (substance && /tobacco|nicotine|smok|табак|курев/i.test(substance.label ?? '')) return 'SMOKING';
    if (appetiteOf(profile, 'thrill')) return 'GAMBLING';
    if (appetiteOf(profile, 'food')) return 'EATING';
    if (appetiteOf(profile, 'luxury')) return 'SHOPPING';
    if (temper(core, 'conscientiousness') >= 2 && core.drives.high.includes('order')) return 'OVERWORKING';
    if (temper(core, 'emotionality') >= 2) return 'FIDGETING';
    return null;
}

const BETRAYAL_RE = /betray|предат|предал/i;
const DEEDS_RE = /deed|earn|prove|proof|дела|делом|заслуж|доказ/i;
const TRUST_RE = /trust|betray|довер|предат/i;

function chooseLoyalty(core: Core): string {
    const top = core.values.top;
    if (core.drives.high.includes('family') && top.includes('benevolence')) return 'RIDE_OR_DIE';
    if (top[0] === 'tradition' || top[0] === 'conformity' || top[0] === 'universalism') return 'CODE';
    if (temper(core, 'honesty') <= -1 && top.some((value) => value === 'power' || value === 'achievement')) {
        return 'CONDITIONAL';
    }
    if (core.keys.some((key) => BETRAYAL_RE.test(key))) return 'BROKEN';
    return 'EARNED';
}

function chooseTrust(profile: CharacterProfile): string {
    const core = profile.core;
    if (core.keys.some((key) => DEEDS_RE.test(key))) return 'SLOW';
    if (core.wound && TRUST_RE.test(`${core.wound.lie} ${core.wound.ghost}`)) return 'SHATTERED';
    if ((core.attachment?.anxiety ?? 0) >= 1) return 'TESTING';
    if (temper(core, 'agreeableness') >= 2 && temper(core, 'honesty') >= 1) return 'INSTANT';
    const player = profile.ties.find((tie) => tie.target === '@player');
    if ((player && player.stance <= -1) || temper(core, 'agreeableness') <= -1) return 'SUSPICIOUS';
    return 'SLOW';
}

const DUTY_ROLES = new Set(['guard', 'soldier', 'official', 'servant', 'merchant', 'innkeeper', 'priest', 'healer']);

function chooseMask(profile: CharacterProfile): string {
    const core = profile.core;
    const t = (axis: HexacoAxis) => temper(core, axis);
    if (core.dark?.schemer && t('extraversion') >= 0) return 'CHARMING';
    if (t('agreeableness') <= -2) return 'AGGRESSIVE';
    if (t('emotionality') <= -1 && t('extraversion') <= -1) return 'COLD';
    if (core.dark?.schemer) return 'MYSTERIOUS';
    if (profile.role && DUTY_ROLES.has(profile.role)) return 'PROFESSIONAL';
    if (t('extraversion') >= 2 && t('emotionality') >= 1) return 'CLOWN';
    if (t('agreeableness') >= 2) return 'CARETAKER';
    return t('emotionality') <= 0 ? 'TOUGH' : 'NONE';
}

const ROLE_LING: Record<string, string> = {
    noble: 'FORMAL',
    official: 'FORMAL',
    priest: 'FORMAL',
    scholar: 'TECHNICAL',
    mage: 'CRYPTIC',
    raider: 'CRUDE',
    thief: 'STREET',
    mercenary: 'BLUNT',
    soldier: 'BLUNT',
    guard: 'BLUNT',
    sailor: 'CASUAL',
    entertainer: 'VERBOSE',
    beggar: 'STREET',
};

function chooseLing(profile: CharacterProfile): string[] {
    const core = profile.core;
    const t = (axis: HexacoAxis) => temper(core, axis);
    const out: string[] = [];
    const add = (tag: string | undefined, when = true) => {
        if (tag && when && !out.includes(tag) && out.length < 2) out.push(tag);
    };
    add(profile.role ? ROLE_LING[profile.role] : undefined);
    add('AGGRESSIVE', t('agreeableness') <= -2);
    add('BOISTEROUS', t('extraversion') >= 2);
    add('TIMID', t('extraversion') <= -2);
    add('SARCASTIC', t('honesty') <= -1 && t('openness') >= 1);
    add('CYNICAL', t('agreeableness') <= -1 && t('honesty') <= -1);
    add('CASUAL', out.length === 0);
    return out;
}

/**
 * BunnyMo tags for a character without an archive (portraits, «Оформить» in Maestro): one value of each personality
 * list, two traits, MBTI with -H/-U, one or two LING, SPECIES and GENDER when known. Only vocabulary values; in the
 * order of the BunnyMo tag sheet, as `KEY:VALUE`.
 */
export function fieldsToTags(profile: CharacterProfile, vocabulary: BunnymoVocabulary = BUNNYMO_VOCABULARY): string[] {
    const out: string[] = [];
    const add = (list: VocabularyList, value: string | null | undefined) => {
        if (!value) return;
        const tag = value.toUpperCase();
        if (vocabulary.lists[list].includes(tag) && !out.includes(`${list}:${tag}`)) out.push(`${list}:${tag}`);
    };
    const core = profile.core;
    add('DERE', chooseDere(profile));
    const mbti = chooseMbti(profile);
    if (vocabulary.mbti.types.includes(mbti.type) && vocabulary.mbti.variants.includes(mbti.variant)) {
        out.push(`MBTI:${mbti.type}-${mbti.variant}`);
    }
    for (const trait of chooseTraits(profile)) add('TRAIT', trait);
    add('ATTACHMENT', chooseAttachment(core));
    add('CONFLICT', chooseConflict(core));
    add('BOUNDARIES', chooseBoundaries(core));
    add('DECISION', chooseDecision(core));
    for (const comfort of chooseComfort(profile)) add('COMFORT', comfort);
    add('VICE', chooseVice(profile));
    add('LOYALTY', chooseLoyalty(core));
    add('TRUST', chooseTrust(profile));
    add('MASK', chooseMask(profile));
    for (const ling of chooseLing(profile)) add('LING', ling);
    if (profile.species) add('SPECIES', profile.species.trim().replace(/[\s-]+/g, '_'));
    if (profile.gender) out.push(`GENDER:${profile.gender.toUpperCase()}`);
    return out;
}
