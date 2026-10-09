import { describe, expect, it } from 'vitest';
import {
    applyIntent,
    applyParsedIntent,
    canonicalPath,
    hostileSignal,
    isStrangerClass,
    mergeIntentResults,
    parseIntentResult,
    quoteFound,
} from '../../src/domain/intent-apply';
import type { ApplyOptions } from '../../src/domain/intent-apply';
import { intentFingerprint, intentSources } from '../../src/domain/intent-prompt';
import { PLAYER_ID } from '../../src/domain/model';
import type { CardProfiles, CharacterProfile } from '../../src/domain/model';
import { emptyCardProfiles, emptyTie, setMeta } from '../../src/domain/profile-defaults';
import {
    TAVERN_CARD,
    VALLEY_CARD,
    agendaAnswer,
    answer,
    appetiteAnswer,
    characterAnswer,
    coreAnswer,
    ev,
    tavernAnswer,
    tieAnswer,
    valleyAnswer,
} from './intent-fixtures';

const TAVERN_SOURCES = intentSources(TAVERN_CARD);
const VALLEY_SOURCES = intentSources(VALLEY_CARD);

function options(patch: Partial<ApplyOptions> = {}): ApplyOptions {
    return {
        fidelity: 'strict',
        now: 1000,
        sourcesHash: intentFingerprint(TAVERN_SOURCES),
        sources: TAVERN_SOURCES,
        personaName: 'Курьер',
        cardName: TAVERN_CARD.name,
        ...patch,
    };
}

function byId(card: CardProfiles, id: string): CharacterProfile {
    const found = card.characters.find((item) => item.id === id);
    if (!found) throw new Error(`no ${id}: ${card.characters.map((item) => item.id).join(', ')}`);
    return found;
}

describe('applyIntent — the tavern card', () => {
    const { profiles, diff, warnings } = applyIntent(emptyCardProfiles('tavern.png'), tavernAnswer(), options());
    const ilva = byId(profiles, 'ilva');

    it('creates the cast: characters and groups, by story names', () => {
        expect(profiles.characters.map((item) => `${item.id}:${item.kind}`)).toEqual([
            'ilva:character',
            'sota:character',
            'bram:character',
            'vozchiki:group',
        ]);
        expect(ilva).toMatchObject({
            name: 'Ильва',
            english: 'Ilva',
            aliases: ['хозяйка'],
            gender: 'female',
            lod: 'draft',
        });
        expect(byId(profiles, 'vozchiki').english).toBe('the carters');
        expect(diff).toEqual([]);
    });

    it('applies evidenced fields with author provenance and quotes', () => {
        expect(ilva.core.concept).toBe("A rebel's widow who keeps the inn in an occupied town");
        expect(ilva.meta['core.concept']).toEqual({
            origin: 'author',
            evidence: ['Вдова мятежника: имперцы повесили её мужа'],
            sources: ['card.description'],
        });
        expect(ilva.core.wound).toEqual({
            ghost: 'The Empire hanged her husband',
            lie: 'No imperial can be trusted',
            triggers: ['an imperial uniform'],
            coping: 'overcompensate',
        });
        expect(ilva.core.temperament).toEqual({ honesty: 1, agreeableness: -2 });
        expect(ilva.core.baselineMood).toEqual({ octant: 'hostile', label: 'мрачная настороженность' });
        expect(ilva.core.proactivity).toBe(6);
        expect(ilva.core.voice).toBe('Деньги вперёд, курьер');
        expect(ilva.core.anchors).toEqual(['sota']);
        expect(ilva.agenda.goals).toEqual([{ id: 'g1', text: 'Wants to keep the inn', kind: 'external', priority: 1 }]);
        expect(ilva.starts).toEqual([
            { greeting: 0, present: true, doing: 'counting the takings', goal: 'get paid in advance' },
        ]);
        expect(byId(profiles, 'sota').starts).toEqual([
            { greeting: 1, present: true, doing: 'wiping tables', goal: 'get a look at the stranger' },
        ]);
        expect(byId(profiles, 'vozchiki').starts).toEqual([{ greeting: 0, present: true, doing: 'dice' }]);
    });

    it('keeps fields read without a usable quote as inferred, and refuses the invented quote (strict)', () => {
        // No quote at all: still the reading, marked «from the card, no quote».
        expect(ilva.core.values.top).toEqual(['benevolence', 'self-direction', 'tradition']);
        expect(ilva.meta['core.values']).toEqual({ origin: 'inferred' });
        // An invented quote is not evidence: the field stays, without it.
        expect(ilva.core.want).toBe('Wants every guest to feel welcome');
        expect(ilva.meta['core.want']).toEqual({ origin: 'inferred' });
        expect(warnings).toContainEqual({
            code: 'quote-unverified',
            name: 'Ильва',
            path: 'core.want',
            detail: 'Ильва любит всех гостей и рада каждому',
        });
        // One note per character, not one per field.
        const notes = warnings.filter((item) => item.code === 'inferred');
        expect(notes.find((item) => item.name === 'Ильва')).toMatchObject({ code: 'inferred', detail: '2' });
        expect(new Set(notes.map((item) => item.name)).size).toBe(notes.length);
    });

    it('keeps the intended hostility toward the player, with keys and the author ceiling', () => {
        const toPlayer = ilva.ties.find((item) => item.target === PLAYER_ID)!;
        expect(toPlayer.stance).toBe(-2);
        expect(toPlayer.behaviour).toBe('takes his coin, gives nothing back');
        expect(toPlayer.reasons).toEqual([
            { id: 'author-1', text: 'an imperial', delta: -1, scenesLeft: null, stacks: 1 },
            { id: 'author-2', text: 'the Empire hanged her husband', delta: -1, scenesLeft: null, stacks: 1 },
        ]);
        expect(ilva.meta[`ties.${PLAYER_ID}`]!.sources).toEqual(['card.description', 'card.notes']);
        expect(ilva.core.keys).toEqual(['earns trust slowly, only through deeds']);
        expect(ilva.core.stanceBounds).toEqual([{ target: PLAYER_ID, max: 0 }]);
        expect(ilva.ties.find((item) => item.target === 'sota')).toMatchObject({ stance: 3, intent: 'protect' });
        expect(byId(profiles, 'bram').ties[0]).toMatchObject({ target: PLAYER_ID, stance: 0, intent: 'use' });
        expect(byId(profiles, 'sota').core.stanceBounds).toEqual([]);
    });

    it('reads appetites with a default style', () => {
        expect(byId(profiles, 'bram').appetites).toEqual([
            expect.objectContaining({ id: 'drink', kind: 'drink', label: 'выпивка', baseline: 3, style: 'buyer' }),
        ]);
    });

    it('sets the world tone, reputation, invariants and the reading stamp', () => {
        expect(profiles.worldTone).toBe('hostile');
        expect(profiles.meta.worldTone).toMatchObject({ origin: 'author', evidence: ['в оккупированном городке'] });
        expect(profiles.reputation).toEqual([
            { among: '*', label: 'имперский курьер', stance: -1, greeting: -1, evidence: ['имперский курьер'] },
        ]);
        expect(profiles.invariants).toEqual(['Ilva stays hostile to imperials until deeds earn her trust']);
        expect(profiles.intent).toEqual({ at: 1000, sourcesHash: intentFingerprint(TAVERN_SOURCES) });
        expect(applyIntent(emptyCardProfiles('t'), answer(), options({ model: 'flash' })).profiles.intent?.model).toBe(
            'flash',
        );
    });
});

