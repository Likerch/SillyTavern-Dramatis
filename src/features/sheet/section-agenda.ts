// «Повестка»: dream, goals (GMC), intentions with clocks, the front with its doom, resources, leverage, secrets and
// where the character starts in each greeting (docs/model.md §4.2, §11). Secrets, the doom and hidden intentions go
// under the spoiler lever.
import type { CharacterProfile, Clock, Front, Goal, Intention } from '../../domain/model';
import { LIMITS, cleanList, cleanText } from '../../domain/profile-defaults';
import { select } from '../../ui/controls';
import { button, el } from '../../ui/dom';
import { listEditor, numberField, textInput } from '../../ui/form';
import { heading, keyed, listCtl, profileUnit, row, textCtl } from './parts';
import type { ProfileBind } from './parts';
import { isHiddenIntention, spoiler } from './secrets';

function nextId(prefix: string, taken: readonly string[]): string {
    let n = taken.length + 1;
    while (taken.includes(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
}

/** Clock editor: filled / segments (segments within min…max). */
export function clockEditor(
    b: ProfileBind,
    key: string,
    clock: Clock,
    bounds: { min: number; max: number },
    save: (clock: Clock) => Promise<void>,
): HTMLElement {
    const t = b.ctx.t;
    return el('div', { class: 'dramatis-sheet-inline dramatis-sheet-clock' }, [
        el('span', { class: 'dramatis-muted', text: t('sheet.clock.label') }),
        numberField({
            value: clock.filled,
            min: 0,
            max: clock.segments,
            label: t('sheet.clock.filled'),
            key: b.key(`${key}.filled`),
            onCommit: (value) => save({ ...clock, filled: Math.min(clock.segments, Math.max(0, value ?? 0)) }),
        }),
        el('span', { text: '/' }),
        numberField({
            value: clock.segments,
            min: bounds.min,
            max: bounds.max,
            label: t('sheet.clock.segments'),
            key: b.key(`${key}.segments`),
            onCommit: (value) => {
                const segments = Math.min(bounds.max, Math.max(bounds.min, value ?? clock.segments));
                return save({ segments, filled: Math.min(clock.filled, segments) });
            },
        }),
    ]);
}

export function renderAgenda(b: ProfileBind): HTMLElement[] {
    const { ctx, profile } = b;
    const t = ctx.t;
    const out: HTMLElement[] = [];

    out.push(
        profileUnit(b, t('sheet.agenda.dream'), 'agenda.dream', [
            textCtl(b, 'agenda.dream', t('sheet.agenda.dream'), { optional: true, multiline: true }),
        ]),
    );
    out.push(renderGoals(b));
    out.push(renderIntentions(b));
    out.push(renderFront(b));
    out.push(
        profileUnit(b, t('sheet.agenda.resources'), 'agenda.resources', [
            listCtl(b, 'agenda.resources', t('sheet.agenda.resources'), { max: LIMITS.agendaList }),
        ]),
    );
    out.push(
        profileUnit(b, t('sheet.agenda.leverage'), 'agenda.leverage', [
            listCtl(b, 'agenda.leverage', t('sheet.agenda.leverage'), { max: LIMITS.agendaList }),
        ]),
    );
    const secrets = spoiler(ctx, `${profile.id}:agenda.secrets`, () =>
        profileUnit(b, t('sheet.agenda.secrets'), 'agenda.secrets', [
            listCtl(b, 'agenda.secrets', t('sheet.agenda.secrets'), {
                max: LIMITS.agendaList,
                maxLength: LIMITS.text,
                multiline: true,
            }),
        ]),
    );
    if (secrets) out.push(el('div', { class: 'dramatis-sheet-secret' }, [secrets]));
    out.push(
        profileUnit(b, t('sheet.agenda.ifIgnored'), 'agenda.ifIgnored', [
            textCtl(b, 'agenda.ifIgnored', t('sheet.agenda.ifIgnored'), { optional: true, multiline: true }),
        ]),
    );
    out.push(heading(t('sheet.starts.title')));
    out.push(renderStarts(b));
    return out;
}

function renderGoals(b: ProfileBind): HTMLElement {
    const t = b.ctx.t;
    const goals = b.profile.agenda.goals;
    const save = (next: Goal[]) => b.edit('agenda.goals', next.slice(0, LIMITS.goals));
    const rows = goals.map((goal, index) => {
        const patch = (change: Partial<Goal>) =>
            save(goals.map((item, i) => (i === index ? { ...item, ...change } : item)));
        return el('div', { class: 'dramatis-sheet-item' }, [
            textInput({
                value: goal.text,
                label: t('sheet.goal.text'),
                multiline: true,
                key: b.key(`agenda.goals.${goal.id}.text`),
                onCommit: (value) => {
                    const text = cleanText(value);
                    return text ? patch({ text }) : save(goals.filter((_, i) => i !== index));
                },
            }),
            el('div', { class: 'dramatis-sheet-inline' }, [
                keyed(
                    select({
                        value: goal.kind,
                        options: (['external', 'internal'] as const).map((kind) => ({
                            value: kind,
                            label: t(`sheet.goal.${kind}`),
                        })),
                        label: t('sheet.goal.kind'),
                        onChange: (kind) => patch({ kind }),
                    }),
                    b.key(`agenda.goals.${goal.id}.kind`),
                ),
                keyed(
                    select({
                        value: String(goal.priority),
                        options: [1, 2, 3].map((n) => ({ value: String(n), label: t(`sheet.goal.priority.${n}`) })),
                        label: t('sheet.goal.priority'),
                        onChange: (value) => patch({ priority: Number(value) }),
                    }),
                    b.key(`agenda.goals.${goal.id}.priority`),
                ),
                button({
                    icon: 'fa-trash-can',
                    kind: 'ghost',
                    title: t('sheet.remove'),
                    onClick: () => save(goals.filter((_, i) => i !== index)),
                }),
            ]),
        ]);
    });
    const add =
        goals.length < LIMITS.goals
            ? textInput({
                  value: '',
                  label: t('sheet.goal.add'),
                  placeholder: t('sheet.goal.add'),
                  multiline: true,
                  key: b.key('agenda.goals.new'),
                  onCommit: (value) => {
                      const text = cleanText(value);
                      if (!text) return;
                      const id = nextId(
                          'g',
                          goals.map((goal) => goal.id),
                      );
                      return save([...goals, { id, text, kind: 'external', priority: 2 }]);
                  },
              })
            : null;
    return profileUnit(b, t('sheet.agenda.goals'), 'agenda.goals', [...rows, add], { hint: t('sheet.goal.hint') });
}

function renderIntentions(b: ProfileBind): HTMLElement {
    const { ctx, profile } = b;
    const t = ctx.t;
    const intentions = profile.agenda.intentions;
    const goals = profile.agenda.goals;
    const save = (next: Intention[]) => b.edit('agenda.intentions', next.slice(0, LIMITS.intentions));
    const rows: (Node | null)[] = intentions.map((intention, index) => {
        const patch = (change: Partial<Intention>) =>
            save(intentions.map((item, i) => (i === index ? { ...item, ...change } : item)));
        const hidden = isHiddenIntention(intention);
        const hiddenBox = el('input', {
            attrs: { type: 'checkbox', 'data-dramatis-key': b.key(`agenda.intentions.${intention.id}.hidden`) },
        });
        hiddenBox.checked = hidden;
        hiddenBox.addEventListener('change', () => {
            const next = { ...intention } as Intention & { hidden?: boolean };
            if (hiddenBox.checked) next.hidden = true;
            else delete next.hidden;
            void save(intentions.map((item, i) => (i === index ? next : item)));
        });
        const item = el('div', { class: 'dramatis-sheet-item' }, [
            row(
                t('sheet.intention.text'),
                textInput({
                    value: intention.text,
                    label: t('sheet.intention.text'),
                    multiline: true,
                    key: b.key(`agenda.intentions.${intention.id}.text`),
                    onCommit: (value) => {
                        const text = cleanText(value);
                        return text ? patch({ text }) : save(intentions.filter((_, i) => i !== index));
                    },
                }),
            ),
            row(
                t('sheet.intention.nextStep'),
                textInput({
                    value: intention.nextStep,
                    label: t('sheet.intention.nextStep'),
                    key: b.key(`agenda.intentions.${intention.id}.nextStep`),
                    onCommit: (value) => patch({ nextStep: cleanText(value, LIMITS.short) }),
                }),
            ),
            row(
                t('sheet.intention.dropIf'),
                listEditor({
                    items: intention.dropIf,
                    label: t('sheet.intention.dropIf'),
                    addLabel: t('sheet.list.add'),
                    removeLabel: t('sheet.list.remove'),
                    max: 4,
                    key: b.key(`agenda.intentions.${intention.id}.dropIf`),
                    onCommit: (items) => patch({ dropIf: cleanList(items, 4) }),
                }),
            ),
            goals.length
                ? row(
                      t('sheet.intention.goal'),
                      keyed(
                          select({
                              value: intention.goalId ?? '',
                              options: [
                                  { value: '', label: t('sheet.none') },
                                  ...goals.map((goal) => ({ value: goal.id, label: goal.text })),
                              ],
                              label: t('sheet.intention.goal'),
                              onChange: (goalId) => {
                                  const next = { ...intention };
                                  if (goalId) next.goalId = goalId;
                                  else delete next.goalId;
                                  return save(intentions.map((item, i) => (i === index ? next : item)));
                              },
                          }),
                          b.key(`agenda.intentions.${intention.id}.goal`),
                      ),
                  )
                : null,
            intention.clock
                ? row(
                      t('sheet.clock.title'),
                      clockEditor(
                          b,
                          `agenda.intentions.${intention.id}.clock`,
                          intention.clock,
                          { min: 2, max: 12 },
                          (clock) => patch({ clock }),
                      ),
                  )
                : row(
                      t('sheet.clock.title'),
                      button({
                          icon: 'fa-clock',
                          label: t('sheet.clock.add'),
                          kind: 'ghost',
                          onClick: () => patch({ clock: { segments: 4, filled: 0 } }),
                      }),
                  ),
            el('div', { class: 'dramatis-sheet-inline' }, [
                el('label', { class: 'checkbox_label dramatis-sheet-check', title: t('sheet.intention.hiddenHint') }, [
                    hiddenBox,
                    el('span', { text: t('sheet.intention.hidden') }),
                ]),
                button({
                    icon: 'fa-trash-can',
                    kind: 'ghost',
                    label: t('sheet.remove'),
                    onClick: () => save(intentions.filter((_, i) => i !== index)),
                }),
            ]),
        ]);
        return hidden ? spoiler(ctx, `${profile.id}:intention:${intention.id}`, () => item) : item;
    });
    const add =
        intentions.length < LIMITS.intentions
            ? textInput({
                  value: '',
                  label: t('sheet.intention.add'),
                  placeholder: t('sheet.intention.add'),
                  key: b.key('agenda.intentions.new'),
                  onCommit: (value) => {
                      const text = cleanText(value);
                      if (!text) return;
                      const id = nextId(
                          'i',
                          intentions.map((item) => item.id),
                      );
                      return save([...intentions, { id, text, nextStep: '', dropIf: [] }]);
                  },
              })
            : null;
    return profileUnit(b, t('sheet.agenda.intentions'), 'agenda.intentions', [...rows, add], {
        hint: t('sheet.intention.hint'),
    });
}

function renderFront(b: ProfileBind): HTMLElement {
    const { ctx, profile } = b;
    const t = ctx.t;
    const front = profile.agenda.front;
    if (!front) {
        return profileUnit(
            b,
            t('sheet.agenda.front'),
            'agenda.front',
            [
                keyed(
                    button({
                        icon: 'fa-plus',
                        label: t('sheet.front.add'),
                        onClick: () =>
                            b.edit('agenda.front', {
                                impulse: '',
                                steps: [],
                                doom: '',
                                clock: { segments: 6, filled: 0 },
                            } satisfies Front),
                    }),
                    b.key('agenda.front:add'),
                ),
            ],
            { hint: t('sheet.front.hint') },
        );
    }
    const patch = (change: Partial<Front>) => b.edit('agenda.front', { ...front, ...change });
    const doom = spoiler(ctx, `${profile.id}:agenda.front.doom`, () =>
        row(
            t('sheet.front.doom'),
            textInput({
                value: front.doom,
                label: t('sheet.front.doom'),
                multiline: true,
                key: b.key('agenda.front.doom'),
                onCommit: (value) => patch({ doom: cleanText(value, LIMITS.short) }),
            }),
        ),
    );
    return profileUnit(
        b,
        t('sheet.agenda.front'),
        'agenda.front',
        [
            row(
                t('sheet.front.impulse'),
                textInput({
                    value: front.impulse,
                    label: t('sheet.front.impulse'),
                    key: b.key('agenda.front.impulse'),
                    onCommit: (value) => patch({ impulse: cleanText(value, LIMITS.short) }),
                }),
                !front.impulse ? t('sheet.front.needsImpulse') : undefined,
            ),
            row(
                t('sheet.front.steps'),
                listEditor({
                    items: front.steps,
                    label: t('sheet.front.steps'),
                    addLabel: t('sheet.list.add'),
                    removeLabel: t('sheet.list.remove'),
                    max: LIMITS.steps,
                    key: b.key('agenda.front.steps'),
                    onCommit: (items) => patch({ steps: cleanList(items, LIMITS.steps) }),
                }),
            ),
            doom ? el('div', { class: 'dramatis-sheet-secret' }, [doom]) : null,
            row(
                t('sheet.clock.title'),
                clockEditor(b, 'agenda.front.clock', front.clock, { min: 4, max: 8 }, (clock) => patch({ clock })),
            ),
        ],
        {
            actions: [
                button({
                    icon: 'fa-trash-can',
                    kind: 'ghost',
                    title: t('sheet.front.remove'),
                    onClick: () => b.edit('agenda.front', undefined),
                }),
            ],
        },
    );
}

function renderStarts(b: ProfileBind): HTMLElement {
    const t = b.ctx.t;
    const starts = b.profile.starts;
    type Start = CharacterProfile['starts'][number];
    const save = (next: Start[]) =>
        b.edit(
            'starts',
            [...next].sort((a, c) => a.greeting - c.greeting),
        );
    const rows = starts.map((start, index) => {
        const patch = (change: Partial<Start>) => {
            const merged = { ...start, ...change };
            if (!merged.doing) delete merged.doing;
            if (!merged.goal) delete merged.goal;
            return save(starts.map((item, i) => (i === index ? merged : item)));
        };
        const present = el('input', {
            attrs: { type: 'checkbox', 'data-dramatis-key': b.key(`starts.${start.greeting}.present`) },
        });
        present.checked = start.present;
        present.addEventListener('change', () => void patch({ present: present.checked }));
        return el('div', { class: 'dramatis-sheet-item' }, [
            el('div', { class: 'dramatis-sheet-inline' }, [
                el('span', { class: 'dramatis-muted', text: t('sheet.starts.greeting') }),
                numberField({
                    value: start.greeting,
                    min: -1,
                    max: 999,
                    label: t('sheet.starts.greeting'),
                    key: b.key(`starts.${start.greeting}.greeting`),
                    onCommit: (value) => {
                        const greeting = value ?? -1;
                        if (starts.some((other, i) => i !== index && other.greeting === greeting)) {
                            b.ctx.rerender();
                            return;
                        }
                        return patch({ greeting });
                    },
                }),
                el('label', { class: 'checkbox_label dramatis-sheet-check' }, [
                    present,
                    el('span', { text: t('sheet.starts.present') }),
                ]),
                button({
                    icon: 'fa-trash-can',
                    kind: 'ghost',
                    title: t('sheet.remove'),
                    onClick: () => save(starts.filter((_, i) => i !== index)),
                }),
            ]),
            row(
                t('sheet.starts.doing'),
                textInput({
                    value: start.doing ?? '',
                    label: t('sheet.starts.doing'),
                    key: b.key(`starts.${start.greeting}.doing`),
                    onCommit: (value) => patch({ doing: cleanText(value, LIMITS.short) }),
                }),
            ),
            row(
                t('sheet.starts.goal'),
                textInput({
                    value: start.goal ?? '',
                    label: t('sheet.starts.goal'),
                    key: b.key(`starts.${start.greeting}.goal`),
                    onCommit: (value) => patch({ goal: cleanText(value, LIMITS.short) }),
                }),
            ),
        ]);
    });
    const free = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9].find((n) => !starts.some((start) => start.greeting === n));
    const add =
        starts.length < LIMITS.starts && free !== undefined
            ? keyed(
                  button({
                      icon: 'fa-plus',
                      label: t('sheet.starts.add'),
                      kind: 'ghost',
                      onClick: () => save([...starts, { greeting: free, present: true }]),
                  }),
                  b.key('starts:add'),
              )
            : null;
    return profileUnit(b, t('sheet.starts.title'), 'starts', [...rows, add], { hint: t('sheet.starts.hint') });
}
