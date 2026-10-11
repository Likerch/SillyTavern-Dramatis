import { describe, expect, it } from 'vitest';
import { PLAYER_ID } from '../../src/domain/model';
import type { Appetite, CharacterProfile } from '../../src/domain/model';
import { buildCastCard, buildCorrectionLines, estimateTokens, strongestReasons, tieOf } from '../../src/domain/render';
import type { CastCardInput } from '../../src/domain/render';
import { TAVERN_BANDS, TAVERN_PRESENT, chat, liveState, profile, raid, reason, tavern, tie } from './cast-fixtures';

const HEADER =
    '[Cast minds — what drives each present character now. They act from these motives; the world does not revolve around Courier. Keep stances as given; attention to Courier only as stated.]';

function tavernInput(patch: Partial<CastCardInput> = {}): CastCardInput {
    const { profiles, state } = tavern();
    return {
        profiles,
        state,
        present: TAVERN_PRESENT,
        bands: TAVERN_BANDS,
        moves: { ilva: { move: 'initiate', target: 'bram', text: 'quietly sends Брам to follow him' } },
        playerName: 'Courier',
        lang: 'en',
        budgetTokens: 0,
        mergeVoices: false,
        ...patch,
    };
}

const TAVERN_LEAN = [
    HEADER,
    "Ильва — counting the week's takings; must raise the garrison tax by Friday. Toward Courier: hostile (an imperial) — takes his coin, gives nothing back, never says his name. This turn: quietly sends Брам to follow him.",
    'Брам — dicing with the carters; wants paid work before winter. Toward Courier: neutral (sees a purse) — will offer "protection" at a steep price.',
    'Сота — wiping tables, listening; wants a way out of this town. Toward Courier: helpful (curious about the stranger) — hides her interest from her mother.',
    'Busy with their own: the carters (dice), Фенн (asleep).',
].join('\n');

