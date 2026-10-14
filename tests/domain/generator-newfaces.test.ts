// New faces grounded in the story (docs/model.md §10.2): the stance from the story, the reputation of their groups, a
// world rule aimed at the player, a mild default — the tone's dice only for a stranger; rules applied at sketch time on
// the face's groups; promotion re-deriving the dice's guesses on the story; a code-only grounding by later facts; the
// repair of faces an older build drew from dice. Synthetic fixtures (a family scenario, a monster world).
import { describe, expect, it } from 'vitest';
import {
    applyGenerated,
    applyRules,
    groundWithFacts,
    needsGrounding,
    newFaceMessages,
    paramsFromProfile,
    pickFitting,
    playerRuleFor,
    sampleParams,
    sketchProfile,
    syncLiveState,
} from '../../src/domain/generator';
import type { GenCandidate, GenParams, RuleContext, SampleOptions } from '../../src/domain/generator';
import { emptyCandidate, generatorSchema } from '../../src/domain/generator-prompt';
import { PLAYER_ID } from '../../src/domain/model';
import type { AppetiteRule, CharacterProfile, NewcomerFacts } from '../../src/domain/model';
import { heuristicFacts, relationGroups } from '../../src/domain/newcomers';
import { setMeta } from '../../src/domain/profile-defaults';
import { createCharacterState } from '../../src/domain/state-init';
import { seeded } from './appetites-fixtures';
import { reason } from './cast-fixtures';

function rule(patch: Partial<AppetiteRule> = {}): AppetiteRule {
    return {
        id: 'rule',
        holders: 'family members',
        kind: 'flesh',
        source: 'culture',
        target: { mode: 'class', class: 'family members' },
        intensity: { zero: 0, low: 0, mid: 0, high: 1 },
        styles: { honest: 1 },
        choosiness: 0,
        exclusivity: 'shared',
        affectionOnset: 'common',
        groupMode: 'tribe',
        ...patch,
    };
}

function ruleContext(
    population: { id: string; species?: string; groups?: string[] }[],
    patch: Partial<RuleContext> = {},
): RuleContext {
    return { population, knowsPlayer: () => true, intents: true, ...patch };
}

/* ------------------------------------------------------------------ the family scenario */

describe('a family scenario: the story says «дочь Джона»', () => {
    // A narrator card: the family lives together, relationships in it are normal (synthetic).
    const familyRule = rule({ id: 'family', label: 'family relationships are allowed and normal' });
    const world = ['family members', 'All family members'];
    const reputation: SampleOptions = { reputation: 0, reputationLabel: 'a family member who can be approached' };

    it('reads the relation from the chat, takes the reputation’s stance and the story’s reason, no «чужак»', () => {
        const guess = heuristicFacts('Лиза', ['В кухню входит Лиза, дочь Джона.'], { groups: world });
        expect(guess).toMatchObject({ relation: 'family', relationNote: 'дочь Джона' });
        const facts: NewcomerFacts = { ...guess!, turn: 3 };
        const groups = relationGroups(facts.relation, world);
        expect(groups).toEqual(['family members', 'All family members']);
        for (let seed = 1; seed <= 20; seed++) {
            const params = sampleParams('unknown', 'indifferent', [], seeded(seed), 'varied', {
                grounded: true,
                facts,
                lang: 'ru',
                ...reputation,
            });
            expect(params.basis).toMatchObject({ source: 'story', stance: 0, reason: 'дочь Джона', read: 'heuristic' });
            const sketch = sketchProfile('Лиза', params, { lang: 'ru', facts, groups });
            const tie = sketch.ties.find((item) => item.target === PLAYER_ID)!;
            expect(tie.stance).toBe(0);
            expect(tie.reasons).toEqual([
                { id: 'story-relation', text: 'дочь Джона', delta: 0, scenesLeft: null, stacks: 1 },
            ]);
            expect(JSON.stringify(sketch)).not.toMatch(/чужак/);
            expect(sketch.meta[`ties.${PLAYER_ID}`]).toEqual({ origin: 'story', sources: ['heuristic'] });
            expect(sketch.role).toBe('дочь');
            expect(sketch.meta.role).toEqual({ origin: 'story', sources: ['heuristic'] });
            expect(sketch.groups).toEqual(groups);
            // The dice still drew the rest: provisional guesses.
            expect(sketch.meta['core.values']).toEqual({ origin: 'generated', sources: ['dice'] });
        }
    });

    it('applies the family’s rule to her at sketch time, on her groups, the player among the family', () => {
        const facts: NewcomerFacts = {
            name: 'Лиза',
            relation: 'family',
            relationNote: 'дочь Джона',
            groups: ['family members'],
            source: 'turn',
            turn: 3,
        };
        const params = sampleParams('unknown', 'indifferent', [], seeded(4), 'varied', {
            grounded: true,
            facts,
            ...reputation,
        });
        const sketch = sketchProfile('Лиза', params, { facts, groups: ['family members'] });
        const { profiles, grants } = applyRules(
            [sketch],
            [familyRule],
            ruleContext([
                { id: sketch.id, groups: ['family members'] },
                { id: 'mother', groups: ['family members'] },
                { id: PLAYER_ID, groups: ['family members'] },
            ]),
            seeded(1),
        );
        expect(grants).toHaveLength(1);
        expect(grants[0]!.targets).toEqual(expect.arrayContaining([PLAYER_ID, 'mother']));
        const lisa = profiles[0]!;
        expect(lisa.appetites[0]).toMatchObject({ rule: 'family', kind: 'flesh' });
        const tie = lisa.ties.find((item) => item.target === PLAYER_ID)!;
        expect(tie.stance).toBe(0);
        expect(tie.want).toBeGreaterThan(0);
        // The story's tie keeps its reason; the rule only adds the wanting.
        expect(tie.reasons[0]!.id).toBe('story-relation');
    });
});

