// @vitest-environment happy-dom
// The cast module on the whole app: the `dramatis_cast` injection (present / absent, dry runs and quiet calls), the
// passes' results, Maestro's speech merge, the quiet-mode claims and /dramatis-card.
import { afterEach, describe, expect, it } from 'vitest';
import type { CardProfiles, ChatState } from '../../src/domain/model';
import { emptyCardProfiles } from '../../src/domain/profile-defaults';
import { DRAMATIS_API_GLOBAL, MAESTRO_API_GLOBAL } from '../../src/shared/apis';
import type { DramatisApiV1, MaestroQuietFunction } from '../../src/shared/apis';
import { fakeMaestro } from '../helpers/fakes';
import type { FakeMaestro } from '../helpers/fakes';
import { flush, message } from '../helpers/st-mock';
import { tavern } from '../domain/cast-fixtures';
import { generate, startHarness, stopHarness, switchChat, until } from './harness';

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

    it('claims voices and CK consistency while the chat has a cast, voices only when merged', async () => {
        const maestro = quietMaestro();
        const h = await startHarness({ profiles: tavernCard(), state: tavernState(), maestro });
        expect([...maestro.claims.entries()].sort()).toEqual([
            ['ck.consistency', 'dramatis'],
            ['voices', 'dramatis'],
        ]);
        h.app.settings.set('mergeVoices', false);
        expect([...maestro.claims.keys()]).toEqual(['ck.consistency']);
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

    it('claims nothing without a cast', async () => {
        const maestro = quietMaestro();
        await startHarness({ profiles: emptyCardProfiles('tavern.png'), maestro });
        expect(maestro.claims.size).toBe(0);
    });
});
