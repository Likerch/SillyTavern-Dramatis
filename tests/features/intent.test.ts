// @vitest-environment happy-dom
// The intent module on the whole app with a fake LLM answering the fixture readings (tests/domain/intent-fixtures.ts):
// the multi-part pipeline, merging, protected user fields, Maestro's journal and undo, the own client, the automatic
// reading and its re-read offer, error paths, the settings section and /dramatis-read.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyIntent } from '../../src/domain/intent-apply';
import { INTENT_TASK, intentSources } from '../../src/domain/intent-prompt';
import type { CardProfiles } from '../../src/domain/model';
import { emptyCardProfiles, emptyProfile, setMeta } from '../../src/domain/profile-defaults';
import { INTENT_API } from '../../src/features/intent/api';
import type { IntentApi } from '../../src/features/intent/api';
import { PARTIAL_MARK, PROFILES_TARGET, archiveNames, sourcesFingerprint } from '../../src/features/intent/reader';
import { plural } from '../../src/features/intent/strings';
import { createI18n } from '../../src/core/i18n';
import { INTENT_STRINGS } from '../../src/features/intent/strings';
import { DRAMATIS_API_GLOBAL } from '../../src/shared/apis';
import type { ApiJournalChange, ApiLlmResult, DramatisApiV1 } from '../../src/shared/apis';
import { fakeMaestro } from '../helpers/fakes';
import type { FakeMaestro } from '../helpers/fakes';
import { character, flush, message } from '../helpers/st-mock';
import type { StMock } from '../helpers/st-mock';
import { TAVERN_CARD, answer, tavernAnswer } from '../domain/intent-fixtures';
import { readProfilesFile, startHarness, stopHarness, switchChat, until } from './harness';
import type { Harness, HarnessOptions } from './harness';

afterEach(stopHarness);

type Dict = Record<string, unknown>;

/** Filler that makes a source long (the chunker then puts the second greeting into a part of its own). */
const filler = (chars: number) => ' Тишина.'.repeat(Math.ceil(chars / 8));

function tavernCharacter(options: { short?: boolean } = {}): STCharacter {
    const long = !options.short;
    return character(TAVERN_CARD.name, {
        avatar: 'tavern.png',
        description: TAVERN_CARD.description + (long ? filler(9000) : ''),
        scenario: TAVERN_CARD.scenario,
        first_mes: TAVERN_CARD.firstMes,
        data: {
            alternate_greetings: TAVERN_CARD.alternateGreetings.map((text) => text + (long ? filler(15000) : '')),
            creator_notes: TAVERN_CARD.creatorNotes,
            tags: TAVERN_CARD.tags,
        } as STCharacter['data'],
    });
}

/** The tavern reading split the way the card is chunked: the card itself, then the second greeting (Сота). */
function tavernParts(): [Dict, Dict] {
    const full = tavernAnswer() as Dict & { characters: Dict[] };
    const sota = full.characters.find((item) => item.name === 'Сота')!;
    return [{ ...full, characters: full.characters.filter((item) => item !== sota) }, answer({ characters: [sota] })];
}

/** The LLM answers these results in order (the last one repeats). */
function answering(maestro: FakeMaestro, replies: (ApiLlmResult | Promise<ApiLlmResult>)[]): void {
    let call = 0;
    maestro.reply = () => replies[Math.min(call++, replies.length - 1)]!;
}

const ok = (data: unknown): ApiLlmResult => ({ ok: true, data });

interface Notice {
    level: string;
    text: string;
    action?: string;
    run?: () => void;
}

/** Records every toast Dramatis shows (and lets a test press its action button). */
function captureNotices(): Notice[] {
    const log: Notice[] = [];
    const toastr = (globalThis as unknown as { toastr: Record<string, unknown> }).toastr;
    for (const level of ['info', 'warning', 'error', 'success']) {
        toastr[level] = (body: unknown, _title: unknown, options?: { onclick?: (event: unknown) => void }) => {
            const element = typeof body === 'string' ? null : (body as HTMLElement);
            const button = element?.querySelector('.dramatis-toast-action') ?? null;
            log.push({
                level,
                text: element ? (element.querySelector('.dramatis-toast-text')?.textContent ?? '') : String(body),
                action: button?.textContent ?? undefined,
                run: button && options?.onclick ? () => options.onclick!({ target: button }) : undefined,
            });
        };
    }
    return log;
}

