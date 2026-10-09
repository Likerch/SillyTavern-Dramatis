import { beforeEach, describe, expect, it } from 'vitest';
import {
    SCHEMA_MIN_TOKENS,
    createLlmRouter,
    extractReply,
    looksLikeRefusal,
    matchesSchema,
    parseJsonText,
    stripThinking,
} from '../../src/core/llm';
import { Settings } from '../../src/core/settings';
import type { LlmRequest } from '../../src/shared/contracts';
import { fakeMaestro, memoryLogger, mockHost, staticBridge } from '../helpers/fakes';
import { installStMock } from '../helpers/st-mock';
import type { StMock } from '../helpers/st-mock';

interface Sent {
    profileId: string;
    messages: { role: string; content: string }[];
    maxTokens: number;
    custom: Record<string, unknown>;
    override: Record<string, unknown>;
}

let mock: StMock;
let sent: Sent[];
let replies: (unknown | Error)[];

const SCHEMA = {
    name: 'verdict',
    schema: {
        type: 'object',
        required: ['mood'],
        properties: { mood: { type: 'string', enum: ['calm', 'angry'] } },
    },
};

function completion(content: string, extra: Record<string, unknown> = {}) {
    return { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], ...extra };
}

function request(overrides: Partial<LlmRequest> = {}): LlmRequest {
    return {
        task: 'dramatis.intent',
        messages: [{ role: 'user', content: 'Прочитай замысел' }],
        maxTokens: 100,
        background: false,
        ...overrides,
    };
}

function setup(options: { profile?: string; selected?: string | null; api?: string; maestro?: boolean } = {}) {
    mock.extensionSettings.connectionManager = {
        selectedProfile: options.selected === undefined ? 'p-active' : options.selected,
        profiles: [
            { id: 'p-active', name: 'Active', api: options.api ?? 'openai' },
            { id: 'p-chosen', name: 'Chosen', api: 'openrouter' },
        ],
    };
    const log = memoryLogger();
    const settings = new Settings(
        () => mock.extensionSettings,
        () => {},
        log,
    );
    if (options.profile !== undefined) settings.set('profile', options.profile);
    const maestro = fakeMaestro();
    const bridge = staticBridge(options.maestro ? maestro.api : null);
    const router = createLlmRouter({ host: mockHost(), settings, bridge, log, backoffMs: [0, 0] });
    return { router, maestro, bridge, settings, log };
}

beforeEach(() => {
    mock = installStMock();
    sent = [];
    replies = [];
    mock.sendRequest = async (profileId, prompt, maxTokens, custom, override) => {
        sent.push({
            profileId,
            messages: prompt as Sent['messages'],
            maxTokens,
            custom: custom as Record<string, unknown>,
            override: override as Record<string, unknown>,
        });
        const next = replies.shift() ?? completion('');
        if (next instanceof Error) throw next;
        return next;
    };
});

describe('route through Maestro', () => {
    it('maps the request and the result', async () => {
        const { router, maestro } = setup({ maestro: true });
        maestro.reply = () => ({
            ok: true,
            data: { mood: 'calm' },
            text: '{}',
            costUsd: 0.002,
            tokens: { prompt: 1, completion: 2 },
        });
        const controller = new AbortController();
        const result = await router.request(
            request({ background: true, schema: SCHEMA, temperature: 0.3, signal: controller.signal }),
        );
        expect(result).toEqual({ ok: true, data: { mood: 'calm' }, text: '{}', costUsd: 0.002 });
        expect(maestro.requests[0]).toEqual({
            task: 'dramatis.intent',
            messages: [{ role: 'user', content: 'Прочитай замысел' }],
            maxTokens: 100,
            temperature: 0.3,
            schema: SCHEMA,
            background: true,
            signal: controller.signal,
        });
        expect(sent).toHaveLength(0);
        expect(router.viaMaestro()).toBe(true);
    });

    it('passes Maestro refusals of background work through and survives a throwing API', async () => {
        const { router, maestro } = setup({ maestro: true });
        maestro.reply = () => ({ ok: false, error: 'not-leader' });
        expect(await router.request(request({ background: true }))).toEqual({ ok: false, error: 'not-leader' });
        maestro.reply = () => {
            throw new Error('down');
        };
        expect(await router.request(request())).toEqual({ ok: false, error: 'maestro: down' });
    });

    it('asks Maestro whether a task is available', () => {
        const { router, maestro } = setup({ maestro: true });
        expect(router.available('dramatis.turn', true)).toBe(true);
        maestro.available = false;
        expect(router.available('dramatis.turn', true)).toBe(false);
    });
});

