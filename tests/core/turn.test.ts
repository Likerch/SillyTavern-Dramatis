import { beforeEach, describe, expect, it } from 'vitest';
import { createBus } from '../../src/core/bus';
import { createEphemeral, injectionKey } from '../../src/core/ephemeral';
import { createTurnTracker } from '../../src/core/turn';
import type { DramatisEvents, GenerationInfo } from '../../src/shared/contracts';
import { fakeMaestro, memoryLogger, mockHost, staticBridge } from '../helpers/fakes';
import { EVENT_TYPES, flush, installStMock, message } from '../helpers/st-mock';
import type { StMock } from '../helpers/st-mock';

let mock: StMock;

type Seen = { event: keyof DramatisEvents; payload: unknown };

function setup(withMaestro = false) {
    const log = memoryLogger();
    const host = mockHost(log);
    const bus = createBus(log);
    const ephemeral = createEphemeral({ host, log });
    const maestro = fakeMaestro();
    const bridge = staticBridge(withMaestro ? maestro.api : null);
    const turn = createTurnTracker({ host, bus, ephemeral, bridge, log });
    const seen: Seen[] = [];
    const events: (keyof DramatisEvents)[] = [
        'chat:changed',
        'reply:ready',
        'turn:committed',
        'message:invalidated',
        'generation:before',
        'generation:ended',
    ];
    for (const event of events) {
        bus.on(event, (payload) => {
            seen.push({ event, payload });
        });
    }
    turn.install();
    return { turn, bus, ephemeral, maestro, bridge, seen, host };
}

const emit = (key: string, ...args: unknown[]) => mock.eventSource.emit(EVENT_TYPES[key]!, ...args);

beforeEach(() => {
    mock = installStMock();
    mock.chat = [message('Привет', { is_user: false }), message('Здравствуй', { is_user: true }), message('Ответ')];
});

describe('own turn tracking (no Maestro)', () => {
    it('turns ST events into Dramatis events', async () => {
        const { seen, turn } = setup();
        expect(turn.mode()).toBe('own');

        await emit('CHAT_CHANGED', 'chat-1');
        await emit('MESSAGE_RECEIVED', 2, 'normal');
        expect(seen.map((item) => item.event)).toEqual(['chat:changed']);
        await flush();
        await emit('MESSAGE_SENT', 3);
        await emit('MESSAGE_SWIPED', 2);
        await emit('MESSAGE_DELETED', 2);
        await emit('MESSAGE_EDITED', 1);
        await flush();

        expect(seen).toEqual([
            { event: 'chat:changed', payload: { chatId: 'chat-1' } },
            { event: 'reply:ready', payload: { messageIndex: 2 } },
            { event: 'turn:committed', payload: { messageIndex: 2 } },
            { event: 'message:invalidated', payload: { messageIndex: 2, reason: 'swiped' } },
            { event: 'message:invalidated', payload: { messageIndex: 2, reason: 'deleted' } },
            { event: 'message:invalidated', payload: { messageIndex: 1, reason: 'edited' } },
        ]);
    });

    it('ignores user messages and unknown indexes for reply:ready', async () => {
        const { seen } = setup();
        await emit('MESSAGE_RECEIVED', 1);
        await emit('MESSAGE_RECEIVED', 99);
        await emit('MESSAGE_RECEIVED', 'x');
        await flush();
        expect(seen).toEqual([]);
    });

    it('lets DES finish with the reply first (last listener, next tick)', async () => {
        const order: string[] = [];
        const { bus } = setup();
        // A neighbour registering after us still runs before our deferred reply:ready.
        mock.eventSource.on(EVENT_TYPES.MESSAGE_RECEIVED!, () => {
            order.push('des');
        });
        bus.on('reply:ready', () => {
            order.push('dramatis');
        });
        await emit('MESSAGE_RECEIVED', 2);
        await flush();
        expect(order).toEqual(['des', 'dramatis']);
    });

    it('commits the assistant message before the sent one, skipping system messages', async () => {
        const { seen } = setup();
        mock.chat = [message('a'), message('sys', { is_system: true }), message('u', { is_user: true })];
        await emit('MESSAGE_SENT', 2);
        expect(seen).toEqual([{ event: 'turn:committed', payload: { messageIndex: 0 } }]);
    });

    it('runs injection producers before a generation and clears them after it', async () => {
        const { seen, ephemeral, turn } = setup();
        const infos: GenerationInfo[] = [];
        ephemeral.addProducer('cast', (info) => {
            infos.push(info);
            ephemeral.setInjection('cast', { text: 'MOTIVES', position: 1, depth: 1, role: 0 });
        });

        await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
        expect(infos).toEqual([{ type: 'normal', dryRun: false, quiet: false }]);
        expect(mock.prompts.get(injectionKey('cast'))?.value).toBe('MOTIVES');
        expect(ephemeral.isSet('cast')).toBe(true);
        expect(turn.current()).toEqual({ type: 'normal', dryRun: false, quiet: false });
        expect(seen.at(-1)).toEqual({
            event: 'generation:before',
            payload: { type: 'normal', dryRun: false, quiet: false },
        });

        await emit('GENERATION_ENDED', 3);
        expect(mock.prompts.get('dramatis_cast')?.value).toBe('');
        expect(ephemeral.isSet('cast')).toBe(false);
        expect(turn.current()).toBeNull();
        expect(seen.at(-1)).toEqual({ event: 'generation:ended', payload: { type: 'normal', stopped: false } });

        await emit('GENERATION_AFTER_COMMANDS', 'swipe', {}, false);
        await emit('GENERATION_STOPPED');
        expect(seen.at(-1)).toEqual({ event: 'generation:ended', payload: { type: 'swipe', stopped: true } });
    });

    it('does not run producers for a dry run and does not hold quiet generations', async () => {
        const { ephemeral, turn, seen } = setup();
        let runs = 0;
        ephemeral.addProducer('cast', () => {
            runs++;
        });
        await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, true);
        expect(runs).toBe(0);
        expect(turn.current()).toBeNull();
        expect(seen.at(-1)?.payload).toEqual({ type: 'normal', dryRun: true, quiet: false });

        await emit('GENERATION_AFTER_COMMANDS', 'quiet', {}, false);
        expect(runs).toBe(1);
        expect(turn.current()).toBeNull();
        expect(seen.at(-1)?.payload).toEqual({ type: 'quiet', dryRun: false, quiet: true });
    });

    it('clears injections on chat change and on dispose', async () => {
        const { ephemeral, turn } = setup();
        ephemeral.setInjection('cast', { text: 'X', position: 1, depth: 1 });
        await emit('CHAT_CHANGED');
        expect(ephemeral.isSet('cast')).toBe(false);
        ephemeral.setInjection('cast', { text: 'Y', position: 1, depth: 1 });
        turn.dispose();
        expect(ephemeral.isSet('cast')).toBe(false);
        expect(mock.eventSource.count(EVENT_TYPES.MESSAGE_SENT!)).toBe(0);
    });
});

