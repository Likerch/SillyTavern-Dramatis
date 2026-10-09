// Readers of the stack (DES, CK lore, the card) and the Maestro bridge.
import type { Host, Logger, Readers } from '../shared/contracts';
import { createCardReader } from './card';
import type { CardReaderImpl } from './card';
import { createDesReader } from './des';
import { createLoreReader } from './lore';
import type { LoreReaderImpl } from './lore';

export { createMaestroBridge, isMaestroApi } from './maestro';
export type { MaestroBridgeImpl } from './maestro';
export type { CardReaderImpl } from './card';
export type { LoreReaderImpl } from './lore';

export interface ReadersImpl extends Readers {
    lore: LoreReaderImpl;
    card: CardReaderImpl;
    install(): void;
    dispose(): void;
}

export function createReaders(host: Host, log: Logger): ReadersImpl {
    const des = createDesReader(host, log.scope('des'));
    const lore = createLoreReader(host, log.scope('lore'));
    const card = createCardReader(host, log.scope('card'));
    return {
        des,
        lore,
        card,
        install: () => lore.install(),
        dispose: () => lore.dispose(),
    };
}
