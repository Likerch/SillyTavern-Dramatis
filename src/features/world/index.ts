// Module «world» (stage 4, docs/model.md §11–§13): the living world. On every committed turn the leader tab checks
// whether the world is due to move (every N turns by mode, a scene change, a time skip by the DES clock —
// domain/world-ticks.ts) and runs the ticks (domain/world.ts) through the engine: off-screen actions toward fronts and
// intentions, scheme clocks, appetites off-screen, rumours. Every tick is one journal action in Maestro with an undo
// (a snapshot of what it touched). Fronts coming to pass and exposed schemes the player could hear of get a notice;
// the rest goes to the story log. The DRAMATIS_API part feeds Maestro's offscreen writer (offscreenBrief) and its
// director (matureAgendas). Needs Maestro: turn events, the leader tab, the journal and notices come from it.
import { appetiteKindLabel, stanceNoun } from '../../domain/ladders';
import { APPETITE_KINDS } from '../../domain/model';
import type { AppetiteKind, CharacterState, ChatState, Reputation, Rumour, Scheme } from '../../domain/model';
import { normalizeText } from '../../domain/util';
import { appendLog, matureAgendas, offscreenBrief, socialIndex, worldTick } from '../../domain/world';
import type { WorldEvent, WorldTickBrief } from '../../domain/world';
import { ticksDue } from '../../domain/world-ticks';
import { leversFor } from '../../domain/turn-apply';
import type { SceneMark } from '../../domain/scene';
import type { ApiJournalChange, DramatisApiV1, MaestroApiV1 } from '../../shared/apis';
import type { App, DramatisModule, SettingsSection } from '../../shared/contracts';
import { el, field, numberInput, toggle } from '../../ui';
import { ENGINE_API } from '../engine/api';
import type { EngineApi, EngineView } from '../engine/api';
import { TURN_API } from '../turn/api';
import { WORLD_STRINGS } from './strings';

export interface WorldSettings {
    /** Turns between interval ticks; 0 = by mode. */
    interval: number;
    /** Notices for fronts coming to pass and audible exposed schemes. */
    notices: boolean;
}

/** Journal kind and undo target (MAESTRO_API: kinds and targets of Dramatis start with `dramatis.`). */
export const WORLD_JOURNAL_KIND = 'dramatis.world';
export const WORLD_UNDO_TARGET = 'dramatis.world';
export const WORLD_SECTION_ID = 'world';

/** What a tick changed, as it was before: restored by the journal's undo. */
export interface WorldSnapshot {
    characters: Record<string, CharacterState | null>;
    rumours: Rumour[];
    schemes: Scheme[];
    reputation: Reputation[];
}

/** Where the journal entry points: the chat and the committed turn of the tick. */
export interface WorldRef {
    chatId: string | null;
    tick: number;
}

function isSnapshot(value: unknown): value is WorldSnapshot {
    if (!value || typeof value !== 'object') return false;
    const v = value as Partial<WorldSnapshot>;
    return (
        !!v.characters &&
        typeof v.characters === 'object' &&
        Array.isArray(v.rumours) &&
        Array.isArray(v.schemes) &&
        Array.isArray(v.reputation)
    );
}

/** The snapshot of the parts of `before` a tick touched. */
export function snapshotOf(before: ChatState, touched: Iterable<string>): WorldSnapshot {
    const characters: WorldSnapshot['characters'] = {};
    for (const id of touched) characters[id] = structuredClone(before.characters[id] ?? null);
    return {
        characters,
        rumours: structuredClone(before.rumours ?? []),
        schemes: structuredClone(before.schemes ?? []),
        reputation: structuredClone(before.reputation ?? []),
    };
}

/** Undoes a tick: the touched characters, rumours, schemes and reputation as they were, its log lines gone. */
export function restoreSnapshot(state: ChatState, snapshot: WorldSnapshot, tick: number): ChatState {
    const characters = { ...state.characters };
    for (const [id, character] of Object.entries(snapshot.characters)) {
        if (character) characters[id] = structuredClone(character);
        else delete characters[id];
    }
    const next: ChatState = {
        ...state,
        characters,
        rumours: structuredClone(snapshot.rumours),
        schemes: structuredClone(snapshot.schemes),
        reputation: structuredClone(snapshot.reputation),
        log: (state.log ?? []).filter((line) => !(line.turn === tick && line.kind.startsWith('world.'))),
    };
    if (state.world) next.world = { ...state.world, ticks: Math.max(0, state.world.ticks - 1) };
    return next;
}

