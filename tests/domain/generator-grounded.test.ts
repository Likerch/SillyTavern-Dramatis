// Gap fills of authored characters (docs/model.md §10.1): no dice — the card's own text, only the gaps asked for, the
// core read from the sources; the reading's inferred fields stay; one craving is never added twice.
import { describe, expect, it } from 'vitest';
import {
    GROUNDED_BUDGET,
    GROUNDED_SYSTEM_PROMPT,
    applyGenerated,
    emptyCandidate,
    groundedFields,
    groundedMessages,
    groundedPaths,
    groundedSchema,
    groundedSources,
    isAuthored,
    missingFields,
    parseCandidates,
} from '../../src/domain/generator';
import type { GenCandidate } from '../../src/domain/generator';
import { PLAYER_ID } from '../../src/domain/model';
import type { CharacterProfile } from '../../src/domain/model';
import { setMeta } from '../../src/domain/profile-defaults';
import { profile, tie } from './cast-fixtures';
import { GUARDIAN_CARD } from './guardian-fixtures';

/** What the reading left of the guardian: her concept and bond (inferred), her wound (quoted), gaps in the core. */
function readGuardian(): CharacterProfile {
    let mirelle = profile('mirelle-varrow', 'Mirelle Varrow', {
        lod: 'portrait',
        aliases: ['Mirelle'],
        ties: [tie(PLAYER_ID, 3, { intent: 'protect', behaviour: 'gentle with Kai, merciless to his enemies' })],
    });
    mirelle = {
        ...mirelle,
        core: {
            ...mirelle.core,
            concept: 'An ancient sorceress who gave up her hunger for power to raise the child she adopted',
            wound: { ghost: 'centuries spent alone', lie: 'power is all there is', triggers: [], coping: 'avoid' },
        },
    };
    mirelle = setMeta(mirelle, 'core.concept', { origin: 'inferred' });
    mirelle = setMeta(mirelle, 'core.wound', {
        origin: 'author',
        evidence: ['regrets only that the hunger left her alone'],
    });
    return setMeta(mirelle, `ties.${PLAYER_ID}`, { origin: 'inferred' });
}

function grounded(patch: Partial<GenCandidate> = {}): GenCandidate {
    return {
        ...emptyCandidate(),
        concept: 'A cult leader who burned her temple',
        values: ['benevolence', 'security', 'power'],
        sacrifice: 'universalism',
        temperament: { emotionality: 2, agreeableness: -1 },
        drives: { high: ['family', 'power'], low: ['status', 'family'] },
        tactics: ['intimidation', 'silence'],
        proactivity: 6,
        moodOctant: 'relaxed',
        moodLabel: 'calm and motherly',
        signatures: ['if Kai is threatened → turns merciless'],
        keys: ['Kai learning what she did'],
        secrets: ['hides her past from Kai'],
        dream: 'a quiet life for Kai',
        leverage: ['her grimoire'],
        ifIgnored: 'moves deeper into the marsh',
        appetites: [
            {
                kind: 'thrill',
                label: 'teaching caution',
                baseline: 3,
                target: 'thing',
                targetClass: '',
                triggers: [],
                excuse: '',
            },
        ],
        summary: 'From the card',
        ...patch,
    };
}

describe('authored characters', () => {
    it('are the ones the reading knows or the card’s text names', () => {
        expect(isAuthored(readGuardian())).toBe(true);
        const bare = profile('mirelle-varrow', 'Mirelle Varrow');
        expect(isAuthored(bare)).toBe(false);
        expect(isAuthored(bare, 'Mirelle Varrow is an elven sorceress.')).toBe(true);
        expect(isAuthored(profile('fenn', 'Фенн'), 'Mirelle Varrow is an elven sorceress.')).toBe(false);
        expect(isAuthored(setMeta(bare, 'core.values', { origin: 'generated' }))).toBe(false);
    });

    it('get the gaps of the core, the unset mood and initiative, and a portrait’s secrets and intentions', () => {
        const paths = groundedPaths(readGuardian());
        expect(paths).toEqual(
            expect.arrayContaining([
                'core.values',
                'core.temperament',
                'core.drives',
                'core.tactics',
                'core.keys',
                'core.proactivity',
                'core.baselineMood',
                'agenda.secrets',
                'agenda.intentions',
            ]),
        );
        expect(paths).not.toContain('core.concept');
        expect(paths).not.toContain('core.wound');
        expect(paths).not.toContain(`ties.${PLAYER_ID}`);
        expect(paths.some((path) => path.startsWith('appetites'))).toBe(false);
        expect(groundedPaths(readGuardian(), 'draft')).not.toContain('agenda.secrets');
        expect(groundedFields(paths)).toEqual(
            expect.arrayContaining([
                'values',
                'sacrifice',
                'temperament',
                'drivesHigh',
                'drivesLow',
                'tactics',
                'proactivity',
                'moodOctant',
                'secrets',
            ]),
        );
        expect(groundedFields(['core.concept'])).toEqual(['concept']);
    });
});

