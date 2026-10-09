// «Сейчас» and «История»: the chat state of a character (docs/model.md §4.4, §5.7) — mood, emotion, the scene,
// appetite pressure, intentions with clocks, schemes, stress, corruption, arc stage, self-control — and the story log.
// Edits go to this chat's state only; hidden appetites, hidden intentions, the doom and schemes are secrets.
import { MOODS, MOVES, PLAYER_ID } from '../../domain/model';
import type {
    AppetiteState,
    ArcStage,
    CharacterState,
    Clock,
    Emotion,
    Intention,
    Move,
    Scheme,
} from '../../domain/model';
import { arcStageLabel, bandLabel, methodLabel, moodLabel, moveLabel } from '../../domain/ladders';
import { LIMITS, cleanList, cleanText } from '../../domain/profile-defaults';
import { translateSegments } from '../../domain/translate';
import { select } from '../../ui/controls';
import { button, el } from '../../ui/dom';
import { listEditor, numberField, rangeInput, textInput } from '../../ui/form';
import { nameOf } from './edits';
import { appetiteTitle } from './section-appetites';
import { clockEditor } from './section-agenda';
import { emptyState, heading, keyed, row } from './parts';
import type { ProfileBind } from './parts';
import { isHiddenAppetite, isHiddenIntention, spoiler } from './secrets';
import { words } from './words';

const ARC_STAGES: readonly ArcStage[] = ['intact', 'cracking', 'glimpsed', 'embraced', 'rejected'];
const SCHEME_STATES: readonly Scheme['state'][] = ['running', 'ready', 'done', 'failed', 'exposed'];

function block(title: string, children: (Node | null)[], className?: string): HTMLElement {
    return el('div', { class: ['dramatis-sheet-unit', className] }, [
        el('div', { class: 'dramatis-sheet-unit-head' }, [
            el('div', { class: 'dramatis-sheet-unit-title', text: title }),
        ]),
        el('div', { class: 'dramatis-sheet-unit-body' }, children),
    ]);
}

/** People one may aim at: nobody, the player, the cast. */
function whoOptions(b: ProfileBind): { value: string; label: string }[] {
    return [
        { value: '', label: b.ctx.t('sheet.none') },
        { value: PLAYER_ID, label: b.ctx.view.playerName },
        ...b.ctx.view.profiles
            .filter((other) => other.id !== b.profile.id)
            .map((other) => ({ value: other.id, label: other.name })),
    ];
}

