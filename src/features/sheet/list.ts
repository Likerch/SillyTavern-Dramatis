// The first page of the sheet: the header (card, world tone, counts, reading the author's intent with its warnings
// and re-read differences) and the cast list with a filter, links to the world pages and adding a character or a
// group.
import { PLAYER_ID } from '../../domain/model';
import type { CharacterProfile, WorldTone } from '../../domain/model';
import { whoOf } from '../../domain/translate';
import { appetiteKindLabel, bandLabel, lodLabel, worldToneLabel } from '../../domain/ladders';
import { LIMITS, cleanText } from '../../domain/profile-defaults';
import { select } from '../../ui/controls';
import { button, el } from '../../ui/dom';
import { textInput } from '../../ui/form';
import { addCharacter, nameOf, setWorldTone, toggleCardLock } from './edits';
import { emptyState, keyed, stanceChip, summarize, unitBlock } from './parts';
import { overrideCount } from './levers';
import { isHiddenAppetite, spoiler } from './secrets';
import { FILTERS } from './types';
import type { IntentApi, IntentReadResult, ListFilter, SheetCtx } from './types';
import { words } from './words';

const TONES: readonly WorldTone[] = ['hostile', 'indifferent', 'neutral', 'welcoming'];

/** The intent reading as the header sees it (state kept by the view). */
export interface IntentPanel {
    api: IntentApi | undefined;
    busy: boolean;
    result: IntentReadResult | null;
    /** Indexes of diff entries already taken back. */
    taken: ReadonlySet<number>;
    read(force: boolean): Promise<void>;
    take(index: number): Promise<void>;
    dismiss(): void;
}

export function cardName(ctx: SheetCtx): string {
    try {
        const name = ctx.app.readers.card.current()?.name;
        if (name) return name;
    } catch {
        // The reader is optional here: fall back to the card key.
    }
    return ctx.view.card.card.replace(/\.[a-z0-9]+$/i, '');
}

function intentButton(ctx: SheetCtx, intent: IntentPanel, big = false): HTMLElement {
    const t = ctx.t;
    const again = !!ctx.view.card.intent;
    const running = intent.busy || (intent.api?.running() ?? false);
    const node = keyed(
        button({
            icon: running ? 'fa-spinner' : again ? 'fa-rotate' : 'fa-book-open',
            label: running ? t('sheet.intent.running') : t(again ? 'sheet.intent.reread' : 'sheet.intent.read'),
            kind: big ? 'primary' : 'default',
            disabled: !intent.api || running,
            title: intent.api
                ? t(again ? 'sheet.intent.rereadHint' : 'sheet.intent.readHint')
                : t('sheet.intent.unavailable'),
            className: big ? 'dramatis-sheet-big' : undefined,
            onClick: () => intent.read(again),
        }),
        big ? 'intent:read-big' : 'intent:read',
    );
    node.dataset.intent = again ? 'reread' : 'read';
    return node;
}

