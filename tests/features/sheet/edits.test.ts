// @vitest-environment happy-dom
// Editing through the EngineApi: provenance (origin user + lock on the reader's unit), ties written to the design and
// the chat, the user's stance decisions, chat extras, failed saves, the secrets lever and the rule editor.
import { afterEach, describe, expect, it } from 'vitest';
import { PLAYER_ID } from '../../../src/domain/model';
import type { AppetiteRule } from '../../../src/domain/model';
import { metaUnit } from '../../../src/features/sheet/edits';
import { profile } from '../../domain/cast-fixtures';
import { buttonByText, byKey, commit, flush, harness, profileOf } from './harness';
import type { Harness } from './harness';

let h: Harness | null = null;

afterEach(async () => {
    await h?.dispose();
    h = null;
});

describe('provenance units', () => {
    it('match the units the intent reading writes', () => {
        expect(metaUnit('core.concept')).toBe('core.concept');
        expect(metaUnit('core.wound.lie')).toBe('core.wound');
        expect(metaUnit('core.temperament.honesty')).toBe('core.temperament');
        expect(metaUnit(`ties.${PLAYER_ID}.stance`)).toBe(`ties.${PLAYER_ID}`);
        expect(metaUnit('appetites.drink.baseline')).toBe('appetites.drink');
        expect(metaUnit('agenda.front.doom')).toBe('agenda.front');
        expect(metaUnit('rules.lamia.intensity')).toBe('rules.lamia');
        expect(metaUnit('starts')).toBe('starts');
        expect(metaUnit('role')).toBe('role');
    });
});

