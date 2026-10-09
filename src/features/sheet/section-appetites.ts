// «Влечения»: the character's appetites with every field (docs/model.md §4.5). Desirability, gaze and claim toward a
// particular person live on the ties («Связи»). Hidden and secret appetites go under the spoiler lever.
import { APPETITE_KINDS, STYLES } from '../../domain/model';
import type { Appetite, AppetiteKind, AppetiteSource, Satisfier } from '../../domain/model';
import {
    appetiteKindLabel,
    appetiteSourceLabel,
    endorsementLabel,
    onsetLabel,
    styleBehaviour,
    styleLabel,
    visibilityLabel,
    vowLabel,
} from '../../domain/ladders';
import { LIMITS, cleanText, normalizeAppetite } from '../../domain/profile-defaults';
import { select } from '../../ui/controls';
import { button, el } from '../../ui/dom';
import { numberField, textInput } from '../../ui/form';
import { chipsCtl, keyed, listCtl, profileUnit, rangeCtl, row, selectCtl, textCtl, emptyState } from './parts';
import type { ProfileBind } from './parts';
import { isHiddenAppetite, spoiler } from './secrets';
import { words } from './words';

const SOURCES: readonly AppetiteSource[] = ['individual', 'species', 'culture', 'situation', 'world'];

export function appetiteTitle(b: ProfileBind, appetite: Appetite): string {
    const kind = appetiteKindLabel(appetite.kind, b.ctx.lang);
    return appetite.label ? `${b.ctx.tr(appetite.label)} (${kind})` : kind;
}

export function renderAppetites(b: ProfileBind): HTMLElement[] {
    const { ctx, profile } = b;
    const t = ctx.t;
    const out: HTMLElement[] = [];
    if (!profile.appetites.length) out.push(emptyState(t('sheet.appetites.none')));
    for (const appetite of profile.appetites) {
        const block = renderAppetite(b, appetite);
        if (!isHiddenAppetite(appetite)) {
            out.push(block);
            continue;
        }
        const hidden = spoiler(ctx, `${profile.id}:appetite:${appetite.id}`, () => block);
        if (hidden) out.push(el('div', { class: 'dramatis-sheet-secret' }, [hidden]));
    }
    if (profile.appetites.length < LIMITS.appetites) out.push(addAppetite(b));
    return out;
}