export function renderNow(b: ProfileBind): HTMLElement[] {
    const { ctx, profile, live } = b;
    const t = ctx.t;
    if (!live) {
        return [
            emptyState(t('sheet.now.noState'), [
                button({
                    icon: 'fa-play',
                    label: t('sheet.now.create'),
                    onClick: () => b.editLive(() => undefined),
                }),
            ]),
        ];
    }
    const w = words(ctx);
    const state = ctx.view.state;
    const k = (path: string) => b.key(`now.${path}`);
    const out: HTMLElement[] = [];

    /* presence */
    const knows = el('input', { attrs: { type: 'checkbox', 'data-dramatis-key': k('knowsPlayer') } });
    knows.checked = live.knowsPlayer;
    knows.addEventListener('change', () => void b.editLive((cs) => void (cs.knowsPlayer = knows.checked)));
    const present = ctx.view.present.includes(profile.id);
    const band = ctx.view.bands[profile.id];
    out.push(
        block(t('sheet.now.presence'), [
            el('div', { class: 'dramatis-sheet-inline' }, [
                el('span', {
                    class: ['dramatis-sheet-tag', present && 'dramatis-sheet-tag-on'],
                    text: present ? t('sheet.present.yes') : t('sheet.present.no'),
                }),
                present && band ? el('span', { class: 'dramatis-sheet-tag', text: bandLabel(band, ctx.lang) }) : null,
            ]),
            el('label', { class: 'checkbox_label dramatis-sheet-check' }, [
                knows,
                el('span', { text: t('sheet.now.knowsPlayer', { name: ctx.view.playerName }) }),
            ]),
        ]),
    );

    /* mood and emotion */
    out.push(
        block(t('sheet.now.mood'), [
            row(
                t('sheet.core.moodOctant'),
                keyed(
                    select({
                        value: live.mood.octant,
                        options: MOODS.map((mood) => ({ value: mood, label: moodLabel(mood, ctx.lang) })),
                        label: t('sheet.core.moodOctant'),
                        onChange: (octant) => b.editLive((cs) => void (cs.mood = { ...cs.mood, octant })),
                    }),
                    k('mood.octant'),
                ),
            ),
            row(
                t('sheet.core.moodLabel'),
                textInput({
                    value: live.mood.label ?? '',
                    label: t('sheet.core.moodLabel'),
                    key: k('mood.label'),
                    onCommit: (value) =>
                        b.editLive((cs) => {
                            const label = cleanText(value, LIMITS.name);
                            cs.mood = label ? { ...cs.mood, label } : { octant: cs.mood.octant };
                        }),
                }),
            ),
        ]),
    );
    out.push(renderEmotion(b, live, state.turn));

    /* scene */
    const setScene = (patch: Partial<CharacterState['scene']>) =>
        b.editLive((cs) => {
            const scene = { ...cs.scene, ...patch } as Record<string, unknown>;
            for (const [key, value] of Object.entries(scene))
                if (value === undefined || value === '') delete scene[key];
            cs.scene = scene as unknown as CharacterState['scene'];
        });
    const sceneText = (field: 'doing' | 'goal' | 'obstacle' | 'moveText', label: string) =>
        row(
            label,
            textInput({
                value: live.scene[field] ?? '',
                label,
                key: k(`scene.${field}`),
                onCommit: (value) => setScene({ [field]: cleanText(value, LIMITS.short) || undefined }),
            }),
        );
    out.push(
        block(t('sheet.now.scene'), [
            sceneText('doing', t('sheet.now.doing')),
            sceneText('goal', t('sheet.now.goal')),
            sceneText('obstacle', t('sheet.now.obstacle')),
            row(
                t('sheet.now.attention'),
                keyed(
                    select({
                        value: live.scene.attention,
                        options: (['background', 'business', 'focus'] as const).map((value) => ({
                            value,
                            label: bandLabel(value, ctx.lang),
                        })),
                        label: t('sheet.now.attention'),
                        onChange: (attention) => setScene({ attention }),
                    }),
                    k('scene.attention'),
                ),
                t('sheet.now.attentionHint'),
            ),
            row(
                t('sheet.now.move'),
                keyed(
                    select({
                        value: live.scene.move ?? '',
                        options: [
                            { value: '', label: t('sheet.none') },
                            ...MOVES.map((move) => ({ value: move, label: moveLabel(move, ctx.lang) })),
                        ],
                        label: t('sheet.now.move'),
                        onChange: (move) => setScene({ move: (move || undefined) as Move | undefined }),
                    }),
                    k('scene.move'),
                ),
            ),
            row(
                t('sheet.now.moveTarget'),
                keyed(
                    select({
                        value: live.scene.moveTarget ?? '',
                        options: whoOptions(b),
                        label: t('sheet.now.moveTarget'),
                        onChange: (moveTarget) => setScene({ moveTarget: moveTarget || undefined }),
                    }),
                    k('scene.moveTarget'),
                ),
            ),
            sceneText('moveText', t('sheet.now.moveText')),
        ]),
    );

    /* appetite pressure */
    if (profile.appetites.length) {
        out.push(heading(t('sheet.now.appetites')));
        for (const appetite of profile.appetites) {
            const current: AppetiteState = live.appetites[appetite.id] ?? {
                pressure: appetite.baseline,
                tolerance: appetite.tolerance,
                dependence: appetite.dependence,
                sensitization: appetite.sensitization,
                lastSated: -1,
                edgeCount: 0,
                withdrawal: false,
            };
            const patch = (change: Partial<AppetiteState>) =>
                b.editLive(
                    (cs) =>
                        void (cs.appetites[appetite.id] = {
                            ...current,
                            ...(cs.appetites[appetite.id] ?? {}),
                            ...change,
                        }),
                );
            const scale = (field: 'tolerance' | 'dependence' | 'sensitization') =>
                row(
                    t(`sheet.appetite.${field}`),
                    rangeInput({
                        value: current[field],
                        min: 0,
                        max: 3,
                        label: t(`sheet.appetite.${field}`),
                        words: w.three,
                        key: k(`appetites.${appetite.id}.${field}`),
                        onCommit: (value) => patch({ [field]: value }),
                    }),
                );
            const withdrawal = el('input', {
                attrs: { type: 'checkbox', 'data-dramatis-key': k(`appetites.${appetite.id}.withdrawal`) },
            });
            withdrawal.checked = current.withdrawal;
            withdrawal.addEventListener('change', () => void patch({ withdrawal: withdrawal.checked }));
            const lapsed = el('input', {
                attrs: { type: 'checkbox', 'data-dramatis-key': k(`appetites.${appetite.id}.lapsed`) },
            });
            lapsed.checked = current.lapsed === true;
            lapsed.addEventListener('change', () => void patch({ lapsed: lapsed.checked || undefined }));
            const content = block(
                appetiteTitle(b, appetite),
                [
                    row(
                        t('sheet.now.pressure'),
                        rangeInput({
                            value: current.pressure,
                            min: 0,
                            max: 5,
                            label: t('sheet.now.pressure'),
                            words: (value) => w.pressure(value, profile.gender),
                            key: k(`appetites.${appetite.id}.pressure`),
                            onCommit: (value) => patch({ pressure: value as AppetiteState['pressure'] }),
                        }),
                    ),
                    scale('tolerance'),
                    scale('dependence'),
                    scale('sensitization'),
                    el('label', { class: 'checkbox_label dramatis-sheet-check' }, [
                        withdrawal,
                        el('span', { text: t('sheet.now.withdrawal') }),
                    ]),
                    appetite.vow === 'abstinent' || current.lapsed
                        ? el(
                              'label',
                              { class: 'checkbox_label dramatis-sheet-check', title: t('sheet.now.lapsedHint') },
                              [lapsed, el('span', { text: t('sheet.now.lapsed') })],
                          )
                        : null,
                    row(
                        t('sheet.now.daysUnsated'),
                        numberField({
                            value: current.daysUnsated ?? 0,
                            min: 0,
                            max: 999,
                            label: t('sheet.now.daysUnsated'),
                            key: k(`appetites.${appetite.id}.days`),
                            onCommit: (value) => patch({ daysUnsated: value ?? 0 }),
                        }),
                    ),
                ],
                'dramatis-sheet-card',
            );
            if (!isHiddenAppetite(appetite)) out.push(content);
            else {
                const hidden = spoiler(ctx, `${profile.id}:now-appetite:${appetite.id}`, () => content);
                if (hidden) out.push(el('div', { class: 'dramatis-sheet-secret' }, [hidden]));
            }
        }
    }

    /* intentions and the front, as the story moved them */
    out.push(renderLiveIntentions(b, live));
    const front = live.agenda.front;
    if (front) {
        const frontBlock = block(t('sheet.agenda.front'), [
            el('div', { text: ctx.tr(front.impulse) }),
            row(
                t('sheet.clock.title'),
                clockEditor(b, 'now.front.clock', front.clock, { min: 4, max: 8 }, (clock: Clock) =>
                    b.editLive((cs) => {
                        if (cs.agenda.front) cs.agenda.front = { ...cs.agenda.front, clock };
                    }),
                ),
            ),
        ]);
        const doom = spoiler(ctx, `${profile.id}:now.front.doom`, () =>
            el('div', { class: 'dramatis-sheet-inline' }, [
                el('span', { class: 'dramatis-muted', text: t('sheet.front.doom') }),
                el('span', { text: ctx.tr(front.doom) || '—' }),
            ]),
        );
        if (doom) frontBlock.lastElementChild?.appendChild(el('div', { class: 'dramatis-sheet-secret' }, [doom]));
        out.push(frontBlock);
    }

    /* schemes */
    const schemes = state.schemes.filter((scheme) => scheme.owner === profile.id);
    if (schemes.length) {
        out.push(heading(t('sheet.now.schemes')));
        for (const scheme of schemes) {
            const hidden = spoiler(ctx, `${profile.id}:scheme:${scheme.id}`, () => renderScheme(b, scheme));
            if (hidden) out.push(el('div', { class: 'dramatis-sheet-secret' }, [hidden]));
        }
    }

    /* stress, self-control, arc, corruption */
    out.push(
        block(t('sheet.now.inner'), [
            row(
                t('sheet.now.stress'),
                numberField({
                    value: live.stress,
                    min: 0,
                    max: 100,
                    label: t('sheet.now.stress'),
                    key: k('stress'),
                    onCommit: (value) => b.editLive((cs) => void (cs.stress = value ?? 0)),
                }),
                t('sheet.now.stressHint'),
            ),
            row(
                t('sheet.now.selfControl'),
                rangeInput({
                    value: live.selfControl,
                    min: 0,
                    max: 3,
                    label: t('sheet.now.selfControl'),
                    words: w.selfControl,
                    key: k('selfControl'),
                    onCommit: (value) => b.editLive((cs) => void (cs.selfControl = value)),
                }),
            ),
            row(
                t('sheet.now.arcStage'),
                keyed(
                    select({
                        value: live.arcStage,
                        options: ARC_STAGES.map((stage) => ({ value: stage, label: arcStageLabel(stage, ctx.lang) })),
                        label: t('sheet.now.arcStage'),
                        onChange: (arcStage) => b.editLive((cs) => void (cs.arcStage = arcStage)),
                    }),
                    k('arcStage'),
                ),
                profile.core.arcLock ? t('sheet.now.arcLocked') : undefined,
            ),
        ]),
    );
    const corruption = live.corruption;
    const setCorruption = (patch: Partial<CharacterState['corruption']>) =>
        b.editLive((cs) => void (cs.corruption = { ...cs.corruption, ...patch }));
    const corruptionList = (field: 'gifts' | 'brands', label: string) =>
        row(
            label,
            listEditor({
                items: corruption[field],
                label,
                addLabel: t('sheet.list.add'),
                removeLabel: t('sheet.list.remove'),
                max: 6,
                key: k(`corruption.${field}`),
                onCommit: (items) => setCorruption({ [field]: cleanList(items, 6, LIMITS.name) }),
            }),
        );
    out.push(
        block(t('sheet.field.corruption'), [
            row(
                t('sheet.now.corruptionLevel'),
                rangeInput({
                    value: corruption.level,
                    min: 0,
                    max: 10,
                    label: t('sheet.now.corruptionLevel'),
                    words: w.corruption,
                    key: k('corruption.level'),
                    onCommit: (level) => setCorruption({ level }),
                }),
            ),
            row(
                t('sheet.now.stains'),
                numberField({
                    value: corruption.stains,
                    min: 0,
                    max: 99,
                    label: t('sheet.now.stains'),
                    key: k('corruption.stains'),
                    onCommit: (stains) => setCorruption({ stains: stains ?? 0 }),
                }),
            ),
            corruptionList('gifts', t('sheet.now.gifts')),
            corruptionList('brands', t('sheet.now.brands')),
        ]),
    );
    return out;
}

