// Card intent v1 (src/shared/card-intent.ts): the vocabularies and sizes against the model, the JSON Schema, and
// validateCardIntent — what is valid is kept, the rest listed and dropped or cut — and the coverage that lets Dramatis
// skip reading the card's text.
import { describe, expect, it } from 'vitest';
import {
    APPETITE_KINDS,
    DRIVES,
    GAZES,
    HEXACO,
    JUSTIFICATIONS,
    MOODS,
    STYLES,
    TIE_INTENTS,
    VALUES,
} from '../../src/domain/model';
import { LIMITS } from '../../src/domain/profile-defaults';
import { INTENT_STRINGS } from '../../src/features/intent/strings';
import {
    CARD_INTENT_LIMITS,
    CARD_INTENT_SCHEMA,
    CARD_INTENT_VERSION,
    CARD_INTENT_VOCABULARY,
    cardIntentCoverage,
    isCardIntentPlayer,
    validateCardIntent,
} from '../../src/shared/card-intent';
import type { CardIntentError, CardIntentV1 } from '../../src/shared/card-intent';
import { tavernIntent } from '../domain/card-intent-fixtures';

type Dict = Record<string, unknown>;

const codes = (errors: CardIntentError[]) => errors.map((error) => `${error.path} ${error.code}`);

