// Module `sheet` (stage 1): the «Состав / Лист замысла» window (docs/model.md §7). It replaces the app's placeholder
// window 'cast' (what /dramatis opens) with the cast list and a full editor of every field of every character, and adds
// `/dramatis-sheet <name>` to open one character. Reads and writes the story only through the engine's API; reading
// the author's intent goes through the intent module's API when it runs.
import type { EngineApi } from '../engine/api';
import { ENGINE_API } from '../engine/api';
import { matchName } from '../../domain/presence';
import type { DramatisModule } from '../../shared/contracts';
import sheetCss from './sheet.css?inline';
import { SHEET_STRINGS } from './strings';
import { CAST_WINDOW, FILTERS, SECTIONS, SHEET_SLASH } from './types';
import type { IntentReadResult, SheetSettings } from './types';
import { renderSheet } from './view';

export const sheetModule: DramatisModule<SheetSettings> = {
    key: 'sheet',
    stage: 1,
    titleKey: 'sheet.title',
    enabledByDefault: true,
    defaults: () => ({ filter: 'all', tab: 'core' }),
    i18n: SHEET_STRINGS,
    init({ app, settings, log, own }) {
        // Stored values from another version fall back to the defaults.
        if (!FILTERS.includes(settings.filter)) settings.filter = 'all';
        if (!SECTIONS.includes(settings.tab)) settings.tab = 'core';
        const results = new Map<string, { result: IntentReadResult; taken: Set<number> }>();
        const deps = { app, settings, log, results, seen: new Map<string, string>() };

        own(app.ui.style('sheet', sheetCss));
        own(
            app.ui.addWindow({
                id: CAST_WINDOW,
                titleKey: 'sheet.window',
                defaultWidth: 520,
                render: (container, params) => renderSheet(deps, container, params),
            }),
        );
        own(
            app.ui.addSlashCommand(SHEET_SLASH, 'sheet.slash.help', async (value) => {
                const t = app.i18n.t.bind(app.i18n);
                const name = value.trim();
                if (!name) {
                    app.ui.openWindow(CAST_WINDOW);
                    return '';
                }
                const engine = app.modules.api<EngineApi>(ENGINE_API);
                const view = engine ? (engine.view() ?? (await engine.ready())) : null;
                if (!engine || !view) {
                    app.ui.openWindow(CAST_WINDOW);
                    return t('sheet.slash.noCast');
                }
                const resolved = engine.resolve(name);
                const id =
                    (resolved && view.byId.has(resolved) ? resolved : null) ??
                    (view.byId.has(name) ? name : null) ??
                    matchName(name, view.profiles);
                if (!id) return t('sheet.slash.notFound', { name });
                app.ui.openWindow(CAST_WINDOW, { character: id });
                return '';
            }),
        );
    },
};