describe('own client', () => {
    it('refuses background tasks without Maestro', async () => {
        const { router } = setup();
        expect(await router.request(request({ background: true }))).toEqual({ ok: false, error: 'needs-maestro' });
        expect(router.available('dramatis.turn', true)).toBe(false);
        expect(router.available('dramatis.intent', false)).toBe(true);
        expect(router.viaMaestro()).toBe(false);
    });

    it('uses the active connection profile, else the one chosen in the settings', async () => {
        const { router, settings } = setup();
        replies.push(completion('Готово'));
        expect(await router.request(request())).toEqual({ ok: true, text: 'Готово', data: 'Готово' });
        expect(sent[0]?.profileId).toBe('p-active');
        expect(sent[0]?.custom).toMatchObject({ stream: false, extractData: false, includePreset: false });

        settings.set('profile', 'p-chosen');
        replies.push(completion('Ещё'));
        await router.request(request());
        expect(sent[1]?.profileId).toBe('p-chosen');
        // OpenRouter: reasoning off.
        expect(sent[1]?.override.reasoning_effort).toBe('none');
        expect(sent[0]?.override.reasoning_effort).toBeUndefined();
    });

    it('answers no-profile and no-cm', async () => {
        const { router } = setup({ selected: null });
        expect(await router.request(request())).toEqual({ ok: false, error: 'no-profile' });
        expect(router.available('dramatis.intent', false)).toBe(false);

        const second = setup({ profile: 'p-gone' });
        expect(await second.router.request(request())).toEqual({ ok: false, error: 'no-profile' });

        (mock.extensionSettings.disabledExtensions as string[]).push('connection-manager');
        const third = setup();
        expect(await third.router.request(request())).toEqual({ ok: false, error: 'no-cm' });
    });

    it('parses structured output with fences and reasoning, asking json_schema first', async () => {
        const { router } = setup();
        replies.push(completion('<think>hmm</think>\n```json\n{"mood":"angry"}\n```', { usage: { cost: 0.01 } }));
        const result = await router.request(request({ schema: SCHEMA, maxTokens: 50 }));
        expect(result).toMatchObject({ ok: true, data: { mood: 'angry' }, costUsd: 0.01 });
        expect(sent[0]?.override.json_schema).toEqual({ name: 'verdict', strict: true, value: SCHEMA.schema });
        expect(sent[0]?.maxTokens).toBe(SCHEMA_MIN_TOKENS);
    });

    it('retries without json_schema when the answer does not parse', async () => {
        const { router } = setup();
        replies.push(completion('not json at all'), completion('{"mood":"calm"}'));
        const result = await router.request(request({ schema: SCHEMA }));
        expect(result).toMatchObject({ ok: true, data: { mood: 'calm' } });
        expect(sent).toHaveLength(2);
        expect(sent[1]?.override.json_schema).toBeUndefined();
        expect(sent[1]?.messages.at(-1)?.content).toContain('JSON schema');
    });

    it('falls back to instructions when the provider rejects json_schema', async () => {
        const { router } = setup();
        replies.push(new Error('response_format json_schema is not supported'), completion('{"mood":"calm"}'));
        const result = await router.request(request({ schema: SCHEMA }));
        expect(result).toMatchObject({ ok: true, data: { mood: 'calm' } });
        expect(sent).toHaveLength(2);
    });

    it('gives parse after two unusable answers', async () => {
        const { router } = setup();
        replies.push(completion('{"mood":"sad"}'), completion('{"mood":"sad"}'));
        expect(await router.request(request({ schema: SCHEMA }))).toMatchObject({ ok: false, error: 'parse' });
    });

    it('retries transport errors twice, then reports them', async () => {
        const { router } = setup();
        replies.push(new Error('502'), new Error('502'), completion('ok'));
        expect(await router.request(request())).toMatchObject({ ok: true, text: 'ok' });
        expect(sent).toHaveLength(3);

        replies.push(new Error('503'), new Error('503'), new Error('503'));
        expect(await router.request(request())).toEqual({ ok: false, error: 'transport: 503' });
    });

    it('does not retry configuration errors', async () => {
        const { router } = setup();
        replies.push(new Error('Profile not found (ID: x)'));
        expect((await router.request(request())).ok).toBe(false);
        expect(sent).toHaveLength(1);
    });

    it('recognises refusals and empty answers', async () => {
        const { router } = setup();
        replies.push(completion("I'm sorry, but I can't help with that."));
        expect(await router.request(request())).toMatchObject({ ok: false, refusal: true, error: 'refusal' });
        replies.push(completion(''));
        expect(await router.request(request())).toEqual({ ok: false, error: 'empty' });
    });

    it('stops on abort', async () => {
        const { router } = setup();
        const controller = new AbortController();
        controller.abort();
        expect(await router.request(request({ signal: controller.signal }))).toEqual({ ok: false, error: 'aborted' });
        expect(sent).toHaveLength(0);
    });
});

