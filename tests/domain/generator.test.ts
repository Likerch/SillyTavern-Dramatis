import { describe, expect, it } from 'vitest';
import {
    CONTRAST,
    GENERAL_TACTICS,
    PROMOTION,
    RULE_TIES,
    TEMPLATE_SOURCE,
    applyGenerated,
    applyRules,
    applyTagFields,
    canGenerate,
    candidateWeight,
    castHasOpposition,
    castMember,
    countTurn,
    emptyCandidate,
    fitsClass,
    holderMatches,
    maxLod,
    missingFields,
    needsFill,
    paramsDistance,
    paramsFromProfile,
    pickCandidate,
    sampleParams,
    shouldPromote,
    sketchProfile,
    syncLiveState,
    tagsToFields,
    temperamentDistance,
    valueCircleDistance,
    valueDistance,
    valuesOppose,
} from '../../src/domain/generator';
import type { CastMember, GenCandidate, GenParams } from '../../src/domain/generator';
import { HEXACO, MOODS, PLAYER_ID, STYLES, VALUES } from '../../src/domain/model';
import type { AppetiteRule, CharacterProfile } from '../../src/domain/model';
import { setMeta } from '../../src/domain/profile-defaults';
import { rolePrior } from '../../src/domain/role-priors';
import { createCharacterState } from '../../src/domain/state-init';
import { always, appetite, seeded } from './appetites-fixtures';
import { liveState, profile, tie } from './cast-fixtures';

function member(id: string, patch: Partial<CastMember> = {}): CastMember {
    return { id, values: [], temperament: {}, tactics: [], ...patch };
}

function params(patch: Partial<GenParams> = {}): GenParams {
    return {
        role: 'innkeeper',
        values: { top: ['security', 'achievement', 'benevolence'], sacrifice: 'stimulation' },
        temperament: {
            honesty: 1,
            emotionality: 0,
            extraversion: 2,
            agreeableness: -1,
            conscientiousness: 1,
            openness: 0,
        },
        drives: { high: ['saving', 'social'], low: ['romance'] },
        stance: -1,
        tactics: ['bargaining'],
        style: 'buyer',
        proactivity: 6,
        commitment: 'single',
        baselineMood: 'bored',
        duty: true,
        ...patch,
    };
}

function candidate(patch: Partial<GenCandidate> = {}): GenCandidate {
    return {
        ...emptyCandidate(),
        concept: 'Widow who keeps the inn out of spite',
        want: 'to pay the garrison tax by Friday',
        need: 'to let her daughter go',
        goals: [
            {
                text: 'wants the tax paid because the inn is all she has, but the garrison keeps raising it',
                kind: 'external',
                priority: 1,
            },
        ],
        signatures: ['if ordered → does it slowly and badly', 'if a guest cannot pay → remembers the debt', 'third'],
        keys: ['protect her daughter'],
        doing: 'counting the takings',
        sceneGoal: 'keep the courier from noticing the letters',
        stanceBehaviour: 'takes his coin, gives nothing back',
        stanceReason: 'an imperial',
        moodLabel: 'grim and watchful',
        summary: 'A grim innkeeper',
        ...patch,
    };
}

/* ------------------------------------------------------------------ values and distance */

describe('value circle and distance', () => {
    it('measures the Schwartz circle', () => {
        expect(valueCircleDistance('power', 'universalism')).toBe(5);
        expect(valueCircleDistance('tradition', 'hedonism')).toBe(5);
        expect(valueCircleDistance('security', 'conformity')).toBe(1);
        expect(valueCircleDistance('self-direction', 'universalism')).toBe(1);
        expect(valuesOppose(['power', 'security'], ['benevolence', 'universalism'])).toBe(true);
        expect(valuesOppose(['security', 'conformity'], ['tradition', 'security'])).toBe(false);
        expect(castHasOpposition([[], ['power'], ['universalism']])).toBe(true);
        expect(castHasOpposition([['power'], [], ['power', 'achievement']])).toBe(false);
    });

    it('compares values by rank and temperament by axes', () => {
        expect(valueDistance(['power', 'security', 'tradition'], ['power', 'security', 'tradition'])).toBe(0);
        expect(valueDistance(['power'], ['universalism'])).toBe(1);
        expect(valueDistance([], ['power'])).toBe(1);
        expect(temperamentDistance({}, {})).toBe(0);
        expect(temperamentDistance({ honesty: 2 }, { honesty: -2 })).toBeCloseTo(4 / 24);
        const p = params();
        expect(paramsDistance(p, member('same', { values: p.values.top, temperament: p.temperament }))).toBe(0);
    });
});

/* ------------------------------------------------------------------ sampling */

