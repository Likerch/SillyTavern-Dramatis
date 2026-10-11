// @vitest-environment happy-dom
// The engine module on the whole app: loading the view, presence (DES, text, starts), bands, name resolution,
// updates with version races, the profile updates and the engine's part of DRAMATIS_API.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAYER_ID } from '../../src/domain/model';
import type { CardProfiles, CharacterProfile, ChatState, Intention } from '../../src/domain/model';
import { emptyCardProfiles } from '../../src/domain/profile-defaults';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESCRIBE_MAX_LINES, fitSections } from '../../src/features/engine/describe';
import { ENGINE_STRINGS } from '../../src/features/engine/strings';
import { LOG_CAP } from '../../src/features/engine/engine';
import { agendaUrgency, effectiveProfiles, freshNext, hasRoleDuty } from '../../src/features/engine/view';
import { DRAMATIS_API_GLOBAL } from '../../src/shared/apis';
import type { DramatisApiV1 } from '../../src/shared/apis';
import { fakeMaestro } from '../helpers/fakes';
import { character, flush, message } from '../helpers/st-mock';
import { chat, liveState, profile, tavern, tie } from '../domain/cast-fixtures';
import {
    fakeDes,
    readProfilesFile,
    readStateFile,
    startHarness,
    stopHarness,
    switchChat,
    until,
    writeState,
} from './harness';

afterEach(stopHarness);

const api = () => (globalThis as unknown as Record<string, DramatisApiV1>)[DRAMATIS_API_GLOBAL]!;

function tavernCard(extra: CharacterProfile[] = []): CardProfiles {
    return { ...emptyCardProfiles('tavern.png'), characters: [...tavern().profiles, ...extra] };
}

function tavernState(patch: Partial<ChatState> = {}): ChatState {
    return { ...tavern().state, card: 'tavern.png', ...patch };
}

const ILVA_CARD = character('Ильва', { avatar: 'tavern.png' });

describe('engine view helpers', () => {
    it('keeps card characters first and drops extras that reuse their ids', () => {
        const card = tavernCard();
        const state = tavernState({ extras: [profile('ilva', 'Другая Ильва'), profile('vera', 'Вера')] });
        expect(effectiveProfiles(card, state).map((item) => item.id)).toEqual([
            'ilva',
            'bram',
            'sota',
            'fenn',
            'carters',
            'vera',
        ]);
    });

    it('knows duty roles in English and Russian', () => {
        for (const role of [
            'innkeeper',
            'Tavern keeper',
            'city guard',
            'shopkeeper',
            'стражник',
            'трактирщица',
            'лекарь',
        ])
            expect(hasRoleDuty(role), role).toBe(true);
        for (const role of ['sellsword', 'bodyguard', 'услужливый вор', '', undefined])
            expect(hasRoleDuty(role), String(role)).toBe(false);
    });

    it('measures agenda urgency by the fullest intention clock', () => {
        expect(agendaUrgency(undefined)).toBe(0);
        expect(
            agendaUrgency({
                goals: [],
                intentions: [
                    { id: 'a', text: 'a', nextStep: '', dropIf: [], clock: { segments: 4, filled: 1 } },
                    { id: 'b', text: 'b', nextStep: '', dropIf: [], clock: { segments: 6, filled: 3 } },
                    { id: 'c', text: 'c', nextStep: '', dropIf: [], clock: { segments: 0, filled: 3 } },
                ],
                resources: [],
                leverage: [],
                secrets: [],
            }),
        ).toBe(0.5);
    });

    it('takes the passes’ results only when computed after the current turn', () => {
        expect(freshNext(chat({}, { turn: 2, next: { turn: 2 } }))).toEqual({ turn: 2 });
        expect(freshNext(chat({}, { turn: 3, next: { turn: 2 } }))).toBeUndefined();
    });
});

describe('engine — loading', () => {
    it('loads profiles + chat state; extras join; missing live states are created in memory only', async () => {
        const state = tavernState({ extras: [profile('vera', 'Вера')] });
        delete state.characters.fenn;
        const h = await startHarness({ profiles: tavernCard(), state, persona: 'Курьер' });
        const view = h.engine.view()!;
        expect(view.profiles.map((item) => item.id)).toEqual(['ilva', 'bram', 'sota', 'fenn', 'carters', 'vera']);
        expect(view.byId.get('vera')?.name).toBe('Вера');
        expect(view.state.characters.fenn).toBeDefined();
        expect(view.state.characters.vera).toBeDefined();
        expect(readStateFile(h.mock, 'chat-1')!.data.characters.fenn).toBeUndefined();
        expect(view.playerName).toBe('Курьер');
        expect(view.greeting).toBe(0);
    });

    it('builds the first state of a new chat from the profiles without writing anything', async () => {
        const h = await startHarness({ profiles: tavernCard() });
        const view = h.engine.view()!;
        expect(Object.keys(view.state.characters)).toEqual(['ilva', 'bram', 'sota', 'fenn', 'carters']);
        expect(readStateFile(h.mock, 'chat-1')).toBeNull();
    });

    it('has a null view in a group chat and a fresh one after switching back', async () => {
        const h = await startHarness({ profiles: tavernCard(), state: tavernState() });
        const seen: (string | null)[] = [];
        h.engine.onChange((view) => seen.push(view ? view.card.card : null));
        await switchChat(h.mock, 'group-chat', { group: true });
        await h.engine.ready();
        expect(h.engine.view()).toBeNull();
        expect(api().active()).toBe(false);
        await switchChat(h.mock, 'chat-2');
        await h.engine.ready();
        expect(h.engine.view()?.card.card).toBe('tavern.png');
        expect(seen).toContain(null);
        expect(seen[seen.length - 1]).toBe('tavern.png');
    });

    it('reloads when another module saves the profiles or the state', async () => {
        const h = await startHarness({ profiles: tavernCard(), state: tavernState() });
        const card = tavernCard([profile('vera', 'Вера')]);
        await h.app.profiles.save(card);
        await until(() => h.engine.view()?.byId.has('vera') === true);
        expect(h.engine.view()?.byId.has('vera')).toBe(true);
        const state = structuredClone(h.engine.view()!.state);
        state.turn = 7;
        await h.app.state.save(state);
        await until(() => h.engine.view()?.state.turn === 7);
        expect(h.engine.view()?.state.turn).toBe(7);
    });
});