interface Setup {
    h: Harness;
    maestro: FakeMaestro | null;
    intent: IntentApi;
    notices: Notice[];
    records: Parameters<FakeMaestro['api']['journal']['record']>[0][];
    undos: Map<string, (change: ApiJournalChange) => Promise<boolean>>;
    tasks: string[];
}

async function setup(
    options: HarnessOptions & { autoRead?: boolean; withMaestro?: boolean; replies?: ApiLlmResult[] } = {},
): Promise<Setup> {
    const maestro = options.withMaestro === false ? null : (options.maestro ?? fakeMaestro());
    const records: Setup['records'] = [];
    const undos: Setup['undos'] = new Map();
    const tasks: string[] = [];
    if (maestro) {
        answering(maestro, options.replies ?? tavernParts().map(ok));
        maestro.api.journal.record = async (action) => {
            records.push(action);
            return `j${records.length}`;
        };
        maestro.api.journal.registerUndo = (target, handler) => {
            undos.set(target, handler);
            return () => undos.delete(target);
        };
        maestro.api.llm.registerTask = (id) => {
            tasks.push(id);
            return () => {
                tasks.splice(tasks.indexOf(id), 1);
            };
        };
    }
    let notices: Notice[] = [];
    const h = await startHarness({
        card: tavernCharacter(),
        persona: 'Курьер',
        chat: [message(TAVERN_CARD.firstMes)],
        ...options,
        maestro: maestro ?? undefined,
        before: (mock) => {
            mock.extensionSettings.dramatis = {
                slices: { intent: { autoRead: options.autoRead ?? false } },
                // Only the stage-1 modules: the generator and the passes make their own requests and records.
                modules: { generator: false, turn: false, world: false },
            };
            notices = captureNotices();
            options.before?.(mock);
        },
    });
    const intent = h.app.modules.api<IntentApi>(INTENT_API)!;
    return { h, maestro, intent, notices, records, undos, tasks };
}

function profilesOf(mock: StMock): CardProfiles | null {
    return readProfilesFile(mock, 'tavern.png');
}

const api = () => (globalThis as unknown as Record<string, DramatisApiV1>)[DRAMATIS_API_GLOBAL]!;