/* ------------------------------------------------------------------ the monster world */

describe('a monster world: «monsters keep humans as slaves»', () => {
    const slavers = rule({
        id: 'slavers',
        holders: 'monsters',
        kind: 'dominance',
        source: 'world',
        label: 'monsters keep humans as slaves',
        target: { mode: 'class', class: 'humans' },
        styles: { shepherd: 1 },
    });

    it('finds the rule a monster holds that aims at the human player', () => {
        expect(playerRuleFor([slavers], { species: 'monster' })).toMatchObject({ gaze: 'property' });
        expect(playerRuleFor([slavers], { groups: ['Monsters'] })).toMatchObject({ gaze: 'property' });
        expect(playerRuleFor([slavers], { species: 'human' })).toBeNull();
        expect(playerRuleFor([rule({ ...slavers, kind: 'flesh' })], { species: 'monster', minor: true })).toBeNull();
    });

    it('gives a new monster the rule’s appetite and a capture intent, never «ждёт случая ударить»', () => {
        const facts: NewcomerFacts = {
            name: 'Гроа',
            relation: 'stranger',
            species: 'monster',
            source: 'turn',
            turn: 1,
        };
        const rulesOf = playerRuleFor([slavers], { species: 'monster' });
        for (let seed = 1; seed <= 40; seed++) {
            const params = sampleParams('unknown', 'hostile', [], seeded(seed), 'varied', {
                grounded: true,
                facts,
                rule: rulesOf,
                lang: 'ru',
            });
            expect(params.basis?.source).toBe('world');
            expect(params.stance).toBeGreaterThanOrEqual(-1);
            expect(params.stance).toBeLessThanOrEqual(1);
            const sketch = sketchProfile('Гроа', params, { lang: 'ru', facts });
            const { profiles } = applyRules(
                [sketch],
                [slavers],
                ruleContext([{ id: sketch.id, species: 'monster' }, { id: PLAYER_ID }]),
                seeded(seed),
            );
            const monster = profiles[0]!;
            const tie = monster.ties.find((item) => item.target === PLAYER_ID)!;
            expect(tie.intent).toBe('use');
            expect(tie.behaviour).toBe('хочет захватить его и оставить себе');
            expect(tie.reasons[0]).toMatchObject({ id: 'gen-world', text: 'monsters keep humans as slaves' });
            expect(tie.gaze).toBe('property');
            expect(tie.want).toBeGreaterThan(0);
            expect(monster.appetites[0]).toMatchObject({ rule: 'slavers', kind: 'dominance' });
            expect(JSON.stringify(monster)).not.toMatch(/ударить|насолить/);
            expect(monster.meta[`ties.${PLAYER_ID}`]).toEqual({ origin: 'generated', sources: ['world'] });
        }
    });

    it('lets a plain stranger meet the hostile world’s dice, but not an indifferent world’s extremes', () => {
        const stranger: NewcomerFacts = { name: 'X', relation: 'stranger', source: 'turn', turn: 1 };
        let hostileLow = 0;
        for (let seed = 1; seed <= 200; seed++) {
            const calm = sampleParams('unknown', 'indifferent', [], seeded(seed), 'even', {
                grounded: true,
                facts: stranger,
            });
            expect(calm.stance).toBeGreaterThanOrEqual(-1);
            expect(calm.basis?.source).toBe('dice');
            const hostile = sampleParams('unknown', 'hostile', [], seeded(seed), 'even', {
                grounded: true,
                facts: stranger,
            });
            if (hostile.stance <= -2) hostileLow++;
        }
        // A hostile world is a world reason: its strangers may be hostile.
        expect(hostileLow).toBeGreaterThan(0);
        // The canned «чужак» reason belongs to a stranger only.
        const sketch = sketchProfile(
            'X',
            sampleParams('unknown', 'indifferent', [], seeded(3), 'even', { grounded: true, facts: stranger }),
            { lang: 'ru' },
        );
        expect(sketch.ties[0]!.reasons[0]!.id).toBe('gen-stranger');
        expect(sketch.ties[0]!.reasons[0]!.text).toMatch(/чужак/);
    });
});

