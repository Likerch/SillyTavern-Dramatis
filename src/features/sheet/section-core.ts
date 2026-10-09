// «Ядро»: who the character is (docs/model.md §4.1) plus identity — every field editable, each with its provenance.
import { DRIVES, HEXACO, JUSTIFICATIONS, MOODS, PLAYER_ID, VALUES } from '../../domain/model';
import type { Core, Drive, StanceBound, Value, Wound } from '../../domain/model';
import { copingLabel, driveLabel, hexacoLabel, justificationLabel, moodLabel, valueLabel } from '../../domain/ladders';
import { LIMITS, cleanText, isDict } from '../../domain/profile-defaults';
import { select } from '../../ui/controls';
import { button, el } from '../../ui/dom';
import { chips, rangeInput, textInput } from '../../ui/form';
import {
    chipsCtl,
    heading,
    keyed,
    listCtl,
    profileUnit,
    rangeCtl,
    row,
    selectCtl,
    stanceOptions,
    textCtl,
    toggleCtl,
} from './parts';
import type { ProfileBind } from './parts';
import { words } from './words';

const DEFAULT_WOUND: Wound = { ghost: '', lie: '', triggers: [], coping: 'avoid' };

function coreOf(value: unknown): Partial<Core> {
    return isDict(value) ? (value as Partial<Core>) : {};
}

