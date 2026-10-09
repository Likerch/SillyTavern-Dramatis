// Editor controls (the intent sheet and other full editors): one-line and multi-line text, ranges that show a ladder
// word, lists of strings with add/remove, chips for unordered multi-choice. Every control commits on `change` (not on
// each keystroke), so a re-render between keystrokes never loses text, and carries `data-dramatis-key` so a view that
// re-renders can put the focus back on the same control. Text inputs mark themselves `data-dirty` while edited.
import { uid } from './controls';
import { button, el } from './dom';
import './form.css';

/** Attribute that identifies a control across re-renders (focus restore). */
export const KEY_ATTR = 'data-dramatis-key';

function keyAttrs(key: string | undefined): Record<string, string> {
    return key ? { [KEY_ATTR]: key } : {};
}

/** Marks text inputs dirty while the user types (a view should not re-render under him then). */
function trackDirty(node: HTMLInputElement | HTMLTextAreaElement): void {
    node.addEventListener('input', () => {
        node.dataset.dirty = '1';
    });
}

export interface TextInputOptions {
    value: string;
    /** Accessible name (also the placeholder unless one is given). */
    label: string;
    placeholder?: string;
    multiline?: boolean;
    rows?: number;
    key?: string;
    disabled?: boolean;
    onCommit(value: string): void | Promise<void>;
}

/** A text field that commits the trimmed value on change, only when it differs from the last committed one. */
export function textInput(options: TextInputOptions): HTMLInputElement | HTMLTextAreaElement {
    const attrs = {
        'aria-label': options.label,
        placeholder: options.placeholder,
        disabled: options.disabled === true,
        ...keyAttrs(options.key),
    };
    const node: HTMLInputElement | HTMLTextAreaElement = options.multiline
        ? el('textarea', {
              class: ['text_pole', 'dramatis-input', 'dramatis-textarea'],
              attrs: { ...attrs, rows: options.rows ?? 2 },
          })
        : el('input', { class: ['text_pole', 'dramatis-input'], attrs: { ...attrs, type: 'text' } });
    node.value = options.value;
    let committed = options.value.trim();
    trackDirty(node);
    node.addEventListener('change', () => {
        delete node.dataset.dirty;
        const value = node.value.trim();
        if (value === committed) return;
        committed = value;
        void options.onCommit(value);
    });
    return node;
}

export interface NumberFieldOptions {
    value: number | null;
    label: string;
    min?: number;
    max?: number;
    step?: number;
    key?: string;
    disabled?: boolean;
    /** Allows an empty field (commits null). */
    optional?: boolean;
    onCommit(value: number | null): void | Promise<void>;
}

/** A number field that clamps to min/max and commits on change; empty commits null when optional. */
export function numberField(options: NumberFieldOptions): HTMLInputElement {
    const node = el('input', {
        class: ['text_pole', 'dramatis-input', 'dramatis-number'],
        attrs: {
            type: 'number',
            inputmode: 'decimal',
            min: options.min,
            max: options.max,
            step: options.step ?? 1,
            'aria-label': options.label,
            disabled: options.disabled === true,
            ...keyAttrs(options.key),
        },
    });
    node.value = options.value === null ? '' : String(options.value);
    let committed = options.value;
    trackDirty(node);
    node.addEventListener('change', () => {
        delete node.dataset.dirty;
        const raw = node.value.trim();
        let value: number | null;
        if (!raw) {
            value = options.optional ? null : committed;
        } else {
            let n = Number(raw);
            if (!Number.isFinite(n)) n = committed ?? options.min ?? 0;
            if (options.min !== undefined) n = Math.max(options.min, n);
            if (options.max !== undefined) n = Math.min(options.max, n);
            value = n;
        }
        node.value = value === null ? '' : String(value);
        if (value === committed) return;
        committed = value;
        void options.onCommit(value);
    });
    return node;
}

export interface RangeOptions {
    value: number;
    min: number;
    max: number;
    step?: number;
    label: string;
    key?: string;
    disabled?: boolean;
    /** The word shown next to the slider (a ladder step); the number itself when absent. */
    words?: (value: number) => string;
    onCommit(value: number): void | Promise<void>;
}

