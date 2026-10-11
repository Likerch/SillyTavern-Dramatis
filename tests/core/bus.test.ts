import { describe, expect, it } from 'vitest';
import { createBus } from '../../src/core/bus';
import { memoryLogger } from '../helpers/fakes';

describe('bus', () => {
    it('runs handlers in order and keeps going past a failing one', async () => {
        const log = memoryLogger();
        const bus = createBus(log);
        const calls: number[] = [];
        bus.on('chat:changed', () => void calls.push(1));
        bus.on('chat:changed', () => {
            throw new Error('nope');
        });
        bus.on('chat:changed', async () => void calls.push(3));
        await bus.emit('chat:changed', { chatId: 'chat-1' });
        expect(calls).toEqual([1, 3]);
        expect(log.lines.filter((line) => line.level === 'error')).toHaveLength(1);
    });

    it('does not run a handler removed by an earlier one of the same emit', async () => {
        const bus = createBus(memoryLogger());
        const calls: string[] = [];
        let offModule = () => {};
        bus.on('maestro:workshop', () => {
            calls.push('pause');
            offModule();
        });
        offModule = bus.on('maestro:workshop', () => void calls.push('module'));
        bus.on('maestro:workshop', () => void calls.push('app'));
        await bus.emit('maestro:workshop', { active: true });
        expect(calls).toEqual(['pause', 'app']);
    });
});
