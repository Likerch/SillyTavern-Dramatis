// Fake intent readings (the model's JSON answers, docs/model.md §7) for the tavern card and the monster-girl valley,
// shaped exactly like INTENT_SCHEMA, with helpers that fill the «nothing said» values.
import type { CardSource } from '../../src/shared/contracts';

type Dict = Record<string, unknown>;

export function ev(path: string, quote: string, source: string): Dict {
    return { path, quote, source };
}

export function coreAnswer(patch: Dict = {}): Dict {
    return {
        concept: '',
        values: [],
        sacrifice: '',
        temperament: {
            honesty: 0,
            emotionality: 0,
            extraversion: 0,
            agreeableness: 0,
            conscientiousness: 0,
            openness: 0,
        },
        drivesHigh: [],
        drivesLow: [],
        wound: { ghost: '', lie: '', triggers: [], coping: '' },
        want: '',
        need: '',
        arcLock: false,
        signatures: [],
        tactics: [],
        attachment: { anxiety: 0, avoidance: 0 },
        proactivity: -1,
        mood: { octant: '', label: '' },
        bounds: [],
        redLinesNever: [],
        redLinesWould: [],
        keys: [],
        weakness: '',
        voice: '',
        justifications: [],
        dark: { ruthless: false, schemer: false, sadist: false, entitled: false },
        corruption: -1,
        anchors: [],
        ...patch,
    };
}

export function agendaAnswer(patch: Dict = {}): Dict {
    return {
        dream: '',
        goals: [],
        intentions: [],
        front: { impulse: '', steps: [], doom: '', segments: 0 },
        resources: [],
        leverage: [],
        secrets: [],
        ifIgnored: '',
        ...patch,
    };
}

export function tieAnswer(target: string, stance: number, patch: Dict = {}): Dict {
    return {
        target,
        stance,
        reasons: [],
        behaviour: '',
        intent: 'none',
        changeIf: [],
        want: 0,
        gaze: '',
        appetite: '',
        ...patch,
    };
}

export function appetiteAnswer(kind: string, patch: Dict = {}): Dict {
    return {
        kind,
        label: '',
        sources: ['individual'],
        target: 'thing',
        targetClass: '',
        baseline: 2,
        triggers: [],
        satisfiers: [],
        drift: 'opportunity',
        dependence: 0,
        endorsement: 'proud',
        vow: 'none',
        visibility: 'open',
        style: '',
        affectionOnset: '',
        excuse: '',
        restraints: [],
        rule: '',
        ...patch,
    };
}

export function characterAnswer(name: string, patch: Dict = {}): Dict {
    return {
        name,
        english: '',
        aliases: [],
        russian: [],
        kind: 'character',
        gender: '',
        minor: false,
        role: '',
        species: '',
        core: coreAnswer(),
        appetites: [],
        agenda: agendaAnswer(),
        ties: [],
        starts: [],
        evidence: [],
        ...patch,
    };
}

export function answer(patch: Dict = {}): Dict {
    return {
        worldTone: { tone: '', evidence: [] },
        characters: [],
        rules: [],
        reputation: [],
        invariants: [],
        ...patch,
    };
}

/* ------------------------------------------------------------------ the tavern */

export const TAVERN_CARD: CardSource = {
    avatar: 'tavern.png',
    name: 'Трактир «Рог»',
    description:
        'Ильва — хозяйка трактира «Рог» в оккупированном городке. Вдова мятежника: имперцы повесили её мужа. Она ненавидит имперцев и к чужакам холодна. Её дочь Сота мечтает уехать из города. Наёмник Брам пьёт и берётся за любую работу. Возчики играют в кости в углу.',
    personality: '',
    scenario: '{{user}} — имперский курьер, который остановился в трактире на ночь.',
    firstMes:
        'Ильва не поднимает глаз от выручки. — Комната — три монеты. Деньги вперёд, курьер, — бросает она и отворачивается. Брам за угловым столом прищуривается на твой кошель.',
    alternateGreetings: ['Утро. Сота вытирает столы и украдкой разглядывает {{user}}.'],
    mesExample: '',
    creatorNotes: 'Ильва должна оставаться враждебной к имперцам; её доверие зарабатывается медленно и только делами.',
    systemPrompt: '',
    postHistory: '',
    depthPrompt: '',
    tags: ['slow burn', 'occupation'],
    persona: { name: 'Курьер', description: 'Имперский курьер.' },
};

