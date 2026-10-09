// The page of one character or group: a header (name, role, level of detail, presence, delete) and six sections —
// tabs on a wide window, an accordion on a phone (< 768 px), both reachable from the keyboard.
import { lodLabel } from '../../domain/ladders';
import { button, el } from '../../ui/dom';
import { deleteCharacter, isExtra } from './edits';
import { bindProfile, emptyState, keyed, selectCtl } from './parts';
import type { ProfileBind } from './parts';
import { renderAgenda } from './section-agenda';
import { renderAppetites } from './section-appetites';
import { renderCore } from './section-core';
import { renderHistory, renderNow } from './section-now';
import { renderTies } from './section-ties';
import { SECTIONS } from './types';
import type { SectionId, SheetCtx } from './types';

const RENDERERS: Record<SectionId, (b: ProfileBind) => HTMLElement[]> = {
    core: renderCore,
    appetites: renderAppetites,
    agenda: renderAgenda,
    ties: renderTies,
    now: renderNow,
    history: renderHistory,
};

export function sectionKey(id: SectionId): string {
    return `section:${id}`;
}

export function backButton(ctx: SheetCtx): HTMLElement {
    return keyed(
        button({
            icon: 'fa-arrow-left',
            label: ctx.t('sheet.back'),
            kind: 'ghost',
            className: 'dramatis-sheet-back',
            onClick: () => ctx.navigate({ page: 'list' }),
        }),
        'nav:back',
    );
}

export function renderCharacterPage(ctx: SheetCtx, id: string, narrow: boolean): HTMLElement[] {
    const t = ctx.t;
    const profile = ctx.view.byId.get(id);
    if (!profile) return [backButton(ctx), emptyState(t('sheet.page.missing'))];
    const b = bindProfile(ctx, profile);
    const present = ctx.view.present.includes(id);
    const extra = isExtra(ctx.view, id);
    const sub = [ctx.tr(profile.role), ctx.tr(profile.species)].filter(Boolean).join(' · ');

    const remove = keyed(
        button({
            icon: 'fa-trash-can',
            kind: 'danger',
            title: t(profile.kind === 'group' ? 'sheet.page.deleteGroup' : 'sheet.page.delete'),
            onClick: async () => {
                const sure = await ctx.app.ui.confirm(
                    t('sheet.page.deleteTitle', { name: profile.name }),
                    t(extra ? 'sheet.page.deleteExtraBody' : 'sheet.page.deleteBody', { name: profile.name }),
                );
                if (!sure) return;
                await ctx.save(deleteCharacter(ctx.engine, id));
                ctx.navigate({ page: 'list' });
            },
        }),
        `${id}:delete`,
    );
    const lod = selectCtl(
        b,
        'lod',
        t('sheet.field.lod'),
        (['sketch', 'draft', 'portrait'] as const).map((value) => ({ value, label: lodLabel(value, ctx.lang) })),
    );
    lod.classList.add('dramatis-sheet-lod');

    const head = el('div', { class: 'dramatis-sheet-page-head' }, [
        backButton(ctx),
        el('div', { class: 'dramatis-sheet-header-top' }, [
            el('h3', { class: 'dramatis-sheet-title', text: profile.name }),
            remove,
        ]),
        sub ? el('div', { class: 'dramatis-muted', text: sub }) : null,
        el('div', { class: 'dramatis-sheet-tags' }, [
            lod,
            present
                ? el('span', { class: ['dramatis-sheet-tag', 'dramatis-sheet-tag-on'], text: t('sheet.present.yes') })
                : null,
            profile.kind === 'group' ? el('span', { class: 'dramatis-sheet-tag', text: t('sheet.kind.group') }) : null,
            extra
                ? el('span', { class: 'dramatis-sheet-tag', title: t('sheet.extraHint'), text: t('sheet.extra') })
                : null,
        ]),
    ]);

    return [head, narrow ? accordion(ctx, b) : tabs(ctx, b)];
}

function tabs(ctx: SheetCtx, b: ProfileBind): HTMLElement {
    const t = ctx.t;
    const active = SECTIONS.includes(ctx.settings.tab) ? ctx.settings.tab : 'core';
    const select = (id: SectionId) => {
        ctx.settings.tab = id;
        ctx.app.settings.save();
        ctx.rerender();
    };
    const list = el('div', {
        class: 'dramatis-sheet-tabs',
        attrs: { role: 'tablist', 'aria-label': t('sheet.sections') },
    });
    for (const id of SECTIONS) {
        const selected = id === active;
        const tab = keyed(
            button({
                label: t(`sheet.section.${id}`),
                kind: 'ghost',
                className: 'dramatis-sheet-tab',
                onClick: () => select(id),
            }),
            `tab:${id}`,
        );
        tab.setAttribute('role', 'tab');
        tab.setAttribute('id', `dramatis-sheet-tab-${id}`);
        tab.setAttribute('aria-selected', String(selected));
        tab.setAttribute('aria-controls', 'dramatis-sheet-panel');
        tab.tabIndex = selected ? 0 : -1;
        list.appendChild(tab);
    }
    list.addEventListener('keydown', (event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            select(event.key === 'Home' ? SECTIONS[0]! : SECTIONS[SECTIONS.length - 1]!);
            return;
        }
        if (!step) return;
        event.preventDefault();
        const index = SECTIONS.indexOf(active);
        select(SECTIONS[(index + step + SECTIONS.length) % SECTIONS.length]!);
    });
    const panel = el(
        'div',
        {
            class: 'dramatis-sheet-panel',
            data: { section: active },
            attrs: { role: 'tabpanel', id: 'dramatis-sheet-panel', 'aria-labelledby': `dramatis-sheet-tab-${active}` },
        },
        RENDERERS[active](b),
    );
    return el('div', { class: 'dramatis-sheet-sections' }, [list, panel]);
}

function accordion(ctx: SheetCtx, b: ProfileBind): HTMLElement {
    const t = ctx.t;
    const root = el('div', { class: 'dramatis-sheet-accordion' });
    for (const id of SECTIONS) {
        const key = sectionKey(id);
        const open = ctx.session.expanded.has(key);
        const head = keyed(
            button({
                icon: open ? 'fa-chevron-down' : 'fa-chevron-right',
                label: t(`sheet.section.${id}`),
                kind: 'ghost',
                className: 'dramatis-sheet-acc-head',
                onClick: () => {
                    if (open) ctx.session.expanded.delete(key);
                    else {
                        ctx.session.expanded.add(key);
                        ctx.settings.tab = id;
                        ctx.app.settings.save();
                    }
                    ctx.rerender();
                },
            }),
            `acc:${id}`,
        );
        head.setAttribute('aria-expanded', String(open));
        head.setAttribute('aria-controls', `dramatis-sheet-acc-${id}`);
        root.appendChild(
            el('section', { class: ['dramatis-sheet-acc', open && 'dramatis-sheet-acc-open'], data: { section: id } }, [
                head,
                open
                    ? el(
                          'div',
                          { class: 'dramatis-sheet-panel', attrs: { id: `dramatis-sheet-acc-${id}` } },
                          RENDERERS[id](b),
                      )
                    : null,
            ]),
        );
    }
    return root;
}