describe('engine — presence', () => {
    it('reads the DES tracker: profiles present, unknown names kept, off-scene ones dropped', async () => {
        const h = await startHarness({ profiles: tavernCard(), state: tavernState() });
        fakeDes(h.runtime, [
            { name: 'Ильва', present: true, details: {} },
            { name: 'Гость в плаще', present: true, details: {} },
            { name: 'Сота', present: false, details: {} },
        ]);
        await h.engine.refresh();
        expect(h.engine.view()?.present).toEqual(['ilva']);
        expect(h.engine.view()?.unknown).toEqual(['Гость в плаще']);
    });

    it('takes DES’s own aliases for a tracker name nobody matched', async () => {
        const h = await startHarness({
            profiles: tavernCard(),
            state: tavernState(),
            before: (mock) => {
                mock.extensionSettings['third-party/Dooms-Enhancement-Suite'] = {
                    characterAliases: { 'Ilva Holm': ['Ильва'] },
                };
            },
        });
        fakeDes(h.runtime, [{ name: 'Ilva Holm', present: true, details: {} }]);
        await h.engine.refresh();
        expect(h.engine.view()?.present).toEqual(['ilva']);
        expect(h.engine.view()?.unknown).toEqual([]);
    });

    it('lets Maestro’s names glue a DES name nobody matched', async () => {
        const maestro = fakeMaestro();
        maestro.api.names.same = (a, b) => a === 'Хозяйка' && b === 'Ильва';
        const h = await startHarness({ profiles: tavernCard(), state: tavernState(), maestro });
        fakeDes(h.runtime, [{ name: 'Хозяйка', present: true, details: {} }]);
        await h.engine.refresh();
        expect(h.engine.view()?.present).toEqual(['ilva']);
        expect(h.engine.view()?.unknown).toEqual([]);
        expect(h.engine.resolve('Хозяйка')).toBe('ilva');
    });

    it('without DES reads the last 3 messages and keeps the card’s own character present', async () => {
        const h = await startHarness({
            card: ILVA_CARD,
            profiles: tavernCard(),
            state: tavernState(),
            chat: [
                message('Фенн храпит в углу.'),
                message('Брам бросает кости.'),
                message('Сажусь у стойки.', { is_user: true }),
                message('Сота протирает столы.'),
            ],
        });
        expect(h.engine.view()?.present).toEqual(['ilva', 'bram', 'sota']);
        h.mock.chat.push(message('Зову Фенна.', { is_user: true }));
        await h.engine.refresh();
        expect(h.engine.view()?.present).toEqual(['ilva', 'sota', 'fenn']);
    });

    it('takes the starts until the first user message, and text when the DES tracker is empty', async () => {
        const state = tavernState();
        state.characters.fenn!.present = false;
        state.characters.carters!.present = false;
        const h = await startHarness({ profiles: tavernCard(), state });
        expect(h.engine.view()?.present).toEqual(['ilva', 'bram', 'sota']);
        h.mock.chat.push(message('Фенн храпит в углу.'));
        await h.engine.refresh();
        expect(h.engine.view()?.present).toEqual(['fenn', 'ilva', 'bram', 'sota']);
        fakeDes(h.runtime, []);
        h.mock.chat.push(message('Подхожу к Браму.', { is_user: true }), message('Брам один за столом.'));
        await h.engine.refresh();
        expect(h.engine.view()?.present).toEqual(['bram', 'fenn']);
    });

    it('refreshes on a reply and tells listeners only when the scene changed', async () => {
        const h = await startHarness({
            profiles: tavernCard(),
            state: tavernState(),
            chat: [message('Сажусь.', { is_user: true }), message('Брам пьёт.')],
        });
        const listener = vi.fn();
        h.engine.onChange(listener);
        await h.engine.refresh();
        expect(listener).not.toHaveBeenCalled();
        h.mock.chat.push(message('Сота приносит хлеб.'));
        await h.app.bus.emit('reply:ready', { messageIndex: 2 });
        await until(() => listener.mock.calls.length > 0);
        expect(h.engine.view()?.present).toEqual(['bram', 'sota']);
    });
});

