// «Связи»: how the character stands toward the player and everyone else (docs/model.md §4.3, §4.5). The base stance
// and its author reasons belong to the card; the current stance and its reasons to this chat (a decision of the user
// adds the reason «по твоему решению»). The other fields of a tie — evaluations, intent, debts, encounters, beliefs,
// desirability, gaze, claim — show the live value and an edit writes both the design and this chat.
import { CLAIMS } from '../../domain/rivalry';
import { GAZES, PLAYER_ID, TIE_INTENTS } from '../../domain/model';
import type { Belief, Claim, Gaze, Reason, Stance, Tie, TieIntent } from '../../domain/model';
import {
    claimLabel,
    gazeBehaviour,
    gazeLabel,
    stanceBehaviour,
    stanceLabel,
    tieIntentLabel,
} from '../../domain/ladders';
import { LIMITS, cleanList, cleanText, emptyTie, isDict } from '../../domain/profile-defaults';
import { select } from '../../ui/controls';
import { button, el } from '../../ui/dom';
import { listEditor, numberField, textInput } from '../../ui/form';
import { addTie, editTieField, isUserReason, nameOf, removeLiveReason, removeTie, setCurrentStance } from './edits';
import { emptyState, heading, keyed, originBadge, profileUnit, row, signed, stanceChip, stanceOptions } from './parts';
import type { ProfileBind } from './parts';
import { isCovertTie, spoiler } from './secrets';
import { words } from './words';

function tieOr(value: unknown, target: string): Tie {
    return isDict(value) && Array.isArray(value.reasons) ? (value as unknown as Tie) : emptyTie(target);
}

/** Targets in order: the player, then the cast in its order, then classes and others. */
function targetsOf(b: ProfileBind): string[] {
    const set = new Set<string>([...b.profile.ties.map((tie) => tie.target), ...Object.keys(b.live?.ties ?? {})]);
    const order = [PLAYER_ID, ...b.ctx.view.profiles.map((profile) => profile.id)];
    return [...set].sort((a, c) => {
        const ia = order.indexOf(a);
        const ic = order.indexOf(c);
        return (ia < 0 ? order.length : ia) - (ic < 0 ? order.length : ic) || a.localeCompare(c);
    });
}

export function renderTies(b: ProfileBind): HTMLElement[] {
    const t = b.ctx.t;
    const targets = targetsOf(b);
    const out: HTMLElement[] = [];
    if (!targets.length) out.push(emptyState(t('sheet.ties.none')));
    for (const target of targets) out.push(renderTie(b, target));
    if (targets.length < LIMITS.ties) out.push(renderAddTie(b, targets));
    return out;
}

function reasonLine(b: ProfileBind, reason: Reason, onRemove?: () => Promise<void>): HTMLElement {
    const t = b.ctx.t;
    const when =
        reason.scenesLeft === null ? t('sheet.reason.permanent') : t('sheet.reason.scenes', { n: reason.scenesLeft });
    return el('li', { class: 'dramatis-sheet-reason' }, [
        el('span', { class: 'dramatis-sheet-reason-delta', text: signed(reason.delta) }),
        el('span', { class: 'dramatis-sheet-reason-text', text: b.ctx.tr(reason.text) }),
        el('span', { class: 'dramatis-muted', text: reason.stacks > 1 ? `${when} · ×${reason.stacks}` : when }),
        isUserReason(reason) ? originBadge(b.ctx, 'user') : null,
        onRemove
            ? button({ icon: 'fa-xmark', kind: 'ghost', title: t('sheet.reason.remove'), onClick: () => onRemove() })
            : null,
    ]);
}

