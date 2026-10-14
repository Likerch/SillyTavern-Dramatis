// «Пересобрать по истории» (docs/model.md §10.2): the sheet's buttons for rebuilding generated faces on the story —
// one face on its page, every face of the chat on the list — and the tag of a face an older build drew from dice.
// Interactive requests through the generator's API; the sheet works without the generator (no buttons then).
import type { CharacterProfile } from '../../domain/model';
import { button, el } from '../../ui/dom';
import { GENERATOR_API } from '../generator/api';
import type { GeneratorApi } from '../generator/api';
import { isExtra } from './edits';
import { keyed } from './parts';
import type { SheetCtx } from './types';

export function generatorApi(ctx: SheetCtx): GeneratorApi | undefined {
    return ctx.app.modules.api<GeneratorApi>(GENERATOR_API);
}

/** A face the generator made (a chat extra, or a card character nobody wrote): it may be rebuilt on the story. */
export function isGeneratedFace(ctx: SheetCtx, profile: CharacterProfile): boolean {
    if (profile.kind === 'group') return false;
    if (isExtra(ctx.view, profile.id)) return true;
    return !Object.values(profile.meta).some((meta) => meta.origin === 'author' || meta.origin === 'inferred');
}

/**
 * The rebuild button: `id` for one face (its page), none for every generated face of the chat (the list). Null when
 * the generator is off.
 */
export function regroundButton(ctx: SheetCtx, id?: string): HTMLElement | null {
    const api = generatorApi(ctx);
    if (!api) return null;
    const t = ctx.t;
    const all = id === undefined;
    const running = all ? api.busy().length > 0 : api.busy().includes(id);
    return keyed(
        button({
            icon: running ? 'fa-spinner' : 'fa-wand-magic-sparkles',
            label: running ? t('sheet.reground.running') : t(all ? 'sheet.reground.all' : 'sheet.reground'),
            kind: 'ghost',
            title: t(all ? 'sheet.reground.allHint' : 'sheet.reground.hint'),
            disabled: running,
            className: 'dramatis-sheet-reground',
            onClick: async () => {
                const job = api.reground(all ? undefined : [id]);
                ctx.rerender();
                const outcome = await job;
                if (!outcome.ok) {
                    ctx.app.ui.notice(t('sheet.reground.failed', { error: outcome.error ?? '' }), { level: 'warn' });
                }
                ctx.rerender();
            },
        }),
        all ? 'reground:all' : `${id}:reground`,
    );
}

/** The tag of a face an older build drew from dice, waiting to be rebuilt on the story. */
export function guessedTag(ctx: SheetCtx, id: string): HTMLElement | null {
    const api = generatorApi(ctx);
    if (!api || !api.groundable().includes(id)) return null;
    return el('span', {
        class: ['dramatis-sheet-tag', 'dramatis-sheet-tag-guessed'],
        title: ctx.t('sheet.guessedHint'),
        text: ctx.t('sheet.guessed'),
    });
}
