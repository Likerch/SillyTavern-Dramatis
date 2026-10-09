// Emotion → mood, ALMA simplified to discrete PAD octants (docs/model.md §4.4, §5.1; research A8).
// Mood is one of eight octants; an emotion pulls it toward the emotion's octant, and mood returns to the author's
// baseline after a scene end or a few calm turns — that is how authored hostility survives any scene.
import type { Emotion, Mood, MoodOctant } from './model';
import { normalizeText } from './util';

type Sign = 1 | -1;

/** Pleasure, arousal, dominance signs of each octant (Mehrabian). */
export const OCTANT_PAD: Record<MoodOctant, readonly [Sign, Sign, Sign]> = {
    exuberant: [1, 1, 1],
    dependent: [1, 1, -1],
    relaxed: [1, -1, 1],
    docile: [1, -1, -1],
    hostile: [-1, 1, 1],
    anxious: [-1, 1, -1],
    disdainful: [-1, -1, 1],
    bored: [-1, -1, -1],
};

/**
 * Emotion type → octant. OCC types follow ALMA's PAD table (Gebhard 2005); the rest follow Russell & Mehrabian
 * (1977) or, where no figure exists, the closest OCC sibling (noted).
 */
export const EMOTION_OCTANTS: Readonly<Record<string, MoodOctant>> = {
    // ALMA / OCC
    admiration: 'dependent',
    anger: 'hostile',
    disliking: 'hostile',
    disappointment: 'anxious',
    distress: 'bored',
    fear: 'anxious',
    'fears-confirmed': 'bored',
    gloating: 'docile',
    gratification: 'exuberant',
    gratitude: 'dependent',
    'happy-for': 'exuberant',
    hate: 'hostile',
    hope: 'dependent',
    joy: 'exuberant',
    liking: 'dependent',
    love: 'exuberant',
    pity: 'bored',
    pride: 'exuberant',
    relief: 'relaxed',
    remorse: 'anxious',
    reproach: 'disdainful',
    resentment: 'bored',
    satisfaction: 'relaxed',
    shame: 'anxious',
    // Russell & Mehrabian
    disgust: 'hostile',
    surprise: 'dependent',
    sadness: 'bored',
    boredom: 'bored',
    curiosity: 'exuberant',
    calm: 'relaxed',
    // Closest OCC siblings
    guilt: 'anxious', // remorse
    contempt: 'disdainful', // reproach
    suspicion: 'hostile', // guarded vigilance: −P +A +D, the «мрачная настороженность» of §4.6
    envy: 'anxious', // displeasure with a sense of inferiority (−D)
    jealousy: 'hostile', // possessive, asserting (§4.5 «ревнивая любовь»)
    lust: 'exuberant', // aroused, wanting, in control
    craving: 'anxious', // wanting without control (withdrawal, §5.7)
    despair: 'bored', // fears-confirmed
    loneliness: 'bored',
    triumph: 'exuberant', // gratification
    humiliation: 'anxious', // shame
};

/** Common word forms the analyst may write instead of the noun. */
const ALIASES: Readonly<Record<string, string>> = {
    angry: 'anger',
    rage: 'anger',
    fury: 'anger',
    irritation: 'anger',
    annoyance: 'anger',
    afraid: 'fear',
    scared: 'fear',
    terror: 'fear',
    anxiety: 'fear',
    worry: 'fear',
    hopeful: 'hope',
    happy: 'joy',
    happiness: 'joy',
    joyful: 'joy',
    delight: 'joy',
    sad: 'sadness',
    grief: 'sadness',
    sorrow: 'sadness',
    distressed: 'distress',
    ashamed: 'shame',
    embarrassment: 'shame',
    guilty: 'guilt',
    regret: 'remorse',
    proud: 'pride',
    grateful: 'gratitude',
    thankful: 'gratitude',
    contemptuous: 'contempt',
    scorn: 'contempt',
    disdain: 'contempt',
    disgusted: 'disgust',
    revulsion: 'disgust',
    suspicious: 'suspicion',
    distrust: 'suspicion',
    mistrust: 'suspicion',
    wariness: 'suspicion',
    relieved: 'relief',
    disappointed: 'disappointment',
    envious: 'envy',
    jealous: 'jealousy',
    bored: 'boredom',
    lustful: 'lust',
    desire: 'lust',
    arousal: 'lust',
    hatred: 'hate',
    affection: 'love',
    tenderness: 'love',
    surprised: 'surprise',
    curious: 'curiosity',
    interest: 'curiosity',
    content: 'satisfaction',
    contentment: 'satisfaction',
    satisfied: 'satisfaction',
    hopelessness: 'despair',
    lonely: 'loneliness',
    humiliated: 'humiliation',
    remorseful: 'remorse',
    resentful: 'resentment',
    calmness: 'calm',
    serenity: 'calm',
};