describe('sampleParams', () => {
    it('is deterministic for a seeded rng', () => {
        const a = sampleParams('guard', 'indifferent', [], seeded(42));
        const b = sampleParams('guard', 'indifferent', [], seeded(42));
        expect(a).toEqual(b);
        const others = [1, 2, 3, 4, 5].map((seed) =>
            JSON.stringify(sampleParams('guard', 'indifferent', [], seeded(seed))),
        );
        expect(new Set(others).size).toBeGreaterThan(1);
    });

    it('draws a complete parameter set within the role priors', () => {
        const prior = rolePrior('raider');
        for (let seed = 1; seed <= 60; seed++) {
            const p = sampleParams('raider', 'hostile', [], seeded(seed), 'even');
            expect(p.role).toBe('raider');
            expect(p.values.top).toHaveLength(3);
            expect(new Set(p.values.top).size).toBe(3);
            expect(p.values.top).not.toContain(p.values.sacrifice);
            expect(Object.keys(p.temperament).sort()).toEqual([...HEXACO].sort());
            expect(p.temperament.honesty).toBeLessThanOrEqual(0);
            expect(p.temperament.agreeableness).toBeLessThanOrEqual(0);
            expect(p.drives.high.length).toBeGreaterThanOrEqual(2);
            expect(p.drives.high.length).toBeLessThanOrEqual(3);
            expect(p.drives.low.length).toBeGreaterThanOrEqual(1);
            expect(p.drives.low.some((drive) => p.drives.high.includes(drive))).toBe(false);
            expect(p.stance).toBeGreaterThanOrEqual(-3);
            expect(p.stance).toBeLessThanOrEqual(3);
            expect(p.tactics.length).toBeGreaterThanOrEqual(1);
            expect(p.tactics.every((tactic) => prior.tactics.includes(tactic))).toBe(true);
            expect(p.proactivity).toBeGreaterThanOrEqual(prior.proactivity[0]);
            expect(p.proactivity).toBeLessThanOrEqual(prior.proactivity[1]);
            expect(STYLES).toContain(p.style);
            expect(MOODS).toContain(p.baselineMood);
            expect(p.duty).toBe(false);
        }
    });

    it('meets strangers by the world tone: hostile worlds are colder than welcoming ones', () => {
        const mean = (tone: 'hostile' | 'welcoming' | 'indifferent') => {
            const rng = seeded(11);
            let sum = 0;
            let cold = 0;
            for (let i = 0; i < 400; i++) {
                const stance = sampleParams('unknown', tone, [], rng, 'even').stance;
                sum += stance;
                if (stance < 0) cold++;
            }
            return { mean: sum / 400, cold: cold / 400 };
        };
        expect(mean('hostile').mean).toBeLessThan(mean('indifferent').mean);
        expect(mean('indifferent').mean).toBeLessThan(mean('welcoming').mean);
        // §10.3: in an indifferent world a noticeable share of those met is cold or in the way.
        expect(mean('indifferent').cold).toBeGreaterThan(0.25);
    });

    it('follows the reputation of the player among them most of the time', () => {
        const rng = seeded(5);
        let hits = 0;
        for (let i = 0; i < 300; i++)
            if (sampleParams('unknown', 'welcoming', [], rng, 'even', { reputation: -2 }).stance === -2) hits++;
        expect(hits / 300).toBeGreaterThan(0.6);
    });

    it('draws again when the new face is too close to someone present (stricter when varied)', () => {
        const twin = sampleParams('guard', 'indifferent', [], seeded(3));
        const cast = [member('twin', { values: twin.values.top, temperament: twin.temperament })];
        let far = 0;
        let sumVaried = 0;
        let sumEven = 0;
        for (let seed = 1; seed <= 80; seed++) {
            const varied = sampleParams('guard', 'indifferent', cast, seeded(seed), 'varied');
            const even = sampleParams('guard', 'indifferent', cast, seeded(seed), 'even');
            const distance = paramsDistance(varied, cast[0]!);
            if (distance >= CONTRAST.varied.minDistance) far++;
            sumVaried += distance;
            sumEven += paramsDistance(even, cast[0]!);
        }
        expect(far / 80).toBeGreaterThan(0.85);
        expect(sumVaried).toBeGreaterThanOrEqual(sumEven);
        // Without contrast the same role often lands close.
        let close = 0;
        for (let seed = 1; seed <= 80; seed++) {
            const raw = sampleParams('guard', 'indifferent', [], seeded(seed), 'varied');
            if (paramsDistance(raw, cast[0]!) < CONTRAST.varied.minDistance) close++;
        }
        expect(close).toBeGreaterThan(80 - far);
    });

    it('ensures one pair with opposing values among those present', () => {
        const cast = [member('ilva', { values: ['security', 'conformity', 'tradition'] })];
        for (let seed = 1; seed <= 60; seed++) {
            const p = sampleParams('guard', 'indifferent', cast, seeded(seed), 'even');
            expect(castHasOpposition([cast[0]!.values, p.values.top])).toBe(true);
            expect(new Set(p.values.top).size).toBe(p.values.top.length);
            expect(p.values.top).not.toContain(p.values.sacrifice);
        }
        // Already a pair present: nothing forced, the draw stays as the role made it.
        const opposed = [member('a', { values: ['power'] }), member('b', { values: ['universalism'] })];
        expect(sampleParams('guard', 'indifferent', opposed, seeded(9), 'even').values.top).toHaveLength(3);
    });

    it('never gives two characters in one scene the same tactic', () => {
        const prior = rolePrior('guard');
        const cast = [member('other', { tactics: [...prior.tactics] })];
        for (let seed = 1; seed <= 30; seed++) {
            const p = sampleParams('guard', 'neutral', cast, seeded(seed), 'even');
            expect(p.tactics.some((tactic) => prior.tactics.includes(tactic))).toBe(false);
            expect(p.tactics.every((tactic) => GENERAL_TACTICS.includes(tactic))).toBe(true);
        }
    });
});

