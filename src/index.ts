// Entry point loaded by SillyTavern as <script type="module">. Lifecycle hooks are the exported functions named in
// manifest.json `hooks`; ST calls them without arguments, each with a 5 s timeout.
// No side effects at module top level: ST imports this module even for the `enable` hook.
import './ui/style.css';
import { startDramatis } from './app/app';
import type { Runtime } from './app/app';
import { SETTINGS_KEY } from './core/settings';

let runtime: Runtime | null = null;
let starting: Promise<Runtime> | null = null;

/** hooks.activate */
export async function onActivate(): Promise<void> {
    if (runtime || starting) return;
    starting = startDramatis();
    try {
        runtime = await starting;
        console.info('[Dramatis] activated');
    } catch (error) {
        console.error('[Dramatis] activation failed', error);
    } finally {
        starting = null;
    }
}

/** hooks.disable: quick cleanup within ST's 5 s window (DRAMATIS_API goes away with it). */
export async function onDisable(): Promise<void> {
    const pending = starting;
    if (pending) await pending.catch(() => undefined);
    const current = runtime;
    runtime = null;
    await current?.stop();
}

/** hooks.enable */
export async function onEnable(): Promise<void> {
    // ST reloads the page after enabling; activation happens then.
}

/** hooks.install */
export async function onInstall(): Promise<void> {
    // Nothing to prepare: settings get their defaults on the first activation.
}

/** hooks.update */
export async function onUpdate(): Promise<void> {
    // Settings and document migrations run on activation.
}

/** hooks.delete */
export async function onDelete(): Promise<void> {
    await onDisable();
}

/** hooks.clean: removes Dramatis settings; its user files (dramatis-*) stay until the user deletes them. */
export async function onClean(): Promise<void> {
    const current = runtime;
    await onDisable();
    if (current) {
        current.settings.reset();
        return;
    }
    try {
        const context = SillyTavern.getContext();
        delete context.extensionSettings[SETTINGS_KEY];
        context.saveSettingsDebounced();
    } catch (error) {
        console.error('[Dramatis] could not clean settings', error);
    }
}
