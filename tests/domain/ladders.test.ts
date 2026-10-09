import { describe, expect, it } from 'vitest';
import * as ladders from '../../src/domain/ladders';
import {
    APPETITE_KINDS,
    DRIVES,
    GAZES,
    HEXACO,
    JUSTIFICATIONS,
    MOODS,
    MOVES,
    STANCES,
    STYLES,
    TIE_INTENTS,
    VALUES,
} from '../../src/domain/model';

const CYRILLIC = /\p{Script=Cyrillic}/u;

describe('stance ladder (§4.3)', () => {
    it('has English prompt words and Russian UI labels for every step', () => {
        expect(STANCES.map((s) => ladders.stanceLabel(s, 'en'))).toEqual([
            'at war',
            'hostile',
            'interfering',
            'neutral',
            'helpful',
            'friendly',
            'allied',
        ]);
        expect(STANCES.map((s) => ladders.stanceLabel(s, 'ru'))).toEqual([
            'Война',
            'Враждебен',
            'Мешает',
            'Нейтрален',
            'Расположен',
            'Дружелюбен',
            'Союзник',
        ]);
        expect(ladders.stanceLabel(-2, 'ru', 'female')).toBe('Враждебна');
        expect(ladders.stanceLabel(3, 'ru', 'female')).toBe('Союзница');
        expect(ladders.stanceLabel(1, 'ru', 'male')).toBe('Расположен');
        expect(ladders.stanceNoun(-2, 'ru')).toBe('враждебность');
        expect(ladders.stanceNoun(-2, 'en')).toBe('hostile');
    });

    it('defines behaviour per step, gender-free, and clamps out-of-range values', () => {
        expect(ladders.stanceBehaviour(-2, 'en')).toBe('tries to do harm when it is safe');
        expect(ladders.stanceBehaviour(-2, 'ru')).toBe('старается навредить, если это не опасно');
        expect(ladders.stanceBehaviour(3, 'en')).toBe('helps even at a cost to themselves');
        expect(ladders.stanceLabel(9, 'en')).toBe('allied');
        expect(ladders.stanceLabel(-9, 'en')).toBe('at war');
        expect(ladders.stanceLabel(Number.NaN, 'en')).toBe('at war');
        expect(ladders.stanceLabel(0.6, 'en')).toBe('helpful');
        for (const s of STANCES) expect(ladders.stanceBehaviour(s, 'ru')).toMatch(CYRILLIC);
    });
});

describe('pressure, gaze, methods, styles (§4.5, §5.7)', () => {
    it('words the pressure ladder in both languages and genders', () => {
        expect([0, 1, 2, 3, 4, 5].map((p) => ladders.pressureLabel(p, 'en'))).toEqual([
            'sated',
            'background',
            'present',
            'preoccupied',
            'driving',
            'obsessed',
        ]);
        expect([0, 1, 2, 3, 4, 5].map((p) => ladders.pressureLabel(p, 'ru'))).toEqual([
            'сыт',
            'фон',
            'есть',
            'поглощён',
            'гонит',
            'одержим',
        ]);
        expect(ladders.pressureLabel(5, 'ru', 'female')).toBe('одержима');
        expect(ladders.pressureLabel(5, 'en', 'female')).toBe('obsessed');
        expect(ladders.pressureBehaviour(3, 'en')).toContain('plans around it');
        expect(ladders.pressureBehaviour(7, 'ru')).toContain('при первой возможности');
    });

    it('names gazes and phrases them for the card', () => {
        expect(GAZES.map((g) => ladders.gazeLabel(g, 'ru'))).toEqual([
            'Человек',
            'Приз',
            'Средство',
            'Собственность',
            'Добыча',
            'Пара по инстинкту',
        ]);
        expect(ladders.gazePhrase('property', 'en', 'plunder')).toBe('as loot to keep or sell');
        expect(ladders.gazePhrase('property', 'en')).toBe('as property to keep, guard or trade');
        expect(ladders.gazePhrase('prey', 'ru')).toBe('как дичь — выследить и схватить');
        for (const g of GAZES) {
            expect(ladders.gazeLabel(g, 'en')).toBe(g);
            expect(ladders.gazeBehaviour(g, 'en').length).toBeGreaterThan(10);
            expect(ladders.gazeBehaviour(g, 'ru')).toMatch(CYRILLIC);
        }
    });

    it('names the method ladder 0–8 and its present form', () => {
        expect(ladders.methodLabel(0, 'ru')).toBe('Удержаться, переключиться');
        expect(ladders.methodLabel(8, 'ru')).toBe('Сила');
        expect(ladders.methodLabel(12, 'en')).toBe('force');
        expect(ladders.methodNow(5, 'en')).toBe('deceiving');
        expect(ladders.methodNow(2, 'ru')).toBe('выжидает и готовится');
        expect(ladders.schemingLabel('en')).toBe('scheming');
        expect(ladders.schemingLabel('ru')).toBe('готовит замысел');
    });

    it('names every style with its way', () => {
        for (const style of STYLES) {
            expect(ladders.styleLabel(style, 'en')).toBe(style);
            expect(ladders.styleLabel(style, 'ru')).toMatch(CYRILLIC);
            expect(ladders.styleBehaviour(style, 'en')).not.toBe('');
            expect(ladders.styleBehaviour(style, 'ru')).toMatch(CYRILLIC);
        }
        expect(ladders.styleLabel('insider', 'ru')).toBe('Свой');
    });
});

