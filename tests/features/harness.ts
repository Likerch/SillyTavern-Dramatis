// The whole app on the ST mock for feature tests: a solo chat with a card, stored profiles and chat state written as
// files, an optional fake MAESTRO_API, then startDramatis() and the engine loaded.
import { startDramatis } from '../../src/app/app';
import type { Runtime } from '../../src/app/app';
import { makeFileName } from '../../src/core/files';
import { stableHash } from '../../src/core/hash';
import { ConsoleLogger } from '../../src/core/logger';
import type { CardProfiles, ChatState } from '../../src/domain/model';
import { ENGINE_API } from '../../src/features/engine/api';
import type { EngineApi } from '../../src/features/engine/api';
import { MAESTRO_API_GLOBAL } from '../../src/shared/apis';
import type { App, DesCharacter } from '../../src/shared/contracts';
import { resetSlashSlots } from '../../src/ui/slash';
import type { FakeMaestro } from '../helpers/fakes';
import { character, flush, installStMock, openSoloChat } from '../helpers/st-mock';
import type { StMock } from '../helpers/st-mock';

export interface Harness {
    mock: StMock;
    runtime: Runtime;
    app: App;
    engine: EngineApi;
}

export interface HarnessOptions {
    card?: STCharacter;
    chatId?: string;
    profiles?: CardProfiles;
    state?: ChatState;
    /** Version of the stored state envelope. */
    stateVersion?: number;
    chat?: STChatMessage[];
    persona?: string;
    maestro?: FakeMaestro;
    /** Runs before startDramatis (settings, books…). */
    before?: (mock: StMock) => void;
}

const globals = globalThis as unknown as Record<string, unknown>;
let current: Harness | null = null;

export function stateFileName(chatId: string): string {
    return makeFileName(`chat-${stableHash(chatId)}-state`);
}

export function profilesFileName(card: string): string {
    return makeFileName('card', card);
}

export function writeProfiles(mock: StMock, profiles: CardProfiles): void {
    mock.files.set(profilesFileName(profiles.card), JSON.stringify(profiles));
}

export function writeState(mock: StMock, chatId: string, state: ChatState, version = 1): void {
    mock.files.set(
        stateFileName(chatId),
        JSON.stringify({ schema: 1, version, updatedAt: 1, tabId: 'another-tab', data: state }),
    );
}

export function readStateFile(mock: StMock, chatId: string): { version: number; data: ChatState } | null {
    const text = mock.files.get(stateFileName(chatId));
    return text ? (JSON.parse(text) as { version: number; data: ChatState }) : null;
}

export function readProfilesFile(mock: StMock, card: string): CardProfiles | null {
    const text = mock.files.get(profilesFileName(card));
    return text ? (JSON.parse(text) as CardProfiles) : null;
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
    const mock = installStMock();
    resetSlashSlots();
    ConsoleLogger.setLevel('error');
    document.body.innerHTML = '<div id="extensions_settings"></div><div id="extensions_settings2"></div>';
    const card = options.card ?? character('Tavern', { avatar: 'tavern.png' });
    const chatId = options.chatId ?? 'chat-1';
    openSoloChat(mock, card, chatId);
    if (options.persona !== undefined) mock.name1 = options.persona;
    if (options.chat) mock.chat = options.chat;
    if (options.profiles) writeProfiles(mock, options.profiles);
    if (options.state) writeState(mock, chatId, options.state, options.stateVersion ?? 1);
    if (options.maestro) globals[MAESTRO_API_GLOBAL] = options.maestro.api;
    options.before?.(mock);
    const runtime = await startDramatis({ rng: () => 0.5 });
    const engine = runtime.app.modules.api<EngineApi>(ENGINE_API)!;
    await engine.ready();
    await flush();
    current = { mock, runtime, app: runtime.app, engine };
    return current;
}

export async function stopHarness(): Promise<void> {
    await current?.runtime.stop();
    current = null;
    delete globals[MAESTRO_API_GLOBAL];
    document.body.innerHTML = '';
}

/** Makes the DES reader report this cast (DES "installed"). */
export function fakeDes(runtime: Runtime, cast: DesCharacter[]): void {
    runtime.readers.des.available = () => true;
    runtime.readers.des.lastCast = () => cast;
}

/** Switches the chat in the mock and announces it the way ST does (and Maestro's turn pipeline, when given). */
export async function switchChat(
    mock: StMock,
    chatId: string,
    options: { group?: boolean; maestro?: FakeMaestro } = {},
): Promise<void> {
    mock.chatId = chatId;
    mock.groupId = options.group ? 'group-1' : null;
    await mock.eventSource.emit('chat_id_changed', chatId);
    await options.maestro?.emitTurn({ type: 'chat:changed', chatId });
    await flush();
}

/** Fires GENERATION_AFTER_COMMANDS like ST does before a generation. */
export async function generate(mock: StMock, type = 'normal', dryRun = false): Promise<void> {
    await mock.eventSource.emit('GENERATION_AFTER_COMMANDS', type, {}, dryRun);
}

/** Waits until the predicate holds (a few event-loop turns). */
export async function until(predicate: () => boolean, turns = 50): Promise<void> {
    for (let i = 0; i < turns && !predicate(); i++) await flush();
}
