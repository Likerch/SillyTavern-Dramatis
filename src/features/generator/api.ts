// The generator's inter-module API (`app.modules.api<GeneratorApi>(GENERATOR_API)`), for the sheet UI: fill a
// character's empty fields, raise a character's level, pin a character (pinned → portrait). These are the user's own
// clicks: they run as interactive requests (no leader tab needed).
import type { Lod } from '../../domain/model';

export const GENERATOR_API = 'generator';

export interface GeneratorOutcome {
    ok: boolean;
    /** Profile paths written. */
    written: string[];
    /** 'busy', 'no-chat', 'unknown', 'not-leader', 'cap', 'no-candidates', an LLM error code… */
    error?: string;
}

export interface GeneratorApi {
    /** Fills the empty fields of a character (authored or generated); author, user and locked fields stay. */
    fillGaps(id: string): Promise<GeneratorOutcome>;
    /** Raises a character to this level now (adds fields, never rewrites them); ok and nothing written when already there. */
    promote(id: string, lod: Lod): Promise<GeneratorOutcome>;
    /** Pins or unpins a character in this chat; pinning promotes to a portrait. */
    pin(id: string, pinned: boolean): Promise<GeneratorOutcome>;
    /** Character ids with a generator request in flight. */
    busy(): string[];
    /** Resolves when the queued background work (sketches, rules, promotions, fills) is done. */
    idle(): Promise<void>;
}
