// Reader of the current character card and persona: everything the intent reading takes as sources
// (docs/model.md §7). Card fields are read as the card stores them — not the per-chat overrides of scenario or
// examples, not the "prefer character prompt" switches — with only `{{char}}` / `{{user}}` (and the legacy
// `<BOT>` / `<USER>`) replaced by the names, so the text stays deterministic for source hashing. The card's structured
// intent (`data.extensions.dramatis.intent`, src/shared/card-intent.ts) is passed on as stored.
import { CARD_INTENT_EXTENSION, CARD_INTENT_KEY } from '../../shared/card-intent';
import type { CardReader, CardSource, Host, Logger } from '../../shared/contracts';

export interface CardReaderImpl extends CardReader {
    /**
     * Makes sure the current character is fully loaded (ST 1.13+ keeps characters "shallow" — only name and avatar —
     * until they are needed). Call before current() when the card may not have been opened in a chat yet.
     */
    prepare(): Promise<void>;
}

function str(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Replaces the name macros the way ST's baseChatReplace does for card fields. */
export function replaceNames(text: string, char: string, user: string): string {
    if (!text) return '';
    return text
        .replace(/\{\{char\}\}/gi, char)
        .replace(/\{\{user\}\}/gi, user)
        .replace(/<BOT>/g, char)
        .replace(/<USER>/g, user);
}

export function createCardReader(host: Host, log: Logger): CardReaderImpl {
    function character(): { index: number; card: STCharacter } | null {
        const ctx = host.ctx();
        if (ctx.groupId) return null;
        const id = ctx.characterId;
        if (id === undefined || id === null || id === '') return null;
        const index = Number(id);
        const card = Number.isInteger(index) ? ctx.characters?.[index] : undefined;
        return card ? { index, card } : null;
    }

    function tagsOf(card: STCharacter): string[] {
        const ctx = host.ctx();
        const names = [...strings(card.data?.tags), ...strings(card.tags)];
        // ST's own tags (the tag manager) live outside the card: avatar → tag ids.
        const ids = ctx.tagMap?.[card.avatar];
        if (Array.isArray(ids) && Array.isArray(ctx.tags)) {
            for (const id of ids) {
                const tag = ctx.tags.find((item) => item.id === id);
                if (tag?.name) names.push(tag.name);
            }
        }
        const seen = new Set<string>();
        return names
            .map((name) => name.trim())
            .filter((name) => {
                const key = name.toLowerCase();
                if (!name || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }

    return {
        current(): CardSource | null {
            const found = character();
            if (!found) return null;
            const { card } = found;
            const ctx = host.ctx();
            const data = card.data ?? {};
            const name = str(card.name) || str(data.name);
            const personaName = str(ctx.name1);
            const fill = (value: unknown) => replaceNames(str(value).trim(), name, personaName);
            // The structured intent is read as stored: no macros replaced (they stay as the author wrote them).
            const own = data.extensions?.[CARD_INTENT_EXTENSION];
            const intent =
                own && typeof own === 'object' ? (own as Record<string, unknown>)[CARD_INTENT_KEY] : undefined;
            return {
                avatar: card.avatar,
                name,
                description: fill(card.description || data.description),
                personality: fill(card.personality || data.personality),
                scenario: fill(card.scenario || data.scenario),
                firstMes: fill(card.first_mes || data.first_mes),
                alternateGreetings: strings(data.alternate_greetings).map(fill),
                mesExample: fill(card.mes_example || data.mes_example),
                creatorNotes: fill(data.creator_notes || card.creatorcomment),
                systemPrompt: fill(data.system_prompt),
                postHistory: fill(data.post_history_instructions),
                depthPrompt: fill(data.extensions?.depth_prompt?.prompt),
                tags: tagsOf(card),
                persona: {
                    name: personaName,
                    description: replaceNames(
                        str(ctx.powerUserSettings?.persona_description).trim(),
                        name,
                        personaName,
                    ),
                },
                ...(intent === undefined || intent === null ? {} : { intent }),
            };
        },

        greetingIndex(): number {
            const first = host.ctx().chat?.[0];
            if (!first || first.is_user) return 0;
            const swipe = first.swipe_id;
            return typeof swipe === 'number' && Number.isInteger(swipe) && swipe >= 0 ? swipe : 0;
        },

        async prepare(): Promise<void> {
            const found = character();
            if (!found?.card.shallow) return;
            const unshallow = host.ctx().unshallowCharacter;
            if (typeof unshallow !== 'function') return;
            try {
                await unshallow(found.index);
            } catch (error) {
                log.warn('could not load the full character card', error);
            }
        },
    };
}
