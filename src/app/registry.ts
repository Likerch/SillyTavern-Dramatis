// Every Dramatis module, in no particular order (the manager starts them by `stage`). A module lives in
// src/features/<key>/index.ts and exports a DramatisModule; add it here with one import and one list entry.
import type { DramatisModule } from '../shared/contracts';
import { castModule } from '../features/cast';
import { engineModule } from '../features/engine';
import { generatorModule } from '../features/generator';
import { intentModule } from '../features/intent';
import { sheetModule } from '../features/sheet';
import { turnModule } from '../features/turn';
import { world as worldModule } from '../features/world';

export const MODULES: DramatisModule[] = [
    engineModule,
    castModule,
    intentModule,
    sheetModule,
    turnModule,
    generatorModule,
    worldModule,
];
