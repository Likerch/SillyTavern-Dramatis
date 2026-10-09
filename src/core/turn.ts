// Turn events of Dramatis (DramatisEvents on the bus):
// - with Maestro: its turn pipeline (MAESTRO_API.onTurn) is forwarded as is — swipes, edits and branches are already
//   handled there, and `reply:ready` comes after DES, DES-RU and NAI Studio finished with the reply;
// - without Maestro: a minimal tracker of SillyTavern events — CHAT_CHANGED → chat:changed, MESSAGE_RECEIVED (last
//   listener, next tick, so DES has parsed its tracker) → reply:ready, MESSAGE_SENT → turn:committed for the previous
//   assistant message, MESSAGE_SWIPED / DELETED / EDITED → message:invalidated, GENERATION_AFTER_COMMANDS →
//   generation:before, GENERATION_ENDED / STOPPED → generation:ended.
//
// One-generation injections are driven by SillyTavern in both modes: producers run on GENERATION_AFTER_COMMANDS (before
// generate interceptors, so Maestro already sees `dramatis_cast` when it decides what to silence) and every slot is
// cleared on GENERATION_ENDED / STOPPED and on chat change.
import type { ApiTurnEvent, ApiUnsubscribe, MaestroApiV1 } from '../shared/apis';
import type { Bus, GenerationInfo, Host, Logger, MaestroBridge, Unsubscribe } from '../shared/contracts';
import type { EphemeralRunner } from './ephemeral';

export type TurnMode = 'own' | 'maestro';

export interface TurnTrackerDeps {
    host: Host;
    bus: Bus;
    ephemeral: EphemeralRunner;
    bridge: MaestroBridge;
    log: Logger;
}

/** A generation that has not ended after this long is considered finished (lost GENERATION_ENDED). */
const GENERATION_STALE_MS = 5 * 60 * 1000;

export class TurnTracker {
    private readonly unsubscribers: Unsubscribe[] = [];
    private offMaestro: ApiUnsubscribe | null = null;
    /** The MAESTRO_API object whose turn events are forwarded (a restarted Maestro publishes a new one). */
    private attached: MaestroApiV1 | null = null;
    private turnMode: TurnMode = 'own';
    private generation: GenerationInfo | null = null;
    private staleTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly timers = new Set<ReturnType<typeof setTimeout>>();

    constructor(private readonly deps: TurnTrackerDeps) {}

    install(): void {
        if (this.unsubscribers.length) return;
        const { host, bus, ephemeral } = this.deps;
        const on = (keys: string[], handler: (...args: unknown[]) => unknown, order?: 'first' | 'last') => {
            const name = keys.map((key) => host.events.name(key)).find((value) => value !== undefined);
            if (!name) {
                this.deps.log.warn(`ST event ${keys.join(' / ')} is missing`);
                return;
            }
            this.unsubscribers.push(host.events.on(name, handler, order ? { order } : undefined));
        };

        on(['CHAT_CHANGED'], () => {
            this.endGeneration();
            ephemeral.clearAll();
            if (this.own()) void bus.emit('chat:changed', { chatId: host.chatId() });
        });

        // AFTER_COMMANDS fires only for generations that really start (a slash command in the input aborts before it).
        on(['GENERATION_AFTER_COMMANDS', 'GENERATION_STARTED'], async (type, _options, dryRun) => {
            const info: GenerationInfo = {
                type: typeof type === 'string' && type ? type : 'normal',
                dryRun: dryRun === true,
                quiet: type === 'quiet',
            };
            // A background call of another extension or a dry run (token counting) while a real generation is under
            // way: the real one's slots stay — it has not assembled its prompt yet.
            const nested = (info.quiet || info.dryRun) && this.generation !== null;
            // Quiet generations (other extensions' background calls) may never report their end.
            if (!info.quiet && !info.dryRun) this.startGeneration(info);
            if (!nested) await ephemeral.run(info);
            if (this.own()) await bus.emit('generation:before', info);
        });

        const ended = (stopped: boolean) => () => {
            const type = this.generation?.type ?? 'normal';
            this.endGeneration();
            ephemeral.clearAll();
            if (this.own()) void bus.emit('generation:ended', { type, stopped });
        };
        on(['GENERATION_ENDED'], ended(false));
        on(['GENERATION_STOPPED'], ended(true));

        on(
            ['MESSAGE_RECEIVED'],
            (messageId) => {
                const index = Number(messageId);
                if (!Number.isInteger(index) || index < 0) return;
                const message = host.ctx().chat[index];
                if (!message || message.is_user) return;
                // Next tick: DES (and DES-RU, NAI Studio) finish with the reply in this same pass.
                const timer = setTimeout(() => {
                    this.timers.delete(timer);
                    if (this.own()) void bus.emit('reply:ready', { messageIndex: index });
                }, 0);
                this.timers.add(timer);
            },
            'last',
        );

        on(['MESSAGE_SENT'], (messageId) => {
            if (!this.own()) return;
            const index = Number(messageId);
            const committed = this.lastAssistantBefore(Number.isFinite(index) ? index : host.ctx().chat.length);
            if (committed >= 0) void bus.emit('turn:committed', { messageIndex: committed });
        });

        on(['MESSAGE_SWIPED'], (messageId) => this.invalidate(messageId, 'swiped'));
        // ST passes the new chat length: every message from that index on is gone.
        on(['MESSAGE_DELETED'], (length) => this.invalidate(length, 'deleted'));
        on(['MESSAGE_EDITED'], (messageId) => this.invalidate(messageId, 'edited'));

        this.unsubscribers.push(bus.on('maestro:changed', () => this.sync()));
        this.sync();
    }

