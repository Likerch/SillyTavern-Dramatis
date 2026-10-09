// Drift control (docs/model.md §8). The reply model keeps "warming up"; the engine notices it cheaply after a reply
// and answers by mode: a correction in the next motive card (default), or stress that turns drift into story
// (CK3-style mental breaks by coping style). Warmth without cause never counts as a stance change.
import type { Coping, Stance } from './model';
import { PLAYER_ID } from './model';
import { clamp } from './util';

export type DesLabelKind = 'lover' | 'friend' | 'ally' | 'neutral' | 'rival' | 'enemy';

/** Stances consistent with each DES relationship label (tolerant: only clear contradictions are drift). */
export const LABEL_RANGES: Record<DesLabelKind, { min: Stance; max: Stance }> = {
    lover: { min: 1, max: 3 },
    friend: { min: 1, max: 3 },
    ally: { min: 0, max: 3 },
    neutral: { min: -1, max: 1 },
    rival: { min: -2, max: 0 },
    enemy: { min: -3, max: -1 },
};

/**
 * Label words by stem, English and Russian, checked in order: negative stems first so «недруг» and "unfriendly"
 * do not read as friends, "girlfriend" before "friend".
 */
const LABEL_PATTERNS: [RegExp, DesLabelKind][] = [
    [/unfriend|недружелюб|rival|соперн|конкурент|competitor/, 'rival'],
    [/enem|hostil|\bfoe|\bhat(e|red)|nemesis|недруг|враг|враж|ненавист|неприятел/, 'enemy'],
    [/girlfriend|boyfriend|lover|\blove|beloved|sweetheart|любов|возлюб|любим|влюбл/, 'lover'],
    [/friend|buddy|приятел|друж|друг|подруг/, 'friend'],
    [/\ball(y|ies|ied)\b|союз|соратни|comrade|companion|товарищ|спутни/, 'ally'],
    [/neutral|нейтрал|stranger|acquaint|indifferent|незнаком|знаком|безразлич|равнодуш/, 'neutral'],
];

/** "Ex-lover", «бывшая подруга»: says nothing about now. */
const FORMER = /\bex\b|\bex-|former|бывш/;

/** Reads a DES relationship label («Враг», "Friend", «Подруга», «враждебен») into a kind; undefined when unknown. */
export function labelKind(label: string | undefined): DesLabelKind | undefined {
    if (typeof label !== 'string') return undefined;
    const text = label.toLowerCase().replace(/ё/g, 'е').trim();
    if (!text || FORMER.test(text)) return undefined;
    return LABEL_PATTERNS.find(([re]) => re.test(text))?.[1];
}

/** Stance range a label stands for, undefined when the label is unknown. */
export function labelRange(label: string | undefined): { kind: DesLabelKind; min: Stance; max: Stance } | undefined {
    const kind = labelKind(label);
    return kind ? { kind, ...LABEL_RANGES[kind] } : undefined;
}

export type DriftKind = 'label-mismatch' | 'warmth' | 'appetite-love' | 'dependence-vanished' | 'against-self';

export interface DriftInput {
    character: string;
    /** Whom the stance is toward (default the player). */
    target?: string;
    /** The engine's stance toward the target. */
    stance: Stance;
    /** DES relationship label of the reply. */
    desLabel?: string;
    /** The turn pass saw warmth with no event that moves the stance. */
    warmthWithoutCause?: boolean;
    /** A predator turned tender, an acquirer turned selfless, without cause (§8). */
    appetiteBecameLove?: boolean;
    /** Withdrawal gone: refused the drink calmly without support or reason. */
    dependenceVanished?: boolean;
    /** Acted against own values, stance or signatures without cause. */
    actedAgainstValues?: boolean;
}

export interface DriftFinding {
    kind: DriftKind;
    character: string;
    target: string;
    stance: Stance;
    /** For label-mismatch: the label's kind and how many steps the stance lies outside its range. */
    label?: DesLabelKind;
    gap?: number;
    /** For label-mismatch: whether the reply played it warmer or colder than the engine. */
    direction?: 'warmer' | 'colder';
}

