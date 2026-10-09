// Corruption thresholds in story words (docs/model.md §5.7 «Дар и клеймо», Pathfinder corruptions): when a character
// crosses 3, 5 or 7 the brand always comes, and the gift is a temptation they take or refuse — weighed by how they
// regard their own cravings (proud ones take it, those fighting them refuse), their habitual self-justifications, dark
// traits and whether someone who keeps them human is near. At 5 the gaze on outsiders slides a step toward the thing;
// at 7 the craving becomes part of who they are («sees himself as a hunter»), a line the motive card shows.
// Words for the story log (UI language) and the card (card language). Pure.
import type { GiftThreshold } from './corruption';
import { shiftGaze } from './gaze';
import type { Gender, Lang } from './ladders';
import { PLAYER_ID } from './model';
import type { AppetiteKind, CharacterProfile, CharacterState } from './model';
import { clamp, normalizeText } from './util';

/** What tips the gift decision (besides the profile). */
export interface GiftContext {
    /** Someone who keeps them human is in the scene. */
    anchorPresent?: boolean;
}

/** Base chance to take a threshold gift; the profile moves it, kept within [GIFT_MIN, GIFT_MAX]. */
export const GIFT_BASE = 0.5;
export const GIFT_MIN = 0.1;
export const GIFT_MAX = 0.9;

/**
 * Chance that the character takes the gift of a threshold: + for appetites they are proud of, − for those they fight,
 * + per habitual justification (up to +0.2), + for ruthless or entitled, − with an anchor near; deeper thresholds
 * tempt a little more. Without a profile: GIFT_BASE.
 */
export function giftChance(
    profile: Pick<CharacterProfile, 'appetites' | 'core'> | undefined,
    threshold: GiftThreshold,
    ctx: GiftContext = {},
): number {
    if (!profile) return GIFT_BASE;
    let chance = GIFT_BASE;
    for (const appetite of profile.appetites) {
        if (appetite.endorsement === 'proud') chance += 0.15;
        else if (appetite.endorsement === 'fighting') chance -= 0.15;
    }
    chance += Math.min(0.2, 0.05 * profile.core.justifications.length);
    if (profile.core.dark?.ruthless || profile.core.dark?.entitled) chance += 0.1;
    if (ctx.anchorPresent) chance -= 0.2;
    if (threshold === 7) chance += 0.05;
    return clamp(Math.round(chance * 100) / 100, GIFT_MIN, GIFT_MAX);
}

/* ------------------------------------------------------------------ words */

type Words = Record<Lang, string>;

/** Gifts by threshold (corruption.ts GIFTS ids). */
export const GIFT_WORDS: Readonly<Record<GiftThreshold, Words>> = {
    3: { en: 'a cold new confidence', ru: 'холодная уверенность — чужие сомнения больше не задевают' },
    5: { en: 'a place among those who do the same', ru: 'своё место среди тех, кто поступает так же' },
    7: { en: 'dread — people step out of the way', ru: 'страх окружающих — люди расступаются' },
};

/** Brands by threshold (corruption.ts BRANDS ids). */
export const BRAND_WORDS: Readonly<Record<GiftThreshold, Words>> = {
    3: {
        en: 'the easy excuses — euphemisms creep into speech',
        ru: 'привычные оправдания — в речи появляются эвфемизмы',
    },
    5: { en: 'a compulsion — the craving comes back unbidden', ru: 'навязчивость — тяга возвращается сама' },
    7: {
        en: 'a lost anchor — someone who kept them human turns away',
        ru: 'потерянная опора — тот, кто держал на краю, отворачивается',
    },
};