describe('engine — bands', () => {
    it('computes static bands: hostility that ignores him stays in business, nobodies in the background', async () => {
        const h = await startHarness({ profiles: tavernCard(), state: tavernState() });
        expect(h.engine.view()?.bands).toMatchObject({ ilva: 'business', fenn: 'background', carters: 'background' });
    });

    it('raises the addressed and the duty-bound to business', async () => {
        const guard = profile('guard', 'Стражник', { role: 'стражник у ворот' });
        const state = tavernState();
        state.characters.guard = liveState(guard);
        const h = await startHarness({
            profiles: tavernCard([guard]),
            state,
            chat: [message('Фенн, проснись! И ты, стражник.', { is_user: true })],
        });
        expect(h.engine.view()?.present).toEqual(['fenn', 'guard']);
        expect(h.engine.view()?.bands).toEqual({ fenn: 'business', guard: 'business' });
    });

    it('keeps at most 2 in focus (3 under high gravity)', async () => {
        const wanting = ['a', 'b', 'c'].map((id) =>
            profile(id, `Охотница ${id.toUpperCase()}`, {
                ties: [tie(PLAYER_ID, 3, { want: 5 })],
                appetites: [],
                starts: [{ greeting: 0, present: true }],
            }),
        );
        const card = { ...emptyCardProfiles('tavern.png'), characters: wanting };
        const h = await startHarness({ profiles: card });
        const bands = Object.values(h.engine.view()!.bands);
        expect(bands.filter((band) => band === 'focus')).toHaveLength(2);
        h.app.settings.set('playerGravity', 'high');
        await h.engine.refresh();
        expect(Object.values(h.engine.view()!.bands).filter((band) => band === 'focus')).toHaveLength(3);
    });

    it('uses the turn pass’s bands when they are fresh', async () => {
        const fresh = await startHarness({
            profiles: tavernCard(),
            state: tavernState({ turn: 4, next: { turn: 4, bands: { fenn: 'focus' } } }),
        });
        expect(fresh.engine.view()?.bands.fenn).toBe('focus');
        expect(fresh.engine.view()?.bands.ilva).toBe('business');
        await stopHarness();
        const stale = await startHarness({
            profiles: tavernCard(),
            state: tavernState({ turn: 5, next: { turn: 4, bands: { fenn: 'focus' } } }),
        });
        expect(stale.engine.view()?.bands.fenn).toBe('background');
    });
});

describe('engine — resolve', () => {
    it('matches names, inflected forms and aliases; unknown names give null', async () => {
        const h = await startHarness({ profiles: tavernCard(), state: tavernState() });
        expect(h.engine.resolve('Ильва')).toBe('ilva');
        expect(h.engine.resolve('Ильве')).toBe('ilva');
        expect(h.engine.resolve('the carters')).toBe('carters');
        expect(h.engine.resolve('Незнакомец')).toBeNull();
        expect(h.engine.resolve('')).toBeNull();
    });

    it('takes DES’s own aliases: a DES canonical name or alias whose other names point to one profile', async () => {
        const h = await startHarness({
            profiles: tavernCard(),
            state: tavernState(),
            before: (mock) => {
                mock.extensionSettings['third-party/Dooms-Enhancement-Suite'] = {
                    characterAliases: {
                        'Ilva Holm': ['Ильва', 'хозяйка'],
                        'Old Man': ['Фенн'],
                        'Two Faces': ['Брам', 'Сота'],
                    },
                };
            },
        });
        expect(h.engine.resolve('Ilva Holm')).toBe('ilva');
        expect(h.engine.resolve('хозяйка')).toBe('ilva');
        expect(h.engine.resolve('old man')).toBe('fenn');
        expect(h.engine.resolve('Two Faces')).toBeNull();
        expect(h.engine.resolve('Ilva')).toBeNull();
    });
});