/** Findings for one character after a reply. */
export function driftFindings(input: DriftInput): DriftFinding[] {
    const base = { character: input.character, target: input.target ?? PLAYER_ID, stance: input.stance };
    const findings: DriftFinding[] = [];
    const range = labelRange(input.desLabel);
    if (range) {
        if (input.stance < range.min) {
            findings.push({
                ...base,
                kind: 'label-mismatch',
                label: range.kind,
                gap: range.min - input.stance,
                direction: 'warmer',
            });
        } else if (input.stance > range.max) {
            findings.push({
                ...base,
                kind: 'label-mismatch',
                label: range.kind,
                gap: input.stance - range.max,
                direction: 'colder',
            });
        }
    }
    if (input.warmthWithoutCause) findings.push({ ...base, kind: 'warmth' });
    if (input.appetiteBecameLove) findings.push({ ...base, kind: 'appetite-love' });
    if (input.dependenceVanished) findings.push({ ...base, kind: 'dependence-vanished' });
    if (input.actedAgainstValues) findings.push({ ...base, kind: 'against-self' });
    return findings;
}

/** What the next motive card should re-emphasise. */
export type Emphasis = 'stance' | 'appetite-separation' | 'withdrawal' | 'values';

export interface DriftCorrection {
    character: string;
    target: string;
    stance: Stance;
    emphasise: Emphasis[];
    /** The reply played the tie warmer (or colder) than the engine holds it. */
    drift?: 'warmer' | 'colder';
}

const EMPHASIS: Record<DriftKind, Emphasis[]> = {
    'label-mismatch': ['stance'],
    warmth: ['stance'],
    'appetite-love': ['appetite-separation', 'stance'],
    'dependence-vanished': ['withdrawal'],
    'against-self': ['values'],
};

/** Groups findings into one correction per character and target, for the renderer. */
export function correctionFor(findings: DriftFinding[]): DriftCorrection[] {
    const byKey = new Map<string, DriftCorrection>();
    for (const f of findings) {
        const key = `${f.character}\u0000${f.target}`;
        const c = byKey.get(key) ?? { character: f.character, target: f.target, stance: f.stance, emphasise: [] };
        for (const e of EMPHASIS[f.kind] ?? []) if (!c.emphasise.includes(e)) c.emphasise.push(e);
        const warmer = f.direction === 'warmer' || f.kind === 'warmth' || f.kind === 'appetite-love';
        if (warmer) c.drift = 'warmer';
        else if (f.direction === 'colder' && !c.drift) c.drift = 'colder';
        byKey.set(key, c);
    }
    return [...byKey.values()];
}

/* ------------------------------------------------------------------ stress mode */

export const STRESS_MAX = 100;
export const STRESS_BREAK = 60;
export const STRESS_AFTER_BREAK = 30;

/** Stress per finding: acting against oneself costs most; each extra step of label gap adds 5. */
export const STRESS_FOR: Record<DriftKind, number> = {
    'label-mismatch': 10,
    warmth: 15,
    'appetite-love': 15,
    'dependence-vanished': 10,
    'against-self': 20,
};

export function stressOf(findings: DriftFinding[]): number {
    return findings.reduce(
        (s, f) => s + (STRESS_FOR[f.kind] ?? 0) + (f.kind === 'label-mismatch' ? 5 * Math.max(0, (f.gap ?? 1) - 1) : 0),
        0,
    );
}

/** Adds the findings' stress (0–100) to anything that carries stress (a CharacterState). */
export function addStress<T extends { stress: number }>(state: T, findings: DriftFinding[]): T {
    if (findings.length === 0) return state;
    const current = Number.isFinite(state.stress) ? state.stress : 0;
    return { ...state, stress: clamp(current + stressOf(findings), 0, STRESS_MAX) };
}

export type BreakKind = 'withdraw' | 'leave' | 'lash-out';

const BREAK_BY_COPING: Record<Coping, BreakKind> = {
    surrender: 'withdraw',
    avoid: 'leave',
    overcompensate: 'lash-out',
};

/**
 * A break once stress reaches the threshold, in the character's coping style (surrender → withdraws, avoid →
 * leaves, overcompensate → lashes out; no wound → avoid). Stress then drops to 30.
 */
export function stressBreak(stress: number, coping?: Coping): { kind: BreakKind; stress: number } | null {
    if (!Number.isFinite(stress) || stress < STRESS_BREAK) return null;
    return { kind: BREAK_BY_COPING[coping ?? 'avoid'] ?? 'leave', stress: STRESS_AFTER_BREAK };
}