describe('intent — reading the card', () => {
    it('reads the card in parts, merges them and saves the profiles through the engine', async () => {
        const { h, maestro, intent, notices, records, tasks } = await setup();
        expect(tasks).toContain(INTENT_TASK);
        const result = await intent.read({ force: true });
        expect(result).toMatchObject({ ok: true, characters: 4 });
        expect(result.message).toMatch(
            /^Замысел прочитан: 3 персонажа, 1 группа\. Замечаний: \d+ — подробно в листе замысла\.$/,
        );

        const requests = maestro!.requests;
        expect(requests).toHaveLength(2);
        for (const request of requests) {
            expect(request).toMatchObject({ task: INTENT_TASK, background: false, maxTokens: 6000, temperature: 0.2 });
            expect(request.schema?.name).toBe('dramatis_intent');
        }
        const second = requests[1]!.messages[1]!.content;
        expect(second).toContain('part 2 of 2');
        expect(second).toMatch(/<known>\nCharacters: Ильва, Брам/);
        expect(second).toContain('greeting 1');

        const saved = profilesOf(h.mock)!;
        expect(saved.characters.map((item) => item.name)).toEqual(['Ильва', 'Брам', 'возчики', 'Сота']);
        expect(saved.worldTone).toBe('hostile');
        expect(saved.intent?.sourcesHash).toBe(sourcesFingerprint(h.app.readers.card.current()!, []));
        expect(h.engine.view()?.byId.has('ilva')).toBe(true);
        expect(intent.lastResult()).toBe(result);
        expect(intent.running()).toBe(false);

        expect(notices.map((item) => item.text)).toEqual([
            'Читаю замысел: часть 1 из 2…',
            'Читаю замысел: часть 2 из 2…',
            expect.stringContaining('Замысел прочитан: 3 персонажа, 1 группа.'),
        ]);
        const done = notices[2]!;
        expect(done.action).toBe('Открыть');
        done.run!();
        expect(document.querySelector('[data-window="cast"]')).not.toBeNull();

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ kind: 'dramatis.intent' });
        expect(records[0]!.changes[0]).toMatchObject({ target: PROFILES_TARGET, ref: { card: 'tavern.png' } });
        expect((records[0]!.changes[0]!.before as CardProfiles).characters).toEqual([]);
        expect((records[0]!.changes[0]!.after as CardProfiles).characters).toHaveLength(4);
    });

    it('lists what the code refused as notes (a stance capped, a field without its quote)', async () => {
        const { intent } = await setup({ replies: [ok(tavernAnswer(1)), ok(answer())] });
        const result = await intent.read({ force: true });
        expect(result.ok).toBe(true);
        expect(result.warnings.some((line) => line.startsWith('Ильва: отношение к тебе снижено'))).toBe(true);
    });

    it('keeps the user’s edits and locks and reports them in the diff', async () => {
        const first = applyIntent(emptyCardProfiles('tavern.png'), tavernAnswer(), {
            fidelity: 'strict',
            now: 1,
            sourcesHash: 'old',
            sources: intentSources(TAVERN_CARD),
            personaName: 'Курьер',
            cardName: TAVERN_CARD.name,
        }).profiles;
        const ilva = first.characters.find((item) => item.id === 'ilva')!;
        const mine = setMeta({ ...ilva, core: { ...ilva.core, concept: 'Моя Ильва' } }, 'core.concept', {
            origin: 'user',
        });
        const stored = { ...first, characters: first.characters.map((item) => (item.id === 'ilva' ? mine : item)) };
        const { h, intent } = await setup({ profiles: stored });
        const result = await intent.read({ force: true });
        expect(result.ok).toBe(true);
        const after = profilesOf(h.mock)!.characters.find((item) => item.id === 'ilva')!;
        expect(after.core.concept).toBe('Моя Ильва');
        expect(result.diff).toContainEqual(
            expect.objectContaining({ character: 'ilva', path: 'core.concept', status: 'kept-user' }),
        );
    });

    it('skips a card whose sources did not change, unless forced', async () => {
        const { h, maestro, intent } = await setup();
        await intent.read({ force: true });
        const result = await intent.read();
        expect(result).toMatchObject({ ok: true, skipped: true, characters: 0 });
        expect(maestro!.requests).toHaveLength(2);
        expect(profilesOf(h.mock)?.intent).toBeDefined();
        await intent.read({ force: true });
        expect(maestro!.requests).toHaveLength(4);
    });

    it('adds the CK archives of the names the card itself found to the later parts', async () => {
        const asked: string[][] = [];
        const { h, maestro, intent } = await setup();
        h.runtime.readers.lore.archives = async (names) => {
            asked.push(names);
            return names.includes('Брам')
                ? [{ name: 'Брам', book: 'Repo', uid: 3, tags: [{ key: 'TRAIT', value: 'GREEDY' }] }]
                : [];
        };
        await intent.read({ force: true });
        expect(asked[0]).toEqual([TAVERN_CARD.name]);
        expect(asked[1]).toEqual(expect.arrayContaining(['Ильва', 'Брам', 'возчики']));
        expect(maestro!.requests[0]!.messages[1]!.content).not.toContain('Character archive');
        expect(maestro!.requests[1]!.messages[1]!.content).toContain('Character archive (BunnyMo tags) · Брам');
    });

    it('names archives by the card, its lorebook and the known profiles', () => {
        const names = archiveNames(TAVERN_CARD, [{ uid: 1, keys: ['Сота', 'дочь'], comment: 'Сота', content: '…' }], {
            ...emptyCardProfiles('t'),
            characters: [emptyProfile('Брам', { aliases: ['наёмник'] })],
        });
        expect(names).toEqual([TAVERN_CARD.name, 'Сота', 'дочь', 'Брам', 'наёмник']);
    });
});

describe('intent — a short card', () => {
    it('reads it in one request', async () => {
        const { h, maestro, intent, notices } = await setup({
            card: tavernCharacter({ short: true }),
            replies: [ok(tavernAnswer())],
        });
        const result = await intent.read({ force: true });
        expect(result).toMatchObject({ ok: true, characters: 4 });
        expect(maestro!.requests).toHaveLength(1);
        expect(maestro!.requests[0]!.messages[1]!.content).toContain('greeting 1');
        expect(notices[0]!.text).toBe('Читаю замысел…');
        expect(profilesOf(h.mock)!.characters).toHaveLength(4);
    });
});