function renderAppetite(b: ProfileBind, appetite: Appetite): HTMLElement {
    const { ctx, profile } = b;
    const t = ctx.t;
    const lang = ctx.lang;
    const w = words(ctx);
    const base = `appetites.${appetite.id}`;
    const p = (field: string) => `${base}.${field}`;

    const target = appetite.target;
    const setTarget = (mode: string, cls?: string) =>
        b.edit(
            p('target'),
            mode === 'class'
                ? {
                      mode,
                      class: cls || (target.mode === 'class' ? target.class : '') || t('sheet.appetite.classDefault'),
                  }
                : { mode },
        );

    const satisfiers = renderSatisfiers(b, appetite);
    const ruleOptions = [...ctx.view.card.rules, ...ctx.view.state.rules]
        .filter((rule, index, all) => all.findIndex((other) => other.id === rule.id) === index)
        .map((rule) => ({ value: rule.id, label: rule.label || rule.holders }));

    return profileUnit(
        b,
        appetiteTitle(b, appetite),
        base,
        [
            row(
                t('sheet.appetite.kind'),
                selectCtl(
                    b,
                    p('kind'),
                    t('sheet.appetite.kind'),
                    APPETITE_KINDS.map((kind) => ({ value: kind, label: appetiteKindLabel(kind, lang) })),
                ),
            ),
            row(
                t('sheet.appetite.label'),
                textCtl(b, p('label'), t('sheet.appetite.label'), { optional: true, max: LIMITS.name }),
            ),
            row(
                t('sheet.appetite.sources'),
                chipsCtl(
                    b,
                    p('sources'),
                    t('sheet.appetite.sources'),
                    SOURCES.map((source) => ({
                        value: source,
                        label: appetiteSourceLabel(source, lang, profile.gender),
                    })),
                    undefined,
                    ['individual'],
                ),
            ),
            row(
                t('sheet.appetite.target'),
                keyed(
                    select({
                        value: target.mode,
                        options: (['thing', 'class', 'player'] as const).map((mode) => ({
                            value: mode,
                            label: t(`sheet.target.${mode}`),
                        })),
                        label: t('sheet.appetite.target'),
                        onChange: (mode) => setTarget(mode),
                    }),
                    b.key(p('target.mode')),
                ),
                t('sheet.appetite.targetHint'),
            ),
            target.mode === 'class'
                ? row(
                      t('sheet.appetite.targetClass'),
                      textInput({
                          value: target.class,
                          label: t('sheet.appetite.targetClass'),
                          key: b.key(p('target.class')),
                          onCommit: (value) => {
                              const cls = cleanText(value, LIMITS.name);
                              return cls ? setTarget('class', cls) : undefined;
                          },
                      }),
                  )
                : null,
            row(
                t('sheet.appetite.baseline'),
                rangeCtl(b, p('baseline'), t('sheet.appetite.baseline'), { min: 0, max: 5, words: w.baseline }),
            ),
            row(
                t('sheet.appetite.liking'),
                rangeCtl(b, p('liking'), t('sheet.appetite.liking'), { min: -2, max: 2, words: w.liking }),
            ),
            row(
                t('sheet.appetite.triggers'),
                listCtl(b, p('triggers'), t('sheet.appetite.triggers'), { max: LIMITS.triggers }),
            ),
            row(t('sheet.appetite.satisfiers'), satisfiers),
            row(
                t('sheet.appetite.drift'),
                selectCtl(
                    b,
                    p('drift'),
                    t('sheet.appetite.drift'),
                    (['daily', 'seasonal', 'opportunity', 'none'] as const).map((value) => ({
                        value,
                        label: t(`sheet.drift.${value}`),
                    })),
                ),
            ),
            row(
                t('sheet.appetite.tolerance'),
                rangeCtl(b, p('tolerance'), t('sheet.appetite.tolerance'), { min: 0, max: 3, words: w.three }),
            ),
            row(
                t('sheet.appetite.dependence'),
                rangeCtl(b, p('dependence'), t('sheet.appetite.dependence'), { min: 0, max: 3, words: w.three }),
            ),
            row(
                t('sheet.appetite.sensitization'),
                rangeCtl(b, p('sensitization'), t('sheet.appetite.sensitization'), { min: 0, max: 3, words: w.three }),
            ),
            row(
                t('sheet.appetite.endorsement'),
                selectCtl(
                    b,
                    p('endorsement'),
                    t('sheet.appetite.endorsement'),
                    (['proud', 'torn', 'fighting'] as const).map((value) => ({
                        value,
                        label: endorsementLabel(value, lang),
                    })),
                ),
            ),
            row(
                t('sheet.appetite.vow'),
                selectCtl(
                    b,
                    p('vow'),
                    t('sheet.appetite.vow'),
                    (['none', 'moderate', 'abstinent'] as const).map((value) => ({
                        value,
                        label: vowLabel(value, lang),
                    })),
                ),
            ),
            row(
                t('sheet.appetite.visibility'),
                selectCtl(
                    b,
                    p('visibility'),
                    t('sheet.appetite.visibility'),
                    (['open', 'hidden', 'secret'] as const).map((value) => ({
                        value,
                        label: visibilityLabel(value, lang),
                    })),
                ),
            ),
            row(
                t('sheet.appetite.style'),
                selectCtl(
                    b,
                    p('style'),
                    t('sheet.appetite.style'),
                    STYLES.map((style) => ({ value: style, label: styleLabel(style, lang) })),
                ),
                styleBehaviour(appetite.style, lang),
            ),
            row(
                t('sheet.appetite.onset'),
                selectCtl(
                    b,
                    p('affectionOnset'),
                    t('sheet.appetite.onset'),
                    (['never', 'rare', 'possible', 'common'] as const).map((value) => ({
                        value,
                        label: onsetLabel(value, lang),
                    })),
                ),
            ),
            row(
                t('sheet.appetite.excuse'),
                textCtl(b, p('excuse'), t('sheet.appetite.excuse'), { optional: true, max: LIMITS.short }),
            ),
            row(
                t('sheet.appetite.restraints'),
                listCtl(b, p('restraints'), t('sheet.appetite.restraints'), { max: LIMITS.restraints }),
            ),
            ruleOptions.length || appetite.rule
                ? row(
                      t('sheet.appetite.rule'),
                      selectCtl(
                          b,
                          p('rule'),
                          t('sheet.appetite.rule'),
                          appetite.rule && !ruleOptions.some((option) => option.value === appetite.rule)
                              ? [...ruleOptions, { value: appetite.rule, label: appetite.rule }]
                              : ruleOptions,
                          { none: t('sheet.none') },
                      ),
                  )
                : null,
        ],
        {
            className: 'dramatis-sheet-card',
            actions: [
                keyed(
                    button({
                        icon: 'fa-trash-can',
                        kind: 'ghost',
                        title: t('sheet.appetite.remove'),
                        onClick: async () => {
                            const sure = await ctx.app.ui.confirm(
                                t('sheet.appetite.removeTitle'),
                                t('sheet.appetite.removeBody', { name: appetiteTitle(b, appetite) }),
                            );
                            if (sure) await b.edit(base, undefined);
                        },
                    }),
                    b.key(`${base}:remove`),
                ),
            ],
        },
    );
}

