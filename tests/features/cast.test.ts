// @vitest-environment happy-dom
// The cast module on the whole app: the `dramatis_cast` injection (present / absent, dry runs and quiet calls), the
// passes' results, Maestro's speech merge, the quiet-mode claims and /dramatis-card.
import { afterEach, describe, expect, it } from 'vitest';
import type { CardProfiles, ChatState } from '../../src/domain/model';
import { emptyCardProfiles } from '../../src/domain/profile-defaults';
import { DRAMATIS_API_GLOBAL, MAESTRO_API_GLOBAL } from '../../src/shared/apis';
import type { ApiLlmResult, DramatisApiV1, MaestroQuietFunction } from '../../src/shared/apis';
import { fakeMaestro } from '../helpers/fakes';
import type { FakeMaestro } from '../helpers/fakes';
import { flush, message } from '../helpers/st-mock';
import { tavern } from '../domain/cast-fixtures';
import { TURN_API } from '../../src/features/turn/api';
import { turnPass } from '../domain/turn-fixtures';
import { fakeDes, generate, startHarness, stopHarness, switchChat, until } from './harness';

afterEach(stopHarness);

const globals = globalThis as unknown as Record<string, unknown>;
const api = () => globals[DRAMATIS_API_GLOBAL] as DramatisApiV1;

function tavernCard(): CardProfiles {
    return { ...emptyCardProfiles('tavern.png'), characters: tavern().profiles };
}

function tavernState(patch: Partial<ChatState> = {}): ChatState {
    return { ...tavern().state, card: 'tavern.png', ...patch };
}

/** A fake Maestro whose quiet claims are visible. */
function quietMaestro(): FakeMaestro & { claims: Map<MaestroQuietFunction, string> } {
    const maestro = fakeMaestro() as FakeMaestro & { claims: Map<MaestroQuietFunction, string> };
    maestro.claims = new Map();
    maestro.api.quiet = (fn, owner) => {
        maestro.claims.set(fn, owner);
        return () => {
            maestro.claims.delete(fn);
        };
    };
    return maestro;
}

