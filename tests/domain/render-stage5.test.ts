import { describe, expect, it } from 'vitest';
import { emptyArc } from '../../src/domain/arcs';
import { buildCastCard } from '../../src/domain/render';
import type { CastCardInput } from '../../src/domain/render';
import { TAVERN_BANDS, TAVERN_PRESENT, tavern } from './cast-fixtures';

function card(patch: Partial<CastCardInput> = {}, setup?: (t: ReturnType<typeof tavern>) => void): string {
    const t = tavern();
    setup?.(t);
    return buildCastCard({
        profiles: t.profiles,
        state: t.state,
        present: TAVERN_PRESENT,
        bands: TAVERN_BANDS,
        playerName: 'Курьер',
        lang: 'en',
        budgetTokens: 0,
        mergeVoices: false,
        ...patch,
    }).text;
}

describe('stage 5 in the motive card', () => {
    it('shows the identity of a corruption past 7, the arc stage and the defining choice', () => {
        const text = card({}, ({ profiles, state }) => {
            const ilva = profiles[0]!;
            ilva.core = {
                ...ilva.core,
                wound: { ghost: 'husband hanged', lie: 'imperials lie', triggers: [], coping: 'overcompensate' },
            };
            const live = state.characters.ilva!;
            live.corruption = { level: 7, stains: 0, gifts: [], brands: [], identity: 'dominance' };
            live.arcStage = 'cracking';
            live.arc = {
                ...emptyArc(1),
                choices: [
                    { text: 'kept the letters hidden', kept: 'the rebels', gave: 'her safety', toward: 'lie', turn: 1 },
                ],
            };
        });
        expect(text).toContain('Sees herself as a master, and others as there to obey.');
        expect(text).toContain('Arc: the old belief ("imperials lie") is cracking — doubts show under pressure.');
        expect(text).toContain('Defining choice: the rebels over her safety — kept the letters hidden.');
    });

    it('speaks Russian and drops the defining choice before the identity when trimming', () => {
        const setup = ({ state }: ReturnType<typeof tavern>) => {
            const live = state.characters.ilva!;
            live.corruption = { level: 8, stains: 0, gifts: [], brands: [], identity: 'self' };
            live.arc = {
                ...emptyArc(1),
                choices: [{ text: 'промолчала', kept: '', gave: '', toward: 'unclear', turn: 1 }],
            };
        };
        const full = card({ lang: 'ru' }, setup);
        expect(full).toContain('Видит себя той, кому теперь всё позволено.');
        expect(full).toContain('Главный выбор: промолчала.');
        // The first budget that drops the choice still keeps the identity.
        let budget = Math.ceil(full.length / 4);
        let tight = full;
        while (tight.includes('Главный выбор') && budget > 0)
            tight = card({ lang: 'ru', budgetTokens: (budget -= 5) }, setup);
        expect(tight).not.toContain('Главный выбор');
        expect(tight).toContain('Видит себя той, кому теперь всё позволено.');
    });

    it('adds nothing while the lie holds and nothing was chosen', () => {
        const text = card();
        expect(text).not.toContain('Arc:');
        expect(text).not.toContain('Defining choice');
        expect(text).not.toContain('Sees ');
        expect(text).not.toContain('snaps:');
    });
});