/* ------------------------------------------------------------------ sketches */

describe('sketchProfile', () => {
    it('makes a sketch from the role templates without any model', () => {
        const p = params({ role: 'guard', stance: -1 });
        const sketch = sketchProfile('Стражник у ворот', p, { lang: 'ru' });
        const prior = rolePrior('guard');
        expect(sketch.lod).toBe('sketch');
        expect(sketch.role).toBe('guard');
        expect(sketch.id).toBe('strazhnik-u-vorot');
        expect(prior.want.ru).toContain(sketch.core.want);
        expect(prior.tell.ru).toContain(sketch.core.signatures[0]);
        expect(prior.doing.ru).toContain(sketch.starts[0]!.doing);
        expect(sketch.starts[0]).toMatchObject({ greeting: -1, present: true });
        expect(sketch.core.values).toEqual(p.values);
        expect(sketch.core.temperament).toEqual({
            honesty: 1,
            extraversion: 2,
            agreeableness: -1,
            conscientiousness: 1,
        });
        expect(sketch.core.tactics).toEqual(['bargaining']);
        expect(sketch.core.proactivity).toBe(6);
        expect(sketch.core.baselineMood).toEqual({ octant: 'bored' });
        const player = sketch.ties.find((item) => item.target === PLAYER_ID)!;
        expect(player.stance).toBe(-1);
        expect(player.reasons[0]).toMatchObject({
            id: 'gen-stranger',
            text: 'чужак, а от чужаков одни беды',
            delta: -1,
            scenesLeft: null,
        });
        expect(player.behaviour).toMatch(/чужак/);
        expect(sketch.meta['core.want']).toEqual({ origin: 'generated', sources: [TEMPLATE_SOURCE] });
        expect(sketch.meta[`ties.${PLAYER_ID}`]?.sources).toEqual([TEMPLATE_SOURCE]);
        expect(sketch.meta['core.values']).toEqual({ origin: 'generated' });
        // The same name gives the same sketch; English templates for an English card.
        expect(sketchProfile('Стражник у ворот', p, { lang: 'ru' })).toEqual(sketch);
        expect(prior.want.en).toContain(sketchProfile('Gate guard', p).core.want);
    });

    it('keeps what the chat shows them doing and their identity', () => {
        const sketch = sketchProfile('Мира', params({ role: 'unknown' }), {
            doing: 'чинит повозку',
            gender: 'female',
            species: 'human',
            id: 'mira',
            rng: always(0),
        });
        expect(sketch.role).toBeUndefined();
        expect(sketch.id).toBe('mira');
        expect(sketch.gender).toBe('female');
        expect(sketch.species).toBe('human');
        expect(sketch.starts[0]!.doing).toBe('чинит повозку');
        expect(sketch.meta.starts).toBeUndefined();
        expect(sketchProfile('Bram', params(), { taken: ['bram'] }).id).toBe('bram-2');
    });

    it('starts a live state present, busy and aware of the player', () => {
        const sketch = sketchProfile('Брам', params({ stance: -2 }));
        const live = createCharacterState(sketch, 3);
        expect(live.present).toBe(true);
        expect(live.scene.doing).toBe(sketch.starts[0]!.doing);
        expect(live.knowsPlayer).toBe(true);
        expect(live.ties[PLAYER_ID]!.stance).toBe(-2);
        expect(castMember(sketch)).toMatchObject({
            id: sketch.id,
            values: sketch.core.values.top,
            tactics: ['bargaining'],
        });
    });
});

/* ------------------------------------------------------------------ candidates */

describe('pickCandidate', () => {
    it('picks by weight: fitting and untypical candidates win more often', () => {
        expect(candidateWeight({ fit: 5, typicality: 1 })).toBe(25);
        expect(candidateWeight({ fit: 1, typicality: 5 })).toBe(1);
        expect(candidateWeight({ fit: 0, typicality: 0 })).toBe(9);
        const list = [
            { id: 'stock', fit: 3, typicality: 5 },
            { id: 'good', fit: 5, typicality: 2 },
            { id: 'odd', fit: 2, typicality: 1 },
        ];
        expect(pickCandidate(list, always(0))!.id).toBe('stock');
        expect(pickCandidate(list, always(0.99))!.id).toBe('odd');
        const rng = seeded(4);
        const counts: Record<string, number> = { stock: 0, good: 0, odd: 0 };
        for (let i = 0; i < 1000; i++) counts[pickCandidate(list, rng)!.id]! += 1;
        expect(counts.good).toBeGreaterThan(counts.odd!);
        expect(counts.odd).toBeGreaterThan(counts.stock!);
        expect(pickCandidate([], rng)).toBeUndefined();
    });
});

