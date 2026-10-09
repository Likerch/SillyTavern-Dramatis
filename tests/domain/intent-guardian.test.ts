// The reading of an authored, devoted character (tests/domain/guardian-fixtures.ts): nothing the reading found is lost
// for want of a quote, the bond to the player keeps its full strength, names and paths come out right, a full re-read
// replaces what the generator invented, and the open chat follows.
import { describe, expect, it } from 'vitest';
import {
    aimedAtTarget,
    applyIntent,
    canonicalPath,
    canonicalPaths,
    dedupeAppetites,
    firstNameAlias,
    hostileSignal,
    quoteFound,
    warmSignal,
} from '../../src/domain/intent-apply';
import type { ApplyOptions } from '../../src/domain/intent-apply';
import { clearGenerated, refreshLiveState } from '../../src/domain/intent-reread';
import { intentFingerprint, intentSources } from '../../src/domain/intent-prompt';
import { PLAYER_ID } from '../../src/domain/model';
import type { CardProfiles, CharacterProfile } from '../../src/domain/model';
import { emptyCardProfiles, emptyTie, normalizeProfile, setMeta } from '../../src/domain/profile-defaults';
import { liveState } from './cast-fixtures';
import { GUARDIAN_CARD, guardianAnswer, guardianWithTwins } from './guardian-fixtures';
import { answer, appetiteAnswer, characterAnswer, coreAnswer, ev, tieAnswer } from './intent-fixtures';

const SOURCES = intentSources(GUARDIAN_CARD);

function options(patch: Partial<ApplyOptions> = {}): ApplyOptions {
    return {
        fidelity: 'strict',
        now: 1000,
        sourcesHash: intentFingerprint(SOURCES),
        sources: SOURCES,
        personaName: 'Kai',
        cardName: GUARDIAN_CARD.name,
        ...patch,
    };
}

function mirelleOf(card: CardProfiles): CharacterProfile {
    const found = card.characters.find((item) => item.id === 'mirelle-varrow');
    if (!found) throw new Error(card.characters.map((item) => item.id).join(', '));
    return found;
}

