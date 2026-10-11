// SillyTavern events through the host: ST's emitter walks a copy of the listener list, so a listener removed by an
// earlier listener of the same emit (a module stopped by «Мастерская» in Maestro's first CHAT_CHANGED listener) is
// still called by it — and must do nothing.
import { beforeEach, describe, expect, it } from 'vitest';
import { memoryLogger, mockHost } from '../helpers/fakes';
import { EVENT_TYPES, installStMock } from '../helpers/st-mock';
import type { StMock } from '../helpers/st-mock';

let mock: StMock;

beforeEach(() => {
    mock = installStMock();
});

describe('host events', () => {
    it('a listener removed during an emit is not run by that emit', async () => {
        const host = mockHost(memoryLogger());
        const event = EVENT_TYPES.CHAT_CHANGED!;
        const calls: string[] = [];
        let offLater = () => {};
        // Maestro's first listener: pauses Dramatis' modules before the rest of CHAT_CHANGED runs.
        mock.eventSource.makeFirst(event, () => {
            calls.push('pause');
            offLater();
        });
        offLater = host.events.on(event, () => void calls.push('module'));
        host.events.on(event, () => void calls.push('app'));

        await mock.eventSource.emit(event, 'chat-2');
        expect(calls).toEqual(['pause', 'app']);
        await mock.eventSource.emit(event, 'chat-3');
        expect(calls).toEqual(['pause', 'app', 'pause', 'app']);
        host.dispose();
    });
});