describe('buildCastCard — the tavern (§6.2)', () => {
    it('renders the full card: blocks for business and focus, the busy line for the background', () => {
        const card = buildCastCard(tavernInput());
        expect(card.text).toBe(
            [
                HEADER,
                "Ильва — counting the week's takings; must raise the garrison tax by Friday. Toward Courier: hostile (an imperial; the Empire hanged her husband) — takes his coin, gives nothing back, never says his name. This turn: quietly sends Брам to follow him. Pattern: if she is ordered about, does it slowly and badly. Secret: passes letters to the rebels. With Сота: allied (her daughter). Mood: grim watchfulness.",
                'Брам — dicing with the carters; wants paid work before winter. Toward Courier: neutral (sees a purse) — will offer "protection" at a steep price. Mood: relaxed.',
                'Сота — wiping tables, listening; wants a way out of this town. Toward Courier: helpful (curious about the stranger) — hides her interest from her mother. Mood: relaxed.',
                'Busy with their own: the carters (dice), Фенн (asleep).',
            ].join('\n'),
        );
        expect(card.included).toEqual(TAVERN_PRESENT);
        expect(card.trimmed).toEqual([]);
        expect(card.tokens).toBe(estimateTokens(card.text));
        expect(card.text).not.toMatch(/-?\d/);
        expect(card.text).not.toContain('Desire is not affection');
    });

    it('trims extra reasons, then signatures, secrets, ties and mood first', () => {
        const card = buildCastCard(tavernInput({ budgetTokens: estimateTokens(TAVERN_LEAN) }));
        expect(card.text).toBe(TAVERN_LEAN);
        expect(card.trimmed).toEqual([]);
    });

    it('keeps two reasons and drops only the extras of the second level when it fits', () => {
        const full = buildCastCard(tavernInput()).text;
        const card = buildCastCard(tavernInput({ budgetTokens: estimateTokens(full) - 1 }));
        expect(card.text).toContain('hostile (an imperial) —');
        expect(card.text).toContain('Pattern: if she is ordered about');
    });

    it('then drops the busy line details, then whole blocks — lowest band and no move first, focus last', () => {
        const noDetails = TAVERN_LEAN.replace('the carters (dice), Фенн (asleep)', 'the carters, Фенн');
        let card = buildCastCard(tavernInput({ budgetTokens: estimateTokens(noDetails) }));
        expect(card.text).toBe(noDetails);

        card = buildCastCard(tavernInput({ budgetTokens: estimateTokens(noDetails) - 30 }));
        expect(card.trimmed).toEqual(['bram']);
        expect(card.text).toContain('Busy with their own: Брам, the carters, Фенн.');
        expect(card.text).toContain('Ильва —');

        card = buildCastCard(tavernInput({ budgetTokens: 10 }));
        expect(card.trimmed).toEqual(['ilva', 'bram']);
        expect(card.text).toContain('Сота — wiping tables');
        expect(card.text).toContain('Busy with their own: Ильва, Брам, the carters, Фенн.');
        expect(card.included).toEqual(TAVERN_PRESENT);
    });

    it('renders a Russian card with gendered stance words', () => {
        const card = buildCastCard(tavernInput({ lang: 'ru', playerName: 'Курьер' }));
        const lines = card.text.split('\n');
        expect(lines[0]).toBe(
            '[Мотивы персонажей — что движет каждым из присутствующих сейчас. Они действуют из этих мотивов; мир не вращается вокруг игрока (Курьер). Позиции держать как заданы; внимание к игроку — только как указано.]',
        );
        expect(lines[1]).toContain('К игроку: враждебна (an imperial; the Empire hanged her husband) —');
        expect(lines[1]).toContain('В этот ход: quietly sends Брам to follow him.');
        expect(lines[1]).toContain('Привычка: if she is ordered about');
        expect(lines[1]).toContain('Тайна: passes letters to the rebels.');
        expect(lines[1]).toContain('Связь — Сота: союз (her daughter).');
        expect(lines[1]).toContain('Настроение: grim watchfulness.');
        expect(lines[2]).toContain('К игроку: нейтрален (sees a purse)');
        expect(lines[2]).toContain('Настроение: спокойное.');
        expect(lines[3]).toContain('К игроку: расположена');
        expect(lines[4]).toBe('Заняты своим: the carters (dice), Фенн (asleep).');
    });

    it('uses a gender-free noun in Russian when the gender is unknown', () => {
        const input = tavernInput({ lang: 'ru', bands: { ...TAVERN_BANDS, fenn: 'focus' } });
        expect(buildCastCard(input).text).toContain('Фенн — asleep. К игроку: нейтралитет — по своим делам');
    });

    it('rotates the signature or tactic with the turn', () => {
        const input = tavernInput();
        input.state = { ...input.state, turn: 1 };
        expect(buildCastCard(input).text).toContain('Tactic: bluntness.');
        input.state = { ...input.state, turn: 3 };
        expect(buildCastCard(input).text).toContain('Tactic: refusing small favours.');
    });

    it('takes the move from the state when none is given, and the generic words without a text', () => {
        const input = tavernInput({ moves: { bram: { move: 'watch', target: PLAYER_ID } } });
        input.state.characters.sota!.scene = {
            ...input.state.characters.sota!.scene,
            move: 'initiate',
            moveTarget: 'bram',
        };
        const text = buildCastCard(input).text;
        expect(text).toContain('This turn: watches Courier closely and misses nothing.');
        expect(text).toContain('This turn: acts first toward Брам — starts it now, does not wait to be asked.');
        expect(text).not.toContain('quietly sends');
        const own = buildCastCard(tavernInput({ moves: { ilva: { move: 'own' } } })).text;
        expect(own).not.toContain('This turn:');
    });

    it('gives a background character a block when they make a move, and notes hostility in the busy line', () => {
        const input = tavernInput({ bands: { ...TAVERN_BANDS, ilva: 'background' }, moves: {} });
        expect(buildCastCard(input).text).toContain(
            "Busy with their own: Ильва (counting the week's takings; ignores Courier, hostile), the carters (dice), Фенн (asleep).",
        );
        const moving = tavernInput({
            bands: { ...TAVERN_BANDS, fenn: 'background' },
            moves: { fenn: { move: 'leave' } },
        });
        expect(buildCastCard(moving).text).toContain('Фенн — asleep. Toward Courier: neutral');
        expect(buildCastCard(moving).text).toContain(
            'This turn: leaves the scene for their own business — once gone, they stay out of it.',
        );
    });

    it('falls back to the state band, then business; skips unknown ids', () => {
        const input = tavernInput({ bands: {}, present: ['ilva', 'nobody'] });
        input.state.characters.ilva!.scene.attention = 'background';
        const card = buildCastCard({ ...input, moves: {} });
        expect(card.text).toContain('Busy with their own: Ильва');
        expect(card.included).toEqual(['ilva']);
        const { profiles } = tavern();
        const fresh = buildCastCard({ ...tavernInput(), state: chat(), bands: {}, present: ['bram'] });
        expect(fresh.text).toContain('Брам — dicing with the carters; wants paid work before winter.');
        expect(profiles.length).toBe(5);
    });

    it('returns an empty card when nobody known is present', () => {
        expect(buildCastCard(tavernInput({ present: ['nobody'] }))).toEqual({
            text: '',
            included: [],
            elsewhere: [],
            trimmed: [],
            tokens: 0,
        });
    });

    it('merges the voice digest and the sample line when asked', () => {
        const input = tavernInput({
            mergeVoices: true,
            speech: (id) => (id === 'ilva' ? 'clipped, dry; never wastes a word' : null),
        });
        input.profiles = input.profiles.map((item) =>
            item.id === 'ilva' ? { ...item, core: { ...item.core, voice: 'Деньги   вперёд, sir.' } } : item,
        );
        const text = buildCastCard(input).text;
        expect(text).toContain(
            'Ильва — voice: clipped, dry; never wastes a word; says things like: "Деньги вперёд, sir."',
        );
        const off = buildCastCard({ ...input, mergeVoices: false }).text;
        expect(off).toContain('Ильва — voice: says things like: "Деньги вперёд, sir."');
        expect(off).not.toContain('clipped');
    });

    it('adds correction lines and the live emotion', () => {
        const input = tavernInput({ corrections: { ilva: ['still hostile toward Courier'] } });
        input.state.characters.ilva!.emotion = {
            type: 'anger',
            intensity: 3,
            target: 'bram',
            cause: 'lost at dice',
            until: 5,
        };
        const text = buildCastCard(input).text;
        expect(text).toContain('Ильва — correction: still hostile toward Courier.');
        expect(text).toContain('Mood: grim watchfulness; anger at Брам (lost at dice).');
        input.state.turn = 6;
        expect(buildCastCard(input).text).not.toContain('anger at');
    });

    it('defaults the stance toward the player by world tone when there is no tie', () => {
        const stranger = profile('stranger', 'Хельга');
        const base = {
            profiles: [stranger],
            present: ['stranger'],
            bands: { stranger: 'business' as const },
            playerName: '',
            lang: 'en' as const,
            budgetTokens: 0,
            mergeVoices: false,
        };
        expect(buildCastCard({ ...base, state: chat({}, { worldTone: 'hostile' }) }).text).toContain(
            'Хельга — Toward the player: interfering — makes trouble when it is cheap.',
        );
        expect(buildCastCard({ ...base, state: chat({}, { worldTone: 'welcoming' }) }).text).toContain(
            'Toward the player: helpful',
        );
        expect(buildCastCard({ ...base, lang: 'ru', state: chat() }).text).toContain(
            'мир не вращается вокруг игрока. Позиции',
        );
    });
});