describe('applyIntent — anti-softening', () => {
    it('caps a softened stance at −1 when the quotes speak of hatred', () => {
        const { profiles, warnings } = applyIntent(emptyCardProfiles('tavern.png'), tavernAnswer(1), options());
        const ilva = byId(profiles, 'ilva');
        expect(ilva.ties.find((item) => item.target === PLAYER_ID)!.stance).toBe(-1);
        expect(warnings).toContainEqual({
            code: 'stance-capped',
            name: 'Ильва',
            path: `ties.${PLAYER_ID}`,
            detail: '1 → -1',
        });
        expect(ilva.core.stanceBounds).toEqual([{ target: PLAYER_ID, max: 0 }]);
    });

    it('sets no author ceiling outside strict fidelity', () => {
        const { profiles } = applyIntent(
            emptyCardProfiles('tavern.png'),
            tavernAnswer(),
            options({ fidelity: 'balanced' }),
        );
        expect(byId(profiles, 'ilva').core.stanceBounds).toEqual([]);
    });

    it('turns cold words about strangers into the stance toward the newcomer player', () => {
        const guard = characterAnswer('Стражник', {
            ties: [tieAnswer('чужаки', 1, { reasons: ['despises outsiders'], behaviour: 'checks papers twice' })],
            evidence: [ev('ties.чужаки', 'Она ненавидит имперцев и к чужакам холодна', 'S1')],
        });
        const { profiles, warnings } = applyIntent(emptyCardProfiles('t'), answer({ characters: [guard] }), options());
        const ties = byId(profiles, 'strazhnik').ties;
        expect(ties.find((item) => item.target === 'чужаки')!.stance).toBe(-1);
        expect(ties.find((item) => item.target === PLAYER_ID)).toMatchObject({
            stance: -1,
            behaviour: 'checks papers twice',
        });
        expect(warnings.map((item) => item.code)).toEqual(expect.arrayContaining(['stance-capped', 'stranger-stance']));
    });

    it('keeps an evidenced personal stance over the strangers rule', () => {
        const sister = characterAnswer('Сота', {
            ties: [
                tieAnswer('strangers', -2, { reasons: ['distrusts outsiders'] }),
                tieAnswer('PLAYER', 2, { reasons: ['he is her cousin'] }),
            ],
            evidence: [
                ev('ties.strangers', 'к чужакам холодна', 'S1'),
                ev('ties.PLAYER', 'украдкой разглядывает {{user}}', 'S4'),
            ],
        });
        const { profiles } = applyIntent(emptyCardProfiles('t'), answer({ characters: [sister] }), options());
        expect(byId(profiles, 'sota').ties.find((item) => item.target === PLAYER_ID)!.stance).toBe(2);
    });
});

