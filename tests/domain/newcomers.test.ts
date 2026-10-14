// What the story showed about new faces (docs/model.md §10.2 «Эскиз по истории»): the word heuristics of economy mode,
// the turn pass's newcomers as facts, how facts merge and are kept, the world's groups, and the provenance rules of
// what the generator invents. Synthetic fixtures only.
import { describe, expect, it } from 'vitest';
import { PLAYER_ID } from '../../src/domain/model';
import type { AppetiteRule, NewcomerFacts } from '../../src/domain/model';
import {
    FACTS_CAP,
    factsFor,
    factsFromTurn,
    factsOf,
    familyWorld,
    heuristicFacts,
    isInvented,
    isProvisional,
    mergeFacts,
    recordFacts,
    relationGroups,
    storyRelation,
    worldGroups,
} from '../../src/domain/newcomers';
import { setMeta } from '../../src/domain/profile-defaults';
import { chat, profile } from './cast-fixtures';

function rule(patch: Partial<AppetiteRule> = {}): AppetiteRule {
    return {
        id: 'r',
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

describe('word heuristics (economy, no turn pass)', () => {
    it('reads kinship toward the player in Russian: «твоя сестра», the player’s name as the owner', () => {
        expect(heuristicFacts('Лиза', ['Это Лиза, твоя сестра.'])).toMatchObject({
            name: 'Лиза',
            relation: 'family',
            role: 'сестра',
            relationNote: 'твоя сестра',
            source: 'heuristic',
        });
        expect(
            heuristicFacts('Вера', ['В дверь заглянула Вера, дочь Курьера.'], { playerName: 'Курьер' }),
        ).toMatchObject({ relation: 'family', relationNote: 'дочь Курьера' });
        // An inflected form of the name counts.
        expect(heuristicFacts('Лиза', ['Ты обнимаешь Лизу, свою сестру.'])?.role).toBe('сестра');
    });

    it('reads partners, servants and masters in English and Russian', () => {
        expect(heuristicFacts('Anna', ['My maid Anna brings the tea.'], { lang: 'en' })).toMatchObject({
            relation: 'servant',
            role: 'maid',
            relationNote: 'My maid',
        });
        expect(heuristicFacts('Ольга', ['Ольга, твоя жена, молчит.'])).toMatchObject({ relation: 'partner' });
        expect(heuristicFacts('Ирма', ['Ирма, твоя хозяйка, зовёт тебя.'])).toMatchObject({ relation: 'master' });
        expect(heuristicFacts('Tom', ['Tom, your brother, laughs.'], { lang: 'en' })).toMatchObject({
            relation: 'family',
            role: 'brother',
        });
    });

    it('keeps someone else’s kin as words only — unless the world makes kin the household', () => {
        const text = ['Лиза, дочь Джона, стоит у окна.'];
        expect(heuristicFacts('Лиза', text)).toMatchObject({
            relation: 'unknown',
            role: 'дочь',
            relationNote: 'дочь Джона',
        });
        // A family scenario: the card's rules name the family as a class.
        expect(heuristicFacts('Лиза', text, { groups: ['family members'] })).toMatchObject({
            relation: 'family',
            relationNote: 'дочь Джона',
        });
        expect(heuristicFacts('Lisa', ["Lisa, John's daughter, waves."], { lang: 'en' })).toMatchObject({
            relation: 'unknown',
            relationNote: "John's daughter",
        });
    });

    it('does not take a word the name owns for the face itself', () => {
        expect(heuristicFacts('Лиза', ['Мама Лизы ушла на рынок.'])).toBeNull();
        expect(heuristicFacts('Lisa', ["Lisa's mother waved."], { lang: 'en' })).toBeNull();
        expect(heuristicFacts('Лиза', ['Лиза молча режет хлеб.'])).toBeNull();
        expect(heuristicFacts('', ['твоя сестра'])).toBeNull();
    });
});

describe('facts from the turn pass', () => {
    it('checks relations, clamps stance hints, resolves names and keeps only the listed groups', () => {
        const facts = factsFromTurn(
            [
                {
                    name: 'Лиза',
                    role: 'daughter',
                    species: '',
                    relation: 'family',
                    relationNote: 'дочь Джона',
                    stanceHint: 7,
                    reason: 'lives in the house',
                    groups: ['Family Members', 'pirates'],
                },
                {
                    name: 'Грох',
                    role: 'raider',
                    species: 'orc',
                    relation: 'bogus',
                    relationNote: '',
                    stanceHint: null,
                    reason: '',
                    groups: [],
                },
                {
                    name: '',
                    role: '',
                    species: '',
                    relation: 'friend',
                    relationNote: '',
                    stanceHint: 1,
                    reason: '',
                    groups: [],
                },
            ],
            4,
            (name) => (name === 'Лиза' ? 'liza' : null),
            ['family members'],
        );
        expect(facts).toEqual([
            {
                name: 'Лиза',
                id: 'liza',
                relation: 'family',
                source: 'turn',
                turn: 4,
                role: 'daughter',
                relationNote: 'дочь Джона',
                stanceHint: 3,
                reason: 'lives in the house',
                groups: ['family members'],
            },
            { name: 'Грох', relation: 'unknown', source: 'turn', turn: 4, role: 'raider', species: 'orc' },
        ]);
    });

    it('merges newer facts over older ones, never a guess over what the pass read', () => {
        const read: NewcomerFacts = {
            name: 'Лиза',
            relation: 'family',
            relationNote: 'дочь Джона',
            stanceHint: 1,
            groups: ['family members'],
            source: 'turn',
            turn: 2,
        };
        const guess: NewcomerFacts = {
            name: 'Лиза',
            relation: 'servant',
            role: 'служанка',
            source: 'heuristic',
            turn: 3,
        };
        expect(mergeFacts(read, guess)).toMatchObject({
            relation: 'family',
            relationNote: 'дочь Джона',
            stanceHint: 1,
            role: 'служанка',
            source: 'turn',
            turn: 3,
        });
        const later: NewcomerFacts = { name: 'Лиза', relation: 'enemy', groups: ['rebels'], source: 'turn', turn: 5 };
        expect(mergeFacts(read, later)).toMatchObject({ relation: 'enemy', groups: ['family members', 'rebels'] });
        expect(mergeFacts(read, later).stanceHint).toBeUndefined();
        // Unknown says nothing new about the relation.
        expect(mergeFacts(read, { name: 'Лиза', relation: 'unknown', source: 'turn', turn: 6 }).relation).toBe(
            'family',
        );
    });

    it('keeps the facts in the chat, one entry per face, capped', () => {
        const state = chat();
        expect(factsOf(state)).toEqual([]);
        recordFacts(state, [{ name: 'Лиза', relation: 'family', source: 'turn', turn: 1 }]);
        recordFacts(state, [{ name: 'Лизу', relation: 'unknown', species: 'human', source: 'turn', turn: 2 }]);
        expect(factsOf(state)).toHaveLength(1);
        expect(factsFor(factsOf(state), { name: 'Лиза' })).toMatchObject({ relation: 'family', species: 'human' });
        expect(factsFor(factsOf(state), { id: 'x', name: 'Кира' })).toBeUndefined();
        for (let i = 0; i < FACTS_CAP + 5; i++) {
            recordFacts(state, [{ name: `Face${i}`, relation: 'stranger', source: 'turn', turn: 3 }]);
        }
        expect(factsOf(state)).toHaveLength(FACTS_CAP);
        expect(state.generator?.dismissed).toEqual([]);
    });
});

describe('the world’s groups and relations', () => {
    it('lists rule holders, classes, reputation groups and group profiles once', () => {
        const groups = worldGroups(
            [rule(), rule({ id: 'b', holders: 'Beasts', target: { mode: 'class', class: 'humans' } })],
            [{ among: '*' }, { among: 'All family members' }, { among: 'family members' }],
            [
                { kind: 'group', name: 'Стража' },
                { kind: 'character', name: 'Ильва' },
            ],
        );
        expect(groups).toEqual(['family members', 'Beasts', 'humans', 'All family members', 'Стража']);
    });

    it('maps a relation onto the world’s classes', () => {
        const world = ['family members', 'Все члены семьи', 'slaves', 'Beasts'];
        expect(relationGroups('family', world)).toEqual(['family members', 'Все члены семьи']);
        expect(relationGroups('servant', world)).toEqual(['slaves']);
        expect(relationGroups('stranger', world)).toEqual([]);
        expect(familyWorld(world)).toBe(true);
        expect(familyWorld(['Beasts'])).toBe(false);
        expect(storyRelation('family')).toBe(true);
        expect(storyRelation('stranger')).toBe(false);
        expect(storyRelation('unknown')).toBe(false);
    });
});

describe('provenance of invented fields', () => {
    it('tells guesses (dice, templates, defaults) from what a model wrote or the author gave', () => {
        let face = profile('f', 'F', { lod: 'draft' });
        face = setMeta(face, 'core.values', { origin: 'generated', sources: ['dice'] });
        face = setMeta(face, 'core.want', { origin: 'generated', sources: ['template'] });
        face = setMeta(face, 'core.need', { origin: 'generated', sources: ['grounded'] });
        face = setMeta(face, 'core.concept', { origin: 'generated' });
        face = setMeta(face, 'core.keys', { origin: 'author' });
        face = setMeta(face, 'core.tactics', { origin: 'generated', sources: ['dice'], locked: true });
        expect(isProvisional(face, 'core.values')).toBe(true);
        expect(isProvisional(face, 'core.want')).toBe(true);
        expect(isProvisional(face, 'core.need')).toBe(false);
        expect(isProvisional(face, 'core.concept')).toBe(false);
        expect(isProvisional(face, 'core.concept', true)).toBe(true);
        expect(isProvisional(face, 'core.keys', true)).toBe(false);
        expect(isProvisional(face, 'core.tactics')).toBe(false);
        expect(isProvisional(face, 'core.signatures')).toBe(false);
        // An older sketch's draw had no sources: on a sketch every generated field is a guess.
        expect(isProvisional({ ...face, lod: 'sketch' }, 'core.concept')).toBe(true);
        expect(isInvented(face, 'core.concept')).toBe(true);
        expect(isInvented(face, 'core.keys')).toBe(false);
        expect(isInvented(face, 'core.tactics')).toBe(false);
        expect(isInvented(face, `ties.${PLAYER_ID}`)).toBe(false);
        expect(isInvented(undefined, 'core.values')).toBe(false);
    });
});
