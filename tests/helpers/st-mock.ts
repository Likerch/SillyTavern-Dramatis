// A small fake of SillyTavern 1.19 for integration tests (ported from Maestro tests/helpers/st-mock.ts). Install with
// installStMock(); every test gets a fresh instance. Extend through the returned object (chat, metadata, settings,
// characters, books, files, requests).

type Listener = (...args: unknown[]) => unknown;

export class FakeEventSource {
    readonly events = new Map<string, Listener[]>();

    on(event: string, listener: Listener): void {
        this.list(event).push(listener);
    }

    makeFirst(event: string, listener: Listener): void {
        this.list(event).unshift(listener);
    }

    makeLast(event: string, listener: Listener): void {
        const list = this.list(event);
        const index = list.indexOf(listener);
        if (index >= 0) list.splice(index, 1);
        list.push(listener);
    }

    removeListener(event: string, listener: Listener): void {
        const list = this.list(event);
        const index = list.indexOf(listener);
        if (index >= 0) list.splice(index, 1);
    }

    async emit(event: string, ...args: unknown[]): Promise<void> {
        for (const listener of [...this.list(event)]) {
            try {
                await listener(...args);
            } catch {
                // ST swallows listener errors (public/lib/eventemitter.js).
            }
        }
    }

    count(event: string): number {
        return this.list(event).length;
    }

    private list(event: string): Listener[] {
        let list = this.events.get(event);
        if (!list) {
            list = [];
            this.events.set(event, list);
        }
        return list;
    }
}

export const EVENT_TYPES: Record<string, string> = {
    APP_READY: 'app_ready',
    CHAT_CHANGED: 'chat_id_changed',
    CHAT_DELETED: 'chat_deleted',
    GROUP_CHAT_DELETED: 'group_chat_deleted',
    MESSAGE_SENT: 'message_sent',
    MESSAGE_RECEIVED: 'message_received',
    MESSAGE_EDITED: 'message_edited',
    MESSAGE_DELETED: 'message_deleted',
    MESSAGE_SWIPED: 'message_swiped',
    CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
    USER_MESSAGE_RENDERED: 'user_message_rendered',
    GENERATION_STARTED: 'generation_started',
    GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS',
    GENERATION_STOPPED: 'generation_stopped',
    GENERATION_ENDED: 'generation_ended',
    SETTINGS_UPDATED: 'settings_updated',
    WORLDINFO_UPDATED: 'worldinfo_updated',
    WORLDINFO_SETTINGS_UPDATED: 'worldinfo_settings_updated',
};

export const POPUP_TYPE = { TEXT: 1, CONFIRM: 2, INPUT: 3, DISPLAY: 4 };
export const POPUP_RESULT = { AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: null };

/** Stand-in for ST's Popup class: show() resolves when the popup is closed (needs a DOM). */
export class FakePopup {
    static instances: FakePopup[] = [];
    readonly dlg: HTMLDialogElement;
    closed = false;
    private resolve: ((value: unknown) => void) | null = null;

    constructor(
        readonly content: string | HTMLElement,
        readonly type: number,
        readonly inputValue: string = '',
        readonly options: Record<string, unknown> = {},
    ) {
        this.dlg = document.createElement('dialog');
        if (typeof content === 'string') this.dlg.textContent = content;
        else this.dlg.appendChild(content);
        FakePopup.instances.push(this);
    }

    show(): Promise<unknown> {
        document.body.appendChild(this.dlg);
        return new Promise((resolve) => {
            this.resolve = resolve;
        });
    }

    async completeCancelled(): Promise<unknown> {
        this.close(POPUP_RESULT.CANCELLED);
        return null;
    }

    close(result: unknown): void {
        if (this.closed) return;
        this.closed = true;
        this.dlg.remove();
        this.resolve?.(result);
    }
}

export interface FakeSlashCommand {
    name: string;
    helpString: string;
    callback: (named: unknown, unnamed: unknown) => unknown;
}

export interface StMock {
    context: STContext;
    eventSource: FakeEventSource;
    chat: STChatMessage[];
    chatMetadata: Record<string, unknown>;
    extensionSettings: Record<string, unknown>;
    characters: STCharacter[];
    /** this_chid. */
    characterId: number | undefined;
    groupId: string | null;
    name1: string;
    powerUserSettings: Record<string, unknown>;
    /** Lorebooks loadWorldInfo() returns, by name. */
    books: Map<string, { entries: Record<string, Record<string, unknown>> }>;
    /** User files written through /api/files/upload, by name (decoded JSON text). */
    files: Map<string, string>;
    /** Every fetch made through the mock, newest last. */
    requests: { url: string; init?: RequestInit }[];
    chatId: string | undefined;
    saveSettingsCalls: number;
    /** Extension prompt slots set through setExtensionPrompt. */
    prompts: Map<string, { value: string; position: number; depth: number; scan: boolean; role: number }>;
    slashCommands: Map<string, FakeSlashCommand>;
    sendRequest: (
        profileId: string,
        prompt: unknown,
        maxTokens: number,
        custom?: unknown,
        override?: unknown,
    ) => Promise<unknown>;
}

export function message(text: string, options: Partial<STChatMessage> = {}): STChatMessage {
    return {
        name: options.is_user ? 'User' : 'Char',
        is_user: false,
        is_system: false,
        send_date: '',
        mes: text,
        extra: {},
        ...options,
    };
}

