import { describe, expect, it } from 'vitest';
import { ELSEWHERE_MAX, outOfScene, pickElsewhere, sceneDepartures } from '../../src/domain/departures';
import type { DepartureInput } from '../../src/domain/departures';
import { PLAYER_ID } from '../../src/domain/model';
import type { CharacterProfile, ChatState, Departure } from '../../src/domain/model';
import { chat, liveState, profile, tie } from './cast-fixtures';

const LIZA = profile('liza', 'Лиза', { gender: 'female', lod: 'portrait' });
const MARK = profile('mark', 'Марк', { gender: 'male' });
const PROFILES = [LIZA, MARK];

function depart(patch: Partial<DepartureInput>): ReturnType<typeof sceneDepartures> {
    return sceneDepartures({
        narration: '',
        profiles: PROFILES,
        playerName: 'Курьер',
        inScene: ['liza', 'mark'],
        away: {},
        turn: 5,
        ...patch,
    });
}

describe('sceneDepartures — leaving', () => {
    it('takes out whoever the narration shows leaving, with what they went to do', () => {
        const result = depart({
            narration: 'Лиза допила вино, кивнула Марку и ушла. Марк проводил её взглядом.',
            doing: { liza: 'sell the furs at the market before dark' },
        });
        expect(result.left).toEqual(['liza']);
        expect(result.returned).toEqual([]);
        expect(result.away).toEqual({
            liza: { since: 5, by: 'narration', doing: 'sell the furs at the market before dark' },
        });
    });

    it('takes out one with the move «leave» the reply did not keep acting in the scene', () => {
        expect(depart({ narration: 'Марк налил вина.', leaving: ['liza'] }).away).toEqual({
            liza: { since: 5, by: 'move' },
        });
        expect(depart({ narration: 'Лиза осталась у огня.', leaving: ['liza'] }).away).toEqual({});
        // Acting first, then leaving at the end: the leaving wins.
        expect(depart({ narration: 'Лиза рассмеялась. Потом она ушла.', leaving: ['liza'] }).away.liza?.by).toBe(
            'narration',
        );
    });

    it('reads English replies too', () => {
        const result = depart({
            narration: 'Mark grabbed his coat and walked out.',
            profiles: [profile('liza', 'Liza'), profile('mark', 'Mark', { gender: 'male' })],
        });
        expect(result.left).toEqual(['mark']);
    });
});

describe('sceneDepartures — the stale tracker and coming back', () => {
    const away: Record<string, Departure> = { liza: { since: 5, by: 'narration' } };

    it('keeps out one a stale tracker still lists while the narration shows nothing of her', () => {
        // The tracker put her back into the scene; the reply never shows her.
        const result = depart({ narration: 'Марк налил себе ещё вина и сел у огня.', away, turn: 6 });
        expect(result.away).toEqual(away);
        expect(result.returned).toEqual([]);
        expect(result.left).toEqual([]);
    });

    it('does not take a mention, a memory or what happens elsewhere for a return', () => {
        for (const narration of [
            'Марк вспомнил, как Лиза смеялась.',
            'Где-то в порту Лиза торговалась с контрабандистами.',
            'Интересно, где сейчас Лиза?',
            'Марк смотрел на дверь. Она так и не открылась.',
        ]) {
            expect(depart({ narration, away, turn: 6 }).away.liza, narration).toBeDefined();
        }
    });

    it('brings her back when a later reply has her act, speak or come in by name', () => {
        expect(depart({ narration: 'Лиза вернулась и села рядом.', away, turn: 6 }).returned).toEqual(['liza']);
        expect(depart({ narration: '— Я здесь, — сказала Лиза.', away, turn: 6 }).returned).toEqual(['liza']);
        expect(depart({ narration: 'Лиза поставила на стол две кружки.', away, turn: 6 }).away).toEqual({});
    });

    it('brings her back when the player calls her, whatever the reply says', () => {
        const result = depart({ narration: 'Марк налил вина.', away, turn: 6, playerMessage: 'Лиза, иди сюда!' });
        expect(result.returned).toEqual(['liza']);
        expect(result.away).toEqual({});
    });

    it('a pronoun alone does not bring anyone back', () => {
        expect(depart({ narration: 'Марк поднял глаза. Она улыбнулась.', away, turn: 6 }).away.liza).toBeDefined();
    });

    it('follows a character leaving, staying away and coming back over three replies', () => {
        let state: Record<string, Departure> = {};
        state = depart({ narration: 'Лиза накинула плащ и вышла из таверны.', away: state, turn: 1 }).away;
        expect(Object.keys(state)).toEqual(['liza']);
        state = depart({ narration: 'Марк долго молчал.', away: state, turn: 2 }).away;
        expect(Object.keys(state)).toEqual(['liza']);
        const back = depart({ narration: 'Дверь скрипнула: вошла Лиза.', away: state, turn: 3 });
        expect(back.returned).toEqual(['liza']);
        expect(back.away).toEqual({});
        // Came back and left again within one reply: the last thing wins, she is still out since the first time.
        const both = depart({ narration: 'Лиза вернулась за шарфом и снова ушла.', away: state, turn: 3 });
        expect(both.returned).toEqual([]);
        expect(both.left).toEqual([]);
        expect(both.away.liza).toEqual({ since: 1, by: 'narration' });
    });
});

