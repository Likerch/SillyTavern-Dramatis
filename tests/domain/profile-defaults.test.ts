import { describe, expect, it } from 'vitest';
import { PLAYER_ID } from '../../src/domain/model';
import type { CharacterProfile } from '../../src/domain/model';
import {
    LIMITS,
    PROFILES_SCHEMA,
    cleanList,
    cleanText,
    emptyAgenda,
    emptyCardProfiles,
    emptyCore,
    emptyProfile,
    emptyTie,
    enumList,
    getPath,
    intIn,
    isEmptyValue,
    isLocked,
    isProtected,
    isUserEdited,
    metaAt,
    normalizeAppetite,
    normalizeCardProfiles,
    normalizeIntensity,
    normalizeProfile,
    normalizeRule,
    normalizeSeed,
    normalizeTie,
    pathChain,
    setMeta,
    setPath,
    slugId,
} from '../../src/domain/profile-defaults';

describe('empty objects', () => {
    it('builds an empty core, agenda, tie and profile', () => {
        const core = emptyCore();
        expect(core.values.top).toEqual([]);
        expect(core.proactivity).toBe(5);
        expect(core.baselineMood.octant).toBe('relaxed');
        expect(emptyAgenda()).toEqual({ goals: [], intentions: [], resources: [], leverage: [], secrets: [] });
        expect(emptyTie(PLAYER_ID, -2)).toMatchObject({ target: PLAYER_ID, stance: -2, intent: 'none', reasons: [] });
        const ilva = emptyProfile(' Ильва ', { english: 'Ilva', aliases: ['хозяйка', 'хозяйка'], role: 'innkeeper' });
        expect(ilva).toMatchObject({
            id: 'ilva',
            name: 'Ильва',
            english: 'Ilva',
            aliases: ['хозяйка'],
            kind: 'character',
            lod: 'sketch',
            role: 'innkeeper',
        });
        expect('species' in ilva).toBe(false);
        expect(emptyProfile('Ильва', { taken: ['ilva'] }).id).toBe('ilva-2');
        expect(emptyProfile('Стража', { id: 'guard', kind: 'group', lod: 'draft' })).toMatchObject({
            id: 'guard',
            kind: 'group',
            lod: 'draft',
        });
    });

    it('starts a card with an indifferent world', () => {
        expect(emptyCardProfiles('tavern.png')).toEqual({
            schema: PROFILES_SCHEMA,
            card: 'tavern.png',
            worldTone: 'indifferent',
            invariants: [],
            characters: [],
            rules: [],
            reputation: [],
            meta: {},
        });
    });
});

describe('slugId', () => {
    it('transliterates and avoids clashes', () => {
        expect(slugId('Ильва')).toBe('ilva');
        expect(slugId('Щукин Жора')).toBe('shchukin-zhora');
        expect(slugId('Ёлка-Палка!')).toBe('elka-palka');
        expect(slugId('Café Noël')).toBe('cafe-noel');
        expect(slugId('')).toBe('character');
        expect(slugId('!!!')).toBe('character');
        expect(slugId('Ильва', ['ilva', 'ilva-2'])).toBe('ilva-3');
        expect(slugId('a'.repeat(60)).length).toBeLessThanOrEqual(40);
    });
});

