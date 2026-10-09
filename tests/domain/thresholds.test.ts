import { describe, expect, it } from 'vitest';
import { BRANDS, GIFTS } from '../../src/domain/corruption';
import { PLAYER_ID } from '../../src/domain/model';
import type { CharacterProfile } from '../../src/domain/model';
import { runScenePass } from '../../src/domain/scene-pass';
import {
    BRAND_WORDS,
    GIFT_BASE,
    GIFT_MAX,
    GIFT_MIN,
    GIFT_WORDS,
    giftChance,
    identityOf,
    identityPhrase,
    isOutGroup,
    shiftGazesOnCorruption,
} from '../../src/domain/thresholds';
import { TurnLog, passThresholds } from '../../src/domain/turn-log';
import { always, appetite } from './appetites-fixtures';
import { chat, liveState, profile, raid, tie } from './cast-fixtures';

function hunter(patch: Partial<CharacterProfile> = {}): CharacterProfile {
    const base = profile('kira', 'Кира', { gender: 'female', species: 'harpy' });
    return {
        ...base,
        appetites: [appetite({ id: 'flesh', kind: 'flesh', baseline: 4, endorsement: 'proud' })],
        core: { ...base.core, justifications: ['dehumanization', 'blame'] },
        ...patch,
    };
}

function log(profiles: CharacterProfile[], lang: 'en' | 'ru' = 'en'): TurnLog {
    return new TurnLog(lang, 3, new Map(profiles.map((p) => [p.id, p] as const)), 'Курьер');
}

describe('the gift decision', () => {
    it('is weighed by endorsement, justifications, dark traits and an anchor near', () => {
        expect(giftChance(undefined, 3)).toBe(GIFT_BASE);
        const proud = hunter();
        expect(giftChance(proud, 3)).toBeCloseTo(0.75);
        expect(giftChance(proud, 7)).toBeCloseTo(0.8);
        expect(giftChance(proud, 3, { anchorPresent: true })).toBeCloseTo(0.55);
        const fighting = hunter({
            appetites: [appetite({ endorsement: 'fighting' }), appetite({ endorsement: 'fighting' })],
        });
        fighting.core = { ...fighting.core, justifications: [] };
        expect(giftChance(fighting, 3, { anchorPresent: true })).toBe(GIFT_MIN);
        const ruthless = hunter();
        ruthless.core = {
            ...ruthless.core,
            dark: { ruthless: true },
            justifications: ['blame', 'euphemism', 'comparison', 'diffusion', 'minimizing'],
        };
        ruthless.appetites = [appetite({ endorsement: 'proud' }), appetite({ endorsement: 'proud' })];
        expect(giftChance(ruthless, 7)).toBe(GIFT_MAX);
    });
});

describe('passThresholds in story words', () => {
    it('brands always, takes or refuses the gift by the weighted roll, and grows an identity at 7', () => {
        const kira = hunter();
        const lines = log([kira], 'ru');
        const taken = passThresholds({ level: 7, stains: 0, gifts: [], brands: [] }, 2, always(0.7), lines, 'kira', {
            profile: kira,
        });
        expect(taken.state.brands).toEqual([BRANDS[3], BRANDS[5], BRANDS[7]]);
        expect(taken.state.gifts).toEqual([GIFTS[3], GIFTS[5], GIFTS[7]]);
        expect(taken.state.identity).toBe('flesh');
        expect(taken.crossed5).toBe(true);
        const texts = lines.events.map((event) => event.text);
        expect(texts).toContain(`Кира принимает дар падения: ${GIFT_WORDS[3].ru}`);
        expect(texts).toContain(`Кира: клеймо — ${BRAND_WORDS[5].ru}`);
        expect(texts).toContain('Кира теперь видит себя охотницей, а других — дичью');
        expect(lines.events.every((event) => event.kind === 'corruption' && event.character === 'kira')).toBe(true);
    });

    it('refuses with an anchor near (a remorse die) and keeps the old roll without a profile', () => {
        const kira = hunter();
        const lines = log([kira]);
        const refused = passThresholds({ level: 3, stains: 0, gifts: [], brands: [] }, 2, always(0.7), lines, 'kira', {
            profile: kira,
            anchorPresent: true,
        });
        expect(refused.state).toMatchObject({ gifts: [], brands: ['mark'], bonusDice: 1 });
        expect(lines.events.map((e) => e.text)).toContain(
            `Кира refuses the gift (${GIFT_WORDS[3].en}) and holds on to themselves`,
        );
        const bare = passThresholds(
            { level: 5, stains: 0, gifts: [], brands: [] },
            4,
            always(0.4),
            log([kira]),
            'kira',
        );
        expect(bare.state.gifts).toEqual(['pack-standing']);
        expect(bare.state.identity).toBeUndefined();
    });

    it('says «lost» at 10 and nothing else for it', () => {
        const lines = log([hunter()]);
        passThresholds({ level: 10, stains: 0, gifts: [], brands: [] }, 9, always(0.1), lines, 'kira');
        expect(lines.events.map((e) => e.text)).toEqual(['Кира is lost']);
    });
});

