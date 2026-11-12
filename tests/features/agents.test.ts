// 1.8.0 «agents»: the six jobs as Maestro's built-in agents (ids = task ids, the system prompts their requests carry,
// Dramatis' module switches), the cast as a source, the profile receiver through the generator's API.
import { describe, expect, it, vi } from 'vitest';
import { JOBS, PROFILE_KIND, registerWithMaestro } from '../../src/features/agents';
import { DIRECTOR_TASK } from '../../src/domain/director';
import { GENERATE_TASK, REGROUND_TASK, regroundMessages } from '../../src/domain/generator-prompt';
import { INTENT_TASK } from '../../src/domain/intent-prompt';
import { TRANSLATE_TASK } from '../../src/domain/translate';
import { TURN_TASK } from '../../src/domain/turn-prompt';
import type { ApiBuiltInSpec, ApiContextSource, ApiProposalReceiver } from '../../src/shared/apis';
import type { App } from '../../src/shared/contracts';

function fakeApp(enabled: Record<string, boolean>) {
    const generator = {
        fillGaps: vi.fn(async () => ({ ok: true, written: ['core.values'] })),
        promote: vi.fn(async () => ({ ok: true, written: ['core.fears'] })),
    };
    const engine = {
        resolve: (name: string) => (name.toLowerCase() === 'кай' ? 'kai' : null),
        view: () => ({ byId: new Map([['kai', { name: 'Кай' }]]) }),
    };
    const app = {
        modules: {
            list: () => Object.entries(enabled).map(([key, on]) => ({ module: { key }, enabled: on, running: on })),
            enable: vi.fn(async () => {}),
            disable: vi.fn(async () => {}),
            api: (key: string) => (key === 'generator' ? generator : key === 'engine' ? engine : undefined),
        },
        i18n: { t: (key: string, params?: Record<string, string>) => `${key}${params?.name ? `:${params.name}` : ''}` },
    } as unknown as App;
    return { app, generator };
}

describe('agents in Maestro', () => {
    it('registers the six jobs with their task ids, prompts and switches; the cast; the profile receiver', async () => {
        const { app, generator } = fakeApp({
            turn: true,
            director: false,
            intent: true,
            generator: true,
            translate: true,
        });
        const specs: ApiBuiltInSpec[] = [];
        const sources: ApiContextSource[] = [];
        const receivers: ApiProposalReceiver[] = [];
        const offs = registerWithMaestro(
            app,
            {
                registerBuiltIn: (spec) => (specs.push(spec), () => {}),
                registerReceiver: (receiver) => (receivers.push(receiver), () => {}),
            },
            { register: (source) => (sources.push(source), () => {}) },
        );
        expect(offs).toHaveLength(8);
        expect(specs.map((spec) => spec.id)).toEqual([
            TURN_TASK,
            DIRECTOR_TASK,
            INTENT_TASK,
            GENERATE_TASK,
            REGROUND_TASK,
            TRANSLATE_TASK,
        ]);
        for (const spec of specs) {
            const texts =
                typeof spec.defaultInstructions === 'function' ? spec.defaultInstructions() : spec.defaultInstructions;
            expect(texts.length, spec.id).toBeGreaterThan(0);
            expect(
                texts.every((text) => text.length > 50),
                spec.id,
            ).toBe(true);
        }
        // The rebuild's prompt is the very text its request carries.
        const reground = JOBS.find((job) => job.id === REGROUND_TASK)!;
        const messages = regroundMessages([], {} as never);
        expect(messages[0]!.content).toBe(reground.instructions()[0]);
        expect(specs[1]!.enabled!()).toBe(false);
        await specs[1]!.setEnabled!(true);
        expect(app.modules.enable).toHaveBeenCalledWith('director');
        expect(sources.map((source) => source.id)).toEqual(['dramatis.cast']);

        const receiver = receivers[0]!;
        expect(receiver.kind).toBe(PROFILE_KIND);
        expect(await receiver.toProposal({ name: 'Нина', action: 'fill' }, { agentName: 'A' })).toBeNull();
        expect(await receiver.toProposal({ name: 'Кай', action: 'promote' }, { agentName: 'A' })).toBeNull();
        const fill = (await receiver.toProposal({ name: 'кай', action: 'fill' }, { agentName: 'A' }))!;
        expect(fill.title).toBe('agents.profile.fill:Кай');
        await receiver.apply(fill.payload);
        expect(generator.fillGaps).toHaveBeenCalledWith('kai');
        const promote = (await receiver.toProposal(
            { name: 'Кай', action: 'promote', level: 'portrait' },
            { agentName: 'A' },
        ))!;
        await receiver.apply(promote.payload);
        expect(generator.promote).toHaveBeenCalledWith('kai', 'portrait');
    });
});