describe('applyIntent — fidelity', () => {
    it('balanced keeps paraphrased quotes with a warning', () => {
        const { profiles, warnings } = applyIntent(
            emptyCardProfiles('t'),
            tavernAnswer(),
            options({ fidelity: 'balanced' }),
        );
        expect(byId(profiles, 'ilva').core.want).toBe('Wants every guest to feel welcome');
        expect(warnings.some((item) => item.code === 'quote-unverified')).toBe(true);
    });

    it('free keeps unevidenced fields as inferred and takes paraphrased quotes silently', () => {
        const { profiles, warnings } = applyIntent(
            emptyCardProfiles('t'),
            tavernAnswer(),
            options({ fidelity: 'free' }),
        );
        const ilva = byId(profiles, 'ilva');
        expect(ilva.core.values.top).toEqual(['benevolence', 'self-direction', 'tradition']);
        expect(ilva.meta['core.values']).toEqual({ origin: 'inferred' });
        expect(ilva.meta['core.want']).toMatchObject({ origin: 'author' });
        expect(warnings.filter((item) => item.code === 'quote-unverified')).toEqual([]);
    });

    it('takes quotes on trust without the sources, keeping the refs', () => {
        const { profiles } = applyIntent(emptyCardProfiles('t'), tavernAnswer(), options({ sources: undefined }));
        expect(byId(profiles, 'ilva').core.want).toBe('Wants every guest to feel welcome');
        expect(byId(profiles, 'ilva').meta['core.concept']!.sources).toEqual(['S1']);
    });
});

describe('applyIntent — re-reading', () => {
    const first = applyIntent(emptyCardProfiles('tavern.png'), tavernAnswer(), options()).profiles;

    it('never overwrites the user’s edits or locks, and lists the differences', () => {
        let ilva = byId(first, 'ilva');
        ilva = { ...ilva, core: { ...ilva.core, concept: 'My own concept' } };
        ilva = setMeta(ilva, 'core.concept', { origin: 'user', locked: false });
        ilva = setMeta(ilva, `ties.${PLAYER_ID}`, { origin: 'author', locked: true });
        ilva = {
            ...ilva,
            ties: ilva.ties.map((item) =>
                item.target === 'sota'
                    ? {
                          ...item,
                          reasons: [
                              ...item.reasons,
                              { id: 'story-1', text: 'she lied', delta: -1, scenesLeft: 3, stacks: 1 },
                          ],
                      }
                    : item,
            ),
        };
        const current = { ...first, characters: first.characters.map((item) => (item.id === 'ilva' ? ilva : item)) };

        const next = tavernAnswer(-3) as { characters: Record<string, unknown>[] };
        const changed = next.characters[0]!;
        changed.name = 'хозяйка';
        changed.role = 'landlady';
        changed.core = { ...(changed.core as object), concept: 'A widow who hates the Empire', voice: 'Три монеты' };
        changed.evidence = [...(changed.evidence as object[]), ev('core.voice', 'Комната — три монеты', 'S3')];
        changed.ties = [
            tieAnswer('PLAYER', -3, { reasons: ['an imperial'] }),
            tieAnswer('Сота', 3, { reasons: ['her only child'], intent: 'protect' }),
        ];
        const { profiles, diff } = applyIntent(current, next, options());
        const after = byId(profiles, 'ilva');
        expect(profiles.characters).toHaveLength(4);
        expect(after.core.concept).toBe('My own concept');
        expect(after.ties.find((item) => item.target === PLAYER_ID)!.stance).toBe(-2);
        expect(after.role).toBe('landlady');
        expect(after.core.voice).toBe('Три монеты');
        expect(after.ties.find((item) => item.target === 'sota')!.reasons.map((item) => item.id)).toEqual([
            'author-1',
            'story-1',
        ]);
        expect(diff).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    character: 'ilva',
                    path: 'role',
                    before: 'innkeeper',
                    after: 'landlady',
                    status: 'updated',
                }),
                expect.objectContaining({
                    character: 'ilva',
                    path: 'core.concept',
                    before: 'My own concept',
                    after: 'A widow who hates the Empire',
                    status: 'kept-user',
                }),
                expect.objectContaining({ character: 'ilva', path: `ties.${PLAYER_ID}`, status: 'kept-locked' }),
                expect.objectContaining({ character: 'ilva', path: 'ties.sota', status: 'updated' }),
            ]),
        );
        expect(diff).toContainEqual({
            character: 'ilva',
            name: 'Ильва',
            path: 'core.voice',
            before: 'Деньги вперёд, курьер',
            after: 'Три монеты',
            status: 'updated',
        });
        expect(diff.find((item) => item.path === 'core.wound')).toBeUndefined();
    });

    it('keeps the user’s world tone and merges new reputation and invariants', () => {
        const mine = setMeta({ ...first, worldTone: 'welcoming' as const }, 'worldTone', { origin: 'user' });
        const { profiles, diff } = applyIntent(mine, tavernAnswer(), options());
        expect(profiles.worldTone).toBe('welcoming');
        expect(diff).toContainEqual({
            character: '',
            name: '',
            path: 'worldTone',
            before: 'welcoming',
            after: 'hostile',
            status: 'kept-user',
        });
        expect(profiles.reputation).toHaveLength(1);
        expect(profiles.invariants).toHaveLength(1);
    });
});

