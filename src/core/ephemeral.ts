// One-generation injections (ported from Maestro src/core/ephemeral.ts): producers set extension prompt slots
// `dramatis_<key>` right before a generation; every slot is cleared after it (ST skips empty slots). Nothing here is
// ever persisted.
import type { Ephemeral, GenerationInfo, Host, InjectionSpec, Logger, Unsubscribe } from '../shared/contracts';

export interface EphemeralDeps {
    host: Host;
    log: Logger;
}

export interface EphemeralRunner extends Ephemeral {
    /** Clears the last generation's slots, then runs every producer for this one (none for a dry run). */
    run(info: GenerationInfo): Promise<void>;
}

type Producer = (gen: GenerationInfo) => void | Promise<void>;

export function injectionKey(key: string): string {
    return key.startsWith('dramatis_') ? key : `dramatis_${key}`;
}

export function createEphemeral(deps: EphemeralDeps): EphemeralRunner {
    const { host, log } = deps;
    const producers = new Map<string, Producer>();
    const injections = new Map<string, InjectionSpec>();

    const clearAll = (): void => {
        if (injections.size === 0) return;
        const ctx = host.ctx();
        for (const [key, spec] of injections) {
            try {
                ctx.setExtensionPrompt(injectionKey(key), '', spec.position, spec.depth ?? 0, false, spec.role ?? 0);
            } catch (error) {
                log.warn(`could not clear injection ${key}`, error);
            }
        }
        injections.clear();
    };

    return {
        setInjection(key: string, spec: InjectionSpec): void {
            host.ctx().setExtensionPrompt(
                injectionKey(key),
                spec.text,
                spec.position,
                spec.depth ?? 0,
                spec.scan ?? false,
                spec.role ?? 0,
            );
            injections.set(key, { ...spec });
        },

        addProducer(name: string, producer: Producer): Unsubscribe {
            if (producers.has(name)) log.warn(`ephemeral producer ${name} replaced`);
            producers.set(name, producer);
            return () => {
                if (producers.get(name) === producer) producers.delete(name);
            };
        },

        isSet(key: string): boolean {
            const spec = injections.get(key);
            return spec !== undefined && spec.text.length > 0;
        },

        clearAll,

        async run(info: GenerationInfo): Promise<void> {
            clearAll();
            if (info.dryRun) return;
            for (const [name, producer] of [...producers]) {
                try {
                    await producer(info);
                } catch (error) {
                    log.error(`ephemeral producer ${name} failed`, error);
                }
            }
        },
    };
}