/* ------------------------------------------------------------------ applying */

describe('applyGenerated', () => {
    it('promotes a sketch: builds up fields, replaces placeholders, keeps the dice', () => {
        const sketch = sketchProfile('Ильва', params());
        const other = params({
            values: { top: ['power', 'hedonism', 'stimulation'], sacrifice: 'tradition' },
            stance: 2,
        });
        const { profile: draft, written } = applyGenerated(sketch, candidate(), {
            lod: 'draft',
            origin: 'generated',
            params: other,
        });
        expect(draft.lod).toBe('draft');
        expect(draft.core.values).toEqual(sketch.core.values);
        expect(draft.core.want).toBe('to pay the garrison tax by Friday');
        expect(draft.core.signatures).toEqual([
            'if ordered → does it slowly and badly',
            'if a guest cannot pay → remembers the debt',
        ]);
        expect(draft.core.concept).toBe('Widow who keeps the inn out of spite');
        expect(draft.core.baselineMood).toEqual({ octant: 'bored', label: 'grim and watchful' });
        expect(draft.agenda.goals[0]).toMatchObject({ id: 'g1', kind: 'external', priority: 1 });
        expect(draft.starts).toEqual([
            {
                greeting: -1,
                present: true,
                doing: 'counting the takings',
                goal: 'keep the courier from noticing the letters',
            },
        ]);
        const player = draft.ties.find((item) => item.target === PLAYER_ID)!;
        expect(player.stance).toBe(sketch.ties[0]!.stance);
        expect(player.behaviour).toBe('takes his coin, gives nothing back');
        expect(player.reasons[0]!.text).toBe('an imperial');
        expect(draft.meta['core.want']).toEqual({ origin: 'generated' });
        expect(written).toEqual(
            expect.arrayContaining(['core.want', 'core.signatures', 'core.concept', 'agenda.goals', 'starts']),
        );
        expect(written).not.toContain('core.values');
        // A second pass rewrites nothing that is already written.
        const again = applyGenerated(draft, candidate({ want: 'something else', concept: 'other' }), {
            lod: 'portrait',
            origin: 'generated',
        });
        expect(again.profile.core.want).toBe(draft.core.want);
        expect(again.profile.core.concept).toBe(draft.core.concept);
        expect(again.profile.lod).toBe('portrait');
        expect(maxLod('portrait', 'draft')).toBe('portrait');
    });

    it('never writes over author, user, story or locked fields', () => {
        let authored = profile('ilva', 'Ильва', { lod: 'draft' });
        authored = { ...authored, core: { ...authored.core, want: '', keys: [], signatures: [] } };
        authored = setMeta(authored, 'core.want', { origin: 'author', evidence: ['…'] });
        authored = setMeta(authored, 'core.keys', { origin: 'generated', locked: true });
        authored = setMeta(authored, 'core.signatures', { origin: 'user' });
        authored = setMeta(authored, 'agenda', { origin: 'story' });
        const { profile: after, written } = applyGenerated(authored, candidate({ dream: 'a farm' }), {
            lod: 'draft',
            origin: 'generated',
        });
        expect(after.core.want).toBe('');
        expect(after.core.keys).toEqual([]);
        expect(after.core.signatures).toEqual([]);
        expect(after.agenda.goals).toEqual([]);
        expect(after.agenda.dream).toBeUndefined();
        expect(written).not.toEqual(expect.arrayContaining(['core.want']));
        expect(canGenerate(authored, 'core.want')).toBe(false);
        expect(canGenerate(authored, 'core.keys')).toBe(false);
        expect(canGenerate(authored, 'core.signatures')).toBe(false);
        expect(canGenerate(authored, 'core.concept')).toBe(true);
    });

    it('a fill reads the stance toward the player from the card, never from the stranger dice', () => {
        const authored = profile('neia', 'Нейя', { lod: 'portrait', ties: [] });
        expect(missingFields(authored)).toContain(`ties.${PLAYER_ID}`);
        const dice = params({ stance: -1 });
        const read = applyGenerated(
            authored,
            candidate({ playerStance: 2, stanceReason: 'she raises him', stanceBehaviour: 'wakes him gently' }),
            { lod: 'portrait', origin: 'generated', params: dice, kind: 'fill' },
        ).profile;
        const tieRead = read.ties.find((item) => item.target === PLAYER_ID)!;
        expect(tieRead.stance).toBe(2);
        expect(tieRead.reasons[0]).toMatchObject({ id: 'gen-context', text: 'she raises him' });
        expect(tieRead.behaviour).toBe('wakes him gently');
        // The card says nothing about them and the player: no tie rather than a drawn stranger stance.
        const silent = applyGenerated(authored, candidate({ playerStance: null }), {
            lod: 'portrait',
            origin: 'generated',
            params: dice,
            kind: 'fill',
        }).profile;
        expect(silent.ties.some((item) => item.target === PLAYER_ID)).toBe(false);
    });

    it('treats a dice-made stranger tie on a card character as a gap and replaces it', () => {
        let drawn = profile('neia', 'Нейя', {
            lod: 'portrait',
            ties: [
                tie(PLAYER_ID, -1, {
                    reasons: [{ id: 'gen-stranger', text: 'a stranger', delta: -1, scenesLeft: null, stacks: 1 }],
                }),
            ],
        });
        drawn = setMeta(drawn, `ties.${PLAYER_ID}`, { origin: 'generated' });
        expect(needsFill(drawn)).toBe(true);
        expect(missingFields(drawn)).toContain(`ties.${PLAYER_ID}`);
        const after = applyGenerated(drawn, candidate({ playerStance: 2, stanceReason: 'her ward' }), {
            lod: 'portrait',
            origin: 'generated',
            params: params({ stance: -1 }),
            kind: 'fill',
        }).profile;
        const fixed = after.ties.find((item) => item.target === PLAYER_ID)!;
        expect(fixed.stance).toBe(2);
        expect(fixed.reasons.map((reason) => reason.id)).toEqual(['gen-context']);
        // An author's tie is not a gap.
        const authoredTie = setMeta(drawn, `ties.${PLAYER_ID}`, { origin: 'author' });
        expect(missingFields(authoredTie)).not.toContain(`ties.${PLAYER_ID}`);
    });

    it('fills only the gaps of an authored character', () => {
        let authored = profile('ilva', 'Ильва', {
            lod: 'draft',
            ties: [tie(PLAYER_ID, -2, { behaviour: 'never says his name' })],
        });
        authored = {
            ...authored,
            core: { ...authored.core, values: { top: ['benevolence'] }, want: 'keep the inn', proactivity: 8 },
        };
        authored = setMeta(authored, 'core.values', { origin: 'author' });
        authored = setMeta(authored, 'core.want', { origin: 'author' });
        authored = setMeta(authored, 'core.proactivity', { origin: 'author' });
        authored = setMeta(authored, `ties.${PLAYER_ID}`, { origin: 'author' });
        expect(needsFill(authored)).toBe(true);
        expect(missingFields(authored)).toEqual(
            expect.arrayContaining(['core.temperament', 'core.signatures', 'core.keys']),
        );
        expect(missingFields(authored)).not.toContain('core.want');
        const sampled = params({ values: { top: ['power'], sacrifice: 'benevolence' }, proactivity: 2, stance: 1 });
        const fixed = paramsFromProfile(authored, sampled);
        expect(fixed.values.top).toEqual(['benevolence']);
        expect(fixed.values.sacrifice).not.toBe('benevolence');
        expect(fixed.proactivity).toBe(8);
        expect(fixed.stance).toBe(-2);
        expect(fixed.commitment).toBe(sampled.commitment);
        const { profile: after } = applyGenerated(authored, candidate(), {
            lod: authored.lod,
            origin: 'generated',
            params: fixed,
        });
        expect(after.core.values).toEqual({ top: ['benevolence'] });
        expect(after.core.want).toBe('keep the inn');
        expect(after.core.proactivity).toBe(8);
        expect(after.core.temperament).toEqual({
            honesty: 1,
            extraversion: 2,
            agreeableness: -1,
            conscientiousness: 1,
        });
        expect(after.core.signatures).toHaveLength(2);
        expect(after.core.keys).toEqual(['protect her daughter']);
        expect(after.core.commitment).toBe('single');
        expect(after.ties[0]).toEqual(authored.ties[0]);
        expect(after.lod).toBe('draft');
        expect(needsFill(after)).toBe(false);
        expect(needsFill({ ...authored, kind: 'group' })).toBe(false);
    });

    it('adds candidate appetites but never a sexual one to a minor, and lets BunnyMo coping win', () => {
        const base = profile('x', 'Икс');
        const cravings = candidate({
            appetites: [
                {
                    kind: 'flesh',
                    label: '',
                    baseline: 3,
                    target: 'class',
                    targetClass: 'travellers',
                    triggers: [],
                    excuse: '',
                },
                {
                    kind: 'drink',
                    label: 'брага',
                    baseline: 2,
                    target: 'thing',
                    targetClass: '',
                    triggers: ['скука'],
                    excuse: '',
                },
                { kind: 'food', label: '', baseline: 0, target: 'thing', targetClass: '', triggers: [], excuse: '' },
            ],
            wound: { ghost: 'the fire', lie: 'nobody comes back', triggers: ['smoke'], coping: 'surrender' },
        });
        const adult = applyGenerated(base, cravings, {
            lod: 'portrait',
            origin: 'generated',
            coping: 'overcompensate',
        }).profile;
        expect(adult.appetites.map((item) => item.kind)).toEqual(['flesh', 'drink']);
        expect(adult.appetites[0]!.target).toEqual({ mode: 'class', class: 'travellers' });
        expect(adult.core.wound?.coping).toBe('overcompensate');
        const minor = applyGenerated({ ...base, minor: true }, cravings, {
            lod: 'portrait',
            origin: 'generated',
        }).profile;
        expect(minor.appetites.map((item) => item.kind)).toEqual(['drink']);
        expect(minor.core.wound?.coping).toBe('surrender');
    });
});

