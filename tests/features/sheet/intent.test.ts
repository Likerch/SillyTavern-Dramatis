// @vitest-environment happy-dom
// The header's intent reading through a fake intent API: read / re-read, disabled while running, warnings, the
// re-read difference list and «Взять авторское».
import { afterEach, describe, expect, it } from 'vitest';
import { PLAYER_ID } from '../../../src/domain/model';
import type { IntentReadResult } from '../../../src/features/sheet/types';
import { buttonByText, byKey, flush, harness, profileOf } from './harness';
import type { Harness } from './harness';

let h: Harness | null = null;

afterEach(async () => {
    await h?.dispose();
    h = null;
});

const RESULT: IntentReadResult = {
    ok: true,
    characters: 5,
    warnings: ['Ильва: цитата не найдена в источниках'],
    diff: [
        {
            path: 'core.concept',
            character: 'ilva',
            status: 'kept-user',
            before: 'моя Ильва',
            after: 'вдова мятежника',
        },
        {
            path: `ties.${PLAYER_ID}`,
            character: 'bram',
            status: 'kept-locked',
            before: { target: PLAYER_ID, stance: 0, reasons: [] },
            after: {
                target: PLAYER_ID,
                stance: -1,
                reasons: [],
                intent: 'use',
                evaluations: [],
                debts: [],
                encounters: [],
                beliefs: [],
            },
        },
        { path: 'worldTone', status: 'updated', before: 'neutral', after: 'hostile' },
        { path: 'core.want', character: 'ghost', status: 'kept-user', before: 'a', after: 'b' },
    ],
};

function readButton(body: HTMLElement): HTMLButtonElement {
    return byKey<HTMLButtonElement>(body, 'intent:read');
}