describe('groundedSources', () => {
    const book = [
        {
            uid: 1,
            keys: ['Mirelle', 'witch'],
            comment: 'The witch of the marsh',
            content: 'Mirelle keeps a grimoire bound in bone.',
        },
        { uid: 2, keys: ['Velmar'], comment: 'The kingdom', content: 'Velmar is ruled by a boy king.' },
    ];

    it('gives the card’s own text about them: description, opening scene, creator’s notes, the lore that names them', () => {
        const text = groundedSources(GUARDIAN_CARD, book, ['Mirelle Varrow', 'Mirelle'], 0);
        expect(text).toContain('[Card description]\nMirelle Varrow is an elven sorceress');
        expect(text).toContain('[Opening scene]\nMorning light fills the cottage');
        expect(text).toContain("[Creator's notes]\nYour adoptive elven mother");
        expect(text).toContain('[Lorebook · The witch of the marsh]\nMirelle keeps a grimoire bound in bone.');
        expect(text).not.toContain('boy king');
        expect(text).not.toContain('[Scenario]');
        expect(text).not.toContain('[Card personality]');
    });

    it('takes the greeting the chat opened with and stays within the budget', () => {
        const card = { ...GUARDIAN_CARD, alternateGreetings: ['Night. Mirelle stands over the cradle.'] };
        expect(groundedSources(card, [], ['Mirelle'], 1)).toContain('[Opening scene]\nNight. Mirelle stands');
        expect(groundedSources(card, [], ['Mirelle'], 7)).toContain('[Opening scene]\nMorning light');
        const long = { ...GUARDIAN_CARD, description: 'word '.repeat(20000) };
        const text = groundedSources(long, [], ['Mirelle']);
        expect(text.length).toBeLessThan(GROUNDED_BUDGET.total + 400);
        expect(text).toContain('…');
    });
});

describe('groundedMessages and groundedSchema', () => {
    const subject = { name: 'Mirelle Varrow', profile: readGuardian(), missing: groundedPaths(readGuardian()) };
    const fields = groundedFields(subject.missing);
    const [system, user] = groundedMessages(
        subject,
        {
            worldTone: 'indifferent',
            playerName: 'Kai',
            sources: groundedSources(GUARDIAN_CARD, [], ['Mirelle Varrow']),
            said: ['Mirelle hums over the stove.'],
        },
        fields,
    );

    it('writes from the card, never around dice, and never past its backstory', () => {
        expect(system).toEqual({ role: 'system', content: GROUNDED_SYSTEM_PROMPT });
        expect(GROUNDED_SYSTEM_PROMPT).toContain('Derive every field from <sources>');
        expect(GROUNDED_SYSTEM_PROMPT).toContain('Never contradict, replace or add to their backstory');
        expect(GROUNDED_SYSTEM_PROMPT).toContain("Keep the author's intensity");
        expect(GROUNDED_SYSTEM_PROMPT).not.toContain('Dice');
        const content = user!.content;
        expect(content).toContain('<sources>\n[Card description]\nMirelle Varrow is an elven sorceress');
        expect(content).not.toContain('<params>');
        expect(content).toContain('Concept: An ancient sorceress');
        expect(content).toContain("Stance toward the player's character: ");
        expect(content).toContain('fill ONLY these empty fields of the character: ');
        expect(content).toContain('- drivesHigh: 2–4 drives the author stresses');
        expect(content).toContain('<said>\n- Mirelle hums over the stove.\n</said>');
    });

    it('asks only for the gaps, with the summary and the two ratings', () => {
        const schema = groundedSchema(['values', 'drivesHigh', 'drivesLow']);
        const candidate = (
            schema.schema.properties as Record<string, { items: { properties: object; required: string[] } }>
        ).candidates!.items;
        expect(Object.keys(candidate.properties)).toEqual([
            'values',
            'drivesHigh',
            'drivesLow',
            'summary',
            'fit',
            'typicality',
        ]);
        expect(candidate.required).toEqual(Object.keys(candidate.properties));
    });

    it('reads the core of a grounded answer', () => {
        const [read] = parseCandidates({
            candidates: [
                {
                    values: ['benevolence', 'nonsense', 'power'],
                    sacrifice: 'universalism',
                    temperament: { emotionality: 2, honesty: 9, openness: 0 },
                    drivesHigh: ['family', 'power'],
                    drivesLow: ['family', 'status'],
                    tactics: ['silence'],
                    proactivity: 6,
                    moodOctant: 'relaxed',
                    summary: 's',
                    fit: 5,
                    typicality: 2,
                },
            ],
        });
        expect(read).toMatchObject({
            values: ['benevolence', 'power'],
            sacrifice: 'universalism',
            temperament: { emotionality: 2, honesty: 2 },
            drives: { high: ['family', 'power'], low: ['status'] },
            tactics: ['silence'],
            proactivity: 6,
            moodOctant: 'relaxed',
        });
    });
});