describe('reading an adoptive guardian devoted to the player', () => {
    const { profiles, warnings } = applyIntent(emptyCardProfiles('guardian.png'), guardianAnswer(), options());
    const mirelle = mirelleOf(profiles);
    const toPlayer = mirelle.ties.find((item) => item.target === PLAYER_ID)!;

    it('keeps every field the reading filled: quoted ones as the author’s, the rest as inferred', () => {
        expect(mirelle.lod).toBe('portrait');
        expect(mirelle.core.concept).toMatch(/^An ancient sorceress/);
        expect(mirelle.meta['core.concept']).toEqual({ origin: 'inferred' });
        expect(mirelle.core.want).toBe('Wants Kai to grow up safe, far from her past');
        expect(mirelle.meta['core.want']).toEqual({ origin: 'inferred' });
        expect(mirelle.agenda.secrets).toEqual(['Hides her past of razing cities from Kai']);
        expect(mirelle.meta['agenda.secrets']).toEqual({ origin: 'inferred' });
        // One quote backs two fields.
        expect(mirelle.core.values.top).toEqual(['benevolence', 'security', 'power']);
        expect(mirelle.meta['core.values']).toMatchObject({ origin: 'author', sources: ['card.description'] });
        expect(mirelle.meta['core.drives']).toMatchObject({ origin: 'author' });
        expect(mirelle.core.drives).toEqual({ high: ['family', 'power'], low: ['status'] });
        expect(warnings).toContainEqual({ code: 'inferred', name: 'Mirelle Varrow', detail: expect.any(String) });
        expect(warnings.some((item) => item.code === 'quote-unverified')).toBe(false);
    });

    it('matches the evidence paths of the ties: a sub-field, an index', () => {
        expect(mirelle.meta[`ties.${PLAYER_ID}`]).toMatchObject({
            origin: 'author',
            evidence: ['she would burn the world for him'],
        });
        expect(mirelle.meta['ties.everyone else']).toMatchObject({
            origin: 'author',
            evidence: ['To everyone else she is cold and dangerous'],
        });
        expect(mirelle.meta.starts).toMatchObject({ origin: 'author' });
    });

    it('keeps the bond at full strength: +3, the floor, what she would do, what she accepts', () => {
        expect(toPlayer.stance).toBe(3);
        expect(toPlayer.intent).toBe('protect');
        expect(toPlayer.behaviour).toBe('gentle and motherly with Kai; merciless to anyone who threatens him');
        expect(toPlayer.reasons.map((item) => item.text)).toEqual([
            'adopted Kai as a baby and raised him as her own',
            'would burn the world for him',
        ]);
        expect(warnings.some((item) => item.code === 'stance-capped')).toBe(false);
        expect(warnings.some((item) => item.code === 'stranger-stance')).toBe(false);
        expect(mirelle.core.stanceBounds).toEqual([{ target: PLAYER_ID, min: 3 }]);
        expect(mirelle.core.redLines).toEqual({
            never: ['never lets harm come to Kai'],
            would: ['kills anyone who threatens Kai'],
        });
        expect(mirelle.meta['core.redLines']).toMatchObject({ origin: 'author' });
        expect(mirelle.core.keys).toEqual(['accepts that Kai may leave or hate her one day, and loves him anyway']);
        expect(mirelle.core.signatures).toEqual([
            'if Kai is threatened → turns utterly merciless and destroys the threat',
        ]);
        expect(mirelle.core.anchors).toEqual([PLAYER_ID]);
        expect(mirelle.ties.find((item) => item.target === 'everyone else')!.stance).toBe(-2);
    });

    it('names her the ways the story will: English, the first name the sources use, the Russian forms', () => {
        expect(mirelle.name).toBe('Mirelle Varrow');
        expect(mirelle.english).toBe('Mirelle Varrow');
        expect(mirelle.aliases).toEqual(['Мирель Варроу', 'Мирель', 'Mirelle']);
        expect(firstNameAlias('Mirelle Varrow', SOURCES)).toBe('Mirelle');
        expect(firstNameAlias('Mirelle Varrow', [{ text: 'Mirelle Varrow waits.' }])).toBeNull();
        expect(firstNameAlias('Kai', SOURCES)).toBeNull();
        expect(firstNameAlias('Lady Mirelle', [{ text: 'Lady Mirelle bows. The Lady smiles.' }])).toBeNull();
    });

    it('sets the author’s floor in strict fidelity when the model left the bounds out but quoted the devotion', () => {
        const reading = guardianAnswer() as { characters: Record<string, unknown>[] };
        const quiet = {
            ...reading.characters[0]!,
            core: coreAnswer({ bounds: [] }),
            evidence: [ev('ties.PLAYER', 'She adopted Kai when he was a baby', 'S1')],
        };
        const strict = applyIntent(emptyCardProfiles('g'), answer({ characters: [quiet] }), options()).profiles;
        expect(mirelleOf(strict).core.stanceBounds).toEqual([{ target: PLAYER_ID, min: 2 }]);
        const balanced = applyIntent(
            emptyCardProfiles('g'),
            answer({ characters: [quiet] }),
            options({ fidelity: 'balanced' }),
        ).profiles;
        expect(mirelleOf(balanced).core.stanceBounds).toEqual([]);
    });

    it('still caps a softened stance when the author’s lines are hostile to the player', () => {
        const cold = characterAnswer('Mirelle Varrow', {
            ties: [tieAnswer('PLAYER', 2, { reasons: ['she cares for him'] })],
            evidence: [ev('ties.PLAYER', 'To everyone else she is cold and dangerous', 'S1')],
        });
        // Hostility toward «everyone else» is not hostility toward him.
        const fine = applyIntent(emptyCardProfiles('g'), answer({ characters: [cold] }), options()).profiles;
        expect(mirelleOf(fine).ties[0]!.stance).toBe(2);
        const hostile = characterAnswer('Mirelle Varrow', {
            ties: [tieAnswer('Kai', 1, { reasons: ['she tolerates him'] })],
            evidence: [ev('ties.Kai', 'Wake up, little one', 'S2')],
            core: coreAnswer(),
        });
        const reading = answer({ characters: [hostile] }) as { characters: Record<string, unknown>[] };
        (reading.characters[0]!.ties as Record<string, unknown>[])[0]!.behaviour = 'despises Kai and mocks him';
        const capped = applyIntent(emptyCardProfiles('g'), reading, options());
        expect(mirelleOf(capped.profiles).ties[0]!.stance).toBe(-1);
        expect(capped.warnings.map((item) => item.code)).toContain('stance-capped');
    });

    it('lets no stranger rule override a bond the reading made close', () => {
        const reading = guardianAnswer() as { characters: Record<string, unknown>[] };
        const noQuotes = {
            ...reading.characters[0]!,
            ties: [
                tieAnswer('PLAYER', 3, { reasons: ['raised him as her own'] }),
                tieAnswer('strangers', -2, { reasons: ['distrusts outsiders'] }),
            ],
            evidence: [ev('ties.strangers', 'To everyone else she is cold and dangerous', 'S1')],
        };
        const { profiles: read, warnings: notes } = applyIntent(
            emptyCardProfiles('g'),
            answer({ characters: [noQuotes] }),
            options(),
        );
        expect(mirelleOf(read).ties.find((item) => item.target === PLAYER_ID)!.stance).toBe(3);
        expect(notes.some((item) => item.code === 'stranger-stance')).toBe(false);
    });
});