describe('applyTagFields', () => {
    it('lets archive tags beat the dice but not the author', () => {
        let sketch = sketchProfile('Серафина', params({ role: 'unknown' }));
        sketch = setMeta(sketch, 'core.keys', { origin: 'author' });
        sketch = { ...sketch, core: { ...sketch.core, keys: ['her oath'] } };
        const fields = tagsToFields([
            'SPECIES:LAMIA',
            'ATTACHMENT:ANXIOUS',
            'TRAIT:SHY',
            'TRUST:EARNED',
            'CONFLICT:AVOIDING',
            'VICE:DRINKING',
        ]);
        const { profile: after, written } = applyTagFields(sketch, fields);
        expect(after.species).toBe('lamia');
        expect(after.core.attachment).toEqual({ anxiety: 2, avoidance: 0 });
        expect(after.core.temperament.extraversion).toBe(-2);
        expect(after.core.keys).toEqual(['her oath']);
        expect(after.core.tactics[0]).toBe('evasion');
        expect(after.appetites.map((item) => item.kind)).toEqual(['drink']);
        expect(after.meta['core.attachment']).toEqual({ origin: 'generated', sources: ['bunnymo'] });
        expect(written).toEqual(
            expect.arrayContaining(['species', 'core.attachment', 'core.temperament', 'core.tactics']),
        );
        expect(written).not.toContain('core.keys');
    });
});