/** «Sees himself as …» per appetite kind: English, Russian masculine, Russian feminine (instrumental case). */
const IDENTITY: Record<AppetiteKind | 'self', { en: string; ru: string; ruF: string }> = {
    flesh: {
        en: 'a hunter, and others as game',
        ru: 'охотником, а других — дичью',
        ruF: 'охотницей, а других — дичью',
    },
    plunder: { en: 'a taker by right', ru: 'тем, кто берёт по праву', ruF: 'той, кто берёт по праву' },
    dominance: {
        en: 'a master, and others as there to obey',
        ru: 'хозяином, а других — теми, кто должен подчиняться',
        ruF: 'хозяйкой, а других — теми, кто должен подчиняться',
    },
    cruelty: { en: 'someone others should fear', ru: 'тем, кого должны бояться', ruF: 'той, кого должны бояться' },
    hunger: { en: 'a predator, and people as food', ru: 'хищником, а людей — пищей', ruF: 'хищницей, а людей — пищей' },
    food: { en: 'someone who lives to feed', ru: 'тем, кто живёт ради еды', ruF: 'той, кто живёт ради еды' },
    drink: {
        en: 'a drinker, and no longer ashamed of it',
        ru: 'пьяницей — и уже не стыдится',
        ruF: 'пьяницей — и уже не стыдится',
    },
    substance: {
        en: 'someone who lives from dose to dose',
        ru: 'тем, кто живёт от дозы до дозы',
        ruF: 'той, кто живёт от дозы до дозы',
    },
    thrill: {
        en: 'a gambler who needs the edge',
        ru: 'игроком, которому без риска жизнь пресна',
        ruF: 'игроком, которому без риска жизнь пресна',
    },
    luxury: {
        en: 'someone born to be served',
        ru: 'рождённым, чтобы ему служили',
        ruF: 'рождённой, чтобы ей служили',
    },
    adoration: {
        en: 'an idol, and others as an audience',
        ru: 'кумиром, а других — зрителями',
        ruF: 'кумиром, а других — зрителями',
    },
    other: {
        en: 'someone to whom anything is allowed now',
        ru: 'тем, кому теперь всё позволено',
        ruF: 'той, кому теперь всё позволено',
    },
    self: {
        en: 'someone to whom anything is allowed now',
        ru: 'тем, кому теперь всё позволено',
        ruF: 'той, кому теперь всё позволено',
    },
};

const REFLEXIVE: Record<Gender | 'unknown', string> = { male: 'himself', female: 'herself', unknown: 'themselves' };

/** What the craving grew into at 7: the kind of the strongest appetite, or 'self' when they have none. */
export function identityOf(profile: Pick<CharacterProfile, 'appetites'> | undefined): AppetiteKind | 'self' {
    let best: { kind: AppetiteKind; baseline: number } | null = null;
    for (const appetite of profile?.appetites ?? []) {
        if (!best || appetite.baseline > best.baseline) best = { kind: appetite.kind, baseline: appetite.baseline };
    }
    return best?.kind ?? 'self';
}

/** «sees himself as a hunter, and others as game» / «видит себя охотником, а других — дичью». */
export function identityPhrase(identity: AppetiteKind | 'self', lang: Lang, gender?: Gender): string {
    const words = IDENTITY[identity] ?? IDENTITY.self;
    if (lang === 'ru') return `видит себя ${gender === 'female' ? words.ruF : words.ru}`;
    return `sees ${REFLEXIVE[gender ?? 'unknown']} as ${words.en}`;
}

/* ------------------------------------------------------------------ the gaze at 5 */

/** Whether a target is outside a character's own people: the player always, others by species. */
export function isOutGroup(
    profile: Pick<CharacterProfile, 'species'> | undefined,
    target: string,
    byId: ReadonlyMap<string, Pick<CharacterProfile, 'species'>>,
): boolean {
    if (target === PLAYER_ID) return true;
    const a = profile?.species;
    const b = byId.get(target)?.species;
    return !!a && !!b && normalizeText(a) !== normalizeText(b);
}

/**
 * Corruption crossed 5 (the «gaze-shift» unlock): every gaze on an outsider slides one step toward the thing. Returns
 * the ids of the targets whose gaze changed (the ties are replaced on the character).
 */
export function shiftGazesOnCorruption(character: CharacterState, outGroup: (target: string) => boolean): string[] {
    const changed: string[] = [];
    for (const [target, tie] of Object.entries(character.ties)) {
        if (!tie.gaze) continue;
        const gaze = shiftGaze(tie.gaze, { corruptionCrossed: true, outGroup: outGroup(target) });
        if (gaze === tie.gaze) continue;
        character.ties[target] = { ...tie, gaze };
        changed.push(target);
    }
    return changed;
}
