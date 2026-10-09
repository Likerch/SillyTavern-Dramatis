// World pages of the sheet: group and world appetite rules (card and this chat), the player's reputation (seeds from
// the card, live reputation of this chat with his weaknesses) and the author's invariants (docs/model.md §4.5, §7, §11).
import { APPETITE_KINDS, STYLES } from '../../domain/model';
import type { AppetiteKind, AppetiteRule, Reputation, ReputationSeed, Stance } from '../../domain/model';
import { appetiteKindLabel, appetiteSourceLabel, onsetLabel, styleBehaviour, styleLabel } from '../../domain/ladders';
import { LIMITS, cleanList, cleanText, normalizeIntensity, normalizeRule, slugId } from '../../domain/profile-defaults';
import { select } from '../../ui/controls';
import { button, el } from '../../ui/dom';
import { listEditor, numberField, rangeInput, textInput } from '../../ui/form';
import { editCard, removeCardRule, removeChatRule, saveCardRule, saveChatRule, toggleCardLock } from './edits';
import { backButton } from './page';
import { emptyState, heading, keyed, row, stanceOptions, unitBlock } from './parts';
import type { SheetCtx } from './types';
import { words } from './words';

const SHARES = ['zero', 'low', 'mid', 'high'] as const;
type Share = (typeof SHARES)[number];

/** Percent shares of a rule (rounded to 0.1). */
function percents(intensity: AppetiteRule['intensity']): Record<Share, number> {
    const out = {} as Record<Share, number>;
    for (const share of SHARES) out[share] = Math.round(intensity[share] * 1000) / 10;
    return out;
}

function sumOf(shares: Record<string, number>): number {
    return Math.round(SHARES.reduce((sum, share) => sum + (shares[share] ?? 0), 0) * 10) / 10;
}

/** Shares within half a percent of 100 count as whole. */
export function sharesWhole(shares: Record<string, number>): boolean {
    return Math.abs(sumOf(shares) - 100) <= 0.5;
}

interface RuleScope {
    scope: 'card' | 'chat';
    save(rule: AppetiteRule): Promise<void>;
    remove(): Promise<void>;
    /** Card rules: copy into this chat. */
    toChat?: () => Promise<void>;
}