describe('intent — errors', () => {
    it('saves nothing when the first part fails and says why', async () => {
        const { h, intent, notices } = await setup({ replies: [{ ok: false, error: 'cap' }] });
        const result = await intent.read({ force: true });
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Исчерпан дневной лимит расходов на фоновые задачи ИИ (настройки Maestro).');
        expect(profilesOf(h.mock)).toBeNull();
        expect(notices[notices.length - 1]).toMatchObject({
            level: 'error',
            text: `Замысел не прочитан: ${result.error}`,
        });
    });

    it('keeps the parts it got when a later one fails, and marks the reading for a re-read', async () => {
        const [first] = tavernParts();
        const { h, intent, notices } = await setup({
            replies: [ok(first), { ok: false, error: 'transport: HTTP 502' }],
        });
        const result = await intent.read({ force: true });
        expect(result.ok).toBe(true);
        expect(result.warnings[0]).toBe('часть 2 из 2 не прочитана: Не удалось связаться с моделью: HTTP 502');
        const saved = profilesOf(h.mock)!;
        expect(saved.characters.map((item) => item.name)).toEqual(['Ильва', 'Брам', 'возчики']);
        expect(saved.intent?.sourcesHash.endsWith(PARTIAL_MARK)).toBe(true);
        expect(notices[notices.length - 1]!.level).toBe('warning');
    });

    it('treats an answer that is not JSON as unreadable', async () => {
        const { intent } = await setup({ replies: [{ ok: true, data: 'no json here', text: 'no json here' }] });
        const result = await intent.read({ force: true });
        expect(result).toMatchObject({ ok: false, error: 'Не получилось разобрать ответ модели.' });
    });

    it('refuses a second reading while one runs', async () => {
        let release: (value: ApiLlmResult) => void = () => {};
        const pending = new Promise<ApiLlmResult>((resolve) => {
            release = resolve;
        });
        const maestro = fakeMaestro();
        const { intent } = await setup({ maestro });
        answering(maestro, [pending, ok(tavernParts()[1])]);
        const first = intent.read({ force: true });
        await flush();
        expect(intent.running()).toBe(true);
        const second = await intent.read({ force: true });
        expect(second).toMatchObject({ ok: false, error: 'Замысел уже читается.' });
        release(ok(tavernParts()[0]));
        expect((await first).ok).toBe(true);
    });

    it('reads only in a chat with one character', async () => {
        const { h, intent } = await setup();
        h.mock.groupId = 'group-1';
        const result = await intent.read({ force: true });
        expect(result).toMatchObject({ ok: false, error: 'Замысел читается только в чате с одним персонажем.' });
    });

    it('reports a save that failed', async () => {
        const { h, intent } = await setup();
        h.engine.updateProfiles = async () => false;
        const result = await intent.read({ force: true });
        expect(result).toMatchObject({ ok: false, error: 'Не получилось сохранить прочитанное.' });
    });
});

describe('intent — Maestro and the own client', () => {
    it('undo from Maestro’s journal restores the profiles as they were', async () => {
        const { h, intent, records, undos } = await setup();
        await intent.read({ force: true });
        const undo = undos.get(PROFILES_TARGET)!;
        expect(await undo(records[0]!.changes[0]!)).toBe(true);
        expect(profilesOf(h.mock)!.characters).toEqual([]);
        expect(h.engine.view()?.profiles).toEqual([]);
        expect(await undo({ target: PROFILES_TARGET, ref: {}, before: null, after: null })).toBe(false);
    });

    it('registers the task and the undo again after Maestro restarts, and drops them when it leaves', async () => {
        const { h, tasks, undos } = await setup();
        delete (globalThis as Record<string, unknown>).MAESTRO_API;
        h.runtime.bridge.check();
        await flush();
        expect(tasks).not.toContain(INTENT_TASK);
        expect(undos.size).toBe(0);
        const again = fakeMaestro();
        const registered: string[] = [];
        again.api.llm.registerTask = (id) => {
            registered.push(id);
            return () => {};
        };
        (globalThis as Record<string, unknown>).MAESTRO_API = again.api;
        h.runtime.bridge.check();
        await flush();
        expect(registered).toContain(INTENT_TASK);
    });

    it('works without Maestro on the own connection profile', async () => {
        const replies = tavernParts();
        let call = 0;
        const sent: unknown[] = [];
        const { h, intent } = await setup({
            withMaestro: false,
            before: (mock) => {
                mock.extensionSettings.connectionManager = {
                    selectedProfile: 'p1',
                    profiles: [{ id: 'p1', name: 'Main', api: 'openai' }],
                };
                mock.sendRequest = async (_profile, prompt) => {
                    sent.push(prompt);
                    const content = JSON.stringify(replies[Math.min(call++, 1)]);
                    return { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] };
                };
            },
        });
        const result = await intent.read({ force: true });
        expect(result).toMatchObject({ ok: true, characters: 4 });
        expect(sent).toHaveLength(2);
        expect(profilesOf(h.mock)!.characters).toHaveLength(4);
    });
});

