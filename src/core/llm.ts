// LLM requests of Dramatis (docs/dev-plan.md «ИИ»):
// - with Maestro: everything goes through MAESTRO_API.llm (task profiles, cost accounting, daily cap, leader tab);
// - without it: only interactive tasks (the user pressed a button: reading the author's intent) run on Dramatis' own
//   client; background tasks answer `needs-maestro`.
//
// The own client is ported from Maestro src/core/llm.ts: a saved Connection Manager profile (the one chosen in the
// settings, else the active one), past the chat — no lorebooks, interceptors or the preset (includePreset: false);
// transport errors get 2 retries with backoff, a refusal is never retried; structured output asks for json_schema,
// parses the reply (fences and <think> stripped, outermost {…}) and on failure tries once more with the schema as
// instructions; on OpenRouter reasoning is switched off (reasoning_effort 'none') so short tasks do not spend their
// budget on thoughts.
import type {
    Host,
    LlmMessage,
    LlmRequest,
    LlmResult,
    LlmRouter,
    Logger,
    MaestroBridge,
    SettingsService,
} from '../shared/contracts';
import type { ApiLlmRequest } from '../shared/apis';

export interface LlmRouterDeps {
    host: Host;
    settings: SettingsService;
    bridge: MaestroBridge;
    log: Logger;
    /** Pauses before transport retries (default 1 s, 3 s): its length is the retry count. */
    backoffMs?: readonly number[];
}

const DEFAULT_BACKOFF_MS = [1000, 3000] as const;
/** Structured answers get room even when a provider still reasons a little. */
export const SCHEMA_MIN_TOKENS = 200;

type ConnectionManager = STContext['ConnectionManagerRequestService'];
type SendOutcome = { kind: 'ok'; raw: unknown } | { kind: 'error'; error: unknown } | { kind: 'aborted' };