describe('editing a profile', () => {
    it('saves through updateProfiles and marks the field origin user, locked', async () => {
        h = harness();
        const ilva = profileOf(h.engine!, 'ilva');
        ilva.meta['core.concept'] = { origin: 'author', evidence: ['ненавидит имперцев'] };
        const body = h.open({ character: 'ilva' });
        // The author's badge and quotes before the edit.
        const unit = body.querySelector<HTMLElement>('[data-unit="core.concept"]')!;
        expect(unit.querySelector('.dramatis-sheet-origin')?.textContent).toBe('автор');
        unit.querySelector<HTMLButtonElement>('.dramatis-sheet-quotes-toggle')!.click();
        expect(body.querySelector('[data-unit="core.concept"] .dramatis-sheet-quotes')?.textContent).toContain(
            '«ненавидит имперцев»',
        );

        commit(byKey<HTMLTextAreaElement>(body, 'ilva:core.concept'), 'вдова мятежника, держит трактир назло');
        await flush();
        const after = profileOf(h.engine!, 'ilva');
        expect(after.core.concept).toBe('вдова мятежника, держит трактир назло');
        expect(after.meta['core.concept']).toEqual({ origin: 'user', locked: true });
        expect(h.engine!.profileCalls).toBe(1);
        expect(h.engine!.stateCalls).toBe(0);
        // The page shows the new badge and the lock, and keeps the focus on the field.
        const badge = h.body().querySelector('[data-unit="core.concept"] .dramatis-sheet-origin');
        expect(badge?.textContent).toBe('твоё');
        expect(
            h.body().querySelector('[data-unit="core.concept"] .dramatis-sheet-lock')?.getAttribute('aria-pressed'),
        ).toBe('true');
    });

    it('marks the whole unit of a sub-field (temperament axis, wound part, appetite field)', async () => {
        h = harness();
        const body = h.open({ character: 'ilva' });
        const honesty = byKey<HTMLInputElement>(body, 'ilva:core.temperament.honesty');
        commit(honesty, '2');
        await flush();
        commit(byKey<HTMLTextAreaElement>(h.body(), 'ilva:core.wound.ghost'), 'мужа повесили имперцы');
        await flush();
        const ilva = profileOf(h.engine!, 'ilva');
        expect(ilva.core.temperament).toEqual({ honesty: 2 });
        expect(ilva.meta['core.temperament']).toEqual({ origin: 'user', locked: true });
        expect(ilva.core.wound).toEqual({ ghost: 'мужа повесили имперцы', lie: '', triggers: [], coping: 'avoid' });
        expect(ilva.meta['core.wound']).toEqual({ origin: 'user', locked: true });
    });

    it('edits lists with add and remove', async () => {
        h = harness();
        const body = h.open({ character: 'ilva' });
        commit(byKey<HTMLInputElement>(body, 'ilva:core.tactics.new'), 'ложь умолчанием');
        await flush();
        expect(profileOf(h.engine!, 'ilva').core.tactics).toEqual([
            'bluntness',
            'silence',
            'refusing small favours',
            'ложь умолчанием',
        ]);
        byKey<HTMLButtonElement>(h.body(), 'ilva:core.tactics.0.remove').click();
        await flush();
        expect(profileOf(h.engine!, 'ilva').core.tactics).toEqual([
            'silence',
            'refusing small favours',
            'ложь умолчанием',
        ]);
        expect(profileOf(h.engine!, 'ilva').meta['core.tactics']).toEqual({ origin: 'user', locked: true });
    });

    it('locks and unlocks a field without changing its origin', async () => {
        h = harness();
        profileOf(h.engine!, 'ilva').meta['core.keys'] = { origin: 'author', evidence: ['дочь'] };
        const body = h.open({ character: 'ilva' });
        byKey<HTMLButtonElement>(body, 'ilva:core.keys:lock').click();
        await flush();
        expect(profileOf(h.engine!, 'ilva').meta['core.keys']).toEqual({
            origin: 'author',
            evidence: ['дочь'],
            locked: true,
        });
        byKey<HTMLButtonElement>(h.body(), 'ilva:core.keys:lock').click();
        await flush();
        expect(profileOf(h.engine!, 'ilva').meta['core.keys']).toEqual({ origin: 'author', evidence: ['дочь'] });
    });

    it('writes a tie field to the design (unit ties.<target>) and to the live tie', async () => {
        h = harness();
        h.slice.tab = 'ties';
        const body = h.open({ character: 'ilva' });
        commit(byKey<HTMLTextAreaElement>(body, `ilva:ties.${PLAYER_ID}.behaviour`), 'берёт монету, молчит');
        await flush();
        const base = profileOf(h.engine!, 'ilva').ties.find((tie) => tie.target === PLAYER_ID)!;
        expect(base.behaviour).toBe('берёт монету, молчит');
        expect(profileOf(h.engine!, 'ilva').meta[`ties.${PLAYER_ID}`]).toEqual({ origin: 'user', locked: true });
        expect(h.engine!.state.characters.ilva!.ties[PLAYER_ID]!.behaviour).toBe('берёт монету, молчит');

        commit(byKey<HTMLSelectElement>(h.body(), `ilva:ties.${PLAYER_ID}.intent`), 'use');
        await flush();
        expect(h.engine!.state.characters.ilva!.ties[PLAYER_ID]!.intent).toBe('use');
    });

    it('changes the base stance only in the design', async () => {
        h = harness();
        h.slice.tab = 'ties';
        const body = h.open({ character: 'ilva' });
        commit(byKey<HTMLSelectElement>(body, `ilva:ties.${PLAYER_ID}.stance`), '-3');
        await flush();
        expect(profileOf(h.engine!, 'ilva').ties.find((tie) => tie.target === PLAYER_ID)!.stance).toBe(-3);
        expect(h.engine!.state.characters.ilva!.ties[PLAYER_ID]!.stance).toBe(-2);
    });

    it('edits a chat extra through updateState', async () => {
        h = harness();
        h.engine!.state.extras = [profile('stranger', 'Незнакомец')];
        const body = h.open({ character: 'stranger' });
        expect(body.textContent).toContain('из этого чата');
        commit(byKey<HTMLInputElement>(body, 'stranger:role'), 'контрабандист');
        await flush();
        expect(h.engine!.profileCalls).toBe(0);
        expect(h.engine!.stateCalls).toBe(1);
        const stranger = h.engine!.state.extras[0]!;
        expect(stranger.role).toBe('контрабандист');
        expect(stranger.meta.role).toEqual({ origin: 'user', locked: true });
    });

    it('warns when a save fails', async () => {
        h = harness();
        h.engine!.fail = true;
        const body = h.open({ character: 'ilva' });
        commit(byKey<HTMLTextAreaElement>(body, 'ilva:core.concept'), 'другое');
        await flush();
        expect(h.notices).toEqual([{ text: expect.stringContaining('Правка не сохранилась'), level: 'warn' }]);
    });
});

