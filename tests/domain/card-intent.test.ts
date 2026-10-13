// The card's structured intent on the profiles (src/domain/card-intent.ts): read and validated, written 1:1 as the
// author's (source 'card.intent', no quote), the user's edits and locks first, what it no longer says cleared, the
// content boundary; the reading of the text afterwards fills only what it leaves out; the fingerprint hash and the
// «Замысел» section of the creator's notes.
import { describe, expect, it } from 'vitest';
import {
    applyCardIntent,
    cardIntentHash,
    hasCardMarks,
    readCardIntent,
    stripIntentNotes,
    withoutIntentNotes,
} from '../../src/domain/card-intent';
import type { CardIntentOptions } from '../../src/domain/card-intent';
import { applyIntent } from '../../src/domain/intent-apply';
import { intentSources } from '../../src/domain/intent-prompt';
import { PLAYER_ID } from '../../src/domain/model';
import type { CardProfiles, CharacterProfile } from '../../src/domain/model';
import {
    CARD_INTENT_SOURCE,
    cardIntentMeta,
    emptyCardProfiles,
    emptyProfile,
    isCardAuthored,
    setMeta,
} from '../../src/domain/profile-defaults';
import { CARD_INTENT_NOTES_BEGIN, CARD_INTENT_NOTES_END } from '../../src/shared/card-intent';
import type { CardIntentV1 } from '../../src/shared/card-intent';
import { partialTavernIntent, tavernIntent } from './card-intent-fixtures';
import { TAVERN_CARD, tavernAnswer } from './intent-fixtures';

const OPTIONS: CardIntentOptions = { now: 1000, sourcesHash: 'h1', personaName: 'Курьер', cardName: 'Ильва' };
const AUTHOR = cardIntentMeta();

function apply(intent: CardIntentV1 | null, base: CardProfiles = emptyCardProfiles('tavern.png'), options = OPTIONS) {
    return applyCardIntent(base, intent, options);
}

function byName(card: CardProfiles, name: string): CharacterProfile {
    const found = card.characters.find((profile) => profile.name === name);
    if (!found) throw new Error(`no ${name}`);
    return found;
}

describe('readCardIntent', () => {
    it('tells a card without one, one that is unusable, and a complete one apart', () => {
        expect(readCardIntent(undefined)).toEqual({
            present: false,
            intent: null,
            errors: [],
            complete: false,
            missing: [],
        });
        expect(readCardIntent({ version: 3 })).toMatchObject({ present: true, intent: null, complete: false });
        expect(readCardIntent({ version: 1 })).toMatchObject({ present: true, intent: null, errors: [] });
        const read = readCardIntent(tavernIntent());
        expect(read).toMatchObject({ present: true, complete: true, errors: [], missing: [] });
        expect(read.intent).toEqual(tavernIntent());
        expect(readCardIntent(partialTavernIntent())).toMatchObject({ complete: false });
    });

    it('hashes the object, not its key order', () => {
        const a = { version: 1, world: { tone: 'hostile', invariants: ['x'] } };
        const b = { world: { invariants: ['x'], tone: 'hostile' }, version: 1 };
        expect(cardIntentHash(a)).toBe(cardIntentHash(b));
        expect(cardIntentHash(a)).not.toBe(cardIntentHash({ ...a, world: { tone: 'neutral', invariants: ['x'] } }));
        expect(cardIntentHash({ version: 1, list: [1, 2] })).not.toBe(cardIntentHash({ version: 1, list: [2, 1] }));
    });
});