describe('small readers', () => {
    it('cleans texts and lists', () => {
        expect(cleanText('  a \n b  ')).toBe('a b');
        expect(cleanText(5)).toBe('');
        expect(cleanText('abcdef', 4)).toBe('abc…');
        expect(cleanList(['Ёж', 'еж', '', 7, 'x'], 5)).toEqual(['Ёж', 'x']);
        expect(cleanList('nope', 3)).toEqual([]);
        expect(cleanList(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
        expect(enumList(['a', 'b'] as const, ['b', 'b', 'z', 'a'], 5)).toEqual(['b', 'a']);
        expect(enumList(['a', 'b'] as const, ['a', 'b'], 1)).toEqual(['a']);
        expect(enumList(['a'] as const, 'a', 1)).toEqual([]);
        expect(intIn('7', 0, 5, 1)).toBe(5);
        expect(intIn('x', 0, 5, 1)).toBe(1);
        expect(intIn(2.6, 0, 5, 1)).toBe(3);
        expect(intIn(Number.POSITIVE_INFINITY, 0, 5, 1)).toBe(1);
    });
});

describe('normalizeProfile', () => {
    it('turns garbage into a valid profile', () => {
        const profile = normalizeProfile(null);
        expect(profile.name).toBe('Unnamed');
        expect(profile.id).toBe('unnamed');
        expect(profile.core).toEqual(emptyCore());
        expect(profile.appetites).toEqual([]);
        expect(profile.meta).toEqual({});
    });

    it('clamps scales, caps lists and checks enums', () => {
        const raw = {
            id: 'ilva',
            name: 'Ильва',
            aliases: ['Ильва', 'хозяйка'],
            kind: 'monster',
            lod: 'portrait',
            gender: 'other',
            minor: 'yes',
            extra: { kept: true },
            core: {
                values: {
                    top: ['power', 'power', 'nonsense', 'security', 'tradition', 'benevolence'],
                    sacrifice: 'power',
                },
                temperament: { agreeableness: -7, honesty: 0, openness: 1.4 },
                drives: { high: ['vengeance', 'family'], low: ['family', 'status'] },
                wound: { ghost: 'husband hanged', lie: 'trust no imperial', triggers: ['uniforms'], coping: 'x' },
                signatures: Array.from({ length: 9 }, (_, i) => `sig ${i}`),
                attachment: { anxiety: 5, avoidance: -1 },
                proactivity: 42,
                baselineMood: { octant: 'grumpy', label: 'мрачная настороженность' },
                stanceBounds: [
                    { target: 'imperials', max: 0 },
                    { target: 'Imperials', max: 1 },
                    { target: 'x' },
                    { target: '', min: 1 },
                    { target: 'rebels', min: 3, max: 1 },
                ],
                dark: { ruthless: true, sadist: 'no' },
                corruption: -5,
                justifications: ['blame', 'nope'],
            },
            appetites: [{ kind: 'drink', baseline: 9 }, { kind: 'drink', id: 'drink' }, 'x'],
            ties: [
                {
                    target: PLAYER_ID,
                    stance: -5,
                    reasons: [{ text: 'imperial', delta: -9 }, { text: '' }],
                    want: 7,
                    gaze: 'bogus',
                },
                { target: PLAYER_ID, stance: 2 },
                { target: '' },
                {
                    target: 'bram',
                    stance: 1,
                    beliefs: [{ claim: 'drinks', confidence: 4 }, { claim: '' }],
                    claim: 'weird',
                },
            ],
            agenda: {
                goals: [{ text: 'raise the tax', priority: 9 }, { text: 'raise the tax' }, { text: '' }],
                intentions: [{ text: 'a' }, { text: 'b', clock: { segments: 40, filled: 99 } }, { text: 'c' }],
                front: { impulse: 'the guild wants the port', steps: ['buy debts'], clock: { segments: 1 } },
                secrets: ['letters'],
            },
            starts: [{ greeting: 0, doing: 'counting' }, { greeting: 0 }, { greeting: 'x', present: false }],
            meta: {
                'core.values': { origin: 'user', locked: true, evidence: ['q'] },
                '': {},
                x: 'bad',
                y: { origin: '??' },
            },
        };
        const profile = normalizeProfile(raw);
        expect(profile.aliases).toEqual(['хозяйка']);
        expect(profile.kind).toBe('character');
        expect(profile.lod).toBe('portrait');
        expect('gender' in profile).toBe(false);
        expect('minor' in profile).toBe(false);
        expect((profile as CharacterProfile & { extra?: unknown }).extra).toEqual({ kept: true });
        expect(profile.core.values).toEqual({ top: ['power', 'security', 'tradition'] });
        expect(profile.core.temperament).toEqual({ agreeableness: -2, openness: 1 });
        expect(profile.core.drives).toEqual({ high: ['vengeance', 'family'], low: ['status'] });
        expect(profile.core.wound?.coping).toBe('avoid');
        expect(profile.core.signatures).toHaveLength(LIMITS.signatures);
        expect(profile.core.attachment).toEqual({ anxiety: 2, avoidance: -1 });
        expect(profile.core.proactivity).toBe(10);
        expect(profile.core.baselineMood).toEqual({ octant: 'relaxed', label: 'мрачная настороженность' });
        expect(profile.core.stanceBounds).toEqual([
            { target: 'imperials', max: 0 },
            { target: 'rebels', min: 1, max: 3 },
        ]);
        expect(profile.core.dark).toEqual({ ruthless: true });
        expect(profile.core.corruption).toBe(0);
        expect(profile.core.justifications).toEqual(['blame']);
        expect(profile.appetites.map((a) => a.id)).toEqual(['drink', 'drink-2']);
        expect(profile.appetites[0]!.baseline).toBe(5);
        expect(profile.appetites[0]!.sources).toEqual(['individual']);
        expect(profile.ties).toHaveLength(2);
        expect(profile.ties[0]).toMatchObject({ stance: -3, want: 5 });
        expect(profile.ties[0]!.reasons).toEqual([
            { id: 'r1', text: 'imperial', delta: -6, scenesLeft: null, stacks: 1 },
        ]);
        expect('gaze' in profile.ties[0]!).toBe(false);
        expect(profile.ties[1]!.beliefs).toEqual([{ claim: 'drinks', source: 'assumed', confidence: 1 }]);
        expect(profile.ties[1]!.claim).toBe('none');
        expect(profile.agenda.goals).toEqual([{ id: 'g1', text: 'raise the tax', kind: 'external', priority: 3 }]);
        expect(profile.agenda.intentions).toHaveLength(LIMITS.intentions);
        expect(profile.agenda.intentions[1]!.clock).toEqual({ segments: 12, filled: 12 });
        expect(profile.agenda.front).toEqual({
            impulse: 'the guild wants the port',
            steps: ['buy debts'],
            doom: '',
            clock: { segments: 2, filled: 0 },
        });
        expect(profile.starts).toEqual([
            { greeting: 0, present: true, doing: 'counting' },
            { greeting: -1, present: false },
        ]);
        expect(profile.meta).toEqual({
            'core.values': { origin: 'user', locked: true, evidence: ['q'] },
            y: { origin: 'generated' },
        });
    });

    it('keeps a valid profile as it is', () => {
        const profile = emptyProfile('Брам', { id: 'bram' });
        profile.gender = 'male';
        profile.minor = true;
        profile.ties = [emptyTie(PLAYER_ID, 1)];
        expect(normalizeProfile(profile)).toEqual(profile);
        expect(normalizeProfile(normalizeProfile(profile))).toEqual(profile);
    });

    it('names a profile from its English name or id', () => {
        expect(normalizeProfile({ english: 'Bram' })).toMatchObject({ name: 'Bram', id: 'bram' });
        expect(normalizeProfile({ id: 'x1' })).toMatchObject({ name: 'x1', id: 'x1' });
        expect(normalizeProfile({ name: 'Ильва' }, { taken: ['ilva'] }).id).toBe('ilva-2');
    });
});

describe('appetites, ties, rules, seeds', () => {
    it('normalises an appetite with targets and satisfiers', () => {
        const appetite = normalizeAppetite(
            {
                kind: 'flesh',
                target: { mode: 'class', class: 'human men' },
                satisfiers: ['a night', { what: 'x', amount: 9, full: true }, { what: '' }, 3],
                restraints: ['a vow'],
                excuse: 'they want it',
            },
            ['flesh'],
        )!;
        expect(appetite.id).toBe('flesh-2');
        expect(appetite.target).toEqual({ mode: 'class', class: 'human men' });
        expect(appetite.satisfiers).toEqual([
            { what: 'a night', amount: 2 },
            { what: 'x', amount: 5, full: true },
        ]);
        expect(appetite.restraints).toEqual(['a vow']);
        expect(normalizeAppetite('x')).toBeNull();
        expect(normalizeAppetite({ target: { mode: 'player' } })!.target).toEqual({ mode: 'player' });
        expect(normalizeAppetite({ target: { mode: 'class' } })!.target).toEqual({ mode: 'thing' });
        expect(normalizeAppetite({ kind: 'weird' })!.kind).toBe('other');
    });

    it('normalises a tie and drops it without a target', () => {
        expect(normalizeTie({ target: '' })).toBeNull();
        expect(normalizeTie([])).toBeNull();
        expect(normalizeTie({ target: 'a', base: 9, reasons: 'x', want: null })).toMatchObject({
            base: 3,
            reasons: [],
        });
        expect(
            normalizeTie({ target: 'a', gaze: 'prey', reasons: [{ text: 't', scenesLeft: 3, stacks: 0, key: true }] }),
        ).toMatchObject({
            gaze: 'prey',
            reasons: [{ id: 'r1', text: 't', delta: 0, scenesLeft: 3, stacks: 1, key: true }],
        });
    });

    it('normalises rule shares and seeds', () => {
        expect(normalizeIntensity({ zero: 1, low: 1, mid: 1, high: 1 })).toEqual({
            zero: 0.25,
            low: 0.25,
            mid: 0.25,
            high: 0.25,
        });
        expect(normalizeIntensity({ zero: -1 })).toEqual({ zero: 0.2, low: 0.25, mid: 0.25, high: 0.3 });
        expect(normalizeIntensity(null)).toEqual({ zero: 0.2, low: 0.25, mid: 0.25, high: 0.3 });
        const rule = normalizeRule(
            {
                holders: 'monster girls',
                kind: 'flesh',
                source: 'individual',
                target: { mode: 'player' },
                styles: { siren: 2, raider: -1, bogus: 3 },
                evidence: ['q'],
            },
            ['monster-girls-flesh'],
        )!;
        expect(rule).toMatchObject({
            id: 'monster-girls-flesh-2',
            source: 'species',
            target: { mode: 'player' },
            styles: { siren: 2 },
            evidence: ['q'],
            choosiness: 2,
        });
        expect(normalizeRule({ holders: '' })).toBeNull();
        expect(normalizeRule(1)).toBeNull();
        expect(normalizeRule({ holders: 'x', id: 'mine' })!.id).toBe('mine');
        expect(normalizeSeed({ label: 'a courier', stance: -9, greeting: 'x' })).toEqual({
            among: '*',
            label: 'a courier',
            stance: -3,
            greeting: -1,
        });
        expect(normalizeSeed({ label: '' })).toBeNull();
        expect(normalizeSeed(null)).toBeNull();
        expect(normalizeSeed({ label: 'x', evidence: ['q'], among: 'guards', greeting: 1 })).toMatchObject({
            evidence: ['q'],
        });
    });

    it('normalises a whole card file with unique ids', () => {
        const card = normalizeCardProfiles(
            {
                worldTone: 'cold',
                characters: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }, { name: 'Ильва' }],
                rules: [{ holders: 'x' }, { holders: 'x' }, null],
                reputation: [{ label: 'a thief' }, {}],
                invariants: ['x', 'X'],
                intent: { at: 5, sourcesHash: 'h', model: 'm' },
            },
            'card.png',
        );
        expect(card.card).toBe('card.png');
        expect(card.worldTone).toBe('indifferent');
        expect(card.characters.map((c) => c.id)).toEqual(['a', 'a-2', 'ilva']);
        expect(card.rules.map((r) => r.id)).toEqual(['x-other', 'x-other-2']);
        expect(card.reputation).toHaveLength(1);
        expect(card.invariants).toEqual(['x']);
        expect(card.intent).toEqual({ at: 5, sourcesHash: 'h', model: 'm' });
        expect(normalizeCardProfiles(null, 'c.png')).toEqual(emptyCardProfiles('c.png'));
        expect(normalizeCardProfiles({ intent: { at: 1 } }, 'c').intent).toBeUndefined();
    });
});