describe('attention, moves, moods', () => {
    it('words bands and moves', () => {
        expect(ladders.bandLabel('focus', 'ru')).toBe('В фокусе');
        expect(ladders.bandLabel('business', 'en')).toBe('business');
        expect(ladders.bandMeaning('background', 'ru')).toContain('часть обстановки');
        expect(ladders.bandMeaning('focus', 'en')).toContain('main concern');
        expect(ladders.moveLabel('obstruct', 'en', 'Брам')).toBe("gets in Брам's way");
        expect(ladders.moveLabel('initiate', 'ru', 'Брам')).toBe('заводит разговор или дело (Брам)');
        expect(ladders.moveLabel('leave', 'en', 'Брам')).toBe('leaves');
        expect(ladders.moveLabel('respond', 'en')).toBe('responds');
        expect(ladders.moveLabel('watch', 'en', '  ')).toBe('watches');
        for (const move of MOVES) expect(ladders.moveLabel(move, 'ru')).toMatch(CYRILLIC);
    });

    it('names every mood octant', () => {
        for (const mood of MOODS) {
            expect(ladders.moodLabel(mood, 'en')).toBe(mood);
            expect(ladders.moodLabel(mood, 'ru')).toMatch(CYRILLIC);
        }
    });
});

describe('core vocabularies', () => {
    it('has Russian names for values, drives, HEXACO axes and justifications', () => {
        for (const value of VALUES) expect(ladders.valueLabel(value, 'ru')).toMatch(CYRILLIC);
        for (const drive of DRIVES) expect(ladders.driveLabel(drive, 'ru')).toMatch(CYRILLIC);
        for (const axis of HEXACO) expect(ladders.hexacoLabel(axis, 'ru')).toMatch(CYRILLIC);
        for (const item of JUSTIFICATIONS) expect(ladders.justificationLabel(item, 'ru')).toMatch(CYRILLIC);
        expect(ladders.valueLabel('benevolence', 'en')).toBe('care for their own');
        expect(ladders.driveLabel('vengeance', 'ru')).toBe('месть');
        expect(ladders.hexacoLabel('extraversion', 'ru')).toBe('общительность');
        expect(ladders.justificationLabel('blame', 'en')).toBe('they brought it on themselves');
    });

    it('words only the extremes of temperament', () => {
        expect(ladders.hexacoPole('agreeableness', -2, 'en')).toBe('quick to anger, unforgiving');
        expect(ladders.hexacoPole('honesty', 2, 'ru')).toBe('честный до щепетильности');
        expect(ladders.hexacoPole('openness', 1, 'en')).toBe('');
        expect(ladders.hexacoPole('openness', 1, 'en', 1)).toBe('curious and unconventional');
        expect(ladders.hexacoPole('openness', Number.NaN, 'en')).toBe('');
    });

    it('puts the temperament poles in a woman’s gender in Russian', () => {
        expect(ladders.hexacoPole('honesty', -2, 'ru', 2, 'female')).toBe('хитрая и жадная');
        expect(ladders.hexacoPole('extraversion', -2, 'ru', 2, 'male')).toBe('замкнутый');
        expect(ladders.hexacoPole('extraversion', -2, 'ru')).toBe('замкнутый');
        expect(ladders.hexacoPole('agreeableness', 2, 'en', 2, 'female')).toBe('patient and forgiving');
        expect(ladders.hexacoPole('openness', 1, 'ru', 2, 'female')).toBe('');
        for (const axis of HEXACO) {
            for (const level of [-2, 2]) expect(ladders.hexacoPole(axis, level, 'ru', 2, 'female')).toMatch(CYRILLIC);
        }
    });
});