describe('the «Замысел» section of the creator’s notes', () => {
    it('leaves out what stands between the markers', () => {
        const notes = `Тон: медленное сближение.\n\n${CARD_INTENT_NOTES_BEGIN}\n## Замысел\nИльва враждебна к курьеру.\n${CARD_INTENT_NOTES_END}\n\nПиши коротко.`;
        expect(stripIntentNotes(notes)).toBe('Тон: медленное сближение.\n\nПиши коротко.');
        expect(stripIntentNotes(`Начало.\n${CARD_INTENT_NOTES_BEGIN}\nИльва…`)).toBe('Начало.');
    });

    it('without markers, leaves out a «Замысел» / «Intent» heading up to the next heading of its level', () => {
        const notes = [
            '# Карточка',
            'Для взрослых.',
            '## Замысел (Dramatis)',
            'Ильва враждебна.',
            '### Ильва',
            'Ценности: безопасность.',
            '## Советы',
            'Играй медленно.',
        ].join('\n');
        expect(stripIntentNotes(notes)).toBe('# Карточка\nДля взрослых.\n## Советы\nИграй медленно.');
        expect(stripIntentNotes("Intro\n## **Author's intent**\nIlva hates him.")).toBe('Intro');
        // «Замыслы» or «Intentions» are other headings.
        expect(stripIntentNotes('## Замыслы\nтекст')).toBe('## Замыслы\nтекст');
        expect(stripIntentNotes('## Intentions\ntext')).toBe('## Intentions\ntext');
        expect(stripIntentNotes('')).toBe('');
    });

    it('changes only the creator’s notes of the card', () => {
        const card = { ...TAVERN_CARD, creatorNotes: `Тон.\n${CARD_INTENT_NOTES_BEGIN}\nx\n${CARD_INTENT_NOTES_END}` };
        const stripped = withoutIntentNotes(card);
        expect(stripped).toEqual({ ...card, creatorNotes: 'Тон.' });
        expect(intentSources(stripped).find((source) => source.id === 'card.notes')?.text).toBe('Тон.');
    });
});