describe('applyGenerated — a grounded fill', () => {
    it('writes the core from the card’s answer, only the paths asked, never the reading’s fields', () => {
        const start = readGuardian();
        const only = groundedPaths(start);
        const { profile: after, written } = applyGenerated(start, grounded(), {
            lod: start.lod,
            origin: 'generated',
            kind: 'fill',
            only,
        });
        expect(after.core.values).toEqual({ top: ['benevolence', 'security', 'power'], sacrifice: 'universalism' });
        expect(after.core.drives).toEqual({ high: ['family', 'power'], low: ['status'] });
        expect(after.core.temperament).toEqual({ emotionality: 2, agreeableness: -1 });
        expect(after.core.tactics).toEqual(['intimidation', 'silence']);
        expect(after.core.proactivity).toBe(6);
        expect(after.core.baselineMood).toEqual({ octant: 'relaxed', label: 'calm and motherly' });
        expect(after.agenda.secrets).toEqual(['hides her past from Kai']);
        expect(after.meta['core.drives']).toEqual({ origin: 'generated' });
        // The reading's concept and bond stay; what was not asked is not written.
        expect(after.core.concept).toBe(start.core.concept);
        expect(after.ties).toEqual(start.ties);
        expect(after.agenda.dream).toBe('a quiet life for Kai');
        expect(after.agenda.leverage).toEqual([]);
        expect(after.agenda.ifIgnored).toBeUndefined();
        expect(after.appetites).toEqual([]);
        expect(written).not.toContain('agenda.leverage');
        expect(written).not.toContain('core.concept');
    });

    it('lets a dice fill write only its gaps and the drawn core too', () => {
        const fenn = profile('fenn', 'Фенн', { lod: 'draft' });
        const only = [...missingFields(fenn), 'core.proactivity', 'core.commitment', 'core.baselineMood'];
        const { profile: after } = applyGenerated(fenn, grounded({ values: undefined, drives: undefined }), {
            lod: 'draft',
            origin: 'generated',
            kind: 'fill',
            only,
        });
        expect(after.agenda.secrets).toEqual([]);
        expect(after.agenda.leverage).toEqual([]);
        expect(after.agenda.ifIgnored).toBeUndefined();
        expect(after.appetites).toEqual([]);
        expect(after.core.keys).toEqual(['Kai learning what she did']);
    });

    it('never adds one craving twice, under the same kind or another', () => {
        const base = profile('x', 'Икс');
        const twins = grounded({
            appetites: [
                {
                    kind: 'thrill',
                    label: 'teaching caution',
                    baseline: 3,
                    target: 'thing',
                    targetClass: '',
                    triggers: [],
                    excuse: '',
                },
                {
                    kind: 'other',
                    label: 'Teaching caution',
                    baseline: 3,
                    target: 'thing',
                    targetClass: '',
                    triggers: [],
                    excuse: '',
                },
                {
                    kind: 'thrill',
                    label: 'the hunt',
                    baseline: 2,
                    target: 'thing',
                    targetClass: '',
                    triggers: [],
                    excuse: '',
                },
            ],
        });
        const after = applyGenerated(base, twins, { lod: 'portrait', origin: 'generated' }).profile;
        expect(after.appetites.map((item) => `${item.kind}:${item.label}`)).toEqual(['thrill:teaching caution']);
    });
});
