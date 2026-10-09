import { describe, expect, it } from 'vitest';
import {
    BUNNYMO_VOCABULARY,
    VOCABULARY_LISTS,
    chooseMbti,
    fieldsToTags,
    loadVocabulary,
    parseTag,
    sheetTags,
    tagsToFields,
} from '../../src/domain/bunnymo-bridge';
import { PLAYER_ID } from '../../src/domain/model';
import type { CharacterProfile } from '../../src/domain/model';
import { profile, tie } from './cast-fixtures';
import { appetite } from './appetites-fixtures';

describe('vocabulary', () => {
    it('holds the closed lists of the BunnyMo packs', () => {
        const lists = BUNNYMO_VOCABULARY.lists;
        expect(lists.DERE).toContain('TSUNDERE');
        expect(lists.DERE).toContain('KUUDERE');
        expect(lists.TRAIT).toContain('ALCOHOLIC');
        expect(lists.TRAIT).toContain('LUSTFUL');
        expect(lists.ATTACHMENT).toEqual(expect.arrayContaining(['SECURE', 'FEARFUL_AVOIDANT', 'DISMISSIVE_AVOIDANT']));
        expect(lists.CONFLICT).toEqual(['COMPETING', 'ACCOMMODATING', 'AVOIDING', 'COMPROMISING', 'COLLABORATING']);
        expect(lists.BOUNDARIES).toEqual(['RIGID', 'HEALTHY', 'POROUS', 'NONE']);
        expect(lists.DECISION).toHaveLength(9);
        expect(lists.COMFORT).toHaveLength(12);
        expect(lists.VICE).toHaveLength(11);
        expect(lists.LOYALTY).toHaveLength(6);
        expect(lists.TRUST).toHaveLength(6);
        expect(lists.MASK).toHaveLength(11);
        expect(lists.LING).toContain('SARCASTIC');
        expect(lists.LING).not.toContain('PRIMARY');
        expect(lists.SPECIES).toContain('LAMIA');
        expect(BUNNYMO_VOCABULARY.mbti.types).toHaveLength(16);
        expect(BUNNYMO_VOCABULARY.mbti.variants).toEqual(['H', 'U']);
        for (const name of VOCABULARY_LISTS) {
            const list = lists[name];
            expect(new Set(list).size).toBe(list.length);
            for (const value of list) expect(value).toMatch(/^[A-Z][A-Z0-9_-]*$/);
        }
    });

    it('loads a fixture tolerantly', () => {
        const vocab = loadVocabulary({ DERE: ['kuudere', 'KUUDERE', 5, ''], MBTI: { types: ['intj'] } });
        expect(vocab.lists.DERE).toEqual(['KUUDERE']);
        expect(vocab.lists.TRAIT).toEqual([]);
        expect(vocab.mbti).toEqual({ types: ['INTJ'], variants: [] });
        expect(loadVocabulary(null).lists.MASK).toEqual([]);
    });
});

describe('parseTag and sheetTags', () => {
    it('reads every spelling of a tag', () => {
        expect(parseTag('<ATTACHMENT:Fearful_Avoidant>')).toEqual({ key: 'ATTACHMENT', value: 'FEARFUL_AVOIDANT' });
        expect(parseTag('trust: earned')).toEqual({ key: 'TRUST', value: 'EARNED' });
        expect(parseTag('<ENTJ-U>')).toEqual({ key: 'MBTI', value: 'ENTJ-U' });
        expect(parseTag({ key: 'species', value: 'fire elemental' })).toEqual({
            key: 'SPECIES',
            value: 'FIRE_ELEMENTAL',
        });
        expect(parseTag('nonsense')).toBeNull();
        expect(parseTag(':X')).toBeNull();
        expect(parseTag({ key: '', value: 'X' })).toBeNull();
    });

    it('lists an archive with its MBTI', () => {
        expect(sheetTags({ tags: [{ key: 'Dere', value: 'kuudere' }], mbti: { type: 'intj', variant: 'U' } })).toEqual([
            'DERE:KUUDERE',
            'MBTI:INTJ-U',
        ]);
        expect(sheetTags({ tags: [] })).toEqual([]);
    });
});