/** The editor of one appetite rule; the intensity shares must add up to 100 % before they are saved. */
export function ruleEditor(ctx: SheetCtx, rule: AppetiteRule, scope: RuleScope): HTMLElement {
    const t = ctx.t;
    const lang = ctx.lang;
    const w = words(ctx);
    const prefix = `${scope.scope}:rule:${rule.id}`;
    const k = (field: string) => `${prefix}.${field}`;
    const patch = (change: Partial<AppetiteRule>) => scope.save({ ...rule, ...change });

    /* intensity shares with the sum check */
    const draft = ctx.session.drafts.get(prefix) ?? percents(rule.intensity);
    const sum = sumOf(draft);
    const commitShares = (shares: Record<string, number>) => {
        if (!sharesWhole(shares)) {
            ctx.session.drafts.set(prefix, shares);
            ctx.rerender();
            return Promise.resolve();
        }
        ctx.session.drafts.delete(prefix);
        return patch({ intensity: normalizeIntensity(shares) });
    };
    const shareInputs = SHARES.map((share) =>
        el('label', { class: 'dramatis-sheet-share' }, [
            el('span', { class: 'dramatis-muted', text: t(`sheet.rule.share.${share}`) }),
            numberField({
                value: draft[share] ?? 0,
                min: 0,
                max: 100,
                step: 1,
                label: t(`sheet.rule.share.${share}`),
                key: k(`intensity.${share}`),
                onCommit: (value) => commitShares({ ...draft, [share]: value ?? 0 }),
            }),
        ]),
    );
    const whole = sharesWhole(draft);
    const intensity = el('div', { class: 'dramatis-sheet-shares' }, [
        el('div', { class: 'dramatis-sheet-inline' }, shareInputs),
        el('div', {
            class: whole ? 'dramatis-muted' : 'dramatis-error-text dramatis-sheet-sum-error',
            attrs: { role: whole ? null : 'alert' },
            text: whole ? t('sheet.rule.sum', { sum }) : t('sheet.rule.sumOff', { sum }),
        }),
        whole
            ? null
            : el('div', { class: 'dramatis-sheet-inline' }, [
                  keyed(
                      button({
                          icon: 'fa-scale-balanced',
                          label: t('sheet.rule.normalize'),
                          className: 'dramatis-sheet-normalize',
                          onClick: () => {
                              ctx.session.drafts.delete(prefix);
                              return patch({ intensity: normalizeIntensity(draft) });
                          },
                      }),
                      k('normalize'),
                  ),
                  keyed(
                      button({
                          icon: 'fa-rotate-left',
                          label: t('sheet.rule.revert'),
                          kind: 'ghost',
                          onClick: () => {
                              ctx.session.drafts.delete(prefix);
                              ctx.rerender();
                          },
                      }),
                      k('revert'),
                  ),
              ]),
    ]);

    /* style weights */
    const styles = el(
        'div',
        { class: 'dramatis-sheet-styles' },
        STYLES.map((style) =>
            el('label', { class: 'dramatis-sheet-share', title: styleBehaviour(style, lang) }, [
                el('span', { class: 'dramatis-muted', text: styleLabel(style, lang) }),
                numberField({
                    value: rule.styles[style] ?? 0,
                    min: 0,
                    max: 10,
                    label: styleLabel(style, lang),
                    key: k(`styles.${style}`),
                    onCommit: (value) => {
                        const next = { ...rule.styles };
                        if (value) next[style] = value;
                        else delete next[style];
                        return patch({ styles: next });
                    },
                }),
            ]),
        ),
    );

    const target = rule.target;
    const choice = <T extends string>(
        field: string,
        value: T,
        options: { value: T; label: string }[],
        label: string,
        onChange: (value: T) => Promise<void>,
    ) => row(label, keyed(select({ value, options, label, onChange }), k(field)));

    const body = [
        row(
            t('sheet.rule.holders'),
            textInput({
                value: rule.holders,
                label: t('sheet.rule.holders'),
                key: k('holders'),
                onCommit: (value) => {
                    const holders = cleanText(value, LIMITS.name);
                    if (!holders) {
                        ctx.rerender();
                        return;
                    }
                    return patch({ holders });
                },
            }),
            t('sheet.rule.holdersHint'),
        ),
        choice(
            'kind',
            rule.kind,
            APPETITE_KINDS.map((kind) => ({ value: kind, label: appetiteKindLabel(kind, lang) })),
            t('sheet.appetite.kind'),
            (kind) => patch({ kind }),
        ),
        row(
            t('sheet.appetite.label'),
            textInput({
                value: rule.label ?? '',
                label: t('sheet.appetite.label'),
                key: k('label'),
                onCommit: (value) => {
                    const label = cleanText(value, LIMITS.name);
                    const next = { ...rule };
                    if (label) next.label = label;
                    else delete next.label;
                    return scope.save(next);
                },
            }),
        ),
        choice(
            'source',
            rule.source,
            (['species', 'culture', 'situation', 'world'] as const).map((source) => ({
                value: source,
                label: appetiteSourceLabel(source, lang),
            })),
            t('sheet.rule.source'),
            (source) => patch({ source }),
        ),
        choice(
            'target',
            target.mode,
            (['class', 'player', 'thing'] as const).map((mode) => ({ value: mode, label: t(`sheet.target.${mode}`) })),
            t('sheet.appetite.target'),
            (mode) =>
                patch({
                    target:
                        mode === 'class'
                            ? { mode, class: target.mode === 'class' ? target.class : rule.holders }
                            : { mode },
                }),
        ),
        target.mode === 'class'
            ? row(
                  t('sheet.appetite.targetClass'),
                  textInput({
                      value: target.class,
                      label: t('sheet.appetite.targetClass'),
                      key: k('target.class'),
                      onCommit: (value) => {
                          const cls = cleanText(value, LIMITS.name);
                          return cls ? patch({ target: { mode: 'class', class: cls } }) : undefined;
                      },
                  }),
                  t('sheet.rule.classHint'),
              )
            : target.mode === 'player'
              ? el('div', { class: 'dramatis-field-hint', text: t('sheet.rule.playerHint') })
              : null,
        row(t('sheet.rule.intensity'), intensity, t('sheet.rule.intensityHint')),
        row(t('sheet.rule.styles'), styles, t('sheet.rule.stylesHint')),
        row(
            t('sheet.rule.choosiness'),
            rangeInput({
                value: rule.choosiness,
                min: 0,
                max: 5,
                label: t('sheet.rule.choosiness'),
                words: w.choosiness,
                key: k('choosiness'),
                onCommit: (choosiness) => patch({ choosiness }),
            }),
        ),
        choice(
            'exclusivity',
            rule.exclusivity,
            (['exclusive', 'shared', 'harem'] as const).map((value) => ({
                value,
                label: t(`sheet.rule.exclusivity.${value}`),
            })),
            t('sheet.rule.exclusivity'),
            (exclusivity) => patch({ exclusivity }),
        ),
        choice(
            'onset',
            rule.affectionOnset,
            (['never', 'rare', 'possible', 'common'] as const).map((value) => ({
                value,
                label: onsetLabel(value, lang),
            })),
            t('sheet.appetite.onset'),
            (affectionOnset) => patch({ affectionOnset }),
        ),
        choice(
            'groupMode',
            rule.groupMode,
            (['solitary', 'pack', 'tribe'] as const).map((value) => ({
                value,
                label: t(`sheet.rule.groupMode.${value}`),
            })),
            t('sheet.rule.groupMode'),
            (groupMode) => patch({ groupMode }),
        ),
        scope.scope === 'chat' && rule.evidence?.length
            ? el(
                  'ul',
                  { class: 'dramatis-sheet-quotes' },
                  rule.evidence.map((quote) => el('li', { text: `«${quote}»` })),
              )
            : null,
    ];

    const actions = [
        scope.toChat
            ? keyed(
                  button({
                      icon: 'fa-arrow-right-to-bracket',
                      kind: 'ghost',
                      title: t('sheet.rule.toChat'),
                      onClick: () => scope.toChat!(),
                  }),
                  k('toChat'),
              )
            : null,
        keyed(
            button({
                icon: 'fa-trash-can',
                kind: 'ghost',
                title: t('sheet.rule.remove'),
                onClick: async () => {
                    const sure = await ctx.app.ui.confirm(
                        t('sheet.rule.removeTitle'),
                        t('sheet.rule.removeBody', { name: rule.label || rule.holders }),
                    );
                    if (sure) await scope.remove();
                },
            }),
            k('remove'),
        ),
    ];
    const title = rule.label ? `${rule.label} — ${rule.holders}` : rule.holders;
    if (scope.scope === 'card') {
        const unit = `rules.${rule.id}`;
        return unitBlock(
            ctx,
            {
                title,
                holder: ctx.view.card,
                unit,
                keyPrefix: 'card',
                onLock: () => ctx.save(toggleCardLock(ctx.engine, unit)),
                actions,
                className: 'dramatis-sheet-card',
            },
            body,
        );
    }
    return el('div', { class: ['dramatis-sheet-unit', 'dramatis-sheet-card'], data: { rule: rule.id } }, [
        el('div', { class: 'dramatis-sheet-unit-head' }, [
            el('div', { class: 'dramatis-sheet-unit-title', text: title }),
            el('span', { class: 'dramatis-sheet-unit-actions' }, actions),
        ]),
        el('div', { class: 'dramatis-sheet-unit-body' }, body),
    ]);
}

