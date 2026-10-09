// The director's inter-module API (`app.modules.api<DirectorApi>(DIRECTOR_API)`): the motive card asks it for this
// generation's calls right before it is built. Types and the key only.
import type { GenerationInfo } from '../../shared/contracts';

export const DIRECTOR_API = 'director';

export interface DirectorApi {
    /**
     * The director's calls for this generation, keyed by character id, in the motive card's language («slips the coin
     * into her apron (toward Брам)»). Undefined when the director does not run now (not «Кино», a dry or quiet run, no
     * Maestro, nobody present) or the request failed or timed out. Never throws.
     */
    beat(gen: GenerationInfo): Promise<Readonly<Record<string, string>> | undefined>;
}
