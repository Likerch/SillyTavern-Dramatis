import { describe, expect, it } from 'vitest';
import { PLAYER_ID } from '../../src/domain/model';
import { summarizePass } from '../../src/domain/pass-summary';
import { DEFAULT_LEVERS, applyTurnPass } from '../../src/domain/turn-apply';
import type { TurnContext } from '../../src/domain/turn-apply';
import { parseTurnResult, turnMessages, turnSchema, turnSheet } from '../../src/domain/turn-prompt';
import { seeded } from './appetites-fixtures';
import { TAVERN_PRESENT, chat, liveState, tavern, tie } from './cast-fixtures';
import { beekeeper, entry, event, turnPass } from './turn-fixtures';

function ctx(patch: Partial<TurnContext> = {}): TurnContext {
    return { rng: seeded(7), levers: { ...DEFAULT_LEVERS }, messageIndex: 5, ...patch };
}

const choice = {
    text: 'sent her daughter away rather than keep her close',
    kept: 'her daughter’s safety',
    gave: 'her company',
    toward: 'need' as const,
};

describe('the choice under pressure in the turn pass', () => {
    it('is asked for, required by the strict schema and parsed', () => {
        const { profiles, state } = tavern();
        const system = turnMessages({
            playerName: 'Курьер',
            playerMessage: '',
            reply: 'x',
            scene: {},
            profiles,
            state,
            ids: ['ilva'],
        })[0]!.content;
        expect(system).toContain('choice: only when, under real pressure');
        const character = (
            turnSchema(['ilva']).schema as {
                properties: { characters: { items: { properties: Record<string, unknown>; required: string[] } } };
            }
        ).properties.characters.items;
        expect(character.required).toContain('choice');
        const parsed = parseTurnResult(
            {
                characters: [
                    { id: 'ilva', relevant: true, choice: { ...choice, toward: 'sideways' } },
                    { id: 'bram', relevant: true, choice: { text: '' } },
                    { id: 'sota', relevant: true, choice: null },
                ],
            },
            { ids: ['ilva', 'bram', 'sota'] },
        )!;
        expect(parsed.characters[0]!.choice).toEqual({ ...choice, toward: 'unclear' });
        expect('choice' in parsed.characters[1]!).toBe(false);
        expect('choice' in parsed.characters[2]!).toBe(false);
    });

    it('shows the false belief and the need on the sheet unless the arc is locked', () => {
        const { profiles, state } = tavern();
        const ilva = profiles[0]!;
        ilva.core = {
            ...ilva.core,
            wound: { ghost: 'husband hanged', lie: 'imperials lie', triggers: [], coping: 'overcompensate' },
            need: 'to trust again',
        };
        const ctxSheet = { names: new Map(), present: new Set<string>(), turn: 0 };
        expect(turnSheet(ilva, state.characters.ilva, ctxSheet)).toContain(
            'arc: believes "imperials lie"; needs to trust again',
        );
        ilva.core = { ...ilva.core, arcLock: true };
        expect(turnSheet(ilva, state.characters.ilva, ctxSheet)).not.toContain('arc:');
    });
});

describe('the summary of a committed turn', () => {
    it('keeps keys, choices, steps and drift for the passes after the turn', () => {
        const { profiles, state } = tavern();
        const result = applyTurnPass(
            { state, profiles, present: TAVERN_PRESENT, playerName: 'Курьер', desLabels: { bram: 'Враг' } },
            turnPass({
                events: [event('PLAYER', 'sota', 'save', 'pulled Сота out of the fire', { intensity: 5 })],
                characters: [
                    entry('ilva', { keyMatched: 'protection of her daughter', choice }),
                    entry('sota', { keyMatched: 'someone who stands up for her' }),
                    entry('stranger', { keyMatched: 'nothing' }),
                ],
            }),
            ctx(),
        );
        const summary = result.state.lastPass!;
        expect(summary).toMatchObject({ turn: 1, messageIndex: 5, present: TAVERN_PRESENT });
        expect(summary.characters).toEqual({
            ilva: { key: 'protection of her daughter', choice },
            sota: { key: 'someone who stands up for her' },
        });
        expect(summary.steps).toContainEqual({ character: 'sota', target: PLAYER_ID, from: 1, to: 2 });
        expect(summary.drift).toEqual(['bram']);
    });

    it('sees a broken vow and a temptation as strain', () => {
        const { profiles, state } = beekeeper();
        const result = applyTurnPass(
            { state, profiles, present: ['yan', 'innkeeper'], playerName: 'Курьер' },
            turnPass({
                characters: [
                    entry('yan', {
                        appetites: [
                            {
                                id: 'drink',
                                cue: true,
                                idleAfterCue: false,
                                satisfied: 3,
                                full: false,
                                refusedBy: '',
                                stress: false,
                                intoxicated: false,
                            },
                        ],
                    }),
                ],
            }),
            ctx(),
        );
        expect(result.state.characters.yan!.appetites.drink!.lapsed).toBe(true);
        expect(result.state.lastPass!.characters.yan!.strain).toContain('lapse');
    });

    it('counts new ties from their base and leaves untouched ones out', () => {
        const ilva = tavern().profiles[0]!;
        const before = chat({ ilva: liveState(ilva) });
        const after = structuredClone(before);
        after.characters.ilva!.ties.newcomer = tie('newcomer', -1, { base: 0 });
        after.characters.ilva!.ties.other = tie('other', 0);
        const summary = summarizePass({
            before,
            after,
            pass: turnPass(),
            present: ['ilva'],
            turn: 2,
            notes: [
                { kind: 'temptation', character: 'ilva' },
                { kind: 'break', character: 'ghost' },
                { kind: 'new-names' },
            ],
            events: [],
        });
        expect(summary.steps).toEqual([{ character: 'ilva', target: 'newcomer', from: 0, to: -1 }]);
        expect(summary.characters).toEqual({ ilva: { strain: ['temptation'] } });
        expect(summary.messageIndex).toBeUndefined();
    });
});