describe('engine — updates', () => {
    it('updateState hands a clone to the mutator, saves, rebuilds the view and notifies', async () => {
        const h = await startHarness({ profiles: tavernCard(), state: tavernState() });
        const before = h.engine.view()!.state;
        const listener = vi.fn();
        h.engine.onChange(listener);
        const ok = await h.engine.updateState((state) => {
            state.turn = 3;
        });
        expect(ok).toBe(true);
        expect(before.turn).toBe(0);
        expect(h.engine.view()?.state.turn).toBe(3);
        expect(readStateFile(h.mock, 'chat-1')).toMatchObject({ version: 2, data: { turn: 3 } });
        expect(listener).toHaveBeenCalled();
        // The missing live states created in memory go into that first save.
        expect(Object.keys(readStateFile(h.mock, 'chat-1')!.data.characters)).toContain('fenn');
    });

    it('accepts a returned state and appends queued log lines, keeping the last 300', async () => {
        const state = tavernState({
            log: Array.from({ length: LOG_CAP - 1 }, (_, i) => ({ turn: 0, kind: 'old', text: `line ${i}` })),
        });
        const h = await startHarness({ profiles: tavernCard(), state });
        h.engine.log([
            { turn: 1, kind: 'stance', character: 'ilva', text: 'Ильва холодеет' },
            { turn: 1, kind: 'stance', character: 'bram', text: 'Брам теплеет' },
        ]);
        expect(await h.engine.updateState((draft) => ({ ...draft, scene: 2 }))).toBe(true);
        const saved = readStateFile(h.mock, 'chat-1')!.data;
        expect(saved.scene).toBe(2);
        expect(saved.log).toHaveLength(LOG_CAP);
        expect(saved.log[0]!.text).toBe('line 1');
        expect(saved.log.slice(-2).map((line) => line.text)).toEqual(['Ильва холодеет', 'Брам теплеет']);
        expect(await h.engine.updateState(() => undefined)).toBe(true);
        expect(readStateFile(h.mock, 'chat-1')!.data.log).toHaveLength(LOG_CAP);
    });

    it('reloads and retries once when another tab won the version race', async () => {
        const h = await startHarness({ profiles: tavernCard(), state: tavernState() });
        writeState(h.mock, 'chat-1', tavernState({ turn: 9 }), 5);
        const seen: number[] = [];
        const ok = await h.engine.updateState((state) => {
            seen.push(state.turn);
            state.scene = 4;
        });
        expect(ok).toBe(true);
        expect(seen).toEqual([0, 9]);
        expect(readStateFile(h.mock, 'chat-1')).toMatchObject({ version: 6, data: { turn: 9, scene: 4 } });
        expect(h.engine.view()?.state).toMatchObject({ turn: 9, scene: 4 });
    });

    it('gives false when the mutator throws or there is no chat, and keeps queued log lines', async () => {
        const h = await startHarness({ profiles: tavernCard(), state: tavernState() });
        expect(
            await h.engine.updateState(() => {
                throw new Error('boom');
            }),
        ).toBe(false);
        expect(readStateFile(h.mock, 'chat-1')!.version).toBe(1);
        await switchChat(h.mock, 'group', { group: true });
        h.engine.log([{ turn: 1, kind: 'x', text: 'kept' }]);
        expect(await h.engine.updateState(() => undefined)).toBe(false);
        expect(await h.engine.updateProfiles(() => undefined)).toBe(false);
        await switchChat(h.mock, 'chat-1');
        expect(await h.engine.updateState(() => undefined)).toBe(true);
        expect(readStateFile(h.mock, 'chat-1')!.data.log.map((line) => line.text)).toContain('kept');
    });

    it('serialises concurrent updates', async () => {
        const h = await startHarness({ profiles: tavernCard(), state: tavernState() });
        const results = await Promise.all([
            h.engine.updateState((state) => {
                state.turn += 1;
            }),
            h.engine.updateState((state) => {
                state.turn += 1;
            }),
        ]);
        expect(results).toEqual([true, true]);
        expect(readStateFile(h.mock, 'chat-1')).toMatchObject({ version: 3, data: { turn: 2 } });
    });

    it('updateProfiles saves the card, re-derives the view and gives new characters a live state', async () => {
        const h = await startHarness({ profiles: tavernCard(), state: tavernState({ turn: 2 }) });
        const ok = await h.engine.updateProfiles((profiles, view) => {
            expect(view?.card.card).toBe('tavern.png');
            profiles.characters.push(profile('vera', 'Вера', { starts: [{ greeting: 0, present: true }] }));
        });
        expect(ok).toBe(true);
        expect(readProfilesFile(h.mock, 'tavern.png')!.characters.map((item) => item.id)).toContain('vera');
        const view = h.engine.view()!;
        expect(view.byId.has('vera')).toBe(true);
        expect(view.state.turn).toBe(2);
        expect(view.state.characters.vera).toMatchObject({ present: true, lastSeenTurn: 2 });
    });

    it('passes a later reading of the card (tone, rules, reputation) on to a chat whose state is saved', async () => {
        // The chat began (and saved its state) before the card was read.
        const state = tavernState({ turn: 4, worldTone: 'indifferent', rules: [], reputation: [] });
        const h = await startHarness({ profiles: tavernCard(), state });
        await h.engine.updateProfiles((profiles) => {
            // As the reading writes it: the author's tone, with its quote.
            profiles.worldTone = 'hostile';
            profiles.meta = { ...profiles.meta, worldTone: { origin: 'author', evidence: ['чужаков здесь не любят'] } };
            profiles.rules = [
                {
                    id: 'goblins',
                    holders: 'гоблины',
                    kind: 'plunder',
                    source: 'culture',
                    target: { mode: 'thing' },
                    intensity: { zero: 0.5, low: 0.5, mid: 0, high: 0 },
                    styles: {},
                    choosiness: 0,
                    exclusivity: 'shared',
                    affectionOnset: 'never',
                    groupMode: 'pack',
                },
            ];
            profiles.reputation = [{ among: 'стража', label: 'беглый каторжник', stance: -2, greeting: -1 }];
        });
        const view = h.engine.view()!;
        expect(view.state.turn).toBe(4);
        expect(view.state.worldTone).toBe('hostile');
        expect(view.state.rules.map((rule) => rule.id)).toEqual(['goblins']);
        expect(view.state.reputation).toMatchObject([{ among: 'стража', stance: -2 }]);
        // Written with the next update of the chat.
        await h.engine.updateState(() => {});
        expect(readStateFile(h.mock, 'chat-1')!.data.worldTone).toBe('hostile');
    });

    it('moves the profiles with a card ST renamed (the avatar file is the card key)', async () => {
        const h = await startHarness({ profiles: tavernCard(), state: tavernState() });
        expect(h.engine.view()?.profiles.length).toBe(5);
        h.mock.characters[h.mock.characterId as number]!.avatar = 'tavern-renamed.png';
        await h.mock.eventSource.emit('character_renamed', 'tavern.png', 'tavern-renamed.png');
        await until(
            () => (h.engine.view()?.profiles.length ?? 0) === 5 && h.engine.view()?.card.card === 'tavern-renamed.png',
        );
        expect(readProfilesFile(h.mock, 'tavern-renamed.png')!.characters.map((item) => item.id)).toContain('ilva');
        expect(h.engine.view()!.card.card).toBe('tavern-renamed.png');
        expect(h.engine.view()!.present.length).toBeGreaterThan(0);
    });

    it('takes the world-tone lever where the author left the tone unsaid, the author’s where he did not', async () => {
        const h = await startHarness({ profiles: tavernCard(), state: tavernState({ worldTone: 'indifferent' }) });
        expect(h.engine.view()!.state.worldTone).toBe('indifferent');
        h.app.settings.set('worldTone', 'hostile');
        await until(() => h.engine.view()!.state.worldTone === 'hostile');
        expect(h.engine.view()!.state.worldTone).toBe('hostile');
        await h.engine.updateProfiles((profiles) => {
            profiles.worldTone = 'welcoming';
            profiles.meta = { ...profiles.meta, worldTone: { origin: 'author', evidence: ['рады гостям'] } };
        });
        expect(h.engine.view()!.state.worldTone).toBe('welcoming');
    });

    it('rebuilds an unsaved chat state from the new profiles', async () => {
        const h = await startHarness({ profiles: emptyCardProfiles('tavern.png') });
        expect(h.engine.view()?.present).toEqual([]);
        await h.engine.updateProfiles(() => tavernCard());
        expect(h.engine.view()?.present).toEqual(['ilva', 'bram', 'sota', 'fenn', 'carters']);
        expect(readStateFile(h.mock, 'chat-1')).toBeNull();
    });
});

