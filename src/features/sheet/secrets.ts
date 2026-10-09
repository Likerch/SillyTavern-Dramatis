// What the sheet treats as secret (docs/model.md §0.1 В3, §14 «Видимость тайного»; the predicates live in
// domain/secrets.ts): agenda secrets, appetites the character hides or keeps secret, the doom of a front, schemes,
// hidden intentions and covert intents toward the player. The lever decides how they show: `open` as is, `spoiler`
// blurred until clicked, `known` not at all (the player's character knowing them is not modelled yet, so «only what
// he knows» hides every secret).
import { button, el } from '../../ui/dom';
import type { SheetCtx } from './types';

export { COVERT_INTENTS, isCovertTie, isHiddenAppetite, isHiddenIntention } from '../../domain/secrets';

/**
 * Wraps secret content by the lever: open → the content; known → null (render nothing); spoiler → a blurred, inert
 * copy under a «show» button until the user reveals it (remembered while the window is open).
 */
export function spoiler(ctx: SheetCtx, key: string, build: () => Node): Node | null {
    if (ctx.secrets === 'open') return build();
    if (ctx.secrets === 'known') return null;
    const revealed = ctx.session.revealed.has(key);
    const content = el('div', { class: 'dramatis-spoiler-content' }, [build()]);
    const box = el(
        'div',
        { class: ['dramatis-spoiler', revealed && 'dramatis-spoiler-open'], data: { spoiler: key } },
        [content],
    );
    if (revealed) return box;
    content.setAttribute('aria-hidden', 'true');
    content.setAttribute('inert', '');
    const reveal = button({
        icon: 'fa-eye',
        label: ctx.t('sheet.spoiler.show'),
        kind: 'ghost',
        className: 'dramatis-spoiler-reveal',
        onClick: () => {
            ctx.session.revealed.add(key);
            box.classList.add('dramatis-spoiler-open');
            content.removeAttribute('aria-hidden');
            content.removeAttribute('inert');
            reveal.remove();
            content.querySelector<HTMLElement>('input, textarea, select, button')?.focus({ preventScroll: true });
        },
    });
    box.appendChild(reveal);
    return box;
}