describe('the current stance', () => {
    it('adds the reason «по твоему решению» (origin user) and a log line; undoing removes it', async () => {
        h = harness();
        h.slice.tab = 'ties';
        const body = h.open({ character: 'ilva' });
        commit(byKey<HTMLSelectElement>(body, `ilva:ties.${PLAYER_ID}:current`), '-1');
        await flush();
        const tie = h.engine!.state.characters.ilva!.ties[PLAYER_ID]!;
        expect(tie.stance).toBe(-1);
        expect(tie.reasons.at(-1)).toMatchObject({
            id: 'user-1',
            text: 'по твоему решению',
            delta: 1,
            scenesLeft: null,
            origin: 'user',
        });
        // The design is untouched; the log has the decision.
        expect(profileOf(h.engine!, 'ilva').ties.find((item) => item.target === PLAYER_ID)!.stance).toBe(-2);
        expect(h.engine!.logged).toEqual([
            { turn: 0, character: 'ilva', kind: 'user', text: 'Ильва → Курьер: Враждебна → Мешает, по твоему решению' },
        ]);
        // The reason shows with the «твоё» badge.
        const unit = h.body().querySelector(`[data-unit="ties.${PLAYER_ID}"]`)!;
        const reason = [...unit.querySelectorAll('.dramatis-sheet-reason')].at(-1)!;
        expect(reason.querySelector('.dramatis-sheet-reason-text')?.textContent).toBe('по твоему решению');
        expect(reason.querySelector('.dramatis-sheet-origin')?.textContent).toBe('твоё');

        commit(byKey<HTMLSelectElement>(h.body(), `ilva:ties.${PLAYER_ID}:current`), '-2');
        await flush();
        const back = h.engine!.state.characters.ilva!.ties[PLAYER_ID]!;
        expect(back.stance).toBe(-2);
        expect(back.reasons.some((item) => item.id.startsWith('user-'))).toBe(false);
    });

    it('removes a live reason', async () => {
        h = harness();
        h.slice.tab = 'ties';
        const body = h.open({ character: 'ilva' });
        const tie = body.querySelector<HTMLElement>(`[data-unit="ties.${PLAYER_ID}"]`)!;
        const last = [...tie.querySelectorAll('.dramatis-sheet-reason')].at(-1)!;
        last.querySelector<HTMLButtonElement>('button')!.click();
        await flush();
        expect(h.engine!.state.characters.ilva!.ties[PLAYER_ID]!.reasons.map((item) => item.text)).toEqual([
            'an imperial',
            'the Empire hanged her husband',
        ]);
    });
});

describe('the «Сейчас» tab', () => {
    it('edits the live state only', async () => {
        h = harness();
        h.slice.tab = 'now';
        const body = h.open({ character: 'ilva' });
        commit(byKey<HTMLInputElement>(body, 'ilva:now.scene.goal'), 'не дать курьеру заметить письма');
        await flush();
        commit(byKey<HTMLInputElement>(h.body(), 'ilva:now.stress'), '40');
        await flush();
        const live = h.engine!.state.characters.ilva!;
        expect(live.scene.goal).toBe('не дать курьеру заметить письма');
        expect(live.stress).toBe(40);
        expect(h.engine!.profileCalls).toBe(0);
    });
});

