import { describe, expect, it } from 'vitest';
import {
    isInflectionOf,
    matchName,
    nameScore,
    normalizeName,
    presentFromDes,
    presentFromText,
    russianStem,
} from '../../src/domain/presence';
import type { NamedProfile } from '../../src/domain/presence';
import type { DesCharacter } from '../../src/shared/contracts';

const CAST: NamedProfile[] = [
    { id: 'ilva', name: 'Ильва', aliases: ['хозяйка'], english: 'Ilva' },
    { id: 'bram', name: 'Брам', aliases: [], english: 'Bram' },
    { id: 'sota', name: 'Сота', aliases: [] },
    { id: 'fenn', name: 'старый Фенн', aliases: [] },
    { id: 'semen', name: 'Семён', aliases: ['Сёма'] },
    { id: 'carters', name: 'возчики', aliases: ['the carters'], kind: 'group' },
];

function des(name: string, present = true): DesCharacter {
    return { name, present, details: {} };
}

describe('normalisation and stems', () => {
    it('folds case, ё, possessives and punctuation', () => {
        expect(normalizeName('  СЁМА  ')).toBe('сема');
        expect(normalizeName("Bram's")).toBe('bram');
        expect(normalizeName('«Ильва», хозяйка!')).toBe('ильва хозяйка');
    });

    it('cuts one final vowel or soft sign', () => {
        expect(russianStem('ильва')).toBe('ильв');
        expect(russianStem('дмитрий')).toBe('дмитри');
        expect(russianStem('брам')).toBe('брам');
    });

    it('knows Russian case forms from a stem of four letters', () => {
        expect(isInflectionOf('ильвы', 'ильва')).toBe(true);
        expect(isInflectionOf('ильвой', 'ильва')).toBe(true);
        expect(isInflectionOf('браму', 'брам')).toBe(true);
        expect(isInflectionOf('дмитрием', 'дмитрий')).toBe(true);
        expect(isInflectionOf('марией', 'мария')).toBe(true);
        expect(isInflectionOf('ильвин', 'ильва')).toBe(true);
        expect(isInflectionOf('ильва', 'ильва')).toBe(false);
        expect(isInflectionOf('ильвастан', 'ильва')).toBe(false);
        expect(isInflectionOf('bramu', 'bram')).toBe(false);
    });

    it('needs four letters of stem, or three for a capitalised word of a long enough name', () => {
        expect(isInflectionOf('соту', 'сота')).toBe(false);
        expect(isInflectionOf('соту', 'сота', false, true)).toBe(true);
        expect(isInflectionOf('ули', 'ула', false, true)).toBe(false);
    });

    it('strict mode refuses gender pairs, possessives and bare stems', () => {
        expect(isInflectionOf('александра', 'александр')).toBe(true);
        expect(isInflectionOf('александра', 'александр', true)).toBe(false);
        expect(isInflectionOf('евгения', 'евгений', true)).toBe(false);
        expect(isInflectionOf('александру', 'александр', true)).toBe(true);
        expect(isInflectionOf('ильвин', 'ильва', true)).toBe(false);
        expect(isInflectionOf('александр', 'александра')).toBe(false);
    });
});

describe('nameScore', () => {
    it('ranks exact, same words, inflected', () => {
        expect(nameScore('Ильва', 'ильва')).toBe(3);
        expect(nameScore('Фенн', 'старый Фенн')).toBe(2);
        expect(nameScore('Ильва Хольм', 'Ильва')).toBe(2);
        expect(nameScore('Фенна', 'старый Фенн')).toBe(1);
        expect(nameScore('старый', 'старый Фенн')).toBe(0);
        expect(nameScore('', 'Ильва')).toBe(0);
        expect(nameScore('Ильва', 'Брам')).toBe(0);
    });
});