describe('card intent v1 — the format', () => {
    it('keeps its vocabularies equal to the model', () => {
        const v = CARD_INTENT_VOCABULARY;
        expect(v.values).toEqual(VALUES);
        expect(v.temperament).toEqual(HEXACO);
        expect(v.drives).toEqual(DRIVES);
        expect(v.moods).toEqual(MOODS);
        expect(v.justifications).toEqual(JUSTIFICATIONS);
        expect(v.appetiteKinds).toEqual(APPETITE_KINDS);
        expect(v.styles).toEqual(STYLES);
        expect(v.tieIntents).toEqual(TIE_INTENTS);
        expect(v.gazes).toEqual(GAZES);
    });

    it('keeps the sizes Dramatis keeps', () => {
        const shared = Object.keys(CARD_INTENT_LIMITS).filter((key) => key in LIMITS) as (keyof typeof LIMITS)[];
        expect(shared.length).toBeGreaterThan(20);
        for (const key of shared) {
            if (key === 'reasons') continue; // a tie keeps up to LIMITS.reasons, the author gives up to 6 of them
            expect([key, CARD_INTENT_LIMITS[key as keyof typeof CARD_INTENT_LIMITS]]).toEqual([key, LIMITS[key]]);
        }
        expect(CARD_INTENT_LIMITS.reasons).toBeLessThanOrEqual(LIMITS.reasons);
    });

    it('is a frozen JSON Schema of version 1 whose fields are the reading’s', () => {
        expect(CARD_INTENT_SCHEMA.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
        expect(Object.isFrozen(CARD_INTENT_SCHEMA)).toBe(true);
        expect(CARD_INTENT_SCHEMA.properties!.version).toMatchObject({ type: 'integer', const: CARD_INTENT_VERSION });
        expect(CARD_INTENT_SCHEMA.required).toEqual(['version']);
        // Every core and agenda field is one the intent reading names (its field labels).
        const character = CARD_INTENT_SCHEMA.properties!.characters!.additionalProperties as typeof CARD_INTENT_SCHEMA;
        const labels = INTENT_STRINGS.en;
        for (const head of ['core', 'agenda'] as const) {
            for (const key of Object.keys(character.properties![head]!.properties!)) {
                expect(labels[`intent.path.${head}.${key}`], `${head}.${key}`).toBeTruthy();
            }
        }
        expect(Object.keys(character.properties!)).toEqual([
            'kind',
            'english',
            'aliases',
            'russian',
            'gender',
            'minor',
            'role',
            'species',
            'core',
            'agenda',
            'appetites',
            'ties',
            'starts',
        ]);
        // Plain JSON: it survives a round trip unchanged.
        expect(JSON.parse(JSON.stringify(CARD_INTENT_SCHEMA))).toEqual(CARD_INTENT_SCHEMA);
    });

    it('knows the player under PLAYER and {{user}}', () => {
        expect(isCardIntentPlayer('PLAYER')).toBe(true);
        expect(isCardIntentPlayer(' player ')).toBe(true);
        expect(isCardIntentPlayer('{{user}}')).toBe(true);
        expect(isCardIntentPlayer('Сота')).toBe(false);
    });
});

describe('validateCardIntent', () => {
    it('takes a whole valid intent as it is, complete', () => {
        const intent = tavernIntent();
        const check = validateCardIntent(structuredClone(intent));
        expect(check).toEqual({ ok: true, errors: [], intent, complete: true, missing: [] });
    });

    it('refuses what is not an intent of version 1', () => {
        for (const value of [null, 'intent', [], 7]) {
            const check = validateCardIntent(value);
            expect(check).toMatchObject({ ok: false, intent: null, complete: false });
            expect(codes(check.errors)).toEqual([' format']);
        }
        expect(codes(validateCardIntent({ version: 2, characters: {} }).errors)).toEqual(['version version']);
        expect(validateCardIntent({ characters: {} }).intent).toBeNull();
    });

    it('keeps the valid parts and lists the rest: dropped where wrong, cut where too long', () => {
        const raw = {
            version: 1,
            extra: true,
            world: { tone: 'grim', invariants: ['  держится  ', ''] },
            characters: {
                Ильва: {
                    english: 'Ilva',
                    aliases: Array.from({ length: 14 }, (_, i) => `прозвище ${i}`),
                    role: 'х'.repeat(250),
                    core: {
                        concept: 'вдова мятежника',
                        values: { top: ['security', 'greed'], sacrifice: 'security' },
                        drives: { high: ['vengeance'], low: ['vengeance', 'status'] },
                        proactivity: '7',
                        mood: { octant: 'hostile' },
                        stanceBounds: [
                            { target: 'PLAYER' },
                            { target: 'стража', min: 2, max: -1 },
                            { target: 'PLAYER', max: 0 },
                        ],
                        want: '',
                    },
                    appetites: [
                        { kind: 'drink', target: 'class' },
                        { kind: 'drink', label: 'вино' },
                        { label: 'без вида' },
                    ],
                    ties: [
                        { target: 'PLAYER', stance: -2 },
                        { target: 'player', stance: -1 },
                        { target: 'Сота', stance: 5 },
                    ],
                    starts: [{ greeting: 0 }, { greeting: 0, present: false }, { greeting: 1.5 }],
                },
                '': { core: { concept: 'никто' } },
                Брам: 'наёмник',
            },
        };
        const check = validateCardIntent(raw);
        expect(check.ok).toBe(false);
        expect(codes(check.errors)).toEqual([
            'extra unknown',
            'world.tone enum',
            'characters["Ильва"].aliases size',
            'characters["Ильва"].role length',
            'characters["Ильва"].core.values.top[1] enum',
            'characters["Ильва"].core.proactivity type',
            'characters["Ильва"].core.mood unknown',
            'characters["Ильва"].appetites[2] missing',
            'characters["Ильва"].ties[2].stance range',
            'characters["Ильва"].ties[2] missing',
            'characters["Ильва"].starts[2].greeting type',
            'characters["Ильва"].starts[2] missing',
            'characters[""] missing',
            'characters["Брам"] type',
            'characters["Ильва"].core.values.sacrifice conflict',
            'characters["Ильва"].core.drives.low conflict',
            'characters["Ильва"].core.stanceBounds[0] conflict',
            'characters["Ильва"].core.stanceBounds[1] conflict',
            'characters["Ильва"].appetites[0].targetClass missing',
            'characters["Ильва"].appetites[1] duplicate',
            'characters["Ильва"].ties[1] duplicate',
            'characters["Ильва"].starts[1] duplicate',
        ]);
        const ilva = check.intent!.characters!['Ильва']!;
        expect(check.intent!.world).toEqual({ invariants: ['держится'] });
        expect(ilva.aliases).toHaveLength(12);
        expect(ilva.role).toHaveLength(200);
        expect(ilva.role!.endsWith('…')).toBe(true);
        expect(ilva.core).toEqual({
            concept: 'вдова мятежника',
            values: { top: ['security'] },
            drives: { high: ['vengeance'], low: ['status'] },
            stanceBounds: [{ target: 'PLAYER', max: 0 }],
        });
        expect(ilva.appetites).toEqual([{ kind: 'drink' }]);
        expect(ilva.ties).toEqual([{ target: 'PLAYER', stance: -2 }]);
        expect(ilva.starts).toEqual([{ greeting: 0 }]);
        expect(Object.keys(check.intent!.characters!)).toEqual(['Ильва']);
        expect(check.errors.every((error) => typeof error.message === 'string' && error.message.length > 0)).toBe(true);
    });

    it('takes one person written twice under two names only once', () => {
        const raw = {
            version: 1,
            characters: {
                Ильва: { english: 'Ilva', aliases: ['хозяйка'], core: { concept: 'хозяйка' } },
                Ilva: { core: { concept: 'innkeeper' } },
                Брам: { aliases: ['хозяйка'], core: { concept: 'наёмник' } },
            },
        };
        const check = validateCardIntent(raw);
        expect(codes(check.errors)).toEqual(['characters.Ilva duplicate', 'characters["Брам"] duplicate']);
        expect(Object.keys(check.intent!.characters!)).toEqual(['Ильва']);
    });

    it('says what a complete intent still lacks', () => {
        const intent = tavernIntent();
        delete intent.world!.tone;
        const ilva = intent.characters!['Ильва']!;
        ilva.ties = ilva.ties!.filter((tie) => tie.target !== 'PLAYER');
        delete ilva.core!.want;
        delete ilva.agenda!.goals;
        delete intent.characters!['Брам']!.core!.drives;
        // A group needs only its concept and its stance to the player.
        intent.characters!['возчики'] = {
            kind: 'group',
            core: { concept: 'играют в кости в углу' },
            ties: [{ target: '{{user}}', stance: -1 }],
        };
        const check = validateCardIntent(intent);
        expect(check.ok).toBe(true);
        expect(check.complete).toBe(false);
        expect(check.missing).toEqual([
            'world.tone',
            'characters["Ильва"].ties[PLAYER]',
            'characters["Ильва"].core.want|agenda.goals',
            'characters["Брам"].core.drives.high',
        ]);
        expect(cardIntentCoverage({ version: 1 })).toEqual({ complete: false, missing: ['world.tone', 'characters'] });
    });

    it('treats empty texts, lists and objects as not said', () => {
        const raw: Dict = {
            version: 1,
            world: { invariants: [], reputation: [] },
            characters: { Ильва: { role: '  ', core: {}, aliases: ['', ' '], ties: [] } },
        };
        const check = validateCardIntent(raw);
        expect(check).toMatchObject({ ok: true, errors: [] });
        expect(check.intent).toEqual({ version: 1 } satisfies CardIntentV1);
    });
});