/* ------------------------------------------------------------------ unknown relation */

describe('a face whose relation is not clear', () => {
    it('meets the player with a mild default, without a reason, even in a hostile world', () => {
        for (let seed = 1; seed <= 40; seed++) {
            const params = sampleParams('guard', 'hostile', [], seeded(seed), 'varied', {
                grounded: true,
                facts: null,
            });
            expect(params.stance).toBe(0);
            expect(params.basis).toEqual({ source: 'default', stance: 0 });
            const sketch = sketchProfile('Стражник', params, { lang: 'ru' });
            const tie = sketch.ties[0]!;
            expect(tie.reasons).toEqual([]);
            expect(tie.behaviour).toBe('ещё не ясно: пока присматривается к нему');
            expect(sketch.meta[`ties.${PLAYER_ID}`]).toEqual({ origin: 'generated', sources: ['default'] });
        }
    });

    it('follows the reputation of their group always, the everyone’s one for a stranger only now and then', () => {
        const group = sampleParams('unknown', 'welcoming', [], seeded(2), 'even', {
            grounded: true,
            reputation: -2,
            reputationLabel: 'беглый каторжник',
        });
        expect(group.basis).toEqual({ source: 'reputation', stance: -2, reason: 'беглый каторжник' });
        const stranger: NewcomerFacts = { name: 'X', relation: 'stranger', source: 'turn', turn: 1 };
        let hits = 0;
        for (let seed = 1; seed <= 200; seed++) {
            const params = sampleParams('unknown', 'welcoming', [], seeded(seed), 'even', {
                grounded: true,
                facts: stranger,
                reputation: -2,
                reputationGeneral: true,
            });
            if (params.stance === -2) hits++;
        }
        expect(hits / 200).toBeGreaterThan(0.5);
        expect(hits / 200).toBeLessThan(0.95);
    });
});

/* ------------------------------------------------------------------ promotion */

function guessedSketch(): CharacterProfile {
    const params = sampleParams('unknown', 'indifferent', [], seeded(9), 'varied', { grounded: true, facts: null });
    return sketchProfile('Кира', params, { lang: 'ru' });
}