export function createLlmRouter(deps: LlmRouterDeps): LlmRouter {
    const { host, settings, bridge, log } = deps;
    const backoff = deps.backoffMs ?? DEFAULT_BACKOFF_MS;

    function connectionManager(): ConnectionManager | undefined {
        const context: Partial<STContext> = host.ctx();
        const service = context.ConnectionManagerRequestService;
        if (!service || typeof service.sendRequest !== 'function') return undefined;
        const disabled = context.extensionSettings?.disabledExtensions;
        if (Array.isArray(disabled) && disabled.includes('connection-manager')) return undefined;
        return service;
    }

    function profiles(): Record<string, unknown>[] {
        const context: Partial<STContext> = host.ctx();
        const manager = context.extensionSettings?.connectionManager as { profiles?: unknown } | undefined;
        return Array.isArray(manager?.profiles) ? (manager.profiles as Record<string, unknown>[]) : [];
    }

    /** The profile of the own client: the one chosen in the settings, else the active Connection Manager profile. */
    function ownProfile(): string | null {
        const chosen = settings.get().profile;
        const context: Partial<STContext> = host.ctx();
        const manager = context.extensionSettings?.connectionManager as { selectedProfile?: unknown } | undefined;
        const active = typeof manager?.selectedProfile === 'string' ? manager.selectedProfile : '';
        const id = chosen || active;
        if (!id) return null;
        const list = profiles();
        // An empty list means "unknown" (another ST version): let Connection Manager decide.
        return list.length === 0 || list.some((profile) => profile?.id === id) ? id : null;
    }

    function profileApi(profileId: string): string | undefined {
        const api = profiles().find((profile) => profile?.id === profileId)?.api;
        return typeof api === 'string' ? api : undefined;
    }

    async function sendOnce(
        service: ConnectionManager,
        profileId: string,
        request: LlmRequest,
        useSchema: boolean,
    ): Promise<SendOutcome> {
        try {
            const raw = await service.sendRequest(
                profileId,
                buildMessages(request, useSchema),
                maxTokensFor(request),
                {
                    stream: false,
                    signal: request.signal,
                    extractData: false,
                    includePreset: false,
                    includeInstruct: true,
                },
                buildOverride(request, useSchema, profileApi(profileId)),
            );
            return { kind: 'ok', raw };
        } catch (error) {
            if (request.signal?.aborted || isAbortError(error)) return { kind: 'aborted' };
            return { kind: 'error', error };
        }
    }

    async function sendWithRetries(
        service: ConnectionManager,
        profileId: string,
        request: LlmRequest,
        useSchema: boolean,
    ): Promise<SendOutcome> {
        for (let attempt = 0; ; attempt++) {
            if (request.signal?.aborted) return { kind: 'aborted' };
            const outcome = await sendOnce(service, profileId, request, useSchema);
            if (outcome.kind !== 'error') return outcome;
            const delay = backoff[attempt];
            if (delay === undefined || !retryable(outcome.error, useSchema)) return outcome;
            log.debug(`request ${request.task} failed, retry ${attempt + 1}`, errorText(outcome.error));
            if (!(await sleep(delay, request.signal))) return { kind: 'aborted' };
        }
    }

    async function viaOwnClient<T>(request: LlmRequest): Promise<LlmResult<T>> {
        const service = connectionManager();
        if (!service) return { ok: false, error: 'no-cm' };
        const profileId = ownProfile();
        if (!profileId) return { ok: false, error: 'no-profile' };

        let useSchema = Boolean(request.schema);
        let costUsd: number | undefined;
        for (let pass = 0; pass < 2; pass++) {
            const sent = await sendWithRetries(service, profileId, request, useSchema);
            if (sent.kind === 'aborted') return { ok: false, error: 'aborted' };
            if (sent.kind === 'error') {
                if (useSchema && pass === 0 && schemaRejected(sent.error)) {
                    log.debug(`profile ${profileId} rejected json_schema; asking with instructions only`);
                    useSchema = false;
                    continue;
                }
                log.warn(`request ${request.task} failed`, errorText(sent.error));
                return { ok: false, error: `transport: ${errorText(sent.error)}` };
            }
            const cost = usageCost(sent.raw);
            if (cost !== undefined) costUsd = (costUsd ?? 0) + cost;
            const reply = extractReply(sent.raw);
            const text = stripThinking(reply.text).trim();
            const withCost = <R extends LlmResult<T>>(result: R): R =>
                costUsd === undefined ? result : { ...result, costUsd };

            if (request.schema) {
                const value = parseJsonText(text);
                if (value !== undefined && matchesSchema(value, request.schema.schema)) {
                    return withCost({ ok: true, data: value as T, text });
                }
                if (reply.refusal || looksLikeRefusal(text)) {
                    return withCost({ ok: false, refusal: true, error: 'refusal', text });
                }
                if (pass === 0) {
                    log.debug(`request ${request.task}: unparsable JSON, retrying without json_schema`);
                    useSchema = false;
                    continue;
                }
                return withCost({ ok: false, error: 'parse', text });
            }
            if (reply.refusal || looksLikeRefusal(text)) {
                return withCost({ ok: false, refusal: true, error: 'refusal', text });
            }
            if (!text) return withCost({ ok: false, error: 'empty' });
            return withCost({ ok: true, text, data: text as T });
        }
        return { ok: false, error: 'parse' };
    }

    return {
        async request<T = unknown>(request: LlmRequest): Promise<LlmResult<T>> {
            const api = bridge.api();
            if (api) {
                const wire: ApiLlmRequest = dropUndefined({
                    task: request.task,
                    messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
                    maxTokens: request.maxTokens,
                    temperature: request.temperature,
                    schema: request.schema,
                    background: request.background,
                    signal: request.signal,
                });
                try {
                    const result = await api.llm.request<T>(wire);
                    return dropUndefined({
                        ok: result.ok === true,
                        data: result.data,
                        text: result.text,
                        refusal: result.refusal,
                        error: result.error,
                        costUsd: result.costUsd,
                    });
                } catch (error) {
                    log.warn(`Maestro request ${request.task} failed`, error);
                    return { ok: false, error: `maestro: ${errorText(error)}` };
                }
            }
            if (request.background) return { ok: false, error: 'needs-maestro' };
            return viaOwnClient<T>(request);
        },

        available(task: string, background: boolean): boolean {
            const api = bridge.api();
            if (api) {
                try {
                    return api.llm.available(task);
                } catch (error) {
                    log.debug('Maestro llm.available failed', error);
                    return false;
                }
            }
            return !background && connectionManager() !== undefined && ownProfile() !== null;
        },

        viaMaestro(): boolean {
            return bridge.api() !== null;
        },
    };
}

/* ------------------------------------------------------------------ request building */

const SCHEMA_INSTRUCTION =
    'Reply with exactly one JSON value and nothing else: no prose, no markdown code fences. It must match this JSON schema:\n';

function buildMessages(request: LlmRequest, useSchema: boolean): LlmMessage[] {
    const messages: LlmMessage[] = request.messages.map((message) => ({
        role: message.role,
        content: message.content,
    }));
    if (request.schema && !useSchema) {
        messages.push({ role: 'system', content: SCHEMA_INSTRUCTION + JSON.stringify(request.schema.schema) });
    }
    return messages;
}

/** OpenRouter takes the effort as given ('none'); other APIs keep their own default. */
export function reasoningOverride(api: string | undefined): string | undefined {
    return api === 'openrouter' ? 'none' : undefined;
}