describe('applyCardIntent — the tavern', () => {
    const { profiles: card, diff, warnings, characters } = apply(tavernIntent());
    const ilva = byName(card, 'Ильва');
    const sota = byName(card, 'Сота');
    const bram = byName(card, 'Брам');

    it('creates the cast by story names; the card’s own character is a portrait', () => {
        expect(card.characters.map((profile) => [profile.id, profile.name, profile.lod])).toEqual([
            ['ilva', 'Ильва', 'portrait'],
            ['sota', 'Сота', 'draft'],
            ['bram', 'Брам', 'draft'],
        ]);
        expect(characters).toEqual(['ilva', 'sota', 'bram']);
        expect(diff).toEqual([]);
        expect(warnings).toEqual([]);
    });

    it('writes who they are and their core in the profile’s own shape, as the author’s without a quote', () => {
        expect(ilva).toMatchObject({
            english: 'Ilva',
            aliases: ['хозяйка'],
            gender: 'female',
            role: 'хозяйка трактира «Рог»',
        });
        expect(ilva.core).toMatchObject({
            concept: 'вдова мятежника, держит трактир назло оккупантам',
            values: { top: ['security', 'tradition'], sacrifice: 'conformity' },
            temperament: { honesty: 1, agreeableness: -2 },
            drives: { high: ['vengeance', 'family'], low: ['status'] },
            wound: {
                ghost: 'имперцы повесили её мужа',
                lie: 'имперцам верить нельзя',
                triggers: ['имперская форма'],
                coping: 'overcompensate',
            },
            want: 'сберечь дочь и трактир',
            proactivity: 6,
            baselineMood: { octant: 'hostile', label: 'мрачная настороженность' },
            stanceBounds: [{ target: PLAYER_ID, max: 0 }],
            redLines: { never: ['выдать мятежников'], would: [] },
            voice: 'Деньги вперёд, курьер.',
            anchors: ['sota'],
            keys: ['доверие зарабатывается только делами'],
        });
        for (const path of [
            'english',
            'aliases',
            'gender',
            'role',
            'core.concept',
            'core.values',
            'core.temperament',
            'core.drives',
            'core.wound',
            'core.want',
            'core.proactivity',
            'core.baselineMood',
            'core.stanceBounds',
            'core.redLines',
            'core.voice',
            'core.anchors',
            'core.keys',
            'agenda.goals',
            'agenda.secrets',
            `ties.${PLAYER_ID}`,
            'ties.sota',
            'starts',
        ]) {
            expect([path, ilva.meta[path]]).toEqual([path, AUTHOR]);
        }
        // What the intent does not say stays open: no meta.
        expect(ilva.meta['core.need']).toBeUndefined();
        expect(ilva.meta['core.signatures']).toBeUndefined();
        expect(ilva.meta.kind).toBeUndefined();
    });

    it('writes the agenda, the ties with the author’s reasons, the starts', () => {
        expect(ilva.agenda.goals).toEqual([
            { id: 'g1', text: 'увезти Соту из города, пока имперцы её не заметили', kind: 'external', priority: 1 },
        ]);
        expect(ilva.agenda.secrets).toEqual(['прячет в погребе оружие мятежников']);
        const player = ilva.ties.find((tie) => tie.target === PLAYER_ID)!;
        expect(player).toMatchObject({
            stance: -2,
            intent: 'avoid',
            behaviour: 'берёт монету, сдачи не даёт',
            reasons: [
                { id: 'author-1', text: 'ты имперский курьер', delta: -1, scenesLeft: null, stacks: 1 },
                { id: 'author-2', text: 'имперцы повесили её мужа', delta: -1, scenesLeft: null, stacks: 1 },
            ],
        });
        expect(ilva.ties.find((tie) => tie.target === 'sota')).toMatchObject({ stance: 3, intent: 'protect' });
        expect(ilva.starts).toEqual([
            { greeting: 0, present: true, doing: 'считает выручку', goal: 'взять плату вперёд' },
        ]);
        expect(sota.starts).toEqual([
            { greeting: 0, present: false },
            { greeting: 1, present: true, doing: 'вытирает столы' },
        ]);
    });

    it('writes appetites with the defaults of their kind, linked to the world rule', () => {
        expect(bram.appetites).toEqual([
            expect.objectContaining({
                id: 'drink',
                kind: 'drink',
                label: 'брага',
                baseline: 4,
                dependence: 2,
                style: 'buyer',
                affectionOnset: 'possible',
                rule: 'vozchiki-pyut',
                target: { mode: 'thing' },
                sources: ['individual'],
            }),
        ]);
        expect(bram.meta['appetites.drink']).toEqual(AUTHOR);
        expect(bram.ties.find((tie) => tie.target === PLAYER_ID)).toMatchObject({
            stance: 0,
            want: 2,
            appetite: 'drink',
        });
    });

    it('writes the world: tone, invariants, reputation, rules — and stamps the reading', () => {
        expect(card.worldTone).toBe('hostile');
        expect(card.invariants).toEqual(['Ильва никогда не выдаёт мятежников']);
        expect(card.reputation).toEqual([{ among: 'стража', label: 'имперский курьер', stance: -2, greeting: -1 }]);
        expect(card.rules).toEqual([
            {
                id: 'vozchiki-pyut',
                holders: 'возчики',
                kind: 'drink',
                label: 'брага',
                source: 'culture',
                target: { mode: 'thing' },
                intensity: { zero: 0.25, low: 0.25, mid: 0.25, high: 0.25 },
                styles: { buyer: 2 },
                choosiness: 2,
                exclusivity: 'exclusive',
                affectionOnset: 'possible',
                groupMode: 'solitary',
            },
        ]);
        for (const path of ['worldTone', 'invariants', 'reputation', 'rules.vozchiki-pyut']) {
            expect([path, card.meta[path]]).toEqual([path, AUTHOR]);
        }
        expect(card.intent).toEqual({ at: 1000, sourcesHash: 'h1', fromCard: 1 });
        expect(hasCardMarks(card)).toBe(true);
        expect(hasCardMarks(emptyCardProfiles('x.png'))).toBe(false);
    });

    it('gives the same profiles when applied again', () => {
        const again = apply(tavernIntent(), card);
        expect(again.diff).toEqual([]);
        expect(again.profiles).toEqual(card);
    });
});