describe('matchName', () => {
    it('matches by name, alias and English name, case- and ё-insensitive', () => {
        expect(matchName('Ильва', CAST)).toBe('ilva');
        expect(matchName('ХОЗЯЙКА', CAST)).toBe('ilva');
        expect(matchName('Ilva', CAST)).toBe('ilva');
        expect(matchName('Семен', CAST)).toBe('semen');
        expect(matchName('сема', CAST)).toBe('semen');
        expect(matchName('Фенн', CAST)).toBe('fenn');
        expect(matchName('the carters', CAST)).toBe('carters');
    });

    it('tolerates Russian case endings', () => {
        expect(matchName('Ильвы', CAST)).toBe('ilva');
        expect(matchName('Браму', CAST)).toBe('bram');
        expect(matchName('Фенном', CAST)).toBe('fenn');
        expect(matchName('Соту', CAST)).toBe('sota');
        expect(matchName('Bram’s', CAST)).toBe('bram');
    });

    it('exact beats inflected: Александр and Александра', () => {
        const pair: NamedProfile[] = [
            { id: 'al', name: 'Александр', aliases: [] },
            { id: 'ala', name: 'Александра', aliases: [] },
        ];
        expect(matchName('Александра', pair)).toBe('ala');
        expect(matchName('Александр', pair)).toBe('al');
        expect(matchName('Александру', pair)).toBeNull();
        const single: NamedProfile[] = [{ id: 'al', name: 'Александр', aliases: [] }];
        expect(matchName('Александра', single)).toBe('al');
        expect(matchName('Александра', single, { strict: true })).toBeNull();
    });

    it('returns null for ambiguity, emptiness and strangers', () => {
        const two: NamedProfile[] = [
            { id: 'a1', name: 'Анна Петрова', aliases: [] },
            { id: 'a2', name: 'Анна Смирнова', aliases: [] },
        ];
        expect(matchName('Анна', two)).toBeNull();
        expect(matchName('Анна Петрова', two)).toBe('a1');
        expect(matchName('  ', CAST)).toBeNull();
        expect(matchName('Грукк', CAST)).toBeNull();
    });
});

describe('presentFromDes', () => {
    it('maps the present cast to ids and lists unknown names once', () => {
        const result = presentFromDes(
            [des('Ильва'), des('Брам', false), des('Сота'), des('Грукк'), des('грукк'), des('Ильва'), des(' ')],
            CAST,
        );
        expect(result).toEqual({ present: ['ilva', 'sota'], unknown: ['Грукк'] });
    });

    it('is strict: a nominative female name is not the male one', () => {
        const single: NamedProfile[] = [{ id: 'al', name: 'Александр', aliases: [] }];
        expect(presentFromDes([des('Александра')], single)).toEqual({ present: [], unknown: ['Александра'] });
    });
});

describe('presentFromText', () => {
    it('finds mentions in the last three messages plus the main character first', () => {
        const messages = [
            'Брам ушёл ещё утром.',
            'Ильва кивнула Соте и посмотрела на дверь.',
            'Возчики спорили о цене.',
            'Старик дремал; у Фенна дрожала рука.',
        ];
        expect(presentFromText(messages, CAST, 'bram')).toEqual(['bram', 'ilva', 'sota', 'fenn', 'carters']);
        expect(presentFromText(messages.slice(0, 2), CAST)).toEqual(['ilva', 'bram', 'sota']);
    });

    it('needs the whole name for groups and accepts English names', () => {
        expect(presentFromText(['Тут сидели возчики.'], CAST)).toEqual(['carters']);
        expect(presentFromText(['The carters laughed; Ilva frowned.'], CAST)).toEqual(['ilva', 'carters']);
    });

    it('never reads an exact name as another one inflected', () => {
        const pair: NamedProfile[] = [
            { id: 'al', name: 'Александр', aliases: [] },
            { id: 'ala', name: 'Александра', aliases: [] },
        ];
        expect(presentFromText(['Вошла Александра.'], pair)).toEqual(['ala']);
        expect(presentFromText(['Он говорил с Александром.'], pair)).toEqual(['al']);
        expect(presentFromText(['Пусто.'], pair, 'nobody')).toEqual([]);
        expect(presentFromText([], CAST, 'ilva')).toEqual(['ilva']);
    });

    it('matches multi-word names as a phrase and by a capitalised word', () => {
        const holm: NamedProfile[] = [{ id: 'holm', name: 'Ильва Хольм', aliases: [] }];
        expect(presentFromText(['Хольм промолчал.'], holm)).toEqual(['holm']);
        expect(presentFromText(['Ильва Хольм промолчала.'], holm)).toEqual(['holm']);
        expect(presentFromText(['Хольма не было.'], holm)).toEqual(['holm']);
    });
});
