// @vitest-environment happy-dom
// «Рычаги этого чата»: the page, setting and resetting overrides, the link count, and the sheet following them.
import { afterEach, describe, expect, it } from 'vitest';
import { FakePopup } from '../../helpers/st-mock';
import { emptyCardProfiles } from '../../../src/domain/profile-defaults';
import { raid } from '../../domain/cast-fixtures';
import { buttonByText, byKey, commit, fakeEngine, flush, harness } from './harness';
import type { Harness } from './harness';

let h: Harness | null = null;

afterEach(async () => {
    await h?.dispose();
    h = null;
    FakePopup.instances = [];
});

describe('this chat’s levers', () => {
    it('opens from the list with the number of own levers', async () => {
        h = harness();
        h.engine!.state.overrides = { mode: 'cinema', bogus: 1 };
        const body = h.open();
        const link = buttonByText(body, 'Рычаги этого чата (1)');
        link.click();
        await flush();
        expect(h.body().querySelector('.dramatis-sheet-title')?.textContent).toBe('Рычаги этого чата');
        expect(h.body().textContent).toContain('Своих рычагов: 1. Режим этого чата: Кино.');
    });

    it('offers «Как в общих» with the general value, and stores only what the chat sets', async () => {
        h = harness();
        const body = h.open({ page: 'levers' });
        const mode = byKey<HTMLSelectElement>(body, 'lever:mode');
        expect(mode.value).toBe('');
        expect(mode.options[0]?.textContent).toBe('Как в общих — Сбалансированный');
        commit(mode, JSON.stringify('economy'));
        await flush();
        expect(h.engine!.state.overrides).toEqual({ mode: 'economy' });

        const merge = byKey<HTMLSelectElement>(h.body(), 'lever:mergeVoices');
        expect(merge.options[0]?.textContent).toBe('Как в общих — вкл');
        commit(merge, 'false');
        await flush();
        expect(h.engine!.state.overrides).toEqual({ mode: 'economy', mergeVoices: false });

        commit(byKey<HTMLSelectElement>(h.body(), 'lever:mode'), '');
        await flush();
        expect(h.engine!.state.overrides).toEqual({ mergeVoices: false });
    });

    it('resets every lever to the general settings', async () => {
        h = harness();
        h.engine!.state.overrides = { mode: 'economy', depth: 4 };
        const body = h.open({ page: 'levers' });
        buttonByText(body, 'Всё как в общих').click();
        await flush();
        expect(h.engine!.state.overrides).toBeUndefined();
        expect(h.body().textContent).toContain('Этот чат следует общим настройкам.');
    });

    it('shows a numeric general value that is not one of the presets', () => {
        h = harness();
        h.settings.cardBudget = 250;
        const body = h.open({ page: 'levers' });
        const budget = byKey<HTMLSelectElement>(body, 'lever:cardBudget');
        expect(budget.options[0]?.textContent).toBe('Как в общих — 250');
        expect([...budget.options].some((option) => option.value === '250')).toBe(true);
    });

    it('the sheet follows the chat’s own secrets lever', async () => {
        const { profiles, state } = raid();
        const engine = fakeEngine({ ...emptyCardProfiles('ford.png'), characters: profiles }, state, {
            present: ['grukk'],
        });
        h = harness({ engine, secrets: 'spoiler' });
        h.open();
        await flush();
        const hidden = h.body().querySelectorAll('.dramatis-spoiler').length;
        expect(hidden).toBeGreaterThan(0);
        await h.engine!.updateState((state) => {
            state.overrides = { secrets: 'open' };
        });
        await flush();
        expect(h.body().querySelectorAll('.dramatis-spoiler').length).toBe(0);
    });
});
