// @vitest-environment happy-dom
// «Пересобрать по истории» on the sheet (docs/model.md §10.2): the button on a generated face's page and the list's
// «Пересобрать новых лиц», the «по костям» tag of a dice-made face, the «догадка» badge of a guessed field.
import { afterEach, describe, expect, it } from 'vitest';
import { setMeta } from '../../../src/domain/profile-defaults';
import type { GeneratorApi, GeneratorOutcome } from '../../../src/features/generator/api';
import { profile } from '../../domain/cast-fixtures';
import { buttonByText, flush, harness, tavernEngine } from './harness';
import type { Harness } from './harness';

let h: Harness | null = null;

afterEach(async () => {
    await h?.dispose();
    h = null;
});

function fakeGenerator(outcome: GeneratorOutcome = { ok: true, written: ['core.values'] }) {
    const calls: (readonly string[] | undefined)[] = [];
    const api: GeneratorApi = {
        fillGaps: async () => outcome,
        promote: async () => outcome,
        pin: async () => outcome,
        reground: async (ids) => {
            calls.push(ids);
            return outcome;
        },
        groundable: () => ['vera'],
        busy: () => [],
        idle: async () => {},
    };
    return { api, calls };
}

/** The tavern plus a face of this chat (Вера) whose values the dice drew. */
function withExtra() {
    const engine = tavernEngine();
    let vera = profile('vera', 'Вера', { lod: 'sketch' });
    vera = setMeta({ ...vera, core: { ...vera.core, values: { top: ['power'] } } }, 'core.values', {
        origin: 'generated',
        sources: ['dice'],
    });
    engine.state = { ...engine.state, extras: [vera] };
    return engine;
}

describe('rebuilding faces on the story from the sheet', () => {
    it('offers «Пересобрать по истории» on a generated face’s page, not on the author’s characters', async () => {
        const generator = fakeGenerator();
        h = harness({ engine: withExtra(), generator: generator.api });
        const page = h.open({ character: 'vera' });
        expect(page.querySelector('.dramatis-sheet-tag-guessed')?.textContent).toBe('по костям');
        buttonByText(page, 'Пересобрать по истории').click();
        await flush();
        expect(generator.calls).toEqual([['vera']]);
        expect(h.notices).toEqual([]);
        // A guessed field shows its badge.
        expect(h.body().querySelector('[data-unit="core.values"] .dramatis-sheet-origin')?.textContent).toBe(
            '✎ догадка',
        );
        // Ильва is the author's: no button on her page.
        const ilva = h.engine!;
        ilva.card.characters.find((item) => item.id === 'ilva')!.meta = { core: { origin: 'author' } };
        const authored = h.open({ character: 'ilva' });
        expect(() => buttonByText(authored, 'Пересобрать по истории')).toThrow();
    });

    it('rebuilds every new face from the list and reports a failure', async () => {
        const generator = fakeGenerator({ ok: false, written: [], error: 'cap' });
        h = harness({ engine: withExtra(), generator: generator.api });
        const list = h.open();
        expect(list.querySelector('.dramatis-sheet-row[data-id="vera"] .dramatis-sheet-tag-guessed')).not.toBeNull();
        buttonByText(list, 'Пересобрать новых лиц').click();
        await flush();
        expect(generator.calls).toEqual([undefined]);
        expect(h.notices).toEqual([{ text: 'Не удалось пересобрать: cap', level: 'warn' }]);
    });

    it('shows no buttons without the generator or without faces of this chat', () => {
        h = harness({ engine: withExtra() });
        expect(() => buttonByText(h!.open(), 'Пересобрать новых лиц')).toThrow();
        void h.dispose();
        h = harness({ generator: fakeGenerator().api });
        expect(() => buttonByText(h!.open(), 'Пересобрать новых лиц')).toThrow();
    });
});
