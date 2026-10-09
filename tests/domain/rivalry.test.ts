import { describe, expect, it } from 'vitest';
import { CLAIMS, advanceClaim, analyzeRivalry, guardStrength, rivalRelation, rivalsOf } from '../../src/domain/rivalry';
import type { Pursuit } from '../../src/domain/rivalry';
import { PLAYER_ID } from '../../src/domain/model';

function pursuit(fields: Partial<Pursuit> & { id: string }): Pursuit {
    return { target: PLAYER_ID, want: 3, claim: 'none', ...fields };
}

describe('advanceClaim', () => {
    it('grows interest → claimed with rivals or strong want', () => {
        expect(CLAIMS).toEqual(['none', 'interest', 'claimed', 'owned']);
        expect(advanceClaim('none', { want: 2, rivals: 0 })).toBe('interest');
        expect(advanceClaim('none', { want: 1, rivals: 3 })).toBe('none');
        expect(advanceClaim('interest', { want: 3, rivals: 0 })).toBe('interest');
        expect(advanceClaim('interest', { want: 3, rivals: 1 })).toBe('claimed');
        expect(advanceClaim('interest', { want: 4, rivals: 0 })).toBe('claimed');
    });

    it('owns on acquisition and keeps ownership', () => {
        expect(advanceClaim('interest', { want: 1, rivals: 0, acquired: true })).toBe('owned');
        expect(advanceClaim('owned', { want: 0, rivals: 0 })).toBe('owned');
    });

    it('falls back on loss or fading want', () => {
        expect(advanceClaim('owned', { want: 4, rivals: 0, lost: true })).toBe('interest');
        expect(advanceClaim('owned', { want: 1, rivals: 0, lost: true })).toBe('none');
        expect(advanceClaim('claimed', { want: 1, rivals: 0 })).toBe('interest');
        expect(advanceClaim('claimed', { want: 0, rivals: 0 })).toBe('none');
        expect(advanceClaim('claimed', { want: 2, rivals: 0 })).toBe('claimed');
        expect(advanceClaim('interest', { want: 0, rivals: 0 })).toBe('none');
    });
});

describe('rivals and relations', () => {
    const kira = pursuit({ id: 'kira', want: 4 });
    const sera = pursuit({ id: 'sera', want: 4, claim: 'claimed' });
    const ula = pursuit({ id: 'ula', want: 2 });
    const other = pursuit({ id: 'x', want: 5, target: 'mira' });

    it('finds others wanting the same target enough', () => {
        expect(rivalsOf(kira, [kira, sera, ula, other]).map((p) => p.id)).toEqual(['sera']);
    });

    it('pairs pack mates and friends, feuds over bad blood and exclusive claims', () => {
        const a = pursuit({ id: 'a', group: 'harpies', groupMode: 'pack' });
        const b = pursuit({ id: 'b', group: 'harpies', groupMode: 'pack', claim: 'claimed' });
        expect(rivalRelation(a, b, -1)).toBe('coalition');
        expect(rivalRelation(kira, ula, 1)).toBe('coalition');
        expect(rivalRelation(kira, ula, -1)).toBe('feud');
        expect(rivalRelation(kira, sera, 0)).toBe('feud');
        expect(rivalRelation(kira, ula, 0)).toBe('tolerate');
        const solo = pursuit({ id: 'c', group: 'harpies', groupMode: 'solitary' });
        expect(rivalRelation(solo, b, 0)).toBe('feud');
    });

    it('lets sharers tolerate each other even with claims', () => {
        const h1 = pursuit({ id: 'h1', exclusivity: 'harem', claim: 'claimed' });
        const h2 = pursuit({ id: 'h2', exclusivity: 'shared', claim: 'owned' });
        expect(rivalRelation(h1, h2, 0)).toBe('tolerate');
    });

    it('turns an exclusive claimant into a guardian against non-allies', () => {
        expect(guardStrength(sera, 'feud')).toBe(1);
        expect(guardStrength({ ...sera, claim: 'owned' }, 'tolerate')).toBe(2);
        expect(guardStrength(sera, 'coalition')).toBe(0);
        expect(guardStrength({ ...sera, exclusivity: 'harem' }, 'feud')).toBe(0);
        expect(guardStrength(kira, 'feud')).toBe(0);
    });
});

describe('analyzeRivalry', () => {
    it('reports rivals, grown claims, pairs and guards (the valley example)', () => {
        const pursuits = [
            pursuit({ id: 'kira', want: 4, claim: 'interest' }),
            pursuit({ id: 'sera', want: 4, claim: 'claimed' }),
            pursuit({ id: 'tessa', want: 3, claim: 'interest' }),
            pursuit({ id: 'ula', want: 2, claim: 'none' }),
            pursuit({ id: 'mira-fan', want: 5, target: 'mira' }),
        ];
        const stances: Record<string, number> = { 'kira>sera': -1, 'sera>kira': -2 };
        const report = analyzeRivalry(PLAYER_ID, pursuits, (a, b) => stances[`${a}>${b}`] ?? 0);
        expect(report.rivals).toEqual(['kira', 'sera', 'tessa']);
        expect(report.claims).toEqual({ kira: 'claimed', sera: 'claimed', tessa: 'claimed', ula: 'interest' });
        expect(report.pairs).toEqual([
            { a: 'kira', b: 'sera', relation: 'feud' },
            { a: 'kira', b: 'tessa', relation: 'feud' },
            { a: 'sera', b: 'tessa', relation: 'feud' },
        ]);
        expect(report.guards).toEqual({ kira: 2, sera: 2, tessa: 2 });
    });

    it('caps guards at 3 and skips coalition partners', () => {
        const owners = ['a', 'b', 'c', 'd'].map((id) => pursuit({ id, want: 5, claim: 'owned' }));
        const report = analyzeRivalry(PLAYER_ID, owners, () => 0);
        expect(Object.values(report.guards)).toEqual([3, 3, 3, 3]);
        const friends = analyzeRivalry(PLAYER_ID, owners, () => 2);
        expect(Object.values(friends.guards)).toEqual([0, 0, 0, 0]);
        expect(friends.pairs.every((p) => p.relation === 'coalition')).toBe(true);
    });
});
