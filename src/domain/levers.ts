// Per-chat levers (docs/model.md §14: «любой рычаг можно переопределить для отдельного чата»). The chat state keeps
// only the values the user set for this chat (`ChatState.overrides`); everything else comes from the general settings.
// Every module reads the levers of a chat through chatLevers(), so an override counts everywhere at once.
import type { DramatisSettings } from '../shared/contracts';

/** Levers a chat may override, in the order the sheet shows them. */
export const CHAT_LEVERS = [
    'mode',
    'playerGravity',
    'inertia',
    'driftResponse',
    'appetiteStrength',
    'huntersPerScene',
    'corruption',
    'diversity',
    'secrets',
    'cardLanguage',
    'mergeVoices',
    'cardBudget',
    'depth',
    'autoArchives',
] as const satisfies readonly (keyof DramatisSettings)[];

export type ChatLever = (typeof CHAT_LEVERS)[number];

/** Allowed values per lever (numbers: the presets offered for a chat; any value in the range is valid). */
export const LEVER_CHOICES: { [K in ChatLever]: readonly DramatisSettings[K][] } = {
    mode: ['economy', 'balanced', 'cinema'],
    playerGravity: ['low', 'medium', 'high'],
    inertia: ['high', 'medium', 'low'],
    driftResponse: ['correct', 'stress', 'redo'],
    appetiteStrength: ['muted', 'author', 'sharp'],
    huntersPerScene: [0, 1, 2, 3],
    corruption: ['off', 'coarse', 'all'],
    diversity: ['even', 'varied'],
    secrets: ['open', 'spoiler', 'known'],
    cardLanguage: ['en', 'ru'],
    mergeVoices: [true, false],
    cardBudget: [150, 200, 300, 400, 600, 800, 1200],
    depth: [0, 1, 2, 3, 4, 6, 8],
    autoArchives: [true, false],
};

/** Numeric levers: any integer in the range is a valid override (the same limits as the general settings). */
export const LEVER_RANGES: Partial<Record<ChatLever, { min: number; max: number }>> = {
    cardBudget: { min: 50, max: 2000 },
    depth: { min: 0, max: 20 },
};

export function isChatLever(key: string): key is ChatLever {
    return (CHAT_LEVERS as readonly string[]).includes(key);
}

/** Whether `value` is a valid override of `key`. */
export function validLever(key: ChatLever, value: unknown): boolean {
    const range = LEVER_RANGES[key];
    if (range) return typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max;
    return (LEVER_CHOICES[key] as readonly unknown[]).includes(value);
}

/** The chat's valid overrides only (unknown keys and bad values dropped). */
export function cleanOverrides(overrides: Record<string, unknown> | undefined): Partial<DramatisSettings> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(overrides ?? {})) {
        if (isChatLever(key) && validLever(key, value)) out[key] = value;
    }
    return out as Partial<DramatisSettings>;
}

/** The settings of a chat: the general settings with the chat's valid overrides on top. */
export function chatLevers(general: DramatisSettings, overrides?: Record<string, unknown>): DramatisSettings {
    return { ...general, ...cleanOverrides(overrides) };
}

/**
 * The overrides after setting one lever: `null` removes the override («как в общих»), so the chat follows the general
 * settings again when they change; a value equal to the general one is kept — the chat pins it.
 */
export function withLever(
    overrides: Record<string, unknown> | undefined,
    key: ChatLever,
    value: unknown,
): Record<string, unknown> {
    const out = { ...cleanOverrides(overrides) } as Record<string, unknown>;
    if (value === null || value === undefined || !validLever(key, value)) delete out[key];
    else out[key] = value;
    return out;
}