describe('promotion of a new face re-derives the guesses on the story', () => {
    it('passes the dice’s values as guesses, the story’s and the user’s as fixed', () => {
        let kira = guessedSketch();
        kira = setMeta({ ...kira, core: { ...kira.core, proactivity: 9 } }, 'core.proactivity', {
            origin: 'user',
            locked: true,
        });
        const facts: NewcomerFacts = {
            name: 'Кира',
            relation: 'family',
            relationNote: 'дочь Джона',
            source: 'turn',
            turn: 2,
        };
        const sampled = sampleParams('unknown', 'indifferent', [], seeded(1), 'varied', { grounded: true, facts });
        const params = paramsFromProfile(kira, sampled);
        expect(params.fixed).toEqual(expect.arrayContaining(['proactivity', 'stance']));
        for (const key of ['values', 'temperament', 'drives', 'tactics', 'commitment', 'baselineMood'] as const) {
            expect(params.fixed).not.toContain(key);
        }
        // The guessed default tie gives way to what the story showed.
        expect(params.basis).toMatchObject({ source: 'story', reason: 'дочь Джона' });
        expect(params.values).toEqual(kira.core.values);
        const [system, user] = newFaceMessages('draft', { name: 'Кира', profile: kira }, params, {
            worldTone: 'indifferent',
            playerName: 'Курьер',
            world: ['Rule of the world — family members → family members: family relationships are allowed'],
            said: ['Кира, дочь Джона, накрывает на стол.'],
            seen: ['Кира: тепло — помогла с ужином'],
            facts: ['To the player’s character: family — «дочь Джона»'],
            story: 'Card: Семья',
        });
        expect(system!.content).toMatch(/The story so far is canon for this character/);
        expect(system!.content).toMatch(/Never contradict the scenario's premise/);
        expect(system!.content).toMatch(/provisional guesses/);
        expect(user!.content).toContain('<world>\nRule of the world — family members');
        expect(user!.content).toContain('<said>\n- Кира, дочь Джона, накрывает на стол.\n</said>');
        expect(user!.content).toContain('<seen>\n- Кира: тепло — помогла с ужином\n</seen>');
        expect(user!.content).toContain('Story facts (canon):\n- To the player’s character: family');
        const fixedPart = user!.content.split('Provisional guesses')[0]!;
        const guessPart = user!.content.split('Provisional guesses')[1]!;
        expect(fixedPart).toMatch(/Initiative: 9\/10/);
        // Family with no reputation to go by: the stance the relation stands for.
        expect(fixedPart).toMatch(/Toward Курьер: helpful \(1\) — дочь Джона/);
        expect(guessPart).toMatch(/Values by priority:/);
        expect(guessPart).toMatch(/Temperament \(HEXACO/);
        const schema = JSON.stringify(generatorSchema('draft', true).schema);
        for (const field of ['values', 'temperament', 'drivesHigh', 'playerStance', 'role'])
            expect(schema).toContain(field);
        expect(JSON.stringify(generatorSchema('draft').schema)).not.toContain('drivesHigh');
    });

    it('lets the model replace the guesses, never the user’s field or the story’s tie', () => {
        let kira = guessedSketch();
        kira = setMeta({ ...kira, core: { ...kira.core, proactivity: 9 } }, 'core.proactivity', {
            origin: 'user',
            locked: true,
        });
        const sampled = sampleParams('unknown', 'indifferent', [], seeded(1), 'varied', { grounded: true });
        const params = paramsFromProfile(kira, sampled);
        const candidate: GenCandidate = {
            ...emptyCandidate(),
            want: 'keep the family together',
            signatures: ['if her brother is hurt → stands between', 'if teased → laughs it off'],
            values: ['benevolence', 'tradition', 'security'],
            sacrifice: 'power',
            temperament: { agreeableness: 2, emotionality: 1 },
            drives: { high: ['family', 'social'], low: ['power'] },
            proactivity: 2,
            playerStance: 2,
            stanceReason: 'his younger sister',
            stanceBehaviour: 'looks after him',
            role: 'младшая сестра',
            fit: 5,
        };
        const { profile: draft, written } = applyGenerated(kira, candidate, {
            lod: 'draft',
            origin: 'generated',
            kind: 'draft',
            params,
            lang: 'ru',
            ground: true,
        });
        expect(draft.lod).toBe('draft');
        expect(draft.core.values).toEqual({ top: ['benevolence', 'tradition', 'security'], sacrifice: 'power' });
        expect(draft.core.temperament).toEqual({ agreeableness: 2, emotionality: 1 });
        expect(draft.core.drives).toEqual({ high: ['family', 'social'], low: ['power'] });
        expect(draft.meta['core.values']).toEqual({ origin: 'generated', sources: ['grounded'] });
        expect(draft.core.proactivity).toBe(9);
        expect(written).not.toContain('core.proactivity');
        expect(draft.role).toBe('младшая сестра');
        const tie = draft.ties.find((item) => item.target === PLAYER_ID)!;
        expect(tie).toMatchObject({ stance: 2, behaviour: 'looks after him' });
        expect(tie.reasons[0]).toMatchObject({ id: 'gen-context', text: 'his younger sister' });
        expect(draft.core.signatures).toHaveLength(2);
        // The live tie the story never moved follows the new stance.
        const live = createCharacterState(kira, 0);
        expect(syncLiveState(live, kira, draft).ties[PLAYER_ID]).toMatchObject({ stance: 2 });
        const moved = {
            ...live,
            ties: { [PLAYER_ID]: { ...live.ties[PLAYER_ID]!, reasons: [reason('he lied', -1, 3)] } },
        };
        expect(syncLiveState(moved, kira, draft).ties[PLAYER_ID]!.stance).toBe(0);
        // A story tie is the story's: a promotion keeps it.
        const facts: NewcomerFacts = {
            name: 'Кира',
            relation: 'enemy',
            reason: 'burned the farm',
            source: 'turn',
            turn: 1,
        };
        const grounded = groundWithFacts(kira, facts).profile;
        const again = applyGenerated(grounded, candidate, {
            lod: 'draft',
            origin: 'generated',
            kind: 'draft',
            params: paramsFromProfile(grounded, sampled),
            ground: true,
        }).profile;
        expect(again.ties.find((item) => item.target === PLAYER_ID)).toMatchObject({ stance: -2 });
    });

    it('never makes a hostile stance without a reason', () => {
        const kira = guessedSketch();
        const params = paramsFromProfile(kira, sampleParams('unknown', 'hostile', [], seeded(3), 'even', {}));
        const { profile } = applyGenerated(
            kira,
            { ...emptyCandidate(), playerStance: -3, stanceReason: '', want: 'x' },
            { lod: 'draft', origin: 'generated', kind: 'draft', params, ground: true },
        );
        expect(profile.ties[0]!.stance).toBe(-1);
    });
});

/* ------------------------------------------------------------------ facts after the sketch */

describe('facts the story shows later', () => {
    it('ground a guessed face without a model: groups, kind, the relation; a locked tie stays', () => {
        const kira = guessedSketch();
        const facts: NewcomerFacts = {
            name: 'Кира',
            relation: 'servant',
            relationNote: 'твоя служанка',
            species: 'кошкодевочка',
            groups: ['servants'],
            source: 'turn',
            turn: 4,
        };
        const { profile, written } = groundWithFacts(kira, facts, { lang: 'ru', groups: ['slaves', 'Beasts'] });
        expect(written).toEqual(expect.arrayContaining(['groups', 'species', `ties.${PLAYER_ID}`]));
        expect(profile.groups).toEqual(['servants', 'slaves']);
        expect(profile.species).toBe('кошкодевочка');
        expect(profile.ties[0]).toMatchObject({
            stance: 0,
            reasons: [expect.objectContaining({ text: 'твоя служанка' })],
        });
        expect(profile.meta[`ties.${PLAYER_ID}`]).toEqual({ origin: 'story', sources: ['turn'] });
        const locked = setMeta(kira, `ties.${PLAYER_ID}`, { origin: 'user', locked: true });
        expect(groundWithFacts(locked, facts).written).not.toContain(`ties.${PLAYER_ID}`);
    });
});

/* ------------------------------------------------------------------ repair of dice-made faces */

/** A face an older build drew from dice: no 'dice' marks, a «чужак» tie (synthetic, the old layout). */
function legacyFace(): CharacterProfile {
    const params: GenParams = {
        ...sampleParams('unknown', 'hostile', [], seeded(5), 'even'),
        stance: -1,
        basis: undefined,
    };
    let face = sketchProfile('Вера', params, { lang: 'ru' });
    face = { ...face, lod: 'draft', core: { ...face.core, concept: 'ищет эмоций в мелких преступлениях' } };
    for (const path of Object.keys(face.meta)) {
        const meta = face.meta[path]!;
        face = setMeta(face, path, meta.sources?.includes('dice') ? { origin: 'generated' } : meta);
    }
    face = setMeta(face, `ties.${PLAYER_ID}`, { origin: 'generated', sources: ['template'] });
    return setMeta(face, 'core.concept', { origin: 'generated' });
}

describe('the repair of faces an older build drew from dice', () => {
    it('knows them: a dice stranger tie without marks and nothing from the author or the story', () => {
        const old = legacyFace();
        expect(needsGrounding(old)).toBe(true);
        expect(needsGrounding(guessedSketch())).toBe(false);
        expect(needsGrounding(setMeta(old, 'core.keys', { origin: 'story' }))).toBe(false);
        expect(needsGrounding({ ...old, kind: 'group' })).toBe(false);
        // A fresh stranger sketch carries its dice mark: not a repair case.
        const stranger = sketchProfile(
            'X',
            sampleParams('unknown', 'indifferent', [], seeded(3), 'even', {
                grounded: true,
                facts: { name: 'X', relation: 'stranger', source: 'turn', turn: 1 },
            }),
        );
        expect(needsGrounding(stranger)).toBe(false);
    });

    it('rebuilds every generated field on the story, keeping the level and the user’s edit', () => {
        let old = legacyFace();
        old = setMeta({ ...old, core: { ...old.core, voice: 'Ну и ну.' } }, 'core.voice', { origin: 'user' });
        const params = paramsFromProfile(old, sampleParams('unknown', 'hostile', [], seeded(2), 'even', {}), {
            everyGenerated: true,
        });
        expect(params.fixed).toEqual([]);
        const { profile } = applyGenerated(
            old,
            {
                ...emptyCandidate(),
                concept: 'младшая дочь, любимица отца',
                values: ['benevolence', 'hedonism'],
                playerStance: 1,
                stanceReason: 'his daughter',
                voice: 'Папа!',
            },
            { lod: old.lod, origin: 'generated', kind: 'draft', params, ground: true, everyGenerated: true },
        );
        expect(profile.lod).toBe('draft');
        expect(profile.core.concept).toBe('младшая дочь, любимица отца');
        expect(profile.core.values.top).toEqual(['benevolence', 'hedonism']);
        expect(profile.core.voice).toBe('Ну и ну.');
        expect(profile.ties[0]).toMatchObject({ stance: 1, reasons: [expect.objectContaining({ id: 'gen-context' })] });
        expect(needsGrounding(profile)).toBe(false);
    });
});

describe('the fit check of a new face', () => {
    it('picks only takes that say they fit the story while there is one', () => {
        const takes = [
            { id: 'off', fit: 1, typicality: 1 },
            { id: 'fits', fit: 4, typicality: 3 },
            { id: 'also', fit: 3, typicality: 4 },
        ];
        for (let seed = 1; seed <= 50; seed++) expect(pickFitting(takes, seeded(seed))!.id).not.toBe('off');
        expect(pickFitting([{ id: 'only', fit: 1, typicality: 1 }], seeded(1))!.id).toBe('only');
        expect(pickFitting([], seeded(1))).toBeUndefined();
    });
});

describe('a story stance in a promotion', () => {
    it('holds against the model’s number: the model only words it', () => {
        const kira = guessedSketch();
        const facts: NewcomerFacts = {
            name: 'Кира',
            relation: 'enemy',
            reason: 'burned the farm',
            source: 'turn',
            turn: 1,
        };
        const sampled = sampleParams('unknown', 'indifferent', [], seeded(1), 'varied', { grounded: true, facts });
        const params = paramsFromProfile(kira, sampled);
        expect(params.fixed).toContain('stance');
        const { profile } = applyGenerated(
            kira,
            {
                ...emptyCandidate(),
                want: 'x',
                playerStance: 3,
                stanceReason: 'loves him',
                stanceBehaviour: 'spits at his feet',
            },
            { lod: 'draft', origin: 'generated', kind: 'draft', params, ground: true },
        );
        expect(profile.ties[0]).toMatchObject({
            stance: -2,
            behaviour: 'spits at his feet',
            reasons: [expect.objectContaining({ id: 'story-relation', text: 'burned the farm' })],
        });
        expect(profile.meta['ties.@player']).toEqual({ origin: 'story', sources: ['turn'] });
    });
});