/** Emotion intensity (1–5) from which the mood jumps to any octant; weaker ones only reach adjacent octants. */
export const STRONG_EMOTION = 3;
/** Calm turns after which the mood returns to its baseline. */
export const CALM_TURNS = 3;

/** Octant of an emotion type (any case, nouns or common adjectives), undefined when unknown. */
export function emotionOctant(type: string): MoodOctant | undefined {
    if (typeof type !== 'string') return undefined;
    const key = normalizeText(type).replace(/\s+/g, '-');
    const name = ALIASES[key] ?? key;
    return EMOTION_OCTANTS[name];
}

/** Number of PAD axes on which two octants differ (0–3). */
export function octantDistance(a: MoodOctant, b: MoodOctant): number {
    const pa = OCTANT_PAD[a];
    const pb = OCTANT_PAD[b];
    return (pa[0] !== pb[0] ? 1 : 0) + (pa[1] !== pb[1] ? 1 : 0) + (pa[2] !== pb[2] ? 1 : 0);
}

/** Octants one axis apart (neighbouring cube vertices). */
export function adjacentOctants(a: MoodOctant, b: MoodOctant): boolean {
    return octantDistance(a, b) === 1;
}

/** Mood in an octant; the author's label only belongs to the baseline octant. */
function moodIn(octant: MoodOctant, baseline: Mood): Mood {
    return octant === baseline.octant && baseline.label ? { octant, label: baseline.label } : { octant };
}

/**
 * Pulls the mood toward the emotion's octant: a strong emotion (intensity ≥ 3) moves it there, a weaker one only
 * when the octant is adjacent. Unknown types and non-positive intensities leave the mood as it is.
 */
export function applyEmotion(mood: Mood, baseline: Mood, emotion: Pick<Emotion, 'type' | 'intensity'>): Mood {
    const target = emotionOctant(emotion.type);
    if (!target || !Number.isFinite(emotion.intensity) || emotion.intensity <= 0) return mood;
    if (target === mood.octant) return mood;
    if (emotion.intensity >= STRONG_EMOTION || adjacentOctants(mood.octant, target)) return moodIn(target, baseline);
    return mood;
}

/** Whether an emotion still holds at this turn (it fades after its `until` turn). */
export function emotionActive(emotion: Emotion | undefined, turn: number): emotion is Emotion {
    return emotion !== undefined && turn <= emotion.until;
}

/** The emotion, or undefined once it has expired. */
export function expireEmotion(emotion: Emotion | undefined, turn: number): Emotion | undefined {
    return emotionActive(emotion, turn) ? emotion : undefined;
}

/**
 * One current emotion per character (Versu): a newer one replaces the current one unless the current is still
 * active and clearly stronger (by 2+), so mild amusement does not wipe out rage.
 */
export function nextEmotion(current: Emotion | undefined, incoming: Emotion, turn: number): Emotion {
    if (!emotionActive(current, turn)) return incoming;
    return incoming.intensity >= current.intensity - 1 ? incoming : current;
}

/** Back to the baseline after a scene end or `calmTurns` turns without emotion; otherwise the mood stays. */
export function relaxMood(
    mood: Mood,
    baseline: Mood,
    turnsCalm: number,
    options: { sceneEnd?: boolean; calmTurns?: number } = {},
): Mood {
    const calmTurns = options.calmTurns ?? CALM_TURNS;
    if (options.sceneEnd || turnsCalm >= calmTurns) {
        return mood.octant === baseline.octant && mood.label === baseline.label ? mood : { ...baseline };
    }
    return mood;
}