function renderEmotion(b: ProfileBind, live: CharacterState, turn: number): HTMLElement {
    const t = b.ctx.t;
    const w = words(b.ctx);
    const k = (path: string) => b.key(`now.emotion.${path}`);
    const emotion = live.emotion;
    if (!emotion) {
        return block(t('sheet.now.emotion'), [
            el('div', { class: 'dramatis-muted', text: t('sheet.now.noEmotion') }),
            keyed(
                button({
                    icon: 'fa-plus',
                    label: t('sheet.now.addEmotion'),
                    kind: 'ghost',
                    onClick: () =>
                        b.editLive(
                            (cs) =>
                                void (cs.emotion = {
                                    type: 'anger',
                                    intensity: 2,
                                    target: '',
                                    cause: '',
                                    until: turn + 3,
                                }),
                        ),
                }),
                k('add'),
            ),
        ]);
    }
    const patch = (change: Partial<Emotion>) =>
        b.editLive((cs) => {
            if (cs.emotion) cs.emotion = { ...cs.emotion, ...change };
        });
    return block(t('sheet.now.emotion'), [
        row(
            t('sheet.emotion.type'),
            textInput({
                value: emotion.type,
                label: t('sheet.emotion.type'),
                key: k('type'),
                onCommit: (value) => patch({ type: cleanText(value, LIMITS.name) || emotion.type }),
            }),
            t('sheet.emotion.typeHint'),
        ),
        row(
            t('sheet.emotion.intensity'),
            rangeInput({
                value: emotion.intensity,
                min: 1,
                max: 5,
                label: t('sheet.emotion.intensity'),
                words: w.intensity,
                key: k('intensity'),
                onCommit: (intensity) => patch({ intensity }),
            }),
        ),
        row(
            t('sheet.emotion.target'),
            keyed(
                select({
                    value: emotion.target,
                    options: whoOptions(b),
                    label: t('sheet.emotion.target'),
                    onChange: (target) => patch({ target }),
                }),
                k('target'),
            ),
        ),
        row(
            t('sheet.emotion.cause'),
            textInput({
                value: emotion.cause,
                label: t('sheet.emotion.cause'),
                key: k('cause'),
                onCommit: (value) => patch({ cause: cleanText(value, LIMITS.short) }),
            }),
        ),
        row(
            t('sheet.emotion.until'),
            numberField({
                value: emotion.until,
                min: 0,
                max: 999999,
                label: t('sheet.emotion.until'),
                key: k('until'),
                onCommit: (until) => patch({ until: until ?? turn }),
            }),
            t('sheet.emotion.untilHint', { turn }),
        ),
        keyed(
            button({
                icon: 'fa-xmark',
                kind: 'ghost',
                label: t('sheet.now.clearEmotion'),
                onClick: () => b.editLive((cs) => void delete cs.emotion),
            }),
            k('clear'),
        ),
    ]);
}