describe('evidence paths and quotes', () => {
    const resolve = (target: string) =>
        ['PLAYER', 'Kai', '{{user}}', 'Тарена'].includes(target) ? PLAYER_ID : target.toLowerCase();
    const entries = {
        appetites: [
            { kind: 'drink' as const, label: 'брага' },
            { kind: 'flesh' as const, label: 'blood' },
        ],
        ties: ['PLAYER', 'Sota'],
    };

    it('maps a tie path with a sub-field, an index, a bare player name, an appetite label', () => {
        expect(canonicalPath('ties.PLAYER.stance', resolve, entries)).toBe(`ties.${PLAYER_ID}`);
        expect(canonicalPath('ties.PLAYER.changeIf', resolve, entries)).toBe(`ties.${PLAYER_ID}`);
        expect(canonicalPath('ties[1]', resolve, entries)).toBe('ties.sota');
        expect(canonicalPath('ties[0].reasons', resolve, entries)).toBe(`ties.${PLAYER_ID}`);
        expect(canonicalPath('characters[0].ties.Kai', resolve, entries)).toBe(`ties.${PLAYER_ID}`);
        expect(canonicalPath('PLAYER', resolve, entries)).toBe(`ties.${PLAYER_ID}`);
        expect(canonicalPath('appetites.брага', resolve, entries)).toBe('appetites.drink');
        expect(canonicalPath('appetites.1.baseline', resolve, entries)).toBe('appetites.flesh');
        expect(canonicalPath('russian', resolve, entries)).toBe('russian');
        // The old signature (kinds only) still works.
        expect(canonicalPath('appetites.0', resolve, ['drink'])).toBe('appetites.drink');
    });

    it('splits a path that lists several fields', () => {
        expect(canonicalPaths('core.values, core.drives', resolve, entries)).toEqual(['core.values', 'core.drives']);
        expect(canonicalPaths('core.values and agenda.goals; ties.PLAYER', resolve, entries)).toEqual([
            'core.values',
            'agenda.goals',
            `ties.${PLAYER_ID}`,
        ]);
        expect(canonicalPaths('core.wound | core.wound', resolve, entries)).toEqual(['core.wound']);
        expect(canonicalPaths('nothing here', resolve, entries)).toEqual([]);
    });

    it('resolves the player by the persona name in any case form and with a parenthesis', () => {
        const reading = answer({
            characters: [
                characterAnswer('Мирель', {
                    ties: [tieAnswer('PLAYER (Тарен)', 3, { reasons: ['растит его с младенчества'] })],
                    evidence: [ev('ties.Тарена', 'любит Тарена как родного', 'S1')],
                }),
            ],
        });
        const card = {
            ...GUARDIAN_CARD,
            name: 'Мирель',
            description: 'Мирель любит Тарена как родного сына.',
            persona: { name: 'Тарен', description: '' },
        };
        const sources = intentSources(card);
        const { profiles } = applyIntent(emptyCardProfiles('n'), reading, {
            ...options(),
            sources,
            personaName: 'Тарен',
            cardName: 'Мирель',
        });
        const mirel = profiles.characters[0]!;
        expect(mirel.ties.map((item) => item.target)).toEqual([PLAYER_ID]);
        expect(mirel.meta[`ties.${PLAYER_ID}`]).toMatchObject({
            origin: 'author',
            evidence: ['любит Тарена как родного'],
        });
    });

    it('finds a quote written with the macros in sources that carry the names', () => {
        const text = 'Whenever Kai is threatened she becomes her old self again';
        expect(quoteFound('Whenever {{user}} is threatened', text, [], { user: 'Kai' })).toBe(true);
        expect(quoteFound('{{char}} smiles', 'Mirelle Varrow smiles at dawn', [], { char: 'Mirelle Varrow' })).toBe(
            true,
        );
        expect(quoteFound('{{char}} smiles', 'Mirelle Varrow smiles at dawn')).toBe(false);
    });
});