describe('reading the intent', () => {
    it('reads with the button, stays disabled while running, then shows warnings and differences', async () => {
        h = harness();
        const body = h.open();
        const button = readButton(body);
        expect(button.textContent).toBe('Прочитать замысел');
        expect(button.dataset.intent).toBe('read');
        button.click();
        expect(h.intent!.calls).toEqual([undefined]);
        expect(readButton(h.body()).disabled).toBe(true);
        expect(readButton(h.body()).textContent).toBe('Читаю…');
        // A second click while running does nothing.
        readButton(h.body()).click();
        expect(h.intent!.calls).toHaveLength(1);

        h.intent!.finish(structuredClone(RESULT));
        await flush();
        const panel = h.body().querySelector<HTMLElement>('.dramatis-sheet-intent')!;
        expect(readButton(h.body()).disabled).toBe(false);
        expect(panel.textContent).toContain('Замысел прочитан: в составе 5.');
        expect([...panel.querySelectorAll('.dramatis-sheet-warnings li')].map((li) => li.textContent)).toEqual([
            'Ильва: цитата не найдена в источниках',
        ]);
        const items = [...panel.querySelectorAll<HTMLElement>('.dramatis-sheet-diff-item')];
        expect(items).toHaveLength(4);
        expect(items[0]!.textContent).toContain('Ильва');
        expect(items[0]!.textContent).toContain('Суть');
        expect(items[0]!.textContent).toContain('оставлена твоя правка');
        expect(items[0]!.textContent).toContain('моя Ильва');
        expect(items[0]!.textContent).toContain('вдова мятежника');
        expect(items[1]!.textContent).toContain('Связь с: Курьер');
        expect(items[1]!.textContent).toContain('закреплено, не тронуто');
        expect(items[2]!.textContent).toContain('Карточка');
        expect(items[2]!.textContent).toContain('Тон мира');
        // «Take the author's» only where the user's value stayed and the character still exists.
        expect(items.map((item) => !!item.querySelector('.dramatis-sheet-take'))).toEqual([true, true, false, false]);
    });

    it('«Взять авторское» applies the author value and gives the field back to the author, unlocked', async () => {
        h = harness();
        const ilva = profileOf(h.engine!, 'ilva');
        ilva.core.concept = 'моя Ильва';
        ilva.meta['core.concept'] = { origin: 'user', locked: true };
        const bram = profileOf(h.engine!, 'bram');
        bram.meta[`ties.${PLAYER_ID}`] = { origin: 'generated', locked: true };
        bram.meta[`ties.${PLAYER_ID}.stance`] = { origin: 'user' };
        h.open();
        readButton(h.body()).click();
        h.intent!.finish(structuredClone(RESULT));
        await flush();

        buttonByText(h.body(), 'Взять авторское').click();
        await flush();
        const after = profileOf(h.engine!, 'ilva');
        expect(after.core.concept).toBe('вдова мятежника');
        expect(after.meta['core.concept']).toEqual({ origin: 'author' });
        const items = [...h.body().querySelectorAll<HTMLElement>('.dramatis-sheet-diff-item')];
        expect(items[0]!.querySelector('.dramatis-sheet-take')).toBeNull();
        expect(items[0]!.textContent).toContain('Взято авторское.');

        items[1]!.querySelector<HTMLButtonElement>('.dramatis-sheet-take')!.click();
        await flush();
        const bramAfter = profileOf(h.engine!, 'bram');
        expect(bramAfter.ties.find((tie) => tie.target === PLAYER_ID)).toMatchObject({ stance: -1, intent: 'use' });
        expect(bramAfter.meta[`ties.${PLAYER_ID}`]).toEqual({ origin: 'author' });
        expect(bramAfter.meta[`ties.${PLAYER_ID}.stance`]).toBeUndefined();
    });

    it('re-reads with force once the intent was read, and keeps the result after reopening', async () => {
        h = harness();
        h.engine!.card.intent = { at: 1, sourcesHash: 'abc' };
        const body = h.open();
        expect(readButton(body).textContent).toBe('Перечитать');
        expect(readButton(body).dataset.intent).toBe('reread');
        readButton(body).click();
        expect(h.intent!.calls).toEqual([{ force: true }]);
        h.intent!.finish({ ok: false, error: 'нет профиля подключения', characters: 0, warnings: [], diff: [] });
        await flush();
        expect(h.body().querySelector('.dramatis-sheet-intent')?.textContent).toContain(
            'Не получилось прочитать замысел: нет профиля подключения',
        );
        h.ui.closeWindow('cast');
        h.open();
        expect(h.body().querySelector('.dramatis-sheet-intent')?.textContent).toContain('нет профиля подключения');
        buttonByText(h.body(), 'Скрыть').click();
        expect(h.body().querySelector('.dramatis-sheet-intent')).toBeNull();
    });

    it('shows a reading started elsewhere as running and its last result', async () => {
        h = harness();
        h.intent!.busy = true;
        h.intent!.last = structuredClone(RESULT);
        const body = h.open();
        expect(readButton(body).disabled).toBe(true);
        expect(body.querySelectorAll('.dramatis-sheet-diff-item')).toHaveLength(4);
    });

    it('shows the module’s own summary and a skipped reading', async () => {
        h = harness();
        readButton(h.open()).click();
        h.intent!.finish({ ok: true, skipped: true, characters: 5, warnings: [], diff: [] });
        await flush();
        expect(h.body().querySelector('.dramatis-sheet-intent')?.textContent).toContain(
            'Перечитывать нечего: источники не изменились.',
        );
        readButton(h.body()).click();
        h.intent!.finish({
            ok: true,
            message: 'Замысел прочитан: 5 лиц, 2 правила.',
            characters: 5,
            warnings: [],
            diff: [],
        });
        await flush();
        expect(h.body().querySelector('.dramatis-sheet-intent')?.textContent).toContain(
            'Замысел прочитан: 5 лиц, 2 правила.',
        );
    });

    it('disables the button without the intent module', () => {
        h = harness({ intent: null });
        const body = h.open();
        expect(readButton(body).disabled).toBe(true);
        expect(body.textContent).toContain('Чтение замысла недоступно');
    });
});