describe('outOfScene', () => {
    it('is the departures less those the player’s messages since the commit call back', () => {
        const state = { away: { liza: { since: 1, by: 'move' as const }, mark: { since: 1, by: 'move' as const } } };
        expect([...outOfScene(state, PROFILES)]).toEqual(['liza', 'mark']);
        expect([...outOfScene(state, PROFILES, ['Подзываю Марка.'])]).toEqual(['liza']);
        expect([...outOfScene({}, PROFILES, ['Лиза, иди сюда'])]).toEqual([]);
    });
});

describe('pickElsewhere — the world elsewhere', () => {
    function world(): { profiles: CharacterProfile[]; state: ChatState } {
        const ilva = profile('ilva', 'Ильва', { lod: 'portrait' });
        const bram = profile('bram', 'Брам');
        const sota = profile('sota', 'Сота');
        const fenn = profile('fenn', 'Фенн');
        const guards = profile('guards', 'стража', { kind: 'group' });
        const profiles = [ilva, bram, sota, fenn, guards];
        const characters = Object.fromEntries(profiles.map((item) => [item.id, liveState(item)]));
        characters.bram!.offscreen = [
            {
                turn: 9,
                goal: 'pay off the debt',
                attempt: 'dice with the carters for the debt money',
                outcome: 'partial',
                advanced: 1,
                source: 'intention',
                chance: 0.5,
            },
        ];
        characters.sota!.agenda = {
            ...characters.sota!.agenda,
            intentions: [
                {
                    id: 'i1',
                    text: 'get out of this town',
                    nextStep: 'bargain a seat on the caravan',
                    dropIf: [],
                    clock: { segments: 4, filled: 3 },
                },
            ],
        };
        characters.ilva!.ties = { [PLAYER_ID]: tie(PLAYER_ID, -2) };
        const state = chat(characters, {
            turn: 10,
            away: { ilva: { since: 10, by: 'narration', doing: 'take the letters to the rebels' } },
        });
        return { profiles, state };
    }

    it('names the just departed first, then the moving clocks and recent attempts; never those here or groups', () => {
        const { profiles, state } = world();
        const notes = pickElsewhere({ state, profiles, here: new Set(['fenn']), turn: 10 });
        expect(notes).toEqual([
            { id: 'ilva', text: 'take the letters to the rebels' },
            { id: 'bram', text: 'dice with the carters for the debt money' },
            { id: 'sota', text: 'bargain a seat on the caravan' },
        ]);
        expect(notes.length).toBeLessThanOrEqual(ELSEWHERE_MAX);
        expect(pickElsewhere({ state, profiles, here: new Set(['ilva', 'bram', 'sota']), turn: 10 })).toEqual([]);
    });

    it('does not name someone on two turns running unless what they are busy with changed', () => {
        const { profiles, state } = world();
        const first = pickElsewhere({ state, profiles, here: new Set(), turn: 10 });
        const again = pickElsewhere({ state, profiles, here: new Set(), turn: 11, previous: first });
        expect(again).toEqual([]);
        state.characters.bram!.offscreen!.push({
            turn: 11,
            goal: 'pay off the debt',
            attempt: 'sell his sword to the smith',
            outcome: 'success',
            advanced: 1,
            source: 'intention',
            chance: 0.5,
        });
        expect(pickElsewhere({ state, profiles, here: new Set(), turn: 11, previous: first })).toEqual([
            { id: 'bram', text: 'sell his sword to the smith' },
        ]);
    });

    it('leaves out characters with no live agenda', () => {
        const { profiles, state } = world();
        state.away = {};
        state.characters.bram!.offscreen = [];
        expect(pickElsewhere({ state, profiles, here: new Set(), turn: 10 })).toEqual([
            { id: 'sota', text: 'bargain a seat on the caravan' },
        ]);
    });
});