/* ------------------------------------------------------------------ promotion and turns */

describe('shouldPromote', () => {
    it('follows §10.2: scenes, interactions, canon or quest, a pin', () => {
        expect(shouldPromote({ lod: 'sketch', scenes: 1, interactions: 0 })).toBeNull();
        expect(shouldPromote({ lod: 'sketch', scenes: PROMOTION.draftScenes, interactions: 0 })).toBe('draft');
        expect(shouldPromote({ lod: 'sketch', scenes: 1, interactions: PROMOTION.draftInteractions })).toBe('draft');
        expect(shouldPromote({ lod: 'draft', scenes: 3, interactions: 0 })).toBeNull();
        expect(shouldPromote({ lod: 'draft', scenes: PROMOTION.portraitScenes, interactions: 0 })).toBe('portrait');
        expect(shouldPromote({ lod: 'sketch', scenes: 0, interactions: PROMOTION.portraitInteractions })).toBe(
            'portrait',
        );
        expect(shouldPromote({ lod: 'sketch', scenes: 1, interactions: 0, canon: true })).toBeNull();
        expect(shouldPromote({ lod: 'sketch', scenes: 2, interactions: 0, canon: true })).toBe('draft');
        expect(shouldPromote({ lod: 'sketch', scenes: 1, interactions: 0, quest: true })).toBe('draft');
        expect(shouldPromote({ lod: 'sketch', scenes: 3, interactions: 0, quest: true })).toBe('portrait');
        expect(shouldPromote({ lod: 'sketch', scenes: 0, interactions: 0, pinned: true })).toBe('portrait');
        expect(shouldPromote({ lod: 'portrait', scenes: 9, interactions: 20, pinned: true })).toBeNull();
    });

    it('counts a scene once and every direct address', () => {
        let stats = countTurn(undefined, 0, true, false);
        expect(stats).toEqual({ scenes: 1, lastScene: 0, interactions: 0, present: true });
        stats = countTurn(stats, 0, true, true);
        expect(stats).toEqual({ scenes: 1, lastScene: 0, interactions: 1, present: true });
        stats = countTurn(stats, 1, false, true);
        expect(stats).toEqual({ scenes: 1, lastScene: 0, interactions: 1, present: false });
        stats = countTurn(stats, 2, true, false);
        expect(stats).toMatchObject({ scenes: 2, lastScene: 2, present: true });
        // No scene pass running (the counter stays): leaving and coming back is a new scene.
        stats = countTurn(stats, 2, false, false);
        stats = countTurn(stats, 2, true, false);
        expect(stats.scenes).toBe(3);
        stats = countTurn(stats, 2, true, false);
        expect(stats.scenes).toBe(3);
    });

    it('carries a promotion into the live state without undoing the story', () => {
        const sketch = sketchProfile('Брам', params({ stance: -1 }));
        const live = createCharacterState(sketch, 0);
        const promoted = applyGenerated(
            sketch,
            candidate({
                appetites: [
                    {
                        kind: 'drink',
                        label: 'эль',
                        baseline: 3,
                        target: 'thing',
                        targetClass: '',
                        triggers: [],
                        excuse: '',
                    },
                ],
            }),
            { lod: 'draft', origin: 'generated' },
        ).profile;
        const synced = syncLiveState(live, sketch, promoted);
        expect(synced.scene.doing).toBe('counting the takings');
        expect(synced.scene.goal).toBe('keep the courier from noticing the letters');
        expect(synced.ties[PLAYER_ID]!.behaviour).toBe('takes his coin, gives nothing back');
        expect(synced.appetites.drink).toMatchObject({ pressure: 3, lastSated: -1 });
        expect(synced.agenda.goals).toHaveLength(1);
        expect(live.scene.doing).toBe(sketch.starts[0]!.doing);
        // The story moved them: the scene and the stance stay as the story left them.
        const moved = {
            ...live,
            scene: { ...live.scene, doing: 'fighting' },
            ties: { [PLAYER_ID]: { ...live.ties[PLAYER_ID]!, stance: -3 as const } },
        };
        const kept = syncLiveState(moved, sketch, promoted);
        expect(kept.scene.doing).toBe('fighting');
        expect(kept.ties[PLAYER_ID]!.behaviour).toBe(live.ties[PLAYER_ID]!.behaviour);
        // A live state without a player tie gets one.
        const stranger = syncLiveState(liveState(profile('z', 'Z'), { knowsPlayer: false }), null, promoted);
        expect(stranger.knowsPlayer).toBe(true);
        expect(stranger.ties[PLAYER_ID]).toBeDefined();
    });
});