function renderSatisfiers(b: ProfileBind, appetite: Appetite): HTMLElement {
    const t = b.ctx.t;
    const w = words(b.ctx);
    const path = `appetites.${appetite.id}.satisfiers`;
    const list = appetite.satisfiers;
    const save = (next: Satisfier[]) => b.edit(path, next.filter((item) => item.what).slice(0, LIMITS.satisfiers));
    const items = list.map((item, index) => {
        const patch = (change: Partial<Satisfier>) => {
            const next = list.map((other, i) => (i === index ? { ...other, ...change } : other));
            if (change.full === false) delete next[index]!.full;
            return save(next);
        };
        const full = el('input', { attrs: { type: 'checkbox', 'data-dramatis-key': b.key(`${path}.${index}.full`) } });
        full.checked = item.full === true;
        full.addEventListener('change', () => void patch({ full: full.checked }));
        return el('div', { class: 'dramatis-sheet-subitem' }, [
            textInput({
                value: item.what,
                label: t('sheet.satisfier.what'),
                key: b.key(`${path}.${index}.what`),
                onCommit: (value) => {
                    const what = cleanText(value, LIMITS.short);
                    return what ? patch({ what }) : save(list.filter((_, i) => i !== index));
                },
            }),
            el('div', { class: 'dramatis-sheet-inline' }, [
                el('span', { class: 'dramatis-muted', text: t('sheet.satisfier.amount') }),
                keyed(
                    select({
                        value: String(item.amount),
                        options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: w.amount(n) })),
                        label: t('sheet.satisfier.amount'),
                        onChange: (value) => patch({ amount: Number(value) }),
                    }),
                    b.key(`${path}.${index}.amount`),
                ),
                el('label', { class: 'checkbox_label dramatis-sheet-check', title: t('sheet.satisfier.fullHint') }, [
                    full,
                    el('span', { text: t('sheet.satisfier.full') }),
                ]),
                button({
                    icon: 'fa-xmark',
                    kind: 'ghost',
                    title: t('sheet.list.remove'),
                    onClick: () => save(list.filter((_, i) => i !== index)),
                }),
            ]),
        ]);
    });
    const add =
        list.length < LIMITS.satisfiers
            ? textInput({
                  value: '',
                  label: t('sheet.satisfier.add'),
                  placeholder: t('sheet.satisfier.add'),
                  key: b.key(`${path}.new`),
                  onCommit: (value) => {
                      const what = cleanText(value, LIMITS.short);
                      return what ? save([...list, { what, amount: 2 }]) : undefined;
                  },
              })
            : null;
    return el('div', { class: 'dramatis-sheet-sublist' }, [...items, add]);
}

function addAppetite(b: ProfileBind): HTMLElement {
    const { ctx, profile } = b;
    const t = ctx.t;
    let kind: AppetiteKind = 'drink';
    const kinds = select({
        value: kind,
        options: APPETITE_KINDS.map((value) => ({ value, label: appetiteKindLabel(value, ctx.lang) })),
        label: t('sheet.appetite.kind'),
        onChange: (value) => {
            kind = value;
        },
    });
    const strength = numberField({
        value: 2,
        min: 0,
        max: 5,
        label: t('sheet.appetite.baseline'),
        onCommit: () => undefined,
    });
    return el('div', { class: 'dramatis-sheet-add' }, [
        keyed(kinds, b.key('appetites:new-kind')),
        keyed(strength, b.key('appetites:new-baseline')),
        keyed(
            button({
                icon: 'fa-plus',
                label: t('sheet.appetite.add'),
                onClick: () => {
                    const taken = profile.appetites.map((item) => item.id);
                    const appetite = normalizeAppetite(
                        { kind, id: kind, baseline: Number(strength.value) || 0, sources: ['individual'] },
                        taken,
                    );
                    if (!appetite) return;
                    return b.edit(`appetites.${appetite.id}`, appetite);
                },
            }),
            b.key('appetites:add'),
        ),
    ]);
}
