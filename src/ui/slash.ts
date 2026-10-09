// Slash commands through ST's SlashCommandParser (ported from Maestro). ST cannot unregister a command, so each name is
// registered once per page and routed through a slot: after its owner drops it (or Dramatis is disabled) the command
// stays in ST's list but answers with a short localized explanation instead of acting.
import type { Host, I18n, Logger, Unsubscribe } from '../shared/contracts';

type SlotState = 'active' | 'off' | 'dramatisOff';
type Callback = (value: string) => string | Promise<string>;

interface Slot {
    callback: Callback;
    state: SlotState;
    i18n: I18n;
    log: Logger;
    owner: SlashCommands;
}

/** Page-wide: survives a UI rebuild (disable → activate without reload) so ST never sees a duplicate. */
const slots = new Map<string, Slot>();

function unnamedText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map((item) => (typeof item === 'string' ? item : String(item))).join(' ');
    if (value === undefined || value === null) return '';
    return String(value);
}

export class SlashCommands {
    private readonly owned = new Set<string>();

    constructor(
        private readonly host: Host,
        private readonly i18n: I18n,
        private readonly log: Logger,
    ) {}

    add(rawName: string, helpKey: string, callback: Callback): Unsubscribe {
        const name = rawName.replace(/^\//, '');
        let slot = slots.get(name);
        if (slot) {
            Object.assign(slot, { callback, state: 'active', i18n: this.i18n, log: this.log, owner: this });
        } else {
            slot = { callback, state: 'active', i18n: this.i18n, log: this.log, owner: this };
            if (!this.register(name, helpKey)) return () => {};
            slots.set(name, slot);
        }
        this.owned.add(name);
        const current = slot;
        return () => {
            if (current.callback !== callback || current.state !== 'active') return;
            current.state = 'off';
        };
    }

    /** Dramatis is going away: every command it owns answers "Dramatis is disabled". */
    dispose(): void {
        for (const name of this.owned) {
            const slot = slots.get(name);
            if (slot && slot.owner === this) slot.state = 'dramatisOff';
        }
        this.owned.clear();
    }

    private register(name: string, helpKey: string): boolean {
        const c = this.host.ctx();
        if (!c.SlashCommandParser?.addCommandObject || !c.SlashCommand?.fromProps) {
            this.log.warn(`slash commands unavailable; /${name} not registered`);
            return false;
        }
        const props: Record<string, unknown> = {
            name,
            helpString: this.i18n.t(helpKey),
            returns: 'string',
            callback: (_named: unknown, unnamed: unknown) => run(name, unnamed),
        };
        if (c.SlashCommandArgument?.fromProps) {
            props.unnamedArgumentList = [
                c.SlashCommandArgument.fromProps({
                    description: this.i18n.t('ui.slash.argument'),
                    typeList: [c.ARGUMENT_TYPE?.STRING ?? 'string'],
                    isRequired: false,
                }),
            ];
        }
        try {
            c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps(props));
            return true;
        } catch (error) {
            this.log.error(`failed to register /${name}`, error);
            return false;
        }
    }
}

async function run(name: string, unnamed: unknown): Promise<string> {
    const slot = slots.get(name);
    if (!slot) return '';
    if (slot.state === 'dramatisOff') return slot.i18n.t('ui.slash.dramatisOff');
    if (slot.state === 'off') return slot.i18n.t('ui.slash.off', { name });
    try {
        return await slot.callback(unnamedText(unnamed));
    } catch (error) {
        slot.log.error(`/${name} failed`, error);
        return slot.i18n.t('ui.slash.failed', { name, error: error instanceof Error ? error.message : String(error) });
    }
}

/** Test helper: forget registrations (ST is re-mocked per test file). */
export function resetSlashSlots(): void {
    slots.clear();
}