function renderLiveIntentions(b: ProfileBind, live: CharacterState): HTMLElement {
    const { ctx, profile } = b;
    const t = ctx.t;
    const intentions = live.agenda.intentions;
    const save = (next: Intention[]) =>
        b.editLive((cs) => void (cs.agenda = { ...cs.agenda, intentions: next.slice(0, LIMITS.intentions) }));
    const rows = intentions.map((intention, index) => {
        const patch = (change: Partial<Intention>) =>
            save(intentions.map((item, i) => (i === index ? { ...item, ...change } : item)));
        const content = el('div', { class: 'dramatis-sheet-item' }, [
            textInput({
                value: intention.text,
                label: t('sheet.intention.text'),
                multiline: true,
                key: b.key(`now.intentions.${intention.id}.text`),
                onCommit: (value) => {
                    const text = cleanText(value);
                    return text ? patch({ text }) : save(intentions.filter((_, i) => i !== index));
                },
            }),
            row(
                t('sheet.intention.nextStep'),
                textInput({
                    value: intention.nextStep,
                    label: t('sheet.intention.nextStep'),
                    key: b.key(`now.intentions.${intention.id}.nextStep`),
                    onCommit: (value) => patch({ nextStep: cleanText(value, LIMITS.short) }),
                }),
            ),
            intention.clock
                ? row(
                      t('sheet.clock.title'),
                      clockEditor(
                          b,
                          `now.intentions.${intention.id}.clock`,
                          intention.clock,
                          { min: 2, max: 12 },
                          (clock) => patch({ clock }),
                      ),
                  )
                : null,
            button({
                icon: 'fa-trash-can',
                kind: 'ghost',
                label: t('sheet.remove'),
                onClick: () => save(intentions.filter((_, i) => i !== index)),
            }),
        ]);
        return isHiddenIntention(intention)
            ? spoiler(ctx, `${profile.id}:now-intention:${intention.id}`, () => content)
            : content;
    });
    return block(t('sheet.agenda.intentions'), [
        ...(rows.length ? rows : [el('div', { class: 'dramatis-muted', text: t('sheet.now.noIntentions') })]),
    ]);
}