describe('intent — reading by itself', () => {
    it('reads a new chat’s card once, with nothing to do on the next chat of that card', async () => {
        const { h, maestro } = await setup({ autoRead: true });
        await until(() => !!profilesOf(h.mock)?.intent && maestro!.requests.length === 2);
        expect(profilesOf(h.mock)!.characters).toHaveLength(4);
        await switchChat(h.mock, 'chat-2', { maestro: maestro! });
        await flush();
        expect(maestro!.requests).toHaveLength(2);
    });

    it('waits for Maestro to make this tab the chat’s leader, then reads', async () => {
        const maestro = fakeMaestro();
        let leader = false;
        const listeners: ((leader: boolean) => void)[] = [];
        maestro.api.leader = {
            isLeader: () => leader,
            onChange: (listener) => {
                listeners.push(listener);
                return () => listeners.splice(listeners.indexOf(listener), 1);
            },
        };
        const { h } = await setup({ autoRead: true, maestro });
        await flush();
        expect(maestro.requests).toHaveLength(0);
        leader = true;
        for (const listener of [...listeners]) listener(true);
        await until(() => !!profilesOf(h.mock)?.intent && maestro.requests.length === 2);
        expect(profilesOf(h.mock)!.characters).toHaveLength(4);
    });

    it('is background work with Maestro (leader tab, daily cap): a «not now» answer stays quiet', async () => {
        const { h, maestro, notices } = await setup({ autoRead: true, replies: [{ ok: false, error: 'cap' }] });
        await until(() => maestro!.requests.length === 1);
        await flush();
        expect(maestro!.requests[0]).toMatchObject({ task: INTENT_TASK, background: true });
        expect(notices.filter((notice) => notice.level === 'error')).toEqual([]);
        expect(profilesOf(h.mock)).toBeNull();
        // The button is the user's own request: interactive, past the cap.
        answering(maestro!, tavernParts().map(ok));
        const result = await h.app.modules.api<IntentApi>(INTENT_API)!.read({ force: true });
        expect(result.ok).toBe(true);
        expect(maestro!.requests.slice(1).every((request) => request.background === false)).toBe(true);
    });

    it('never runs twice for a card in one session, even after a failure', async () => {
        const { h, maestro } = await setup({ autoRead: true, replies: [{ ok: false, error: 'breaker' }] });
        await until(() => maestro!.requests.length === 1);
        await flush();
        await switchChat(h.mock, 'chat-2', { maestro: maestro! });
        await flush();
        expect(maestro!.requests).toHaveLength(1);
    });

    it.each([
        [
            'the chat already has the user’s messages',
            { chat: [message('Привет'), message('Здравствуй', { is_user: true })] },
        ],
        ['reading by itself is off', { autoRead: false }],
        ['the AI connection is not ready', { unavailable: true }],
        ['this tab does not lead the chat', { follower: true }],
    ])('stays put when %s', async (_name, patch) => {
        const maestro = fakeMaestro();
        if ((patch as { unavailable?: boolean }).unavailable) maestro.available = false;
        if ((patch as { follower?: boolean }).follower) maestro.api.leader.isLeader = () => false;
        const options = { autoRead: true, maestro, ...(patch as HarnessOptions & { autoRead?: boolean }) };
        const { h } = await setup(options);
        await flush();
        await flush();
        expect(maestro.requests).toHaveLength(0);
        expect(profilesOf(h.mock)).toBeNull();
    });

    it('stays put in a group chat', async () => {
        const maestro = fakeMaestro();
        const { h } = await setup({ autoRead: true, maestro, before: (mock) => void (mock.groupId = 'group-1') });
        await flush();
        expect(maestro.requests).toHaveLength(0);
        expect(h.engine.view()).toBeNull();
    });

    it('offers to read a changed card again, once, and reads it on the button', async () => {
        const stored = { ...emptyCardProfiles('tavern.png'), intent: { at: 1, sourcesHash: 'old' } };
        const { h, maestro, notices } = await setup({ autoRead: true, profiles: stored });
        await until(() => notices.some((item) => item.action === 'Перечитать'));
        const offer = notices.find((item) => item.action === 'Перечитать')!;
        expect(offer.text).toBe(
            'Карточка изменилась с тех пор, как замысел был прочитан. Перечитать? Твои правки останутся.',
        );
        await switchChat(h.mock, 'chat-2', { maestro: maestro! });
        await flush();
        expect(notices.filter((item) => item.action === 'Перечитать')).toHaveLength(1);
        offer.run!();
        await until(() => maestro!.requests.length === 2 && profilesOf(h.mock)!.characters.length === 4);
        expect(profilesOf(h.mock)!.intent?.sourcesHash).not.toBe('old');
    });

    it('offers nothing when the card is as it was read', async () => {
        const maestro = fakeMaestro();
        const { h, notices } = await setup({ maestro });
        await h.app.modules.api<IntentApi>(INTENT_API)!.read({ force: true });
        const before = notices.length;
        h.app.settings.module<{ autoRead: boolean }>('intent', () => ({ autoRead: true })).autoRead = true;
        await switchChat(h.mock, 'chat-2', { maestro });
        await flush();
        expect(notices.length).toBe(before);
        expect(maestro.requests).toHaveLength(2);
    });
});