describe('identity', () => {
    it('grows from the strongest appetite, or from nothing at all', () => {
        expect(identityOf(hunter())).toBe('flesh');
        expect(
            identityOf({
                appetites: [appetite({ kind: 'drink', baseline: 2 }), appetite({ kind: 'plunder', baseline: 5 })],
            }),
        ).toBe('plunder');
        expect(identityOf({ appetites: [] })).toBe('self');
        expect(identityOf(undefined)).toBe('self');
    });

    it('reads in both languages and genders', () => {
        expect(identityPhrase('flesh', 'en', 'male')).toBe('sees himself as a hunter, and others as game');
        expect(identityPhrase('hunger', 'en')).toBe('sees themselves as a predator, and people as food');
        expect(identityPhrase('plunder', 'ru')).toBe('видит себя тем, кто берёт по праву');
        expect(identityPhrase('dominance', 'ru', 'female')).toBe(
            'видит себя хозяйкой, а других — теми, кто должен подчиняться',
        );
        expect(identityPhrase('self', 'en', 'female')).toBe('sees herself as someone to whom anything is allowed now');
    });
});

describe('the gaze at 5', () => {
    it('slides one step toward the thing for outsiders only', () => {
        const { profiles, state } = raid();
        const grukk = state.characters.grukk!;
        grukk.ties.ally = tie('ally', 1, { gaze: 'person' });
        const byId = new Map(profiles.map((p) => [p.id, p] as const));
        byId.set('ally', { species: 'goblin' } as CharacterProfile);
        const outGroup = (target: string) => isOutGroup(profiles[0], target, byId);
        expect(outGroup(PLAYER_ID)).toBe(true);
        expect(outGroup('ally')).toBe(false);
        expect(outGroup('mira')).toBe(false);
        grukk.ties[PLAYER_ID] = tie(PLAYER_ID, -1, { gaze: 'prize' });
        const changed = shiftGazesOnCorruption(grukk, outGroup);
        expect(changed).toEqual([PLAYER_ID]);
        expect(grukk.ties[PLAYER_ID]!.gaze).toBe('instrument');
        expect(grukk.ties.ally!.gaze).toBe('person');
        expect(grukk.ties.mira!.gaze).toBe('property');
    });

    it('happens in the scene pass when remorse fails across 5', () => {
        const kira = hunter({ ties: [tie(PLAYER_ID, -1, { gaze: 'prize', want: 4 })] });
        const state = chat({ kira: liveState(kira, { corruption: { level: 4, stains: 3, gifts: [], brands: [] } }) });
        const result = runScenePass(
            { state, profiles: [kira], present: ['kira'], playerName: 'Курьер' },
            {
                rng: always(0.01),
                levers: { appetiteStrength: 'author', corruption: 'all' },
                reason: 'date',
                uiLang: 'ru',
            },
        );
        const live = result.state.characters.kira!;
        expect(live.corruption.level).toBe(5);
        expect(live.ties[PLAYER_ID]!.gaze).toBe('instrument');
        expect(result.events.map((e) => e.text)).toContain('Кира: на чужих теперь смотрит как на вещи');
    });

    it('eases stress at a chapter end, more with an anchor near', () => {
        const kira = hunter();
        kira.core = { ...kira.core, anchors: ['mira'] };
        const mira = profile('mira', 'Мира');
        const state = chat({ kira: liveState(kira, { stress: 50 }), mira: liveState(mira, { stress: 10 }) });
        const ctx = { rng: always(0.5), levers: { appetiteStrength: 'author' as const, corruption: 'all' as const } };
        const near = runScenePass(
            { state, profiles: [kira, mira], present: ['kira', 'mira'] },
            { ...ctx, reason: 'date' },
        );
        expect(near.state.characters.kira!.stress).toBe(10);
        expect(near.state.characters.mira!.stress).toBe(0);
        const alone = runScenePass({ state, profiles: [kira, mira], present: ['kira'] }, { ...ctx, reason: 'date' });
        expect(alone.state.characters.kira!.stress).toBe(25);
        const shortBreak = runScenePass({ state, profiles: [kira, mira], present: [] }, { ...ctx, reason: 'ended' });
        expect(shortBreak.state.characters.kira!.stress).toBe(50);
    });
});