describe('hostility aimed elsewhere and devotion', () => {
    it('drops hostility toward third parties or toward a danger to the target', () => {
        const kept = [
            'would kill anyone who threatens Kai',
            'merciless to anyone who threatens him',
            'becomes ruthless and amoral when Kai is threatened',
            'Whenever Kai is threatened, she turns merciless',
            'would burn the world for Kai',
            'cold and dangerous to everyone else',
            'убьёт любого, кто угрожает Каю',
            'когда Каю угрожает опасность, становится безжалостной',
            'уничтожит весь мир ради Кая',
            'холодна ко всем остальным',
        ];
        for (const text of kept) expect(hostileSignal([aimedAtTarget(text)]), text).toBe(false);
        for (const text of [
            'despises Kai',
            'Кая она презирает',
            'mocks him at every turn',
            'would kill Kai for a coin',
            'убьёт Тарена ради выгоды',
            'would kill Kai if he ever betrayed her',
        ]) {
            expect(hostileSignal([aimedAtTarget(text)]), text).toBe(true);
        }
    });

    it('hears love, devotion and parenthood, not their negation', () => {
        expect(warmSignal(['she loves him as her adoptive child'])).toBe(true);
        expect(warmSignal(['любит его как родного', 'приёмная мать'])).toBe(true);
        expect(warmSignal(['she does not love him'])).toBe(false);
        expect(warmSignal(['он её не любит'])).toBe(false);
        expect(warmSignal(['вернётся к прежней себе'])).toBe(false);
    });
});

