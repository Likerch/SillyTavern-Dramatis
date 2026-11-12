// Module «agents» (1.8.0, Maestro 1.34 MAESTRO_API.agents / context; Maestro's docs/integration-agents.md): Dramatis'
// six model jobs are shown in Maestro's «Агенты» window as built-in agents — the user sees each instruction, adds
// «Дополнительные указания» or rewrites it, changes the model's parameters and sees the run log. The jobs still go
// through MAESTRO_API.llm.request with their task ids, so Maestro puts the user's changes into them; their logic stays
// here. Their switches are Dramatis' own module switches. Also:
// - the source «Каст Dramatis» for the user's agents: the motive card of those present (what they want, how they stand);
// - the receiver `dramatis.profile`: an agent may ask to fill a character's empty fields or to raise the level of a
//   character — through the generator's own API (only the empty fields, never the author's or the user's).
// Without Maestro 1.34 (no `agents` member) the module stays idle.
import { directorSystemPrompt, DIRECTOR_TASK } from '../../domain/director';
import {
    GENERATE_TASK,
    GENERATOR_SYSTEM_PROMPT,
    GROUNDED_SYSTEM_PROMPT,
    NEW_FACE_SYSTEM_PROMPT,
    REGROUND_SYSTEM_PROMPT,
    REGROUND_TASK,
} from '../../domain/generator-prompt';
import { DOSSIER_SYSTEM_PROMPT, INTENT_SYSTEM_PROMPT, INTENT_TASK } from '../../domain/intent-prompt';
import type { Lod } from '../../domain/model';
import { TRANSLATE_SYSTEM_PROMPT, TRANSLATE_TASK } from '../../domain/translate';
import { TURN_SYSTEM_PROMPT, TURN_TASK } from '../../domain/turn-prompt';
import type { ApiAgents, ApiContext, ApiLabel } from '../../shared/apis';
import type { App, DramatisModule, ModuleContext, Unsubscribe } from '../../shared/contracts';
import { castCardText } from '../cast';
import { ENGINE_API } from '../engine/api';
import type { EngineApi } from '../engine/api';
import { GENERATOR_API } from '../generator/api';
import type { GeneratorApi } from '../generator/api';
import { AGENTS_STRINGS } from './strings';

export const PROFILE_KIND = 'dramatis.profile';
export const CAST_SOURCE = 'dramatis.cast';

export interface AgentsSettings {
    version: 1;
}

/** One of Dramatis' jobs as Maestro shows it. */
interface JobSpec {
    id: string;
    /** The Dramatis module whose switch it is. */
    module: string;
    icon: string;
    title: ApiLabel;
    when: ApiLabel;
    description: ApiLabel;
    sources: ApiLabel;
    instructions: () => string[];
    defaults: { maxTokens: number; temperature: number };
    interactive?: boolean;
}

