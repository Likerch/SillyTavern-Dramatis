import { describe, expect, it } from 'vitest';
import { PLAYER_ID } from '../../src/domain/model';
import type { CharacterProfile, ChatState } from '../../src/domain/model';
import { buildCastCard } from '../../src/domain/render';
import {
    BREAK_MOVES,
    STRESS_ANCHOR_REST,
    STRESS_REST,
    finishBreaks,
    lashTarget,
    relieveStress,
    snapLine,
} from '../../src/domain/stress';
import { DEFAULT_LEVERS, applyTurnPass } from '../../src/domain/turn-apply';
import type { TurnContext, TurnInput, TurnLevers } from '../../src/domain/turn-apply';
import { seeded } from './appetites-fixtures';
import { TAVERN_BANDS, TAVERN_PRESENT, chat, liveState, profile, tavern, tie } from './cast-fixtures';
import { entry, turnPass } from './turn-fixtures';

function ctx(patch: Partial<TurnContext> = {}, levers: Partial<TurnLevers> = {}): TurnContext {
    return { rng: seeded(7), levers: { ...DEFAULT_LEVERS, ...levers }, messageIndex: 3, ...patch };
}

function tavernInput(coping?: 'surrender' | 'avoid' | 'overcompensate'): TurnInput {
    const { profiles, state } = tavern();
    if (coping) {
        const ilva = profiles.find((p) => p.id === 'ilva')!;
        ilva.core = { ...ilva.core, wound: { ghost: 'husband hanged', lie: 'never trust them', triggers: [], coping } };
    }
    return { state, profiles, present: TAVERN_PRESENT, playerName: 'Курьер' };
}

const warm = entry('ilva', {
    relevant: false,
    drift: {
        warmthWithoutCause: true,
        appetiteBecameLove: false,
        dependenceVanished: false,
        actedAgainstValues: false,
    },
});

describe('stress helpers', () => {
    it('rest eases stress, more with an anchor, never below zero', () => {
        expect(relieveStress(60)).toBe(60 - STRESS_REST);
        expect(relieveStress(60, true)).toBe(60 - STRESS_REST - STRESS_ANCHOR_REST);
        expect(relieveStress(10, true)).toBe(0);
        expect(relieveStress(Number.NaN)).toBe(0);
    });

    it('writes the «snaps» line by coping style and cause', () => {
        expect(snapLine('lash-out', 'en', { target: 'Курьер', cause: 'drift' })).toBe(
            'lashes out at Курьер — a cutting word or a cruelty out of all proportion; the strain of acting against themselves breaks through',
        );
        expect(snapLine('lash-out', 'ru', {})).toBe(
            'срывается — резкое слово или жестокость не по поводу, достаётся: тот, кто рядом; прорывается всё, что слишком долго сдерживалось',
        );
        expect(snapLine('withdraw', 'en', {})).toContain('shuts down');
        expect(snapLine('leave', 'ru', { cause: 'drift' })).toContain('сбегает');
    });

    it('lashes out at whoever they like least among those present', () => {
        const ilva = liveState(profile('ilva', 'Ильва'), {
            ties: {
                [PLAYER_ID]: tie(PLAYER_ID, -1),
                bram: tie('bram', -2),
                sota: tie('sota', 3),
                away: tie('away', -3),
            },
        });
        expect(lashTarget(ilva, ['ilva', 'bram', 'sota'])).toBe('bram');
        expect(lashTarget(ilva, ['ilva', 'sota'])).toBe(PLAYER_ID);
    });

    it('does nothing without the next turn', () => {
        const state: ChatState = chat({});
        expect(
            finishBreaks({
                state,
                present: [],
                byId: new Map(),
                notes: [],
                drifted: new Set(),
                cardLang: 'en',
                playerName: '',
                logBreak: () => undefined,
            }),
        ).toEqual({});
    });
});

describe('breaks after the turn pass', () => {
    it('a drift break in the «stress» mode gets its «snaps» line in the next card', () => {
        const input = tavernInput('overcompensate');
        input.desLabels = { ilva: 'Lover' };
        input.state.characters.ilva!.stress = 40;
        const result = applyTurnPass(
            input,
            turnPass({ characters: [warm] }),
            ctx({ cardLang: 'en' }, { driftResponse: 'stress' }),
        );
        expect(result.state.characters.ilva!.stress).toBe(30);
        expect(result.state.next?.snaps?.ilva).toBe(
            'lashes out at Курьер — a cutting word or a cruelty out of all proportion; the strain of acting against themselves breaks through',
        );
        expect(result.notes.filter((note) => note.kind === 'break')).toHaveLength(1);
    });

    it('any stress breaks at the threshold, also in the «correction» mode', () => {
        const input = tavernInput('avoid');
        input.state.characters.bram!.stress = 65;
        const result = applyTurnPass(input, turnPass(), ctx({ cardLang: 'ru', uiLang: 'ru' }));
        const bram = result.state.characters.bram!;
        expect(bram.stress).toBe(30);
        expect(result.state.next?.moves?.bram).toEqual({ move: 'leave', text: BREAK_MOVES.leave.ru });
        expect(bram.scene).toMatchObject({ move: 'leave', moveText: BREAK_MOVES.leave.ru });
        expect(result.state.next?.snaps?.bram).toBe(
            'сбегает — под любым предлогом уходит или прячется в работу; прорывается всё, что слишком долго сдерживалось',
        );
        expect(result.notes).toContainEqual({ kind: 'break', character: 'bram', break: 'leave' });
        expect(result.events).toContainEqual(
            expect.objectContaining({
                kind: 'break',
                character: 'bram',
                text: `Брам: не выдержал — ${BREAK_MOVES.leave.ru}`,
            }),
        );
        // The summary of the turn sees the break as strain.
        expect(result.state.lastPass?.characters.bram?.strain).toEqual(['break']);
    });

    it('lashes out at the least liked one present when the break is not about the player', () => {
        const input = tavernInput('overcompensate');
        input.state.characters.ilva!.stress = 70;
        input.state.characters.ilva!.ties.bram = tie('bram', -3);
        const result = applyTurnPass(input, turnPass(), ctx({ cardLang: 'en' }));
        expect(result.state.next?.moves?.ilva).toEqual({ move: 'obstruct', target: 'bram', text: 'lashes out' });
        expect(result.state.next?.snaps?.ilva).toContain('lashes out at Брам');
    });

    it('the card shows the «snaps» line instead of the plain move', () => {
        const input = tavernInput('avoid');
        input.state.characters.bram!.stress = 65;
        const result = applyTurnPass(input, turnPass(), ctx({ cardLang: 'en' }));
        const card = buildCastCard({
            profiles: input.profiles,
            state: result.state,
            present: TAVERN_PRESENT,
            bands: { ...TAVERN_BANDS, bram: 'background' },
            moves: result.state.next?.moves,
            snaps: result.state.next?.snaps,
            playerName: 'Курьер',
            lang: 'en',
            budgetTokens: 0,
            mergeVoices: false,
        });
        expect(card.text).toContain('Брам — snaps: bolts — makes an excuse and gets away');
        expect(card.text).not.toContain('This turn: walks out');
    });
});

describe('profiles without a wound', () => {
    it('break by avoiding', () => {
        const yan: CharacterProfile = profile('yan', 'Ян');
        const state = chat({ yan: liveState(yan, { stress: 99 }) });
        const result = applyTurnPass({ state, profiles: [yan], present: ['yan'], playerName: '' }, null, ctx());
        expect(result.notes).toContainEqual({ kind: 'break', character: 'yan', break: 'leave' });
    });
});