describe('applyIntent — appetite rules (decision В17)', () => {
    const valley = applyIntent(
        emptyCardProfiles('valley.png'),
        valleyAnswer(),
        options({ sources: VALLEY_SOURCES, personaName: 'Герой', cardName: VALLEY_CARD.name }),
    );

    it('keeps a player target when the scenario names the hero', () => {
        const rule = valley.profiles.rules[0]!;
        expect(rule.id).toBe('every-monster-girl-sees-the-hero-as-a-ma');
        expect(rule).toMatchObject({
            holders: 'монстродевы долины',
            kind: 'flesh',
            label: 'пара',
            source: 'world',
            target: { mode: 'player' },
            styles: { raider: 2, siren: 1, duelist: 1 },
            choosiness: 1,
        });
        expect(valley.profiles.meta[`rules.${rule.id}`]!.origin).toBe('author');
        expect(valley.warnings.find((item) => item.code === 'rule-target')).toBeUndefined();
    });

    it('links each one’s appetite to the rule and keeps stance and desire apart', () => {
        const kira = byId(valley.profiles, 'kira');
        expect(kira.appetites[0]).toMatchObject({
            id: 'flesh',
            target: { mode: 'player' },
            baseline: 4,
            style: 'raider',
            rule: valley.profiles.rules[0]!.id,
        });
        expect(kira.ties[0]).toMatchObject({ target: PLAYER_ID, stance: -1, want: 4, gaze: 'prey', appetite: 'flesh' });
        const seraphina = byId(valley.profiles, 'serafina');
        expect(seraphina.ties[0]).toMatchObject({ stance: 1, want: 4, gaze: 'mate', appetite: 'flesh' });
        expect(seraphina.appetites[0]!.affectionOnset).toBe('possible');
        expect(byId(valley.profiles, 'monstrodevy-doliny').kind).toBe('group');
    });

    it('turns «the player» into a class when no quote names him', () => {
        const raw = valleyAnswer() as { rules: Record<string, unknown>[] };
        raw.rules[0]!.evidence = [ev('rules', 'каждая монстродева видит в нём пару', 'S2')];
        raw.rules[0]!.targetClass = 'human men';
        const result = applyIntent(
            emptyCardProfiles('v'),
            raw,
            options({ sources: VALLEY_SOURCES, personaName: 'Герой' }),
        );
        expect(result.profiles.rules[0]!.target).toEqual({ mode: 'class', class: 'human men' });
        expect(result.warnings).toContainEqual({
            code: 'rule-target',
            name: 'every monster girl sees the hero as a mate',
        });
    });

    it('keeps a class target as a class (a custom of raiders)', () => {
        const raid = answer({
            rules: [
                {
                    name: 'raiders take captives by right',
                    holders: 'гоблины Чёрного Брода',
                    kind: 'plunder',
                    label: '',
                    source: 'culture',
                    target: 'class',
                    targetClass: 'travellers on the road',
                    intensity: { zero: 0, low: 0, mid: 0, high: 0 },
                    styles: [{ style: 'raider', weight: 1 }],
                    choosiness: 0,
                    exclusivity: 'shared',
                    affectionOnset: 'rare',
                    groupMode: 'pack',
                    evidence: [ev('rules', 'берут пленников по праву набега', 'S1')],
                },
            ],
        });
        const result = applyIntent(emptyCardProfiles('ford'), raid, options({ sources: undefined }));
        expect(result.profiles.rules[0]).toMatchObject({
            target: { mode: 'class', class: 'travellers on the road' },
            label: 'raiders take captives by right',
            intensity: { zero: 0.2, low: 0.25, mid: 0.25, high: 0.3 },
            groupMode: 'pack',
        });
        const again = applyIntent(result.profiles, raid, options({ sources: undefined }));
        expect(again.profiles.rules).toHaveLength(1);
        expect(again.diff).toEqual([]);
        const locked = setMeta(result.profiles, `rules.${result.profiles.rules[0]!.id}`, {
            origin: 'user',
            locked: true,
        });
        const changed = JSON.parse(JSON.stringify(raid)) as { rules: Record<string, unknown>[] };
        changed.rules[0]!.choosiness = 4;
        const kept = applyIntent(locked, changed, options({ sources: undefined }));
        expect(kept.profiles.rules[0]!.choosiness).toBe(0);
        expect(kept.diff[0]).toMatchObject({ path: `rules.${result.profiles.rules[0]!.id}`, status: 'kept-locked' });
        const open = applyIntent(result.profiles, changed, options({ sources: undefined }));
        expect(open.profiles.rules[0]!.choosiness).toBe(4);
        expect(open.diff[0]).toMatchObject({ status: 'updated' });
        const unevidenced = JSON.parse(JSON.stringify(raid)) as { rules: Record<string, unknown>[] };
        unevidenced.rules[0]!.evidence = [];
        const inferred = applyIntent(emptyCardProfiles('x'), unevidenced, options()).profiles;
        expect(inferred.rules).toHaveLength(1);
        expect(inferred.rules[0]!.evidence).toBeUndefined();
        expect(inferred.meta[`rules.${inferred.rules[0]!.id}`]).toEqual({ origin: 'inferred' });
    });
});