export const JOBS: readonly JobSpec[] = [
    {
        id: TURN_TASK,
        module: 'turn',
        icon: 'fa-masks-theater',
        title: { ru: 'Dramatis: такт', en: 'Dramatis: turn pass' },
        when: { ru: 'после каждого принятого ответа', en: 'after every committed reply' },
        description: {
            ru: 'Читает ответ: кто чего хотел, что вышло, как сдвинулись отношения, чьи намерения продвинулись. Состояние персонажей ведёт Dramatis.',
            en: 'Reads the reply: who wanted what, what came of it, how relations moved, whose intentions advanced. Dramatis keeps the characters’ state.',
        },
        sources: {
            ru: 'ответ, профили и состояние присутствующих',
            en: 'the reply, profiles and state of those present',
        },
        instructions: () => [TURN_SYSTEM_PROMPT],
        defaults: { maxTokens: 1800, temperature: 0.2 },
    },
    {
        id: DIRECTOR_TASK,
        module: 'director',
        icon: 'fa-clapperboard',
        title: { ru: 'Dramatis: режиссёр такта', en: 'Dramatis: beat director' },
        when: { ru: 'при отправке, в режиме «Кино»', en: 'on send, in the «Cinema» mode' },
        description: {
            ru: 'Перед ответом называет до трёх присутствующих, кому в этом такте стоит действовать, и как. Ждёт не дольше 3,5 с.',
            en: 'Before the reply names up to three present characters who should act in this beat, and how. Waits 3.5 s at most.',
        },
        sources: { ru: 'последние сообщения, каст', en: 'the last messages, the cast' },
        instructions: () => [directorSystemPrompt('ru'), directorSystemPrompt('en')],
        defaults: { maxTokens: 400, temperature: 0.3 },
    },
    {
        id: INTENT_TASK,
        module: 'intent',
        icon: 'fa-feather',
        title: { ru: 'Dramatis: замысел автора', en: 'Dramatis: author’s intent' },
        when: { ru: 'при новой карточке и по кнопке', en: 'for a new card and by a button' },
        description: {
            ru: 'Читает карточку и лор: кто есть кто, ценности, тон мира, правила — и досье персонажей.',
            en: 'Reads the card and the lore: who is who, values, the world’s tone, rules — and the characters’ dossiers.',
        },
        sources: { ru: 'карточка, лор', en: 'the card, the lore' },
        instructions: () => [INTENT_SYSTEM_PROMPT, DOSSIER_SYSTEM_PROMPT],
        defaults: { maxTokens: 4000, temperature: 0.2 },
    },
    {
        id: GENERATE_TASK,
        module: 'generator',
        icon: 'fa-user-gear',
        title: { ru: 'Dramatis: генератор личностей', en: 'Dramatis: personality generator' },
        when: {
            ru: 'когда лицо заслужило черновик или портрет; заполнение пробелов',
            en: 'when a face earned a draft or a portrait; filling gaps',
        },
        description: {
            ru: 'Пишет личность новому лицу по сюжету и миру, заполняет пустые поля авторских персонажей.',
            en: 'Writes a personality for a new face from the story and the world, fills empty fields of authored characters.',
        },
        sources: { ru: 'мир, правила, что показал сюжет', en: 'the world, its rules, what the story showed' },
        instructions: () => [GENERATOR_SYSTEM_PROMPT, NEW_FACE_SYSTEM_PROMPT, GROUNDED_SYSTEM_PROMPT],
        defaults: { maxTokens: 2500, temperature: 0.7 },
    },
    {
        id: REGROUND_TASK,
        module: 'generator',
        icon: 'fa-rotate',
        title: { ru: 'Dramatis: пересборка по истории', en: 'Dramatis: rebuild on the story' },
        when: {
            ru: 'фоном после ответа, по кнопке «Пересобрать»',
            en: 'in the background after a reply, by «Rebuild»',
        },
        description: {
            ru: 'Пересобирает лица, вытянутые раньше кубиками, по сюжету и миру; уровень и правки пользователя остаются.',
            en: 'Rebuilds faces an older build drew from dice on the story and the world; their level and the user’s edits stay.',
        },
        sources: { ru: 'мир, сюжет, факты о лицах', en: 'the world, the story, facts about the faces' },
        instructions: () => [REGROUND_SYSTEM_PROMPT],
        defaults: { maxTokens: 3000, temperature: 0.5 },
    },
    {
        id: TRANSLATE_TASK,
        module: 'translate',
        icon: 'fa-language',
        title: { ru: 'Dramatis: перевод описаний', en: 'Dramatis: description translation' },
        when: { ru: 'когда описание показывается на русском', en: 'when a description is shown in Russian' },
        description: {
            ru: 'Переводит английские описания листа персонажа на русский для окон (в промпт не идёт).',
            en: 'Translates the English descriptions of the character sheet into Russian for the windows (not for the prompt).',
        },
        sources: { ru: 'английские описания', en: 'the English descriptions' },
        instructions: () => [TRANSLATE_SYSTEM_PROMPT],
        defaults: { maxTokens: 2000, temperature: 0.2 },
    },
];

const LODS: readonly Lod[] = ['sketch', 'draft', 'portrait'];

function moduleOn(app: App, key: string): boolean {
    return app.modules.list().find((item) => item.module.key === key)?.enabled === true;
}

