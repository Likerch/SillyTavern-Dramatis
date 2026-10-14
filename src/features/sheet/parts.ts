// Building blocks of the sheet pages: provenance (origin badge, lock, evidence quotes), field rows, controls bound to
// a profile path, ladder words for the scales. Every control commits through the EngineApi (edits.ts).
import { STANCES } from '../../domain/model';
import type { CharacterProfile, CharacterState, ChatState, FieldMeta, Origin, Stance } from '../../domain/model';
import { stanceBehaviour, stanceLabel } from '../../domain/ladders';
import type { Gender } from '../../domain/ladders';
import { PROVISIONAL_SOURCES } from '../../domain/newcomers';
import { LIMITS, cleanList, cleanText, getPath, isCardMeta, isLocked, metaAt } from '../../domain/profile-defaults';
import { select } from '../../ui/controls';
import type { SelectOption } from '../../ui/controls';
import { button, el } from '../../ui/dom';
import type { Child } from '../../ui/dom';
import { KEY_ATTR, chips, listEditor, numberField, rangeInput, textInput } from '../../ui/form';
import type { ChipOption } from '../../ui/form';
import { editCharState, editProfile, metaUnit, toggleProfileLock } from './edits';
import type { SheetCtx } from './types';

export interface MetaHolder {
    meta: Record<string, FieldMeta>;
}

/* ------------------------------------------------------------------ small helpers */

/** +1, −0.5, 0 — a signed number with a real minus sign. */
export function signed(value: number): string {
    const rounded = Math.round(value * 100) / 100;
    if (rounded > 0) return `+${rounded}`;
    if (rounded < 0) return `−${Math.abs(rounded)}`;
    return '0';
}