/** S1 description, S2 scenario, S3 greeting 0, S4 greeting 1, S5 creator's notes, S6 tags, S7 persona. */
export function tavernAnswer(ilvaStance = -2): Dict {
    return answer({
        worldTone: { tone: 'hostile', evidence: [ev('worldTone', 'в оккупированном городке', 'S1')] },
        characters: [
            characterAnswer('Ильва', {
                english: 'Ilva',
                aliases: ['хозяйка'],
                gender: 'female',
                role: 'innkeeper',
                core: coreAnswer({
                    concept: "A rebel's widow who keeps the inn in an occupied town",
                    values: ['benevolence', 'self-direction', 'tradition'],
                    temperament: {
                        honesty: 1,
                        emotionality: 0,
                        extraversion: 0,
                        agreeableness: -2,
                        conscientiousness: 0,
                        openness: 0,
                    },
                    wound: {
                        ghost: 'The Empire hanged her husband',
                        lie: 'No imperial can be trusted',
                        triggers: ['an imperial uniform'],
                        coping: 'overcompensate',
                    },
                    want: 'Wants every guest to feel welcome',
                    proactivity: 6,
                    mood: { octant: 'hostile', label: 'мрачная настороженность' },
                    voice: 'Деньги вперёд, курьер',
                    anchors: ['Сота'],
                }),
                agenda: agendaAnswer({
                    goals: [{ text: 'Wants to keep the inn', kind: 'external', priority: 1 }],
                }),
                ties: [
                    tieAnswer('PLAYER', ilvaStance, {
                        reasons: ['an imperial', 'the Empire hanged her husband'],
                        behaviour: 'takes his coin, gives nothing back',
                        changeIf: ['earns trust slowly, only through deeds'],
                    }),
                    tieAnswer('Сота', 3, { reasons: ['her daughter'], intent: 'protect' }),
                ],
                starts: [{ greeting: 0, present: true, doing: 'counting the takings', goal: 'get paid in advance' }],
                evidence: [
                    ev('core.concept', 'Вдова мятежника: имперцы повесили её мужа', 'S1'),
                    ev('core.wound', 'имперцы повесили её мужа', 'S1'),
                    ev('core.temperament', 'Она ненавидит имперцев и к чужакам холодна', 'S1'),
                    ev('core.mood', 'Ильва не поднимает глаз от выручки', 'S3'),
                    ev('core.proactivity', 'бросает она и отворачивается', 'S3'),
                    ev('core.voice', 'Деньги вперёд, курьер', 'S3'),
                    ev('core.anchors', 'Её дочь Сота', 'S1'),
                    ev('core.want', 'Ильва любит всех гостей и рада каждому', 'S1'),
                    ev('agenda.goals', 'Ильва — хозяйка трактира «Рог»', 'S1'),
                    ev('ties.PLAYER', 'Она ненавидит имперцев', 'S1'),
                    ev('ties.PLAYER', 'Ильва должна оставаться враждебной к имперцам', 'S5'),
                    ev('ties.Сота', 'Её дочь Сота мечтает уехать из города', 'S1'),
                    ev('starts.0', 'Ильва не поднимает глаз от выручки', 'S3'),
                ],
            }),
            characterAnswer('Сота', {
                gender: 'female',
                ties: [
                    tieAnswer('PLAYER', 1, {
                        reasons: ['curious about the stranger'],
                        behaviour: 'hides her interest from her mother',
                    }),
                ],
                starts: [{ greeting: 1, present: true, doing: 'wiping tables', goal: 'get a look at the stranger' }],
                evidence: [
                    ev('ties.PLAYER', 'украдкой разглядывает {{user}}', 'S4'),
                    ev('starts.1', 'Сота вытирает столы', 'S4'),
                ],
            }),
            characterAnswer('Брам', {
                gender: 'male',
                role: 'sellsword',
                appetites: [appetiteAnswer('drink', { label: 'выпивка', baseline: 3 })],
                ties: [
                    tieAnswer('{{user}}', 0, {
                        reasons: ['sees a purse'],
                        behaviour: 'will offer protection at a steep price',
                        intent: 'use',
                    }),
                ],
                evidence: [
                    ev('ties.{{user}}', 'прищуривается на твой кошель', 'S3'),
                    ev('appetites.drink', 'Наёмник Брам пьёт', 'S1'),
                ],
            }),
            characterAnswer('возчики', {
                kind: 'group',
                english: 'the carters',
                starts: [{ greeting: 0, present: true, doing: 'dice', goal: '' }],
                evidence: [ev('starts', 'Возчики играют в кости в углу', 'S1')],
            }),
        ],
        reputation: [
            {
                greeting: -1,
                among: '*',
                label: 'имперский курьер',
                stance: -1,
                evidence: [ev('reputation', 'имперский курьер', 'S2')],
            },
        ],
        invariants: [
            {
                text: 'Ilva stays hostile to imperials until deeds earn her trust',
                evidence: [ev('invariants', 'её доверие зарабатывается медленно и только делами', 'S5')],
            },
        ],
    });
}

