import { describe, expect, it } from 'vitest';
import { PLAYER_ID } from '../../src/domain/model';
import { narrationOnly, readScene, summonedBy } from '../../src/domain/scene-reading';
import type { ReadProfile } from '../../src/domain/scene-reading';

const LIZA: ReadProfile = { id: 'liza', name: 'Лиза', aliases: [], english: 'Liza', gender: 'female' };
const MARK: ReadProfile = { id: 'mark', name: 'Марк', aliases: [], english: 'Mark', gender: 'male' };
const ANNA: ReadProfile = { id: 'anna', name: 'Анна', aliases: [], gender: 'female' };
const GUARDS: ReadProfile = { id: 'guards', name: 'стражники', aliases: [], kind: 'group' };
const RU = [LIZA, MARK, ANNA, GUARDS];
const EN: ReadProfile[] = [
    { id: 'liza', name: 'Liza', aliases: [], gender: 'female' },
    { id: 'mark', name: 'Mark', aliases: [], gender: 'male' },
];

const read = (text: string, profiles = RU, player = 'Курьер') => readScene(text, profiles, player);

describe('narrationOnly — speech set aside', () => {
    it('replaces quotes and dash dialogue, keeping the author’s words', () => {
        expect(narrationOnly('«Я ухожу», — сказала Лиза.')).not.toContain('ухожу');
        expect(narrationOnly('«Я ухожу», — сказала Лиза.')).toContain('сказала Лиза');
        const dash = narrationOnly('— Я ухожу, — бросила Лиза и ушла.');
        expect(dash).not.toContain('Я ухожу');
        expect(dash).toContain('бросила Лиза и ушла');
        expect(narrationOnly('"I am leaving," Liza said.')).not.toContain('leaving');
        expect(narrationOnly('Лиза — дочь трактирщика — ушла.')).toBe('Лиза — дочь трактирщика — ушла.');
    });
});

describe('readScene — Russian', () => {
    it('reads a departure at the end of the reply by name', () => {
        expect(read('Лиза допила вино, кивнула Марку и ушла.')).toEqual({
            liza: { kind: 'exit', named: true },
        });
    });

    it('follows a pronoun that clearly means one character, by its gender', () => {
        const seen = read('Марк посмотрел на Лизу. Она молча вышла из комнаты.');
        expect(seen.liza).toEqual({ kind: 'exit', named: false });
        expect(seen.mark).toEqual({ kind: 'act', named: true });
        expect(read('Марк проводил Лизу взглядом, и она ушла.').liza?.kind).toBe('exit');
    });

    it('gives an ambiguous pronoun to nobody', () => {
        const seen = read('Лиза говорила с Анной. Она ушла.');
        expect(seen.liza?.kind).toBe('act');
        expect(seen.anna).toBeUndefined();
    });

    it('takes the subject after the verb in its own clause («как уходит Лиза»)', () => {
        const seen = read('Марк смотрел, как уходит Лиза.');
        expect(seen.liza?.kind).toBe('exit');
        expect(seen.mark?.kind).toBe('act');
    });

    it('needs the nominative: «Улыбка Лизы исчезла» is no departure', () => {
        expect(read('Улыбка Лизы исчезла.')).toEqual({});
        expect(read('Марк вышел к Лизе и сел у огня.').liza).toBeUndefined();
    });

    it('matches names from the word boundary only: «близко» is not Лиза', () => {
        expect(read('Близко к огню сидел Марк, потом ушёл.')).toEqual({ mark: { kind: 'exit', named: true } });
    });

    it('keeps idioms, negations, conditionals and steps forward in the scene', () => {
        expect(read('Лиза ушла в себя.').liza?.kind).toBe('act');
        expect(read('Лиза вышла вперёд и подняла кружку.').liza?.kind).toBe('act');
        expect(read('Лиза не ушла.').liza?.kind).toBe('act');
        expect(read('Лиза ушла бы, но дождь не кончался.').liza?.kind).not.toBe('exit');
        expect(read('Лиза вышла замуж за кузнеца.').liza?.kind).toBe('act');
    });

    it('reads «вышла» and «направилась» only with a way out', () => {
        expect(read('Лиза вышла.').liza?.kind).toBe('exit');
        expect(read('Лиза вышла за дверь.').liza?.kind).toBe('exit');
        expect(read('Лиза вышла из-за стола.').liza?.kind).toBe('act');
        expect(read('Лиза направилась к выходу.').liza?.kind).toBe('exit');
        expect(read('Лиза направилась к Марку.').liza?.kind).toBe('act');
    });

    it('reads «дверь за ней закрылась» and «за Лизой захлопнулась дверь»', () => {
        expect(read('Лиза встала. Дверь за ней закрылась.').liza).toEqual({ kind: 'exit', named: false });
        expect(read('За Лизой захлопнулась дверь.').liza).toEqual({ kind: 'exit', named: true });
    });

    it('sets speech aside: a line about leaving is a line, not leaving', () => {
        expect(read('— Я ухожу, — сказала Лиза.').liza).toEqual({ kind: 'act', named: true });
        expect(read('— Лиза ушла домой, — сказал Марк.')).toEqual({ mark: { kind: 'act', named: true } });
    });

    it('lets the last thing in the reply win: a return after a departure', () => {
        expect(read('Лиза ушла, но через минуту вернулась.').liza).toEqual({ kind: 'enter', named: true });
        expect(read('Лиза кивнула. Потом она ушла.').liza).toEqual({ kind: 'exit', named: false });
    });

    it('reads a whole reply the way a model writes it', () => {
        const reply = [
            'Лиза медленно поднялась из-за стола, поправила платье и, не оглядываясь, направилась к двери.',
            '— Не жди меня, — бросила она через плечо.',
            'Марк хмыкнул и налил себе ещё.',
            'Дверь за ней тихо закрылась.',
        ].join('\n\n');
        expect(read(reply)).toEqual({ liza: { kind: 'exit', named: false }, mark: { kind: 'act', named: true } });
        expect(read('Ты смотришь, как Лиза уходит.').liza?.kind).toBe('exit');
        expect(read('Лиза уходит от ответа.').liza?.kind).toBe('act');
        expect(read('Лиза вышла к гостям.').liza?.kind).toBe('act');
    });

    it('takes a plural verb for everyone it names, groups too', () => {
        const seen = read('Лиза и Марк ушли. Стражники ушли следом.');
        expect(seen.liza?.kind).toBe('exit');
        expect(seen.mark?.kind).toBe('exit');
        expect(seen.guards?.kind).toBe('exit');
    });

    it('reads nothing from questions, memories, elsewhere and the future', () => {
        expect(read('Куда ушла Лиза?')).toEqual({});
        expect(read('Марк вспомнил, как Лиза ушла.')).toEqual({});
        expect(read('Где-то в порту Лиза торговалась с контрабандистами.')).toEqual({});
        expect(read('Лиза скоро вернётся.')).toEqual({});
    });

    it('never takes the player for a character', () => {
        expect(read('Курьер ушёл.')[PLAYER_ID]).toBeUndefined();
        expect(read('Курьер ушёл.')).toEqual({});
    });
});