function markOf(scene: { place?: string; time?: string; date?: string }): SceneMark {
    const mark: SceneMark = {};
    if (scene.place?.trim()) mark.place = scene.place.trim();
    if (scene.time?.trim()) mark.time = scene.time.trim();
    if (scene.date?.trim()) mark.date = scene.date.trim();
    return mark;
}

/** Whether the player could plausibly hear a rumour: it reached the scene's place or someone in the scene. */
export function playerCanHear(state: ChatState, view: EngineView, rumour: Rumour, place?: string): boolean {
    const index = socialIndex(state, view.profiles, { presentIds: view.present, ...(place ? { place } : {}) });
    const around = new Set<string>();
    for (const id of view.present) for (const node of index.nodesOf.get(id) ?? []) around.add(normalizeText(node));
    if (place) around.add(normalizeText(place));
    return rumour.reached.some((group) => around.has(normalizeText(group)));
}

function worldSection(app: App, settings: WorldSettings): SettingsSection {
    const t = app.i18n.t.bind(app.i18n);
    return {
        id: WORLD_SECTION_ID,
        titleKey: 'world.settings.title',
        order: 40,
        render(container: HTMLElement) {
            container.append(
                el('div', { class: 'dramatis-settings-group' }, [
                    field(
                        t('world.settings.interval'),
                        numberInput({
                            value: settings.interval,
                            min: 0,
                            max: 200,
                            label: t('world.settings.interval'),
                            onChange: (value) => {
                                settings.interval = Math.round(value);
                                app.settings.save();
                            },
                        }),
                        t('world.settings.intervalHint'),
                    ),
                    toggle({
                        label: t('world.settings.notices'),
                        hint: t('world.settings.noticesHint'),
                        checked: settings.notices,
                        onChange: (checked) => {
                            settings.notices = checked;
                            app.settings.save();
                        },
                    }),
                ]),
            );
        },
    };
}

