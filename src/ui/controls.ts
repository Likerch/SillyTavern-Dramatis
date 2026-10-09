// Form controls styled like SillyTavern's own (checkbox_label, text_pole), ported from Maestro.
import { el } from './dom';
import type { Child } from './dom';

let nextId = 0;

/** Unique id for label/for pairs. */
export function uid(prefix = 'dramatis'): string {
    nextId += 1;
    return `${prefix}-${nextId}`;
}

export interface ToggleOptions {
    label: string;
    checked: boolean;
    hint?: string;
    disabled?: boolean;
    onChange(checked: boolean): void | Promise<void>;
}

export function toggle(options: ToggleOptions): HTMLLabelElement {
    const id = uid('dramatis-toggle');
    const input = el('input', { attrs: { type: 'checkbox', id, disabled: options.disabled === true } });
    input.checked = options.checked;
    input.addEventListener('change', () => {
        void options.onChange(input.checked);
    });
    return el('label', { class: 'checkbox_label dramatis-toggle', attrs: { for: id }, title: options.hint }, [
        input,
        el('span', { text: options.label }),
    ]);
}

export interface SelectOption<T extends string> {
    value: T;
    label: string;
}

export interface SelectOptions<T extends string> {
    value: T;
    options: SelectOption<T>[];
    label?: string;
    disabled?: boolean;
    onChange(value: T): void | Promise<void>;
}

export function select<T extends string>(options: SelectOptions<T>): HTMLSelectElement {
    const node = el('select', {
        class: 'text_pole dramatis-select',
        attrs: { 'aria-label': options.label, disabled: options.disabled === true },
    });
    for (const option of options.options) {
        node.appendChild(el('option', { text: option.label, attrs: { value: option.value } }));
    }
    node.value = options.options.some((option) => option.value === options.value)
        ? options.value
        : (options.options[0]?.value ?? '');
    node.addEventListener('change', () => {
        const chosen = options.options.find((option) => option.value === node.value);
        if (chosen) void options.onChange(chosen.value);
    });
    return node;
}

export interface NumberOptions {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    label?: string;
    disabled?: boolean;
    onChange(value: number): void | Promise<void>;
}

/** Number input that commits on change (not on every keystroke) and clamps to min/max. */
export function numberInput(options: NumberOptions): HTMLInputElement {
    const node = el('input', {
        class: 'text_pole dramatis-number',
        attrs: {
            type: 'number',
            inputmode: 'numeric',
            min: options.min,
            max: options.max,
            step: options.step ?? 1,
            'aria-label': options.label,
            disabled: options.disabled === true,
        },
    });
    node.value = String(options.value);
    node.addEventListener('change', () => {
        let value = Number(node.value);
        if (!Number.isFinite(value)) value = options.value;
        if (options.min !== undefined) value = Math.max(options.min, value);
        if (options.max !== undefined) value = Math.min(options.max, value);
        node.value = String(value);
        void options.onChange(value);
    });
    return node;
}

/** A labelled row: label on the left (top on phones), control on the right, optional hint below. */
export function field(label: string, control: Child, hint?: string): HTMLElement {
    return el('div', { class: 'dramatis-field' }, [
        el('div', { class: 'dramatis-field-label', text: label }),
        el('div', { class: 'dramatis-field-control' }, [control]),
        hint ? el('div', { class: 'dramatis-field-hint', text: hint }) : null,
    ]);
}
