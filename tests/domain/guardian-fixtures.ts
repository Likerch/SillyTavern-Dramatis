// A synthetic card in the shape of the case that broke the reading (docs/guide/sheet.md «из карточки, без цитаты»):
// an ancient sorceress who adopted the player's character as a baby — motherly to him, cold to everyone else,
// merciless when he is threatened, ready to burn the world for him and resigned to his leaving her one day. No
// scenario, no personality field, one greeting; the card reader already put the names in place of {{char}} / {{user}}
// (persona «Kai»). And a weak model's reading of it: rich fields, few quotes, paths written every which way.
import type { CardSource } from '../../src/shared/contracts';
import { agendaAnswer, answer, appetiteAnswer, characterAnswer, coreAnswer, ev, tieAnswer } from './intent-fixtures';

type Dict = Record<string, unknown>;

export const GUARDIAN_CARD: CardSource = {
    avatar: 'guardian.png',
    name: 'Mirelle Varrow',
    description:
        'Mirelle Varrow is an elven sorceress older than the oldest kingdoms. For centuries she razed cities and bargained with dead gods for power, and she regrets only that the hunger left her alone. She adopted Kai when he was a baby and has mellowed since: with Kai she is gentle and motherly, teaching him magic and letting nothing of her past touch him. To everyone else she is cold and dangerous. Whenever Kai is threatened she becomes her old self again, utterly merciless, caring only about his safety, and she would burn the world for him. She has accepted that Kai may one day leave her, or hate her once he learns what she did, and she loves him all the same.',
    personality: '',
    scenario: '',
    firstMes:
        'Morning light fills the cottage at the edge of the marsh. Mirelle sets warm bread on the table and smiles. "Wake up, little one — today you learn your first ward."',
    alternateGreetings: [],
    mesExample: '',
    creatorNotes: 'Your adoptive elven mother: tender with you, terrifying to the rest of the world.',
    systemPrompt: '',
    postHistory: '',
    depthPrompt: '',
    tags: ['fantasy', 'mother'],
    persona: { name: 'Kai', description: '' },
};

/** S1 description, S2 greeting 0, S3 creator's notes, S4 tags, S5 persona. */
export function guardianAnswer(patch: Dict = {}): Dict {
    return answer({
        characters: [
            characterAnswer('Mirelle Varrow', {
                english: '',
                aliases: [],
                russian: ['Мирель Варроу', 'Мирель'],
                gender: 'female',
                role: 'adoptive mother',
                species: 'elf',
                core: coreAnswer({
                    concept: 'An ancient sorceress who gave up her hunger for power to raise the child she adopted',
                    values: ['benevolence', 'security', 'power'],
                    drivesHigh: ['family', 'power'],
                    drivesLow: ['status'],
                    want: 'Wants Kai to grow up safe, far from her past',
                    need: 'To be loved by Kai for who she is now',
                    signatures: ['if Kai is threatened → turns utterly merciless and destroys the threat'],
                    redLinesNever: ['never lets harm come to Kai'],
                    redLinesWould: ['kills anyone who threatens Kai'],
                    bounds: [{ target: 'PLAYER', min: 3, max: null }],
                    anchors: ['PLAYER'],
                    mood: { octant: 'relaxed', label: 'calm and motherly' },
                    voice: 'Wake up, little one — today you learn your first ward.',
                }),
                agenda: agendaAnswer({
                    goals: [
                        {
                            text: 'Wants to teach Kai magic because he must be able to protect himself, but fears what it reveals of her',
                            kind: 'external',
                            priority: 1,
                        },
                    ],
                    secrets: ['Hides her past of razing cities from Kai'],
                }),
                ties: [
                    tieAnswer('PLAYER', 3, {
                        reasons: ['adopted Kai as a baby and raised him as her own', 'would burn the world for him'],
                        behaviour: 'gentle and motherly with Kai; merciless to anyone who threatens him',
                        intent: 'protect',
                        changeIf: ['accepts that Kai may leave or hate her one day, and loves him anyway'],
                    }),
                    tieAnswer('everyone else', -2, {
                        reasons: ['cares for nobody but Kai'],
                        behaviour: 'cold and dangerous to anyone else',
                    }),
                ],
                starts: [
                    { greeting: 0, present: true, doing: 'setting bread on the table', goal: 'wake Kai for a lesson' },
                ],
                evidence: [
                    // A field path with the tie's sub-field, two fields behind one quote, an index into the ties.
                    ev('ties.PLAYER.stance', 'she would burn the world for him', 'S1'),
                    ev(
                        'core.values, core.drives',
                        'For centuries she razed cities and bargained with dead gods for power',
                        'S1',
                    ),
                    ev('ties[1]', 'To everyone else she is cold and dangerous', 'S1'),
                    ev('core.redLinesWould', 'utterly merciless, caring only about his safety', 'S1'),
                    ev('starts.0', 'Mirelle sets warm bread on the table and smiles', 'S2'),
                ],
            }),
        ],
        ...patch,
    });
}

/** The same reading with the appetites a weak model made up: one craving twice, under two kinds. */
export function guardianWithTwins(): Dict {
    const base = guardianAnswer() as { characters: Dict[] };
    const mirelle = {
        ...base.characters[0]!,
        appetites: [
            appetiteAnswer('thrill', { label: 'teaching caution', baseline: 3 }),
            appetiteAnswer('other', { label: 'Teaching caution', baseline: 3 }),
            appetiteAnswer('thrill', { label: 'danger', baseline: 2 }),
        ],
    };
    return { ...base, characters: [mirelle] };
}