describe('appetites, ties, world and provenance', () => {
    it('names appetite kinds and sources with pronouns', () => {
        for (const kind of APPETITE_KINDS) {
            expect(ladders.appetiteKindLabel(kind, 'en')).not.toBe('');
            expect(ladders.appetiteKindLabel(kind, 'ru')).toMatch(CYRILLIC);
        }
        expect(ladders.appetiteSourceLabel('culture', 'en', 'male')).toBe("his band's custom");
        expect(ladders.appetiteSourceLabel('species', 'en', 'female')).toBe("her kind's nature");
        expect(ladders.appetiteSourceLabel('individual', 'en')).toBe('their own craving');
        expect(ladders.appetiteSourceLabel('world', 'ru')).toBe('правило мира');
        expect(ladders.possessive(undefined)).toBe('their');
    });

    it('words the appetite attitudes and claims', () => {
        expect(ladders.endorsementLabel('fighting', 'ru')).toBe('борется');
        expect(ladders.vowLabel('abstinent', 'ru')).toBe('завязал');
        expect(ladders.vowLabel('none', 'en')).toBe('no vow');
        expect(ladders.visibilityLabel('secret', 'ru')).toBe('тайна');
        expect(ladders.claimLabel('claimed', 'ru')).toBe('застолбил');
        expect(ladders.claimLabel('claimed', 'ru', 'female')).toBe('застолбила');
        expect(ladders.claimLabel('owned', 'ru', 'female')).toBe('владеет');
        expect(ladders.claimLabel('claimed', 'en', 'female')).toBe('has staked a claim');
        expect(ladders.onsetLabel('rare', 'en')).toBe('rarely');
    });

    it('words desirability and corruption the way the sheet does', () => {
        expect([0, 1, 2, 3, 4, 5].map((n) => ladders.wantLabel(n, 'ru'))).toEqual([
            'нет',
            'едва',
            'немного',
            'заметно',
            'сильно',
            'неодолимо',
        ]);
        expect(ladders.wantLabel(9, 'en')).toBe('overpoweringly');
        expect([0, 1, 2, 3, 5, 7, 10].map((n) => ladders.corruptionLabel(n, 'en'))).toEqual([
            'clean',
            'keeps to principles',
            'keeps to principles',
            'excuses are habitual',
            'strangers are almost things',
            'the craving is part of who they are',
            'lost',
        ]);
        expect(ladders.corruptionLabel(10, 'ru')).toBe('потерян');
        expect(ladders.corruptionLabel(10, 'ru', 'female')).toBe('потеряна');
        expect(ladders.corruptionLabel(0, 'ru', 'female')).toBe('чиста');
        expect(ladders.corruptionLabel(4, 'ru', 'female')).toBe('оправдания привычны');
        expect(ladders.corruptionLabel(Number.NaN, 'en')).toBe('clean');
    });

    it('words tie intents, world tone, coping, arcs, levels of detail and origins', () => {
        for (const intent of TIE_INTENTS) expect(ladders.tieIntentLabel(intent, 'ru')).toMatch(CYRILLIC);
        expect(ladders.worldToneLabel('indifferent', 'ru')).toBe('безразличный');
        expect(ladders.copingLabel('overcompensate', 'ru')).toBe('идёт в атаку');
        expect(ladders.arcStageLabel('glimpsed', 'ru')).toBe('правда увидена');
        expect(ladders.lodLabel('portrait', 'ru')).toBe('Портрет');
        expect(ladders.originLabel('user', 'ru')).toBe('твоя правка');
        expect(ladders.originLabel('generated', 'en')).toBe('generated');
    });
});