/** Warnings and the re-read differences of the last reading. */
function intentResult(ctx: SheetCtx, intent: IntentPanel): HTMLElement | null {
    const result = intent.result;
    if (!result) return null;
    const t = ctx.t;
    const parts: (Node | null)[] = [];
    if (!result.ok) {
        parts.push(
            el('div', { class: 'dramatis-error-text', text: t('sheet.intent.failed', { error: result.error ?? '' }) }),
        );
    } else {
        const summary = result.skipped
            ? (result.message ?? t('sheet.intent.skipped'))
            : (result.message ?? t('sheet.intent.done', { n: result.characters }));
        parts.push(el('div', { text: summary }));
    }
    if (result.warnings.length) {
        // Collapsed: a careful reading leaves many fields out (no quote, no field) — the rule working, not an error.
        parts.push(
            el('details', { class: 'dramatis-sheet-warnings-box' }, [
                el('summary', { text: t('sheet.intent.warningsCount', { n: result.warnings.length }) }),
                el('ul', { class: 'dramatis-sheet-warnings', attrs: { 'aria-label': t('sheet.intent.warnings') } }, [
                    ...result.warnings.map((warning) => el('li', { text: warning })),
                ]),
            ]),
        );
    }
    if (result.diff.length) {
        parts.push(el('div', { class: 'dramatis-sheet-unit-title', text: t('sheet.intent.diff') }));
        parts.push(
            el(
                'ul',
                { class: 'dramatis-sheet-diff' },
                result.diff.map((entry, index) => {
                    const exists = !entry.character || ctx.view.byId.has(entry.character);
                    const who = entry.character ? nameOf(ctx.view, entry.character) : t('sheet.intent.cardLevel');
                    const kept = entry.status === 'kept-user' || entry.status === 'kept-locked';
                    const taken = intent.taken.has(index);
                    return el('li', { class: 'dramatis-sheet-diff-item', data: { status: entry.status } }, [
                        el('div', { class: 'dramatis-sheet-diff-head' }, [
                            el('strong', { text: who }),
                            el('span', { class: 'dramatis-muted', text: fieldLabel(ctx, entry.path) }),
                            el('span', {
                                class: 'dramatis-sheet-tag',
                                text: known(ctx, `sheet.diff.${entry.status}`) ?? entry.status,
                            }),
                        ]),
                        el('div', { class: 'dramatis-sheet-diff-values' }, [
                            el('span', { class: 'dramatis-muted', text: t('sheet.diff.now') }),
                            el('span', { text: summarize(entry.before) }),
                            el('span', { class: 'dramatis-muted', text: t('sheet.diff.author') }),
                            el('span', { text: summarize(entry.after) }),
                        ]),
                        kept && exists && !taken
                            ? keyed(
                                  button({
                                      icon: 'fa-feather-pointed',
                                      label: t('sheet.diff.take'),
                                      kind: 'ghost',
                                      className: 'dramatis-sheet-take',
                                      onClick: () => intent.take(index),
                                  }),
                                  `intent:take:${index}`,
                              )
                            : null,
                        taken ? el('span', { class: 'dramatis-muted', text: t('sheet.diff.taken') }) : null,
                    ]);
                }),
            ),
        );
    }
    return el('div', { class: 'dramatis-sheet-intent', attrs: { role: 'status' } }, [
        ...parts,
        button({ icon: 'fa-xmark', label: t('sheet.intent.dismiss'), kind: 'ghost', onClick: () => intent.dismiss() }),
    ]);
}

/** The string of a key, or null when there is none (i18n returns the key itself then). */
function known(ctx: SheetCtx, key: string): string | null {
    const text = ctx.t(key);
    return text === key ? null : text;
}

/** Human label of a profile path from the diff ('core.values' → «Ценности»). */
export function fieldLabel(ctx: SheetCtx, path: string): string {
    const parts = path.split('.');
    const head = parts[0] ?? '';
    const t = ctx.t;
    if (head === 'ties' && parts[1]) return t('sheet.path.tie', { target: nameOf(ctx.view, parts.slice(1).join('.')) });
    if (head === 'appetites' && parts[1]) return t('sheet.path.appetite', { id: parts[1] });
    if (head === 'rules' && parts[1]) return t('sheet.path.rule', { id: parts[1] });
    if (head === 'core' || head === 'agenda') {
        return known(ctx, `sheet.field.${parts[1]}`) ?? known(ctx, `sheet.agenda.${parts[1]}`) ?? path;
    }
    return known(ctx, `sheet.field.${head}`) ?? known(ctx, `sheet.path.${head}`) ?? path;
}

function header(ctx: SheetCtx, intent: IntentPanel): HTMLElement {
    const t = ctx.t;
    const { view } = ctx;
    const characters = view.profiles.filter((profile) => profile.kind === 'character').length;
    const groups = view.profiles.length - characters;
    const tone = unitBlock(
        ctx,
        {
            title: t('sheet.header.tone'),
            holder: view.card,
            unit: 'worldTone',
            keyPrefix: 'card',
            onLock: () => ctx.save(toggleCardLock(ctx.engine, 'worldTone')),
        },
        [
            keyed(
                select({
                    value: view.state.worldTone,
                    options: TONES.map((value) => ({ value, label: worldToneLabel(value, ctx.lang) })),
                    label: t('sheet.header.tone'),
                    onChange: (value) => ctx.save(setWorldTone(ctx.engine, value)),
                }),
                'card:worldTone',
            ),
        ],
    );
    return el('div', { class: 'dramatis-sheet-header' }, [
        el('div', { class: 'dramatis-sheet-header-top' }, [
            el('h3', { class: 'dramatis-sheet-title', text: cardName(ctx) }),
            intentButton(ctx, intent),
        ]),
        el('div', {
            class: 'dramatis-sheet-counts dramatis-muted',
            text: t('sheet.header.counts', {
                characters,
                groups,
                present: view.present.length,
            }),
        }),
        tone,
        intent.api ? null : el('div', { class: 'dramatis-field-hint', text: t('sheet.intent.unavailable') }),
        intentResult(ctx, intent),
    ]);
}