    dispose(): void {
        for (const off of this.unsubscribers.splice(0)) off();
        this.detachMaestro();
        for (const timer of this.timers) clearTimeout(timer);
        this.timers.clear();
        this.endGeneration();
        this.deps.ephemeral.clearAll();
        this.turnMode = 'own';
    }

    /** Where turn events come from now. */
    mode(): TurnMode {
        return this.turnMode;
    }

    /** The generation in progress (not quiet, not a dry run), or null. */
    current(): GenerationInfo | null {
        return this.generation;
    }

    /** Follows the bridge: Maestro's pipeline when its API is present, our own tracking otherwise. */
    sync(): void {
        const api = this.deps.bridge.api();
        if (api && this.turnMode === 'maestro' && this.offMaestro && this.attached === api) return;
        this.detachMaestro();
        if (!api) {
            this.turnMode = 'own';
            return;
        }
        try {
            this.offMaestro = api.onTurn((event) => this.forward(event));
            this.attached = api;
            this.turnMode = 'maestro';
        } catch (error) {
            this.deps.log.warn('could not subscribe to Maestro turn events; tracking turns ourselves', error);
            this.turnMode = 'own';
        }
    }

    private own(): boolean {
        return this.turnMode === 'own';
    }

    private detachMaestro(): void {
        this.attached = null;
        if (!this.offMaestro) return;
        try {
            this.offMaestro();
        } catch (error) {
            this.deps.log.debug('Maestro turn unsubscribe failed', error);
        }
        this.offMaestro = null;
    }

    private async forward(event: ApiTurnEvent): Promise<void> {
        const { bus } = this.deps;
        switch (event.type) {
            case 'chat:changed':
                return bus.emit('chat:changed', { chatId: event.chatId });
            case 'reply:ready':
                return bus.emit('reply:ready', { messageIndex: event.messageIndex });
            case 'turn:committed':
                return bus.emit('turn:committed', { messageIndex: event.messageIndex });
            case 'message:invalidated':
                return bus.emit('message:invalidated', { messageIndex: event.messageIndex, reason: event.reason });
            case 'generation:before':
                return bus.emit('generation:before', {
                    type: event.generation,
                    dryRun: event.dryRun,
                    quiet: event.quiet,
                });
            case 'generation:ended':
                return bus.emit('generation:ended', { type: event.generation, stopped: event.stopped });
            default:
                this.deps.log.debug('unknown Maestro turn event', event);
        }
    }

    private startGeneration(info: GenerationInfo): void {
        this.generation = info;
        if (this.staleTimer) clearTimeout(this.staleTimer);
        // Safety net: a generation that never reports its end must not keep its injections forever.
        this.staleTimer = setTimeout(() => {
            if (this.generation !== info) return;
            this.deps.log.warn('generation end not reported, releasing');
            this.generation = null;
            this.deps.ephemeral.clearAll();
        }, GENERATION_STALE_MS);
    }

    private endGeneration(): void {
        this.generation = null;
        if (this.staleTimer) clearTimeout(this.staleTimer);
        this.staleTimer = null;
    }

    private lastAssistantBefore(index: number): number {
        const chat = this.deps.host.ctx().chat;
        for (let i = Math.min(index, chat.length) - 1; i >= 0; i--) {
            const message = chat[i];
            if (message && !message.is_user && !message.is_system) return i;
        }
        return -1;
    }

    private invalidate(messageId: unknown, reason: 'swiped' | 'deleted' | 'edited'): void {
        if (!this.own()) return;
        const index = Number(messageId);
        if (!Number.isInteger(index) || index < 0) return;
        void this.deps.bus.emit('message:invalidated', { messageIndex: index, reason });
    }
}

export function createTurnTracker(deps: TurnTrackerDeps): TurnTracker {
    return new TurnTracker(deps);
}