describe('engine — DRAMATIS_API part', () => {
    function richCard(): CardProfiles {
        const card = tavernCard();
        const ilva = card.characters.find((item) => item.id === 'ilva')!;
        ilva.agenda = {
            ...ilva.agenda,
            goals: [
                { id: 'g2', text: 'Wants Сота out of this town', kind: 'internal', priority: 2 },
                { id: 'g1', text: 'Must raise the garrison tax by Friday', kind: 'external', priority: 1 },
            ],
            intentions: [{ id: 'i1', text: 'Must raise the garrison tax by Friday', nextStep: '', dropIf: [] }],
        };
        const bram = card.characters.find((item) => item.id === 'bram')!;
        bram.appetites = [
            {
                id: 'drink',
                kind: 'drink',
                label: 'брага',
                sources: ['individual'],
                target: { mode: 'thing' },
                baseline: 3,
                liking: 1,
                triggers: [],
                satisfiers: [],
                drift: 'daily',
                tolerance: 1,
                dependence: 2,
                sensitization: 0,
                endorsement: 'torn',
                vow: 'none',
                visibility: 'open',
                style: 'honest',
                affectionOnset: 'never',
            },
        ];
        return card;
    }

    it('describes a starting scene: who is there, what they do, their stance toward the player', async () => {
        await startHarness({ profiles: richCard(), persona: 'Курьер' });
        const cast = api().startCast!(0);
        expect(cast.map((member) => member.name)).toEqual(['Ильва', 'Брам', 'Сота', 'Фенн']);
        expect(cast[0]).toMatchObject({
            name: 'Ильва',
            present: true,
            doing: "counting the week's takings",
            goal: 'must raise the garrison tax by Friday',
            stance: -2,
            stanceLabel: 'Враждебна',
            reason: 'an imperial',
            gender: 'female',
        });
        expect(cast.find((member) => member.name === 'Фенн')).toMatchObject({ present: true, doing: 'asleep' });
        expect(api().startCast!(5).every((member) => !member.present)).toBe(true);
    });

    it('answers active, stances with reasons, goals, owned dependences and the mechanics switch', async () => {
        const h = await startHarness({ profiles: richCard(), persona: 'Курьер' });
        expect(api().active()).toBe(true);
        expect(api().replacesSocialMechanics()).toBe(true);
        const stances = api().stances();
        expect(stances).toContainEqual({
            from: 'Ильва',
            to: 'Курьер',
            stance: -2,
            label: 'Враждебна',
            reasons: ['an imperial', 'the Empire hanged her husband', 'paid generously'],
        });
        expect(stances).toContainEqual(expect.objectContaining({ from: 'Ильва', to: 'Сота', label: 'Союзница' }));
        expect(stances).toContainEqual(expect.objectContaining({ from: 'Брам', to: 'Курьер', label: 'Нейтрален' }));
        expect(api().goals('Ильвы')).toEqual(['Must raise the garrison tax by Friday', 'Wants Сота out of this town']);
        expect(api().goals('Никто')).toEqual([]);
        expect(api().dependenceOwned()).toEqual(['Брам']);
        h.app.settings.set('uiLanguage', 'en');
        expect(api().stances()).toContainEqual(
            expect.objectContaining({ from: 'Ильва', to: 'Курьер', label: 'hostile' }),
        );
    });

    it('follows the chat state: a dependence overcome no longer counts', async () => {
        const card = richCard();
        const h = await startHarness({ profiles: card });
        await h.engine.updateState((state) => {
            state.characters.bram!.appetites.drink!.dependence = 0;
        });
        expect(api().dependenceOwned()).toEqual([]);
    });

    it('is inactive without a cast and tells DRAMATIS_API listeners when the view arrives', async () => {
        const h = await startHarness({ profiles: emptyCardProfiles('tavern.png') });
        expect(api().active()).toBe(false);
        expect(api().stances()).toEqual([]);
        const listener = vi.fn();
        api().onChange(listener);
        await h.engine.updateProfiles(() => tavernCard());
        await flush();
        expect(api().active()).toBe(true);
        expect(listener).toHaveBeenCalled();
    });

    it('goes quiet when the module is switched off', async () => {
        const h = await startHarness({ profiles: tavernCard() });
        await h.runtime.modules.disable('engine');
        expect(api().active()).toBe(false);
        expect(h.app.modules.api('engine')).toBeUndefined();
        await h.runtime.modules.enable('engine');
        const engine = h.app.modules.api<typeof h.engine>('engine')!;
        await engine.ready();
        expect(api().active()).toBe(true);
    });
});