describe('with Maestro', () => {
    it('forwards Maestro turn events and leaves ST events to it', async () => {
        const { seen, maestro, turn } = setup(true);
        expect(turn.mode()).toBe('maestro');

        await emit('MESSAGE_SENT', 3);
        await emit('MESSAGE_SWIPED', 2);
        await emit('CHAT_CHANGED');
        await emit('MESSAGE_RECEIVED', 2);
        await flush();
        expect(seen).toEqual([]);

        await maestro.emitTurn({ type: 'chat:changed', chatId: 'c' });
        await maestro.emitTurn({ type: 'reply:ready', messageIndex: 2 });
        await maestro.emitTurn({ type: 'turn:committed', messageIndex: 2 });
        await maestro.emitTurn({ type: 'message:invalidated', messageIndex: 2, reason: 'edited' });
        await maestro.emitTurn({ type: 'generation:before', generation: 'normal', dryRun: false, quiet: false });
        await maestro.emitTurn({ type: 'generation:ended', generation: 'normal', stopped: true });
        expect(seen).toEqual([
            { event: 'chat:changed', payload: { chatId: 'c' } },
            { event: 'reply:ready', payload: { messageIndex: 2 } },
            { event: 'turn:committed', payload: { messageIndex: 2 } },
            { event: 'message:invalidated', payload: { messageIndex: 2, reason: 'edited' } },
            { event: 'generation:before', payload: { type: 'normal', dryRun: false, quiet: false } },
            { event: 'generation:ended', payload: { type: 'normal', stopped: true } },
        ]);
    });

    it('still runs injection producers from ST events', async () => {
        const { ephemeral, seen } = setup(true);
        ephemeral.addProducer('cast', () => ephemeral.setInjection('cast', { text: 'M', position: 1, depth: 1 }));
        await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
        expect(ephemeral.isSet('cast')).toBe(true);
        expect(seen).toEqual([]);
        await emit('GENERATION_ENDED');
        expect(ephemeral.isSet('cast')).toBe(false);
    });

    it('switches modes when Maestro comes and goes', async () => {
        const { turn, bus, bridge, maestro, seen } = setup(false);
        bridge.set(maestro.api);
        await bus.emit('maestro:changed', { present: true });
        expect(turn.mode()).toBe('maestro');
        expect(maestro.turnListeners.size).toBe(1);

        bridge.set(null);
        await bus.emit('maestro:changed', { present: false });
        expect(turn.mode()).toBe('own');
        expect(maestro.turnListeners.size).toBe(0);
        await emit('MESSAGE_SWIPED', 2);
        expect(seen.at(-1)?.event).toBe('message:invalidated');
    });
});
