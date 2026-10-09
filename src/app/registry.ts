// Every Dramatis module, in no particular order (the manager starts them by `stage`). A module lives in
// src/features/<key>/index.ts and exports a DramatisModule; add it here with one import and one list entry.
import type { DramatisModule } from '../shared/contracts';

export const MODULES: DramatisModule[] = [];