describe('engine — DRAMATIS_API.describe', () => {
    /** The tavern with Ильва written out in full: every section has something, secrets included. */
    function describedTavern(patch: Partial<ChatState> = {}): { card: CardProfiles; state: ChatState } {
        const { profiles, state } = tavern();
        const ilva = profiles.find((item) => item.id === 'ilva')!;
        ilva.lod = 'portrait';
        ilva.core = {
            ...ilva.core,
            temperament: { agreeableness: -2, extraversion: -2, openness: 1 },
            drives: { high: ['family', 'vengeance'], low: ['romance'] },
            wound: {
                ghost: 'the Empire hanged her husband',
                lie: 'no imperial can be trusted',
                triggers: [],
                coping: 'overcompensate',
            },
        };
        ilva.appetites = [
            {
                id: 'drink',
                kind: 'drink',
                label: 'брага',
                sources: ['individual'],
                target: { mode: 'thing' },
                baseline: 1,
                liking: 1,
                triggers: [],
                satisfiers: [],
                drift: 'daily',
                tolerance: 0,
                dependence: 1,
                sensitization: 0,
                endorsement: 'torn',
                vow: 'none',
                visibility: 'hidden',
                style: 'honest',
                affectionOnset: 'never',
            },
        ];
        ilva.agenda = {
            ...ilva.agenda,
            dream: 'a free town with no garrison.',
            goals: [
                { id: 'g2', text: 'Wants Сота out of this town', kind: 'internal', priority: 2 },
                { id: 'g1', text: 'Must raise the garrison tax by Friday', kind: 'external', priority: 1 },
            ],
            intentions: [
                {
                    id: 'i1',
                    goalId: 'g1',
                    text: 'Must raise the garrison tax by Friday',
                    nextStep: 'sell the old cart',
                    dropIf: [],
                },
                {
                    id: 'i2',
                    text: 'warn the rebels about the courier',
                    nextStep: 'send Брам with a letter',
                    dropIf: [],
                    hidden: true,
                } as Intention,
            ],
            front: {
                impulse: 'the rebels gather',
                steps: [],
                doom: 'the garrison burns on the feast day',
                clock: { segments: 6, filled: 2 },
            },
        };
        const toPlayer = ilva.ties.find((item) => item.target === PLAYER_ID)!;
        Object.assign(toPlayer, {
            intent: 'extract',
            want: 2,
            gaze: 'instrument',
            claim: 'claimed',
            appetite: 'drink',
        });
        state.characters.ilva = liveState(ilva, {
            scene: {
                attention: 'business',
                doing: "counting the week's takings",
                goal: 'must raise the garrison tax by Friday',
                obstacle: 'the courier is watching',
            },
            emotion: {
                type: 'suspicion',
                intensity: 3,
                target: PLAYER_ID,
                cause: 'he asked about the letters',
                until: 5,
            },
            stress: 40,
            corruption: { level: 2, stains: 1, gifts: [], brands: [] },
            appetites: {
                drink: {
                    pressure: 3,
                    tolerance: 0,
                    dependence: 1,
                    sensitization: 0,
                    lastSated: -1,
                    edgeCount: 0,
                    withdrawal: false,
                },
            },
        });
        state.schemes = [
            {
                id: 's1',
                owner: 'ilva',
                target: PLAYER_ID,
                method: 5,
                text: 'lead the courier into the rebels’ ambush',
                clock: { segments: 6, filled: 1 },
                secrecy: 80,
                breaches: 0,
                accomplices: ['bram'],
                state: 'running',
                startedTurn: 0,
            },
        ];
        return {
            card: { ...emptyCardProfiles('tavern.png'), characters: profiles },
            state: { ...state, card: 'tavern.png', ...patch },
        };
    }

    const linesOf = (view: ReturnType<NonNullable<DramatisApiV1['describe']>>) =>
        Object.fromEntries((view?.sections ?? []).map((section) => [section.id, section.lines]));

    it('sums up a character in Russian: stance, wants, now, appetites, who she is and secrets', async () => {
        const { card, state } = describedTavern();
        await startHarness({ profiles: card, state, persona: 'Курьер' });
        const view = api().describe!('Ильвы')!;
        expect(view).toMatchObject({
            name: 'Ильва',
            headline: "a rebel's widow who keeps the inn to spite the occupiers",
            detail: 'портрет',
            secrets: 'spoiler',
        });
        expect(view.sections.map((section) => [section.id, section.title])).toEqual([
            ['stance', 'Отношение к тебе'],
            ['wants', 'Чего хочет'],
            ['now', 'Сейчас'],
            ['appetites', 'Влечения'],
            ['core', 'Кто это'],
            ['secrets', 'Тайны'],
        ]);
        const lines = linesOf(view);
        expect(lines.stance).toEqual([
            { text: 'Враждебна — an imperial; the Empire hanged her husband; paid generously' },
            { text: 'Как проявляется: takes his coin, gives nothing back, never says his name' },
            {
                text: 'Хочет тебя: немного, как средство — подойдёт любой такой же; Притязание: застолбила',
                secret: true,
            },
            { text: 'Намерение: выведать', secret: true },
        ]);
        expect(lines.wants).toEqual([
            { text: 'Must raise the garrison tax by Friday → дальше: sell the old cart' },
            { text: 'Wants Сота out of this town' },
            { text: 'warn the rebels about the courier → дальше: send Брам with a letter', secret: true },
            { text: 'Мечта: a free town with no garrison' },
        ]);
        expect(lines.now).toEqual([
            { text: "Занятие: counting the week's takings" },
            { text: 'Цель в сцене: must raise the garrison tax by Friday' },
            { text: 'Помеха: the courier is watching' },
            { text: 'Настроение: grim watchfulness' },
            { text: 'Чувство: suspicion (Курьер) — he asked about the letters' },
            { text: 'Напряжение: 40 (срыв на 60)' },
            { text: 'Разложение: 2 — держится принципов' },
        ]);
        expect(lines.appetites).toEqual([{ text: 'брага: поглощена', secret: true }]);
        // 27 lines in all: the longest sections give up their last ones (the keys, then the tactics).
        expect(lines.core).toEqual([
            { text: 'Ценности: забота о близких, самостоятельность, традиция; пожертвует: безопасность' },
            { text: 'Темперамент: замкнутая, вспыльчивая, не прощает' },
            { text: 'Двигатели: семья, месть' },
            { text: 'Рана: the Empire hanged her husband' },
            { text: 'Ложная вера: no imperial can be trusted', secret: true },
            { text: 'Если → то: if she is ordered about, does it slowly and badly' },
        ]);
        expect(lines.secrets).toEqual([
            { text: 'passes letters to the rebels', secret: true },
            { text: 'Если никто не вмешается: the garrison burns on the feast day', secret: true },
            { text: 'Замысел (Курьер): lead the courier into the rebels’ ambush', secret: true },
        ]);
        expect(view.sections.reduce((sum, section) => sum + section.lines.length, 0)).toBe(DESCRIBE_MAX_LINES);
    });

    it('leaves secrets out under «только известное» (this chat’s lever) and keeps the rest whole', async () => {
        const { card, state } = describedTavern({ overrides: { secrets: 'known' } });
        await startHarness({ profiles: card, state, persona: 'Курьер' });
        const view = api().describe!('Ильва')!;
        expect(view.secrets).toBe('known');
        expect(view.sections.map((section) => section.id)).toEqual(['stance', 'wants', 'now', 'core']);
        expect(view.sections.flatMap((section) => section.lines).some((item) => item.secret)).toBe(false);
        expect(linesOf(view).core!.slice(-2)).toEqual([
            { text: 'Тактики: bluntness, silence, refusing small favours' },
            { text: 'Сдвинуть может: protection of her daughter; honest payment of the town debts' },
        ]);
    });

    it('speaks English when the UI does, and words a man and a sketch plainly', async () => {
        const { card, state } = describedTavern();
        const h = await startHarness({ profiles: card, state, persona: 'Курьер' });
        h.app.settings.set('uiLanguage', 'en');
        const ilva = api().describe!('Ильва')!;
        expect(ilva.detail).toBe('portrait');
        expect(ilva.sections.map((section) => section.title)).toEqual([
            'Toward you',
            'Wants',
            'Now',
            'Appetites',
            'Who they are',
            'Secrets',
        ]);
        expect(linesOf(ilva).stance![0]).toEqual({
            text: 'hostile — an imperial; the Empire hanged her husband; paid generously',
        });
        expect(linesOf(ilva).appetites).toEqual([{ text: 'брага: preoccupied', secret: true }]);

        h.app.settings.set('uiLanguage', 'ru');
        const bram = api().describe!('Брам')!;
        expect(bram).toMatchObject({ name: 'Брам', detail: 'эскиз' });
        expect(bram.headline).toBeUndefined();
        expect(linesOf(bram).stance).toEqual([
            { text: 'Нейтрален — sees a purse' },
            { text: 'Как проявляется: will offer "protection" at a steep price' },
        ]);
        expect(linesOf(bram).now).toEqual([
            { text: 'Занятие: dicing with the carters' },
            { text: 'Цель в сцене: wants paid work before winter' },
            { text: 'Настроение: спокойное' },
        ]);
    });

    it('finds the character by a DES alias or an id; nobody, an empty name or no chat give null', async () => {
        const { card, state } = describedTavern();
        const h = await startHarness({
            profiles: card,
            state,
            before: (mock) => {
                mock.extensionSettings['third-party/Dooms-Enhancement-Suite'] = {
                    characterAliases: { 'Ilva Holm': ['Ильва'] },
                };
            },
        });
        expect(api().describe!('Ilva Holm')?.name).toBe('Ильва');
        expect(api().describe!('sota')?.name).toBe('Сота');
        expect(api().describe!('Никто')).toBeNull();
        expect(api().describe!('  ')).toBeNull();
        await switchChat(h.mock, 'group-chat', { group: true });
        expect(api().describe!('Ильва')).toBeNull();
    });
});

