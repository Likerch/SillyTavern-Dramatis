// The «Замеры» page of the sheet (docs/model.md §16 «Как поймём, что работает»): what the metrics module counted in
// this chat — the share of NPC lines addressed to the player, initiative, drift, stance steps, distinguishable voices —
// with a hint for each number and a reset to start counting again (to compare the same scenario with and without the
// motive card). Read-only besides the reset; the numbers come from `state.metrics` (domain/metrics.ts).
import { emptyMetrics, metricsReport, metricsRows } from '../../domain/metrics';
import { button, el } from '../../ui/dom';
import { backButton } from './page';
import { keyed, row } from './parts';
import type { SheetCtx } from './types';

/** Whether the metrics module is running (the numbers grow). */
function counting(ctx: SheetCtx): boolean {
    try {
        return ctx.app.modules.list().some((item) => item.module.key === 'metrics' && item.running);
    } catch {
        return true;
    }
}

export function renderMetrics(ctx: SheetCtx): HTMLElement[] {
    const t = ctx.t;
    const metrics = ctx.view.state.metrics;
    const report = metricsReport(metrics);
    const out: HTMLElement[] = [
        backButton(ctx),
        el('h3', { class: 'dramatis-sheet-title', text: t('sheet.metrics.title') }),
        el('p', { class: 'dramatis-field-hint', text: t('sheet.metrics.intro') }),
    ];
    if (!counting(ctx)) out.push(el('p', { class: 'dramatis-error-text', text: t('sheet.metrics.off') }));
    if (!metrics || report.turns === 0) {
        out.push(el('p', { class: 'dramatis-placeholder', text: t('sheet.metrics.none') }));
        return out;
    }
    out.push(
        el(
            'div',
            { class: 'dramatis-sheet-metrics' },
            metricsRows(report, ctx.lang).map((item) => {
                const node = row(item.label, el('strong', { text: item.value }), item.hint);
                node.dataset.metric = item.key;
                return node;
            }),
        ),
    );
    out.push(
        keyed(
            button({
                icon: 'fa-rotate-left',
                label: t('sheet.metrics.reset'),
                kind: 'ghost',
                onClick: async () => {
                    if (!(await ctx.app.ui.confirm(t('sheet.metrics.resetTitle'), t('sheet.metrics.resetBody'))))
                        return;
                    await ctx.save(
                        ctx.engine.updateState((state) => {
                            state.metrics = emptyMetrics(state.turn);
                        }),
                    );
                },
            }),
            'metrics:reset',
        ),
    );
    return out;
}