export function renderCore(b: ProfileBind): HTMLElement[] {
    const { ctx, profile } = b;
    const t = ctx.t;
    const w = words(ctx);
    const core = profile.core;
    const out: HTMLElement[] = [];

    /* identity */
    out.push(heading(t('sheet.core.identity')));
    out.push(
        profileUnit(b, t('sheet.field.name'), 'name', [
            textInput({
                value: profile.name,
                label: t('sheet.field.name'),
                key: b.key('name'),
                onCommit: (value) => {
                    const name = cleanText(value, LIMITS.name);
                    if (!name) {
                        ctx.rerender();
                        return;
                    }
                    return b.edit('name', name);
                },
            }),
        ]),
    );
    out.push(
        profileUnit(b, t('sheet.field.english'), 'english', [
            textCtl(b, 'english', t('sheet.field.english'), { optional: true, max: LIMITS.name }),
        ]),
    );
    out.push(
        profileUnit(b, t('sheet.field.aliases'), 'aliases', [
            listCtl(b, 'aliases', t('sheet.field.aliases'), { max: LIMITS.aliases, maxLength: LIMITS.name }),
        ]),
    );
    out.push(
        profileUnit(b, t('sheet.field.kind'), 'kind', [
            selectCtl(b, 'kind', t('sheet.field.kind'), [
                { value: 'character', label: t('sheet.kind.character') },
                { value: 'group', label: t('sheet.kind.group') },
            ]),
        ]),
    );
    out.push(
        profileUnit(b, t('sheet.field.role'), 'role', [
            textCtl(b, 'role', t('sheet.field.role'), { optional: true, max: LIMITS.short }),
        ]),
    );
    out.push(
        profileUnit(b, t('sheet.field.species'), 'species', [
            textCtl(b, 'species', t('sheet.field.species'), { optional: true, max: LIMITS.name }),
        ]),
    );
    out.push(
        profileUnit(b, t('sheet.field.gender'), 'gender', [
            selectCtl(
                b,
                'gender',
                t('sheet.field.gender'),
                [
                    { value: 'female', label: t('sheet.gender.female') },
                    { value: 'male', label: t('sheet.gender.male') },
                ],
                { none: t('sheet.gender.unknown') },
            ),
        ]),
    );
    out.push(
        profileUnit(b, t('sheet.field.minor'), 'minor', [toggleCtl(b, 'minor', t('sheet.field.minorHint'), true)]),
    );

    /* core */
    out.push(heading(t('sheet.core.title')));
    out.push(
        profileUnit(b, t('sheet.field.concept'), 'core.concept', [
            textCtl(b, 'core.concept', t('sheet.field.concept'), { multiline: true, max: LIMITS.short }),
        ]),
    );

    // Values: three by priority and the one they would sacrifice.
    const top = core.values.top;
    const valueOptions = VALUES.map((value) => ({ value: value as string, label: valueLabel(value, ctx.lang) }));
    const setTop = (slot: number, value: string) =>
        b.update('core.values', (current) => {
            const values = coreOf({ values: current }).values ?? { top: [] };
            let next = [...values.top];
            if (!value) next.splice(slot, 1);
            else {
                // A value already chosen elsewhere swaps places with this slot (nothing is lost).
                const other = next.indexOf(value as Value);
                if (other >= 0 && slot < next.length) {
                    next[other] = next[slot]!;
                    next[slot] = value as Value;
                } else if (other < 0 && slot < next.length) next[slot] = value as Value;
                else if (other < 0) next.push(value as Value);
            }
            next = next.slice(0, LIMITS.values);
            const sacrifice = values.sacrifice && !next.includes(values.sacrifice) ? values.sacrifice : undefined;
            return sacrifice ? { top: next, sacrifice } : { top: next };
        });
    const slots = [0, 1, 2].map((slot) =>
        row(
            t('sheet.core.valueSlot', { n: slot + 1 }),
            keyed(
                select({
                    value: top[slot] ?? '',
                    options: [{ value: '', label: t('sheet.none') }, ...valueOptions],
                    label: t('sheet.core.valueSlot', { n: slot + 1 }),
                    disabled: slot > top.length,
                    onChange: (value) => setTop(slot, value),
                }),
                b.key(`core.values.top.${slot}`),
            ),
        ),
    );
    out.push(
        profileUnit(b, t('sheet.field.values'), 'core.values', [
            ...slots,
            row(
                t('sheet.core.sacrifice'),
                keyed(
                    select({
                        value: core.values.sacrifice ?? '',
                        options: [
                            { value: '', label: t('sheet.none') },
                            ...valueOptions.filter((option) => !top.includes(option.value as Value)),
                        ],
                        label: t('sheet.core.sacrifice'),
                        onChange: (value) =>
                            b.update('core.values', (current) => {
                                const values = coreOf({ values: current }).values ?? { top: [] };
                                return value ? { ...values, sacrifice: value } : { top: values.top };
                            }),
                    }),
                    b.key('core.values.sacrifice'),
                ),
            ),
        ]),
    );

    // Temperament: six HEXACO axes −2 … +2 (only non-zero ones are stored).
    out.push(
        profileUnit(
            b,
            t('sheet.field.temperament'),
            'core.temperament',
            HEXACO.map((axis) =>
                row(
                    hexacoLabel(axis, ctx.lang),
                    rangeInput({
                        value: core.temperament[axis] ?? 0,
                        min: -2,
                        max: 2,
                        label: hexacoLabel(axis, ctx.lang),
                        words: (value) => w.hexaco(axis, value),
                        key: b.key(`core.temperament.${axis}`),
                        onCommit: (value) =>
                            b.update('core.temperament', (current) => {
                                const next = { ...(isDict(current) ? current : {}) } as Record<string, number>;
                                if (value === 0) delete next[axis];
                                else next[axis] = value;
                                return next;
                            }),
                    }),
                ),
            ),
            { hint: t('sheet.core.temperamentHint') },
        ),
    );

    // Drives: 2–4 strong, 1–2 indifferent; one drive cannot be both.
    const driveOptions = DRIVES.map((drive) => ({ value: drive, label: driveLabel(drive, ctx.lang) }));
    const setDrives = (side: 'high' | 'low', values: Drive[]) =>
        b.update('core.drives', (current) => {
            const drives = isDict(current) ? (current as Core['drives']) : { high: [], low: [] };
            const other = side === 'high' ? 'low' : 'high';
            return { ...drives, [side]: values, [other]: (drives[other] ?? []).filter((d) => !values.includes(d)) };
        });
    out.push(
        profileUnit(b, t('sheet.field.drives'), 'core.drives', [
            row(
                t('sheet.core.drivesHigh'),
                chips({
                    options: driveOptions,
                    selected: core.drives.high,
                    label: t('sheet.core.drivesHigh'),
                    max: LIMITS.drivesHigh,
                    key: b.key('core.drives.high'),
                    onCommit: (values) => setDrives('high', values),
                }),
            ),
            row(
                t('sheet.core.drivesLow'),
                chips({
                    options: driveOptions,
                    selected: core.drives.low,
                    label: t('sheet.core.drivesLow'),
                    max: LIMITS.drivesLow,
                    key: b.key('core.drives.low'),
                    onCommit: (values) => setDrives('low', values),
                }),
            ),
        ]),
    );

    // Wound: ghost → lie → what touches it → how they defend.
    const wound = core.wound;
    const setWound = (patch: Partial<Wound>) =>
        b.update('core.wound', (current) => ({ ...DEFAULT_WOUND, ...(isDict(current) ? current : {}), ...patch }));
    // The triggers list lives inside a wound: without one, the first item creates it.
    const triggers = wound
        ? listCtl(b, 'core.wound.triggers', t('sheet.core.woundTriggers'), { max: LIMITS.triggers })
        : textInput({
              value: '',
              label: t('sheet.core.woundTriggers'),
              placeholder: t('sheet.list.add'),
              key: b.key('core.wound.triggers.new'),
              onCommit: (value) => (value ? setWound({ triggers: [cleanText(value, LIMITS.short)] }) : undefined),
          });
    out.push(
        profileUnit(
            b,
            t('sheet.field.wound'),
            'core.wound',
            [
                row(
                    t('sheet.core.ghost'),
                    textInput({
                        value: wound?.ghost ?? '',
                        label: t('sheet.core.ghost'),
                        multiline: true,
                        key: b.key('core.wound.ghost'),
                        onCommit: (value) => setWound({ ghost: cleanText(value) }),
                    }),
                ),
                row(
                    t('sheet.core.lie'),
                    textInput({
                        value: wound?.lie ?? '',
                        label: t('sheet.core.lie'),
                        key: b.key('core.wound.lie'),
                        onCommit: (value) => setWound({ lie: cleanText(value) }),
                    }),
                ),
                row(t('sheet.core.woundTriggers'), triggers),
                row(
                    t('sheet.core.coping'),
                    keyed(
                        select({
                            value: wound?.coping ?? 'avoid',
                            options: (['surrender', 'avoid', 'overcompensate'] as const).map((value) => ({
                                value,
                                label: copingLabel(value, ctx.lang),
                            })),
                            label: t('sheet.core.coping'),
                            onChange: (value) => setWound({ coping: value }),
                        }),
                        b.key('core.wound.coping'),
                    ),
                ),
            ],
            {
                hint: wound && !wound.ghost ? t('sheet.core.woundNeedsGhost') : undefined,
                actions: wound
                    ? [
                          button({
                              icon: 'fa-trash-can',
                              kind: 'ghost',
                              title: t('sheet.core.woundRemove'),
                              onClick: () => b.edit('core.wound', undefined),
                          }),
                      ]
                    : undefined,
            },
        ),
    );
    out.push(
        profileUnit(b, t('sheet.field.want'), 'core.want', [
            textCtl(b, 'core.want', t('sheet.field.want'), { optional: true, multiline: true }),
        ]),
    );
    out.push(
        profileUnit(b, t('sheet.field.need'), 'core.need', [
            textCtl(b, 'core.need', t('sheet.field.need'), { optional: true, multiline: true }),
        ]),
    );
    out.push(
        profileUnit(b, t('sheet.field.arcLock'), 'core.arcLock', [
            toggleCtl(b, 'core.arcLock', t('sheet.core.arcLockHint')),
        ]),
    );
    out.push(
        profileUnit(
            b,
            t('sheet.field.signatures'),
            'core.signatures',
            [
                listCtl(b, 'core.signatures', t('sheet.field.signatures'), {
                    max: LIMITS.signatures,
                    maxLength: LIMITS.text,
                    multiline: true,
                }),
            ],
            { hint: t('sheet.core.signaturesHint') },
        ),
    );
    out.push(
        profileUnit(b, t('sheet.field.tactics'), 'core.tactics', [
            listCtl(b, 'core.tactics', t('sheet.field.tactics'), { max: LIMITS.tactics }),
        ]),
    );

    // Attachment: anxiety and avoidance, −2 … +2.
    const attachment = core.attachment;
    out.push(
        profileUnit(
            b,
            t('sheet.field.attachment'),
            'core.attachment',
            (['anxiety', 'avoidance'] as const).map((axis) =>
                row(
                    t(`sheet.core.${axis}`),
                    rangeInput({
                        value: attachment?.[axis] ?? 0,
                        min: -2,
                        max: 2,
                        label: t(`sheet.core.${axis}`),
                        words: w.level,
                        key: b.key(`core.attachment.${axis}`),
                        onCommit: (value) =>
                            b.update('core.attachment', (current) => ({
                                anxiety: 0,
                                avoidance: 0,
                                ...(isDict(current) ? current : {}),
                                [axis]: value,
                            })),
                    }),
                ),
            ),
        ),
    );
    out.push(
        profileUnit(b, t('sheet.field.commitment'), 'core.commitment', [
            selectCtl(b, 'core.commitment', t('sheet.field.commitment'), [
                { value: 'single', label: t('sheet.commitment.single') },
                { value: 'open', label: t('sheet.commitment.open') },
            ]),
        ]),
    );
    out.push(
        profileUnit(b, t('sheet.field.proactivity'), 'core.proactivity', [
            rangeCtl(b, 'core.proactivity', t('sheet.field.proactivity'), {
                min: 0,
                max: 10,
                fallback: 5,
                words: w.proactivity,
            }),
        ]),
    );
    out.push(
        profileUnit(b, t('sheet.field.baselineMood'), 'core.baselineMood', [
            row(
                t('sheet.core.moodOctant'),
                keyed(
                    select({
                        value: core.baselineMood.octant,
                        options: MOODS.map((mood) => ({ value: mood, label: moodLabel(mood, ctx.lang) })),
                        label: t('sheet.core.moodOctant'),
                        onChange: (value) =>
                            b.update('core.baselineMood', (current) => ({
                                ...(isDict(current) ? current : {}),
                                octant: value,
                            })),
                    }),
                    b.key('core.baselineMood.octant'),
                ),
            ),
            row(
                t('sheet.core.moodLabel'),
                textInput({
                    value: core.baselineMood.label ?? '',
                    label: t('sheet.core.moodLabel'),
                    key: b.key('core.baselineMood.label'),
                    onCommit: (value) =>
                        b.update('core.baselineMood', (current) => {
                            const mood = { octant: core.baselineMood.octant, ...(isDict(current) ? current : {}) };
                            const label = cleanText(value, LIMITS.name);
                            if (label) return { ...mood, label };
                            const { label: _label, ...rest } = mood as { label?: string };
                            return rest;
                        }),
                }),
            ),
        ]),
    );
    out.push(renderBounds(b));
    out.push(
        profileUnit(b, t('sheet.field.redLines'), 'core.redLines', [
            row(
                t('sheet.core.never'),
                listCtl(b, 'core.redLines.never', t('sheet.core.never'), { max: LIMITS.redLines }),
            ),
            row(
                t('sheet.core.would'),
                listCtl(b, 'core.redLines.would', t('sheet.core.would'), { max: LIMITS.redLines }),
            ),
        ]),
    );
    out.push(
        profileUnit(
            b,
            t('sheet.field.keys'),
            'core.keys',
            [listCtl(b, 'core.keys', t('sheet.field.keys'), { max: LIMITS.keys })],
            { hint: t('sheet.core.keysHint') },
        ),
    );
    out.push(
        profileUnit(b, t('sheet.field.moralWeakness'), 'core.moralWeakness', [
            textCtl(b, 'core.moralWeakness', t('sheet.field.moralWeakness'), { optional: true, max: LIMITS.short }),
        ]),
    );
    out.push(
        profileUnit(b, t('sheet.field.voice'), 'core.voice', [
            textCtl(b, 'core.voice', t('sheet.field.voice'), { optional: true, max: LIMITS.short }),
        ]),
    );
    out.push(
        profileUnit(b, t('sheet.field.justifications'), 'core.justifications', [
            chipsCtl(
                b,
                'core.justifications',
                t('sheet.field.justifications'),
                JUSTIFICATIONS.map((value) => ({ value, label: justificationLabel(value, ctx.lang) })),
                LIMITS.justifications,
            ),
        ]),
    );
    out.push(
        profileUnit(
            b,
            t('sheet.field.dark'),
            'core.dark',
            (['ruthless', 'schemer', 'sadist', 'entitled'] as const).map((flag) => {
                const input = el('input', {
                    attrs: { type: 'checkbox', 'data-dramatis-key': b.key(`core.dark.${flag}`) },
                });
                input.checked = core.dark?.[flag] === true;
                input.addEventListener('change', () => {
                    void b.update('core.dark', (current) => {
                        const next = { ...(isDict(current) ? current : {}) } as Record<string, boolean>;
                        if (input.checked) next[flag] = true;
                        else delete next[flag];
                        return Object.keys(next).length ? next : undefined;
                    });
                });
                return el(
                    'label',
                    { class: 'checkbox_label dramatis-sheet-check', title: t(`sheet.dark.${flag}.hint`) },
                    [input, el('span', { text: t(`sheet.dark.${flag}`) })],
                );
            }),
        ),
    );
    out.push(
        profileUnit(b, t('sheet.field.corruption'), 'core.corruption', [
            rangeCtl(b, 'core.corruption', t('sheet.field.corruption'), { min: 0, max: 10, words: w.corruption }),
        ]),
    );
    out.push(
        profileUnit(
            b,
            t('sheet.field.anchors'),
            'core.anchors',
            [listCtl(b, 'core.anchors', t('sheet.field.anchors'), { max: LIMITS.anchors, maxLength: LIMITS.name })],
            { hint: t('sheet.core.anchorsHint') },
        ),
    );
    return out;
}