describe('engine — strings', () => {
    it('has every key in both languages and defines every literal key the module uses', () => {
        expect(Object.keys(ENGINE_STRINGS.ru).sort()).toEqual(Object.keys(ENGINE_STRINGS.en).sort());
        const used = new Set<string>();
        for (const file of ['index.ts', 'describe.ts']) {
            const text = readFileSync(join(__dirname, '../../src/features/engine', file), 'utf8');
            for (const match of text.matchAll(/'(engine\.[A-Za-z0-9_.-]+)'/g)) used.add(match[1]!);
        }
        for (const id of ['stance', 'wants', 'now', 'appetites', 'core', 'secrets']) {
            used.add(`engine.describe.section.${id}`);
        }
        expect([...used].filter((key) => !(key in ENGINE_STRINGS.en))).toEqual([]);
        expect(used.size).toBeGreaterThan(30);
    });
});

describe('engine — fitting a summary', () => {
    const section = (id: string, n: number) => ({
        id,
        title: id,
        lines: Array.from({ length: n }, (_, i) => ({ text: `${id}${i}` })),
    });

    it('takes the last lines of the longest sections first, the later one on a tie, and drops empty ones', () => {
        const fitted = fitSections([section('a', 3), section('b', 5), section('c', 5), section('d', 0)], 9);
        expect(fitted.map((item) => [item.id, item.lines.length])).toEqual([
            ['a', 3],
            ['b', 3],
            ['c', 3],
        ]);
        expect(fitted[2]!.lines.at(-1)!.text).toBe('c2');
        expect(fitSections([section('a', 2)], 25)[0]!.lines).toHaveLength(2);
    });
});