export function str(value: unknown): string {
    return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

export function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Gives a button a stable key so the focus comes back to it after a re-render. */
export function keyed<T extends HTMLElement>(node: T, key: string): T {
    node.setAttribute(KEY_ATTR, key);
    return node;
}

/** A word of a numeric scale from the strings (`sheet.scale.<scale>.<value>`). */
export function scaleWord(ctx: SheetCtx, scale: string, value: number): string {
    return ctx.t(`sheet.scale.${scale}.${Math.round(value)}`);
}

export function stanceOptions(ctx: SheetCtx, gender?: Gender): SelectOption<string>[] {
    return STANCES.map((stance) => ({
        value: String(stance),
        label: `${stanceLabel(stance, ctx.lang, gender)} (${signed(stance)})`,
    }));
}

/** The stance word coloured by its step (-3 … +3). */
export function stanceChip(ctx: SheetCtx, stance: Stance | number, gender?: Gender): HTMLElement {
    const step = Math.max(-3, Math.min(3, Math.round(stance)));
    return el('span', {
        class: 'dramatis-stance',
        data: { stance: String(step) },
        text: stanceLabel(step, ctx.lang, gender),
        title: stanceBehaviour(step, ctx.lang),
    });
}

export function emptyState(text: string, children?: Child[]): HTMLElement {
    return el('div', { class: 'dramatis-sheet-empty' }, [
        el('p', { class: 'dramatis-placeholder', text }),
        ...(children ?? []),
    ]);
}

/** A labelled row inside a block. */
export function row(label: string, control: Child, hint?: string): HTMLElement {
    return el('div', { class: 'dramatis-sheet-field' }, [
        el('div', { class: 'dramatis-sheet-label', text: label }),
        el('div', { class: 'dramatis-sheet-control' }, [control]),
        hint ? el('div', { class: 'dramatis-field-hint', text: hint }) : null,
    ]);
}

/** A sub-heading of a section. */
export function heading(text: string): HTMLElement {
    return el('h4', { class: 'dramatis-sheet-heading', text });
}

/** A short preview of any stored value (diff lists, read-only places). */
export function summarize(value: unknown, max = 140): string {
    const clip = (text: string) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
    if (value === undefined || value === null || value === '') return '—';
    if (typeof value === 'string') return clip(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return clip(value.map((item) => summarize(item, max)).join('; ')) || '—';
    if (typeof value === 'object') {
        const dict = value as Record<string, unknown>;
        for (const key of ['text', 'label', 'concept', 'ghost', 'claim', 'impulse', 'what', 'holders', 'name']) {
            if (typeof dict[key] === 'string' && dict[key]) return clip(dict[key] as string);
        }
        if (typeof dict.stance === 'number') return signed(dict.stance);
        if (Array.isArray(dict.top)) return summarize(dict.top, max);
        try {
            return clip(JSON.stringify(value));
        } catch {
            return '…';
        }
    }
    return clip(String(value));
}

/* ------------------------------------------------------------------ provenance */

export interface UnitOptions {
    title: string;
    holder: MetaHolder;
    unit: string;
    /** Prefix of keys (focus restore, open quotes): unique per holder. */
    keyPrefix: string;
    onLock(): Promise<void>;
    actions?: Child[];
    hint?: string;
    className?: string;
}

/**
 * A block of one provenance unit: title, origin badge (only when the field has a source), lock toggle, the evidence
 * quotes behind a toggle, then the controls.
 */
export function unitBlock(ctx: SheetCtx, options: UnitOptions, children: Child[]): HTMLElement {
    const meta = metaAt(options.holder, options.unit);
    const locked = isLocked(options.holder, options.unit);
    const quotesKey = `quotes:${options.keyPrefix}:${options.unit}`;
    const quotes = meta?.evidence ?? [];
    const open = ctx.session.expanded.has(quotesKey);

    const head: Child[] = [el('div', { class: 'dramatis-sheet-unit-title', text: options.title })];
    if (meta) head.push(originBadge(ctx, meta.origin, isCardMeta(meta), isGuess(meta)));
    const lock = keyed(
        button({
            icon: locked ? 'fa-lock' : 'fa-lock-open',
            kind: 'ghost',
            title: ctx.t(locked ? 'sheet.lock.on' : 'sheet.lock.off'),
            className: ['dramatis-sheet-lock', locked ? 'dramatis-sheet-locked' : ''].join(' ').trim(),
            onClick: () => options.onLock(),
        }),
        `${options.keyPrefix}:${options.unit}:lock`,
    );
    lock.setAttribute('aria-pressed', String(locked));
    head.push(lock);
    if (quotes.length) {
        const toggle = keyed(
            button({
                icon: 'fa-quote-left',
                label: String(quotes.length),
                kind: 'ghost',
                title: ctx.t(open ? 'sheet.quotes.hide' : 'sheet.quotes.show'),
                className: 'dramatis-sheet-quotes-toggle',
                onClick: () => {
                    if (open) ctx.session.expanded.delete(quotesKey);
                    else ctx.session.expanded.add(quotesKey);
                    ctx.rerender();
                },
            }),
            `${quotesKey}:toggle`,
        );
        toggle.setAttribute('aria-expanded', String(open));
        head.push(toggle);
    }
    if (options.actions?.length) head.push(el('span', { class: 'dramatis-sheet-unit-actions' }, options.actions));

    const sources = meta?.sources?.length ? meta.sources.join(', ') : '';
    return el('div', { class: ['dramatis-sheet-unit', options.className], data: { unit: options.unit } }, [
        el('div', { class: 'dramatis-sheet-unit-head' }, head),
        open && quotes.length
            ? el('ul', { class: 'dramatis-sheet-quotes', attrs: { 'aria-label': ctx.t('sheet.quotes.title') } }, [
                  ...quotes.map((quote) => el('li', { text: `«${quote}»` })),
                  sources
                      ? el('li', { class: 'dramatis-muted', text: ctx.t('sheet.quotes.sources', { sources }) })
                      : null,
              ])
            : null,
        options.hint ? el('div', { class: 'dramatis-field-hint', text: options.hint }) : null,
        el('div', { class: 'dramatis-sheet-unit-body' }, children),
    ]);
}

/** A generated value the dice drew or a role template gave: a provisional guess the story may replace. */
export function isGuess(meta: FieldMeta | undefined): boolean {
    return meta?.origin === 'generated' && !!meta.sources?.some((source) => PROVISIONAL_SOURCES.includes(source));
}

/**
 * The provenance badge; `fromCard`: the author wrote it into the card's structured intent («автор · в карточке»), not
 * read from the text; `guess`: the dice or a template made it («✎ догадка»).
 */
export function originBadge(ctx: SheetCtx, origin: Origin, fromCard = false, guess = false): HTMLElement {
    const key = fromCard ? 'card' : guess ? 'guess' : origin;
    return el('span', {
        class: 'dramatis-sheet-origin',
        data: { origin: key },
        text: ctx.t(`sheet.origin.${key}`),
        title: ctx.t(`sheet.origin.${key}.hint`),
    });
}

/* ------------------------------------------------------------------ a profile bound to the engine */

export interface ProfileBind {
    ctx: SheetCtx;
    profile: CharacterProfile;
    live: CharacterState | undefined;
    key(path: string): string;
    /** A user edit of `path` (value replaced, unit marked as the user's). */
    edit(path: string, value: unknown): Promise<void>;
    update(path: string, updater: (current: unknown) => unknown): Promise<void>;
    lock(unit: string): Promise<void>;
    editLive(mutate: (live: CharacterState, state: ChatState) => void): Promise<void>;
}

export function bindProfile(ctx: SheetCtx, profile: CharacterProfile): ProfileBind {
    const id = profile.id;
    return {
        ctx,
        profile,
        live: ctx.view.state.characters[id],
        key: (path) => `${id}:${path}`,
        edit: (path, value) => ctx.save(editProfile(ctx.engine, id, path, () => value)),
        update: (path, updater) => ctx.save(editProfile(ctx.engine, id, path, updater)),
        lock: (unit) => ctx.save(toggleProfileLock(ctx.engine, id, unit)),
        editLive: (mutate) => ctx.save(editCharState(ctx.engine, id, mutate)),
    };
}

/** A unit block of a profile path. */
export function profileUnit(
    b: ProfileBind,
    title: string,
    path: string,
    children: Child[],
    extra: Partial<Pick<UnitOptions, 'actions' | 'hint' | 'className'>> = {},
): HTMLElement {
    const unit = metaUnit(path);
    return unitBlock(
        b.ctx,
        { title, holder: b.profile, unit, keyPrefix: b.profile.id, onLock: () => b.lock(unit), ...extra },
        children,
    );
}

/* ------------------------------------------------------------------ controls bound to a profile path */

export interface TextCtlOptions {
    multiline?: boolean;
    /** Empty removes the field (optional fields: want, need, voice…). */
    optional?: boolean;
    max?: number;
    placeholder?: string;
}

export function textCtl(b: ProfileBind, path: string, label: string, options: TextCtlOptions = {}): HTMLElement {
    return textInput({
        value: str(getPath(b.profile, path)),
        label,
        placeholder: options.placeholder,
        multiline: options.multiline,
        key: b.key(path),
        onCommit: (value) => {
            const clean = cleanText(value, options.max ?? LIMITS.text);
            return b.edit(path, clean || (options.optional ? undefined : ''));
        },
    });
}

export interface ListCtlOptions {
    max?: number;
    maxLength?: number;
    multiline?: boolean;
}

export function listCtl(b: ProfileBind, path: string, label: string, options: ListCtlOptions = {}): HTMLElement {
    const max = options.max ?? LIMITS.agendaList;
    return listEditor({
        items: strings(getPath(b.profile, path)),
        label,
        addLabel: b.ctx.t('sheet.list.add'),
        removeLabel: b.ctx.t('sheet.list.remove'),
        max,
        multiline: options.multiline,
        key: b.key(path),
        onCommit: (items) => b.edit(path, cleanList(items, max, options.maxLength ?? LIMITS.short)),
    });
}

export interface SelectCtlOptions {
    /** Label of an empty choice that removes the field. */
    none?: string;
    /** Values are numbers (scales, stances). */
    numeric?: boolean;
}

/** A select of enum values (or numbers of a scale). */
export function selectCtl(
    b: ProfileBind,
    path: string,
    label: string,
    options: SelectOption<string>[],
    settings: SelectCtlOptions = {},
): HTMLSelectElement {
    const current = getPath(b.profile, path);
    const list = settings.none !== undefined ? [{ value: '', label: settings.none }, ...options] : options;
    const node = select({
        value: current === undefined || current === null ? '' : String(current),
        options: list,
        label,
        onChange: (value) => {
            if (value === '') return b.edit(path, undefined);
            return b.edit(path, settings.numeric ? Number(value) : value);
        },
    });
    return keyed(node, b.key(path));
}

export interface RangeCtlOptions {
    min: number;
    max: number;
    step?: number;
    fallback?: number;
    words?: (value: number) => string;
}

export function rangeCtl(b: ProfileBind, path: string, label: string, options: RangeCtlOptions): HTMLElement {
    const current = getPath(b.profile, path);
    return rangeInput({
        value: typeof current === 'number' ? current : (options.fallback ?? options.min),
        min: options.min,
        max: options.max,
        step: options.step,
        label,
        words: options.words,
        key: b.key(path),
        onCommit: (value) => b.edit(path, value),
    });
}

export function numberCtl(
    b: ProfileBind,
    path: string,
    label: string,
    options: { min?: number; max?: number; step?: number; fallback?: number } = {},
): HTMLInputElement {
    const current = getPath(b.profile, path);
    return numberField({
        value: typeof current === 'number' ? current : (options.fallback ?? 0),
        label,
        min: options.min,
        max: options.max,
        step: options.step,
        key: b.key(path),
        onCommit: (value) => b.edit(path, value ?? options.fallback ?? 0),
    });
}

/** A checkbox; `unsetWhenOff` removes the field instead of storing false (optional flags). */
export function toggleCtl(b: ProfileBind, path: string, label: string, unsetWhenOff = false): HTMLElement {
    const id = `${b.key(path)}:toggle`;
    const input = el('input', { attrs: { type: 'checkbox', [KEY_ATTR]: id, 'aria-label': label } });
    input.checked = getPath(b.profile, path) === true;
    input.addEventListener('change', () => {
        void b.edit(path, input.checked ? true : unsetWhenOff ? undefined : false);
    });
    return el('label', { class: 'checkbox_label dramatis-sheet-check' }, [input, el('span', { text: label })]);
}

export function chipsCtl<T extends string>(
    b: ProfileBind,
    path: string,
    label: string,
    options: ChipOption<T>[],
    max?: number,
    fallback?: T[],
): HTMLElement {
    return chips({
        options,
        selected: strings(getPath(b.profile, path)) as T[],
        label,
        max,
        key: b.key(path),
        onCommit: (values) => b.edit(path, values.length || !fallback ? values : fallback),
    });
}