describe('buildCastCard — appetites (§6.2, the raid)', () => {
    function raidInput(patch: Partial<CastCardInput> = {}): CastCardInput {
        const { profiles, state } = raid();
        return {
            profiles,
            state,
            present: ['grukk', 'mira'],
            bands: { grukk: 'business', mira: 'background' },
            playerName: 'Courier',
            lang: 'en',
            budgetTokens: 0,
            mergeVoices: false,
            appetites: {
                grukk: [
                    {
                        appetite: 'plunder',
                        brakes: ["the chief's ban on raids near the road (chief far away)", "fear of Courier's sword"],
                    },
                ],
            },
            ...patch,
        };
    }

    it('renders the appetite line exactly as the example and closes with the rule', () => {
        const lines = buildCastCard(raidInput()).text.split('\n');
        expect(lines).toContain(
            "Грукк — appetite: plunder and captives, driving; his band's custom. Wants Мира as loot to keep or sell — contempt, not liking. Held back by: the chief's ban on raids near the road (chief far away); fear of Courier's sword. Now: scheming — asks the carters when the caravan leaves, plans to cut off her wagon at the ford at dusk. Justifies it: \"whoever leaves goods unguarded has given them away\".",
        );
        expect(lines[1]).toBe(
            'Грукк — loitering by the carts; learn when the caravan leaves. Toward Courier: interfering (a guard with a sword) — makes trouble when it is cheap. Mood: relaxed.',
        );
        expect(lines.at(-2)).toBe('Busy with their own: Мира (checking her wagon).');
        expect(lines.at(-1)).toBe(
            'Desire is not affection: wanting or getting what they crave never raises regard. Show wanting through attention, calculation, preparation and justification, not warmth. Prefer cunning to shouting.',
        );
    });

    it('falls back to the authored restraints and the method step without a scheme', () => {
        const input = raidInput({ appetites: { grukk: [{ appetite: 'plunder', method: 2 }] } });
        input.state = { ...input.state, schemes: [] };
        const text = buildCastCard(input).text;
        expect(text).toContain("Held back by: the chief's ban on raids near the road.");
        expect(text).toContain('Now: biding time and preparing.');
        const told = raidInput({
            appetites: { grukk: [{ appetite: 'plunder', method: 5, methodText: 'lies about the road' }] },
        });
        told.state = { ...told.state, schemes: [] };
        expect(buildCastCard(told).text).toContain('Now: deceiving — lies about the road.');
    });

    it('shows the appetite only when it matters now', () => {
        const input = raidInput({ appetites: {} });
        input.state.characters.grukk!.appetites.plunder!.pressure = 1;
        input.profiles = input.profiles.map((item) =>
            item.id === 'grukk'
                ? { ...item, ties: item.ties.map((t) => (t.target === 'mira' ? { ...t, want: 2 } : t)) }
                : item,
        );
        input.state.characters.grukk!.ties.mira = { ...input.state.characters.grukk!.ties.mira!, want: 2 };
        const text = buildCastCard(input).text;
        expect(text).not.toContain('appetite:');
        expect(text).not.toContain('Desire is not affection');
        input.state.characters.grukk!.ties.mira = { ...input.state.characters.grukk!.ties.mira!, want: 3 };
        expect(buildCastCard(input).text).toContain('Wants Мира as loot to keep or sell — contempt, not liking.');
    });

    it('a background character with a live appetite keeps a block', () => {
        const input = raidInput({ bands: { grukk: 'background', mira: 'background' } });
        expect(buildCastCard(input).text).toContain('Грукк — appetite:');
        expect(buildCastCard(input).text).toContain('Грукк — loitering by the carts');
    });

    it('renders thing appetites with vows, withdrawal, endorsement and secrecy', () => {
        const drink: Appetite = {
            ...raid().profiles[0]!.appetites[0]!,
            id: 'drink',
            kind: 'drink',
            label: 'брага',
            sources: ['individual'],
            target: { mode: 'thing' },
            baseline: 4,
            dependence: 2,
            endorsement: 'fighting',
            vow: 'abstinent',
            visibility: 'hidden',
            excuse: undefined,
            restraints: undefined,
        };
        const yan = profile('yan', 'Ян', { gender: 'male', appetites: [drink] });
        const state = chat({
            yan: liveState(yan, {
                appetites: {
                    drink: {
                        pressure: 2,
                        tolerance: 0,
                        dependence: 2,
                        sensitization: 2,
                        lastSated: -1,
                        edgeCount: 0,
                        withdrawal: true,
                    },
                },
            }),
        });
        const base = {
            profiles: [yan],
            state,
            present: ['yan'],
            bands: { yan: 'business' as const },
            playerName: 'Courier',
            budgetTokens: 0,
            mergeVoices: false,
        };
        expect(buildCastCard({ ...base, lang: 'en' }).text).toContain(
            'Ян — appetite: drink ("брага"), present, in withdrawal; his own craving; fights it; hides it. Held back by: a vow to stay off it.',
        );
        expect(buildCastCard({ ...base, lang: 'ru' }).text).toContain(
            'Ян — влечение: выпивка («брага»), есть, ломка; личное; борется; скрывает. Сдерживает: обет завязать.',
        );
        const moderate = {
            ...yan,
            appetites: [
                { ...drink, vow: 'moderate' as const, endorsement: 'proud' as const, visibility: 'open' as const },
            ],
        };
        expect(buildCastCard({ ...base, profiles: [moderate], lang: 'en' }).text).toContain(
            'Held back by: keeping to a measure.',
        );
    });

    it('never shows a sexual appetite of a minor, nor one aimed at a minor (the content boundary)', () => {
        const flesh: Appetite = {
            ...raid().profiles[0]!.appetites[0]!,
            id: 'flesh',
            kind: 'flesh',
            sources: ['species'],
            target: { mode: 'class', class: 'travellers' },
        };
        const base = {
            state: chat({}),
            present: ['kira', 'tim'],
            bands: { kira: 'focus' as const, tim: 'focus' as const },
            playerName: 'Courier',
            budgetTokens: 0,
            mergeVoices: false,
            lang: 'en' as const,
        };
        const tim = profile('tim', 'Тим', { minor: true });
        const kira = profile('kira', 'Кира', {
            appetites: [flesh],
            ties: [tie('tim', 0, { want: 4, appetite: 'flesh' })],
        });
        const aimed = buildCastCard({ ...base, profiles: [kira, tim] }).text;
        expect(aimed).not.toContain('Wants Тим');
        const minor = { ...kira, minor: true, ties: [] };
        expect(buildCastCard({ ...base, profiles: [minor, tim] }).text).not.toContain('appetite: flesh');
    });

    it('aims class and player appetites and uses stock justifications', () => {
        const flesh: Appetite = {
            ...raid().profiles[0]!.appetites[0]!,
            id: 'flesh',
            kind: 'flesh',
            sources: ['species', 'world'],
            target: { mode: 'player' },
            excuse: undefined,
            restraints: undefined,
        };
        const kira = profile('kira', 'Кира', {
            gender: 'female',
            appetites: [flesh],
            core: { ...profile('x', 'x').core, justifications: ['blame'] },
            ties: [tie(PLAYER_ID, -1, { want: 4, gaze: 'prey' })],
        });
        const state = chat({});
        const base = {
            profiles: [kira],
            state,
            present: ['kira'],
            bands: { kira: 'focus' as const },
            playerName: 'Courier',
            budgetTokens: 0,
            mergeVoices: false,
            lang: 'en' as const,
        };
        const text = buildCastCard(base).text;
        expect(text).toContain(
            'Кира — appetite: flesh and mating, preoccupied; her kind\'s nature + a rule of this world. Wants Courier as prey to stalk and seize — contempt, not liking. Justifies it: "they brought it on themselves".',
        );
        const lamia = { ...kira, ties: [tie(PLAYER_ID, 2, { want: 4, gaze: 'mate' as const })] };
        expect(buildCastCard({ ...base, profiles: [lamia] }).text).toContain(
            'Wants Courier as a mate by instinct — fond as well — and will not let go.',
        );
        const warm = { ...kira, ties: [tie(PLAYER_ID, 1, { want: 3 })] };
        expect(buildCastCard({ ...base, profiles: [warm] }).text).toContain(
            'Wants Courier — fondness beside the wanting.',
        );
        const neutral = { ...kira, ties: [tie(PLAYER_ID, 0, { want: 3 })] };
        expect(buildCastCard({ ...base, profiles: [neutral] }).text).toContain('no liking involved');
        const war = { ...kira, ties: [tie(PLAYER_ID, -3, { want: 3 })] };
        expect(buildCastCard({ ...base, profiles: [war] }).text).toContain('hostility, not liking');
        const classy = {
            ...kira,
            appetites: [{ ...flesh, target: { mode: 'class' as const, class: 'human men' } }],
            ties: [],
        };
        expect(buildCastCard({ ...base, profiles: [classy] }).text).toContain('Wants human men.');
        const ru = buildCastCard({ ...base, lang: 'ru', playerName: 'Курьер' }).text;
        expect(ru).toContain(
            'Кира — влечение: плоть и спаривание, поглощена; природа вида + правило мира. Цель — Курьер как дичь — выследить и схватить — презрение, а не симпатия. Оправдание: «сами виноваты».',
        );
        expect(ru).toContain('Желание — не симпатия:');
    });

    it('prefers the target the appetite pass names, then present targets', () => {
        const input = raidInput();
        const grukk = input.profiles[0]!;
        const extra = profile('vera', 'Вера');
        input.profiles = [
            { ...grukk, ties: [...grukk.ties, tie('vera', 0, { want: 5, gaze: 'prize', appetite: 'plunder' })] },
            input.profiles[1]!,
            extra,
        ];
        input.state.characters.grukk!.ties.vera = tie('vera', 0, { want: 5, gaze: 'prize', appetite: 'plunder' });
        expect(buildCastCard(input).text).toContain('Wants Мира as loot');
        input.present = ['grukk', 'mira', 'vera'];
        expect(buildCastCard(input).text).toContain('Wants Вера as a prize to win and show off — no liking involved.');
        input.appetites = { grukk: [{ appetite: 'plunder', target: 'mira' }] };
        expect(buildCastCard(input).text).toContain('Wants Мира as loot');
    });
});