function addRuleForm(
    ctx: SheetCtx,
    scope: 'card' | 'chat',
    taken: string[],
    save: (rule: AppetiteRule) => Promise<void>,
): HTMLElement {
    const t = ctx.t;
    let kind: AppetiteKind = 'flesh';
    const holders = textInput({
        value: '',
        label: t('sheet.rule.holders'),
        placeholder: t('sheet.rule.holders'),
        key: `${scope}:rule:new.holders`,
        onCommit: () => undefined,
    });
    const kinds = keyed(
        select({
            value: kind,
            options: APPETITE_KINDS.map((value) => ({ value, label: appetiteKindLabel(value, ctx.lang) })),
            label: t('sheet.appetite.kind'),
            onChange: (value) => {
                kind = value;
            },
        }),
        `${scope}:rule:new.kind`,
    );
    return el('div', { class: 'dramatis-sheet-add' }, [
        holders,
        kinds,
        keyed(
            button({
                icon: 'fa-plus',
                label: t('sheet.rule.add'),
                onClick: () => {
                    const name = cleanText(holders.value, LIMITS.name);
                    if (!name) {
                        holders.focus();
                        return;
                    }
                    const rule = normalizeRule(
                        {
                            id: slugId(`${name} ${kind}`, taken),
                            holders: name,
                            kind,
                            target: { mode: 'class', class: name },
                        },
                        taken,
                    );
                    return rule ? save(rule) : undefined;
                },
            }),
            `${scope}:rule:new.add`,
        ),
    ]);
}