/** A row of the list: everything one needs to know at a glance; a click opens the character. */
function listRow(ctx: SheetCtx, profile: CharacterProfile): HTMLElement {
    const t = ctx.t;
    const view = ctx.view;
    const live = view.state.characters[profile.id];
    const present = view.present.includes(profile.id);
    const band = view.bands[profile.id];
    const playerTie = live?.ties[PLAYER_ID] ?? profile.ties.find((tie) => tie.target === PLAYER_ID);
    const extra = view.state.extras.some((other) => other.id === profile.id);
    const who = whoOf(profile);
    const sub = [
        ctx.tr(profile.role, who),
        ctx.tr(profile.species, who),
        profile.kind === 'group' ? t('sheet.kind.group') : '',
    ]
        .filter(Boolean)
        .join(' · ');

    // The strongest appetite now: live pressure, else the baseline.
    let strongest: { label: string; pressure: number; hidden: boolean } | null = null;
    for (const appetite of profile.appetites) {
        const pressure = live?.appetites[appetite.id]?.pressure ?? appetite.baseline;
        if (pressure <= 0 || (strongest && strongest.pressure >= pressure)) continue;
        strongest = {
            label: appetite.label ? ctx.tr(appetite.label, who) : appetiteKindLabel(appetite.kind, ctx.lang),
            pressure,
            hidden: isHiddenAppetite(appetite),
        };
    }
    const schemes = view.state.schemes.filter(
        (scheme) => scheme.owner === profile.id && (scheme.state === 'running' || scheme.state === 'ready'),
    ).length;

    const tags: (Node | null)[] = [
        el('span', { class: 'dramatis-sheet-tag', data: { lod: profile.lod }, text: lodLabel(profile.lod, ctx.lang) }),
        present
            ? el('span', { class: ['dramatis-sheet-tag', 'dramatis-sheet-tag-on'], text: t('sheet.present.yes') })
            : null,
        present && band
            ? el('span', { class: 'dramatis-sheet-tag', data: { band }, text: bandLabel(band, ctx.lang) })
            : null,
        extra ? el('span', { class: 'dramatis-sheet-tag', text: t('sheet.extra') }) : null,
    ];
    const facts: (Node | null)[] = [];
    if (playerTie) {
        facts.push(
            el('span', { class: 'dramatis-sheet-fact' }, [
                el('span', { class: 'dramatis-muted', text: t('sheet.list.toPlayer') }),
                stanceChip(ctx, playerTie.stance, profile.gender),
            ]),
        );
    }
    if (strongest) {
        const appetite = strongest;
        const text = el('span', { class: 'dramatis-sheet-fact' }, [
            el('span', { class: 'dramatis-muted', text: `${appetite.label}:` }),
            el('span', {
                class: 'dramatis-sheet-pressure',
                text: words(ctx).pressure(appetite.pressure, profile.gender),
            }),
        ]);
        facts.push(appetite.hidden ? spoiler(ctx, `${profile.id}:list-appetite`, () => text) : text);
    }
    if (schemes) {
        const text = el('span', { class: 'dramatis-sheet-fact', text: t('sheet.list.schemes', { n: schemes }) });
        facts.push(spoiler(ctx, `${profile.id}:list-schemes`, () => text));
    }

    const open = keyed(
        button({
            label: profile.name,
            kind: 'ghost',
            className: 'dramatis-sheet-row-open',
            title: t('sheet.list.open', { name: profile.name }),
            onClick: () => ctx.navigate({ page: 'character', id: profile.id }),
        }),
        `row:${profile.id}`,
    );
    return el(
        'li',
        { class: ['dramatis-sheet-row', present && 'dramatis-sheet-row-present'], data: { id: profile.id } },
        [
            el('div', { class: 'dramatis-sheet-row-main' }, [open, el('span', { class: 'dramatis-sheet-tags' }, tags)]),
            sub ? el('div', { class: 'dramatis-sheet-row-sub dramatis-muted', text: sub }) : null,
            facts.length ? el('div', { class: 'dramatis-sheet-row-facts' }, facts) : null,
        ],
    );
}

