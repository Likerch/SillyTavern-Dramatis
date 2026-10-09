// «Рычаги этого чата» (docs/model.md §14): every lever a chat may override, with «Как в общих» to follow the general
// settings. Only the chosen values are stored (ChatState.overrides); every module reads them through chatLevers().
import { CHAT_LEVERS, LEVER_CHOICES, chatLevers, cleanOverrides, withLever } from '../../domain/levers';
import type { ChatLever } from '../../domain/levers';
import { select } from '../../ui/controls';
import type { SelectOption } from '../../ui/controls';
import { button, el } from '../../ui/dom';
import { backButton } from './page';
import { keyed, row } from './parts';
import type { SheetCtx } from './types';

/** The general settings' label key of a lever and the prefix of its value labels (booleans and numbers: none). */
const LABELS: Record<ChatLever, { label: string; values?: string }> = {
    mode: { label: 'ui.settings.mode', values: 'ui.settings.mode' },
    playerGravity: { label: 'ui.lever.playerGravity', values: 'ui.lever.playerGravity' },
    inertia: { label: 'ui.lever.inertia', values: 'ui.lever.inertia' },
    driftResponse: { label: 'ui.lever.driftResponse', values: 'ui.lever.driftResponse' },
    appetiteStrength: { label: 'ui.lever.appetiteStrength', values: 'ui.lever.appetiteStrength' },
    huntersPerScene: { label: 'ui.lever.huntersPerScene', values: 'ui.lever.huntersPerScene' },
    corruption: { label: 'ui.lever.corruption', values: 'ui.lever.corruption' },
    diversity: { label: 'ui.lever.diversity', values: 'ui.lever.diversity' },
    secrets: { label: 'ui.lever.secrets', values: 'ui.lever.secrets' },
    cardLanguage: { label: 'ui.settings.cardLanguage', values: 'ui.settings.cardLanguage' },
    mergeVoices: { label: 'ui.settings.mergeVoices' },
    cardBudget: { label: 'ui.settings.cardBudget' },
    depth: { label: 'ui.settings.depth' },
    autoArchives: { label: 'ui.settings.autoArchives' },
};

/** The value's words: the general settings' label, «вкл/выкл» for switches, the number itself for numbers. */
export function leverValueLabel(ctx: SheetCtx, key: ChatLever, value: unknown): string {
    const prefix = LABELS[key].values;
    if (prefix) return ctx.t(`${prefix}.${String(value)}`);
    if (typeof value === 'boolean') return ctx.t(value ? 'sheet.levers.on' : 'sheet.levers.off');
    return String(value);
}

/** How many levers this chat overrides (the list's link shows it). */
export function overrideCount(ctx: SheetCtx): number {
    return Object.keys(cleanOverrides(ctx.view.state.overrides)).length;
}

function setLever(ctx: SheetCtx, key: ChatLever, value: unknown): void {
    void ctx.save(
        ctx.engine.updateState((state) => {
            state.overrides = withLever(state.overrides, key, value);
        }),
    );
}

export function renderLevers(ctx: SheetCtx): HTMLElement[] {
    const t = ctx.t;
    const general = ctx.app.settings.get();
    const overrides = cleanOverrides(ctx.view.state.overrides) as Record<string, unknown>;
    const rows = CHAT_LEVERS.map((key) => {
        const own = Object.prototype.hasOwnProperty.call(overrides, key);
        const values = LEVER_CHOICES[key] as readonly unknown[];
        // A number set in the general settings may not be one of the chat presets: it is offered as well.
        const offered = values.includes(general[key]) ? values : [...values, general[key]];
        const current = own ? overrides[key] : undefined;
        const listed = current !== undefined && !offered.includes(current) ? [...offered, current] : offered;
        const options: SelectOption<string>[] = [
            {
                value: '',
                label: t('sheet.levers.general', { value: leverValueLabel(ctx, key, general[key]) }),
            },
            ...listed.map((value) => ({ value: JSON.stringify(value), label: leverValueLabel(ctx, key, value) })),
        ];
        const label = t(LABELS[key].label);
        const control = keyed(
            select({
                value: own ? JSON.stringify(current) : '',
                options,
                label,
                onChange: (raw) => setLever(ctx, key, raw === '' ? null : (JSON.parse(raw) as unknown)),
            }),
            `lever:${key}`,
        );
        const node = row(label, control);
        if (own) node.classList.add('dramatis-sheet-lever-own');
        return node;
    });
    const effective = chatLevers(general, overrides);
    const count = Object.keys(overrides).length;
    return [
        backButton(ctx),
        el('h3', { class: 'dramatis-sheet-title', text: t('sheet.levers.title') }),
        el('div', { class: 'dramatis-field-hint', text: t('sheet.levers.intro') }),
        el('div', { class: 'dramatis-sheet-levers' }, rows),
        el('div', { class: 'dramatis-sheet-levers-foot' }, [
            el('span', {
                class: 'dramatis-muted',
                text: count
                    ? t('sheet.levers.count', { n: count, mode: leverValueLabel(ctx, 'mode', effective.mode) })
                    : t('sheet.levers.none'),
            }),
            keyed(
                button({
                    icon: 'fa-rotate-left',
                    label: t('sheet.levers.reset'),
                    kind: 'ghost',
                    disabled: !count,
                    onClick: () =>
                        void ctx.save(
                            ctx.engine.updateState((state) => {
                                delete state.overrides;
                            }),
                        ),
                }),
                'levers:reset',
            ),
        ]),
    ];
}