describe('applyCardIntent — over what is there', () => {
    it('finds people by their other names, adds the key as an alias and keeps the profile’s name', () => {
        const base = { ...emptyCardProfiles('tavern.png'), characters: [emptyProfile('Ilva', { lod: 'sketch' })] };
        const out = apply(
            {
                version: 1,
                characters: { Ильва: { english: 'Ilva', russian: ['Ильва Рог'], core: { concept: 'вдова' } } },
            },
            base,
        ).profiles;
        expect(out.characters).toHaveLength(1);
        expect(out.characters[0]).toMatchObject({
            id: 'ilva',
            name: 'Ilva',
            lod: 'sketch',
            aliases: ['Ильва Рог', 'Ильва'],
        });
    });

    it('keeps the user’s edits and locks and lists them as differences from the card', () => {
        let base = apply(null).profiles;
        let ilva = { ...emptyProfile('Ильва'), id: 'ilva' };
        ilva.core.concept = 'моя Ильва';
        ilva = setMeta(ilva, 'core.concept', { origin: 'user' });
        ilva = {
            ...ilva,
            ties: [
                {
                    target: PLAYER_ID,
                    stance: 1,
                    reasons: [],
                    evaluations: [],
                    intent: 'none',
                    debts: [],
                    encounters: [],
                    beliefs: [],
                },
            ],
        };
        ilva = setMeta(ilva, `ties.${PLAYER_ID}`, { origin: 'generated', locked: true });
        base = { ...base, characters: [ilva] };
        const { profiles, diff } = apply(tavernIntent(), base);
        const after = byName(profiles, 'Ильва');
        expect(after.core.concept).toBe('моя Ильва');
        expect(after.meta['core.concept']).toEqual({ origin: 'user' });
        expect(after.ties.find((tie) => tie.target === PLAYER_ID)!.stance).toBe(1);
        expect(diff.map((entry) => [entry.path, entry.status, entry.fromCard])).toEqual([
            ['core.concept', 'kept-user', true],
            [`ties.${PLAYER_ID}`, 'kept-locked', true],
        ]);
    });

    it('takes the place of an earlier reading and lists what changed', () => {
        let ilva = { ...emptyProfile('Ильва'), id: 'ilva' };
        ilva.core.want = 'Wants every guest to feel welcome';
        ilva = setMeta(ilva, 'core.want', { origin: 'inferred' });
        const base = { ...emptyCardProfiles('tavern.png'), characters: [ilva] };
        const { profiles, diff } = apply(tavernIntent(), base);
        expect(byName(profiles, 'Ильва').core.want).toBe('сберечь дочь и трактир');
        expect(diff).toEqual([
            {
                character: 'ilva',
                name: 'Ильва',
                path: 'core.want',
                before: 'Wants every guest to feel welcome',
                after: 'сберечь дочь и трактир',
                status: 'updated',
                fromCard: true,
            },
        ]);
    });

    it('clears what it no longer says, except what is locked; who they are keeps its value', () => {
        const first = apply(tavernIntent()).profiles;
        // Lock Брам's tie to the player.
        const locked = {
            ...first,
            characters: first.characters.map((profile) =>
                profile.id === 'bram' ? setMeta(profile, `ties.${PLAYER_ID}`, { ...AUTHOR, locked: true }) : profile,
            ),
        };
        const next = tavernIntent();
        const ilva = next.characters!['Ильва']!;
        delete ilva.core!.want;
        delete ilva.english;
        ilva.ties = ilva.ties!.filter((tie) => tie.target !== 'Сота');
        delete next.characters!['Брам'];
        delete next.world!.rules;
        const { profiles, diff } = apply(next, locked);
        const after = byName(profiles, 'Ильва');
        expect(after.core.want).toBeUndefined();
        expect(after.meta['core.want']).toBeUndefined();
        expect(after.ties.map((tie) => tie.target)).toEqual([PLAYER_ID]);
        expect(after.english).toBe('Ilva');
        expect(after.meta.english).toBeUndefined();
        const bram = byName(profiles, 'Брам');
        expect(bram.appetites).toEqual([]);
        expect(bram.core.concept).toBe('');
        expect(bram.ties.map((tie) => tie.target)).toEqual([PLAYER_ID]);
        expect(bram.meta[`ties.${PLAYER_ID}`]).toEqual({ ...AUTHOR, locked: true });
        expect(profiles.rules).toEqual([]);
        expect(profiles.meta['rules.vozchiki-pyut']).toBeUndefined();
        expect(diff.every((entry) => entry.status === 'updated')).toBe(true);
        expect(diff.map((entry) => `${entry.character}:${entry.path}`)).toEqual(
            expect.arrayContaining([
                'ilva:core.want',
                'ilva:ties.sota',
                'bram:appetites.drink',
                ':rules.vozchiki-pyut',
            ]),
        );
        // No intent at all: every mark of the card goes.
        const none = apply(null, profiles).profiles;
        expect(hasCardMarks({ ...none, characters: none.characters.filter((profile) => profile.id !== 'bram') })).toBe(
            false,
        );
        expect(none.intent).toEqual({ at: 1000, sourcesHash: 'h1' });
    });

    it('a full re-read drops what the generator wrote for the people it describes', () => {
        let ilva = { ...emptyProfile('Ильва'), id: 'ilva' };
        ilva.core.need = 'to forgive';
        ilva = setMeta(ilva, 'core.need', { origin: 'generated' });
        const base = { ...emptyCardProfiles('tavern.png'), characters: [ilva] };
        const kept = byName(apply(tavernIntent(), base).profiles, 'Ильва');
        expect(kept.core.need).toBe('to forgive');
        const { profiles, diff } = apply(tavernIntent(), base, { ...OPTIONS, replaceGenerated: true });
        expect(byName(profiles, 'Ильва').core.need).toBeUndefined();
        expect(diff).toContainEqual(
            expect.objectContaining({ character: 'ilva', path: 'core.need', before: 'to forgive', after: undefined }),
        );
    });

    it('keeps the content boundary: no sexual appetite of or toward a minor, no rule aimed at children', () => {
        const intent: CardIntentV1 = {
            version: 1,
            world: { rules: [{ name: 'охота на детей', kind: 'flesh', target: 'class', targetClass: 'дети' }] },
            characters: {
                Сота: { minor: true, appetites: [{ kind: 'flesh' }, { kind: 'thrill' }] },
                Брам: {
                    appetites: [{ kind: 'flesh' }],
                    ties: [{ target: 'Сота', stance: 0, want: 4, gaze: 'mate', appetite: 'flesh' }],
                },
            },
        };
        const { profiles, warnings } = apply(intent);
        expect(byName(profiles, 'Сота')).toMatchObject({ minor: true });
        expect(byName(profiles, 'Сота').appetites.map((item) => item.kind)).toEqual(['thrill']);
        const tie = byName(profiles, 'Брам').ties.find((item) => item.target === 'sota')!;
        expect(tie.want).toBeUndefined();
        expect(profiles.rules).toEqual([]);
        expect(warnings.map((warning) => warning.code).sort()).toEqual([
            'minor-appetite',
            'minor-target',
            'minor-target',
        ]);
    });
});