describe('appetites read once per craving', () => {
    it('drops a twin under another kind and a second entry of one kind', () => {
        expect(
            dedupeAppetites([
                { kind: 'thrill' as const, label: 'teaching caution' },
                { kind: 'other' as const, label: 'Teaching caution' },
                { kind: 'thrill' as const, label: 'danger' },
                { kind: 'drink' as const, label: '' },
            ]),
        ).toEqual([
            { kind: 'thrill', label: 'teaching caution' },
            { kind: 'drink', label: '' },
        ]);
        const { profiles } = applyIntent(emptyCardProfiles('g'), guardianWithTwins(), options());
        expect(mirelleOf(profiles).appetites.map((item) => `${item.kind}:${item.label}`)).toEqual([
            'thrill:teaching caution',
        ]);
    });

    it('never adds a twin of an appetite the profile already holds', () => {
        const first = applyIntent(emptyCardProfiles('g'), guardianWithTwins(), options()).profiles;
        const twin = guardianAnswer() as { characters: Record<string, unknown>[] };
        // The same craving under another kind («other: Teaching caution»).
        const other = {
            ...twin.characters[0]!,
            appetites: [appetiteAnswer('other', { label: 'Teaching caution', baseline: 3 })],
        };
        const again = applyIntent(first, answer({ characters: [other] }), options()).profiles;
        expect(mirelleOf(again).appetites.map((item) => item.kind)).toEqual(['thrill']);
    });
});

/* ------------------------------------------------------------------ a full re-read */

/** What the old dice fill left on her: an invented concept and agenda, a made-up appetite, the user's drives. */
function filledByDice(): CardProfiles {
    let profile = normalizeProfile({
        id: 'mirelle-varrow',
        name: 'Mirelle Varrow',
        lod: 'portrait',
        core: {
            concept: 'A former cult leader who burned her own temple',
            values: { top: ['power'] },
            drives: { high: ['romance', 'honor'], low: ['power'] },
            tactics: ['bargaining'],
            proactivity: 4,
            keys: ['respects only deeds'],
            want: 'Wants Kai safe',
        },
        agenda: { secrets: ['carries the ashes of a god-child'], dream: 'a world without cults', goals: [] },
        appetites: [{ id: 'other', kind: 'other', label: 'teaching caution', baseline: 3 }],
        ties: [{ ...emptyTie(PLAYER_ID, 2), reasons: [{ id: 'gen-context', text: 'her ward', delta: 2 }] }],
    });
    for (const path of [
        'core.concept',
        'core.tactics',
        'core.proactivity',
        'core.keys',
        'agenda.secrets',
        'agenda.dream',
        'appetites.other',
        `ties.${PLAYER_ID}`,
    ]) {
        profile = setMeta(profile, path, { origin: 'generated' });
    }
    profile = setMeta(profile, 'core.values', { origin: 'author', evidence: ['for power'] });
    profile = setMeta(profile, 'core.want', { origin: 'author' });
    profile = setMeta(profile, 'core.drives', { origin: 'user', locked: true });
    return { ...emptyCardProfiles('guardian.png'), characters: [profile], intent: { at: 1, sourcesHash: 'old' } };
}