describe('tagsToFields', () => {
    it('maps attachment, trust, conflict and MBTI -U', () => {
        const fields = tagsToFields(['<ATTACHMENT:AVOIDANT>', 'TRUST:EARNED', 'CONFLICT:COMPETING', '<ENTJ-U>']);
        expect(fields.attachment).toEqual({ anxiety: -1, avoidance: 2 });
        expect(fields.keys).toEqual(['Trusts only deeds, never words; trust is earned slowly']);
        expect(fields.tactics).toEqual(['pressure']);
        expect(fields.mbti).toEqual({ type: 'ENTJ', variant: 'U' });
        expect(fields.coping).toBe('overcompensate');
        expect(tagsToFields(['MBTI:INFP-U']).coping).toBe('avoid');
        expect(tagsToFields(['MBTI:ESFP-U']).coping).toBe('surrender');
        expect(tagsToFields(['MBTI:ESFP-H']).coping).toBeUndefined();
        expect(tagsToFields(['ATTACHMENT:FEARFUL_AVOIDANT']).attachment).toEqual({ anxiety: 2, avoidance: 2 });
        expect(tagsToFields(['LOYALTY:CODE', 'TRUST:SUSPICIOUS']).keys).toHaveLength(2);
    });

    it('turns vices, traits, BSM and REC into appetites — BSM and REC with dependence', () => {
        const drinker = tagsToFields(['VICE:DRINKING']);
        expect(drinker.appetites).toHaveLength(1);
        expect(drinker.appetites[0]).toMatchObject({ kind: 'drink', baseline: 3, dependence: 0, drift: 'daily' });
        const alcoholic = tagsToFields(['TRAIT:ALCOHOLIC']).appetites[0]!;
        expect(alcoholic).toMatchObject({ kind: 'drink', baseline: 4, dependence: 2, endorsement: 'torn' });
        const sud = tagsToFields(['VICE:DRINKING', 'BSM:SUBSTANCE_USE']).appetites;
        expect(sud).toHaveLength(1);
        expect(sud[0]).toMatchObject({ kind: 'drink', dependence: 2 });
        const heroin = tagsToFields(['REC:HEROIN', 'BSM:SUBSTANCE_USE']).appetites;
        expect(heroin).toHaveLength(1);
        expect(heroin[0]).toMatchObject({ kind: 'substance', label: 'heroin', dependence: 3 });
        expect(tagsToFields(['REC:WEED']).appetites[0]).toMatchObject({ dependence: 1 });
        expect(tagsToFields(['BSM:SUBSTANCE_USE']).appetites[0]).toMatchObject({ kind: 'substance', dependence: 2 });
        expect(tagsToFields(['TRAIT:LUSTFUL']).appetites[0]).toMatchObject({
            kind: 'flesh',
            baseline: 4,
            target: { mode: 'class', class: 'attractive people' },
        });
        expect(tagsToFields(['TRAIT:HEDONISTIC']).appetites[0]).toMatchObject({ kind: 'luxury', baseline: 3 });
        expect(tagsToFields(['TRAIT:GLUTTONOUS']).appetites[0]).toMatchObject({ kind: 'food', baseline: 4 });
        expect(tagsToFields(['VICE:GAMBLING']).appetites[0]).toMatchObject({ kind: 'thrill' });
        expect(tagsToFields(['BSM:GAMBLING']).appetites[0]).toMatchObject({ kind: 'thrill', dependence: 2 });
        expect(tagsToFields(['VICE:SMOKING', 'TRAIT:ADDICTED']).appetites[0]).toMatchObject({
            kind: 'substance',
            label: 'tobacco',
            dependence: 2,
        });
    });

    it('makes comfort appetites fed by stress', () => {
        const comfort = tagsToFields(['COMFORT:SUBSTANCE', 'COMFORT:FOOD']).appetites;
        expect(comfort.map((item) => item.kind)).toEqual(['drink', 'food']);
        expect(comfort[0]!.triggers).toEqual(['stress', 'anger']);
        expect(comfort[1]!.triggers).toEqual(['stress']);
        // A drinker who also drinks for comfort: one appetite, the stronger baseline, stress added.
        const merged = tagsToFields(['VICE:DRINKING', 'COMFORT:SUBSTANCE']).appetites;
        expect(merged).toHaveLength(1);
        expect(merged[0]).toMatchObject({ baseline: 3, triggers: ['stress', 'anger'] });
    });

    it('reads species and gender, keeps style tags only as remembered style', () => {
        const fields = tagsToFields([
            'SPECIES:FIRE_ELEMENTAL',
            'GENDER:FEMALE',
            'KINK:SOMETHING',
            'POWER:SWITCH',
            'AROUSAL:CYCLIC',
        ]);
        expect(fields.species).toBe('fire elemental');
        expect(fields.gender).toBe('female');
        expect(fields.style).toEqual(['KINK:SOMETHING', 'POWER:SWITCH', 'AROUSAL:CYCLIC']);
        expect(fields.appetites).toEqual([]);
        expect(fields.tags).toContain('SPECIES:FIRE_ELEMENTAL');
        expect(tagsToFields(['GENDER:MALE']).gender).toBe('male');
    });

    it('takes temperament and dark traits from TRAIT and DERE hints', () => {
        const fields = tagsToFields(['TRAIT:MANIPULATIVE', 'TRAIT:CRUEL', 'DERE:SADODERE', 'TRAIT:SHY']);
        expect(fields.temperament).toEqual({ honesty: -2, agreeableness: -2, extraversion: -2 });
        expect(fields.dark).toEqual({ schemer: true, ruthless: true, sadist: true });
        expect(fields.tactics).toEqual(['manipulation']);
    });
});