describe('the reading of the text after the card’s intent', () => {
    const own = apply(partialTavernIntent(), emptyCardProfiles('tavern.png'), {
        ...OPTIONS,
        cardName: TAVERN_CARD.name,
    });
    const read = applyIntent(own.profiles, tavernAnswer(), {
        fidelity: 'strict',
        now: 2000,
        sourcesHash: 'h2',
        sources: intentSources(TAVERN_CARD),
        personaName: TAVERN_CARD.persona.name,
        cardName: TAVERN_CARD.name,
        fromCard: 1,
    });
    const ilva = byName(read.profiles, 'Ильва');

    it('leaves what the author wrote and fills the rest', () => {
        expect(ilva.core.concept).toBe('вдова мятежника, держит трактир назло оккупантам');
        expect(ilva.meta['core.concept']).toEqual(AUTHOR);
        const player = ilva.ties.find((tie) => tie.target === PLAYER_ID)!;
        expect(player.stance).toBe(-1);
        expect(player.reasons.map((reason) => reason.text)).toEqual(['ты имперский курьер']);
        expect(ilva.meta[`ties.${PLAYER_ID}`]).toEqual(AUTHOR);
        // The reading's own fields: the wound with its quote, the tie to Сота.
        expect(ilva.core.wound?.ghost).toBe('The Empire hanged her husband');
        expect(ilva.meta['core.wound']).toMatchObject({ origin: 'author', evidence: ['имперцы повесили её мужа'] });
        expect(isCardAuthored(ilva, 'core.wound')).toBe(false);
        expect(ilva.ties.some((tie) => tie.target === 'sota')).toBe(true);
        // No ceiling derived from the reading's own colder tie, which did not apply.
        expect(ilva.core.stanceBounds).toEqual([]);
        expect(
            read.warnings.some((warning) => warning.code === 'stranger-stance' || warning.code === 'stance-capped'),
        ).toBe(false);
        expect(read.diff.filter((entry) => entry.character === 'ilva' && entry.path === 'core.concept')).toEqual([]);
        expect(read.profiles.intent).toEqual({ at: 2000, sourcesHash: 'h2', fromCard: 1 });
        expect(ilva.meta['core.concept']?.sources).toEqual([CARD_INTENT_SOURCE]);
    });
});
