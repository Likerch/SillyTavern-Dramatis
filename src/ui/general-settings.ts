// The «General» settings section: switches of Dramatis itself and every lever of docs/model.md §14.
import { SETTINGS_CHOICES } from '../core/settings';
import type { ChoiceKey } from '../core/settings';
import type { DramatisSettings, Host, I18n, SettingsSection, SettingsService } from '../shared/contracts';
import { field, numberInput, select, toggle } from './controls';
import type { SelectOption } from './controls';
import { el } from './dom';

export const GENERAL_SECTION_ID = 'general';

/** Levers shown as selects, in the order of docs/model.md §14; hints exist for some. */
const LEVERS: { key: ChoiceKey; hint?: boolean }[] = [
    { key: 'worldTone' },
    { key: 'playerGravity', hint: true },
    { key: 'inertia', hint: true },
    { key: 'fidelity' },
    { key: 'diversity' },
    { key: 'driftResponse', hint: true },
    { key: 'secrets' },
    { key: 'appetiteStrength' },
    { key: 'huntersPerScene' },
    { key: 'corruption' },
];

export interface GeneralSettingsDeps {
    settings: SettingsService;
    i18n: I18n;
    host: Host;
}

/** Connection Manager profiles (id, name); null when Connection Manager is off or missing. */
function connectionProfiles(host: Host): { id: string; name: string }[] | null {
    const ctx: Partial<STContext> = host.ctx();
    const disabled = ctx.extensionSettings?.disabledExtensions;
    if (Array.isArray(disabled) && disabled.includes('connection-manager')) return null;
    const service = ctx.ConnectionManagerRequestService;
    if (!service || typeof service.getSupportedProfiles !== 'function') return null;
    try {
        return service
            .getSupportedProfiles()
            .filter((profile) => profile && typeof profile.id === 'string')
            .map((profile) => ({ id: profile.id, name: String(profile.name ?? profile.id) }));
    } catch {
        return null;
    }
}

export function generalSettingsSection(deps: GeneralSettingsDeps): SettingsSection {
    const { settings, i18n, host } = deps;
    const t = i18n.t.bind(i18n);

    function choice<K extends ChoiceKey>(key: K, prefix: string, hintKey?: string): HTMLElement {
        const values = SETTINGS_CHOICES[key] as unknown as readonly DramatisSettings[K][];
        const options: SelectOption<string>[] = values.map((value) => ({
            value: String(value),
            label: t(`${prefix}.${String(value)}`),
        }));
        const control = select({
            value: String(settings.get()[key]),
            options,
            label: t(prefix),
            onChange: (value) => {
                const chosen = values.find((item) => String(item) === value);
                if (chosen !== undefined) settings.set(key, chosen);
            },
        });
        return field(t(prefix), control, hintKey ? t(hintKey) : undefined);
    }

    function profileRow(): HTMLElement {
        const current = settings.get().profile;
        const list = connectionProfiles(host);
        const options: SelectOption<string>[] = [{ value: '', label: t('ui.settings.profile.active') }];
        for (const profile of list ?? []) options.push({ value: profile.id, label: profile.name });
        if (current && !options.some((option) => option.value === current)) {
            options.push({ value: current, label: t('ui.settings.profile.missing', { id: current }) });
        }
        const control = select({
            value: current,
            options,
            label: t('ui.settings.profile'),
            disabled: list === null,
            onChange: (value) => settings.set('profile', value),
        });
        const hint = list === null ? t('ui.settings.profile.noCm') : t('ui.settings.profileHint');
        return field(t('ui.settings.profile'), control, hint);
    }

    return {
        id: GENERAL_SECTION_ID,
        titleKey: 'ui.settings.general',
        order: 0,
        render(container: HTMLElement) {
            const s = settings.get();
            container.append(
                el('div', { class: 'dramatis-settings-group' }, [
                    toggle({
                        label: t('ui.settings.enabled'),
                        checked: s.enabled,
                        onChange: (checked) => settings.set('enabled', checked),
                    }),
                    toggle({
                        label: t('ui.settings.debug'),
                        hint: t('ui.settings.debugHint'),
                        checked: s.debug,
                        onChange: (checked) => settings.set('debug', checked),
                    }),
                    choice('uiLanguage', 'ui.settings.language'),
                    choice('mode', 'ui.settings.mode', 'ui.settings.modeHint'),
                    choice('cardLanguage', 'ui.settings.cardLanguage'),
                    profileRow(),
                    toggle({
                        label: t('ui.settings.mergeVoices'),
                        hint: t('ui.settings.mergeVoicesHint'),
                        checked: s.mergeVoices,
                        onChange: (checked) => settings.set('mergeVoices', checked),
                    }),
                    toggle({
                        label: t('ui.settings.autoArchives'),
                        hint: t('ui.settings.autoArchivesHint'),
                        checked: s.autoArchives,
                        onChange: (checked) => settings.set('autoArchives', checked),
                    }),
                    field(
                        t('ui.settings.cardBudget'),
                        numberInput({
                            value: s.cardBudget,
                            min: 50,
                            max: 2000,
                            step: 10,
                            label: t('ui.settings.cardBudget'),
                            onChange: (value) => settings.set('cardBudget', value),
                        }),
                    ),
                    field(
                        t('ui.settings.depth'),
                        numberInput({
                            value: s.depth,
                            min: 0,
                            max: 20,
                            label: t('ui.settings.depth'),
                            onChange: (value) => settings.set('depth', value),
                        }),
                    ),
                ]),
                el('h5', { class: 'dramatis-settings-subtitle', text: t('ui.settings.levers') }),
                el('div', { class: 'dramatis-field-hint', text: t('ui.settings.leversHint') }),
                el(
                    'div',
                    { class: 'dramatis-settings-group' },
                    LEVERS.map((lever) =>
                        choice(
                            lever.key,
                            `ui.lever.${lever.key}`,
                            lever.hint ? `ui.lever.${lever.key}Hint` : undefined,
                        ),
                    ),
                ),
            );
        },
    };
}