/** A slider with the ladder word of its value; commits on change (keyboard arrows commit each step). */
export function rangeInput(options: RangeOptions): HTMLElement {
    const word = (value: number) => (options.words ? options.words(value) : String(value));
    const clampValue = (value: number) =>
        Math.min(options.max, Math.max(options.min, Number.isFinite(value) ? value : options.min));
    const start = clampValue(options.value);
    const input = el('input', {
        class: 'dramatis-range-input',
        attrs: {
            type: 'range',
            min: options.min,
            max: options.max,
            step: options.step ?? 1,
            'aria-label': options.label,
            'aria-valuetext': word(start),
            disabled: options.disabled === true,
            ...keyAttrs(options.key),
        },
    });
    input.value = String(start);
    const output = el('output', { class: 'dramatis-range-word', text: word(start), attrs: { 'aria-hidden': 'true' } });
    let committed = start;
    input.addEventListener('input', () => {
        const value = clampValue(Number(input.value));
        output.textContent = word(value);
        input.setAttribute('aria-valuetext', word(value));
    });
    input.addEventListener('change', () => {
        const value = clampValue(Number(input.value));
        if (value === committed) return;
        committed = value;
        void options.onCommit(value);
    });
    return el('div', { class: 'dramatis-range' }, [input, output]);
}

export interface ListEditorOptions {
    items: readonly string[];
    label: string;
    addLabel: string;
    removeLabel: string;
    placeholder?: string;
    max?: number;
    multiline?: boolean;
    key?: string;
    disabled?: boolean;
    onCommit(items: string[]): void | Promise<void>;
}

/** A list of strings: each item edits in place (emptying removes it), a last field adds one. */
export function listEditor(options: ListEditorOptions): HTMLElement {
    const items = [...options.items];
    const root = el('div', { class: 'dramatis-list', attrs: { role: 'group', 'aria-label': options.label } });
    items.forEach((item, index) => {
        const input = textInput({
            value: item,
            label: `${options.label} ${index + 1}`,
            multiline: options.multiline,
            key: options.key ? `${options.key}.${index}` : undefined,
            disabled: options.disabled,
            onCommit: (value) => {
                const next = [...items];
                if (value) next[index] = value;
                else next.splice(index, 1);
                return options.onCommit(next);
            },
        });
        const remove = button({
            icon: 'fa-xmark',
            kind: 'ghost',
            title: options.removeLabel,
            disabled: options.disabled,
            className: 'dramatis-list-remove',
            onClick: () => options.onCommit(items.filter((_, i) => i !== index)),
        });
        if (options.key) remove.setAttribute(KEY_ATTR, `${options.key}.${index}.remove`);
        root.appendChild(el('div', { class: 'dramatis-list-item' }, [input, remove]));
    });
    if (options.max === undefined || items.length < options.max) {
        let added = false;
        const field = textInput({
            value: '',
            label: options.addLabel,
            placeholder: options.placeholder ?? options.addLabel,
            multiline: options.multiline,
            key: options.key ? `${options.key}.new` : undefined,
            disabled: options.disabled,
            onCommit: (value) => {
                if (!value || added) return;
                added = true;
                return options.onCommit([...items, value]);
            },
        });
        const add = button({
            icon: 'fa-plus',
            kind: 'ghost',
            title: options.addLabel,
            disabled: options.disabled,
            className: 'dramatis-list-add',
            onClick: () => {
                const value = field.value.trim();
                if (!value || added) return;
                added = true;
                return options.onCommit([...items, value]);
            },
        });
        root.appendChild(el('div', { class: ['dramatis-list-item', 'dramatis-list-new'] }, [field, add]));
    }
    return root;
}

export interface ChipOption<T extends string> {
    value: T;
    label: string;
    hint?: string;
}

export interface ChipsOptions<T extends string> {
    options: readonly ChipOption<T>[];
    selected: readonly T[];
    label: string;
    /** At most this many may be chosen (the rest are disabled while the limit is reached). */
    max?: number;
    key?: string;
    disabled?: boolean;
    onCommit(values: T[]): void | Promise<void>;
}

/** Unordered multi-choice as checkbox chips; a new choice goes to the end, the order of the rest is kept. */
export function chips<T extends string>(options: ChipsOptions<T>): HTMLElement {
    const selected = [...options.selected];
    const full = options.max !== undefined && selected.length >= options.max;
    const root = el('div', { class: 'dramatis-chips', attrs: { role: 'group', 'aria-label': options.label } });
    for (const option of options.options) {
        const id = uid('dramatis-chip');
        const checked = selected.includes(option.value);
        const input = el('input', {
            attrs: {
                type: 'checkbox',
                id,
                disabled: options.disabled === true || (full && !checked),
                ...keyAttrs(options.key ? `${options.key}.${option.value}` : undefined),
            },
        });
        input.checked = checked;
        input.addEventListener('change', () => {
            const next = input.checked
                ? [...selected.filter((value) => value !== option.value), option.value]
                : selected.filter((value) => value !== option.value);
            void options.onCommit(next);
        });
        root.appendChild(
            el(
                'label',
                { class: ['dramatis-chip', checked && 'dramatis-chip-on'], attrs: { for: id }, title: option.hint },
                [input, el('span', { text: option.label })],
            ),
        );
    }
    return root;
}
