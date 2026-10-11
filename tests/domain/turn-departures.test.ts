// A committed turn and the scene's edges (docs/model.md §6.4–§6.5): who left with the reply is out of the next beat
// (no band, no move, no appetite plan), a stale tracker does not put them back, the narration or the player's message
// does; who was pursuing the player is kept for the hold; the «Elsewhere» line is picked only with the split.
import { describe, expect, it } from 'vitest';
import { PLAYER_ID } from '../../src/domain/model';
import type { ChatState } from '../../src/domain/model';
import { DEFAULT_LEVERS, applyTurnPass, commitTurn } from '../../src/domain/turn-apply';
import type { TurnContext, TurnInput } from '../../src/domain/turn-apply';
import { seeded } from './appetites-fixtures';
import { TAVERN_PRESENT, tavern } from './cast-fixtures';
import { entry, event, turnPass } from './turn-fixtures';

function ctx(patch: Partial<TurnContext> = {}): TurnContext {
    return { rng: seeded(7), levers: { ...DEFAULT_LEVERS }, messageIndex: 3, uiLang: 'ru', ...patch };
}

function tavernInput(patch: Partial<TurnInput> = {}, state?: ChatState): TurnInput {
    const fixture = tavern();
    return {
        state: state ?? fixture.state,
        profiles: fixture.profiles,
        present: TAVERN_PRESENT,
        playerName: 'Курьер',
        ...patch,
    };
}

/** The beat that produced the reply gave Ильва the move «leave». */
function leavingBeat(): ChatState {
    const { state } = tavern();
    state.turn = 4;
    state.next = { turn: 4, moves: { ilva: { move: 'leave' } } };
    return state;
}

describe('applyTurnPass — departures (§6.4)', () => {
    it('takes out whoever the narration shows leaving, though the tracker still lists her', () => {
        const result = applyTurnPass(
            tavernInput({ reply: 'Ильва сгребла монеты в фартук, кивнула Браму и вышла за дверь.' }),
            turnPass({ characters: [entry('ilva', { sceneGoal: 'take the letters to the rebels' })] }),
            ctx(),
        );
        const state = result.state;
        expect(state.away).toEqual({ ilva: { since: 1, by: 'narration', doing: 'take the letters to the rebels' } });
        expect(state.next?.bands?.ilva).toBeUndefined();
        expect(state.next?.moves?.ilva).toBeUndefined();
        expect(state.characters.ilva!.present).toBe(false);
        expect(state.characters.ilva!.scene.move).toBeUndefined();
        expect(state.characters.bram!.present).toBe(true);
        expect(result.events.map((item) => item.text)).toContain('Ильва ушла из сцены');
    });

    it('takes out one Dramatis sent away whom the reply did not keep in the scene', () => {
        const away = applyTurnPass(tavernInput({ reply: 'Брам бросил кости.' }, leavingBeat()), null, ctx());
        expect(away.state.away?.ilva).toEqual({ since: 5, by: 'move' });
        const stays = applyTurnPass(
            tavernInput({ reply: 'Ильва осталась за стойкой и пересчитала выручку.' }, leavingBeat()),
            null,
            ctx(),
        );
        expect(stays.state.away ?? {}).toEqual({});
        expect(stays.state.next?.bands?.ilva).toBeDefined();
    });

    it('keeps her out next turn when a stale tracker lists her and the reply shows nothing of her', () => {
        const first = applyTurnPass(tavernInput({ reply: 'Ильва ушла.' }), null, ctx()).state;
        const second = applyTurnPass(
            tavernInput({ present: TAVERN_PRESENT, reply: 'Брам заказал ещё пива.' }, first),
            null,
            ctx(),
        ).state;
        expect(second.away?.ilva).toEqual({ since: 1, by: 'narration' });
        expect(second.next?.bands?.ilva).toBeUndefined();
        expect(second.characters.ilva!.present).toBe(false);
    });

    it('brings her back with a reply that has her act by name, or with the player calling her', () => {
        const first = applyTurnPass(tavernInput({ reply: 'Ильва ушла.' }), null, ctx()).state;
        const present = TAVERN_PRESENT.filter((id) => id !== 'ilva');
        const back = applyTurnPass(tavernInput({ present, reply: 'Вошла Ильва с охапкой дров.' }, first), null, ctx());
        expect(back.state.away).toEqual({});
        expect(back.state.next?.bands?.ilva).toBeDefined();
        expect(back.state.characters.ilva!.present).toBe(true);
        expect(back.events.map((item) => item.text)).toContain('Ильва вернулась в сцену');
        const called = applyTurnPass(
            tavernInput({ present, reply: 'Брам пожал плечами.', playerMessage: 'Ильва, вернись!' }, first),
            null,
            ctx(),
        );
        expect(called.state.away).toEqual({});
    });

    it('does nothing to departures when the reply is not given', () => {
        const state = tavern().state;
        state.away = { fenn: { since: 0, by: 'narration' } };
        const result = applyTurnPass(tavernInput({}, state), null, ctx());
        expect(result.state.away).toEqual({ fenn: { since: 0, by: 'narration' } });
    });

    it('ends every departure of the old scene at a change of place', () => {
        const state = tavern().state;
        state.place = 'Трактир';
        state.away = { fenn: { since: 0, by: 'narration' } };
        const result = commitTurn(
            tavernInput({ mark: { place: 'Рынок' }, reply: 'На рынке шумно; Фенн торгуется за рыбу.' }, state),
            turnPass(),
            ctx(),
        );
        expect(result.state.away).toEqual({});
        const same = commitTurn(tavernInput({ mark: { place: 'Трактир' }, reply: 'Тихо.' }, state), null, ctx());
        expect(same.state.away).toEqual({ fenn: { since: 0, by: 'narration' } });
    });
});

describe('applyTurnPass — pursuing and the world elsewhere', () => {
    it('keeps who was pressing something on the player in the reply', () => {
        const { state } = tavern();
        state.turn = 2;
        state.next = { turn: 2, moves: { sota: { move: 'initiate', target: PLAYER_ID } } };
        const result = applyTurnPass(
            tavernInput({ reply: 'Сота села ближе и взяла Курьера за руку.' }, state),
            turnPass({ events: [event('bram', 'PLAYER', 'order', 'told him to pay up')] }),
            ctx(),
        );
        expect(result.state.next?.pursuing).toEqual(['bram', 'sota']);
    });

    it('picks the «Elsewhere» line only with the split, and never someone in the scene', () => {
        const reply = 'Ильва накинула шаль и ушла.';
        const pass = turnPass({ characters: [entry('ilva', { sceneGoal: 'take the letters to the rebels' })] });
        const split = applyTurnPass(tavernInput({ reply }), pass, ctx({ elsewhere: true }));
        expect(split.state.next?.elsewhere).toEqual([{ id: 'ilva', text: 'take the letters to the rebels' }]);
        const plain = applyTurnPass(tavernInput({ reply }), pass, ctx());
        expect(plain.state.next?.elsewhere).toBeUndefined();
        // Named on this turn: not again on the next one while she is busy with the same.
        const next = applyTurnPass(
            tavernInput({ present: TAVERN_PRESENT.filter((id) => id !== 'ilva'), reply: 'Брам зевнул.' }, split.state),
            null,
            ctx({ elsewhere: true }),
        );
        expect(next.state.next?.elsewhere).toBeUndefined();
    });
});