describe('readScene — English', () => {
    const en = (text: string) => readScene(text, EN, 'Courier');

    it('reads «left» only as leaving', () => {
        expect(en('Liza smiled at Mark, then left the room.').liza?.kind).toBe('exit');
        expect(en('Liza left.').liza?.kind).toBe('exit');
        expect(en('Liza left without a word.').liza?.kind).toBe('exit');
        expect(en('Liza left the cup on the table.').liza?.kind).toBe('act');
        expect(en('There was nothing left for Liza here.')).toEqual({});
    });

    it('reads phrasal exits and entries, the subject in its place', () => {
        const seen = en('Mark watched as Liza walked out.');
        expect(seen.liza?.kind).toBe('exit');
        expect(seen.mark?.kind).toBe('act');
        expect(en('Liza came back with two mugs.').liza?.kind).toBe('enter');
        expect(en('Liza rose, smoothed her dress, and headed for the door.').liza?.kind).toBe('exit');
        expect(en('Liza excused herself.').liza?.kind).toBe('exit');
        expect(en('Liza returned his gaze.').liza?.kind).toBe('act');
        expect(en('Liza appeared tired.').liza?.kind).toBe('act');
        expect(en("Liza's smile vanished.")).toEqual({});
        expect(en('Mark kissed Liza.')).toEqual({ mark: { kind: 'act', named: true } });
    });

    it('reads pronouns, doors and lines of speech', () => {
        expect(en('Liza stood. The door closed behind her.').liza).toEqual({ kind: 'exit', named: false });
        expect(en('Liza nodded. She walked away.').liza).toEqual({ kind: 'exit', named: false });
        expect(en('"I am leaving," said Liza.').liza).toEqual({ kind: 'act', named: true });
        expect(en('Liza did not leave. She never left.').liza?.kind).toBe('act');
    });
});

describe('summonedBy — the player calls someone back', () => {
    const ids = ['liza', 'mark'];
    const called = (text: string) => summonedBy(text, RU, ids, 'Курьер');

    it('hears an address, a call or the player writing them back', () => {
        expect(called('Лиза, иди сюда!')).toEqual(['liza']);
        expect(called('— Иди сюда, Лиза.')).toEqual(['liza']);
        expect(called('Зову Лизу обратно.')).toEqual(['liza']);
        expect(called('Подзываю Марка и Лизу.')).toEqual(['liza', 'mark']);
        expect(called('Лиза возвращается и садится рядом.')).toEqual(['liza']);
        expect(summonedBy('Liza, come back!', EN, ids, 'Courier')).toEqual(['liza']);
        expect(summonedBy('I call Liza over.', EN, ids, 'Courier')).toEqual(['liza']);
    });

    it('does not take a mention, a question or a refusal for a call', () => {
        expect(called('Где Лиза?')).toEqual([]);
        expect(called('Я думаю о Лизе.')).toEqual([]);
        expect(called('Не зову Лизу.')).toEqual([]);
        expect(called('Лиза, конечно, ушла.')).toEqual([]);
        expect(summonedBy('Лиза, иди сюда!', RU, ['mark'], 'Курьер')).toEqual([]);
        expect(called('')).toEqual([]);
    });
});