describe('helpers', () => {
    it('orders reasons by strength, permanent before fading', () => {
        expect(
            strongestReasons(
                [reason('fading', 1, 2), reason('weak', 0.5), reason('permanent', -1), reason('strong', -3)],
                3,
            ),
        ).toEqual(['strong', 'permanent', 'fading']);
        expect(strongestReasons([reason('x', 1)], 0)).toEqual([]);
    });

    it('reads the live tie before the base tie', () => {
        const { profiles, state } = tavern();
        const ilva = profiles[0] as CharacterProfile;
        expect(tieOf(ilva, undefined, PLAYER_ID)?.stance).toBe(-2);
        const live = { ...state.characters.ilva!, ties: { [PLAYER_ID]: tie(PLAYER_ID, -1) } };
        expect(tieOf(ilva, live, PLAYER_ID)?.stance).toBe(-1);
    });
});

describe('buildCorrectionLines (§8)', () => {
    const { profiles, state } = tavern();
    const ctx = { profiles, state, playerName: 'Courier', lang: 'en' as const };

    it('reminds the stance and its reason after warmth without a cause', () => {
        const lines = buildCorrectionLines(
            [{ character: 'ilva', target: PLAYER_ID, emphasise: ['stance'], drift: 'warmer' }],
            ctx,
        );
        expect(lines).toEqual({
            ilva: [
                'still hostile toward Courier (an imperial) — nothing has earned warmth; takes his coin, gives nothing back, never says his name',
            ],
        });
        const colder = buildCorrectionLines([{ character: 'sota', emphasise: ['stance'], drift: 'colder' }], ctx);
        expect(colder.sota![0]).toContain(
            'still helpful toward Courier (curious about the stranger) — nothing has turned them cold',
        );
        const ru = buildCorrectionLines([{ character: 'ilva', emphasise: ['stance'] }], { ...ctx, lang: 'ru' });
        expect(ru.ilva![0]).toBe(
            'по-прежнему враждебность к игроку (an imperial) — тепла без причины нет; takes his coin, gives nothing back, never says his name',
        );
        const npc = buildCorrectionLines([{ character: 'ilva', target: 'sota', emphasise: ['stance'] }], {
            ...ctx,
            lang: 'ru',
        });
        expect(npc.ilva![0]).toContain('по-прежнему союз к: Сота (her daughter)');
    });

    it('separates wanting from affection, keeps cravings and values', () => {
        const goblin = raid();
        const rctx = { profiles: goblin.profiles, state: goblin.state, playerName: 'Courier', lang: 'en' as const };
        const lines = buildCorrectionLines(
            [{ character: 'grukk', target: 'mira', emphasise: ['appetite-separation', 'stance', 'values'] }],
            rctx,
        );
        expect(lines.grukk).toEqual([
            'wanting is not affection — still wants Мира as loot to keep or sell; no tenderness without a cause',
            'still interfering toward Мира (a soft lowlander) — nothing has earned warmth; makes trouble when it is cheap',
            'acts from what they value (learn when the caravan leaves) — never against themselves without a cause',
        ]);
        const ru = buildCorrectionLines(
            [{ character: 'grukk', target: 'mira', emphasise: ['appetite-separation', 'values'] }],
            { ...rctx, lang: 'ru' },
        );
        expect(ru.grukk![0]).toBe(
            'хотение — не привязанность: цель — Мира как добычу — оставить себе или продать; нежности без причины нет',
        );
        expect(ru.grukk![1]).toContain('действует из своего');

        const ilvaValues = buildCorrectionLines([{ character: 'ilva', emphasise: ['values'] }], ctx);
        expect(ilvaValues.ilva![0]).toBe(
            'acts from what they value (care for their own, self-direction, tradition; must raise the garrison tax by Friday) — never against themselves without a cause',
        );
    });

    it('keeps a dependence from vanishing; skips unknown characters and appetite-less withdrawal', () => {
        const drink: Appetite = {
            ...raid().profiles[0]!.appetites[0]!,
            id: 'drink',
            kind: 'drink',
            label: undefined,
            dependence: 2,
        };
        const yan = profile('yan', 'Ян', { appetites: [drink] });
        const st = chat({
            yan: liveState(yan, {
                appetites: {
                    drink: {
                        pressure: 4,
                        tolerance: 0,
                        dependence: 2,
                        sensitization: 0,
                        lastSated: -1,
                        edgeCount: 0,
                        withdrawal: true,
                    },
                },
            }),
        });
        const c = { profiles: [yan, ...profiles], state: st, playerName: '', lang: 'en' as const };
        const lines = buildCorrectionLines(
            [
                { character: 'yan', emphasise: ['withdrawal', 'withdrawal'] },
                { character: 'ghost', emphasise: ['stance'] },
                { character: 'bram', emphasise: ['withdrawal'] },
            ],
            c,
        );
        expect(lines).toEqual({
            yan: [
                'the craving for drink is still driving, in withdrawal — it does not vanish without help or a reason',
            ],
        });
        const ru = buildCorrectionLines([{ character: 'yan', emphasise: ['withdrawal'] }], { ...c, lang: 'ru' });
        expect(ru.yan![0]).toBe(
            'тяга (выпивка) по-прежнему: гонит, ломка — сама не проходит, без опоры и причины не отказаться',
        );
        const labelled = { ...yan, appetites: [{ ...drink, label: 'брага' }] };
        const fresh = buildCorrectionLines([{ character: 'yan', emphasise: ['withdrawal'] }], {
            ...c,
            profiles: [labelled],
            state: chat(),
        });
        expect(fresh.yan![0]).toBe(
            'the craving for "брага" is still preoccupied — it does not vanish without help or a reason',
        );
    });
});