/** Registers the jobs, the cast source and the profile receiver; their removers. */
export function registerWithMaestro(app: App, agents: ApiAgents, context: ApiContext | undefined): Unsubscribe[] {
    const offs: Unsubscribe[] = [];
    for (const job of JOBS) {
        offs.push(
            agents.registerBuiltIn({
                id: job.id,
                title: job.title,
                when: job.when,
                description: job.description,
                sources: job.sources,
                icon: job.icon,
                defaultInstructions: job.instructions,
                defaults: job.defaults,
                enabled: () => moduleOn(app, job.module),
                setEnabled: (on) => (on ? app.modules.enable(job.module) : app.modules.disable(job.module)),
            }),
        );
    }
    if (context && typeof context.register === 'function') {
        offs.push(
            context.register({
                id: CAST_SOURCE,
                title: 'Cast: what those present want and how they stand (Dramatis)',
                label: { ru: 'Каст Dramatis', en: 'Dramatis cast' },
                budget: 1500,
                available: () => app.modules.api<EngineApi>(ENGINE_API)?.view() != null,
                render: ({ budget }) => {
                    const view = app.modules.api<EngineApi>(ENGINE_API)?.view() ?? null;
                    return castCardText(app, view).slice(0, budget);
                },
            }),
        );
    }
    const generator = () => app.modules.api<GeneratorApi>(GENERATOR_API);
    const apply = async (raw: unknown): Promise<void> => {
        const payload = raw as { id: string; name: string; action: 'fill' | 'promote'; level?: Lod };
        const api = generator();
        if (!api) throw new Error(app.i18n.t('agents.profile.noGenerator'));
        const outcome =
            payload.action === 'promote' && payload.level
                ? await api.promote(payload.id, payload.level)
                : await api.fillGaps(payload.id);
        if (!outcome.ok)
            throw new Error(app.i18n.t('agents.profile.failed', { name: payload.name, error: outcome.error ?? '' }));
    };
    offs.push(
        agents.registerReceiver({
            kind: PROFILE_KIND,
            label: { ru: 'Профиль персонажа (Dramatis)', en: 'Character profile (Dramatis)' },
            describe:
                'work on a character profile of Dramatis: name — exactly as the story calls them; action "fill" fills their empty fields (never the author\'s or the user\'s), or "promote" raises them to level "draft" or "portrait" (more fields). Only characters who matter in the story now; Dramatis writes the fields from the story itself.',
            schema: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    action: { type: 'string', enum: ['fill', 'promote'] },
                    level: { type: 'string', enum: ['draft', 'portrait'] },
                },
                required: ['name', 'action'],
            },
            defaultAutonomy: 'inbox',
            available: () => generator() !== undefined,
            toProposal: (data) => {
                const engine = app.modules.api<EngineApi>(ENGINE_API);
                const name = typeof data.name === 'string' ? data.name.trim() : '';
                const id = name ? engine?.resolve(name) : null;
                if (!id) return null;
                const action = data.action === 'promote' ? 'promote' : 'fill';
                const level = LODS.includes(data.level as Lod) ? (data.level as Lod) : undefined;
                if (action === 'promote' && !level) return null;
                const shown = engine?.view()?.byId.get(id)?.name ?? name;
                return {
                    title:
                        action === 'promote'
                            ? app.i18n.t('agents.profile.promote', {
                                  name: shown,
                                  level: app.i18n.t(`agents.lod.${level}`),
                              })
                            : app.i18n.t('agents.profile.fill', { name: shown }),
                    payload: { id, name: shown, action, ...(level ? { level } : {}) },
                };
            },
            apply,
        }),
    );
    return offs;
}

export const agentsModule: DramatisModule<AgentsSettings> = {
    key: 'agents',
    stage: 18,
    titleKey: 'agents.title',
    enabledByDefault: true,
    needsMaestro: true,
    defaults: () => ({ version: 1 }),
    i18n: AGENTS_STRINGS,
    init(ctx: ModuleContext<AgentsSettings>) {
        const api = ctx.app.maestro.api();
        const agents = api?.agents;
        if (!agents || typeof agents.registerBuiltIn !== 'function') {
            ctx.log.info('Maestro has no agents API (before 1.34): the jobs are not shown there');
            return;
        }
        try {
            for (const off of registerWithMaestro(ctx.app, agents, api.context)) ctx.own(off);
        } catch (error) {
            ctx.log.warn('agents were not registered with Maestro', error);
        }
    },
};