export function renderRules(ctx: SheetCtx): HTMLElement[] {
    const t = ctx.t;
    const { card, state } = ctx.view;
    const out: HTMLElement[] = [
        backButton(ctx),
        el('h3', { class: 'dramatis-sheet-title', text: t('sheet.rules.title') }),
    ];
    out.push(el('p', { class: 'dramatis-field-hint', text: t('sheet.rules.hint') }));

    out.push(heading(t('sheet.rules.card')));
    if (!card.rules.length) out.push(emptyState(t('sheet.rules.none')));
    for (const rule of card.rules) {
        out.push(
            ruleEditor(ctx, rule, {
                scope: 'card',
                save: (next) => ctx.save(saveCardRule(ctx.engine, next)),
                remove: () => ctx.save(removeCardRule(ctx.engine, rule.id)),
                toChat: () => ctx.save(saveChatRule(ctx.engine, structuredClone(rule))),
            }),
        );
    }
    out.push(
        addRuleForm(
            ctx,
            'card',
            card.rules.map((rule) => rule.id),
            (rule) => ctx.save(saveCardRule(ctx.engine, rule)),
        ),
    );

    out.push(heading(t('sheet.rules.chat')));
    if (!state.rules.length) out.push(emptyState(t('sheet.rules.noneChat')));
    for (const rule of state.rules) {
        out.push(
            ruleEditor(ctx, rule, {
                scope: 'chat',
                save: (next) => ctx.save(saveChatRule(ctx.engine, next)),
                remove: () => ctx.save(removeChatRule(ctx.engine, rule.id)),
            }),
        );
    }
    out.push(
        addRuleForm(
            ctx,
            'chat',
            state.rules.map((rule) => rule.id),
            (rule) => ctx.save(saveChatRule(ctx.engine, rule)),
        ),
    );
    return out;
}

/* ------------------------------------------------------------------ reputation */