describe('engine — who left the scene (§6.4)', () => {
    const tracker = [
        { name: 'Ильва', present: true, details: {} },
        { name: 'Брам', present: true, details: {} },
    ];

    it('keeps out whoever the committed turn took out, though the DES tracker still lists her', async () => {
        const state = tavernState({
            turn: 3,
            away: { ilva: { since: 3, by: 'narration' } },
            lastCommit: { messageIndex: 1, swipeId: 0, hash: 'h' },
        });
        const h = await startHarness({
            profiles: tavernCard(),
            state,
            chat: [message('Сажусь.', { is_user: true }), message('Ильва ушла.')],
        });
        fakeDes(h.runtime, tracker);
        await h.engine.refresh();
        expect(h.engine.view()?.present).toEqual(['bram']);
    });

    it('brings her back when the player calls her after the last commit, tracker or not', async () => {
        const state = tavernState({
            turn: 3,
            away: { ilva: { since: 3, by: 'narration' } },
            lastCommit: { messageIndex: 1, swipeId: 0, hash: 'h' },
        });
        const h = await startHarness({
            profiles: tavernCard(),
            state,
            chat: [message('Сажусь.', { is_user: true }), message('Ильва ушла.')],
        });
        fakeDes(h.runtime, [{ name: 'Брам', present: true, details: {} }]);
        h.mock.chat.push(message('Ильва, вернись!', { is_user: true }));
        await h.engine.refresh();
        expect(h.engine.view()?.present).toEqual(['bram', 'ilva']);
        // A message before the commit does not count.
        h.mock.chat.splice(2);
        h.mock.chat.unshift(message('Ильва, вернись!', { is_user: true }));
        await h.engine.refresh();
        expect(h.engine.view()?.present).toEqual(['bram']);
    });

    it('reads text presence from the narration only: names in the offscreen block are elsewhere', async () => {
        const h = await startHarness({
            card: ILVA_CARD,
            profiles: tavernCard(),
            state: tavernState(),
            chat: [
                message('Сажусь у стойки.', { is_user: true }),
                message('Брам бросает кости.\n\n<offscreen>Сота спит наверху.</offscreen>'),
            ],
        });
        expect(h.engine.view()?.present).toEqual(['ilva', 'bram']);
    });
});