export function maxTokensFor(request: LlmRequest): number {
    return request.schema ? Math.max(request.maxTokens, SCHEMA_MIN_TOKENS) : request.maxTokens;
}

function buildOverride(request: LlmRequest, useSchema: boolean, api?: string): Record<string, unknown> {
    return dropUndefined({
        temperature: request.temperature,
        reasoning_effort: reasoningOverride(api),
        json_schema:
            useSchema && request.schema
                ? { name: request.schema.name, strict: true, value: request.schema.schema }
                : undefined,
    });
}

/* ------------------------------------------------------------------ response reading */

export interface ExtractedReply {
    text: string;
    /** The provider flagged a refusal (message.refusal, finish_reason content_filter, stop_reason refusal). */
    refusal: boolean;
}

/** Reads the raw response of ChatCompletionService / TextCompletionService (extractData: false). */
export function extractReply(raw: unknown): ExtractedReply {
    const reply: ExtractedReply = { text: '', refusal: false };
    if (typeof raw === 'string') {
        reply.text = raw;
        return reply;
    }
    if (!isRecord(raw)) return reply;

    const choices = raw['choices'];
    const choice = Array.isArray(choices) && isRecord(choices[0]) ? choices[0] : undefined;
    if (choice) {
        const message = isRecord(choice['message']) ? choice['message'] : undefined;
        if (message) {
            reply.text = contentText(message['content']);
            if (typeof message['refusal'] === 'string' && message['refusal'].trim()) {
                reply.refusal = true;
                if (!reply.text) reply.text = message['refusal'];
            }
        }
        if (!reply.text && typeof choice['text'] === 'string') reply.text = choice['text'];
        if (choice['finish_reason'] === 'content_filter') reply.refusal = true;
        return reply;
    }
    // Claude (content blocks), Cohere (message.content), Gemini (candidates[0].content.parts).
    if (Array.isArray(raw['content'])) {
        reply.text = contentText(raw['content']);
        if (raw['stop_reason'] === 'refusal') reply.refusal = true;
        return reply;
    }
    const message = isRecord(raw['message']) ? raw['message'] : undefined;
    if (message) {
        reply.text = contentText(message['content']);
        return reply;
    }
    const candidates = raw['candidates'];
    const candidate = Array.isArray(candidates) && isRecord(candidates[0]) ? candidates[0] : undefined;
    const content = candidate && isRecord(candidate['content']) ? candidate['content'] : undefined;
    if (content) reply.text = contentText(content['parts']);
    if (typeof raw['text'] === 'string' && !reply.text) reply.text = raw['text'];
    if (typeof raw['content'] === 'string' && !reply.text) reply.text = raw['content'];
    return reply;
}

function contentText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .filter(isRecord)
        .filter((part) => typeof part['text'] === 'string' && (part['type'] === undefined || part['type'] === 'text'))
        .map((part) => String(part['text']))
        .join('');
}

/** OpenRouter reports the price of a request in `usage.cost` (USD). */
function usageCost(raw: unknown): number | undefined {
    const usage = isRecord(raw) && isRecord(raw['usage']) ? raw['usage'] : undefined;
    const cost = usage?.['cost'];
    return typeof cost === 'number' && Number.isFinite(cost) ? cost : undefined;
}

/** Removes reasoning blocks; text before a lone closing tag is reasoning too. */
export function stripThinking(text: string): string {
    let out = text.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '');
    const close = out.search(/<\/(think|thinking|reasoning)>/i);
    if (close >= 0) out = out.slice(out.indexOf('>', close) + 1);
    return out;
}

/** Parses a JSON value from model text: no fences, no reasoning, the outermost {…} (or […]). */
export function parseJsonText(text: string): unknown {
    const cleaned = stripThinking(text)
        .replace(/```[a-zA-Z]*\s*/g, '')
        .replace(/```/g, '')
        .trim();
    if (!cleaned) return undefined;
    const attempts = [cleaned, outermost(cleaned, '{', '}'), outermost(cleaned, '[', ']')];
    for (const attempt of attempts) {
        if (!attempt) continue;
        try {
            return JSON.parse(attempt) as unknown;
        } catch {
            // next candidate
        }
    }
    return undefined;
}

function outermost(text: string, open: string, close: string): string | undefined {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    return start >= 0 && end > start ? text.slice(start, end + 1) : undefined;
}

/**
 * A light JSON-schema check (type, enum, required, properties, items): enough to reject a wrong shape before a
 * feature applies it. Unknown keywords are ignored.
 */