describe('intent — DRAMATIS_API', () => {
    it('tells where the reading of the card stands, before, during and after it', async () => {
        let release: (value: ApiLlmResult) => void = () => {};
        const pending = new Promise<ApiLlmResult>((resolve) => {
            release = resolve;
        });
        const maestro = fakeMaestro();
        const { h } = await setup({ maestro });
        answering(maestro, [pending, ok(tavernParts()[1])]);
        expect(api().intentState!()).toEqual({ read: false, characters: 0, groups: 0, running: false });

        const listener = vi.fn();
        api().onChange(listener);
        const reading = api().readIntent!({ force: true });
        await flush();
        expect(api().intentState!()).toMatchObject({ read: false, running: true });
        expect(listener).toHaveBeenCalled();
        listener.mockClear();

        release(ok(tavernParts()[0]));
        const outcome = await reading;
        expect(outcome).toEqual({
            ok: true,
            characters: 4,
            message: expect.stringMatching(/^Замысел прочитан: 3 персонажа, 1 группа\./),
        });
        await until(() => api().intentState!()?.read === true);
        const state = api().intentState!()!;
        expect(state).toMatchObject({ read: true, characters: 3, groups: 1, running: false });
        expect(state.at).toBe(profilesOf(h.mock)!.intent!.at);
        expect(listener).toHaveBeenCalled();
    });

    it('reads as the user’s action, skips an unchanged card unless forced and reports failures in words', async () => {
        const { maestro } = await setup();
        expect((await api().readIntent!()).ok).toBe(true);
        expect(maestro!.requests.every((request) => request.background === false)).toBe(true);
        expect(await api().readIntent!()).toEqual({
            ok: true,
            characters: 0,
            skipped: true,
            message: 'Карточка не менялась с тех пор, как замысел был прочитан.',
        });
        answering(maestro!, [{ ok: false, error: 'not-leader' }]);
        expect(await api().readIntent!({ force: true })).toEqual({
            ok: false,
            characters: 0,
            error: 'Этот чат ведёт другая вкладка SillyTavern: фоновые задачи ИИ идут там.',
            message: 'Замысел не прочитан: Этот чат ведёт другая вкладка SillyTavern: фоновые задачи ИИ идут там.',
        });
    });

    it('waits for a reading already running instead of refusing it', async () => {
        let release: (value: ApiLlmResult) => void = () => {};
        const pending = new Promise<ApiLlmResult>((resolve) => {
            release = resolve;
        });
        const maestro = fakeMaestro();
        const { intent, notices } = await setup({ maestro });
        answering(maestro, [pending, ok(tavernParts()[1])]);
        const first = intent.read({ force: true });
        await flush();
        const waiting = api().readIntent!({ force: true });
        release(ok(tavernParts()[0]));
        const [result, outcome] = await Promise.all([first, waiting]);
        expect(outcome).toMatchObject({ ok: true, characters: 4, message: result.message });
        expect(maestro.requests).toHaveLength(2);
        expect(notices.some((item) => item.text === 'Замысел уже читается.')).toBe(false);
        expect(api().intentState!()?.running).toBe(false);
    });

    it('has no state outside a solo chat and says why it cannot read there', async () => {
        const { h } = await setup();
        await switchChat(h.mock, 'group-chat', { group: true });
        expect(api().intentState!()).toBeNull();
        expect(await api().readIntent!()).toMatchObject({
            ok: false,
            error: 'Замысел читается только в чате с одним персонажем.',
        });
    });

    it('answers «not available» when the module is off', async () => {
        const { h } = await setup();
        await h.runtime.modules.disable('intent');
        expect(api().intentState!()).toBeNull();
        expect(await api().readIntent!({ force: true })).toEqual({
            ok: false,
            characters: 0,
            error: 'Замысел сейчас не прочитать: Dramatis или его модуль «Замысел автора» выключен.',
            message: 'Замысел сейчас не прочитать: Dramatis или его модуль «Замысел автора» выключен.',
        });
    });
});

