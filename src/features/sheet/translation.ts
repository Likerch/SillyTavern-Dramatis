// The display translation inside the editor: every text field keeps editing the stored value (English for the model),
// and an English value gets its Russian translation as a hint under it, so the user reads it and sees what is stored.
// A field the user wrote in Russian stays as it is (Russian is never translated). Fields of names (the name, the English
// name, aliases, anchors) are marked RAW_ATTR and left alone. The values found are what the view asks to translate.
import type { TranslationSource } from '../../domain/translate';
import { el } from '../../ui/dom';
import type { TranslateApi } from '../translate/api';

/** On a field or its container: the value is a name, never translated. */
export const RAW_ATTR = 'data-dramatis-raw';

const FIELDS = 'input.dramatis-input[type="text"], textarea.dramatis-input';

/** Marks a field (or a list of them) as names: no translation hint, nothing asked. */
export function raw<T extends HTMLElement>(node: T): T {
    node.setAttribute(RAW_ATTR, '');
    return node;
}

/**
 * Adds the translation hints under the English text fields of `root` and returns their values (with `who`) as the
 * strings this page shows.
 */
export function annotateFields(
    root: ParentNode,
    translate: Pick<TranslateApi, 'needs' | 'translation'>,
    title: string,
    who?: string,
): TranslationSource[] {
    const shown: TranslationSource[] = [];
    for (const node of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(FIELDS)) {
        if (node.closest(`[${RAW_ATTR}]`)) continue;
        const value = node.value.trim();
        if (!value || !translate.needs(value)) continue;
        shown.push(who ? { text: value, who } : { text: value });
        const ru = translate.translation(value);
        if (!ru) continue;
        const hint = el('div', { class: 'dramatis-translation', text: ru, title, attrs: { lang: 'ru' } });
        // In a list the item is a row (field + remove button): the hint goes under the row.
        const item = node.parentElement;
        (item?.classList.contains('dramatis-list-item') ? item : node).after(hint);
    }
    return shown;
}