export function renderReputation(ctx: SheetCtx): HTMLElement[] {
    const t = ctx.t;
    const { card, state } = ctx.view;
    const out: HTMLElement[] = [
        backButton(ctx),
        el('h3', { class: 'dramatis-sheet-title', text: t('sheet.reputation.title') }),
    ];
    out.push(
        el('p', { class: 'dramatis-field-hint', text: t('sheet.reputation.hint', { name: ctx.view.playerName }) }),
    );

    /* seeds of the card */
    const seeds = card.reputation;
    const saveSeeds = (next: ReputationSeed[]) => ctx.save(editCard(ctx.engine, 'reputation', () => next));
    const seedRows = seeds.map((seed, index) => {
        const patch = (change: Partial<ReputationSeed>) =>
            saveSeeds(seeds.map((item, i) => (i === index ? { ...item, ...change } : item)));
        const k = (field: string) => `card:reputation.${index}.${field}`;
        return el('div', { class: 'dramatis-sheet-item' }, [
            row(
                t('sheet.reputation.among'),
                textInput({
                    value: seed.among,
                    label: t('sheet.reputation.among'),
                    key: k('among'),
                    onCommit: (value) => patch({ among: cleanText(value, LIMITS.name) || '*' }),
                }),
                t('sheet.reputation.amongHint'),
            ),
            row(
                t('sheet.reputation.label'),
                textInput({
                    value: seed.label,
                    label: t('sheet.reputation.label'),
                    key: k('label'),
                    onCommit: (value) => {
                        const label = cleanText(value, LIMITS.short);
                        return label ? patch({ label }) : saveSeeds(seeds.filter((_, i) => i !== index));
                    },
                }),
            ),
            row(
                t('sheet.reputation.stance'),
                keyed(
                    select({
                        value: String(seed.stance),
                        options: stanceOptions(ctx),
                        label: t('sheet.reputation.stance'),
                        onChange: (value) => patch({ stance: Number(value) as Stance }),
                    }),
                    k('stance'),
                ),
            ),
            row(
                t('sheet.starts.greeting'),
                numberField({
                    value: seed.greeting,
                    min: -1,
                    max: 999,
                    label: t('sheet.starts.greeting'),
                    key: k('greeting'),
                    onCommit: (value) => patch({ greeting: value ?? -1 }),
                }),
            ),
            seed.evidence?.length
                ? el(
                      'ul',
                      { class: 'dramatis-sheet-quotes' },
                      seed.evidence.map((quote) => el('li', { text: `«${quote}»` })),
                  )
                : null,
            button({
                icon: 'fa-trash-can',
                kind: 'ghost',
                label: t('sheet.remove'),
                onClick: () => saveSeeds(seeds.filter((_, i) => i !== index)),
            }),
        ]);
    });
    const addSeed = textInput({
        value: '',
        label: t('sheet.reputation.addSeed'),
        placeholder: t('sheet.reputation.addSeed'),
        key: 'card:reputation.new',
        onCommit: (value) => {
            const label = cleanText(value, LIMITS.short);
            return label ? saveSeeds([...seeds, { among: '*', label, stance: 0, greeting: -1 }]) : undefined;
        },
    });
    out.push(
        unitBlock(
            ctx,
            {
                title: t('sheet.reputation.seeds'),
                holder: card,
                unit: 'reputation',
                keyPrefix: 'card',
                onLock: () => ctx.save(toggleCardLock(ctx.engine, 'reputation')),
                hint: t('sheet.reputation.seedsHint'),
            },
            [...(seedRows.length ? seedRows : [emptyState(t('sheet.reputation.noSeeds'))]), addSeed],
        ),
    );

    /* this chat */
    const live = state.reputation;
    const saveLive = (change: (list: Reputation[]) => Reputation[]) =>
        ctx.save(
            ctx.engine.updateState((current) => {
                current.reputation = change(current.reputation);
            }),
        );
    out.push(heading(t('sheet.reputation.live')));
    if (!live.length) out.push(emptyState(t('sheet.reputation.noLive')));
    live.forEach((item, index) => {
        const patch = (change: Partial<Reputation>) =>
            saveLive((list) => list.map((other, i) => (i === index ? { ...other, ...change } : other)));
        const k = (field: string) => `chat:reputation.${index}.${field}`;
        const list = (field: 'weaknesses' | 'reasons', label: string) =>
            row(
                label,
                listEditor({
                    items: item[field],
                    label,
                    addLabel: t('sheet.list.add'),
                    removeLabel: t('sheet.list.remove'),
                    max: 8,
                    key: k(field),
                    onCommit: (items) => patch({ [field]: cleanList(items, 8) }),
                }),
            );
        out.push(
            el('div', { class: ['dramatis-sheet-unit', 'dramatis-sheet-card'] }, [
                el('div', { class: 'dramatis-sheet-unit-head' }, [
                    el('div', {
                        class: 'dramatis-sheet-unit-title',
                        text: item.among === '*' ? t('sheet.reputation.everyone') : item.among,
                    }),
                    el('span', { class: 'dramatis-sheet-unit-actions' }, [
                        button({
                            icon: 'fa-trash-can',
                            kind: 'ghost',
                            title: t('sheet.remove'),
                            onClick: () => saveLive((list) => list.filter((_, i) => i !== index)),
                        }),
                    ]),
                ]),
                el('div', { class: 'dramatis-sheet-unit-body' }, [
                    row(
                        t('sheet.reputation.among'),
                        textInput({
                            value: item.among,
                            label: t('sheet.reputation.among'),
                            key: k('among'),
                            onCommit: (value) => patch({ among: cleanText(value, LIMITS.name) || '*' }),
                        }),
                    ),
                    row(
                        t('sheet.reputation.label'),
                        textInput({
                            value: item.label,
                            label: t('sheet.reputation.label'),
                            key: k('label'),
                            onCommit: (value) => patch({ label: cleanText(value, LIMITS.short) }),
                        }),
                    ),
                    row(
                        t('sheet.reputation.stance'),
                        keyed(
                            select({
                                value: String(item.stance),
                                options: stanceOptions(ctx),
                                label: t('sheet.reputation.stance'),
                                onChange: (value) => patch({ stance: Number(value) as Stance }),
                            }),
                            k('stance'),
                        ),
                    ),
                    list('weaknesses', t('sheet.reputation.weaknesses')),
                    list('reasons', t('sheet.reputation.reasons')),
                    item.progress
                        ? el('div', {
                              class: 'dramatis-muted',
                              text: t(
                                  item.progress.dir > 0
                                      ? 'sheet.reputation.progressUp'
                                      : 'sheet.reputation.progressDown',
                                  {
                                      n: item.progress.events,
                                  },
                              ),
                          })
                        : null,
                ]),
            ]),
        );
    });
    out.push(
        el('div', { class: 'dramatis-sheet-add' }, [
            textInput({
                value: '',
                label: t('sheet.reputation.addLive'),
                placeholder: t('sheet.reputation.addLive'),
                key: 'chat:reputation.new',
                onCommit: (value) => {
                    const among = cleanText(value, LIMITS.name);
                    return among
                        ? saveLive((list) => [...list, { among, label: '', stance: 0, weaknesses: [], reasons: [] }])
                        : undefined;
                },
            }),
        ]),
    );
    return out;
}

/* ------------------------------------------------------------------ invariants */

export function renderInvariants(ctx: SheetCtx): HTMLElement[] {
    const t = ctx.t;
    const card = ctx.view.card;
    return [
        backButton(ctx),
        el('h3', { class: 'dramatis-sheet-title', text: t('sheet.invariants.title') }),
        unitBlock(
            ctx,
            {
                title: t('sheet.invariants.list'),
                holder: card,
                unit: 'invariants',
                keyPrefix: 'card',
                onLock: () => ctx.save(toggleCardLock(ctx.engine, 'invariants')),
                hint: t('sheet.invariants.hint'),
            },
            [
                listEditor({
                    items: card.invariants,
                    label: t('sheet.invariants.list'),
                    addLabel: t('sheet.list.add'),
                    removeLabel: t('sheet.list.remove'),
                    max: 24,
                    multiline: true,
                    key: 'card:invariants',
                    onCommit: (items) =>
                        ctx.save(editCard(ctx.engine, 'invariants', () => cleanList(items, 24, LIMITS.text))),
                }),
            ],
        ),
    ];
}