describe('a full re-read', () => {
    it('drops what the generator wrote, keeps the author’s and the user’s, and lists what changed', () => {
        const { profiles, diff } = applyIntent(filledByDice(), guardianAnswer(), options({ replaceGenerated: true }));
        const mirelle = mirelleOf(profiles);
        expect(mirelle.core.concept).toMatch(/^An ancient sorceress/);
        expect(mirelle.meta['core.concept']).toEqual({ origin: 'inferred' });
        // Not in the new reading: emptied for a grounded fill, not left invented.
        expect(mirelle.core.tactics).toEqual([]);
        expect(mirelle.meta['core.tactics']).toBeUndefined();
        expect(mirelle.core.proactivity).toBe(5);
        expect(mirelle.agenda.dream).toBeUndefined();
        expect(mirelle.agenda.secrets).toEqual(['Hides her past of razing cities from Kai']);
        expect(mirelle.appetites).toEqual([]);
        expect(mirelle.ties.find((item) => item.target === PLAYER_ID)).toMatchObject({ stance: 3, intent: 'protect' });
        // The author's values are re-read; the user's drives stay, with the reading's offer in the diff.
        expect(mirelle.core.values.top).toEqual(['benevolence', 'security', 'power']);
        expect(mirelle.core.drives).toEqual({ high: ['romance', 'honor'], low: ['power'] });
        expect(diff).toContainEqual(
            expect.objectContaining({
                path: 'core.drives',
                status: 'kept-locked',
                after: { high: ['family', 'power'], low: ['status'] },
            }),
        );
        expect(diff).toContainEqual(
            expect.objectContaining({
                path: 'core.concept',
                status: 'updated',
                before: 'A former cult leader who burned her own temple',
            }),
        );
        expect(diff).toContainEqual(
            expect.objectContaining({ path: 'appetites.other', status: 'updated', after: undefined }),
        );
        expect(diff).toContainEqual(
            expect.objectContaining({ path: 'core.tactics', before: ['bargaining'], after: [] }),
        );
    });

    it('without a full re-read, a generated value the reading does not give stays', () => {
        const { profiles } = applyIntent(filledByDice(), guardianAnswer(), options());
        expect(mirelleOf(profiles).core.tactics).toEqual(['bargaining']);
        expect(mirelleOf(profiles).agenda.dream).toBe('a world without cults');
    });

    it('clears only unlocked generated values, never rule draws or BunnyMo hints', () => {
        let profile = mirelleOf(filledByDice());
        profile = {
            ...profile,
            appetites: [...profile.appetites, { ...profile.appetites[0]!, id: 'flesh', kind: 'flesh', rule: 'r1' }],
        };
        profile = setMeta(profile, 'appetites.flesh', { origin: 'generated' });
        profile = setMeta(profile, 'core.temperament', { origin: 'generated', sources: ['bunnymo'] });
        profile = setMeta(profile, 'core.keys', { origin: 'generated', locked: true });
        const { profile: cleared, cleared: dropped } = clearGenerated(profile);
        expect(cleared.appetites.map((item) => item.id)).toEqual(['flesh']);
        expect(cleared.meta['core.temperament']).toBeDefined();
        expect(cleared.core.keys).toEqual(['respects only deeds']);
        expect([...dropped.keys()].sort()).toEqual(
            [
                'agenda.dream',
                'agenda.secrets',
                'appetites.other',
                'core.concept',
                'core.proactivity',
                'core.tactics',
                `ties.${PLAYER_ID}`,
            ].sort(),
        );
    });

    it('carries the new reading into the live state where the story has not touched it', () => {
        const before = mirelleOf(filledByDice());
        const after = mirelleOf(
            applyIntent(filledByDice(), guardianAnswer(), options({ replaceGenerated: true })).profiles,
        );
        const live = liveState(before, {
            appetites: {
                other: {
                    pressure: 3,
                    tolerance: 0,
                    dependence: 0,
                    sensitization: 0,
                    lastSated: -1,
                    edgeCount: 0,
                    withdrawal: false,
                },
            },
            agenda: structuredClone(before.agenda),
            ties: { [PLAYER_ID]: structuredClone(before.ties[0]!) },
        });
        const next = refreshLiveState(live, before, after);
        expect(next.ties[PLAYER_ID]!.stance).toBe(3);
        expect(next.ties['everyone else']!.stance).toBe(-2);
        expect(next.agenda.secrets).toEqual(['Hides her past of razing cities from Kai']);
        expect(next.agenda.dream).toBeUndefined();
        expect(next.appetites).toEqual({});
        expect(next.mood).toEqual(after.core.baselineMood);
        // What the story changed stays.
        const moved = liveState(before, {
            agenda: { ...structuredClone(before.agenda), secrets: ['told Kai about the temple'] },
            ties: { [PLAYER_ID]: { ...structuredClone(before.ties[0]!), stance: 1 } },
        });
        const kept = refreshLiveState(moved, before, after);
        expect(kept.ties[PLAYER_ID]!.stance).toBe(1);
        expect(kept.agenda.secrets).toEqual(['told Kai about the temple']);
    });
});