/* ------------------------------------------------------------------ rules */

function rule(patch: Partial<AppetiteRule> = {}): AppetiteRule {
    return {
        id: 'valley-mates',
        holders: 'lamias',
        kind: 'flesh',
        source: 'species',
        target: { mode: 'class', class: 'human men' },
        intensity: { zero: 0, low: 0, mid: 0, high: 1 },
        styles: { siren: 1 },
        choosiness: 0,
        exclusivity: 'exclusive',
        affectionOnset: 'possible',
        groupMode: 'solitary',
        ...patch,
    };
}

function lamia(id: string, patch: Partial<CharacterProfile> = {}): CharacterProfile {
    return profile(id, id, { species: 'lamia', gender: 'female', ...patch });
}

describe('holderMatches and fitsClass', () => {
    it('matches holders by species, role or group, plurals and Russian forms included', () => {
        expect(holderMatches('lamias', lamia('a'))).toBe(true);
        expect(holderMatches('the garrison guards', profile('g', 'G', { role: 'guard' }))).toBe(true);
        expect(holderMatches('гоблины-налётчики', profile('g', 'G', { species: 'гоблин' }))).toBe(true);
        expect(holderMatches('стража гарнизона', profile('g', 'G', { role: 'guard' }))).toBe(true);
        expect(holderMatches('raiders of the ford', profile('g', 'G', { role: 'merchant' }))).toBe(false);
        expect(holderMatches('Red Hand', profile('g', 'G'), ['the red hand'])).toBe(true);
        expect(holderMatches('', lamia('a'))).toBe(false);
    });

    it('fits a class by gender and kind; the player gets the benefit of the doubt', () => {
        expect(fitsClass('human men', { id: 'bram', gender: 'male' })).toBe(true);
        expect(fitsClass('human men', { id: 'mira', gender: 'female' })).toBe(false);
        expect(fitsClass('human men', { id: 'nobody' })).toBe(false);
        expect(fitsClass('human men', { id: PLAYER_ID })).toBe(true);
        expect(fitsClass('human men', { id: 'grukk', gender: 'male', species: 'goblin' })).toBe(false);
        expect(fitsClass('чужаки', { id: 'x' })).toBe(true);
        expect(fitsClass('мужчины', { id: 'x', gender: 'male' })).toBe(true);
        expect(fitsClass('goblins', { id: 'grukk', species: 'goblin' })).toBe(true);
        expect(fitsClass('merchants', { id: 'mira', role: 'merchant' })).toBe(true);
    });
});

