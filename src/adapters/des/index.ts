// Reader of Doom's Enhancement Suite (DES 2.6): who is in the scene, their relationship label, thoughts and detail
// fields, the place and time, and the chat's roster. Read-only: nothing here writes DES data.
// The tracker sits on each assistant message per swipe (parse.ts); the roster in chat metadata
// (`chat_metadata.dooms_tracker.knownCharacters`, DES forces per-chat roster tracking).
import type { DesCharacter, DesReader, Host, Logger } from '../../shared/contracts';
import { desSwipeRecord, isDict, parseDesCharacters, parseDesScene } from './parse';
import type { ParsedDesCharacter, ParsedDesScene } from './parse';

export const DES_KEYS = {
    chatMetadata: 'dooms_tracker',
    swipeData: 'dooms_tracker_swipes',
} as const;

/** How many assistant messages back lastCast() and scene() look for a tracker. */
export const DES_LOOKBACK = 10;

/** DES's drawer toggle in the Extensions panel: present once DES has loaded. */
const DES_DRAWER_SELECTOR = '#rpg-extension-enabled';
const DES_FOLDER_RE = /dooms[-_ ]?enhancement[-_ ]?suite/i;

function toCharacter(parsed: ParsedDesCharacter): DesCharacter {
    const character: DesCharacter = { name: parsed.name, present: !parsed.offScene, details: { ...parsed.details } };
    if (parsed.relationship) character.relationship = parsed.relationship;
    if (parsed.thoughts) character.thoughts = parsed.thoughts;
    return character;
}

export function createDesReader(host: Host, log: Logger): DesReader {
    function chat(): STChatMessage[] {
        const list = host.ctx().chat;
        return Array.isArray(list) ? list : [];
    }

    /** Indexes of the last assistant messages, newest first. */
    function recentAssistant(limit = DES_LOOKBACK): number[] {
        const messages = chat();
        const found: number[] = [];
        for (let i = messages.length - 1; i >= 0 && found.length < limit; i--) {
            const message = messages[i];
            if (message && !message.is_user && !message.is_system) found.push(i);
        }
        return found;
    }

    function charactersAt(index: number): ParsedDesCharacter[] | null {
        const record = desSwipeRecord(chat()[index]);
        return record ? parseDesCharacters(record.characterThoughts) : null;
    }

    function disabledInSt(): boolean {
        const disabled = host.ctx().extensionSettings?.disabledExtensions;
        return Array.isArray(disabled) && disabled.some((name) => typeof name === 'string' && DES_FOLDER_RE.test(name));
    }

    function onPage(): boolean {
        if (typeof document === 'undefined') return false;
        try {
            if (document.querySelector(DES_DRAWER_SELECTOR)) return true;
            for (const script of document.querySelectorAll('script[type="module"][src]')) {
                if (DES_FOLDER_RE.test(decodeURIComponent(script.getAttribute('src') ?? ''))) return true;
            }
        } catch (error) {
            log.debug('DES page probe failed', error);
        }
        return false;
    }

    return {
        available(): boolean {
            if (disabledInSt()) return false;
            return onPage() || isDict(host.ctx().chatMetadata?.[DES_KEYS.chatMetadata]);
        },

        castAt(messageIndex: number): DesCharacter[] {
            try {
                return (charactersAt(messageIndex) ?? []).map(toCharacter);
            } catch (error) {
                log.debug(`DES tracker of message ${messageIndex} could not be read`, error);
                return [];
            }
        },

        lastCast(): DesCharacter[] {
            for (const index of recentAssistant()) {
                const characters = charactersAt(index);
                if (characters) return characters.map(toCharacter);
            }
            return [];
        },

        scene(): { place?: string; time?: string; date?: string } {
            for (const index of recentAssistant()) {
                const record = desSwipeRecord(chat()[index]);
                const parsed: ParsedDesScene | null = record ? parseDesScene(record.infoBox) : null;
                if (!parsed) continue;
                const scene: { place?: string; time?: string; date?: string } = {};
                if (parsed.location) scene.place = parsed.location;
                // The scene's time now is where the reply ended.
                const time = parsed.time?.end ?? parsed.time?.start;
                if (time) scene.time = time;
                if (parsed.date) scene.date = parsed.date;
                return scene;
            }
            return {};
        },

        roster(): string[] {
            const state = host.ctx().chatMetadata?.[DES_KEYS.chatMetadata];
            const known = isDict(state) ? state.knownCharacters : undefined;
            return isDict(known) ? Object.keys(known) : [];
        },
    };
}
