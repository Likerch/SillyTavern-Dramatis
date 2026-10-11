// Module `sheet` (stage 1): the «Состав / Лист замысла» window (docs/model.md §7). It replaces the app's placeholder
// window 'cast' (what /dramatis opens) with the cast list and a full editor of every field of every character, and adds
// `/dramatis-sheet <name>` to open one character, an item «Лист замысла (Dramatis)» in SillyTavern's extensions menu and
// DRAMATIS_API.openSheet (Maestro's «Открыть» after its chat preparation, its «Dramatis» tab in DES's Character
// Sheet). Reads and writes the story only through the engine's API; reading the author's intent goes through the intent
// module's API when it runs.
import type { EngineApi, EngineView } from '../engine/api';
import { ENGINE_API } from '../engine/api';
import { matchName } from '../../domain/presence';
import type { DramatisModule } from '../../shared/contracts';
import sheetCss from './sheet.css?inline';
import { SHEET_STRINGS } from './strings';
import { CAST_WINDOW, FILTERS, SECTIONS, SHEET_SLASH } from './types';
import type { IntentReadResult, SheetSettings } from './types';
import { renderSheet } from './view';

/** The profile id a name means: the engine's resolution (Maestro's names, DES aliases), an id, the cast's names. */
export function characterId(engine: EngineApi, view: EngineView, name: string): string | null {
    const resolved = engine.resolve(name);
    return (
        (resolved && view.byId.has(resolved) ? resolved : null) ??
        (view.byId.has(name) ? name : null) ??
        matchName(name, view.profiles)
    );
}

export const sheetModule: DramatisModule<SheetSettings> = {
    key: 'sheet',
    stage: 1,
    titleKey: 'sheet.title',
    enabledByDefault: true,
    defaults: () => ({ filter: 'all', tab: 'core' }),
    i18n: SHEET_STRINGS,
    init({ app, settings, log, own, session }) {
        // Stored values from another version fall back to the defaults.
        if (!FILTERS.includes(settings.filter)) settings.filter = 'all';
        if (!SECTIONS.includes(settings.tab)) settings.tab = 'core';
        // The reading panel per card and the readings already shown: kept for the session, past a stop and start.
        const { results, seen } = session(() => ({
            results: new Map<string, { result: IntentReadResult; taken: Set<number> }>(),
            seen: new Map<string, string>(),
        }));
        const deps = { app, settings, log, results, seen };
        const engine = () => app.modules.api<EngineApi>(ENGINE_API);

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
            app.ui.addMenuItem({
                id: 'sheet',
                icon: 'masks-theater',
                labelKey: 'sheet.menu',
                titleKey: 'sheet.menuHint',
                onClick: () => app.ui.openWindow(CAST_WINDOW),
            }),
        );
        app.modules.expose('api', {
            /** A character's page when the name means someone of the current cast, else the list. */
            openSheet(name?: string): void {
                const query = typeof name === 'string' ? name.trim() : '';
                const api = query ? engine() : undefined;
                const view = api?.view();
                const id = api && view ? characterId(api, view, query) : null;
                app.ui.openWindow(CAST_WINDOW, id ? { character: id } : {});
            },
        });
        own(
            app.ui.addSlashCommand(SHEET_SLASH, 'sheet.slash.help', async (value) => {
                const t = app.i18n.t.bind(app.i18n);
                const name = value.trim();
                if (!name) {
                    app.ui.openWindow(CAST_WINDOW);
                    return '';
                }
                const api = engine();
                const view = api ? (api.view() ?? (await api.ready())) : null;
                if (!api || !view) {
                    app.ui.openWindow(CAST_WINDOW);
                    return t('sheet.slash.noCast');
                }
                const id = characterId(api, view, name);
                if (!id) return t('sheet.slash.notFound', { name });
                app.ui.openWindow(CAST_WINDOW, { character: id });
                return '';
            }),
        );
    },
};