describe('intent — settings and slash command', () => {
    it('shows the «Замысел» section with the switch, the card’s status and the read button', async () => {
        const { h } = await setup();
        const section = document.querySelector('[data-section="intent"]')!;
        expect(section.querySelector('h4')?.textContent).toBe('Замысел');
        await until(() => section.textContent!.includes('Замысел ещё не прочитан'));
        expect(section.textContent).toContain('Замысел ещё не прочитан');
        const box = section.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
        box.checked = true;
        box.dispatchEvent(new Event('change'));
        expect(h.app.settings.module<{ autoRead: boolean }>('intent', () => ({ autoRead: false })).autoRead).toBe(true);
        const button = [...section.querySelectorAll('button')].find(
            (node) => node.textContent === 'Прочитать замысел',
        )!;
        button.click();
        await until(() => section.textContent!.includes('Прочитан'));
        expect(profilesOf(h.mock)!.characters).toHaveLength(4);
        expect(section.textContent).toMatch(/Прочитан \d/);

        const open = [...section.querySelectorAll('button')].find(
            (node) => node.textContent === 'Открыть лист замысла',
        )!;
        expect(document.querySelector('[data-window="cast"]')).toBeNull();
        open.click();
        expect(document.querySelector('[data-window="cast"] .dramatis-window-title')?.textContent).toBe('Лист замысла');
    });

    it('/dramatis-read reads again and answers with the summary or the error', async () => {
        const { h, maestro } = await setup();
        const command = h.mock.slashCommands.get('dramatis-read')!;
        expect(await command.callback({}, '')).toMatch(/^Замысел прочитан: 3 персонажа, 1 группа\./);
        answering(maestro!, [{ ok: false, error: 'not-leader' }]);
        expect(await command.callback({}, '')).toBe(
            'Замысел не прочитан: Этот чат ведёт другая вкладка SillyTavern: фоновые задачи ИИ идут там.',
        );
    });
});

describe('intent — plural forms', () => {
    it('picks Russian and English forms', () => {
        let locale: 'ru' | 'en' = 'ru';
        const i18n = createI18n(() => locale);
        i18n.register(INTENT_STRINGS);
        expect([1, 2, 5, 11, 21, 22, 25].map((n) => plural(i18n, 'intent.n.characters', n))).toEqual([
            '1 персонаж',
            '2 персонажа',
            '5 персонажей',
            '11 персонажей',
            '21 персонаж',
            '22 персонажа',
            '25 персонажей',
        ]);
        locale = 'en';
        expect([1, 2].map((n) => plural(i18n, 'intent.n.groups', n))).toEqual(['1 group', '2 groups']);
    });
});