/** Installs globalThis.SillyTavern, toastr and fetch fakes. Returns handles to drive the fake. */
export function installStMock(): StMock {
    const eventSource = new FakeEventSource();
    const mock = {
        eventSource,
        chat: [] as STChatMessage[],
        chatMetadata: {} as Record<string, unknown>,
        extensionSettings: { disabledExtensions: [] } as Record<string, unknown>,
        characters: [] as STCharacter[],
        characterId: undefined as number | undefined,
        groupId: null as string | null,
        name1: 'User',
        powerUserSettings: {} as Record<string, unknown>,
        books: new Map(),
        files: new Map<string, string>(),
        requests: [] as { url: string; init?: RequestInit }[],
        chatId: 'chat-1' as string | undefined,
        saveSettingsCalls: 0,
        prompts: new Map(),
        slashCommands: new Map(),
        sendRequest: async () => ({ choices: [{ message: { content: '{}' } }] }),
    } as unknown as StMock;

    const context = {
        get chat() {
            return mock.chat;
        },
        get chatMetadata() {
            return mock.chatMetadata;
        },
        get extensionSettings() {
            return mock.extensionSettings;
        },
        get characters() {
            return mock.characters;
        },
        get characterId() {
            return mock.characterId;
        },
        get groupId() {
            return mock.groupId;
        },
        get name1() {
            return mock.name1;
        },
        get powerUserSettings() {
            return mock.powerUserSettings;
        },
        groups: [],
        name2: 'Char',
        mainApi: 'openai',
        eventSource,
        eventTypes: EVENT_TYPES,
        saveSettingsDebounced: () => {
            mock.saveSettingsCalls++;
        },
        saveMetadata: async () => {},
        getCurrentChatId: () => mock.chatId,
        getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
        getCurrentLocale: () => 'ru-ru',
        setExtensionPrompt: (key: string, value: string, position: number, depth: number, scan = false, role = 0) => {
            mock.prompts.set(key, { value, position, depth, scan, role });
        },
        loadWorldInfo: async (name: string) => {
            const book = mock.books.get(name);
            return book ? structuredClone(book) : null;
        },
        unshallowCharacter: async () => {},
        Popup: FakePopup,
        POPUP_TYPE,
        POPUP_RESULT,
        callGenericPopup: async () => POPUP_RESULT.AFFIRMATIVE,
        SlashCommandParser: {
            commands: {},
            addCommandObject: (command: FakeSlashCommand) => {
                mock.slashCommands.set(command.name, command);
            },
        },
        SlashCommand: { fromProps: (props: Record<string, unknown>) => props },
        SlashCommandArgument: { fromProps: (props: Record<string, unknown>) => props },
        SlashCommandNamedArgument: { fromProps: (props: Record<string, unknown>) => props },
        ARGUMENT_TYPE: { STRING: 'string' },
        ConnectionManagerRequestService: {
            sendRequest: (...args: Parameters<StMock['sendRequest']>) => mock.sendRequest(...args),
            getProfile: (id: string) => ({ id, name: id, api: 'openai' }),
            validateProfile: () => ({ selected: 'openai' }),
            getSupportedProfiles: () => {
                const manager = mock.extensionSettings.connectionManager as { profiles?: { id: string }[] } | undefined;
                return manager?.profiles ?? [];
            },
        },
    } as unknown as STContext;
    mock.context = context;

    (globalThis as unknown as { SillyTavern: unknown }).SillyTavern = {
        getContext: () => context,
        libs: {},
    };
    (globalThis as unknown as { toastr: unknown }).toastr = {
        success: () => {},
        info: () => {},
        warning: () => {},
        error: () => {},
        clear: () => {},
    };

    const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        mock.requests.push({ url, init });
        if (url.includes('/api/files/upload')) {
            const body = JSON.parse(String(init?.body ?? '{}')) as { name: string; data: string };
            mock.files.set(body.name, Buffer.from(body.data, 'base64').toString('utf8'));
            return new Response(JSON.stringify({ path: `/user/files/${body.name}` }), { status: 200 });
        }
        if (url.includes('/api/files/delete')) {
            const body = JSON.parse(String(init?.body ?? '{}')) as { path: string };
            mock.files.delete(body.path.replace(/^.*\//, ''));
            return new Response('{}', { status: 200 });
        }
        const fileMatch = url.match(/\/user\/files\/([^?]+)/);
        if (fileMatch?.[1]) {
            const text = mock.files.get(decodeURIComponent(fileMatch[1]));
            return text === undefined
                ? new Response('not found', { status: 404 })
                : new Response(text, { status: 200 });
        }
        return new Response('{}', { status: 200 });
    };
    (globalThis as unknown as { fetch: unknown }).fetch = fakeFetch;

    return mock;
}

/** A card with the given fields, as ST keeps it in `characters`. */
export function character(name: string, overrides: Partial<STCharacter> = {}): STCharacter {
    return { name, avatar: `${name.toLowerCase()}.png`, data: {}, ...overrides };
}

/** Selects a solo chat with this character (adds it to `characters`). */
export function openSoloChat(mock: StMock, card: STCharacter, chatId = 'chat-1'): void {
    mock.characters.push(card);
    mock.characterId = mock.characters.length - 1;
    mock.groupId = null;
    mock.chatId = chatId;
}

/** Waits for pending timers and microtasks (setTimeout 0 handlers, queued bus emits). */
export function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
