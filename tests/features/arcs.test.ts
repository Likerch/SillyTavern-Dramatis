import { describe, expect, it, vi } from 'vitest';
import { createI18n } from '../../src/core/i18n';
import type { CharacterProfile, ChatState, PassSummary } from '../../src/domain/model';
import { emptyCardProfiles } from '../../src/domain/profile-defaults';
import { ARCS_STRINGS, ARC_STAGE_KIND, ARC_STAGE_TARGET, arcsModule } from '../../src/features/arcs';
import { ENGINE_API } from '../../src/features/engine/api';
import type { EngineApi, EngineView } from '../../src/features/engine/api';
import type { ApiJournalChange, ApiProposal } from '../../src/shared/apis';
import type { App, Unsubscribe } from '../../src/shared/contracts';
import { chat, liveState, profile } from '../domain/cast-fixtures';
import { fakeMaestro, memoryLogger, staticBridge } from '../helpers/fakes';
import { flush } from '../helpers/st-mock';

function ilva(): CharacterProfile {
    const base = profile('ilva', 'Ильва', { gender: 'female', lod: 'portrait' });
    return {
        ...base,
        core: { ...base.core, wound: { ghost: 'x', lie: 'imperials lie', triggers: [], coping: 'avoid' } },
    };
}

function fakeEngine(initial: EngineView) {
    let view = initial;
    const listeners = new Set<(view: EngineView | null) => void>();
    const saves: ChatState[] = [];
    const api: EngineApi = {
        view: () => view,
        ready: async () => view,
        async updateState(mutate) {
            const clone = structuredClone(view.state);
            const result = mutate(clone, view) ?? clone;
            view = { ...view, state: result };
            saves.push(result);
            for (const listener of [...listeners]) listener(view);
            return true;
        },
        updateProfiles: async () => false,
        refresh: async () => {},
        resolve: () => null,
        log: () => {},
        onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    return {
        api,
        saves,
        listeners,
        get state() {
            return view.state;
        },
        /** A committed turn with this summary, announced like the engine does. */
        commit(summary: Omit<PassSummary, 'turn' | 'present' | 'steps' | 'drift'>) {
            const turn = view.state.turn + 1;
            const state = {
                ...view.state,
                turn,
                lastPass: { turn, present: ['ilva'], steps: [], drift: [], ...summary },
            };
            view = { ...view, state };
            for (const listener of [...listeners]) listener(view);
        },
    };
}

async function setup(options: { leader?: boolean; chatId?: string } = {}) {
    const profiles = [ilva()];
    const view: EngineView = {
        card: { ...emptyCardProfiles('card.png'), characters: profiles },
        state: chat({ ilva: liveState(profiles[0]!) }, { turn: 2 }),
        profiles,
        byId: new Map(profiles.map((p) => [p.id, p])),
        present: ['ilva'],
        unknown: [],
        bands: {},
        playerName: 'Курьер',
        greeting: 0,
    };
    const engine = fakeEngine(view);
    const maestro = fakeMaestro();
    const leader = { value: options.leader ?? true };
    maestro.api.leader = { isLeader: () => leader.value, onChange: () => () => {} };
    const proposals: ApiProposal[] = [];
    let applier: { apply: (payload: unknown) => Promise<void>; valid?: (payload: unknown) => Promise<boolean> } | null =
        null;
    let undo: ((change: ApiJournalChange) => Promise<boolean>) | null = null;
    maestro.api.propose = vi.fn(async (proposal: ApiProposal) => {
        proposals.push(proposal);
        return 'queued' as const;
    });
    maestro.api.registerApplier = (kind, _label, apply, valid) => {
        expect(kind).toBe(ARC_STAGE_KIND);
        applier = { apply, ...(valid ? { valid } : {}) };
        return () => {
            applier = null;
        };
    };
    maestro.api.journal = {
        record: async () => 'j1',
        registerUndo: (target, handler) => {
            expect(target).toBe(ARC_STAGE_TARGET);
            undo = handler;
            return () => {
                undo = null;
            };
        },
    };
    const i18n = createI18n(() => 'ru');
    i18n.register(ARCS_STRINGS);
    const chatId = { value: options.chatId ?? 'chat-1' };
    const settingsListeners = new Set<(key: string) => void>();
    const app = {
        modules: { api: (key: string) => (key === ENGINE_API ? engine.api : undefined), expose: () => {} },
        i18n,
        maestro: staticBridge(maestro.api),
        host: { chatId: () => chatId.value },
        settings: {
            onChange: (listener: (key: string) => void) => {
                settingsListeners.add(listener);
                return () => settingsListeners.delete(listener);
            },
        },
    } as unknown as App;
    const owned: (Unsubscribe | (() => void | Promise<void>))[] = [];
    await arcsModule.init({ app, settings: {}, log: memoryLogger(), own: (d) => owned.push(d) });
    return {
        engine,
        proposals,
        leader,
        chatId,
        applier: () => applier!,
        undo: () => undo!,
        async settle() {
            for (let i = 0; i < 10; i++) await flush();
        },
        async dispose() {
            for (const off of owned.splice(0).reverse()) await off();
        },
    };
}

const key = { characters: { ilva: { key: 'protection of her daughter' } }, messageIndex: 7 };

describe('arcs module', () => {
    it('is a stage-5 module that needs Maestro, on by default, with Russian strings for every key', () => {
        expect(arcsModule).toMatchObject({ key: 'arcs', stage: 5, enabledByDefault: true, needsMaestro: true });
        expect(Object.keys(ARCS_STRINGS.ru).sort()).toEqual(Object.keys(ARCS_STRINGS.en).sort());
    });

    it('moves the arc after each committed turn and proposes a ripe step with «notify»', async () => {
        const s = await setup();
        s.engine.commit(key);
        await s.settle();
        expect(s.engine.saves).toHaveLength(1);
        expect(s.engine.state.characters.ilva!.arc).toMatchObject({ strain: 2, turn: 3 });
        expect(s.proposals).toHaveLength(0);
        s.engine.commit(key);
        await s.settle();
        expect(s.engine.saves).toHaveLength(2);
        expect(s.proposals).toHaveLength(1);
        const proposal = s.proposals[0]!;
        expect(proposal).toMatchObject({
            kind: ARC_STAGE_KIND,
            fallback: 'notify',
            title: 'Дуга — Ильва: ложь цела → трещина',
            sourceMessage: 7,
            acceptLabel: 'Принять',
            changes: [
                {
                    target: ARC_STAGE_TARGET,
                    ref: { chatId: 'chat-1', character: 'ilva' },
                    before: 'intact',
                    after: 'cracking',
                },
            ],
        });
        expect(proposal.description).toContain('Что надавило: «protection of her daughter»');
        expect(proposal.payload).toMatchObject({ chatId: 'chat-1', character: 'ilva', from: 'intact', to: 'cracking' });
        await s.dispose();
    });

    it('writes nothing when nothing pressed, in another tab, or twice for one turn', async () => {
        const s = await setup({ leader: false });
        s.engine.commit(key);
        await s.settle();
        expect(s.engine.saves).toHaveLength(0);
        s.leader.value = true;
        s.engine.commit({ characters: {} });
        await s.settle();
        expect(s.engine.saves).toHaveLength(0);
        s.engine.commit(key);
        await s.settle();
        expect(s.engine.saves).toHaveLength(1);
        // The own save announces a change again: already processed.
        await s.settle();
        expect(s.engine.saves).toHaveLength(1);
        await s.dispose();
        s.engine.commit(key);
        await s.settle();
        expect(s.engine.saves).toHaveLength(1);
    });

    it('applies an accepted step, checks it is still valid and undoes it', async () => {
        const s = await setup();
        s.engine.commit(key);
        await s.settle();
        s.engine.commit(key);
        await s.settle();
        const payload = s.proposals[0]!.payload;
        expect(await s.applier().valid!(payload)).toBe(true);
        await s.applier().apply(payload);
        expect(s.engine.state.characters.ilva!.arcStage).toBe('cracking');
        expect(s.engine.state.log.at(-1)?.text).toBe(
            'Ильва: дуга сдвинулась — ложь цела → трещина (protection of her daughter)',
        );
        expect(await s.applier().valid!(payload)).toBe(false);
        // Applying twice changes nothing.
        await s.applier().apply(payload);
        expect(s.engine.state.characters.ilva!.arcStage).toBe('cracking');
        const change = s.proposals[0]!.changes[0]!;
        expect(await s.undo()(change)).toBe(true);
        expect(s.engine.state.characters.ilva!.arcStage).toBe('intact');
        expect(await s.undo()(change)).toBe(false);
        expect(await s.undo()({ ...change, ref: { chatId: 'other', character: 'ilva' } })).toBe(false);
        expect(await s.undo()({ ...change, before: 'nonsense' })).toBe(false);
        await s.dispose();
    });

    it('ignores payloads of another chat or malformed ones', async () => {
        const s = await setup();
        const before = s.engine.saves.length;
        await s.applier().apply({ chatId: 'other', character: 'ilva', from: 'intact', to: 'cracking' });
        await s.applier().apply({ chatId: 'chat-1', character: 'ilva', from: 'intact', to: 'embraced' });
        await s.applier().apply(null);
        expect(s.engine.saves).toHaveLength(before);
        expect(await s.applier().valid!({ chatId: 'other', character: 'ilva', from: 'intact', to: 'cracking' })).toBe(
            false,
        );
        await s.dispose();
    });
});