describe('applyIntent — the content boundary', () => {
    it('flags minors, drops their sexual appetites and anyone’s desire aimed at them', () => {
        const sota = characterAnswer('Сота', {
            minor: true,
            appetites: [appetiteAnswer('flesh'), appetiteAnswer('food')],
            evidence: [
                ev('appetites.flesh', 'Сота вытирает столы', 'S4'),
                ev('appetites.food', 'Сота вытирает столы', 'S4'),
            ],
        });
        const bram = characterAnswer('Брам', {
            appetites: [appetiteAnswer('flesh')],
            ties: [tieAnswer('Сота', 0, { want: 3, gaze: 'mate', appetite: 'flesh' })],
            evidence: [ev('appetites.flesh', 'Наёмник Брам пьёт', 'S1'), ev('ties.Сота', 'Её дочь Сота', 'S1')],
        });
        const { profiles, warnings } = applyIntent(
            emptyCardProfiles('t'),
            answer({ characters: [sota, bram] }),
            options(),
        );
        const minor = byId(profiles, 'sota');
        expect(minor.minor).toBe(true);
        expect(minor.appetites.map((item) => item.kind)).toEqual(['food']);
        const tie = byId(profiles, 'bram').ties[0]!;
        expect(tie.target).toBe('sota');
        expect(tie.want).toBeUndefined();
        expect(tie.gaze).toBeUndefined();
        expect(warnings).toContainEqual({ code: 'minor-appetite', name: 'Сота' });
        expect(warnings).toContainEqual({ code: 'minor-target', name: 'Брам', path: 'ties.sota' });
    });

    it('drops sexual rules aimed at children', () => {
        const rule = (valleyAnswer() as { rules: Record<string, unknown>[] }).rules[0]!;
        const bad = answer({ rules: [{ ...rule, target: 'class', targetClass: 'children of the valley' }] });
        const { profiles, warnings } = applyIntent(emptyCardProfiles('v'), bad, options({ sources: undefined }));
        expect(profiles.rules).toEqual([]);
        expect(warnings).toContainEqual({ code: 'minor-target', name: 'every monster girl sees the hero as a mate' });
    });

    it('also cleans a minor’s stored appetites and the ties of the whole card', () => {
        const current = applyIntent(emptyCardProfiles('t'), tavernAnswer(), options()).profiles;
        const bram = byId(current, 'bram');
        const withTie: CharacterProfile = {
            ...bram,
            ties: [...bram.ties, { ...emptyTie('sota', 0), want: 2 }],
            appetites: [...bram.appetites, { ...bram.appetites[0]!, id: 'flesh', kind: 'flesh' }],
        };
        const seeded = {
            ...current,
            characters: current.characters.map((item) => (item.id === 'bram' ? withTie : item)),
        };
        const minorAnswer = answer({ characters: [characterAnswer('Сота', { minor: true })] });
        const { profiles } = applyIntent(seeded, minorAnswer, options());
        expect(byId(profiles, 'bram').ties.find((item) => item.target === 'sota')!.want).toBeUndefined();
    });
});