function filterBar(ctx: SheetCtx, filter: ListFilter, setFilter: (filter: ListFilter) => void): HTMLElement {
    const t = ctx.t;
    return el(
        'div',
        { class: 'dramatis-sheet-filter', attrs: { role: 'group', 'aria-label': t('sheet.filter.label') } },
        FILTERS.map((value) => {
            const node = keyed(
                button({
                    label: t(`sheet.filter.${value}`),
                    kind: value === filter ? 'primary' : 'ghost',
                    onClick: () => setFilter(value),
                }),
                `filter:${value}`,
            );
            node.setAttribute('aria-pressed', String(value === filter));
            return node;
        }),
    );
}

function addForm(ctx: SheetCtx): HTMLElement {
    const t = ctx.t;
    const name = textInput({
        value: '',
        label: t('sheet.add.name'),
        placeholder: t('sheet.add.name'),
        key: 'add:name',
        onCommit: () => undefined,
    }) as HTMLInputElement;
    name.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') void add('character');
    });
    const add = async (kind: CharacterProfile['kind']) => {
        const clean = cleanText(name.value, LIMITS.name);
        if (!clean) {
            name.focus();
            return;
        }
        let id: string | null = null;
        await ctx.save(
            addCharacter(ctx.engine, clean, kind).then((created) => {
                id = created;
                return created !== null;
            }),
        );
        if (id) ctx.navigate({ page: 'character', id });
    };
    return el('div', { class: 'dramatis-sheet-add' }, [
        name,
        keyed(
            button({ icon: 'fa-user-plus', label: t('sheet.add.character'), onClick: () => add('character') }),
            'add:character',
        ),
        keyed(button({ icon: 'fa-users', label: t('sheet.add.group'), onClick: () => add('group') }), 'add:group'),
    ]);
}

function worldLinks(ctx: SheetCtx): HTMLElement {
    const t = ctx.t;
    const view = ctx.view;
    const rules =
        view.card.rules.length +
        view.state.rules.filter((rule) => !view.card.rules.some((r) => r.id === rule.id)).length;
    const link = (page: 'rules' | 'reputation' | 'invariants' | 'metrics' | 'levers', icon: string, label: string) =>
        keyed(button({ icon, label, kind: 'ghost', onClick: () => ctx.navigate({ page }) }), `nav:${page}`);
    return el('div', { class: 'dramatis-sheet-links' }, [
        link('rules', 'fa-people-group', t('sheet.nav.rules', { n: rules })),
        link('reputation', 'fa-bullhorn', t('sheet.nav.reputation', { n: view.state.reputation.length })),
        link('invariants', 'fa-anchor', t('sheet.nav.invariants', { n: view.card.invariants.length })),
        link('metrics', 'fa-chart-simple', t('sheet.nav.metrics')),
        link('levers', 'fa-sliders', t('sheet.nav.levers', { n: overrideCount(ctx) })),
    ]);
}

export function renderList(
    ctx: SheetCtx,
    intent: IntentPanel,
    filter: ListFilter,
    setFilter: (filter: ListFilter) => void,
): HTMLElement[] {
    const t = ctx.t;
    const view = ctx.view;
    const out: HTMLElement[] = [header(ctx, intent)];
    if (!view.profiles.length) {
        out.push(
            emptyState(t('sheet.empty.noProfiles'), [
                intentButton(ctx, intent, true),
                el('p', { class: 'dramatis-muted', text: t('sheet.empty.orAdd') }),
                addForm(ctx),
            ]),
        );
        return out;
    }
    out.push(worldLinks(ctx));
    out.push(filterBar(ctx, filter, setFilter));
    const order = new Map(view.present.map((id, index) => [id, index] as const));
    const shown = view.profiles
        .filter((profile) =>
            filter === 'present' ? order.has(profile.id) : filter === 'groups' ? profile.kind === 'group' : true,
        )
        .map((profile, index) => ({ profile, index }))
        .sort(
            (a, b) =>
                (order.get(a.profile.id) ?? Number.MAX_SAFE_INTEGER) -
                    (order.get(b.profile.id) ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
        )
        .map((item) => item.profile);
    out.push(
        shown.length
            ? el(
                  'ul',
                  { class: 'dramatis-sheet-list', attrs: { 'aria-label': t('sheet.list.title') } },
                  shown.map((p) => listRow(ctx, p)),
              )
            : emptyState(t(`sheet.filter.empty.${filter}`)),
    );
    out.push(addForm(ctx));
    return out;
}
