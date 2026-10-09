// The only door to SillyTavern: context, ordered events, runtime module imports and the current chat / card.
import type { Host, Logger } from '../shared/contracts';
import { createHostEvents } from './events';
import type { HostEventsImpl } from './events';
import { createHostModules } from './modules';
import type { HostModulesImpl } from './modules';

export type { HostEventsImpl } from './events';
export type { HostModulesImpl, ModuleImporter, ModuleNamespace } from './modules';

export interface HostImpl extends Host {
    events: HostEventsImpl;
    modules: HostModulesImpl;
    /** The current character of a solo chat (null in a group chat or with nobody selected). */
    character(): STCharacter | null;
    /** Removes every ST listener registered through this host. */
    dispose(): void;
}

/** Never cache the result: getContext() builds a new object on every call and chatMetadata is reassigned on chat load. */
function context(): STContext {
    return SillyTavern.getContext();
}

export function createHost(log: Logger): HostImpl {
    const events = createHostEvents(context, log.scope('events'));
    const modules = createHostModules(log.scope('modules'));

    function character(): STCharacter | null {
        const ctx = context();
        if (ctx.groupId) return null;
        const id = ctx.characterId;
        if (id === undefined || id === null || id === '') return null;
        const index = Number(id);
        if (!Number.isInteger(index) || index < 0) return null;
        return ctx.characters?.[index] ?? null;
    }

    return {
        ctx: context,
        events,
        modules,
        character,

        chatId(): string | null {
            const id = context().getCurrentChatId?.();
            return typeof id === 'string' && id ? id : null;
        },

        isGroupChat(): boolean {
            return Boolean(context().groupId);
        },

        cardKey(): string | null {
            const avatar = character()?.avatar;
            return typeof avatar === 'string' && avatar ? avatar : null;
        },

        dispose(): void {
            events.dispose();
        },
    };
}