describe('applyIntent — several parts and bad answers', () => {
    it('merges parts: same character by name or English name, the colder stance wins', () => {
        const part1 = answer({
            characters: [
                characterAnswer('Ильва', {
                    english: 'Ilva',
                    ties: [tieAnswer('PLAYER', -1, { reasons: ['an imperial'] })],
                    evidence: [ev('ties.PLAYER', 'Она ненавидит имперцев', 'S1')],
                }),
            ],
            rules: [],
            reputation: [
                {
                    greeting: 0,
                    among: 'guards',
                    label: 'a courier',
                    stance: 0,
                    evidence: [ev('r', 'имперский курьер', 'S2')],
                },
            ],
        });
        const part2 = answer({
            worldTone: { tone: 'hostile', evidence: [ev('worldTone', 'в оккупированном городке', 'S1')] },
            characters: [
                characterAnswer('Ilva', {
                    aliases: ['Ильвушка'],
                    core: coreAnswer({ tactics: ['silence'] }),
                    ties: [
                        tieAnswer('PLAYER', -2, { reasons: ['the Empire hanged her husband'], changeIf: ['deeds'] }),
                    ],
                    evidence: [ev('core.tactics', 'бросает она и отворачивается', 'S3')],
                }),
                characterAnswer('Фенн', { agenda: agendaAnswer({ dream: 'sleep' }) }),
            ],
            reputation: [{ greeting: 0, among: 'Guards', label: 'a spy', stance: -1, evidence: [] }],
            invariants: [{ text: 'x', evidence: [] }],
        });
        const { profiles, warnings } = applyIntent(emptyCardProfiles('t'), [part1, part2], options());
        const ilva = byId(profiles, 'ilva');
        expect(ilva.aliases).toEqual(['Ильвушка']);
        expect(ilva.english).toBe('Ilva');
        expect(ilva.core.tactics).toEqual(['silence']);
        const toPlayer = ilva.ties.find((item) => item.target === PLAYER_ID)!;
        expect(toPlayer.stance).toBe(-2);
        expect(toPlayer.reasons.map((item) => item.text)).toEqual(['an imperial', 'the Empire hanged her husband']);
        expect(profiles.worldTone).toBe('hostile');
        expect(profiles.reputation.map((item) => item.label)).toEqual(['a courier']);
        expect(byId(profiles, 'fenn').agenda.dream).toBe('sleep');
        expect(byId(profiles, 'fenn').meta['agenda.dream']).toEqual({ origin: 'inferred' });
        expect(warnings).toContainEqual({ code: 'inferred', name: 'Фенн', detail: '1' });
        expect(profiles.invariants).toEqual(['x']);
        expect(profiles.meta.invariants).toEqual({ origin: 'inferred' });
    });

    it('warns about an answer that is not an object and changes nothing but the stamp', () => {
        const before = emptyCardProfiles('t');
        const { profiles, warnings } = applyIntent(before, 'not json', options());
        expect(warnings).toEqual([{ code: 'bad-answer' }]);
        expect({ ...profiles, intent: undefined }).toEqual({ ...before, intent: undefined });
        expect(applyIntent(before, [], options()).warnings).toEqual([{ code: 'bad-answer' }]);
    });

    it('makes the card’s own character a portrait and merges duplicates within one answer', () => {
        const twice = answer({
            characters: [
                characterAnswer('Трактир «Рог»'),
                characterAnswer('Ильва', { role: 'innkeeper' }),
                characterAnswer('ильва', { species: 'human' }),
            ],
        });
        const { profiles } = applyIntent(emptyCardProfiles('t'), twice, options());
        expect(profiles.characters.map((item) => `${item.id}:${item.lod}`)).toEqual([
            'traktir-rog:portrait',
            'ilva:draft',
        ]);
        expect(byId(profiles, 'ilva')).toMatchObject({ role: 'innkeeper', species: 'human' });
        const existing = applyIntent(
            profiles,
            answer({ characters: [characterAnswer('Ильва'), characterAnswer('ильва', { role: 'host' })] }),
            options(),
        );
        expect(byId(existing.profiles, 'ilva').role).toBe('host');
    });

    it('applies an already parsed reading', () => {
        const parsed = parseIntentResult(tavernAnswer(), { sources: TAVERN_SOURCES })!;
        const { profiles } = applyParsedIntent(emptyCardProfiles('t'), parsed, options());
        expect(byId(profiles, 'ilva').ties.find((item) => item.target === PLAYER_ID)!.stance).toBe(-2);
    });
});