export const world: DramatisModule<WorldSettings> = {
    key: 'world',
    stage: 4,
    titleKey: 'world.title',
    enabledByDefault: true,
    needsMaestro: true,
    defaults: () => ({ interval: 0, notices: true }),
    i18n: WORLD_STRINGS,

    init({ app, settings, log, own }) {
        const engine = () => app.modules.api<EngineApi>(ENGINE_API) ?? null;
        const t = app.i18n.t.bind(app.i18n);
        let queue: Promise<void> = Promise.resolve();

        /** A story-log line in the UI language (the English line when no translation fits). */
        function localize(event: WorldEvent): string {
            const lang = app.i18n.locale();
            const params: Record<string, string | number> = { ...event.params };
            if (event.line.startsWith('consequence.')) {
                params.from = stanceNoun(Number(params.from), lang);
                params.to = stanceNoun(Number(params.to), lang);
            }
            if (event.line.startsWith('appetite.') && !params.appetite) {
                const kind = String(params.kind);
                params.appetite = APPETITE_KINDS.includes(kind as AppetiteKind)
                    ? appetiteKindLabel(kind as AppetiteKind, lang)
                    : kind;
            }
            if (event.line === 'attempt.partial') params.complication = t(`world.complication.${params.complication}`);
            const key = `world.log.${event.line}`;
            const text = t(key, params);
            return text === key ? event.text : text;
        }

        async function tick(messageIndex: number): Promise<void> {
            const maestro = app.maestro.api();
            if (!maestro || !maestro.leader.isLeader()) return;
            const api = engine();
            const view = api?.view();
            if (!api || !view) return;

            // The chat's own levers where it overrides them (docs/model.md §14), as the turn pass reads them.
            const general = leversFor(app.settings.get(), view.state.overrides);
            const mark = markOf(app.readers.des.scene());
            const dueFor = (state: ChatState) => {
                const world = state.world;
                const prev = world
                    ? { turn: Math.min(world.lastTick, state.turn), mark: markOf(world) }
                    : { turn: 0, mark };
                return ticksDue(prev, { turn: state.turn, mark }, { mode: general.mode, interval: settings.interval });
            };
            const due = dueFor(view.state);
            if (due.ticks === 0) {
                if (!view.state.world) {
                    await api.updateState((state) => {
                        state.world ??= { lastTick: 0, ticks: 0, ...mark };
                    });
                }
                return;
            }

            let before: ChatState | null = null;
            let briefs: WorldTickBrief[] = [];
            let after: ChatState | null = null;
            const saved = await api.updateState((state, current) => {
                const now = dueFor(state);
                before = null;
                briefs = [];
                if (now.ticks === 0) return;
                before = state;
                const events: WorldEvent[] = [];
                let next = state;
                for (let i = 0; i < now.ticks; i++) {
                    const result = worldTick(next, current.profiles, {
                        rng: app.rng,
                        presentIds: current.present,
                        ...(i === 0 && now.hours !== undefined ? { hours: now.hours } : {}),
                        mode: general.mode,
                        strength: general.appetiteStrength,
                        inertia: general.inertia,
                        ...(mark.place ? { place: mark.place } : {}),
                        playerName: current.playerName,
                    });
                    next = result.state;
                    briefs.push(result.brief);
                    events.push(...result.events);
                }
                next = appendLog(
                    next,
                    events.map((event) => ({ ...event, text: localize(event) })),
                );
                next.world = { lastTick: next.turn, ticks: (state.world?.ticks ?? 0) + now.ticks, ...mark };
                after = next;
                return next;
            });
            const prior = before as ChatState | null;
            const result = after as ChatState | null;
            if (!saved || !prior || !result) return;

            const touched = new Set(briefs.flatMap((brief) => brief.touched));
            const actions = briefs.reduce((sum, brief) => sum + brief.attempts.length, 0);
            const ref: WorldRef = { chatId: app.host.chatId(), tick: result.turn };
            const change: ApiJournalChange = {
                target: WORLD_UNDO_TARGET,
                ref: { ...ref },
                before: snapshotOf(prior, touched),
                after: { lastTick: result.turn, ticks: result.world?.ticks ?? 0 },
            };
            try {
                await maestro.journal.record({
                    kind: WORLD_JOURNAL_KIND,
                    summary: t('world.journal.summary', { actions }),
                    changes: [change],
                    sourceMessage: messageIndex,
                });
            } catch (error) {
                log.warn('world tick could not be journaled', error);
            }
            if (settings.notices) notify(maestro, result, briefs, mark.place);
        }

        function notify(maestro: MaestroApiV1, state: ChatState, briefs: WorldTickBrief[], place?: string): void {
            const view = engine()?.view();
            for (const brief of briefs) {
                for (const doom of brief.dooms) {
                    maestro.notice(t('world.notice.doom', { name: doom.name, doom: doom.doom }), {
                        importance: 'important',
                    });
                }
                if (!view) continue;
                for (const exposed of brief.exposed) {
                    // The story itself or a retelling of it (a distorted fork) may be what reached the player.
                    const heard = state.rumours.find(
                        (r) =>
                            (r.id === exposed.rumour || r.variantOf === exposed.rumour) &&
                            playerCanHear(state, view, r, place),
                    );
                    if (heard) maestro.notice(t('world.notice.rumour', { text: heard.text }), { importance: 'info' });
                }
            }
        }

        const onTurn = (messageIndex: number): Promise<void> => {
            queue = queue.then(() => tick(messageIndex)).catch((error) => log.error('world tick failed', error));
            return queue;
        };
        // The tick reads the committed turn counter the turn module sets: it follows that module's commit
        // (`turn:applied`). Only with the turn module switched off is the user's message itself the cue.
        own(app.bus.on('turn:applied', ({ messageIndex }) => onTurn(messageIndex)));
        own(
            app.bus.on('turn:committed', ({ messageIndex }) =>
                app.modules.api(TURN_API) ? undefined : onTurn(messageIndex),
            ),
        );

        const maestro = app.maestro.api();
        if (maestro) {
            own(
                maestro.journal.registerUndo(WORLD_UNDO_TARGET, async (change) => {
                    const ref = change.ref as Partial<WorldRef>;
                    if (ref.chatId !== app.host.chatId() || typeof ref.tick !== 'number') return false;
                    const api = engine();
                    const view = api?.view();
                    if (!api || !view || !isSnapshot(change.before)) return false;
                    // Only the latest tick can be undone: a later one built on it.
                    if (view.state.world?.lastTick !== ref.tick) return false;
                    const snapshot = change.before;
                    const tick = ref.tick;
                    return api.updateState((state) => restoreSnapshot(state, snapshot, tick));
                }),
            );
        }

        own(app.ui.addSettingsSection(worldSection(app, settings)));

        const part: Partial<DramatisApiV1> = {
            offscreenBrief(name: string): string | null {
                const api = engine();
                const view = api?.view();
                if (!api || !view) return null;
                const id = api.resolve(name);
                const profile = id ? view.byId.get(id) : undefined;
                if (!profile) return null;
                return offscreenBrief(view.state, profile, { profiles: view.profiles, playerName: view.playerName });
            },
            matureAgendas(): { text: string; weight: number }[] {
                const view = engine()?.view();
                if (!view) return [];
                return matureAgendas(view.state, view.profiles, { playerName: view.playerName });
            },
        };
        app.modules.expose('api', part);
    },
};