describe('reply helpers', () => {
    it('strips reasoning blocks and text before a lone closing tag', () => {
        expect(stripThinking('<think>a</think>Ответ')).toBe('Ответ');
        expect(stripThinking('thoughts...</thinking>Answer')).toBe('Answer');
        expect(stripThinking('plain')).toBe('plain');
    });

    it('parses JSON out of fences and prose', () => {
        expect(parseJsonText('```json\n{"a":1}\n```')).toEqual({ a: 1 });
        expect(parseJsonText('Вот: {"a":[1,2]} — готово')).toEqual({ a: [1, 2] });
        expect(parseJsonText('list: [1, 2]')).toEqual([1, 2]);
        expect(parseJsonText('nothing')).toBeUndefined();
        expect(parseJsonText('')).toBeUndefined();
    });

    it('reads the reply shapes of several providers', () => {
        expect(extractReply('raw')).toEqual({ text: 'raw', refusal: false });
        expect(extractReply({ content: [{ type: 'text', text: 'claude' }], stop_reason: 'refusal' })).toEqual({
            text: 'claude',
            refusal: true,
        });
        expect(extractReply({ candidates: [{ content: { parts: [{ text: 'gemini' }] } }] }).text).toBe('gemini');
        expect(extractReply({ choices: [{ message: { content: '', refusal: 'no' } }] })).toEqual({
            text: 'no',
            refusal: true,
        });
        expect(extractReply({ choices: [{ text: 'tc' }] }).text).toBe('tc');
    });

    it('checks schemas lightly', () => {
        expect(matchesSchema({ mood: 'calm' }, SCHEMA.schema)).toBe(true);
        expect(matchesSchema({}, SCHEMA.schema)).toBe(false);
        expect(matchesSchema([1, 'x'], { type: 'array', items: { type: 'integer' } })).toBe(false);
        expect(matchesSchema(null, { type: ['null', 'string'] })).toBe(true);
    });

    it('does not take quoted story text for a refusal', () => {
        expect(looksLikeRefusal('"I can\'t help it," she said.')).toBe(false);
        expect(looksLikeRefusal('Извините, но я не могу это написать.')).toBe(true);
    });
});