describe('applyRules', () => {
    const population = [
        { id: 'kira', species: 'lamia', gender: 'female' as const },
        { id: 'bram', gender: 'male' as const },
        { id: 'fenn', gender: 'male' as const },
        { id: 'mira', gender: 'female' as const },
        { id: 'boy', gender: 'male' as const, minor: true },
        { id: PLAYER_ID },
    ];

    it('spreads a class target over every fitting candidate, NPCs included', () => {
        const { profiles, grants } = applyRules(
            [lamia('kira'), profile('bram', 'Брам', { gender: 'male' })],
            [rule()],
            {
                population,
                knowsPlayer: () => false,
            },
            seeded(2),
        );
        expect(grants).toHaveLength(1);
        expect(grants[0]!.holder).toBe('kira');
        expect(grants[0]!.targets.sort()).toEqual([PLAYER_ID, 'bram', 'fenn'].sort());
        const kira = profiles[0]!;
        expect(kira.appetites).toHaveLength(1);
        expect(kira.appetites[0]).toMatchObject({ kind: 'flesh', rule: 'valley-mates', sources: ['species'] });
        expect(kira.appetites[0]!.baseline).toBeGreaterThanOrEqual(4);
        const wanted = kira.ties.filter((item) => item.want !== undefined);
        expect(wanted.length).toBeGreaterThan(0);
        expect(wanted.length).toBeLessThanOrEqual(RULE_TIES);
        expect(wanted.every((item) => item.appetite === kira.appetites[0]!.id && item.gaze === 'prize')).toBe(true);
        expect(wanted.some((item) => item.target === 'boy' || item.target === 'mira')).toBe(false);
        expect(profiles[1]!.appetites).toEqual([]);
    });

    it('aims a player target only at someone who knows the player', () => {
        const playerRule = rule({ target: { mode: 'player' } });
        const known = applyRules(
            [lamia('kira'), lamia('sera')],
            [playerRule],
            {
                population,
                knowsPlayer: (id) => id === 'kira',
            },
            seeded(3),
        );
        const byHolder = Object.fromEntries(known.grants.map((grant) => [grant.holder, grant.targets]));
        expect(byHolder.kira).toEqual([PLAYER_ID]);
        expect(byHolder.sera).toEqual([]);
        expect(known.profiles[0]!.ties.find((item) => item.target === PLAYER_ID)?.want).toBeGreaterThan(0);
        expect(known.profiles[1]!.ties.find((item) => item.target === PLAYER_ID)).toBeUndefined();
        // The appetite exists either way: the draw is the individual's.
        expect(known.profiles[1]!.appetites).toHaveLength(1);
    });

    it('keeps minors out of sexual rules as holders and as targets', () => {
        const { profiles, grants } = applyRules(
            [lamia('young', { minor: true }), lamia('kira')],
            [rule({ target: { mode: 'class', class: 'men' } })],
            {
                population,
                knowsPlayer: () => true,
            },
            seeded(4),
        );
        expect(profiles[0]!.appetites).toEqual([]);
        expect(grants.map((grant) => grant.holder)).toEqual(['kira']);
        expect(grants[0]!.targets).not.toContain('boy');
        // A non-sexual rule reaches a minor holder.
        const food = applyRules(
            [lamia('young', { minor: true })],
            [rule({ kind: 'food', target: { mode: 'thing' } })],
            {
                population,
                knowsPlayer: () => true,
            },
            seeded(4),
        );
        expect(food.profiles[0]!.appetites).toHaveLength(1);
        expect(food.grants[0]!.targets).toEqual([]);
    });

    it('is idempotent, honours protection, only and groups, and keeps real zeros', () => {
        const ctx = { population, knowsPlayer: () => true };
        const first = applyRules([lamia('kira')], [rule()], ctx, seeded(5));
        const second = applyRules(first.profiles, [rule()], ctx, seeded(6));
        expect(second.grants).toEqual([]);
        expect(second.profiles).toEqual(first.profiles);
        const locked = setMeta(lamia('kira'), 'appetites', { origin: 'author', locked: true });
        expect(applyRules([locked], [rule()], ctx, seeded(5)).grants).toEqual([]);
        expect(
            applyRules([lamia('kira'), lamia('sera')], [rule()], { ...ctx, only: ['sera'] }, seeded(5)).grants.map(
                (g) => g.holder,
            ),
        ).toEqual(['sera']);
        expect(applyRules([{ ...lamia('kira'), kind: 'group' }], [rule()], ctx, seeded(5)).grants).toEqual([]);
        const sated = applyRules(
            [lamia('nayra')],
            [rule({ intensity: { zero: 1, low: 0, mid: 0, high: 0 } })],
            ctx,
            seeded(5),
        );
        expect(sated.profiles[0]!.appetites[0]!.baseline).toBe(0);
        expect(sated.profiles[0]!.ties).toEqual([]);
        expect(sated.grants[0]!.pressure).toBe(0);
        const member = applyRules(
            [profile('x', 'X')],
            [rule({ holders: 'Red Hand' })],
            { ...ctx, groups: () => ['Red Hand'] },
            seeded(5),
        );
        expect(member.grants).toHaveLength(1);
        // An existing tie keeps its stance and gains the want.
        const withTie = applyRules(
            [lamia('kira', { ties: [tie(PLAYER_ID, -1)] })],
            [rule({ target: { mode: 'player' } })],
            ctx,
            seeded(5),
        );
        const playerTie = withTie.profiles[0]!.ties.find((item) => item.target === PLAYER_ID)!;
        expect(playerTie.stance).toBe(-1);
        expect(playerTie.want).toBeGreaterThan(0);
        expect(VALUES.length).toBe(10);
        void appetite;
    });
});
