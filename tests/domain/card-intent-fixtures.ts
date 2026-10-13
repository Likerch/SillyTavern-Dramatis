// The tavern card's structured intent (src/shared/card-intent.ts) as an authoring workshop would write it into
// `data.extensions.dramatis.intent`: the same people as tests/domain/intent-fixtures.ts, in the story's language.
import type { CardIntentV1 } from '../../src/shared/card-intent';

/** Complete: the world's tone and, for everyone, the concept, values, drives, want or a goal and the stance to PLAYER. */
export function tavernIntent(): CardIntentV1 {
    return {
        version: 1,
        world: {
            tone: 'hostile',
            invariants: ['Ильва никогда не выдаёт мятежников'],
            reputation: [{ among: 'стража', label: 'имперский курьер', stance: -2 }],
            rules: [
                {
                    name: 'возчики пьют',
                    holders: 'возчики',
                    kind: 'drink',
                    label: 'брага',
                    source: 'culture',
                    target: 'thing',
                    intensity: { zero: 1, low: 1, mid: 1, high: 1 },
                    styles: { buyer: 2 },
                },
            ],
        },
        characters: {
            Ильва: {
                english: 'Ilva',
                aliases: ['хозяйка'],
                gender: 'female',
                role: 'хозяйка трактира «Рог»',
                core: {
                    concept: 'вдова мятежника, держит трактир назло оккупантам',
                    values: { top: ['security', 'tradition'], sacrifice: 'conformity' },
                    temperament: { honesty: 1, agreeableness: -2 },
                    drives: { high: ['vengeance', 'family'], low: ['status'] },
                    wound: {
                        ghost: 'имперцы повесили её мужа',
                        lie: 'имперцам верить нельзя',
                        triggers: ['имперская форма'],
                        coping: 'overcompensate',
                    },
                    want: 'сберечь дочь и трактир',
                    proactivity: 6,
                    baselineMood: { octant: 'hostile', label: 'мрачная настороженность' },
                    stanceBounds: [{ target: 'PLAYER', max: 0 }],
                    redLines: { never: ['выдать мятежников'] },
                    voice: 'Деньги вперёд, курьер.',
                    anchors: ['Сота'],
                },
                agenda: {
                    goals: [{ text: 'увезти Соту из города, пока имперцы её не заметили', priority: 1 }],
                    secrets: ['прячет в погребе оружие мятежников'],
                },
                ties: [
                    {
                        target: 'PLAYER',
                        stance: -2,
                        reasons: ['ты имперский курьер', 'имперцы повесили её мужа'],
                        behaviour: 'берёт монету, сдачи не даёт',
                        intent: 'avoid',
                        changeIf: ['доверие зарабатывается только делами'],
                    },
                    { target: 'Сота', stance: 3, reasons: ['её дочь'], intent: 'protect' },
                ],
                starts: [{ greeting: 0, present: true, doing: 'считает выручку', goal: 'взять плату вперёд' }],
            },
            Сота: {
                english: 'Sota',
                gender: 'female',
                role: 'дочь хозяйки',
                core: {
                    concept: 'дочь хозяйки, мечтает уехать из города',
                    values: { top: ['self-direction', 'stimulation'] },
                    drives: { high: ['curiosity', 'independence'] },
                    want: 'уехать из городка',
                },
                ties: [
                    {
                        target: 'PLAYER',
                        stance: 1,
                        reasons: ['ты пришёл издалека'],
                        behaviour: 'украдкой разглядывает',
                    },
                ],
                starts: [
                    { greeting: 0, present: false },
                    { greeting: 1, present: true, doing: 'вытирает столы' },
                ],
            },
            Брам: {
                english: 'Bram',
                gender: 'male',
                role: 'наёмник',
                core: {
                    concept: 'наёмник, берётся за любую работу',
                    values: { top: ['hedonism', 'achievement'] },
                    drives: { high: ['eating', 'saving'] },
                    want: 'выпить и заработать',
                },
                appetites: [{ kind: 'drink', label: 'брага', baseline: 4, dependence: 2, rule: 'возчики пьют' }],
                ties: [{ target: 'PLAYER', stance: 0, reasons: ['платишь — работает'], want: 2, appetite: 'drink' }],
            },
        },
    };
}

/** Only part of it: Ильва's concept and her stance to PLAYER — the reading of the text fills the rest. */
export function partialTavernIntent(): CardIntentV1 {
    return {
        version: 1,
        characters: {
            Ильва: {
                core: { concept: 'вдова мятежника, держит трактир назло оккупантам' },
                ties: [{ target: 'PLAYER', stance: -1, reasons: ['ты имперский курьер'] }],
            },
        },
    };
}