describe('parseIntentResult', () => {
    it('clamps and checks every value', () => {
        const parsed = parseIntentResult(
            {
                worldTone: { tone: 'evil', evidence: 'x' },
                characters: [
                    {
                        name: '',
                        english: 'Bram',
                        kind: 'mob',
                        gender: 'x',
                        core: {
                            values: ['power', 'x'],
                            temperament: { honesty: 9 },
                            proactivity: 99,
                            corruption: -7,
                            mood: { octant: 'x', label: '' },
                            bounds: [
                                { target: 'PLAYER', min: null, max: 1 },
                                { target: '', max: 1 },
                                { target: 'x', min: null, max: null },
                            ],
                            dark: { ruthless: 'yes' },
                        },
                        agenda: {
                            goals: [{ text: 'g', priority: 7 }, { text: '' }],
                            intentions: [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
                            front: { impulse: 'take the port', segments: 99 },
                        },
                        appetites: [{ kind: 'drink', baseline: 12, style: 'x', target: 'nope' }],
                        ties: [
                            { target: 'PLAYER', stance: 9, want: -2, gaze: 'x' },
                            { target: 'player', stance: 0 },
                            { target: '' },
                        ],
                        starts: [{ greeting: 2, present: false }, { greeting: 2 }],
                        evidence: [
                            { path: 'core.values', quote: '«' + 'x'.repeat(400) + '»', source: '[s1]' },
                            { quote: '' },
                        ],
                    },
                    { name: '' },
                    'x',
                ],
                rules: [
                    { name: '', holders: '' },
                    {
                        holders: 'goblins',
                        styles: [
                            { style: 'raider', weight: 500 },
                            { style: 'x', weight: 1 },
                        ],
                    },
                ],
                reputation: [{ label: '' }, { label: 'a thief', greeting: 'x' }],
                invariants: [{ text: '' }, { text: 'y', evidence: [] }],
            },
            {},
        )!;
        const bram = parsed.characters[0]!;
        expect(parsed.characters).toHaveLength(1);
        expect(parsed.worldTone).toEqual({ tone: '', evidence: [] });
        // A name given only in English is the name, and stays the English name too.
        expect(bram).toMatchObject({ name: 'Bram', english: 'Bram', kind: 'character', gender: '', russian: [] });
        expect(bram.core.values).toEqual({ top: ['power'], sacrifice: undefined });
        expect((bram.core.temperament as Record<string, number>).honesty).toBe(2);
        expect(bram.core.proactivity).toBe(10);
        expect(bram.core.corruption).toBeUndefined();
        expect(bram.core.baselineMood).toBeUndefined();
        expect(bram.core.stanceBounds).toEqual([{ target: 'PLAYER', min: undefined, max: 1 }]);
        expect((bram.agenda.goals as unknown[]).length).toBe(1);
        expect((bram.agenda.intentions as unknown[]).length).toBe(2);
        expect((bram.agenda.front as { segments: number }).segments).toBe(8);
        expect(bram.appetites[0]).toMatchObject({ kind: 'drink', baseline: 5, style: '', target: 'thing' });
        expect(bram.ties).toHaveLength(1);
        expect(bram.ties[0]).toMatchObject({ stance: 3, want: 0, gaze: '' });
        expect(bram.starts).toEqual([{ greeting: 2, present: false, doing: '', goal: '' }]);
        expect(bram.evidence).toHaveLength(1);
        expect(bram.evidence[0]!.quote.length).toBe(160);
        expect(bram.evidence[0]!.source).toBe('S1');
        expect(parsed.rules).toHaveLength(1);
        expect(parsed.rules[0]).toMatchObject({ name: 'goblins', holders: 'goblins', styles: { raider: 100 } });
        expect(parsed.reputation).toEqual([{ greeting: -1, among: '*', label: 'a thief', stance: 0, evidence: [] }]);
        expect(parsed.invariants).toEqual([{ text: 'y', evidence: [] }]);
        expect(parseIntentResult(null)).toBeNull();
        expect(parseIntentResult([])).toBeNull();
    });

    it('checks quotes against the cited source, finds them elsewhere, or marks them', () => {
        const parsed = parseIntentResult(
            answer({
                characters: [
                    characterAnswer('Ильва', {
                        evidence: [
                            ev('a', 'Она ненавидит имперцев', 'S1'),
                            ev('b', 'Деньги вперёд, курьер', 'S1'),
                            ev('c', 'invented words entirely here', 'S1'),
                            ev('d', 'x', 'S99'),
                        ],
                    }),
                ],
            }),
            { sources: TAVERN_SOURCES, cardName: TAVERN_CARD.name, personaName: 'Курьер' },
        )!;
        expect(parsed.characters[0]!.evidence.map((item) => `${item.path}:${item.source}:${item.verified}`)).toEqual([
            'a:card.description:true',
            'b:greeting:0:true',
            'c:card.description:false',
            'd:S99:false',
        ]);
    });
});

describe('mergeIntentResults', () => {
    it('skips nulls and merges rules by name', () => {
        const a = parseIntentResult(answer({ rules: [{ name: 'r', holders: 'h', evidence: [ev('x', 'q', 'S1')] }] }))!;
        const b = parseIntentResult(answer({ rules: [{ name: 'R', holders: 'h', evidence: [ev('y', 'w', 'S2')] }] }))!;
        const merged = mergeIntentResults([a, null, b]);
        expect(merged.rules).toHaveLength(1);
        expect(merged.rules[0]!.evidence.map((item) => item.path)).toEqual(['x', 'y']);
    });

    it('merges appetites by kind and fills the first reading’s gaps', () => {
        const a = parseIntentResult(
            answer({
                characters: [
                    characterAnswer('Брам', {
                        appetites: [appetiteAnswer('drink')],
                        kind: 'group',
                        starts: [{ greeting: 0, present: true, doing: '', goal: '' }],
                    }),
                ],
            }),
        )!;
        const b = parseIntentResult(
            answer({
                characters: [
                    characterAnswer('Брам', {
                        gender: 'male',
                        minor: false,
                        appetites: [
                            appetiteAnswer('drink', { label: 'брага', triggers: ['quarrels'] }),
                            appetiteAnswer('thrill'),
                        ],
                        starts: [
                            { greeting: 0, present: false, doing: 'x', goal: '' },
                            { greeting: 1, present: true, doing: '', goal: '' },
                        ],
                        ties: [tieAnswer('PLAYER', 1, { want: 2, gaze: 'instrument' })],
                    }),
                ],
            }),
        )!;
        const c = parseIntentResult(
            answer({
                characters: [
                    characterAnswer('Брам', {
                        ties: [tieAnswer('player', 0, { intent: 'use', want: 4, appetite: 'thrill' })],
                    }),
                ],
            }),
        )!;
        const merged = mergeIntentResults([a, b, c]).characters[0]!;
        expect(merged.kind).toBe('group');
        expect(merged.gender).toBe('male');
        expect(merged.appetites.map((item) => `${item.kind}:${item.label}:${item.triggers.join('|')}`)).toEqual([
            'drink:брага:quarrels',
            'thrill::',
        ]);
        expect(merged.starts.map((item) => item.greeting)).toEqual([0, 1]);
        expect(merged.ties[0]).toMatchObject({
            stance: 0,
            intent: 'use',
            want: 4,
            gaze: 'instrument',
            appetite: 'thrill',
        });
    });
});

describe('hostileSignal and strangers', () => {
    it('finds hostility in English and Russian', () => {
        expect(hostileSignal(['She despises outsiders'])).toBe(true);
        expect(hostileSignal(['cold to strangers'])).toBe(true);
        expect(hostileSignal(['Она ненавидит имперцев'])).toBe(true);
        expect(hostileSignal(['смотрит свысока'])).toBe(true);
        expect(hostileSignal(['Не терпит чужаков'])).toBe(true);
        expect(hostileSignal(['холодна к чужакам'])).toBe(true);
        expect(hostileSignal(['', 'warm and kind'])).toBe(false);
        expect(hostileSignal(['любит гостей'])).toBe(false);
    });

    it('ignores negated hostility', () => {
        expect(hostileSignal(['she is not cruel'])).toBe(false);
        expect(hostileSignal(['no longer hates him'])).toBe(false);
        expect(hostileSignal(['never really hated anyone'])).toBe(false);
        expect(hostileSignal(['она не ненавидит его'])).toBe(false);
        expect(hostileSignal(['никогда не презирала гостей'])).toBe(false);
        expect(hostileSignal(['not cruel, but she hates liars'])).toBe(true);
    });

    it('knows classes that mean newcomers', () => {
        expect(isStrangerClass('strangers')).toBe(true);
        expect(isStrangerClass('чужаки')).toBe(true);
        expect(isStrangerClass('приезжие')).toBe(true);
        expect(isStrangerClass('imperials')).toBe(false);
    });
});

describe('canonicalPath', () => {
    const resolve = (target: string) => (target === 'PLAYER' ? PLAYER_ID : target.toLowerCase());

    it('maps the answer’s paths to profile paths', () => {
        expect(canonicalPath('core.drivesHigh', resolve, [])).toBe('core.drives');
        expect(canonicalPath('core.red_lines_never', resolve, [])).toBe('core.redLines');
        expect(canonicalPath('characters[0].core.mood', resolve, [])).toBe('core.baselineMood');
        expect(canonicalPath('character.agenda.ifIgnored', resolve, [])).toBe('agenda.ifIgnored');
        expect(canonicalPath('values', resolve, [])).toBe('core.values');
        expect(canonicalPath('goals', resolve, [])).toBe('agenda.goals');
        expect(canonicalPath('ties.PLAYER', resolve, [])).toBe(`ties.${PLAYER_ID}`);
        expect(canonicalPath('tie.Mr. Smith', resolve, [])).toBe('ties.mr. smith');
        expect(canonicalPath('appetites.drink', resolve, [])).toBe('appetites.drink');
        expect(canonicalPath('appetites[1]', resolve, ['drink', 'thrill'])).toBe('appetites.thrill');
        expect(canonicalPath('appetite', resolve, ['flesh'])).toBe('appetites.flesh');
        expect(canonicalPath('appetites.x', resolve, ['flesh', 'drink'])).toBeNull();
        expect(canonicalPath('starts.0', resolve, [])).toBe('starts.0');
        expect(canonicalPath('start', resolve, [])).toBe('starts');
        expect(canonicalPath('role', resolve, [])).toBe('role');
        expect(canonicalPath('core.nonsense', resolve, [])).toBeNull();
        expect(canonicalPath('agenda.x', resolve, [])).toBeNull();
        expect(canonicalPath('ties', resolve, [])).toBeNull();
        expect(canonicalPath('whatever', resolve, [])).toBeNull();
        expect(canonicalPath('  ', resolve, [])).toBeNull();
    });
});

describe('quoteFound', () => {
    const text = 'Ильва — хозяйка трактира. {{char}} ненавидит имперцев… и к чужакам холодна.';

    it('accepts verbatim quotes, quotes around «…», and small edits', () => {
        expect(quoteFound('ИЛЬВА — хозяйка трактира', text)).toBe(true);
        expect(quoteFound('Ильва — хозяйка… к чужакам холодна', text)).toBe(true);
        expect(quoteFound('Ильва ненавидит имперцев и к чужакам холодна', text, ['Ильва'])).toBe(true);
    });

    it('refuses invented quotes', () => {
        expect(quoteFound('любит всех гостей и рада каждому', text)).toBe(false);
        expect(quoteFound('ab', text)).toBe(false);
    });
});