describe('secrets', () => {
    function secretsUnit(body: HTMLElement): HTMLElement | null {
        return body.querySelector<HTMLElement>('[data-unit="agenda.secrets"]');
    }

    it('spoiler: blurred and inert until clicked, then editable', () => {
        h = harness({ secrets: 'spoiler' });
        h.slice.tab = 'agenda';
        const body = h.open({ character: 'ilva' });
        const box = secretsUnit(body)!.closest<HTMLElement>('.dramatis-spoiler')!;
        expect(box.classList.contains('dramatis-spoiler-open')).toBe(false);
        expect(box.querySelector('.dramatis-spoiler-content')?.getAttribute('aria-hidden')).toBe('true');
        box.querySelector<HTMLButtonElement>('.dramatis-spoiler-reveal')!.click();
        expect(box.classList.contains('dramatis-spoiler-open')).toBe(true);
        expect(box.querySelector('.dramatis-spoiler-content')?.hasAttribute('inert')).toBe(false);
        expect(byKey<HTMLTextAreaElement>(box, 'ilva:agenda.secrets.0').value).toBe('passes letters to the rebels');
        // Revealed stays revealed after a re-render.
        buttonByText(h.body(), 'Ядро').click();
        buttonByText(h.body(), 'Повестка').click();
        expect(secretsUnit(h.body())!.closest('.dramatis-spoiler')?.classList.contains('dramatis-spoiler-open')).toBe(
            true,
        );
    });

    it('known: hides secrets entirely; open: shows them plainly; the lever re-renders the window', () => {
        h = harness({ secrets: 'known' });
        h.slice.tab = 'agenda';
        const body = h.open({ character: 'ilva' });
        expect(secretsUnit(body)).toBeNull();
        expect(body.textContent).not.toContain('Тайны');
        h.setSetting('secrets', 'open');
        const unit = secretsUnit(h.body())!;
        expect(unit.closest('.dramatis-spoiler')).toBeNull();
        expect(byKey<HTMLTextAreaElement>(unit, 'ilva:agenda.secrets.0').value).toBe('passes letters to the rebels');
    });

    it('treats hidden appetites and covert intents toward the player as secrets', () => {
        h = harness({ secrets: 'spoiler' });
        const ilva = profileOf(h.engine!, 'ilva');
        ilva.appetites = [
            {
                id: 'drink',
                kind: 'drink',
                sources: ['individual'],
                target: { mode: 'thing' },
                baseline: 3,
                liking: 1,
                triggers: [],
                satisfiers: [],
                drift: 'daily',
                tolerance: 0,
                dependence: 0,
                sensitization: 0,
                endorsement: 'torn',
                vow: 'abstinent',
                visibility: 'secret',
                style: 'buyer',
                affectionOnset: 'possible',
            },
        ];
        h.engine!.state.characters.ilva!.ties[PLAYER_ID]!.intent = 'avenge';
        h.slice.tab = 'appetites';
        const body = h.open({ character: 'ilva' });
        expect(body.querySelector('[data-unit="appetites.drink"]')?.closest('.dramatis-spoiler')).not.toBeNull();
        // The list hides the pressure of a secret appetite too.
        buttonByText(body, 'Состав').click();
        const row = h.body().querySelector('.dramatis-sheet-row[data-id="ilva"]')!;
        expect(row.querySelector('.dramatis-sheet-pressure')?.closest('.dramatis-spoiler')).not.toBeNull();
        // The covert intent toward the player.
        h.slice.tab = 'ties';
        h.open({ character: 'ilva' });
        const intent = byKey<HTMLSelectElement>(h.body(), `ilva:ties.${PLAYER_ID}.intent`);
        expect(intent.closest('.dramatis-spoiler')).not.toBeNull();
        expect(intent.value).toBe('avenge');
    });
});