describe('cast — the motive card injection', () => {
    it('injects dramatis_cast at the configured depth as a system message for a real generation', async () => {
        const h = await startHarness({ profiles: tavernCard(), state: tavernState(), persona: 'Courier' });
        h.app.settings.set('depth', 2);
        await generate(h.mock);
        const slot = h.mock.prompts.get('dramatis_cast');
        expect(slot).toMatchObject({ position: 1, depth: 2, role: 0, scan: false });
        expect(slot!.value).toContain('[Cast minds');
        expect(slot!.value).toContain('Ильва —');
        expect(slot!.value).toContain('Toward Courier: hostile (an imperial; the Empire hanged her husband)');
        expect(slot!.value).toMatch(/Busy with their own: .*Фенн/);
        expect(h.app.ephemeral.isSet('cast')).toBe(true);
        expect(api().castBlockActive()).toBe(true);
        await h.mock.eventSource.emit('generation_ended');
        expect(h.mock.prompts.get('dramatis_cast')!.value).toBe('');
    });

    it('writes the card in Russian when asked and keeps to the budget', async () => {
        const h = await startHarness({ profiles: tavernCard(), state: tavernState(), persona: 'Курьер' });
        h.app.settings.set('cardLanguage', 'ru');
        h.app.settings.set('cardBudget', 120);
        await generate(h.mock);
        const text = h.mock.prompts.get('dramatis_cast')!.value;
        expect(text).toContain('[Мотивы персонажей');
        expect(Math.ceil(text.length / 4)).toBeLessThanOrEqual(220);
    });

    it('follows the chat’s own levers over the general settings (language, depth)', async () => {
        const state = { ...tavernState(), overrides: { cardLanguage: 'ru', depth: 3 } };
        const h = await startHarness({ profiles: tavernCard(), state, persona: 'Курьер' });
        expect(h.app.settings.get().cardLanguage).toBe('en');
        await generate(h.mock);
        const slot = h.mock.prompts.get('dramatis_cast')!;
        expect(slot.value).toContain('[Мотивы персонажей');
        expect(slot.depth).toBe(3);
    });

    it('injects nothing for a dry run or a quiet background call', async () => {
        const h = await startHarness({ profiles: tavernCard(), state: tavernState() });
        await generate(h.mock, 'normal', true);
        expect(h.mock.prompts.get('dramatis_cast')).toBeUndefined();
        await generate(h.mock, 'quiet');
        expect(h.mock.prompts.get('dramatis_cast')).toBeUndefined();
    });

    it('injects nothing when nobody is present or outside a solo chat', async () => {
        const state = tavernState();
        for (const live of Object.values(state.characters)) live.present = false;
        const h = await startHarness({ profiles: tavernCard(), state });
        expect(api().castBlockActive()).toBe(false);
        await generate(h.mock);
        expect(h.mock.prompts.get('dramatis_cast')?.value ?? '').toBe('');
        await switchChat(h.mock, 'group', { group: true });
        await generate(h.mock);
        expect(h.mock.prompts.get('dramatis_cast')?.value ?? '').toBe('');
    });

    it('refreshes the scene before building: the one just named in the last message is in the card', async () => {
        const h = await startHarness({ profiles: tavernCard(), state: tavernState(), chat: [message('Брам пьёт.')] });
        h.mock.chat.push(message('Подзываю Соту.', { is_user: true }));
        await generate(h.mock);
        const text = h.mock.prompts.get('dramatis_cast')!.value;
        expect(text).toContain('Сота —');
        expect(text).not.toContain('Ильва —');
    });

    it('carries the passes’ moves and corrections when they are fresh', async () => {
        const state = tavernState({
            turn: 3,
            next: {
                turn: 3,
                moves: { ilva: { move: 'initiate', target: 'bram', text: 'quietly sends Брам to follow him' } },
                corrections: { ilva: ['still hostile toward Courier — nothing has earned warmth'] },
            },
        });
        const h = await startHarness({ profiles: tavernCard(), state, persona: 'Courier' });
        await generate(h.mock);
        const text = h.mock.prompts.get('dramatis_cast')!.value;
        expect(text).toContain('This turn: quietly sends Брам to follow him.');
        expect(text).toContain('Ильва — correction: still hostile toward Courier');
    });

    it('ignores stale passes’ results', async () => {
        const state = tavernState({
            turn: 4,
            next: { turn: 3, moves: { ilva: { move: 'leave', text: 'walks out' } } },
        });
        const h = await startHarness({ profiles: tavernCard(), state });
        await generate(h.mock);
        expect(h.mock.prompts.get('dramatis_cast')!.value).not.toContain('walks out');
    });

    it('answers /dramatis-card with the card or says nobody is there', async () => {
        const h = await startHarness({ profiles: tavernCard(), state: tavernState() });
        const command = h.mock.slashCommands.get('dramatis-card')!;
        expect(String(await command.callback({}, ''))).toContain('[Cast minds');
        await switchChat(h.mock, 'group', { group: true });
        expect(await command.callback({}, '')).toBe('В сцене никого нет: карточка мотивов сейчас не отправляется.');
    });
});