function sheet(patch: Partial<CharacterProfile> = {}, core: Partial<CharacterProfile['core']> = {}): CharacterProfile {
    const base = profile('x', 'Икс', patch);
    return { ...base, core: { ...base.core, ...core } };
}

describe('fieldsToTags', () => {
    it('picks one value of each list, two traits, MBTI and LING — all from the vocabulary', () => {
        const brute = sheet(
            {
                role: 'raider',
                species: 'orc',
                gender: 'male',
                appetites: [appetite({ kind: 'drink', dependence: 2, baseline: 4 })],
            },
            {
                values: { top: ['power', 'stimulation', 'hedonism'], sacrifice: 'universalism' },
                temperament: { agreeableness: -2, honesty: -2, extraversion: 1, conscientiousness: -1 },
                drives: { high: ['vengeance', 'power'], low: ['tranquility'] },
                tactics: ['intimidation', 'ambush'],
                dark: { ruthless: true },
            },
        );
        const tags = fieldsToTags(brute);
        const keys = tags.map((tag) => tag.split(':')[0]);
        expect(keys.filter((key) => key === 'DERE')).toHaveLength(1);
        expect(keys.filter((key) => key === 'TRAIT').length).toBeLessThanOrEqual(2);
        for (const key of [
            'MBTI',
            'ATTACHMENT',
            'CONFLICT',
            'BOUNDARIES',
            'DECISION',
            'COMFORT',
            'LOYALTY',
            'TRUST',
            'MASK',
            'LING',
        ]) {
            expect(keys).toContain(key);
        }
        expect(tags).toContain('TRAIT:ALCOHOLIC');
        expect(tags).toContain('TRAIT:CRUEL');
        expect(tags).toContain('CONFLICT:COMPETING');
        expect(tags).toContain('VICE:DRINKING');
        expect(tags).toContain('COMFORT:SUBSTANCE');
        expect(tags).toContain('MASK:AGGRESSIVE');
        expect(tags).toContain('LING:CRUDE');
        expect(tags).toContain('SPECIES:ORC');
        expect(tags).toContain('GENDER:MALE');
        expect(tags.find((tag) => tag.startsWith('MBTI:'))).toMatch(/^MBTI:E[NS]TP-U$/);
        for (const tag of tags) {
            const [key, value] = tag.split(':') as [string, string];
            if (key === 'MBTI' || key === 'GENDER') continue;
            expect(BUNNYMO_VOCABULARY.lists[key as 'DERE']).toContain(value);
        }
    });

    it('reads warmth and trust from the profile', () => {
        const healer = sheet(
            { role: 'healer', ties: [tie(PLAYER_ID, 1)] },
            {
                values: { top: ['benevolence', 'universalism'], sacrifice: 'power' },
                temperament: { agreeableness: 2, honesty: 2, emotionality: 1 },
                drives: { high: ['family'], low: [] },
                keys: ['Trusts only deeds, slowly earned'],
                attachment: { anxiety: 0, avoidance: 0 },
            },
        );
        const tags = fieldsToTags(healer);
        expect(tags).toContain('DERE:DEREDERE');
        expect(tags).toContain('ATTACHMENT:SECURE');
        expect(tags).toContain('TRUST:SLOW');
        expect(tags).toContain('LOYALTY:RIDE_OR_DIE');
        expect(tags).toContain('MASK:PROFESSIONAL');
        expect(tags).toContain('TRAIT:HONEST');
        // Openness 0 with universalism on top reads as N; conscientiousness 0 without order values as P.
        expect(chooseMbti(healer)).toEqual({ type: 'ENFP', variant: 'H' });
    });

    it('skips values missing from the given vocabulary', () => {
        const tiny = loadVocabulary({ DERE: ['KUUDERE'], MBTI: { types: [], variants: [] } });
        const cold = sheet({}, { temperament: { emotionality: -2, extraversion: -1 } });
        expect(fieldsToTags(cold, tiny)).toEqual(['DERE:KUUDERE']);
    });

    it('round-trips the reading tags through the profile fields', () => {
        const fields = tagsToFields(['ATTACHMENT:FEARFUL_AVOIDANT', 'CONFLICT:AVOIDING', 'TRUST:SUSPICIOUS']);
        const someone = sheet(
            {},
            {
                attachment: fields.attachment!,
                tactics: fields.tactics,
                keys: fields.keys,
                temperament: { agreeableness: -1 },
            },
        );
        const tags = fieldsToTags(someone);
        expect(tags).toContain('ATTACHMENT:FEARFUL_AVOIDANT');
        expect(tags).toContain('CONFLICT:AVOIDING');
        expect(tags).toContain('BOUNDARIES:RIGID');
    });
});
