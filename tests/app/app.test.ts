// @vitest-environment happy-dom
// The whole app on the ST mock: wiring, the API, the settings drawer, /dramatis and a clean stop.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CAST_WINDOW_ID, DRAMATIS_VERSION, startDramatis } from '../../src/app/app';
import type { Runtime } from '../../src/app/app';
import { ConsoleLogger } from '../../src/core/logger';
import { SETTINGS_KEY } from '../../src/core/settings';
import { DRAMATIS_API_GLOBAL, MAESTRO_API_GLOBAL } from '../../src/shared/apis';
import type { DramatisApiV1 } from '../../src/shared/apis';
import { resetSlashSlots } from '../../src/ui/slash';
import { fakeMaestro } from '../helpers/fakes';
import { character, flush, installStMock, openSoloChat } from '../helpers/st-mock';
import type { StMock } from '../helpers/st-mock';
import packageJson from '../../package.json';
import manifest from '../../manifest.json';

let mock: StMock;
let runtime: Runtime | null = null;
const globals = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
    mock = installStMock();
    resetSlashSlots();
    ConsoleLogger.setLevel('error');
    document.body.innerHTML = '<div id="extensions_settings"></div><div id="extensions_settings2"></div>';
    openSoloChat(mock, character('Marta'));
});

afterEach(async () => {
    await runtime?.stop();
    runtime = null;
    delete globals[MAESTRO_API_GLOBAL];
    document.body.innerHTML = '';
});

describe('startDramatis', () => {
    it('takes its version from package.json, matching the manifest', () => {
        expect(DRAMATIS_VERSION).toBe(packageJson.version);
        expect(manifest.version).toBe(packageJson.version);
    });

    it('wires every service and publishes DRAMATIS_API', async () => {
        runtime = await startDramatis({ rng: () => 0.5 });
        const { app } = runtime;
        expect(app.version).toBe(DRAMATIS_VERSION);
        expect(app.rng()).toBe(0.5);
        expect(app.host.cardKey()).toBe('marta.png');
        expect(mock.extensionSettings[SETTINGS_KEY]).toBe(app.settings.get());
        expect((globals[DRAMATIS_API_GLOBAL] as DramatisApiV1).version).toBe(1);
        expect(app.maestro.present()).toBe(false);
        expect(runtime.turn.mode()).toBe('own');
        expect((await app.state.current())?.card).toBe('marta.png');
        expect(app.readers.card.current()?.name).toBe('Marta');
    });

    it('mounts the settings drawer with the General section', async () => {
        runtime = await startDramatis();
        const root = document.querySelector('#extensions_settings2 #dramatis-settings');
        expect(root).not.toBeNull();
        expect(root?.querySelector('[data-section="general"] h4')?.textContent).toBe('Общие');
        expect(root?.querySelectorAll('select').length).toBeGreaterThanOrEqual(13);
    });

    it('changes a lever from the settings section', async () => {
        runtime = await startDramatis();
        const selects = [...document.querySelectorAll<HTMLSelectElement>('#dramatis-settings select')];
        const inertia = selects.find((node) => node.getAttribute('aria-label') === 'Инерция отношений')!;
        inertia.value = 'low';
        inertia.dispatchEvent(new Event('change'));
        expect(runtime.app.settings.get().inertia).toBe('low');
    });

    it('registers /dramatis that opens the cast window (the intent sheet of the sheet module)', async () => {
        runtime = await startDramatis();
        const command = mock.slashCommands.get('dramatis');
        expect(command).toBeDefined();
        expect(await command!.callback({}, '')).toBe('');
        const win = document.querySelector(`[data-window="${CAST_WINDOW_ID}"]`);
        expect(win?.querySelector('.dramatis-window-title')?.textContent).toBe('Лист замысла');
        expect(win?.querySelector('.dramatis-sheet')).not.toBeNull();
        expect(win?.querySelector('.dramatis-placeholder')).not.toBeNull();
    });

    it('follows Maestro when its API appears later', async () => {
        runtime = await startDramatis();
        globals[MAESTRO_API_GLOBAL] = fakeMaestro().api;
        window.dispatchEvent(new CustomEvent('maestro-api-ready'));
        await flush();
        expect(runtime.app.maestro.present()).toBe(true);
        expect(runtime.turn.mode()).toBe('maestro');
        expect(runtime.app.llm.viaMaestro()).toBe(true);
    });

    it('stops cleanly: no API, no drawer, no windows, no ST listeners', async () => {
        runtime = await startDramatis();
        runtime.app.ui.openWindow(CAST_WINDOW_ID);
        await runtime.stop();
        runtime = null;
        expect(globals[DRAMATIS_API_GLOBAL]).toBeUndefined();
        expect(document.querySelector('#dramatis-settings')).toBeNull();
        expect(document.querySelector('.dramatis-window')).toBeNull();
        const listeners = [...mock.eventSource.events.values()].reduce((sum, list) => sum + list.length, 0);
        expect(listeners).toBe(0);
        expect(await mock.slashCommands.get('dramatis')!.callback({}, '')).toBe('Dramatis выключен.');
    });
});