export function matchesSchema(value: unknown, schema: unknown, depth = 0): boolean {
    if (!isRecord(schema) || depth > 32) return true;
    const enumValues = schema['enum'];
    if (Array.isArray(enumValues) && !enumValues.some((item) => item === value)) return false;
    const type = schema['type'];
    if (typeof type === 'string' && !matchesType(value, type)) return false;
    if (Array.isArray(type) && !type.some((item) => typeof item === 'string' && matchesType(value, item))) return false;
    if (isRecord(value)) {
        const required = schema['required'];
        if (Array.isArray(required) && required.some((key) => typeof key === 'string' && !(key in value))) return false;
        const properties = schema['properties'];
        if (isRecord(properties)) {
            for (const [key, sub] of Object.entries(properties)) {
                if (key in value && !matchesSchema(value[key], sub, depth + 1)) return false;
            }
        }
    }
    if (Array.isArray(value) && isRecord(schema['items'])) {
        const items = schema['items'];
        if (!value.every((item) => matchesSchema(item, items, depth + 1))) return false;
    }
    return true;
}

function matchesType(value: unknown, type: string): boolean {
    switch (type) {
        case 'object':
            return isRecord(value);
        case 'array':
            return Array.isArray(value);
        case 'string':
            return typeof value === 'string';
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'integer':
            return typeof value === 'number' && Number.isInteger(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'null':
            return value === null;
        default:
            return true;
    }
}

/* ------------------------------------------------------------------ refusals and errors */

const VERBS_EN =
    'help|assist|comply|provide|continue|create|write|fulfil|fulfill|generate|engage|produce|participate|do that|do this';
const REFUSAL_PATTERNS: RegExp[] = [
    new RegExp(`\\b(?:i|we) (?:can't|cannot|can not|won't|will not) (?:${VERBS_EN})`),
    new RegExp(`\\bi(?:'m| am) (?:unable|not able) to (?:${VERBS_EN})`),
    /\bas an ai\b/,
    /\bi must (?:decline|refuse)\b/,
    /\bi(?:'m| am) sorry,? but i (?:can't|cannot|won't)\b/,
    /не могу (?:с этим )?(?:помочь|выполнить|продолжить|создать|написать|сгенерировать|участвовать)/,
    /(?:^|[^а-яё])я не могу(?:[^а-яё]|$)/,
    /(?:^|[^а-яё])как (?:ии|искусственный интеллект|языковая модель)(?:[^а-яё]|$)/,
    /вынужден[аы]? отказаться/,
    /извините, но я не/,
];

/**
 * Refusal heuristics (en/ru). A refusal opens the reply: the phrase must sit in the first 80 characters of a short
 * reply with no quotation mark before it, so story text like `"I can't help it," she said` is not one.
 */
export function looksLikeRefusal(text: string): boolean {
    const normalized = text.trim().toLowerCase().replace(/[’`]/g, "'");
    if (!normalized || normalized.length > 1500) return false;
    const head = normalized.slice(0, 300);
    return REFUSAL_PATTERNS.some((pattern) => {
        const match = pattern.exec(head);
        return match !== null && match.index <= 80 && !/["«»“”„]/.test(head.slice(0, match.index));
    });
}

/** Messages of an error and its causes (ST wraps failures as Error('API request failed', { cause })). */
function errorText(error: unknown): string {
    const parts: string[] = [];
    let current: unknown = error;
    for (let depth = 0; current !== undefined && current !== null && depth < 5; depth++) {
        if (current instanceof Error) {
            if (current.message) parts.push(current.message);
            current = (current as Error & { cause?: unknown }).cause;
        } else {
            parts.push(String(current));
            break;
        }
    }
    return parts.join(': ') || 'unknown error';
}

function isAbortError(error: unknown): boolean {
    let current: unknown = error;
    for (let depth = 0; current instanceof Error && depth < 5; depth++) {
        if (current.name === 'AbortError') return true;
        current = (current as Error & { cause?: unknown }).cause;
    }
    return false;
}

/** Configuration errors do not get better with retries. */
function retryable(error: unknown, useSchema: boolean): boolean {
    const text = errorText(error);
    if (/Profile not found|Connection Manager is not available|does not support|Unknown API type/i.test(text))
        return false;
    return !(useSchema && schemaRejected(error));
}

function schemaRejected(error: unknown): boolean {
    return /json_schema|response_format|structured output|schema/i.test(errorText(error));
}

/* ------------------------------------------------------------------ helpers */

function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
        if (signal?.aborted) {
            resolve(false);
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            resolve(false);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve(true);
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function dropUndefined<T extends object>(value: T): T {
    const out = { ...value } as Record<string, unknown>;
    for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
    return out as T;
}