function renderScheme(b: ProfileBind, scheme: Scheme): HTMLElement {
    const t = b.ctx.t;
    const k = (path: string) => b.key(`now.schemes.${scheme.id}.${path}`);
    const patch = (change: Partial<Scheme>) =>
        b.ctx.save(
            b.ctx.engine.updateState((state) => {
                const at = state.schemes.findIndex((item) => item.id === scheme.id);
                if (at >= 0) state.schemes[at] = { ...state.schemes[at]!, ...change };
            }),
        );
    return block(
        t('sheet.scheme.title', { target: nameOf(b.ctx.view, scheme.target) }),
        [
            row(
                t('sheet.scheme.text'),
                textInput({
                    value: scheme.text,
                    label: t('sheet.scheme.text'),
                    multiline: true,
                    key: k('text'),
                    onCommit: (value) => patch({ text: cleanText(value) || scheme.text }),
                }),
            ),
            row(t('sheet.scheme.method'), el('span', { text: methodLabel(scheme.method, b.ctx.lang) })),
            row(
                t('sheet.clock.title'),
                clockEditor(b, `now.schemes.${scheme.id}.clock`, scheme.clock, { min: 4, max: 8 }, (clock) =>
                    patch({ clock }),
                ),
            ),
            row(
                t('sheet.scheme.secrecy'),
                numberField({
                    value: scheme.secrecy,
                    min: 0,
                    max: 100,
                    label: t('sheet.scheme.secrecy'),
                    key: k('secrecy'),
                    onCommit: (secrecy) => patch({ secrecy: secrecy ?? scheme.secrecy }),
                }),
                t('sheet.scheme.breaches', { n: scheme.breaches }),
            ),
            row(
                t('sheet.scheme.state'),
                keyed(
                    select({
                        value: scheme.state,
                        options: SCHEME_STATES.map((value) => ({ value, label: t(`sheet.scheme.state.${value}`) })),
                        label: t('sheet.scheme.state'),
                        onChange: (value) => patch({ state: value }),
                    }),
                    k('state'),
                ),
            ),
        ],
        'dramatis-sheet-card',
    );
}

/** «История»: the story log lines of this character, newest first. */
export function renderHistory(b: ProfileBind): HTMLElement[] {
    const t = b.ctx.t;
    const tr = (part: string) => b.ctx.tr(part);
    const lines = b.ctx.view.state.log.filter((event) => event.character === b.profile.id).reverse();
    if (!lines.length) return [emptyState(t('sheet.history.none'))];
    return [
        el(
            'ol',
            { class: 'dramatis-sheet-log', attrs: { reversed: true } },
            lines.map((event) =>
                el('li', { class: 'dramatis-sheet-log-line', data: { kind: event.kind } }, [
                    el('span', { class: 'dramatis-sheet-log-turn', text: t('sheet.history.turn', { n: event.turn }) }),
                    el('span', { class: 'dramatis-sheet-log-text', text: translateSegments(event.text, tr) }),
                ]),
            ),
        ),
    ];
}