function renderTie(b: ProfileBind, target: string): HTMLElement {
    const { ctx, profile, live } = b;
    const t = ctx.t;
    const w = words(ctx);
    const id = profile.id;
    const base = profile.ties.find((tie) => tie.target === target);
    const current = live?.ties[target];
    const shown = current ?? base ?? emptyTie(target);
    const name = nameOf(ctx.view, target);
    const unit = `ties.${target}`;
    const setField = (field: keyof Tie, value: unknown) => ctx.save(editTieField(ctx.engine, id, target, field, value));

    /* the design: base stance and the author's reasons */
    const baseStance = base?.stance ?? 0;
    const baseReasons = base?.reasons ?? [];
    const saveBaseReasons = (reasons: Reason[]) =>
        b.update(unit, (tie) => ({ ...tieOr(tie, target), reasons: reasons.slice(0, LIMITS.reasons) }));
    const baseReasonRows = baseReasons.map((reason, index) => {
        const patch = (change: Partial<Reason>) =>
            saveBaseReasons(baseReasons.map((item, i) => (i === index ? { ...item, ...change } : item)));
        const permanent = el('input', {
            attrs: { type: 'checkbox', 'data-dramatis-key': b.key(`${unit}.reasons.${reason.id}.permanent`) },
        });
        permanent.checked = reason.scenesLeft === null;
        permanent.addEventListener('change', () => void patch({ scenesLeft: permanent.checked ? null : 3 }));
        return el('div', { class: 'dramatis-sheet-subitem' }, [
            textInput({
                value: reason.text,
                label: t('sheet.reason.text'),
                key: b.key(`${unit}.reasons.${reason.id}.text`),
                onCommit: (value) => {
                    const text = cleanText(value, LIMITS.short);
                    return text ? patch({ text }) : saveBaseReasons(baseReasons.filter((_, i) => i !== index));
                },
            }),
            el('div', { class: 'dramatis-sheet-inline' }, [
                el('span', { class: 'dramatis-muted', text: t('sheet.reason.delta') }),
                numberField({
                    value: reason.delta,
                    min: -3,
                    max: 3,
                    step: 0.5,
                    label: t('sheet.reason.delta'),
                    key: b.key(`${unit}.reasons.${reason.id}.delta`),
                    onCommit: (value) => patch({ delta: value ?? 0 }),
                }),
                el('label', { class: 'checkbox_label dramatis-sheet-check' }, [
                    permanent,
                    el('span', { text: t('sheet.reason.permanent') }),
                ]),
                reason.scenesLeft !== null
                    ? el('span', { class: 'dramatis-sheet-inline' }, [
                          el('span', { class: 'dramatis-muted', text: t('sheet.reason.scenesLeft') }),
                          numberField({
                              value: reason.scenesLeft,
                              min: 1,
                              max: 99,
                              label: t('sheet.reason.scenesLeft'),
                              key: b.key(`${unit}.reasons.${reason.id}.scenes`),
                              onCommit: (value) => patch({ scenesLeft: value ?? 1 }),
                          }),
                      ])
                    : null,
                button({
                    icon: 'fa-xmark',
                    kind: 'ghost',
                    title: t('sheet.reason.remove'),
                    onClick: () => saveBaseReasons(baseReasons.filter((_, i) => i !== index)),
                }),
            ]),
        ]);
    });
    const addBaseReason = textInput({
        value: '',
        label: t('sheet.reason.add'),
        placeholder: t('sheet.reason.add'),
        key: b.key(`${unit}.reasons.new`),
        onCommit: (value) => {
            const text = cleanText(value, LIMITS.short);
            if (!text) return;
            const taken = baseReasons.map((reason) => reason.id);
            let n = taken.length + 1;
            while (taken.includes(`author-${n}`) || taken.includes(`r${n}`)) n++;
            return saveBaseReasons([...baseReasons, { id: `r${n}`, text, delta: 0, scenesLeft: null, stacks: 1 }]);
        },
    });

    /* this chat: the current stance and its reasons */
    const currentStance = current?.stance ?? baseStance;
    const nowBlock = live
        ? el('div', { class: 'dramatis-sheet-now' }, [
              row(
                  t('sheet.ties.current'),
                  keyed(
                      select({
                          value: String(currentStance),
                          options: stanceOptions(ctx, profile.gender),
                          label: t('sheet.ties.current'),
                          onChange: (value) => {
                              const stance = Number(value) as Stance;
                              const text = t('sheet.log.stance', {
                                  name: profile.name,
                                  target: name,
                                  from: stanceLabel(currentStance, ctx.lang, profile.gender),
                                  to: stanceLabel(stance, ctx.lang, profile.gender),
                              });
                              return ctx.save(
                                  setCurrentStance(ctx.engine, id, target, stance, t('sheet.reason.user'), text),
                              );
                          },
                      }),
                      b.key(`${unit}:current`),
                  ),
                  stanceBehaviour(currentStance, ctx.lang),
              ),
              current?.reasons.length
                  ? el(
                        'ul',
                        { class: 'dramatis-sheet-reasons', attrs: { 'aria-label': t('sheet.ties.currentReasons') } },
                        current.reasons.map((reason) =>
                            reasonLine(b, reason, () => ctx.save(removeLiveReason(ctx.engine, id, target, reason.id))),
                        ),
                    )
                  : el('div', { class: 'dramatis-muted', text: t('sheet.ties.noReasons') }),
          ])
        : null;

    /* fields kept by both */
    const listField = (field: 'evaluations' | 'debts' | 'encounters', label: string) =>
        row(
            label,
            listEditor({
                items: shown[field],
                label,
                addLabel: t('sheet.list.add'),
                removeLabel: t('sheet.list.remove'),
                max: LIMITS.evaluations,
                key: b.key(`${unit}.${field}`),
                onCommit: (items) => setField(field, cleanList(items, LIMITS.evaluations)),
            }),
        );
    const intentRow = row(
        t('sheet.ties.intent'),
        keyed(
            select({
                value: shown.intent,
                options: TIE_INTENTS.map((intent) => ({ value: intent, label: tieIntentLabel(intent, ctx.lang) })),
                label: t('sheet.ties.intent'),
                onChange: (intent: TieIntent) => setField('intent', intent),
            }),
            b.key(`${unit}.intent`),
        ),
    );
    const intent = isCovertTie(shown) ? spoiler(ctx, `${id}:${unit}.intent`, () => intentRow) : intentRow;
    const appetiteOptions = profile.appetites.map((appetite) => ({
        value: appetite.id,
        label: appetite.label || appetite.kind,
    }));

    // Inner axes −100…100 (optional detail): the stance is derived from them under the inertia rules.
    const axes = shown.axes ?? { affection: 0, trust: 0, respect: 0, fear: 0 };
    const axesRow = row(
        t('sheet.ties.axes'),
        el(
            'div',
            { class: 'dramatis-sheet-inline' },
            (['affection', 'trust', 'respect', 'fear'] as const).map((axis) =>
                el('label', { class: 'dramatis-sheet-share' }, [
                    el('span', { class: 'dramatis-muted', text: t(`sheet.ties.axis.${axis}`) }),
                    numberField({
                        value: axes[axis],
                        min: -100,
                        max: 100,
                        step: 5,
                        label: t(`sheet.ties.axis.${axis}`),
                        key: b.key(`${unit}.axes.${axis}`),
                        onCommit: (value) => setField('axes', { ...axes, [axis]: value ?? 0 }),
                    }),
                ]),
            ),
        ),
        t('sheet.ties.axesHint'),
    );

    const stanceNote = el('div', { class: 'dramatis-sheet-inline' }, [
        el('span', { class: 'dramatis-muted', text: t('sheet.ties.now') }),
        stanceChip(ctx, currentStance, profile.gender),
    ]);

    return profileUnit(
        b,
        target === PLAYER_ID ? t('sheet.ties.player', { name }) : name,
        unit,
        [
            stanceNote,
            heading(t('sheet.ties.design')),
            row(
                t('sheet.ties.base'),
                keyed(
                    select({
                        value: String(baseStance),
                        options: stanceOptions(ctx, profile.gender),
                        label: t('sheet.ties.base'),
                        onChange: (value) =>
                            b.update(unit, (tie) => ({ ...tieOr(tie, target), stance: Number(value) as Stance })),
                    }),
                    b.key(`${unit}.stance`),
                ),
                stanceBehaviour(baseStance, ctx.lang),
            ),
            row(
                t('sheet.ties.baseReasons'),
                el('div', { class: 'dramatis-sheet-sublist' }, [...baseReasonRows, addBaseReason]),
            ),
            live ? heading(t('sheet.ties.chat')) : null,
            nowBlock,
            heading(t('sheet.ties.more')),
            axesRow,
            row(
                t('sheet.ties.behaviour'),
                textInput({
                    value: shown.behaviour ?? '',
                    label: t('sheet.ties.behaviour'),
                    multiline: true,
                    key: b.key(`${unit}.behaviour`),
                    onCommit: (value) => setField('behaviour', cleanText(value, LIMITS.short) || undefined),
                }),
            ),
            intent,
            listField('evaluations', t('sheet.ties.evaluations')),
            listField('debts', t('sheet.ties.debts')),
            listField('encounters', t('sheet.ties.encounters')),
            row(t('sheet.ties.beliefs'), renderBeliefs(b, target, shown.beliefs, setField)),
            row(
                t('sheet.ties.want'),
                keyed(
                    select({
                        value: shown.want === undefined ? '' : String(shown.want),
                        options: [
                            { value: '', label: t('sheet.none') },
                            ...[0, 1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} — ${w.want(n)}` })),
                        ],
                        label: t('sheet.ties.want'),
                        onChange: (value) => setField('want', value === '' ? undefined : Number(value)),
                    }),
                    b.key(`${unit}.want`),
                ),
                t('sheet.ties.wantHint'),
            ),
            row(
                t('sheet.ties.gaze'),
                keyed(
                    select({
                        value: shown.gaze ?? '',
                        options: [
                            { value: '', label: t('sheet.none') },
                            ...GAZES.map((gaze) => ({ value: gaze, label: gazeLabel(gaze, ctx.lang) })),
                        ],
                        label: t('sheet.ties.gaze'),
                        onChange: (value) => setField('gaze', (value || undefined) as Gaze | undefined),
                    }),
                    b.key(`${unit}.gaze`),
                ),
                shown.gaze ? gazeBehaviour(shown.gaze, ctx.lang) : undefined,
            ),
            row(
                t('sheet.ties.claim'),
                keyed(
                    select({
                        value: shown.claim ?? '',
                        options: [
                            { value: '', label: t('sheet.none') },
                            ...CLAIMS.map((claim) => ({ value: claim, label: claimLabel(claim, ctx.lang) })),
                        ],
                        label: t('sheet.ties.claim'),
                        onChange: (value) => setField('claim', (value || undefined) as Claim | undefined),
                    }),
                    b.key(`${unit}.claim`),
                ),
            ),
            appetiteOptions.length || shown.appetite
                ? row(
                      t('sheet.ties.appetite'),
                      keyed(
                          select({
                              value: shown.appetite ?? '',
                              options: [{ value: '', label: t('sheet.none') }, ...appetiteOptions],
                              label: t('sheet.ties.appetite'),
                              onChange: (value) => setField('appetite', value || undefined),
                          }),
                          b.key(`${unit}.appetite`),
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
                        title: t('sheet.ties.remove'),
                        onClick: async () => {
                            const sure = await ctx.app.ui.confirm(
                                t('sheet.ties.removeTitle'),
                                t('sheet.ties.removeBody', { name: profile.name, target: name }),
                            );
                            if (sure) await ctx.save(removeTie(ctx.engine, id, target));
                        },
                    }),
                    b.key(`${unit}:remove`),
                ),
            ],
        },
    );
}

function renderBeliefs(
    b: ProfileBind,
    target: string,
    beliefs: Belief[],
    setField: (field: keyof Tie, value: unknown) => Promise<void>,
): HTMLElement {
    const t = b.ctx.t;
    const key = `ties.${target}.beliefs`;
    const save = (next: Belief[]) => setField('beliefs', next.slice(0, LIMITS.beliefs));
    const rows = beliefs.map((belief, index) => {
        const patch = (change: Partial<Belief>) => {
            const merged = { ...belief, ...change };
            if (!merged.false) delete merged.false;
            if (!merged.from) delete merged.from;
            return save(beliefs.map((item, i) => (i === index ? merged : item)));
        };
        const isFalse = el('input', {
            attrs: { type: 'checkbox', 'data-dramatis-key': b.key(`${key}.${index}.false`) },
        });
        isFalse.checked = belief.false === true;
        isFalse.addEventListener('change', () => void patch({ false: isFalse.checked }));
        return el('div', { class: 'dramatis-sheet-subitem' }, [
            textInput({
                value: belief.claim,
                label: t('sheet.belief.claim'),
                key: b.key(`${key}.${index}.claim`),
                onCommit: (value) => {
                    const claim = cleanText(value, LIMITS.short);
                    return claim ? patch({ claim }) : save(beliefs.filter((_, i) => i !== index));
                },
            }),
            el('div', { class: 'dramatis-sheet-inline' }, [
                keyed(
                    select({
                        value: belief.source,
                        options: (['saw', 'heard', 'assumed'] as const).map((source) => ({
                            value: source,
                            label: t(`sheet.belief.${source}`),
                        })),
                        label: t('sheet.belief.source'),
                        onChange: (source) => patch({ source }),
                    }),
                    b.key(`${key}.${index}.source`),
                ),
                textInput({
                    value: belief.from ? nameOf(b.ctx.view, belief.from) : '',
                    label: t('sheet.belief.from'),
                    placeholder: t('sheet.belief.from'),
                    key: b.key(`${key}.${index}.from`),
                    onCommit: (value) => {
                        const from = cleanText(value, LIMITS.name);
                        return patch({ from: from ? (b.ctx.engine.resolve(from) ?? from) : undefined });
                    },
                }),
                el('span', { class: 'dramatis-muted', text: t('sheet.belief.confidence') }),
                numberField({
                    value: Math.round(belief.confidence * 100),
                    min: 0,
                    max: 100,
                    step: 5,
                    label: t('sheet.belief.confidence'),
                    key: b.key(`${key}.${index}.confidence`),
                    onCommit: (value) => patch({ confidence: (value ?? 50) / 100 }),
                }),
                el('label', { class: 'checkbox_label dramatis-sheet-check' }, [
                    isFalse,
                    el('span', { text: t('sheet.belief.false') }),
                ]),
                button({
                    icon: 'fa-xmark',
                    kind: 'ghost',
                    title: t('sheet.list.remove'),
                    onClick: () => save(beliefs.filter((_, i) => i !== index)),
                }),
            ]),
        ]);
    });
    const add =
        beliefs.length < LIMITS.beliefs
            ? textInput({
                  value: '',
                  label: t('sheet.belief.add'),
                  placeholder: t('sheet.belief.add'),
                  key: b.key(`${key}.new`),
                  onCommit: (value) => {
                      const claim = cleanText(value, LIMITS.short);
                      return claim ? save([...beliefs, { claim, source: 'assumed', confidence: 0.5 }]) : undefined;
                  },
              })
            : null;
    return el('div', { class: 'dramatis-sheet-sublist' }, [...rows, add]);
}

function renderAddTie(b: ProfileBind, taken: string[]): HTMLElement {
    const { ctx, profile } = b;
    const t = ctx.t;
    const choices = [
        { value: PLAYER_ID, label: ctx.view.playerName },
        ...ctx.view.profiles
            .filter((other) => other.id !== profile.id)
            .map((other) => ({
                value: other.id,
                label: other.name,
            })),
    ].filter((choice) => !taken.includes(choice.value));
    const add = (target: string) => ctx.save(addTie(ctx.engine, profile.id, target));
    return el('div', { class: 'dramatis-sheet-add' }, [
        el('span', { class: 'dramatis-muted', text: t('sheet.ties.add') }),
        choices.length
            ? keyed(
                  select({
                      value: '',
                      options: [{ value: '', label: t('sheet.ties.pick') }, ...choices],
                      label: t('sheet.ties.pick'),
                      onChange: (value) => (value ? add(value) : undefined),
                  }),
                  b.key('ties:add'),
              )
            : null,
        textInput({
            value: '',
            label: t('sheet.ties.class'),
            placeholder: t('sheet.ties.class'),
            key: b.key('ties:add-class'),
            onCommit: (value) => {
                const name = cleanText(value, LIMITS.name).replace(/\./g, '');
                if (!name) return;
                const target = ctx.engine.resolve(name) ?? name;
                if (target === profile.id || taken.includes(target)) return;
                return add(target);
            },
        }),
    ]);
}