describe('cast — with Maestro', () => {
    it('merges Maestro’s speech digests into the blocks, without them when the switch is off', async () => {
        const maestro = quietMaestro();
        let calls = 0;
        maestro.api.speech = (name) => {
            calls++;
            return name === 'Ильва' ? 'clipped, cold sentences; ENTJ' : null;
        };
        const h = await startHarness({ profiles: tavernCard(), state: tavernState(), maestro });
        await generate(h.mock);
        expect(h.mock.prompts.get('dramatis_cast')!.value).toContain('Ильва — voice: clipped, cold sentences; ENTJ');
        expect(calls).toBeGreaterThan(0);
        h.app.settings.set('mergeVoices', false);
        await generate(h.mock);
        expect(h.mock.prompts.get('dramatis_cast')!.value).not.toContain('clipped');
    });

    it('survives a speech digest that throws', async () => {
        const maestro = quietMaestro();
        maestro.api.speech = () => {
            throw new Error('archive loading');
        };
        const h = await startHarness({ profiles: tavernCard(), state: tavernState(), maestro });
        await generate(h.mock);
        expect(h.mock.prompts.get('dramatis_cast')!.value).toContain('Ильва —');
    });

    it('claims voices and CK consistency while the chat has a cast and the speech is merged, nothing otherwise', async () => {
        const maestro = quietMaestro();
        const h = await startHarness({ profiles: tavernCard(), state: tavernState(), maestro });
        expect([...maestro.claims.entries()].sort()).toEqual([
            ['ck.consistency', 'dramatis'],
            ['voices', 'dramatis'],
        ]);
        // Maestro's contract (integration-dramatis.md §5.4): without the merge CK keeps the speech side.
        h.app.settings.set('mergeVoices', false);
        expect([...maestro.claims.keys()]).toEqual([]);
        h.app.settings.set('mergeVoices', true);
        expect([...maestro.claims.keys()].sort()).toEqual(['ck.consistency', 'voices']);
    });

    it('releases the claims when the cast empties and takes them again when it returns', async () => {
        const maestro = quietMaestro();
        const h = await startHarness({ profiles: tavernCard(), state: tavernState(), maestro });
        await switchChat(h.mock, 'group', { group: true, maestro });
        await until(() => maestro.claims.size === 0);
        expect(maestro.claims.size).toBe(0);
        await switchChat(h.mock, 'chat-1', { maestro });
        await h.engine.ready();
        await until(() => maestro.claims.size === 2);
        expect(maestro.claims.size).toBe(2);
    });

    it('releases the claims when the module stops and re-claims after Maestro restarts', async () => {
        const maestro = quietMaestro();
        const h = await startHarness({ profiles: tavernCard(), state: tavernState(), maestro });
        await h.runtime.modules.disable('cast');
        expect(maestro.claims.size).toBe(0);
        expect(api().castBlockActive()).toBe(false);
        await h.runtime.modules.enable('cast');
        expect(maestro.claims.size).toBe(2);

        delete globals[MAESTRO_API_GLOBAL];
        h.runtime.bridge.check();
        await flush();
        expect(maestro.claims.size).toBe(0);

        // A restarted Maestro remembers nothing: Dramatis claims again.
        const again = quietMaestro();
        globals[MAESTRO_API_GLOBAL] = again.api;
        h.runtime.bridge.check();
        await flush();
        expect([...again.claims.keys()].sort()).toEqual(['ck.consistency', 'voices']);
    });

    it('builds the card again inside Maestro’s interceptor, after the commit of the reply the message answered', async () => {
        const maestro = quietMaestro();
        const h = await startHarness({ profiles: tavernCard(), state: tavernState(), maestro, persona: 'Courier' });
        let settled = 0;
        // The turn module: the user's message commits the previous reply after ST's producers ran.
        h.runtime.modules.expose(TURN_API, {
            settle: async () => {
                settled++;
                await h.engine.updateState((state) => {
                    state.turn = 1;
                    state.next = { turn: 1, moves: { ilva: { move: 'initiate', text: 'bars the door behind him' } } };
                });
            },
        });
        await generate(h.mock);
        expect(h.mock.prompts.get('dramatis_cast')!.value).not.toContain('bars the door');
        await maestro.emitTurn({ type: 'generation:before', generation: 'normal', dryRun: false, quiet: false });
        expect(settled).toBe(1);
        expect(h.mock.prompts.get('dramatis_cast')!.value).toContain('This turn: bars the door behind him.');

        // Quiet calls of other extensions are none of the card's business.
        await maestro.emitTurn({ type: 'generation:before', generation: 'quiet', dryRun: false, quiet: true });
        expect(settled).toBe(1);
    });

    describe('ST’s order on send: the producers run before the message is added and the reply committed', () => {
        const turnRequests = (maestro: FakeMaestro) =>
            maestro.requests.filter((request) => request.task === 'dramatis.turn').length;

        // ST 1.19 Generate(): GENERATION_AFTER_COMMANDS (producers) → sendMessageAsUser → MESSAGE_SENT (Maestro emits
        // turn:committed and does not wait for its listeners) → generate interceptors (Maestro's generation:before)
        // → prompt assembly reads the extension prompt slots.
        async function sendAfterReply(order: 'committed-first' | 'interceptor-first') {
            const maestro = quietMaestro();
            maestro.reply = () => ({ ok: true, data: JSON.parse(JSON.stringify(turnPass())) });
            const h = await startHarness({
                profiles: tavernCard(),
                state: tavernState(),
                maestro,
                persona: 'Courier',
                chat: [message('Ильва вытирает стойку и улыбается тебе.')],
            });
            // DES calls her a friend while the engine holds her hostile: the commit adds a drift correction to next.
            const des = [{ name: 'Ильва', present: true, relationship: 'Подруга', details: {} }];
            fakeDes(h.runtime, des);
            h.runtime.readers.des.castAt = () => des;
            await maestro.emitTurn({ type: 'reply:ready', messageIndex: 0 });
            await until(() => turnRequests(maestro) === 1);
            await flush();

            await generate(h.mock);
            const early = h.mock.prompts.get('dramatis_cast')!.value;
            h.mock.chat.push(message('Налей, подруга.', { is_user: true }));
            const before = { type: 'generation:before', generation: 'normal', dryRun: false, quiet: false } as const;
            if (order === 'committed-first') {
                void maestro.emitTurn({ type: 'turn:committed', messageIndex: 0 });
                await maestro.emitTurn(before);
            } else {
                await maestro.emitTurn(before);
                await maestro.emitTurn({ type: 'turn:committed', messageIndex: 0 });
            }
            await flush();
            return { h, maestro, early, card: h.mock.prompts.get('dramatis_cast')!.value };
        }

        it('builds the card again after the commit: the generation gets the turn it follows', async () => {
            const { h, early, card } = await sendAfterReply('committed-first');
            expect(early).not.toContain('correction');
            expect(card).toContain('Ильва — correction: still hostile');
            expect(h.engine.view()!.state.next?.turn).toBe(1);
        });

        it('follows a commit that lands after the interceptor (its pass was still running) while the generation runs', async () => {
            const maestro = quietMaestro();
            let answer: (value: ApiLlmResult) => void = () => {};
            maestro.reply = (request) =>
                request.task === 'dramatis.turn'
                    ? new Promise<ApiLlmResult>((resolve) => {
                          answer = resolve;
                      })
                    : { ok: false, error: 'cap' };
            const h = await startHarness({
                profiles: tavernCard(),
                state: tavernState(),
                maestro,
                persona: 'Courier',
                chat: [message('Ильва вытирает стойку и улыбается тебе.')],
            });
            const des = [{ name: 'Ильва', present: true, relationship: 'Подруга', details: {} }];
            fakeDes(h.runtime, des);
            h.runtime.readers.des.castAt = () => des;
            await maestro.emitTurn({ type: 'reply:ready', messageIndex: 0 });
            await until(() => turnRequests(maestro) === 1);

            await generate(h.mock);
            h.mock.chat.push(message('Налей, подруга.', { is_user: true }));
            await maestro.emitTurn({ type: 'turn:committed', messageIndex: 0 });
            await maestro.emitTurn({ type: 'generation:before', generation: 'normal', dryRun: false, quiet: false });
            expect(h.mock.prompts.get('dramatis_cast')!.value).not.toContain('correction');
            answer({ ok: true, data: JSON.parse(JSON.stringify(turnPass())) });
            await until(() => h.mock.prompts.get('dramatis_cast')!.value.includes('correction'));
            expect(h.mock.prompts.get('dramatis_cast')!.value).toContain('Ильва — correction: still hostile');
            // Over: the slot is cleared and later commits leave it alone.
            await h.mock.eventSource.emit('generation_ended');
            await maestro.emitTurn({ type: 'generation:ended', generation: 'normal', stopped: false });
            expect(h.mock.prompts.get('dramatis_cast')!.value).toBe('');
            await h.app.bus.emit('turn:applied', { messageIndex: 0, turn: 1 });
            expect(h.mock.prompts.get('dramatis_cast')!.value).toBe('');
        });

        it('commits a ready draft itself when Maestro’s turn:committed comes after its interceptor, once', async () => {
            const { h, maestro, card } = await sendAfterReply('interceptor-first');
            expect(card).toContain('Ильва — correction: still hostile');
            expect(h.engine.view()!.state.turn).toBe(1);
            expect(turnRequests(maestro)).toBe(1);
        });
    });

    it('gives a BunnyMo sheet command no card and leaves Maestro its own blocks for it', async () => {
        const maestro = quietMaestro();
        const h = await startHarness({ profiles: tavernCard(), state: tavernState(), maestro });
        h.mock.chat.push(message('!fullsheet Ильва', { is_user: true }));
        await generate(h.mock, 'regenerate');
        expect(h.mock.prompts.get('dramatis_cast')?.value ?? '').toBe('');
        expect(api().castBlockActive()).toBe(false);
        await maestro.emitTurn({ type: 'generation:before', generation: 'regenerate', dryRun: false, quiet: false });
        expect(h.mock.prompts.get('dramatis_cast')?.value ?? '').toBe('');
        await maestro.emitTurn({ type: 'generation:ended', generation: 'regenerate', stopped: false });
        expect(api().castBlockActive()).toBe(true);

        h.mock.chat.push(message('Ильва, налей.', { is_user: true }));
        await generate(h.mock, 'regenerate');
        expect(h.mock.prompts.get('dramatis_cast')!.value).toContain('Ильва —');
    });

    it('claims nothing without a cast', async () => {
        const maestro = quietMaestro();
        await startHarness({ profiles: emptyCardProfiles('tavern.png'), maestro });
        expect(maestro.claims.size).toBe(0);
    });
});