/* ------------------------------------------------------------------ the monster-girl valley */

export const VALLEY_CARD: CardSource = {
    avatar: 'valley.png',
    name: 'Долина монстродев',
    description: 'Долина монстродев. Здесь живут гарпии, ламии, ящерицы и паучихи. Мужчин в долине нет.',
    personality: '',
    scenario: 'Герой {{user}} — единственный мужчина в долине, и каждая монстродева видит в нём пару.',
    firstMes: 'Кира, гарпия, кружит над скалами и не сводит глаз с {{user}}. — Чужак на моих скалах, — шипит она.',
    alternateGreetings: ['Серафина, ламия, улыбается {{user}} из тени: — Какой редкий гость…'],
    mesExample: '',
    creatorNotes: '',
    systemPrompt: '',
    postHistory: '',
    depthPrompt: '',
    tags: ['monster girls'],
    persona: { name: 'Герой', description: '' },
};

/** S1 description, S2 scenario, S3 greeting 0, S4 greeting 1, S5 tags, S6 persona. */
export function valleyAnswer(): Dict {
    return answer({
        worldTone: {
            tone: 'neutral',
            evidence: [ev('worldTone', 'Здесь живут гарпии, ламии, ящерицы и паучихи', 'S1')],
        },
        rules: [
            {
                name: 'every monster girl sees the hero as a mate',
                holders: 'монстродевы долины',
                kind: 'flesh',
                label: 'пара',
                source: 'world',
                target: 'player',
                targetClass: '',
                intensity: { zero: 0.2, low: 0.25, mid: 0.25, high: 0.3 },
                styles: [
                    { style: 'raider', weight: 2 },
                    { style: 'siren', weight: 1 },
                    { style: 'duelist', weight: 1 },
                ],
                choosiness: 1,
                exclusivity: 'exclusive',
                affectionOnset: 'possible',
                groupMode: 'solitary',
                evidence: [
                    ev('rules', 'каждая монстродева видит в нём пару', 'S2'),
                    ev('rules', 'Герой {{user}} — единственный мужчина в долине', 'S2'),
                ],
            },
        ],
        characters: [
            characterAnswer('Кира', {
                gender: 'female',
                species: 'harpy',
                appetites: [
                    appetiteAnswer('flesh', {
                        label: 'пара',
                        sources: ['species', 'world'],
                        target: 'player',
                        baseline: 4,
                        style: 'raider',
                        rule: 'every monster girl sees the hero as a mate',
                    }),
                ],
                ties: [
                    tieAnswer('PLAYER', -1, {
                        reasons: ['a stranger on her cliffs'],
                        behaviour: 'circles overhead, waits for him to be alone in the open',
                        want: 4,
                        gaze: 'prey',
                        appetite: 'flesh',
                    }),
                ],
                evidence: [
                    ev('ties.PLAYER', 'Чужак на моих скалах', 'S3'),
                    ev('appetites.flesh', 'не сводит глаз с {{user}}', 'S3'),
                ],
            }),
            characterAnswer('Серафина', {
                gender: 'female',
                species: 'lamia',
                appetites: [
                    appetiteAnswer('flesh', {
                        sources: ['species', 'world'],
                        target: 'player',
                        baseline: 4,
                        style: 'siren',
                    }),
                ],
                ties: [tieAnswer('PLAYER', 1, { reasons: ['a rare guest'], want: 4, gaze: 'mate', appetite: 'flesh' })],
                evidence: [
                    ev('ties.PLAYER', 'улыбается {{user}} из тени', 'S4'),
                    ev('appetites.0', 'Какой редкий гость', 'S4'),
                ],
            }),
            characterAnswer('монстродевы долины', {
                kind: 'group',
                evidence: [],
            }),
        ],
    });
}