/** Stance bounds: floor and ceiling toward the player, a character or a class («к имперцам не выше «Нейтрален»»). */
function renderBounds(b: ProfileBind): HTMLElement {
    const { ctx, profile } = b;
    const t = ctx.t;
    const bounds = profile.core.stanceBounds;
    const known = new Map<string, string>([
        ['*', t('sheet.bounds.everyone')],
        [PLAYER_ID, ctx.view.playerName],
    ]);
    for (const other of ctx.view.profiles) if (other.id !== profile.id) known.set(other.id, other.name);
    const setBounds = (change: (list: StanceBound[]) => StanceBound[]) =>
        b.update('core.stanceBounds', (current) =>
            change(Array.isArray(current) ? [...(current as StanceBound[])] : []),
        );
    const stanceChoice = (value: number | undefined, label: string, key: string, onChange: (v: string) => void) =>
        keyed(
            select({
                value: value === undefined ? '' : String(value),
                options: [{ value: '', label: t('sheet.none') }, ...stanceOptions(ctx, profile.gender)],
                label,
                onChange,
            }),
            key,
        );
    const rows = bounds.map((bound, index) => {
        const patch = (next: Partial<StanceBound>) =>
            setBounds((list) => {
                const merged = { ...list[index]!, ...next } as StanceBound;
                if (merged.min === undefined) delete merged.min;
                if (merged.max === undefined) delete merged.max;
                list[index] = merged;
                return list.filter((item) => item.min !== undefined || item.max !== undefined);
            });
        return el('div', { class: 'dramatis-sheet-item' }, [
            el('div', { class: 'dramatis-sheet-item-title', text: known.get(bound.target) ?? bound.target }),
            row(
                t('sheet.bounds.min'),
                stanceChoice(bound.min, t('sheet.bounds.min'), b.key(`core.stanceBounds.${index}.min`), (value) =>
                    patch({ min: value === '' ? undefined : (Number(value) as StanceBound['min']) }),
                ),
            ),
            row(
                t('sheet.bounds.max'),
                stanceChoice(bound.max, t('sheet.bounds.max'), b.key(`core.stanceBounds.${index}.max`), (value) =>
                    patch({ max: value === '' ? undefined : (Number(value) as StanceBound['max']) }),
                ),
            ),
            button({
                icon: 'fa-trash-can',
                kind: 'ghost',
                label: t('sheet.remove'),
                className: 'dramatis-sheet-item-remove',
                onClick: () => setBounds((list) => list.filter((_, i) => i !== index)),
            }),
        ]);
    });
    // Adding: a known target or a class typed in.
    const free = bounds.length < LIMITS.bounds;
    const targetSelect = select({
        value: '',
        options: [
            { value: '', label: t('sheet.bounds.pick') },
            ...[...known.entries()]
                .filter(([id]) => !bounds.some((bound) => bound.target === id))
                .map(([id, name]) => ({ value: id, label: name })),
        ],
        label: t('sheet.bounds.pick'),
        onChange: (value) => {
            if (value) void setBounds((list) => [...list, { target: value, max: 0 as const }]);
        },
    });
    const classInput = textInput({
        value: '',
        label: t('sheet.bounds.class'),
        placeholder: t('sheet.bounds.class'),
        key: b.key('core.stanceBounds.class'),
        onCommit: (value) => {
            const target = cleanText(value, LIMITS.name).replace(/\./g, '');
            if (target) return setBounds((list) => [...list, { target, max: 0 as const }]);
        },
    });
    return profileUnit(
        b,
        t('sheet.field.stanceBounds'),
        'core.stanceBounds',
        [
            ...rows,
            free
                ? el('div', { class: 'dramatis-sheet-add' }, [
                      keyed(targetSelect, b.key('core.stanceBounds.pick')),
                      classInput,
                  ])
                : null,
        ],
        { hint: t('sheet.bounds.hint') },
    );
}