describe('provenance', () => {
    const base = emptyProfile('Ильва', { id: 'ilva' });

    it('lists a path and its ancestors', () => {
        expect(pathChain('ties.@player.stance')).toEqual(['ties.@player.stance', 'ties.@player', 'ties']);
        expect(pathChain('')).toEqual([]);
    });

    it('sets, finds and removes meta; locks and user edits cover the subtree', () => {
        let profile = setMeta(base, 'core', { origin: 'author', locked: true });
        expect(base.meta).toEqual({});
        expect(isLocked(profile, 'core.values')).toBe(true);
        expect(isLocked(profile, 'agenda.goals')).toBe(false);
        expect(metaAt(profile, 'core.values')).toEqual({ origin: 'author', locked: true });
        expect(metaAt(profile, 'agenda')).toBeUndefined();
        profile = setMeta(profile, 'core', null);
        expect(isLocked(profile, 'core.values')).toBe(false);
        profile = setMeta(profile, 'ties.@player', { origin: 'user' });
        expect(isUserEdited(profile, 'ties.@player.stance')).toBe(true);
        expect(isProtected(profile, 'ties.@player')).toBe(true);
        expect(isProtected(profile, 'ties.bram')).toBe(false);
    });
});

describe('path access', () => {
    const profile: CharacterProfile = {
        ...emptyProfile('Ильва', { id: 'ilva' }),
        ties: [emptyTie(PLAYER_ID, -2), emptyTie('bram', 1)],
    };

    it('reads dotted paths through arrays keyed by target or id', () => {
        expect(getPath(profile, 'ties.@player.stance')).toBe(-2);
        expect(getPath(profile, 'core.values.top')).toEqual([]);
        expect(getPath(profile, 'ties.nobody.stance')).toBeUndefined();
        expect(getPath(profile, 'name.length.x')).toBeUndefined();
        expect(getPath(profile, '')).toBe(profile);
    });

    it('writes copies: nested fields, array elements, removal', () => {
        const a = setPath(profile, 'ties.@player.stance', -1);
        expect(getPath(a, 'ties.@player.stance')).toBe(-1);
        expect(getPath(profile, 'ties.@player.stance')).toBe(-2);
        const b = setPath(profile, 'ties.sota', emptyTie('sota', 3));
        expect(b.ties.map((t) => t.target)).toEqual([PLAYER_ID, 'bram', 'sota']);
        const c = setPath(profile, 'ties.bram', emptyTie('bram', 2));
        expect(getPath(c, 'ties.bram.stance')).toBe(2);
        const d = setPath(profile, 'ties.bram', undefined);
        expect(d.ties).toHaveLength(1);
        expect(setPath(profile, 'ties.nobody', undefined).ties).toHaveLength(2);
        expect(setPath(profile, 'ties.nobody.stance', 1)).toEqual(profile);
        const e = setPath(profile, 'core.want', 'revenge');
        expect(e.core.want).toBe('revenge');
        const f = setPath(e, 'core.want', undefined);
        expect('want' in f.core).toBe(false);
        expect(setPath({} as Record<string, unknown>, 'a.b', 1)).toEqual({ a: { b: 1 } });
        expect(setPath(profile, '', 1)).toBe(profile);
    });

    it('knows empty values', () => {
        expect(isEmptyValue('')).toBe(true);
        expect(isEmptyValue([])).toBe(true);
        expect(isEmptyValue({ a: '', b: [], c: { d: null } })).toBe(true);
        expect(isEmptyValue(0)).toBe(false);
        expect(isEmptyValue(false)).toBe(false);
        expect(isEmptyValue({ a: 'x' })).toBe(false);
    });
});