describe('the rule editor', () => {
    const rule: AppetiteRule = {
        id: 'lamia',
        holders: 'ламии долины',
        kind: 'flesh',
        label: 'пара для рода',
        source: 'species',
        target: { mode: 'class', class: 'человеческие мужчины' },
        intensity: { zero: 0.2, low: 0.25, mid: 0.25, high: 0.3 },
        styles: { siren: 3, spider: 1 },
        choosiness: 2,
        exclusivity: 'exclusive',
        affectionOnset: 'possible',
        groupMode: 'solitary',
    };

    it('refuses shares that do not add up to 100 % and scales them on request', async () => {
        h = harness();
        h.engine!.card.rules = [structuredClone(rule)];
        const body = h.open({ page: 'rules' });
        expect(body.querySelector('.dramatis-sheet-shares')?.textContent).toContain('Всего 100 %');
        commit(byKey<HTMLInputElement>(body, 'card:rule:lamia.intensity.zero'), '10');
        await flush();
        const error = h.body().querySelector('.dramatis-sheet-sum-error');
        expect(error?.textContent).toBe('Всего 90 % — нужно 100 %. Пока не сохранено.');
        expect(error?.getAttribute('role')).toBe('alert');
        expect(h.engine!.profileCalls).toBe(0);
        // The draft survives a re-render (another field changes meanwhile).
        expect(byKey<HTMLInputElement>(h.body(), 'card:rule:lamia.intensity.zero').value).toBe('10');

        buttonByText(h.body(), 'Выровнять до 100 %').click();
        await flush();
        const saved = h.engine!.card.rules[0]!;
        const sum = saved.intensity.zero + saved.intensity.low + saved.intensity.mid + saved.intensity.high;
        expect(Math.abs(sum - 1)).toBeLessThan(0.01);
        expect(saved.intensity.zero).toBeCloseTo(0.111, 3);
        expect(h.engine!.card.meta['rules.lamia']).toEqual({ origin: 'user', locked: true });
        expect(h.body().querySelector('.dramatis-sheet-sum-error')).toBeNull();
    });

    it('saves shares that add up at once, and edits the chat copy through the state', async () => {
        h = harness();
        h.engine!.card.rules = [structuredClone(rule)];
        h.engine!.state.rules = [structuredClone(rule)];
        const body = h.open({ page: 'rules' });
        commit(byKey<HTMLInputElement>(body, 'card:rule:lamia.intensity.zero'), '10');
        await flush();
        commit(byKey<HTMLInputElement>(h.body(), 'card:rule:lamia.intensity.high'), '40');
        await flush();
        expect(h.engine!.card.rules[0]!.intensity).toEqual({ zero: 0.1, low: 0.25, mid: 0.25, high: 0.4 });
        expect(h.engine!.profileCalls).toBe(1);

        commit(byKey<HTMLSelectElement>(h.body(), 'chat:rule:lamia.groupMode'), 'pack');
        await flush();
        expect(h.engine!.state.rules[0]!.groupMode).toBe('pack');
        expect(h.engine!.card.rules[0]!.groupMode).toBe('solitary');
    });

    it('adds a rule to the card and copies it into the chat', async () => {
        h = harness();
        const body = h.open({ page: 'rules' });
        byKey<HTMLInputElement>(body, 'card:rule:new.holders').value = 'гарпии';
        byKey<HTMLButtonElement>(body, 'card:rule:new.add').click();
        await flush();
        const added = h.engine!.card.rules[0]!;
        expect(added).toMatchObject({ holders: 'гарпии', kind: 'flesh' });
        byKey<HTMLButtonElement>(h.body(), `card:rule:${added.id}.toChat`).click();
        await flush();
        expect(h.engine!.state.rules.map((item) => item.id)).toEqual([added.id]);
    });
});

describe('world pages', () => {
    it('edits the starting reputation of the card and the live reputation with weaknesses', async () => {
        h = harness();
        h.engine!.card.reputation = [{ among: 'стража', label: 'беглый каторжник', stance: -1, greeting: -1 }];
        h.engine!.state.reputation = [{ among: 'стража', label: 'вор', stance: -1, weaknesses: [], reasons: [] }];
        const body = h.open({ page: 'reputation' });
        commit(byKey<HTMLInputElement>(body, 'card:reputation.0.label'), 'наследник барона');
        await flush();
        expect(h.engine!.card.reputation[0]!.label).toBe('наследник барона');
        expect(h.engine!.card.meta.reputation).toEqual({ origin: 'user', locked: true });
        commit(byKey<HTMLInputElement>(h.body(), 'chat:reputation.0.weaknesses.new'), 'падок на лесть');
        await flush();
        expect(h.engine!.state.reputation[0]!.weaknesses).toEqual(['падок на лесть']);
    });

    it('edits the invariants', async () => {
        h = harness();
        const body = h.open({ page: 'invariants' });
        commit(byKey<HTMLTextAreaElement>(body, 'card:invariants.new'), 'Ильва никогда не выдаст мятежников');
        await flush();
        expect(h.engine!.card.invariants).toEqual(['Ильва никогда не выдаст мятежников']);
        expect(h.engine!.card.meta.invariants).toEqual({ origin: 'user', locked: true });
    });

    it('changes the world tone of the card and the chat', async () => {
        h = harness();
        const body = h.open();
        commit(byKey<HTMLSelectElement>(body, 'card:worldTone'), 'hostile');
        await flush();
        expect(h.engine!.card.worldTone).toBe('hostile');
        expect(h.engine!.card.meta.worldTone).toEqual({ origin: 'user', locked: true });
        expect(h.engine!.state.worldTone).toBe('hostile');
    });
});
