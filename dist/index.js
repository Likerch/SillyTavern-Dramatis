//#region package.json
var version = "0.0.1";
//#endregion
//#region src/adapters/card/index.ts
function str(value) {
	return typeof value === "string" ? value : "";
}
function strings(value) {
	return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
/** Replaces the name macros the way ST's baseChatReplace does for card fields. */
function replaceNames(text, char, user) {
	if (!text) return "";
	return text.replace(/\{\{char\}\}/gi, char).replace(/\{\{user\}\}/gi, user).replace(/<BOT>/g, char).replace(/<USER>/g, user);
}
function createCardReader(host, log) {
	function character() {
		const ctx = host.ctx();
		if (ctx.groupId) return null;
		const id = ctx.characterId;
		if (id === void 0 || id === null || id === "") return null;
		const index = Number(id);
		const card = Number.isInteger(index) ? ctx.characters?.[index] : void 0;
		return card ? {
			index,
			card
		} : null;
	}
	function tagsOf(card) {
		const ctx = host.ctx();
		const names = [...strings(card.data?.tags), ...strings(card.tags)];
		const ids = ctx.tagMap?.[card.avatar];
		if (Array.isArray(ids) && Array.isArray(ctx.tags)) for (const id of ids) {
			const tag = ctx.tags.find((item) => item.id === id);
			if (tag?.name) names.push(tag.name);
		}
		const seen = /* @__PURE__ */ new Set();
		return names.map((name) => name.trim()).filter((name) => {
			const key = name.toLowerCase();
			if (!name || seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}
	return {
		current() {
			const found = character();
			if (!found) return null;
			const { card } = found;
			const ctx = host.ctx();
			const data = card.data ?? {};
			const name = str(card.name) || str(data.name);
			const personaName = str(ctx.name1);
			const fill = (value) => replaceNames(str(value).trim(), name, personaName);
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
					description: replaceNames(str(ctx.powerUserSettings?.persona_description).trim(), name, personaName)
				}
			};
		},
		greetingIndex() {
			const first = host.ctx().chat?.[0];
			if (!first || first.is_user) return 0;
			const swipe = first.swipe_id;
			return typeof swipe === "number" && Number.isInteger(swipe) && swipe >= 0 ? swipe : 0;
		},
		async prepare() {
			const found = character();
			if (!found?.card.shallow) return;
			const unshallow = host.ctx().unshallowCharacter;
			if (typeof unshallow !== "function") return;
			try {
				await unshallow(found.index);
			} catch (error) {
				log.warn("could not load the full character card", error);
			}
		}
	};
}
//#endregion
//#region src/adapters/des/parse.ts
/** DES's English off-scene detector (portraitBar.js getCharacterList); it also matches DES-RU's `(off-scene)`. */
var OFF_SCENE_RE = /\b(not\s+(currently\s+)?(in|at|present\s+in|present\s+at)\s+(the\s+)?(scene|area|room|location|vicinity))\b|\b(off[\s-]?scene)\b|\b(not\s+physically\s+present)\b|\b(absent\s+from\s+(the\s+)?(scene|room|area|location))\b|\b(away\s+from\s+(the\s+)?scene)\b/i;
var FENCE_RE = /^```[a-z]*\s*\n?([\s\S]*?)\n?```$/i;
function isDict$4(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Trims and drops brackets that wrap the whole value (`[Friend]`), as DES's renderers do. */
function clean(value) {
	let result = value.trim();
	while (result.length >= 2 && result.startsWith("[") && result.endsWith("]")) result = result.slice(1, -1).trim();
	return result;
}
/** Text of a scalar or of `{value}` / `{text}` / `{description}`; arrays joined with ", ". Empty → undefined. */
function textOf(value) {
	if (typeof value === "string") return clean(value) || void 0;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) {
		const parts = value.map(textOf).filter((part) => !!part);
		return parts.length ? parts.join(", ") : void 0;
	}
	if (isDict$4(value)) for (const key of [
		"value",
		"text",
		"description",
		"content",
		"title"
	]) {
		const inner = textOf(value[key]);
		if (inner) return inner;
	}
}
/**
* Parses one tracker section. Strings are JSON (optionally inside a ``` fence); already-parsed values pass through;
* anything unparseable gives null (DES's legacy text formats are not read).
*/
function parseTrackerJson(raw) {
	if (raw === void 0 || raw === null) return null;
	if (typeof raw !== "string") return raw;
	let source = raw.trim();
	if (!source) return null;
	const fenced = FENCE_RE.exec(source);
	if (fenced?.[1] !== void 0) source = fenced[1].trim();
	try {
		return JSON.parse(source);
	} catch {
		return null;
	}
}
function detailsOf(raw) {
	const details = {};
	if (!isDict$4(raw)) return details;
	for (const [key, value] of Object.entries(raw)) {
		const text = textOf(value);
		if (key && text) details[key] = text;
	}
	return details;
}
function relationshipOf(entry) {
	if (typeof entry.Relationship === "string") return clean(entry.Relationship) || void 0;
	const relationship = entry.relationship;
	if (isDict$4(relationship)) return textOf(relationship.status) ?? textOf(relationship);
	return textOf(relationship);
}
function thoughtsOf(entry) {
	const thoughts = entry.thoughts;
	if (isDict$4(thoughts)) return textOf(thoughts.content) ?? textOf(thoughts);
	return textOf(thoughts);
}
function characterOf(raw) {
	if (!isDict$4(raw) || typeof raw.name !== "string" || !raw.name.trim()) return null;
	const thoughts = thoughtsOf(raw);
	const character = {
		name: raw.name.trim(),
		details: detailsOf(raw.details),
		offScene: raw.present === false || thoughts !== void 0 && OFF_SCENE_RE.test(thoughts)
	};
	const relationship = relationshipOf(raw);
	if (relationship) character.relationship = relationship;
	if (thoughts) character.thoughts = thoughts;
	return character;
}
/**
* Characters from `characterThoughts`: an array (DES 2.6 parse) or `{characters: [...]}` (legacy, defaults).
* Null when the section is missing or not JSON (as opposed to [] = the tracker lists nobody).
*/
function parseDesCharacters(raw) {
	const data = parseTrackerJson(raw);
	if (data === null) return null;
	const list = Array.isArray(data) ? data : isDict$4(data) && Array.isArray(data.characters) ? data.characters : null;
	if (list === null) return null;
	const characters = [];
	for (const item of list) {
		const character = characterOf(item);
		if (character) characters.push(character);
	}
	return characters;
}
function timeOf(raw) {
	if (isDict$4(raw)) {
		const start = textOf(raw.start) ?? textOf(raw.value);
		const end = textOf(raw.end);
		if (!start && !end) return void 0;
		const time = {};
		if (start) time.start = start;
		if (end) time.end = end;
		return time;
	}
	const flat = textOf(raw);
	return flat ? { start: flat } : void 0;
}
/** Place, date and time from `infoBox`; null when the section is missing or not a JSON object. */
function parseDesScene(raw) {
	const data = parseTrackerJson(raw);
	if (!isDict$4(data)) return null;
	const scene = {};
	const location = textOf(data.location);
	if (location) scene.location = location;
	const date = textOf(data.date);
	if (date) scene.date = date;
	const time = timeOf(data.time);
	if (time) scene.time = time;
	return scene;
}
function swipeRecordOf(swipes, swipeId) {
	const record = Array.isArray(swipes) ? swipes[swipeId] : isDict$4(swipes) ? swipes[String(swipeId)] : void 0;
	if (!isDict$4(record)) return null;
	const { quests = null, infoBox = null, characterThoughts = null } = record;
	if (quests === null && infoBox === null && characterThoughts === null) return null;
	return {
		quests,
		infoBox,
		characterThoughts
	};
}
/**
* The raw tracker record of a chat message for its current swipe: `extra.dooms_tracker_swipes[swipe_id]`, with
* `swipe_info[swipe_id].extra.dooms_tracker_swipes[swipe_id]` as the fallback DES itself uses (persistence.js,
* injector.js). Null for user messages and messages without tracker data.
*/
function desSwipeRecord(message) {
	if (!isDict$4(message) || message.is_user === true) return null;
	const swipeId = typeof message.swipe_id === "number" && message.swipe_id >= 0 ? message.swipe_id : 0;
	const direct = swipeRecordOf((isDict$4(message.extra) ? message.extra : void 0)?.dooms_tracker_swipes, swipeId);
	if (direct) return direct;
	const info = Array.isArray(message.swipe_info) ? message.swipe_info[swipeId] : void 0;
	return swipeRecordOf((isDict$4(info) && isDict$4(info.extra) ? info.extra : void 0)?.dooms_tracker_swipes, swipeId);
}
//#endregion
//#region src/adapters/des/index.ts
var DES_KEYS = {
	chatMetadata: "dooms_tracker",
	swipeData: "dooms_tracker_swipes"
};
/** DES's drawer toggle in the Extensions panel: present once DES has loaded. */
var DES_DRAWER_SELECTOR = "#rpg-extension-enabled";
var DES_FOLDER_RE = /dooms[-_ ]?enhancement[-_ ]?suite/i;
function toCharacter(parsed) {
	const character = {
		name: parsed.name,
		present: !parsed.offScene,
		details: { ...parsed.details }
	};
	if (parsed.relationship) character.relationship = parsed.relationship;
	if (parsed.thoughts) character.thoughts = parsed.thoughts;
	return character;
}
function createDesReader(host, log) {
	function chat() {
		const list = host.ctx().chat;
		return Array.isArray(list) ? list : [];
	}
	/** Indexes of the last assistant messages, newest first. */
	function recentAssistant(limit = 10) {
		const messages = chat();
		const found = [];
		for (let i = messages.length - 1; i >= 0 && found.length < limit; i--) {
			const message = messages[i];
			if (message && !message.is_user && !message.is_system) found.push(i);
		}
		return found;
	}
	function charactersAt(index) {
		const record = desSwipeRecord(chat()[index]);
		return record ? parseDesCharacters(record.characterThoughts) : null;
	}
	function disabledInSt() {
		const disabled = host.ctx().extensionSettings?.disabledExtensions;
		return Array.isArray(disabled) && disabled.some((name) => typeof name === "string" && DES_FOLDER_RE.test(name));
	}
	function onPage() {
		if (typeof document === "undefined") return false;
		try {
			if (document.querySelector(DES_DRAWER_SELECTOR)) return true;
			for (const script of document.querySelectorAll("script[type=\"module\"][src]")) if (DES_FOLDER_RE.test(decodeURIComponent(script.getAttribute("src") ?? ""))) return true;
		} catch (error) {
			log.debug("DES page probe failed", error);
		}
		return false;
	}
	return {
		available() {
			if (disabledInSt()) return false;
			return onPage() || isDict$4(host.ctx().chatMetadata?.[DES_KEYS.chatMetadata]);
		},
		castAt(messageIndex) {
			try {
				return (charactersAt(messageIndex) ?? []).map(toCharacter);
			} catch (error) {
				log.debug(`DES tracker of message ${messageIndex} could not be read`, error);
				return [];
			}
		},
		lastCast() {
			for (const index of recentAssistant()) {
				const characters = charactersAt(index);
				if (characters) return characters.map(toCharacter);
			}
			return [];
		},
		scene() {
			for (const index of recentAssistant()) {
				const record = desSwipeRecord(chat()[index]);
				const parsed = record ? parseDesScene(record.infoBox) : null;
				if (!parsed) continue;
				const scene = {};
				if (parsed.location) scene.place = parsed.location;
				const time = parsed.time?.end ?? parsed.time?.start;
				if (time) scene.time = time;
				if (parsed.date) scene.date = parsed.date;
				return scene;
			}
			return {};
		},
		roster() {
			const state = host.ctx().chatMetadata?.[DES_KEYS.chatMetadata];
			const known = isDict$4(state) ? state.knownCharacters : void 0;
			return isDict$4(known) ? Object.keys(known) : [];
		}
	};
}
//#endregion
//#region src/adapters/lore/archive.ts
/** Sheet commands of the BunnyMo core lorebook. */
var SHEET_COMMANDS = [
	"!fullsheet",
	"!quicksheet",
	"!tagsheet",
	"!memsheet",
	"!updatesheet",
	"!physheet"
];
/** Comment prefixes of core entries; titles are stable between BunnyMo versions, uids are not. */
var CORE_COMMENT_RE = /Master - |AUTO-TRIGGER:|AUTO-FILTRATION:|ANTI[\s-]*CLANKER|HawThorne Link/i;
var TAG_BLOCK_RE = /<bunnymotags>([\s\S]*?)<\/bunnymotags>/i;
var TAG_RE = /<([A-Za-z][A-Za-z0-9_-]*):([^<>\n]+)>/g;
/** Bare MBTI archetype without a colon: `<ESFP-H>`, `<INTJ-U>`. */
var MBTI_BARE_RE = /<([EI][NS][FT][JP])-([UH])>/i;
/** An MBTI tag value: `ENTJ`, `ENTJ-U`. */
var MBTI_VALUE_RE = /^([EI][NS][FT][JP])(?:-([UH]))?$/i;
/** A titled prose section (`<Linguistics>…</Linguistics>`); structural wrappers are not prose. */
var SECTION_RE = /<([A-Za-z][A-Za-z_]*)>([\s\S]*?)<\/\1\s*>/gi;
var STRUCTURAL = /* @__PURE__ */ new Set([
	"bunnymotags",
	"physical",
	"personality",
	"nsfw",
	"health"
]);
var LINGUISTICS_RE = /<linguistics>([\s\S]*?)<\/linguistics\s*>/i;
/** Template placeholders in place of a tag value or name: `<Name:NAME>`, `<GENRE:BLANK>`, `<Dere:NEW>`. */
var PLACEHOLDER_RE = /^(?:BLANK|NEW|VALUE|TARGET|NAME|NAME[\s_]HERE|PLACEHOLDER|TBD|X{3,})$/i;
var REGEX_KEY_RE = /^\/[\s\S]+\/[gimsuy]*$/;
function text(value) {
	return value === void 0 || value === null ? "" : String(value);
}
/** Primary and secondary keys of an entry, trimmed, without empty ones. */
function entryKeys(entry) {
	const list = (value) => Array.isArray(value) ? value : [];
	return [...list(entry?.key), ...list(entry?.keysecondary)].map((key) => text(key).trim()).filter(Boolean);
}
/** An entry of the BunnyMo core lorebook (by a sheet command in its keys or a known entry title). */
function isBunnyMoCoreEntry(entry) {
	if (entryKeys(entry).some((key) => SHEET_COMMANDS.includes(key.toLowerCase()))) return true;
	return CORE_COMMENT_RE.test(text(entry?.comment));
}
/** The block's text with titled prose sections cut out (their tags are prose, not the character's tags). */
function blockTagArea(block) {
	return block.replace(SECTION_RE, (whole, title) => STRUCTURAL.has(title.toLowerCase()) ? whole : " ");
}
/** `<Name:…>` and the `<KEY:VALUE>` tags of the first block (keys upper case, placeholders skipped). */
function blockTags(content) {
	const block = TAG_BLOCK_RE.exec(content);
	if (!block?.[1]) return {
		name: null,
		tags: [],
		area: ""
	};
	const area = blockTagArea(block[1]);
	let name = null;
	const tags = [];
	const seen = /* @__PURE__ */ new Set();
	for (const match of area.matchAll(TAG_RE)) {
		const key = (match[1] ?? "").trim().toUpperCase();
		const value = (match[2] ?? "").trim();
		if (key === "NAME") {
			name ??= value;
			continue;
		}
		if (!value || PLACEHOLDER_RE.test(value)) continue;
		const id = `${key}:${value.toUpperCase()}`;
		if (seen.has(id)) continue;
		seen.add(id);
		tags.push({
			key,
			value
		});
	}
	return {
		name,
		tags,
		area
	};
}
/**
* A character archive: an entry with a `<BunnymoTags>` block holding a real name or tags. Not archives: sheet
* templates of the core (`<Name:NAME>`, `<…:BLANK>`) and any block whose name is a placeholder.
*/
function isCharacterArchive(entry) {
	const content = text(entry?.content);
	if (!TAG_BLOCK_RE.test(content) || isBunnyMoCoreEntry(entry)) return false;
	const { name, tags, area } = blockTags(content);
	if (name !== null) return !PLACEHOLDER_RE.test(name);
	return tags.length > 0 || MBTI_BARE_RE.test(area);
}
/** Reads an archive entry; null when it is not a character archive. */
function parseArchive(entry, book) {
	if (!isCharacterArchive(entry)) return null;
	const content = text(entry.content);
	const { name, tags, area } = blockTags(content);
	const fallbackName = text(entry.comment).trim() || entryKeys(entry)[0] || "";
	const sheet = {
		name: name && !PLACEHOLDER_RE.test(name) ? name : fallbackName,
		book,
		uid: Number.isFinite(Number(entry.uid)) ? Number(entry.uid) : -1,
		tags: tags.filter((tag) => tag.key !== "MBTI")
	};
	const bare = MBTI_BARE_RE.exec(area);
	const tagged = tags.find((tag) => tag.key === "MBTI");
	const value = bare ? `${bare[1]}-${bare[2]}` : tagged?.value;
	const mbti = value ? MBTI_VALUE_RE.exec(value.trim()) : null;
	if (mbti?.[1]) {
		const variant = mbti[2]?.toUpperCase();
		sheet.mbti = { type: mbti[1].toUpperCase() };
		if (variant === "H" || variant === "U") sheet.mbti.variant = variant;
	}
	const linguistics = LINGUISTICS_RE.exec(content)?.[1]?.trim();
	if (linguistics) sheet.linguistics = linguistics;
	return sheet;
}
/** Lower case, ё → е, single spaces: how names are compared. */
function normalizeName(value) {
	return value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}
/** Names an archive answers to: its `<Name:…>` and the entry's plain (non-regex) keys. */
function archiveNames(entry, sheet) {
	const names = [sheet.name, ...entryKeys(entry).filter((key) => !REGEX_KEY_RE.test(key))];
	return [...new Set(names.map(normalizeName).filter(Boolean))];
}
//#endregion
//#region src/adapters/lore/index.ts
var CK_SETTINGS_KEY = "CarrotKernel";
function isDict$3(value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function stringList(value) {
	return Array.isArray(value) ? value.filter((item) => typeof item === "string" && !!item) : [];
}
function createLoreReader(host, log) {
	const books = /* @__PURE__ */ new Map();
	const unsubscribers = [];
	async function loadBook(name) {
		let load = host.ctx().loadWorldInfo;
		if (typeof load !== "function") try {
			const module = await host.modules.worldInfo();
			if (typeof module.loadWorldInfo === "function") load = module.loadWorldInfo;
		} catch (error) {
			log.debug("world-info.js is not available", error);
		}
		if (typeof load !== "function") return null;
		try {
			const data = await load(name);
			return isDict$3(data) && isDict$3(data.entries) ? data.entries : null;
		} catch (error) {
			log.debug(`lorebook ${name} did not load`, error);
			return null;
		}
	}
	function archivesOf(book) {
		let cached = books.get(book);
		if (!cached) {
			cached = loadBook(book).then((entries) => {
				const found = [];
				for (const raw of Object.values(entries ?? {})) {
					if (!isDict$3(raw) || raw.disable === true) continue;
					const entry = raw;
					const sheet = parseArchive(entry, book);
					if (sheet) found.push({
						sheet,
						names: archiveNames(entry, sheet)
					});
				}
				return found;
			});
			cached.catch(() => books.delete(book));
			books.set(book, cached);
		}
		return cached;
	}
	function repoBooks() {
		const settings = host.ctx().extensionSettings?.[CK_SETTINGS_KEY];
		return isDict$3(settings) ? stringList(settings.characterRepoBooks) : [];
	}
	return {
		repoBooks,
		async archives(names) {
			const wanted = new Set(names.map(normalizeName).filter(Boolean));
			if (wanted.size === 0) return [];
			const result = [];
			for (const book of repoBooks()) for (const archive of await archivesOf(book)) if (archive.names.some((name) => wanted.has(name))) result.push(structuredClone(archive.sheet));
			return result;
		},
		async cardBook() {
			const ctx = host.ctx();
			if (ctx.groupId) return [];
			const character = ctx.characterId === void 0 ? void 0 : ctx.characters?.[Number(ctx.characterId)];
			if (!character) return [];
			const world = character.data?.extensions?.world;
			if (typeof world === "string" && world) {
				const entries = await loadBook(world);
				if (entries) {
					const list = [];
					for (const raw of Object.values(entries)) {
						if (!isDict$3(raw) || raw.disable === true) continue;
						list.push({
							uid: Number.isFinite(Number(raw.uid)) ? Number(raw.uid) : -1,
							keys: [...stringList(raw.key), ...stringList(raw.keysecondary)],
							comment: typeof raw.comment === "string" ? raw.comment : "",
							content: typeof raw.content === "string" ? raw.content : ""
						});
					}
					return list.sort((a, b) => a.uid - b.uid);
				}
			}
			const embedded = character.data?.character_book?.entries;
			if (!Array.isArray(embedded)) return [];
			return embedded.filter((entry) => isDict$3(entry) && entry.enabled !== false).map((entry, index) => ({
				uid: Number.isFinite(Number(entry.id)) ? Number(entry.id) : index,
				keys: [...stringList(entry.keys), ...stringList(entry.secondary_keys)],
				comment: typeof entry.comment === "string" && entry.comment ? entry.comment : typeof entry.name === "string" ? entry.name : "",
				content: typeof entry.content === "string" ? entry.content : ""
			}));
		},
		install() {
			if (unsubscribers.length) return;
			const updated = host.events.name("WORLDINFO_UPDATED");
			if (updated) unsubscribers.push(host.events.on(updated, (name) => {
				if (typeof name === "string") books.delete(name);
			}));
		},
		dispose() {
			for (const off of unsubscribers.splice(0)) off();
			books.clear();
		}
	};
}
//#endregion
//#region src/shared/apis.ts
var MAESTRO_API_GLOBAL = "MAESTRO_API";
var MAESTRO_API_READY_EVENT = "maestro-api-ready";
var DRAMATIS_API_GLOBAL = "DRAMATIS_API";
var DRAMATIS_API_READY_EVENT = "dramatis-api-ready";
//#endregion
//#region src/adapters/maestro/index.ts
/** A usable MAESTRO_API v1: the version and the members Dramatis calls unconditionally. */
function isMaestroApi(value) {
	if (!value || typeof value !== "object") return false;
	const api = value;
	return api.version === 1 && !!api.llm && typeof api.llm.request === "function" && typeof api.llm.available === "function" && typeof api.onTurn === "function";
}
function createMaestroBridge(host, bus, log) {
	let present = false;
	let warned = false;
	const unsubscribers = [];
	function lookup() {
		const value = globalThis[MAESTRO_API_GLOBAL];
		if (value === void 0 || value === null) return null;
		if (isMaestroApi(value)) return value;
		if (!warned) {
			warned = true;
			const version = value.version;
			log.warn(`MAESTRO_API version ${String(version)} is not supported; working without Maestro`);
		}
		return null;
	}
	function note(api) {
		const now = api !== null;
		if (now === present) return;
		present = now;
		log.info(now ? `Maestro ${api?.maestroVersion ?? "?"} connected` : "Maestro is gone");
		queueMicrotask(() => void bus.emit("maestro:changed", { present: now }));
	}
	const onReady = () => {
		note(lookup());
	};
	return {
		api() {
			const api = lookup();
			note(api);
			return api;
		},
		present() {
			const api = lookup();
			note(api);
			return api !== null;
		},
		check() {
			const api = lookup();
			note(api);
			return api !== null;
		},
		install() {
			if (unsubscribers.length) return;
			if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
				window.addEventListener(MAESTRO_API_READY_EVENT, onReady);
				unsubscribers.push(() => window.removeEventListener(MAESTRO_API_READY_EVENT, onReady));
			}
			for (const key of ["APP_READY", "CHAT_CHANGED"]) {
				const name = host.events.name(key);
				if (name) unsubscribers.push(host.events.on(name, onReady));
			}
			onReady();
		},
		dispose() {
			for (const off of unsubscribers.splice(0)) off();
		}
	};
}
//#endregion
//#region src/adapters/index.ts
function createReaders(host, log) {
	const des = createDesReader(host, log.scope("des"));
	const lore = createLoreReader(host, log.scope("lore"));
	return {
		des,
		lore,
		card: createCardReader(host, log.scope("card")),
		install: () => lore.install(),
		dispose: () => lore.dispose()
	};
}
//#endregion
//#region src/core/bus.ts
/** Dramatis' internal event bus. Handlers run in registration order; one failing handler does not stop others. */
var EventBus = class {
	log;
	handlers = /* @__PURE__ */ new Map();
	constructor(log) {
		this.log = log;
	}
	on(event, handler) {
		let set = this.handlers.get(event);
		if (!set) {
			set = /* @__PURE__ */ new Set();
			this.handlers.set(event, set);
		}
		set.add(handler);
		return () => {
			set.delete(handler);
		};
	}
	async emit(event, payload) {
		const set = this.handlers.get(event);
		if (!set) return;
		for (const handler of [...set]) try {
			await handler(payload);
		} catch (error) {
			this.log.error(`bus handler for ${String(event)} failed`, error);
		}
	}
	/** Drops every handler (app stop). */
	clear() {
		this.handlers.clear();
	}
};
function createBus(log) {
	return new EventBus(log);
}
//#endregion
//#region src/core/ephemeral.ts
function injectionKey(key) {
	return key.startsWith("dramatis_") ? key : `dramatis_${key}`;
}
function createEphemeral(deps) {
	const { host, log } = deps;
	const producers = /* @__PURE__ */ new Map();
	const injections = /* @__PURE__ */ new Map();
	const clearAll = () => {
		if (injections.size === 0) return;
		const ctx = host.ctx();
		for (const [key, spec] of injections) try {
			ctx.setExtensionPrompt(injectionKey(key), "", spec.position, spec.depth ?? 0, false, spec.role ?? 0);
		} catch (error) {
			log.warn(`could not clear injection ${key}`, error);
		}
		injections.clear();
	};
	return {
		setInjection(key, spec) {
			host.ctx().setExtensionPrompt(injectionKey(key), spec.text, spec.position, spec.depth ?? 0, spec.scan ?? false, spec.role ?? 0);
			injections.set(key, { ...spec });
		},
		addProducer(name, producer) {
			if (producers.has(name)) log.warn(`ephemeral producer ${name} replaced`);
			producers.set(name, producer);
			return () => {
				if (producers.get(name) === producer) producers.delete(name);
			};
		},
		isSet(key) {
			const spec = injections.get(key);
			return spec !== void 0 && spec.text.length > 0;
		},
		clearAll,
		async run(info) {
			clearAll();
			if (info.dryRun) return;
			for (const [name, producer] of [...producers]) try {
				await producer(info);
			} catch (error) {
				log.error(`ephemeral producer ${name} failed`, error);
			}
		}
	};
}
//#endregion
//#region src/core/hash.ts
/** Calls `visit` with every UTF-8 byte of `text` without allocating a buffer. Lone surrogates become U+FFFD. */
function forEachUtf8Byte(text, visit) {
	for (let i = 0; i < text.length; i++) {
		let code = text.charCodeAt(i);
		if (code >= 55296 && code <= 56319) {
			const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
			if (next >= 56320 && next <= 57343) {
				code = 65536 + (code - 55296 << 10) + (next - 56320);
				i++;
			} else code = 65533;
		} else if (code >= 56320 && code <= 57343) code = 65533;
		if (code < 128) visit(code);
		else if (code < 2048) {
			visit(192 | code >> 6);
			visit(128 | code & 63);
		} else if (code < 65536) {
			visit(224 | code >> 12);
			visit(128 | code >> 6 & 63);
			visit(128 | code & 63);
		} else {
			visit(240 | code >> 18);
			visit(128 | code >> 12 & 63);
			visit(128 | code >> 6 & 63);
			visit(128 | code & 63);
		}
	}
}
/** 53-bit hash (cyrb53 by bryc, public domain) over UTF-8 bytes. */
function hash53(text, seed = 0) {
	let h1 = 3735928559 ^ seed;
	let h2 = 1103547991 ^ seed;
	forEachUtf8Byte(text, (byte) => {
		h1 = Math.imul(h1 ^ byte, 2654435761);
		h2 = Math.imul(h2 ^ byte, 1597334677);
	});
	h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507);
	h1 ^= Math.imul(h2 ^ h2 >>> 13, 3266489909);
	h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507);
	h2 ^= Math.imul(h1 ^ h1 >>> 13, 3266489909);
	return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
/** Short stable id for any string: the 53-bit hash in base 36 (1–11 chars of [0-9a-z]). */
function stableHash(text) {
	return hash53(text).toString(36);
}
//#endregion
//#region src/core/files.ts
var FILE_PREFIX = "dramatis-";
var NAME_RE = /^[A-Za-z0-9_.-]+$/;
var MAX_NAME_LENGTH = 200;
var CACHE_LIMIT = 32;
var CACHE_MAX_TEXT = 524288;
var FileStoreError = class extends Error {
	status;
	constructor(message, status) {
		super(message);
		this.status = status;
		this.name = "FileStoreError";
	}
};
var tabIdValue = null;
/** Random id of this browser tab (page load), written into file envelopes. */
function currentTabId() {
	if (!tabIdValue) {
		const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID().replace(/-/g, "").slice(0, 12) : Math.random().toString(36).slice(2, 14);
		tabIdValue = `t${Date.now().toString(36)}${random}`;
	}
	return tabIdValue;
}
/** Throws unless the name is a valid ST user file name with the Dramatis prefix. */
function assertFileName(name) {
	if (!name.startsWith("dramatis-")) throw new FileStoreError(`file name must start with ${FILE_PREFIX}: ${name}`);
	if (!NAME_RE.test(name) || name.length > MAX_NAME_LENGTH || name.includes("..")) throw new FileStoreError(`invalid file name: ${name}`);
}
/** `dramatis-<kind>[-<hash(key)>].json`; characters outside [A-Za-z0-9_-] in the kind become `_`. */
function makeFileName(kind, key) {
	return `${FILE_PREFIX}${(kind.startsWith("dramatis-") ? kind.slice(9) : kind).replace(/[^A-Za-z0-9_-]/g, "_") || "file"}${key === void 0 ? "" : `-${stableHash(key)}`}.json`;
}
/** Base64 of the UTF-8 bytes of a string (btoa alone only accepts Latin-1). */
function utf8ToBase64(text) {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	const chunk = 32768;
	for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	return btoa(binary);
}
/** Reads a file around any cache (works with any FileStore; DramatisFileStore skips its cache). */
function readFresh(files, name) {
	return typeof files.invalidate === "function" ? files.read(name, { fresh: true }) : files.read(name);
}
function createFileStore(host, log) {
	const cache = /* @__PURE__ */ new Map();
	const chains = /* @__PURE__ */ new Map();
	const remember = (name, text) => {
		cache.delete(name);
		if (text !== null && text.length > CACHE_MAX_TEXT) return;
		cache.set(name, text);
		while (cache.size > CACHE_LIMIT) {
			const oldest = cache.keys().next().value;
			if (oldest === void 0) break;
			cache.delete(oldest);
		}
	};
	const parse = (name, text) => {
		if (text === null) return null;
		try {
			return JSON.parse(text);
		} catch (error) {
			log.warn(`file ${name} is not valid JSON; treating it as absent`, error);
			return null;
		}
	};
	const serial = (name, job) => {
		const next = (chains.get(name) ?? Promise.resolve()).then(job, job);
		const settled = next.catch(() => void 0);
		chains.set(name, settled);
		settled.then(() => {
			if (chains.get(name) === settled) chains.delete(name);
		});
		return next;
	};
	const headers = () => host.ctx().getRequestHeaders();
	return {
		async read(name, options) {
			assertFileName(name);
			if (!options?.fresh && cache.has(name)) return parse(name, cache.get(name) ?? null);
			await chains.get(name);
			const response = await fetch(`/user/files/${encodeURIComponent(name)}`, {
				method: "GET",
				headers: headers(),
				cache: "no-store"
			});
			if (response.status === 404) {
				remember(name, null);
				return null;
			}
			if (!response.ok) throw new FileStoreError(`read ${name} failed: HTTP ${response.status}`, response.status);
			const text = await response.text();
			remember(name, text);
			return parse(name, text);
		},
		async write(name, data) {
			assertFileName(name);
			const text = JSON.stringify(data);
			if (text === void 0) throw new FileStoreError(`cannot serialise data for ${name}`);
			return serial(name, async () => {
				const response = await fetch("/api/files/upload", {
					method: "POST",
					headers: headers(),
					body: JSON.stringify({
						name,
						data: utf8ToBase64(text)
					})
				});
				if (!response.ok) {
					cache.delete(name);
					throw new FileStoreError(`write ${name} failed: HTTP ${response.status}`, response.status);
				}
				remember(name, text);
				log.debug(`wrote ${name} (${text.length} chars)`);
			});
		},
		async remove(name) {
			assertFileName(name);
			return serial(name, async () => {
				const response = await fetch("/api/files/delete", {
					method: "POST",
					headers: headers(),
					body: JSON.stringify({ path: `/user/files/${name}` })
				});
				if (!response.ok && response.status !== 404) {
					cache.delete(name);
					throw new FileStoreError(`delete ${name} failed: HTTP ${response.status}`, response.status);
				}
				remember(name, null);
			});
		},
		fileName(kind, key) {
			return makeFileName(kind, key);
		},
		invalidate(name) {
			if (name === void 0) cache.clear();
			else cache.delete(name);
		}
	};
}
//#endregion
//#region src/core/i18n.ts
/**
* Both dictionaries are bundled: modules register their parts at load time, so the manifest needs no i18n files and
* there is no merge step. The language follows the setting, then ST's locale.
*/
var Translations = class {
	resolveLocale;
	en = {};
	ru = {};
	constructor(resolveLocale) {
		this.resolveLocale = resolveLocale;
	}
	register(parts) {
		Object.assign(this.en, parts.en);
		Object.assign(this.ru, parts.ru);
	}
	locale() {
		return this.resolveLocale();
	}
	t(key, params) {
		const text = (this.locale() === "ru" ? this.ru[key] : this.en[key]) ?? this.en[key] ?? key;
		if (!params) return text;
		return text.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
	}
	has(key) {
		return Object.hasOwn(this.en, key);
	}
	/** Keys present in English but missing in Russian (used by tests). */
	missingRussian() {
		return Object.keys(this.en).filter((key) => !Object.hasOwn(this.ru, key));
	}
};
/** ST stores the UI language in localStorage 'language' (e.g. 'ru-ru'); getCurrentLocale() exists in 1.19. */
function hostLocale(getLocale) {
	let value;
	try {
		value = getLocale?.() ?? globalThis.localStorage?.getItem("language") ?? void 0;
	} catch {
		value = void 0;
	}
	return value?.toLowerCase().startsWith("ru") ? "ru" : "en";
}
function createI18n(resolveLocale) {
	return new Translations(resolveLocale);
}
//#endregion
//#region src/core/llm.ts
var DEFAULT_BACKOFF_MS = [1e3, 3e3];
function createLlmRouter(deps) {
	const { host, settings, bridge, log } = deps;
	const backoff = deps.backoffMs ?? DEFAULT_BACKOFF_MS;
	function connectionManager() {
		const context = host.ctx();
		const service = context.ConnectionManagerRequestService;
		if (!service || typeof service.sendRequest !== "function") return void 0;
		const disabled = context.extensionSettings?.disabledExtensions;
		if (Array.isArray(disabled) && disabled.includes("connection-manager")) return void 0;
		return service;
	}
	function profiles() {
		const manager = host.ctx().extensionSettings?.connectionManager;
		return Array.isArray(manager?.profiles) ? manager.profiles : [];
	}
	/** The profile of the own client: the one chosen in the settings, else the active Connection Manager profile. */
	function ownProfile() {
		const chosen = settings.get().profile;
		const manager = host.ctx().extensionSettings?.connectionManager;
		const active = typeof manager?.selectedProfile === "string" ? manager.selectedProfile : "";
		const id = chosen || active;
		if (!id) return null;
		const list = profiles();
		return list.length === 0 || list.some((profile) => profile?.id === id) ? id : null;
	}
	function profileApi(profileId) {
		const api = profiles().find((profile) => profile?.id === profileId)?.api;
		return typeof api === "string" ? api : void 0;
	}
	async function sendOnce(service, profileId, request, useSchema) {
		try {
			return {
				kind: "ok",
				raw: await service.sendRequest(profileId, buildMessages(request, useSchema), maxTokensFor(request), {
					stream: false,
					signal: request.signal,
					extractData: false,
					includePreset: false,
					includeInstruct: true
				}, buildOverride(request, useSchema, profileApi(profileId)))
			};
		} catch (error) {
			if (request.signal?.aborted || isAbortError(error)) return { kind: "aborted" };
			return {
				kind: "error",
				error
			};
		}
	}
	async function sendWithRetries(service, profileId, request, useSchema) {
		for (let attempt = 0;; attempt++) {
			if (request.signal?.aborted) return { kind: "aborted" };
			const outcome = await sendOnce(service, profileId, request, useSchema);
			if (outcome.kind !== "error") return outcome;
			const delay = backoff[attempt];
			if (delay === void 0 || !retryable(outcome.error, useSchema)) return outcome;
			log.debug(`request ${request.task} failed, retry ${attempt + 1}`, errorText(outcome.error));
			if (!await sleep(delay, request.signal)) return { kind: "aborted" };
		}
	}
	async function viaOwnClient(request) {
		const service = connectionManager();
		if (!service) return {
			ok: false,
			error: "no-cm"
		};
		const profileId = ownProfile();
		if (!profileId) return {
			ok: false,
			error: "no-profile"
		};
		let useSchema = Boolean(request.schema);
		let costUsd;
		for (let pass = 0; pass < 2; pass++) {
			const sent = await sendWithRetries(service, profileId, request, useSchema);
			if (sent.kind === "aborted") return {
				ok: false,
				error: "aborted"
			};
			if (sent.kind === "error") {
				if (useSchema && pass === 0 && schemaRejected(sent.error)) {
					log.debug(`profile ${profileId} rejected json_schema; asking with instructions only`);
					useSchema = false;
					continue;
				}
				log.warn(`request ${request.task} failed`, errorText(sent.error));
				return {
					ok: false,
					error: `transport: ${errorText(sent.error)}`
				};
			}
			const cost = usageCost(sent.raw);
			if (cost !== void 0) costUsd = (costUsd ?? 0) + cost;
			const reply = extractReply(sent.raw);
			const text = stripThinking(reply.text).trim();
			const withCost = (result) => costUsd === void 0 ? result : {
				...result,
				costUsd
			};
			if (request.schema) {
				const value = parseJsonText(text);
				if (value !== void 0 && matchesSchema(value, request.schema.schema)) return withCost({
					ok: true,
					data: value,
					text
				});
				if (reply.refusal || looksLikeRefusal(text)) return withCost({
					ok: false,
					refusal: true,
					error: "refusal",
					text
				});
				if (pass === 0) {
					log.debug(`request ${request.task}: unparsable JSON, retrying without json_schema`);
					useSchema = false;
					continue;
				}
				return withCost({
					ok: false,
					error: "parse",
					text
				});
			}
			if (reply.refusal || looksLikeRefusal(text)) return withCost({
				ok: false,
				refusal: true,
				error: "refusal",
				text
			});
			if (!text) return withCost({
				ok: false,
				error: "empty"
			});
			return withCost({
				ok: true,
				text,
				data: text
			});
		}
		return {
			ok: false,
			error: "parse"
		};
	}
	return {
		async request(request) {
			const api = bridge.api();
			if (api) {
				const wire = dropUndefined({
					task: request.task,
					messages: request.messages.map((message) => ({
						role: message.role,
						content: message.content
					})),
					maxTokens: request.maxTokens,
					temperature: request.temperature,
					schema: request.schema,
					background: request.background,
					signal: request.signal
				});
				try {
					const result = await api.llm.request(wire);
					return dropUndefined({
						ok: result.ok === true,
						data: result.data,
						text: result.text,
						refusal: result.refusal,
						error: result.error,
						costUsd: result.costUsd
					});
				} catch (error) {
					log.warn(`Maestro request ${request.task} failed`, error);
					return {
						ok: false,
						error: `maestro: ${errorText(error)}`
					};
				}
			}
			if (request.background) return {
				ok: false,
				error: "needs-maestro"
			};
			return viaOwnClient(request);
		},
		available(task, background) {
			const api = bridge.api();
			if (api) try {
				return api.llm.available(task);
			} catch (error) {
				log.debug("Maestro llm.available failed", error);
				return false;
			}
			return !background && connectionManager() !== void 0 && ownProfile() !== null;
		},
		viaMaestro() {
			return bridge.api() !== null;
		}
	};
}
var SCHEMA_INSTRUCTION = "Reply with exactly one JSON value and nothing else: no prose, no markdown code fences. It must match this JSON schema:\n";
function buildMessages(request, useSchema) {
	const messages = request.messages.map((message) => ({
		role: message.role,
		content: message.content
	}));
	if (request.schema && !useSchema) messages.push({
		role: "system",
		content: SCHEMA_INSTRUCTION + JSON.stringify(request.schema.schema)
	});
	return messages;
}
/** OpenRouter takes the effort as given ('none'); other APIs keep their own default. */
function reasoningOverride(api) {
	return api === "openrouter" ? "none" : void 0;
}
function maxTokensFor(request) {
	return request.schema ? Math.max(request.maxTokens, 200) : request.maxTokens;
}
function buildOverride(request, useSchema, api) {
	return dropUndefined({
		temperature: request.temperature,
		reasoning_effort: reasoningOverride(api),
		json_schema: useSchema && request.schema ? {
			name: request.schema.name,
			strict: true,
			value: request.schema.schema
		} : void 0
	});
}
/** Reads the raw response of ChatCompletionService / TextCompletionService (extractData: false). */
function extractReply(raw) {
	const reply = {
		text: "",
		refusal: false
	};
	if (typeof raw === "string") {
		reply.text = raw;
		return reply;
	}
	if (!isRecord(raw)) return reply;
	const choices = raw["choices"];
	const choice = Array.isArray(choices) && isRecord(choices[0]) ? choices[0] : void 0;
	if (choice) {
		const message = isRecord(choice["message"]) ? choice["message"] : void 0;
		if (message) {
			reply.text = contentText(message["content"]);
			if (typeof message["refusal"] === "string" && message["refusal"].trim()) {
				reply.refusal = true;
				if (!reply.text) reply.text = message["refusal"];
			}
		}
		if (!reply.text && typeof choice["text"] === "string") reply.text = choice["text"];
		if (choice["finish_reason"] === "content_filter") reply.refusal = true;
		return reply;
	}
	if (Array.isArray(raw["content"])) {
		reply.text = contentText(raw["content"]);
		if (raw["stop_reason"] === "refusal") reply.refusal = true;
		return reply;
	}
	const message = isRecord(raw["message"]) ? raw["message"] : void 0;
	if (message) {
		reply.text = contentText(message["content"]);
		return reply;
	}
	const candidates = raw["candidates"];
	const candidate = Array.isArray(candidates) && isRecord(candidates[0]) ? candidates[0] : void 0;
	const content = candidate && isRecord(candidate["content"]) ? candidate["content"] : void 0;
	if (content) reply.text = contentText(content["parts"]);
	if (typeof raw["text"] === "string" && !reply.text) reply.text = raw["text"];
	if (typeof raw["content"] === "string" && !reply.text) reply.text = raw["content"];
	return reply;
}
function contentText(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.filter(isRecord).filter((part) => typeof part["text"] === "string" && (part["type"] === void 0 || part["type"] === "text")).map((part) => String(part["text"])).join("");
}
/** OpenRouter reports the price of a request in `usage.cost` (USD). */
function usageCost(raw) {
	const cost = (isRecord(raw) && isRecord(raw["usage"]) ? raw["usage"] : void 0)?.["cost"];
	return typeof cost === "number" && Number.isFinite(cost) ? cost : void 0;
}
/** Removes reasoning blocks; text before a lone closing tag is reasoning too. */
function stripThinking(text) {
	let out = text.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, "");
	const close = out.search(/<\/(think|thinking|reasoning)>/i);
	if (close >= 0) out = out.slice(out.indexOf(">", close) + 1);
	return out;
}
/** Parses a JSON value from model text: no fences, no reasoning, the outermost {…} (or […]). */
function parseJsonText(text) {
	const cleaned = stripThinking(text).replace(/```[a-zA-Z]*\s*/g, "").replace(/```/g, "").trim();
	if (!cleaned) return void 0;
	const attempts = [
		cleaned,
		outermost(cleaned, "{", "}"),
		outermost(cleaned, "[", "]")
	];
	for (const attempt of attempts) {
		if (!attempt) continue;
		try {
			return JSON.parse(attempt);
		} catch {}
	}
}
function outermost(text, open, close) {
	const start = text.indexOf(open);
	const end = text.lastIndexOf(close);
	return start >= 0 && end > start ? text.slice(start, end + 1) : void 0;
}
/**
* A light JSON-schema check (type, enum, required, properties, items): enough to reject a wrong shape before a
* feature applies it. Unknown keywords are ignored.
*/
function matchesSchema(value, schema, depth = 0) {
	if (!isRecord(schema) || depth > 32) return true;
	const enumValues = schema["enum"];
	if (Array.isArray(enumValues) && !enumValues.some((item) => item === value)) return false;
	const type = schema["type"];
	if (typeof type === "string" && !matchesType(value, type)) return false;
	if (Array.isArray(type) && !type.some((item) => typeof item === "string" && matchesType(value, item))) return false;
	if (isRecord(value)) {
		const required = schema["required"];
		if (Array.isArray(required) && required.some((key) => typeof key === "string" && !(key in value))) return false;
		const properties = schema["properties"];
		if (isRecord(properties)) {
			for (const [key, sub] of Object.entries(properties)) if (key in value && !matchesSchema(value[key], sub, depth + 1)) return false;
		}
	}
	if (Array.isArray(value) && isRecord(schema["items"])) {
		const items = schema["items"];
		if (!value.every((item) => matchesSchema(item, items, depth + 1))) return false;
	}
	return true;
}
function matchesType(value, type) {
	switch (type) {
		case "object": return isRecord(value);
		case "array": return Array.isArray(value);
		case "string": return typeof value === "string";
		case "number": return typeof value === "number" && Number.isFinite(value);
		case "integer": return typeof value === "number" && Number.isInteger(value);
		case "boolean": return typeof value === "boolean";
		case "null": return value === null;
		default: return true;
	}
}
var VERBS_EN = "help|assist|comply|provide|continue|create|write|fulfil|fulfill|generate|engage|produce|participate|do that|do this";
var REFUSAL_PATTERNS = [
	new RegExp(`\\b(?:i|we) (?:can't|cannot|can not|won't|will not) (?:${VERBS_EN})`),
	new RegExp(`\\bi(?:'m| am) (?:unable|not able) to (?:${VERBS_EN})`),
	/\bas an ai\b/,
	/\bi must (?:decline|refuse)\b/,
	/\bi(?:'m| am) sorry,? but i (?:can't|cannot|won't)\b/,
	/не могу (?:с этим )?(?:помочь|выполнить|продолжить|создать|написать|сгенерировать|участвовать)/,
	/(?:^|[^а-яё])я не могу(?:[^а-яё]|$)/,
	/(?:^|[^а-яё])как (?:ии|искусственный интеллект|языковая модель)(?:[^а-яё]|$)/,
	/вынужден[аы]? отказаться/,
	/извините, но я не/
];
/**
* Refusal heuristics (en/ru). A refusal opens the reply: the phrase must sit in the first 80 characters of a short
* reply with no quotation mark before it, so story text like `"I can't help it," she said` is not one.
*/
function looksLikeRefusal(text) {
	const normalized = text.trim().toLowerCase().replace(/[’`]/g, "'");
	if (!normalized || normalized.length > 1500) return false;
	const head = normalized.slice(0, 300);
	return REFUSAL_PATTERNS.some((pattern) => {
		const match = pattern.exec(head);
		return match !== null && match.index <= 80 && !/["«»“”„]/.test(head.slice(0, match.index));
	});
}
/** Messages of an error and its causes (ST wraps failures as Error('API request failed', { cause })). */
function errorText(error) {
	const parts = [];
	let current = error;
	for (let depth = 0; current !== void 0 && current !== null && depth < 5; depth++) if (current instanceof Error) {
		if (current.message) parts.push(current.message);
		current = current.cause;
	} else {
		parts.push(String(current));
		break;
	}
	return parts.join(": ") || "unknown error";
}
function isAbortError(error) {
	let current = error;
	for (let depth = 0; current instanceof Error && depth < 5; depth++) {
		if (current.name === "AbortError") return true;
		current = current.cause;
	}
	return false;
}
/** Configuration errors do not get better with retries. */
function retryable(error, useSchema) {
	const text = errorText(error);
	if (/Profile not found|Connection Manager is not available|does not support|Unknown API type/i.test(text)) return false;
	return !(useSchema && schemaRejected(error));
}
function schemaRejected(error) {
	return /json_schema|response_format|structured output|schema/i.test(errorText(error));
}
function sleep(ms, signal) {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve(false);
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			resolve(false);
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve(true);
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function dropUndefined(value) {
	const out = { ...value };
	for (const key of Object.keys(out)) if (out[key] === void 0) delete out[key];
	return out;
}
//#endregion
//#region src/core/logger.ts
var ORDER = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40
};
var MAX_LINES = 300;
/** Console logger (`[Dramatis:scope]`) with a ring buffer of warnings and errors (the error journal). */
var ConsoleLogger = class ConsoleLogger {
	prefix;
	static threshold = "info";
	static lines = [];
	constructor(prefix = "Dramatis") {
		this.prefix = prefix;
	}
	static setLevel(level) {
		ConsoleLogger.threshold = level;
	}
	/** Warnings and errors since the page loaded (newest last). */
	static recent() {
		return [...ConsoleLogger.lines];
	}
	static clear() {
		ConsoleLogger.lines = [];
	}
	scope(name) {
		return new ConsoleLogger(`${this.prefix}:${name}`);
	}
	debug(...args) {
		this.write("debug", args);
	}
	info(...args) {
		this.write("info", args);
	}
	warn(...args) {
		this.write("warn", args);
	}
	error(...args) {
		this.write("error", args);
	}
	write(level, args) {
		if (ORDER[level] >= ORDER.warn) {
			ConsoleLogger.lines.push({
				at: Date.now(),
				level,
				scope: this.prefix,
				text: args.map(stringify).join(" ")
			});
			if (ConsoleLogger.lines.length > MAX_LINES) ConsoleLogger.lines.splice(0, ConsoleLogger.lines.length - MAX_LINES);
		}
		if (ORDER[level] < ORDER[ConsoleLogger.threshold]) return;
		const tag = `[${this.prefix}]`;
		if (level === "debug") console.debug(tag, ...args);
		else if (level === "info") console.info(tag, ...args);
		else if (level === "warn") console.warn(tag, ...args);
		else console.error(tag, ...args);
	}
};
function stringify(value) {
	if (value instanceof Error) return `${value.name}: ${value.message}`;
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}
function createLogger() {
	return new ConsoleLogger();
}
function emptyCardProfiles(card) {
	return {
		schema: 1,
		card,
		worldTone: "indifferent",
		invariants: [],
		characters: [],
		rules: [],
		reputation: [],
		meta: {}
	};
}
function isDict$2(value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
/** Gives a stored document every top-level field of CardProfiles (older or hand-edited files may lack some). */
function normalize$1(raw, card, schema) {
	const base = emptyCardProfiles(card);
	const doc = {
		...base,
		...raw
	};
	for (const key of [
		"invariants",
		"characters",
		"rules",
		"reputation"
	]) if (!Array.isArray(doc[key])) doc[key] = [];
	if (!isDict$2(doc.meta)) doc.meta = {};
	if (typeof doc.worldTone !== "string") doc.worldTone = base.worldTone;
	doc.card = card;
	doc.schema = schema;
	return doc;
}
function createProfileStore(deps) {
	const { host, files, bus, log } = deps;
	const target = deps.schema ?? 1;
	const migrations = /* @__PURE__ */ new Map();
	const listeners = /* @__PURE__ */ new Set();
	const fileName = (card) => files.fileName("card", card);
	function migrate(raw) {
		let schema = typeof raw.schema === "number" ? raw.schema : 1;
		let doc = raw;
		while (schema < target) {
			const step = migrations.get(schema);
			if (!step) {
				log.warn(`no profiles migration from schema ${schema}`);
				break;
			}
			doc = step(doc);
			schema++;
		}
		return doc;
	}
	async function load(card) {
		let raw;
		try {
			raw = await files.read(fileName(card));
		} catch (error) {
			log.warn(`could not read the profiles of ${card}`, error);
			return emptyCardProfiles(card);
		}
		if (!isDict$2(raw)) return emptyCardProfiles(card);
		try {
			return normalize$1(migrate(raw), card, target);
		} catch (error) {
			log.error(`profiles of ${card} could not be migrated; using empty ones`, error);
			return emptyCardProfiles(card);
		}
	}
	return {
		load,
		async current() {
			const card = host.cardKey();
			return card ? load(card) : null;
		},
		async save(profiles) {
			const card = profiles.card;
			if (!card) throw new Error("profiles without a card cannot be saved");
			profiles.schema = target;
			await files.write(fileName(card), profiles);
			for (const listener of [...listeners]) try {
				listener(card);
			} catch (error) {
				log.error("profiles listener failed", error);
			}
			await bus.emit("profiles:changed", { card });
		},
		onChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		fileName,
		migration(fromSchema, step) {
			migrations.set(fromSchema, step);
		}
	};
}
//#endregion
//#region src/core/settings.ts
var SETTINGS_KEY = "dramatis";
/** Allowed values of every choice lever: stored values outside them fall back to the default. */
var SETTINGS_CHOICES = {
	uiLanguage: [
		"auto",
		"ru",
		"en"
	],
	mode: [
		"economy",
		"balanced",
		"cinema"
	],
	cardLanguage: ["en", "ru"],
	worldTone: [
		"hostile",
		"indifferent",
		"neutral",
		"welcoming"
	],
	playerGravity: [
		"low",
		"medium",
		"high"
	],
	inertia: [
		"high",
		"medium",
		"low"
	],
	fidelity: [
		"strict",
		"balanced",
		"free"
	],
	diversity: ["even", "varied"],
	driftResponse: [
		"correct",
		"stress",
		"redo"
	],
	secrets: [
		"open",
		"spoiler",
		"known"
	],
	appetiteStrength: [
		"muted",
		"author",
		"sharp"
	],
	huntersPerScene: [
		0,
		1,
		2,
		3
	],
	corruption: [
		"off",
		"coarse",
		"all"
	]
};
function defaultSettings() {
	return {
		schemaVersion: 1,
		enabled: true,
		debug: false,
		uiLanguage: "auto",
		mode: "balanced",
		profile: "",
		cardLanguage: "en",
		mergeVoices: true,
		worldTone: "indifferent",
		playerGravity: "low",
		inertia: "high",
		fidelity: "strict",
		diversity: "varied",
		driftResponse: "correct",
		secrets: "spoiler",
		appetiteStrength: "author",
		huntersPerScene: 2,
		corruption: "all",
		autoArchives: true,
		cardBudget: 300,
		depth: 1,
		modules: {}
	};
}
/**
* Migration steps by the schema they start from: `SETTINGS_MIGRATIONS[1]` moves 1 → 2, and so on. Add a step and bump
* SETTINGS_SCHEMA_VERSION together. Schema 0 is "no version stored" (first run): nothing to move.
*/
var SETTINGS_MIGRATIONS = {};
function isDict$1(value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
/** Fills missing keys from defaults without overwriting stored values (recursively for plain objects). */
function fillDefaults(stored, defaults) {
	if (!isDict$1(stored)) return structuredClone(defaults);
	const result = structuredClone(defaults);
	for (const [key, value] of Object.entries(stored)) {
		const base = result[key];
		result[key] = isDict$1(base) && isDict$1(value) ? fillDefaults(value, base) : value;
	}
	return result;
}
/**
* Runs the migration steps from the stored schema up to `target`, then fills defaults and replaces values of the
* wrong type or outside their choices. Never throws: a failing step is logged and skipped.
*/
function migrateSettings(raw, log, migrations = SETTINGS_MIGRATIONS, target = 1) {
	const source = isDict$1(raw) ? raw : {};
	let version = typeof source.schemaVersion === "number" ? source.schemaVersion : 0;
	while (version < target) {
		const step = migrations[version];
		if (step) try {
			step(source);
		} catch (error) {
			log?.error(`settings migration from schema ${version} failed`, error);
		}
		version++;
	}
	const defaults = defaultSettings();
	const filled = fillDefaults(source, {
		...defaults,
		slices: {}
	});
	for (const [key, value] of Object.entries(defaults)) {
		const current = filled[key];
		const choices = SETTINGS_CHOICES[key];
		if (typeof current !== typeof value || isDict$1(value) && !isDict$1(current) || choices && !choices.includes(current)) filled[key] = structuredClone(value);
	}
	if (!isDict$1(filled.slices)) filled.slices = {};
	const settings = filled;
	settings.cardBudget = Math.max(50, Math.round(settings.cardBudget));
	settings.depth = Math.max(0, Math.round(settings.depth));
	settings.schemaVersion = Math.max(target, typeof source.schemaVersion === "number" ? source.schemaVersion : 0);
	return settings;
}
var Settings = class {
	getStore;
	persist;
	log;
	listeners = /* @__PURE__ */ new Set();
	/** Module slices already filled with their defaults since the last load. */
	filled = /* @__PURE__ */ new Set();
	root;
	constructor(getStore, persist, log) {
		this.getStore = getStore;
		this.persist = persist;
		this.log = log;
		this.root = this.load();
	}
	/** Re-reads extensionSettings (ST may replace the object after a settings reload). */
	reload() {
		this.root = this.load();
	}
	get() {
		return this.root;
	}
	set(key, value) {
		this.root[key] = value;
		this.save();
		this.notify(key);
	}
	module(key, defaults) {
		if (!this.filled.has(key)) {
			this.root.slices[key] = fillDefaults(this.root.slices[key], defaults());
			this.filled.add(key);
		}
		return this.root.slices[key];
	}
	isModuleEnabled(key, byDefault) {
		const explicit = this.root.modules[key];
		return typeof explicit === "boolean" ? explicit : byDefault;
	}
	setModuleEnabled(key, enabled) {
		this.root.modules[key] = enabled;
		this.save();
		this.notify(`modules.${key}`);
	}
	save() {
		try {
			this.persist();
		} catch (error) {
			this.log.error("could not save settings", error);
		}
	}
	/** Lifecycle `clean`: drops everything Dramatis stored in settings. */
	reset() {
		const store = this.getStore();
		delete store[SETTINGS_KEY];
		this.root = this.load();
		this.save();
		this.notify("*");
	}
	onChange(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	notify(key) {
		for (const listener of [...this.listeners]) try {
			listener(key);
		} catch (error) {
			this.log.error("settings listener failed", error);
		}
	}
	load() {
		const store = this.getStore();
		const root = migrateSettings(store[SETTINGS_KEY], this.log);
		store[SETTINGS_KEY] = root;
		this.filled.clear();
		return root;
	}
};
//#endregion
//#region src/domain/model.ts
/** Target id of the player's character in ties, beliefs and appetites. */
var PLAYER_ID = "@player";
function copy(value) {
	return structuredClone(value);
}
/** The start of a profile for a greeting: the exact greeting first, then the «any greeting» one (-1). */
function startFor(profile, greeting) {
	return profile.starts.find((start) => start.greeting === greeting) ?? profile.starts.find((start) => start.greeting === -1);
}
/** A fresh live state of one character for a chat that began with `greeting`. */
function createCharacterState(profile, greeting) {
	const ties = {};
	for (const tie of profile.ties) ties[tie.target] = copy(tie);
	const appetites = {};
	for (const appetite of profile.appetites) appetites[appetite.id] = {
		pressure: appetite.baseline,
		tolerance: appetite.tolerance,
		dependence: appetite.dependence,
		sensitization: appetite.sensitization,
		lastSated: -1,
		edgeCount: 0,
		withdrawal: false
	};
	const start = startFor(profile, greeting);
	const present = start?.present === true;
	const scene = { attention: "background" };
	if (start?.doing) scene.doing = start.doing;
	if (start?.goal) scene.goal = start.goal;
	return {
		id: profile.id,
		ties,
		mood: copy(profile.core.baselineMood),
		scene,
		appetites,
		agenda: copy(profile.agenda),
		stress: 0,
		corruption: {
			level: profile.core.corruption,
			stains: 0,
			gifts: [],
			brands: []
		},
		arcStage: "intact",
		present,
		lastSeenTurn: present ? 0 : -1,
		selfControl: 3,
		knowsPlayer: Object.hasOwn(ties, PLAYER_ID)
	};
}
/** Reputation of the player at the start: per group, the seed of this greeting wins over the «every start» one. */
function startingReputation(seeds, greeting) {
	const chosen = /* @__PURE__ */ new Map();
	for (const seed of seeds) {
		if (seed.greeting !== greeting && seed.greeting !== -1) continue;
		const previous = chosen.get(seed.among);
		if (!previous || previous.greeting === -1 && seed.greeting === greeting) chosen.set(seed.among, seed);
	}
	return [...chosen.values()].map((seed) => ({
		among: seed.among,
		label: seed.label,
		stance: seed.stance,
		weaknesses: [],
		reasons: []
	}));
}
/**
* The state a chat starts with: every profile of the card (characters and groups) gets its live state, the world
* rules and tone are copied, the player's reputation is seeded for this greeting, counters start at zero.
*/
function initChatState(profiles, greeting, chatCardKey) {
	const characters = {};
	for (const profile of profiles.characters) characters[profile.id] = createCharacterState(profile, greeting);
	return {
		schema: 1,
		card: chatCardKey,
		worldTone: profiles.worldTone,
		extras: [],
		characters,
		rules: copy(profiles.rules),
		reputation: startingReputation(profiles.reputation, greeting),
		rumours: [],
		schemes: [],
		turn: 0,
		scene: 0,
		greeting,
		log: []
	};
}
//#endregion
//#region src/core/state.ts
function isDict(value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function isStateEnvelope(value) {
	return isDict(value) && typeof value.version === "number" && typeof value.schema === "number" && "data" in value;
}
/** Gives a stored state every top-level collection (older or hand-edited files may lack some). */
function normalize(data, card) {
	const state = data;
	if (!isDict(state.characters)) state.characters = {};
	for (const key of [
		"extras",
		"rules",
		"reputation",
		"rumours",
		"schemes",
		"log"
	]) if (!Array.isArray(state[key])) state[key] = [];
	for (const key of [
		"turn",
		"scene",
		"greeting"
	]) if (typeof state[key] !== "number") state[key] = 0;
	if (typeof state.card !== "string" || !state.card) state.card = card;
	if (typeof state.worldTone !== "string") state.worldTone = "indifferent";
	return state;
}
var draftKey = (chatId, messageIndex, swipeId) => `${chatId}\u0000${messageIndex}\u0000${swipeId}`;
function createStateStore(deps) {
	const { host, files, profiles, bus, log } = deps;
	const target = deps.schema ?? 1;
	const tabId = currentTabId();
	const cache = /* @__PURE__ */ new Map();
	const loading = /* @__PURE__ */ new Map();
	const chains = /* @__PURE__ */ new Map();
	const migrations = /* @__PURE__ */ new Map();
	/** Version this tab last read or wrote, per chat. Survives cache clears (a write may finish after a switch). */
	const knownVersions = /* @__PURE__ */ new Map();
	/** State object → chat it belongs to: save() writes back to the chat it was read from. */
	const owners = /* @__PURE__ */ new WeakMap();
	const drafts = /* @__PURE__ */ new Map();
	const listeners = /* @__PURE__ */ new Set();
	const unsubscribers = [];
	let generation = 0;
	const fileName = (chatId) => files.fileName(`chat-${stableHash(chatId)}-state`);
	const serial = (key, job) => {
		const next = (chains.get(key) ?? Promise.resolve()).then(job, job);
		const settled = next.catch(() => void 0);
		chains.set(key, settled);
		settled.then(() => {
			if (chains.get(key) === settled) chains.delete(key);
		});
		return next;
	};
	function migrate(env) {
		let schema = env.schema;
		let doc = isDict(env.data) ? env.data : {};
		while (schema < target) {
			const step = migrations.get(schema);
			if (!step) {
				log.warn(`no state migration from schema ${schema}`);
				break;
			}
			doc = step(doc);
			schema++;
		}
		doc.schema = Math.max(schema, target);
		return doc;
	}
	async function build(chatId, card) {
		let source;
		try {
			source = await profiles.load(card);
		} catch (error) {
			log.warn("profiles could not be loaded; the chat starts with no cast", error);
			source = emptyCardProfiles(card);
		}
		let greeting = 0;
		try {
			greeting = deps.greeting();
		} catch (error) {
			log.debug("greeting index unavailable", error);
		}
		return {
			chatId,
			state: initChatState(source, greeting, card),
			saved: false
		};
	}
	function changed(chatId) {
		for (const listener of [...listeners]) try {
			listener();
		} catch (error) {
			log.error("state listener failed", error);
		}
		bus.emit("state:changed", { chatId });
	}
	function load(chatId, card) {
		const cached = cache.get(chatId);
		if (cached) return Promise.resolve(cached);
		const pending = loading.get(chatId);
		if (pending) return pending;
		const startedIn = generation;
		const job = serial(chatId, async () => {
			const again = cache.get(chatId);
			if (again) return again;
			const raw = await readFresh(files, fileName(chatId));
			let entry;
			if (isStateEnvelope(raw)) {
				entry = {
					chatId,
					state: normalize(migrate(raw), card),
					saved: true
				};
				knownVersions.set(chatId, raw.version);
			} else {
				if (raw !== null) log.warn("chat state has no envelope; starting from the card profiles");
				entry = await build(chatId, card);
			}
			owners.set(entry.state, chatId);
			if (startedIn === generation) cache.set(chatId, entry);
			return entry;
		});
		loading.set(chatId, job);
		job.finally(() => {
			if (loading.get(chatId) === job) loading.delete(chatId);
		}).catch(() => void 0);
		return job;
	}
	/** Unsaved states are rebuilt next time (their greeting or profiles changed before anything was written). */
	function dropUnsaved(match) {
		for (const [chatId, entry] of [...cache]) if (!entry.saved && match(entry)) cache.delete(chatId);
	}
	function dropDrafts(messageIndex) {
		const chatId = host.chatId();
		for (const [key, item] of [...drafts]) {
			if (item.chatId !== chatId) continue;
			if (messageIndex === void 0 || item.messageIndex >= messageIndex) drafts.delete(key);
		}
	}
	function clearCache() {
		generation++;
		cache.clear();
	}
	return {
		async current() {
			const chatId = host.chatId();
			const card = host.cardKey();
			if (!chatId || !card || host.isGroupChat()) return null;
			try {
				return (await load(chatId, card)).state;
			} catch (error) {
				log.error("could not load the chat state", error);
				return null;
			}
		},
		async save(state) {
			const chatId = owners.get(state) ?? host.chatId();
			if (!chatId) {
				log.debug("no chat: state not saved");
				return false;
			}
			const startedIn = generation;
			return serial(chatId, async () => {
				const name = fileName(chatId);
				let raw;
				try {
					raw = await readFresh(files, name);
				} catch (error) {
					log.warn("could not re-read the chat state before writing", error);
					return false;
				}
				const remote = isStateEnvelope(raw) ? raw : null;
				const remoteVersion = remote?.version ?? 0;
				const known = knownVersions.get(chatId) ?? 0;
				if (remote && (remoteVersion > known || remote.schema > target)) {
					log.info(`another tab wrote state version ${remoteVersion} (this tab saw ${known}); reloading`);
					knownVersions.set(chatId, remoteVersion);
					if (startedIn === generation) try {
						const fresh = {
							chatId,
							state: normalize(migrate(remote), state.card),
							saved: true
						};
						owners.set(fresh.state, chatId);
						cache.set(chatId, fresh);
					} catch (error) {
						cache.delete(chatId);
						log.error("could not refresh the chat state", error);
					}
					changed(chatId);
					return false;
				}
				state.schema = target;
				const env = {
					schema: target,
					version: Math.max(known, remoteVersion) + 1,
					updatedAt: Date.now(),
					tabId,
					data: state
				};
				try {
					await files.write(name, env);
				} catch (error) {
					log.error("could not write the chat state", error);
					return false;
				}
				owners.set(state, chatId);
				knownVersions.set(chatId, env.version);
				if (startedIn === generation) cache.set(chatId, {
					chatId,
					state,
					saved: true
				});
				changed(chatId);
				return true;
			});
		},
		setDraft(messageIndex, swipeId, draft) {
			const chatId = host.chatId();
			if (!chatId) return;
			drafts.set(draftKey(chatId, messageIndex, swipeId), {
				chatId,
				messageIndex,
				draft
			});
		},
		takeDraft(messageIndex, swipeId) {
			const chatId = host.chatId();
			if (!chatId) return void 0;
			const key = draftKey(chatId, messageIndex, swipeId);
			const item = drafts.get(key);
			drafts.delete(key);
			return item?.draft;
		},
		/** Drops the drafts of this message and of every later one (all drafts of the chat when omitted). */
		dropDrafts,
		onChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		fileName,
		migration(fromSchema, step) {
			migrations.set(fromSchema, step);
		},
		install() {
			if (unsubscribers.length) return;
			unsubscribers.push(bus.on("chat:changed", () => {
				clearCache();
				drafts.clear();
			}), bus.on("message:invalidated", ({ messageIndex }) => {
				dropDrafts(messageIndex);
				if (messageIndex === 0) dropUnsaved((entry) => entry.chatId === host.chatId());
			}), bus.on("profiles:changed", ({ card }) => dropUnsaved((entry) => entry.state.card === card)));
		},
		dispose() {
			for (const off of unsubscribers.splice(0)) off();
			drafts.clear();
			listeners.clear();
			clearCache();
		},
		clearCache
	};
}
//#endregion
//#region src/core/strings.ts
var CORE_STRINGS = {
	en: {
		"core.name": "Dramatis",
		"core.llm.needsMaestro": "This needs Maestro: background AI tasks run through it.",
		"core.llm.noProfile": "No connection profile: pick one in the Dramatis settings or in Connection Manager.",
		"core.llm.noCm": "Connection Manager is off, so AI requests are not possible.",
		"core.llm.refusal": "The model refused to answer.",
		"core.llm.aborted": "The request was cancelled.",
		"core.llm.failed": "The AI request failed: {error}"
	},
	ru: {
		"core.name": "Dramatis",
		"core.llm.needsMaestro": "Для этого нужен Maestro: фоновые задачи ИИ идут через него.",
		"core.llm.noProfile": "Не выбран профиль подключения: выбери его в настройках Dramatis или в Connection Manager.",
		"core.llm.noCm": "Connection Manager выключен, поэтому запросы к ИИ невозможны.",
		"core.llm.refusal": "Модель отказалась отвечать.",
		"core.llm.aborted": "Запрос отменён.",
		"core.llm.failed": "Запрос к ИИ не удался: {error}"
	}
};
//#endregion
//#region src/core/turn.ts
/** A generation that has not ended after this long is considered finished (lost GENERATION_ENDED). */
var GENERATION_STALE_MS = 3e5;
var TurnTracker = class {
	deps;
	unsubscribers = [];
	offMaestro = null;
	turnMode = "own";
	generation = null;
	staleTimer = null;
	timers = /* @__PURE__ */ new Set();
	constructor(deps) {
		this.deps = deps;
	}
	install() {
		if (this.unsubscribers.length) return;
		const { host, bus, ephemeral } = this.deps;
		const on = (keys, handler, order) => {
			const name = keys.map((key) => host.events.name(key)).find((value) => value !== void 0);
			if (!name) {
				this.deps.log.warn(`ST event ${keys.join(" / ")} is missing`);
				return;
			}
			this.unsubscribers.push(host.events.on(name, handler, order ? { order } : void 0));
		};
		on(["CHAT_CHANGED"], () => {
			this.endGeneration();
			ephemeral.clearAll();
			if (this.own()) bus.emit("chat:changed", { chatId: host.chatId() });
		});
		on(["GENERATION_AFTER_COMMANDS", "GENERATION_STARTED"], async (type, _options, dryRun) => {
			const info = {
				type: typeof type === "string" && type ? type : "normal",
				dryRun: dryRun === true,
				quiet: type === "quiet"
			};
			if (!info.quiet && !info.dryRun) this.startGeneration(info);
			await ephemeral.run(info);
			if (this.own()) await bus.emit("generation:before", info);
		});
		const ended = (stopped) => () => {
			const type = this.generation?.type ?? "normal";
			this.endGeneration();
			ephemeral.clearAll();
			if (this.own()) bus.emit("generation:ended", {
				type,
				stopped
			});
		};
		on(["GENERATION_ENDED"], ended(false));
		on(["GENERATION_STOPPED"], ended(true));
		on(["MESSAGE_RECEIVED"], (messageId) => {
			const index = Number(messageId);
			if (!Number.isInteger(index) || index < 0) return;
			const message = host.ctx().chat[index];
			if (!message || message.is_user) return;
			const timer = setTimeout(() => {
				this.timers.delete(timer);
				if (this.own()) bus.emit("reply:ready", { messageIndex: index });
			}, 0);
			this.timers.add(timer);
		}, "last");
		on(["MESSAGE_SENT"], (messageId) => {
			if (!this.own()) return;
			const index = Number(messageId);
			const committed = this.lastAssistantBefore(Number.isFinite(index) ? index : host.ctx().chat.length);
			if (committed >= 0) bus.emit("turn:committed", { messageIndex: committed });
		});
		on(["MESSAGE_SWIPED"], (messageId) => this.invalidate(messageId, "swiped"));
		on(["MESSAGE_DELETED"], (length) => this.invalidate(length, "deleted"));
		on(["MESSAGE_EDITED"], (messageId) => this.invalidate(messageId, "edited"));
		this.unsubscribers.push(bus.on("maestro:changed", () => this.sync()));
		this.sync();
	}
	dispose() {
		for (const off of this.unsubscribers.splice(0)) off();
		this.detachMaestro();
		for (const timer of this.timers) clearTimeout(timer);
		this.timers.clear();
		this.endGeneration();
		this.deps.ephemeral.clearAll();
		this.turnMode = "own";
	}
	/** Where turn events come from now. */
	mode() {
		return this.turnMode;
	}
	/** The generation in progress (not quiet, not a dry run), or null. */
	current() {
		return this.generation;
	}
	/** Follows the bridge: Maestro's pipeline when its API is present, our own tracking otherwise. */
	sync() {
		const api = this.deps.bridge.api();
		if (api && this.turnMode === "maestro" && this.offMaestro) return;
		this.detachMaestro();
		if (!api) {
			this.turnMode = "own";
			return;
		}
		try {
			this.offMaestro = api.onTurn((event) => this.forward(event));
			this.turnMode = "maestro";
		} catch (error) {
			this.deps.log.warn("could not subscribe to Maestro turn events; tracking turns ourselves", error);
			this.turnMode = "own";
		}
	}
	own() {
		return this.turnMode === "own";
	}
	detachMaestro() {
		if (!this.offMaestro) return;
		try {
			this.offMaestro();
		} catch (error) {
			this.deps.log.debug("Maestro turn unsubscribe failed", error);
		}
		this.offMaestro = null;
	}
	async forward(event) {
		const { bus } = this.deps;
		switch (event.type) {
			case "chat:changed": return bus.emit("chat:changed", { chatId: event.chatId });
			case "reply:ready": return bus.emit("reply:ready", { messageIndex: event.messageIndex });
			case "turn:committed": return bus.emit("turn:committed", { messageIndex: event.messageIndex });
			case "message:invalidated": return bus.emit("message:invalidated", {
				messageIndex: event.messageIndex,
				reason: event.reason
			});
			case "generation:before": return bus.emit("generation:before", {
				type: event.generation,
				dryRun: event.dryRun,
				quiet: event.quiet
			});
			case "generation:ended": return bus.emit("generation:ended", {
				type: event.generation,
				stopped: event.stopped
			});
			default: this.deps.log.debug("unknown Maestro turn event", event);
		}
	}
	startGeneration(info) {
		this.generation = info;
		if (this.staleTimer) clearTimeout(this.staleTimer);
		this.staleTimer = setTimeout(() => {
			if (this.generation !== info) return;
			this.deps.log.warn("generation end not reported, releasing");
			this.generation = null;
			this.deps.ephemeral.clearAll();
		}, GENERATION_STALE_MS);
	}
	endGeneration() {
		this.generation = null;
		if (this.staleTimer) clearTimeout(this.staleTimer);
		this.staleTimer = null;
	}
	lastAssistantBefore(index) {
		const chat = this.deps.host.ctx().chat;
		for (let i = Math.min(index, chat.length) - 1; i >= 0; i--) {
			const message = chat[i];
			if (message && !message.is_user && !message.is_system) return i;
		}
		return -1;
	}
	invalidate(messageId, reason) {
		if (!this.own()) return;
		const index = Number(messageId);
		if (!Number.isInteger(index) || index < 0) return;
		this.deps.bus.emit("message:invalidated", {
			messageIndex: index,
			reason
		});
	}
};
function createTurnTracker(deps) {
	return new TurnTracker(deps);
}
//#endregion
//#region src/host/events.ts
function createHostEvents(ctx, log) {
	const registrations = /* @__PURE__ */ new Set();
	const emitter = () => ctx().eventSource;
	function name(key) {
		const types = ctx().eventTypes ?? {};
		if (!Object.prototype.hasOwnProperty.call(types, key)) return void 0;
		const value = types[key];
		return typeof value === "string" ? value : void 0;
	}
	/** eventTypes key → raw name; anything else is taken as a raw name. */
	function resolve(event) {
		return name(event) ?? event;
	}
	/** `initial` = first registration; later calls (reassertOrder) only move an existing listener. */
	function placeFirst(es, event, listener, initial) {
		if (!initial && isAutoFire(es, event)) {
			const list = listenersOf(es, event);
			if (list) moveInList(list, listener, "first");
			return;
		}
		if (!initial) es.removeListener(event, listener);
		if (typeof es.makeFirst === "function") {
			es.makeFirst(event, listener);
			return;
		}
		es.on(event, listener);
		const list = listenersOf(es, event);
		if (list) moveInList(list, listener, "first");
	}
	function placeLast(es, event, listener, initial) {
		if (!initial && isAutoFire(es, event)) {
			const list = listenersOf(es, event);
			if (list) moveInList(list, listener, "last");
			return;
		}
		if (typeof es.makeLast === "function") {
			es.makeLast(event, listener);
			return;
		}
		es.removeListener(event, listener);
		es.on(event, listener);
	}
	return {
		on(event, handler, options) {
			const raw = resolve(event);
			const order = options?.order ?? "normal";
			const listener = (...args) => {
				try {
					const result = handler(...args);
					if (result instanceof Promise) return result.catch((error) => log.error(`listener for ${raw} failed`, error));
					return result;
				} catch (error) {
					log.error(`listener for ${raw} failed`, error);
					return;
				}
			};
			const registration = {
				event: raw,
				order,
				listener
			};
			const es = emitter();
			if (order === "first") placeFirst(es, raw, listener, true);
			else if (order === "last") placeLast(es, raw, listener, true);
			else es.on(raw, listener);
			registrations.add(registration);
			let active = true;
			return () => {
				if (!active) return;
				active = false;
				registrations.delete(registration);
				emitter().removeListener(raw, listener);
			};
		},
		reassertOrder() {
			const es = emitter();
			const byEvent = /* @__PURE__ */ new Map();
			for (const registration of registrations) {
				if (registration.order === "normal") continue;
				const list = byEvent.get(registration.event) ?? [];
				list.push(registration);
				byEvent.set(registration.event, list);
			}
			for (const [event, regs] of byEvent) {
				const firsts = regs.filter((r) => r.order === "first").map((r) => r.listener);
				const lasts = regs.filter((r) => r.order === "last").map((r) => r.listener);
				const list = listenersOf(es, event);
				if (list && inPlace(list, [...firsts].reverse(), lasts)) continue;
				try {
					for (const listener of firsts) placeFirst(es, event, listener, false);
					for (const listener of lasts) placeLast(es, event, listener, false);
				} catch (error) {
					log.warn(`could not reassert listener order for ${event}`, error);
				}
			}
		},
		emit(event, ...args) {
			return emitter().emit(resolve(event), ...args);
		},
		name,
		dispose() {
			const es = emitter();
			for (const registration of [...registrations]) try {
				es.removeListener(registration.event, registration.listener);
			} catch (error) {
				log.warn(`could not remove ${registration.event} listener`, error);
			}
			registrations.clear();
		}
	};
}
/** The live listener array of an event, when the emitter exposes it. */
function listenersOf(es, event) {
	const store = es.events;
	let list;
	if (store instanceof Map) list = store.get(event);
	else if (store && typeof store === "object") list = store[event];
	return Array.isArray(list) ? list : void 0;
}
function isAutoFire(es, event) {
	const auto = es.autoFireAfterEmit;
	return auto instanceof Set && auto.has(event);
}
function moveInList(list, listener, where) {
	const index = list.indexOf(listener);
	if (index >= 0) list.splice(index, 1);
	if (where === "first") list.unshift(listener);
	else list.push(listener);
}
function inPlace(list, head, tail) {
	if (list.length < head.length + tail.length) return false;
	for (let i = 0; i < head.length; i++) if (list[i] !== head[i]) return false;
	const offset = list.length - tail.length;
	for (let i = 0; i < tail.length; i++) if (list[offset + i] !== tail[i]) return false;
	return true;
}
//#endregion
//#region src/host/modules.ts
/** Module paths, relative to the ST web root (public/). */
var ST_MODULE_PATHS = {
	worldInfo: "/scripts/world-info.js",
	script: "/script.js"
};
var importByUrl = async (url) => await import(
	/* @vite-ignore */
	url
);
function pageOrigin() {
	return window.location.origin;
}
/**
* @param importer replaced in tests; the default is a native dynamic import.
* @param origin page origin (window.location.origin).
*/
function createHostModules(log, importer = importByUrl, origin = pageOrigin) {
	const cache = /* @__PURE__ */ new Map();
	function url(path) {
		const base = origin();
		const normalized = path.startsWith("/") ? path : path.startsWith("scripts/") ? `/${path}` : `/scripts/${path}`;
		const resolved = new URL(normalized, base);
		if (resolved.origin !== new URL(base).origin) throw new Error(`refusing to import a module from another origin: ${path}`);
		return resolved.href;
	}
	function load(path) {
		let href;
		try {
			href = url(path);
		} catch (error) {
			return Promise.reject(error instanceof Error ? error : new Error(String(error)));
		}
		const cached = cache.get(href);
		if (cached) return cached;
		const pending = importer(href).catch((error) => {
			cache.delete(href);
			log.warn(`could not import ST module ${path}`, error);
			throw error;
		});
		cache.set(href, pending);
		return pending;
	}
	return {
		worldInfo: () => load(ST_MODULE_PATHS.worldInfo),
		script: () => load(ST_MODULE_PATHS.script),
		load,
		url
	};
}
//#endregion
//#region src/host/index.ts
/** Never cache the result: getContext() builds a new object on every call and chatMetadata is reassigned on chat load. */
function context() {
	return SillyTavern.getContext();
}
function createHost(log) {
	const events = createHostEvents(context, log.scope("events"));
	const modules = createHostModules(log.scope("modules"));
	function character() {
		const ctx = context();
		if (ctx.groupId) return null;
		const id = ctx.characterId;
		if (id === void 0 || id === null || id === "") return null;
		const index = Number(id);
		if (!Number.isInteger(index) || index < 0) return null;
		return ctx.characters?.[index] ?? null;
	}
	return {
		ctx: context,
		events,
		modules,
		character,
		chatId() {
			const id = context().getCurrentChatId?.();
			return typeof id === "string" && id ? id : null;
		},
		isGroupChat() {
			return Boolean(context().groupId);
		},
		cardKey() {
			const avatar = character()?.avatar;
			return typeof avatar === "string" && avatar ? avatar : null;
		},
		dispose() {
			events.dispose();
		}
	};
}
//#endregion
//#region src/ui/dom.ts
function classNames(value) {
	if (!value) return "";
	if (typeof value === "string") return value;
	return value.filter((item) => typeof item === "string" && item.length > 0).join(" ");
}
function append(parent, children) {
	if (children === void 0) return;
	const list = Array.isArray(children) ? children : [children];
	for (const child of list) {
		if (child === null || child === void 0 || child === false) continue;
		parent.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
	}
}
function el(tag, props = {}, children) {
	const element = document.createElement(tag);
	const className = classNames(props.class);
	if (className) element.className = className;
	if (props.text !== void 0) element.textContent = props.text;
	if (props.title !== void 0) element.setAttribute("title", props.title);
	if (props.data) for (const [key, value] of Object.entries(props.data)) element.dataset[key] = String(value);
	if (props.attrs) for (const [key, value] of Object.entries(props.attrs)) {
		if (value === false || value === null || value === void 0) continue;
		element.setAttribute(key, value === true ? "" : String(value));
	}
	if (props.on) {
		for (const [name, handler] of Object.entries(props.on)) if (handler) element.addEventListener(name, handler);
	}
	append(element, children);
	return element;
}
function clear(node) {
	while (node.firstChild) node.removeChild(node.firstChild);
}
/** Font Awesome icon (ST ships FA 6). */
function icon(name, extra) {
	return el("i", {
		class: [
			"fa-solid",
			name.startsWith("fa-") ? name : `fa-${name}`,
			"fa-fw",
			extra
		],
		attrs: { "aria-hidden": "true" }
	});
}
var reportButtonError = (error) => console.error("[Dramatis:ui]", error);
/** Where failures of async button handlers go (the UI routes them to its logger). */
function setButtonErrorHandler(handler) {
	reportButtonError = handler;
}
/** A ST-styled button. Async handlers disable the button while they run (no double taps on a phone). */
function button(options) {
	const node = el("button", {
		class: [
			"menu_button",
			"dramatis-btn",
			options.kind && options.kind !== "default" ? `dramatis-btn-${options.kind}` : null,
			options.className
		],
		title: options.title,
		attrs: {
			type: "button",
			disabled: options.disabled === true,
			"aria-label": options.label ? void 0 : options.title
		}
	}, [options.icon ? icon(options.icon) : null, options.label ? el("span", { text: options.label }) : null]);
	if (options.onClick) {
		const handler = options.onClick;
		node.addEventListener("click", (event) => {
			if (node.disabled) return;
			let result;
			try {
				result = handler(event);
			} catch (error) {
				reportButtonError(error);
				return;
			}
			if (result instanceof Promise) {
				node.disabled = true;
				node.classList.add("dramatis-busy");
				result.catch((error) => reportButtonError(error)).finally(() => {
					node.disabled = options.disabled === true;
					node.classList.remove("dramatis-busy");
				});
			}
		});
	}
	return node;
}
//#endregion
//#region src/ui/settings-drawer.ts
var SETTINGS_ROOT_ID = "dramatis-settings";
var SettingsDrawer = class {
	i18n;
	log;
	sections = /* @__PURE__ */ new Map();
	rendered = [];
	root = null;
	title = null;
	content = null;
	constructor(i18n, log) {
		this.i18n = i18n;
		this.log = log;
	}
	mount() {
		if (this.root || typeof document === "undefined") return;
		const container = document.querySelector("#extensions_settings2") ?? document.querySelector("#extensions_settings");
		if (!container) {
			this.log.debug("extensions panel not found; settings drawer not mounted");
			return;
		}
		document.getElementById(SETTINGS_ROOT_ID)?.remove();
		this.title = el("b", { text: this.i18n.t("ui.title") });
		this.content = el("div", { class: "inline-drawer-content dramatis-settings-content" });
		this.root = el("div", {
			class: "extension_container dramatis-ui",
			attrs: { id: SETTINGS_ROOT_ID }
		}, [el("div", { class: "inline-drawer" }, [el("div", { class: "inline-drawer-toggle inline-drawer-header" }, [this.title, el("div", { class: "inline-drawer-icon fa-solid fa-circle-chevron-down down" })]), this.content])]);
		container.appendChild(this.root);
		this.render();
	}
	add(section) {
		if (this.sections.has(section.id)) this.log.warn(`settings section "${section.id}" replaced`);
		this.sections.set(section.id, section);
		this.render();
		return () => {
			if (this.sections.get(section.id) !== section) return;
			this.sections.delete(section.id);
			this.render();
		};
	}
	/** Builds every section again (sections added or removed, the language changed). */
	render() {
		this.release();
		if (!this.content) return;
		if (this.title) this.title.textContent = this.i18n.t("ui.title");
		clear(this.content);
		const ordered = [...this.sections.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
		for (const section of ordered) {
			const body = el("div", { class: "dramatis-settings-body" });
			this.content.appendChild(el("section", {
				class: "dramatis-settings-section",
				data: { section: section.id }
			}, [el("h4", {
				class: "dramatis-settings-title",
				text: this.i18n.t(section.titleKey)
			}), body]));
			try {
				const dispose = section.render(body);
				this.rendered.push({ dispose: typeof dispose === "function" ? dispose : null });
			} catch (error) {
				this.log.error(`settings section ${section.id} failed to render`, error);
				body.appendChild(el("div", {
					class: "dramatis-error-text",
					text: this.i18n.t("ui.window.failed")
				}));
			}
		}
	}
	dispose() {
		this.release();
		this.sections.clear();
		this.root?.remove();
		this.root = null;
		this.title = null;
		this.content = null;
	}
	release() {
		for (const item of this.rendered.splice(0)) try {
			item.dispose?.();
		} catch (error) {
			this.log.error("settings section cleanup failed", error);
		}
	}
};
//#endregion
//#region src/ui/slash.ts
/** Page-wide: survives a UI rebuild (disable → activate without reload) so ST never sees a duplicate. */
var slots = /* @__PURE__ */ new Map();
function unnamedText(value) {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : String(item)).join(" ");
	if (value === void 0 || value === null) return "";
	return String(value);
}
var SlashCommands = class {
	host;
	i18n;
	log;
	owned = /* @__PURE__ */ new Set();
	constructor(host, i18n, log) {
		this.host = host;
		this.i18n = i18n;
		this.log = log;
	}
	add(rawName, helpKey, callback) {
		const name = rawName.replace(/^\//, "");
		let slot = slots.get(name);
		if (slot) Object.assign(slot, {
			callback,
			state: "active",
			i18n: this.i18n,
			log: this.log,
			owner: this
		});
		else {
			slot = {
				callback,
				state: "active",
				i18n: this.i18n,
				log: this.log,
				owner: this
			};
			if (!this.register(name, helpKey)) return () => {};
			slots.set(name, slot);
		}
		this.owned.add(name);
		const current = slot;
		return () => {
			if (current.callback !== callback || current.state !== "active") return;
			current.state = "off";
		};
	}
	/** Dramatis is going away: every command it owns answers "Dramatis is disabled". */
	dispose() {
		for (const name of this.owned) {
			const slot = slots.get(name);
			if (slot && slot.owner === this) slot.state = "dramatisOff";
		}
		this.owned.clear();
	}
	register(name, helpKey) {
		const c = this.host.ctx();
		if (!c.SlashCommandParser?.addCommandObject || !c.SlashCommand?.fromProps) {
			this.log.warn(`slash commands unavailable; /${name} not registered`);
			return false;
		}
		const props = {
			name,
			helpString: this.i18n.t(helpKey),
			returns: "string",
			callback: (_named, unnamed) => run(name, unnamed)
		};
		if (c.SlashCommandArgument?.fromProps) props.unnamedArgumentList = [c.SlashCommandArgument.fromProps({
			description: this.i18n.t("ui.slash.argument"),
			typeList: [c.ARGUMENT_TYPE?.STRING ?? "string"],
			isRequired: false
		})];
		try {
			c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps(props));
			return true;
		} catch (error) {
			this.log.error(`failed to register /${name}`, error);
			return false;
		}
	}
};
async function run(name, unnamed) {
	const slot = slots.get(name);
	if (!slot) return "";
	if (slot.state === "dramatisOff") return slot.i18n.t("ui.slash.dramatisOff");
	if (slot.state === "off") return slot.i18n.t("ui.slash.off", { name });
	try {
		return await slot.callback(unnamedText(unnamed));
	} catch (error) {
		slot.log.error(`/${name} failed`, error);
		return slot.i18n.t("ui.slash.failed", {
			name,
			error: error instanceof Error ? error.message : String(error)
		});
	}
}
/**
* Windows stack from here up, one step per open window: under ST's own panels and top-bar drawers (z-index 3000–3005),
* like Maestro's windows (2900–2950), so opening an ST drawer covers them.
*/
var BASE_Z = 2900;
/** Part of a moved window that must stay on screen (its header can always be grabbed). */
var KEEP_VISIBLE = 80;
function isSheetViewport() {
	return (globalThis.innerWidth || document.documentElement?.clientWidth || 1280) < 768;
}
var WindowManager = class {
	deps;
	specs = /* @__PURE__ */ new Map();
	windows = /* @__PURE__ */ new Map();
	/** Open windows, back to front. */
	order = [];
	onResize = () => this.layoutAll();
	listening = false;
	constructor(deps) {
		this.deps = deps;
	}
	add(spec) {
		const stack = this.specs.get(spec.id) ?? [];
		stack.push(spec);
		this.specs.set(spec.id, stack);
		this.refreshOpen(spec.id);
		return () => {
			const list = this.specs.get(spec.id);
			const index = list?.indexOf(spec) ?? -1;
			if (!list || index < 0) return;
			list.splice(index, 1);
			if (list.length === 0) {
				this.specs.delete(spec.id);
				this.close(spec.id);
			} else this.refreshOpen(spec.id);
		};
	}
	has(id) {
		return (this.specs.get(id)?.length ?? 0) > 0;
	}
	isOpen(id) {
		return this.windows.has(id);
	}
	open(id, params = {}) {
		const spec = this.current(id);
		if (!spec) {
			this.deps.log.warn(`window ${id} is not registered`);
			return;
		}
		const existing = this.windows.get(id);
		if (existing) {
			existing.params = params;
			if (existing.spec !== spec) existing.spec = spec;
			this.render(existing);
			this.front(existing);
			return;
		}
		const win = this.build(id, spec, params);
		this.windows.set(id, win);
		document.body.appendChild(win.root);
		this.listen();
		this.layout(win);
		this.render(win);
		this.front(win);
		win.root.focus({ preventScroll: true });
	}
	close(id) {
		const win = this.windows.get(id);
		if (!win) return;
		this.windows.delete(id);
		const index = this.order.indexOf(win);
		if (index >= 0) this.order.splice(index, 1);
		this.release(win);
		win.root.remove();
		if (this.windows.size === 0) this.unlisten();
	}
	/** Titles follow the UI language. */
	retitle() {
		for (const win of this.windows.values()) {
			const title = this.deps.i18n.t(win.spec.titleKey);
			win.title.textContent = title;
			win.root.setAttribute("aria-label", title);
			win.root.querySelector(".dramatis-window-close")?.setAttribute("title", this.deps.i18n.t("ui.close"));
		}
	}
	dispose() {
		for (const id of [...this.windows.keys()]) this.close(id);
		this.specs.clear();
		this.unlisten();
	}
	current(id) {
		const stack = this.specs.get(id);
		return stack?.[stack.length - 1];
	}
	/** The spec of an open window changed (replaced or restored): render with the current one. */
	refreshOpen(id) {
		const win = this.windows.get(id);
		const spec = this.current(id);
		if (!win || !spec || win.spec === spec) return;
		win.spec = spec;
		win.title.textContent = this.deps.i18n.t(spec.titleKey);
		this.render(win);
	}
	build(id, spec, params) {
		const t = this.deps.i18n.t.bind(this.deps.i18n);
		const title = el("div", {
			class: "dramatis-window-title",
			text: t(spec.titleKey)
		});
		const header = el("div", { class: "dramatis-window-header" }, [title, button({
			icon: "fa-xmark",
			title: t("ui.close"),
			kind: "ghost",
			className: "dramatis-window-close",
			onClick: () => this.close(id)
		})]);
		const body = el("div", {
			class: "dramatis-window-body",
			attrs: { tabindex: "-1" }
		});
		const root = el("div", {
			class: "dramatis-window dramatis-ui",
			data: { window: id },
			attrs: {
				role: "dialog",
				"aria-label": t(spec.titleKey),
				tabindex: "-1"
			}
		}, [header, body]);
		const width = Math.max(280, spec.defaultWidth ?? 420);
		root.style.setProperty("--dramatis-window-width", `${width}px`);
		const win = {
			id,
			spec,
			params,
			root,
			title,
			body,
			dispose: null
		};
		root.addEventListener("pointerdown", () => this.front(win));
		root.addEventListener("keydown", (event) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				this.close(id);
			}
		});
		this.draggable(win, header);
		return win;
	}
	render(win) {
		this.release(win);
		clear(win.body);
		try {
			const dispose = win.spec.render(win.body, win.params);
			win.dispose = typeof dispose === "function" ? dispose : null;
		} catch (error) {
			this.deps.log.error(`window ${win.id} failed to render`, error);
			win.body.appendChild(el("div", {
				class: "dramatis-error-text",
				text: this.deps.i18n.t("ui.window.failed")
			}));
		}
	}
	release(win) {
		const dispose = win.dispose;
		win.dispose = null;
		if (!dispose) return;
		try {
			dispose();
		} catch (error) {
			this.deps.log.error(`window ${win.id} cleanup failed`, error);
		}
	}
	front(win) {
		const index = this.order.indexOf(win);
		if (index >= 0) this.order.splice(index, 1);
		this.order.push(win);
		this.order.forEach((item, position) => item.root.style.zIndex = String(BASE_Z + position));
	}
	layout(win) {
		const sheet = isSheetViewport();
		win.root.classList.toggle("dramatis-window-sheet", sheet);
		if (sheet) {
			win.root.classList.remove("dramatis-window-moved");
			win.root.style.removeProperty("left");
			win.root.style.removeProperty("top");
			return;
		}
		if (win.root.classList.contains("dramatis-window-moved")) this.clamp(win);
	}
	layoutAll() {
		for (const win of this.windows.values()) this.layout(win);
	}
	clamp(win) {
		const width = globalThis.innerWidth || 1280;
		const height = globalThis.innerHeight || 800;
		const left = Math.min(Math.max(parseFloat(win.root.style.left) || 0, KEEP_VISIBLE - win.root.offsetWidth), width - KEEP_VISIBLE);
		const top = Math.min(Math.max(parseFloat(win.root.style.top) || 0, 0), height - KEEP_VISIBLE);
		win.root.style.left = `${left}px`;
		win.root.style.top = `${top}px`;
	}
	draggable(win, handle) {
		handle.addEventListener("pointerdown", (event) => {
			if (event.button !== 0 || win.root.classList.contains("dramatis-window-sheet")) return;
			if (event.target instanceof Element && event.target.closest("button")) return;
			const rect = win.root.getBoundingClientRect();
			const dx = event.clientX - rect.left;
			const dy = event.clientY - rect.top;
			win.root.classList.add("dramatis-window-moved");
			win.root.style.left = `${rect.left}px`;
			win.root.style.top = `${rect.top}px`;
			win.root.classList.add("dramatis-window-dragging");
			try {
				handle.setPointerCapture(event.pointerId);
			} catch {}
			const move = (moveEvent) => {
				win.root.style.left = `${moveEvent.clientX - dx}px`;
				win.root.style.top = `${moveEvent.clientY - dy}px`;
				this.clamp(win);
			};
			const up = () => {
				win.root.classList.remove("dramatis-window-dragging");
				handle.removeEventListener("pointermove", move);
				handle.removeEventListener("pointerup", up);
				handle.removeEventListener("pointercancel", up);
			};
			handle.addEventListener("pointermove", move);
			handle.addEventListener("pointerup", up);
			handle.addEventListener("pointercancel", up);
			event.preventDefault();
		});
	}
	listen() {
		if (this.listening) return;
		this.listening = true;
		globalThis.addEventListener?.("resize", this.onResize);
	}
	unlisten() {
		if (!this.listening) return;
		this.listening = false;
		globalThis.removeEventListener?.("resize", this.onResize);
	}
};
//#endregion
//#region src/ui/strings.ts
var UI_STRINGS = {
	en: {
		"ui.title": "Dramatis",
		"ui.close": "Close",
		"ui.confirm.yes": "Yes",
		"ui.confirm.no": "No",
		"ui.window.failed": "This part could not be shown. Details are in the browser console.",
		"ui.window.cast": "Cast",
		"ui.window.placeholder": "The cast of the scene will appear here: who is in it, what they want and how they feel about you. The engine is still being set up.",
		"ui.slash.dramatis": "Opens the Dramatis window.",
		"ui.slash.argument": "Optional argument",
		"ui.slash.off": "The /{name} command is off together with its module.",
		"ui.slash.dramatisOff": "Dramatis is disabled.",
		"ui.slash.failed": "/{name} failed: {error}",
		"ui.settings.general": "General",
		"ui.settings.basics": "Basics",
		"ui.settings.enabled": "Enable Dramatis",
		"ui.settings.debug": "Debug mode",
		"ui.settings.debugHint": "Detailed log in the browser console.",
		"ui.settings.language": "Interface language",
		"ui.settings.language.auto": "As in SillyTavern",
		"ui.settings.language.ru": "Русский",
		"ui.settings.language.en": "English",
		"ui.settings.mode": "Mode",
		"ui.settings.modeHint": "Economy runs the turn pass less often and only for characters in focus; Cinema adds a director pass before the reply.",
		"ui.settings.mode.economy": "Economy",
		"ui.settings.mode.balanced": "Balanced",
		"ui.settings.mode.cinema": "Cinema",
		"ui.settings.cardLanguage": "Motive card language",
		"ui.settings.cardLanguage.en": "English, names as in the story",
		"ui.settings.cardLanguage.ru": "Russian",
		"ui.settings.profile": "Connection profile",
		"ui.settings.profileHint": "Used for tasks without Maestro (reading the author’s intent). With Maestro, profiles are chosen in its settings.",
		"ui.settings.profile.active": "Active connection",
		"ui.settings.profile.missing": "Missing profile ({id})",
		"ui.settings.profile.noCm": "Connection Manager is off: without Maestro no AI requests are possible.",
		"ui.settings.mergeVoices": "One block with Maestro’s voice cards",
		"ui.settings.mergeVoicesHint": "Speech and motives of each character go into one insertion.",
		"ui.settings.autoArchives": "CarrotKernel archives for portraits",
		"ui.settings.autoArchivesHint": "Characters written in full get an archive with BunnyMo tags through Maestro’s «Style up».",
		"ui.settings.cardBudget": "Motive card budget, tokens",
		"ui.settings.depth": "Motive card depth in the chat",
		"ui.settings.levers": "Levers",
		"ui.settings.leversHint": "How the characters and the world behave. A chat can override any of them later.",
		"ui.lever.worldTone": "World’s tone toward the player",
		"ui.lever.worldTone.hostile": "Hostile",
		"ui.lever.worldTone.indifferent": "Indifferent",
		"ui.lever.worldTone.neutral": "Neutral",
		"ui.lever.worldTone.welcoming": "Welcoming",
		"ui.lever.playerGravity": "Player’s pull",
		"ui.lever.playerGravityHint": "How many characters pay attention to you, and how eagerly.",
		"ui.lever.playerGravity.low": "Low",
		"ui.lever.playerGravity.medium": "Medium",
		"ui.lever.playerGravity.high": "High",
		"ui.lever.inertia": "Relationship inertia",
		"ui.lever.inertiaHint": "How hard it is to move someone’s attitude with a single deed.",
		"ui.lever.inertia.high": "High",
		"ui.lever.inertia.medium": "Medium",
		"ui.lever.inertia.low": "Low",
		"ui.lever.fidelity": "Faithfulness to the author",
		"ui.lever.fidelity.strict": "Strict",
		"ui.lever.fidelity.balanced": "Balanced",
		"ui.lever.fidelity.free": "Free",
		"ui.lever.diversity": "Variety of new faces",
		"ui.lever.diversity.even": "Even",
		"ui.lever.diversity.varied": "Varied",
		"ui.lever.driftResponse": "Answer to drift",
		"ui.lever.driftResponseHint": "What to do when a reply makes a character act out of character.",
		"ui.lever.driftResponse.correct": "Correct it",
		"ui.lever.driftResponse.stress": "Count it as stress",
		"ui.lever.driftResponse.redo": "Redo the reply",
		"ui.lever.secrets": "Hidden things",
		"ui.lever.secrets.open": "Everything open",
		"ui.lever.secrets.spoiler": "Under a spoiler",
		"ui.lever.secrets.known": "Only what your character knows",
		"ui.lever.appetiteStrength": "Strength of appetites",
		"ui.lever.appetiteStrength.muted": "Muted",
		"ui.lever.appetiteStrength.author": "As the author wrote",
		"ui.lever.appetiteStrength.sharp": "Sharpened",
		"ui.lever.huntersPerScene": "Hunters after you in one scene",
		"ui.lever.huntersPerScene.0": "As the author wrote",
		"ui.lever.huntersPerScene.1": "1",
		"ui.lever.huntersPerScene.2": "2",
		"ui.lever.huntersPerScene.3": "3",
		"ui.lever.corruption": "Corruption",
		"ui.lever.corruption.off": "Off",
		"ui.lever.corruption.coarse": "Only with coarse methods or a vow",
		"ui.lever.corruption.all": "Everyone"
	},
	ru: {
		"ui.title": "Dramatis",
		"ui.close": "Закрыть",
		"ui.confirm.yes": "Да",
		"ui.confirm.no": "Нет",
		"ui.window.failed": "Не получилось показать этот раздел. Подробности — в консоли браузера.",
		"ui.window.cast": "Действующие лица",
		"ui.window.placeholder": "Здесь появятся действующие лица сцены: кто в ней, чего хочет и как относится к тебе. Движок пока только собирается.",
		"ui.slash.dramatis": "Открывает окно Dramatis.",
		"ui.slash.argument": "Необязательный параметр",
		"ui.slash.off": "Команда /{name} выключена вместе со своим модулем.",
		"ui.slash.dramatisOff": "Dramatis выключен.",
		"ui.slash.failed": "Команда /{name} не сработала: {error}",
		"ui.settings.general": "Общие",
		"ui.settings.basics": "Основное",
		"ui.settings.enabled": "Включить Dramatis",
		"ui.settings.debug": "Режим отладки",
		"ui.settings.debugHint": "Подробный журнал в консоли браузера.",
		"ui.settings.language": "Язык интерфейса",
		"ui.settings.language.auto": "Как в SillyTavern",
		"ui.settings.language.ru": "Русский",
		"ui.settings.language.en": "English",
		"ui.settings.mode": "Режим",
		"ui.settings.modeHint": "В экономном проход хода идёт реже и только для тех, кто в фокусе; «Кино» добавляет режиссёрский проход перед ответом.",
		"ui.settings.mode.economy": "Экономный",
		"ui.settings.mode.balanced": "Сбалансированный",
		"ui.settings.mode.cinema": "Кино",
		"ui.settings.cardLanguage": "Язык карточки мотивов",
		"ui.settings.cardLanguage.en": "Английский, имена как в истории",
		"ui.settings.cardLanguage.ru": "Русский",
		"ui.settings.profile": "Профиль подключения",
		"ui.settings.profileHint": "Для задач без Maestro (чтение замысла автора). С Maestro профили выбираются в его настройках.",
		"ui.settings.profile.active": "Активное подключение",
		"ui.settings.profile.missing": "Профиль не найден ({id})",
		"ui.settings.profile.noCm": "Connection Manager выключен: без Maestro запросы к ИИ невозможны.",
		"ui.settings.mergeVoices": "Один блок с голосовыми карточками Maestro",
		"ui.settings.mergeVoicesHint": "Речь и мотивы каждого персонажа идут одной вставкой.",
		"ui.settings.autoArchives": "Архивы CarrotKernel для портретов",
		"ui.settings.autoArchivesHint": "Подробно прописанные персонажи получают архив с тегами BunnyMo через «Оформить» в Maestro.",
		"ui.settings.cardBudget": "Бюджет карточки мотивов, токенов",
		"ui.settings.depth": "Глубина карточки мотивов в чате",
		"ui.settings.levers": "Рычаги",
		"ui.settings.leversHint": "Как ведут себя персонажи и мир. Любой рычаг потом можно переопределить для отдельного чата.",
		"ui.lever.worldTone": "Тон мира к игроку",
		"ui.lever.worldTone.hostile": "Враждебный",
		"ui.lever.worldTone.indifferent": "Безразличный",
		"ui.lever.worldTone.neutral": "Нейтральный",
		"ui.lever.worldTone.welcoming": "Радушный",
		"ui.lever.playerGravity": "Притяжение игрока",
		"ui.lever.playerGravityHint": "Сколько персонажей обращает на тебя внимание и насколько охотно.",
		"ui.lever.playerGravity.low": "Низкое",
		"ui.lever.playerGravity.medium": "Среднее",
		"ui.lever.playerGravity.high": "Высокое",
		"ui.lever.inertia": "Инерция отношений",
		"ui.lever.inertiaHint": "Насколько трудно сдвинуть чьё-то отношение одним поступком.",
		"ui.lever.inertia.high": "Высокая",
		"ui.lever.inertia.medium": "Средняя",
		"ui.lever.inertia.low": "Низкая",
		"ui.lever.fidelity": "Верность замыслу автора",
		"ui.lever.fidelity.strict": "Строго",
		"ui.lever.fidelity.balanced": "Сбалансированно",
		"ui.lever.fidelity.free": "Свободно",
		"ui.lever.diversity": "Разнообразие новых лиц",
		"ui.lever.diversity.even": "Ровное",
		"ui.lever.diversity.varied": "Пёстрое",
		"ui.lever.driftResponse": "Ответ на дрейф",
		"ui.lever.driftResponseHint": "Что делать, когда в ответе персонаж ведёт себя не как он сам.",
		"ui.lever.driftResponse.correct": "Поправка",
		"ui.lever.driftResponse.stress": "Стресс",
		"ui.lever.driftResponse.redo": "Переделать",
		"ui.lever.secrets": "Видимость тайного",
		"ui.lever.secrets.open": "Всё открыто",
		"ui.lever.secrets.spoiler": "Под спойлером",
		"ui.lever.secrets.known": "Только то, что знает твой персонаж",
		"ui.lever.appetiteStrength": "Сила влечений",
		"ui.lever.appetiteStrength.muted": "Приглушённая",
		"ui.lever.appetiteStrength.author": "Как у автора",
		"ui.lever.appetiteStrength.sharp": "Обострённая",
		"ui.lever.huntersPerScene": "Охотников на тебя в одной сцене",
		"ui.lever.huntersPerScene.0": "Как у автора",
		"ui.lever.huntersPerScene.1": "1",
		"ui.lever.huntersPerScene.2": "2",
		"ui.lever.huntersPerScene.3": "3",
		"ui.lever.corruption": "Разложение",
		"ui.lever.corruption.off": "Выключено",
		"ui.lever.corruption.coarse": "Только у кого есть грубые способы или обет",
		"ui.lever.corruption.all": "У всех"
	}
};
//#endregion
//#region src/ui/controls.ts
var nextId = 0;
/** Unique id for label/for pairs. */
function uid(prefix = "dramatis") {
	nextId += 1;
	return `${prefix}-${nextId}`;
}
function toggle(options) {
	const id = uid("dramatis-toggle");
	const input = el("input", { attrs: {
		type: "checkbox",
		id,
		disabled: options.disabled === true
	} });
	input.checked = options.checked;
	input.addEventListener("change", () => {
		options.onChange(input.checked);
	});
	return el("label", {
		class: "checkbox_label dramatis-toggle",
		attrs: { for: id },
		title: options.hint
	}, [input, el("span", { text: options.label })]);
}
function select(options) {
	const node = el("select", {
		class: "text_pole dramatis-select",
		attrs: {
			"aria-label": options.label,
			disabled: options.disabled === true
		}
	});
	for (const option of options.options) node.appendChild(el("option", {
		text: option.label,
		attrs: { value: option.value }
	}));
	node.value = options.options.some((option) => option.value === options.value) ? options.value : options.options[0]?.value ?? "";
	node.addEventListener("change", () => {
		const chosen = options.options.find((option) => option.value === node.value);
		if (chosen) options.onChange(chosen.value);
	});
	return node;
}
/** Number input that commits on change (not on every keystroke) and clamps to min/max. */
function numberInput(options) {
	const node = el("input", {
		class: "text_pole dramatis-number",
		attrs: {
			type: "number",
			inputmode: "numeric",
			min: options.min,
			max: options.max,
			step: options.step ?? 1,
			"aria-label": options.label,
			disabled: options.disabled === true
		}
	});
	node.value = String(options.value);
	node.addEventListener("change", () => {
		let value = Number(node.value);
		if (!Number.isFinite(value)) value = options.value;
		if (options.min !== void 0) value = Math.max(options.min, value);
		if (options.max !== void 0) value = Math.min(options.max, value);
		node.value = String(value);
		options.onChange(value);
	});
	return node;
}
/** A labelled row: label on the left (top on phones), control on the right, optional hint below. */
function field(label, control, hint) {
	return el("div", { class: "dramatis-field" }, [
		el("div", {
			class: "dramatis-field-label",
			text: label
		}),
		el("div", { class: "dramatis-field-control" }, [control]),
		hint ? el("div", {
			class: "dramatis-field-hint",
			text: hint
		}) : null
	]);
}
//#endregion
//#region src/ui/general-settings.ts
var GENERAL_SECTION_ID = "general";
/** Levers shown as selects, in the order of docs/model.md §14; hints exist for some. */
var LEVERS = [
	{ key: "worldTone" },
	{
		key: "playerGravity",
		hint: true
	},
	{
		key: "inertia",
		hint: true
	},
	{ key: "fidelity" },
	{ key: "diversity" },
	{
		key: "driftResponse",
		hint: true
	},
	{ key: "secrets" },
	{ key: "appetiteStrength" },
	{ key: "huntersPerScene" },
	{ key: "corruption" }
];
/** Connection Manager profiles (id, name); null when Connection Manager is off or missing. */
function connectionProfiles(host) {
	const ctx = host.ctx();
	const disabled = ctx.extensionSettings?.disabledExtensions;
	if (Array.isArray(disabled) && disabled.includes("connection-manager")) return null;
	const service = ctx.ConnectionManagerRequestService;
	if (!service || typeof service.getSupportedProfiles !== "function") return null;
	try {
		return service.getSupportedProfiles().filter((profile) => profile && typeof profile.id === "string").map((profile) => ({
			id: profile.id,
			name: String(profile.name ?? profile.id)
		}));
	} catch {
		return null;
	}
}
function generalSettingsSection(deps) {
	const { settings, i18n, host } = deps;
	const t = i18n.t.bind(i18n);
	function choice(key, prefix, hintKey) {
		const values = SETTINGS_CHOICES[key];
		const options = values.map((value) => ({
			value: String(value),
			label: t(`${prefix}.${String(value)}`)
		}));
		const control = select({
			value: String(settings.get()[key]),
			options,
			label: t(prefix),
			onChange: (value) => {
				const chosen = values.find((item) => String(item) === value);
				if (chosen !== void 0) settings.set(key, chosen);
			}
		});
		return field(t(prefix), control, hintKey ? t(hintKey) : void 0);
	}
	function profileRow() {
		const current = settings.get().profile;
		const list = connectionProfiles(host);
		const options = [{
			value: "",
			label: t("ui.settings.profile.active")
		}];
		for (const profile of list ?? []) options.push({
			value: profile.id,
			label: profile.name
		});
		if (current && !options.some((option) => option.value === current)) options.push({
			value: current,
			label: t("ui.settings.profile.missing", { id: current })
		});
		const control = select({
			value: current,
			options,
			label: t("ui.settings.profile"),
			disabled: list === null,
			onChange: (value) => settings.set("profile", value)
		});
		const hint = list === null ? t("ui.settings.profile.noCm") : t("ui.settings.profileHint");
		return field(t("ui.settings.profile"), control, hint);
	}
	return {
		id: GENERAL_SECTION_ID,
		titleKey: "ui.settings.general",
		order: 0,
		render(container) {
			const s = settings.get();
			container.append(el("div", { class: "dramatis-settings-group" }, [
				toggle({
					label: t("ui.settings.enabled"),
					checked: s.enabled,
					onChange: (checked) => settings.set("enabled", checked)
				}),
				toggle({
					label: t("ui.settings.debug"),
					hint: t("ui.settings.debugHint"),
					checked: s.debug,
					onChange: (checked) => settings.set("debug", checked)
				}),
				choice("uiLanguage", "ui.settings.language"),
				choice("mode", "ui.settings.mode", "ui.settings.modeHint"),
				choice("cardLanguage", "ui.settings.cardLanguage"),
				profileRow(),
				toggle({
					label: t("ui.settings.mergeVoices"),
					hint: t("ui.settings.mergeVoicesHint"),
					checked: s.mergeVoices,
					onChange: (checked) => settings.set("mergeVoices", checked)
				}),
				toggle({
					label: t("ui.settings.autoArchives"),
					hint: t("ui.settings.autoArchivesHint"),
					checked: s.autoArchives,
					onChange: (checked) => settings.set("autoArchives", checked)
				}),
				field(t("ui.settings.cardBudget"), numberInput({
					value: s.cardBudget,
					min: 50,
					max: 2e3,
					step: 10,
					label: t("ui.settings.cardBudget"),
					onChange: (value) => settings.set("cardBudget", value)
				})),
				field(t("ui.settings.depth"), numberInput({
					value: s.depth,
					min: 0,
					max: 20,
					label: t("ui.settings.depth"),
					onChange: (value) => settings.set("depth", value)
				}))
			]), el("h5", {
				class: "dramatis-settings-subtitle",
				text: t("ui.settings.levers")
			}), el("div", {
				class: "dramatis-field-hint",
				text: t("ui.settings.leversHint")
			}), el("div", { class: "dramatis-settings-group" }, LEVERS.map((lever) => choice(lever.key, `ui.lever.${lever.key}`, lever.hint ? `ui.lever.${lever.key}Hint` : void 0))));
		}
	};
}
//#endregion
//#region src/ui/index.ts
var TOAST = {
	info: "info",
	warn: "warning",
	error: "error"
};
function createUi(deps) {
	const { host, i18n, log } = deps;
	const windows = new WindowManager({
		i18n,
		log: log.scope("windows")
	});
	const drawer = new SettingsDrawer(i18n, log.scope("settings"));
	const slash = new SlashCommands(host, i18n, log.scope("slash"));
	const styles = /* @__PURE__ */ new Map();
	const popups = /* @__PURE__ */ new Set();
	let disposed = false;
	setButtonErrorHandler((error) => log.error("button action failed", error));
	return {
		notice(text, options = {}) {
			if (disposed) return;
			const notifier = globalThis.toastr;
			if (!notifier) {
				log.info(text);
				return;
			}
			const level = options.level ?? "info";
			const action = options.action;
			const toastOptions = {
				timeOut: level === "error" ? 15e3 : level === "warn" || action ? 8e3 : 5e3,
				extendedTimeOut: 5e3
			};
			let message = text;
			if (action) {
				const actionButton = el("button", {
					class: ["menu_button", "dramatis-toast-action"],
					text: action.label,
					attrs: { type: "button" }
				});
				message = el("span", { class: "dramatis-toast" }, [el("span", {
					class: "dramatis-toast-text",
					text
				}), actionButton]);
				toastOptions.escapeHtml = false;
				toastOptions.onclick = (event) => {
					const target = event?.target;
					if (!(target instanceof Element) || !target.closest(".dramatis-toast-action")) return;
					try {
						action.run();
					} catch (error) {
						log.error("notice action failed", error);
					}
				};
			}
			const show = notifier[TOAST[level]];
			show(message, i18n.t("ui.title"), toastOptions);
		},
		async confirm(title, body) {
			if (disposed) return false;
			try {
				const c = host.ctx();
				const content = el("div", { class: "dramatis-confirm dramatis-ui" }, [el("h3", {
					class: "dramatis-confirm-title",
					text: title
				}), typeof body === "string" ? el("div", {
					class: "dramatis-confirm-body",
					text: body
				}) : body]);
				const popup = new c.Popup(content, c.POPUP_TYPE.CONFIRM, "", {
					okButton: i18n.t("ui.confirm.yes"),
					cancelButton: i18n.t("ui.confirm.no"),
					leftAlign: true
				});
				popups.add(popup);
				try {
					return await popup.show() === c.POPUP_RESULT.AFFIRMATIVE;
				} finally {
					popups.delete(popup);
				}
			} catch (error) {
				log.error("confirm failed", error);
				return false;
			}
		},
		addWindow(spec) {
			if (disposed) return () => {};
			return windows.add(spec);
		},
		openWindow(id, params) {
			if (disposed) return;
			windows.open(id, params ?? {});
		},
		closeWindow(id) {
			windows.close(id);
		},
		isWindowOpen(id) {
			return windows.isOpen(id);
		},
		addSettingsSection(section) {
			if (disposed) return () => {};
			return drawer.add(section);
		},
		addSlashCommand(name, helpKey, callback) {
			if (disposed) return () => {};
			return slash.add(name, helpKey, callback);
		},
		style(id, css) {
			if (disposed || typeof document === "undefined") return () => {};
			let node = styles.get(id);
			if (!node || !node.isConnected) {
				node = el("style", { attrs: { "data-dramatis-style": id } });
				document.head.appendChild(node);
				styles.set(id, node);
			}
			node.textContent = css;
			const owned = node;
			return () => {
				if (styles.get(id) !== owned) return;
				owned.remove();
				styles.delete(id);
			};
		},
		mount() {
			drawer.mount();
		},
		relabel() {
			drawer.render();
			windows.retitle();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const popup of [...popups]) popup.completeCancelled().catch(() => void 0);
			popups.clear();
			windows.dispose();
			drawer.dispose();
			slash.dispose();
			for (const node of styles.values()) node.remove();
			styles.clear();
		}
	};
}
//#endregion
//#region src/app/api.ts
function createApiPublisher(deps) {
	const { settings, bus, log } = deps;
	const parts = [];
	const listeners = /* @__PURE__ */ new Set();
	const unsubscribers = [];
	let pending = false;
	/** The answer of the latest part defining `method`, or the fallback (also when it throws or Dramatis is off). */
	function call(method, fallback, args = []) {
		if (!settings.get().enabled) return fallback;
		for (let i = parts.length - 1; i >= 0; i--) {
			const fn = parts[i]?.[method];
			if (typeof fn !== "function") continue;
			try {
				return fn(...args) ?? fallback;
			} catch (error) {
				log.warn(`DRAMATIS_API.${method} failed`, error);
				return fallback;
			}
		}
		return fallback;
	}
	function notify() {
		if (pending) return;
		pending = true;
		queueMicrotask(() => {
			pending = false;
			for (const listener of [...listeners]) try {
				listener();
			} catch (error) {
				log.warn("DRAMATIS_API onChange listener failed", error);
			}
		});
	}
	const api = {
		version: 1,
		dramatisVersion: deps.version,
		active: () => call("active", false),
		castBlockActive: () => call("castBlockActive", false),
		dependenceOwned: () => [...call("dependenceOwned", [])],
		stances: () => [...call("stances", [])],
		goals: (name) => [...call("goals", [], [name])],
		offscreenBrief: (name) => call("offscreenBrief", null, [name]),
		matureAgendas: () => [...call("matureAgendas", [])],
		replacesSocialMechanics: () => call("replacesSocialMechanics", false),
		onChange(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
	};
	return {
		api,
		registerPart(part) {
			parts.push(part);
			notify();
			return () => {
				const index = parts.indexOf(part);
				if (index < 0) return;
				parts.splice(index, 1);
				notify();
			};
		},
		publish() {
			globalThis[DRAMATIS_API_GLOBAL] = api;
			if (!unsubscribers.length) unsubscribers.push(bus.on("state:changed", notify), bus.on("profiles:changed", notify), bus.on("chat:changed", notify), settings.onChange((key) => {
				if (key === "enabled" || key === "*") notify();
			}));
			try {
				globalThis.dispatchEvent?.(new CustomEvent(DRAMATIS_API_READY_EVENT, { detail: { version: 1 } }));
			} catch (error) {
				log.debug("could not announce DRAMATIS_API", error);
			}
		},
		unpublish() {
			const store = globalThis;
			if (store["DRAMATIS_API"] === api) delete store[DRAMATIS_API_GLOBAL];
		},
		notify,
		dispose() {
			for (const off of unsubscribers.splice(0)) off();
			parts.length = 0;
			listeners.clear();
			const store = globalThis;
			if (store["DRAMATIS_API"] === api) delete store[DRAMATIS_API_GLOBAL];
		}
	};
}
//#endregion
//#region src/app/module-manager.ts
var Modules = class {
	deps;
	entries = /* @__PURE__ */ new Map();
	apis = /* @__PURE__ */ new Map();
	app = null;
	/** startAll() ran and stopAll() has not: modules may start. */
	active = false;
	offMaestro = null;
	/** Serialises starts and stops (Maestro may come and go while modules start). */
	queue = Promise.resolve();
	constructor(deps) {
		this.deps = deps;
	}
	register(modules, registerStrings) {
		for (const module of modules) {
			if (this.entries.has(module.key)) throw new Error(`duplicate module key ${module.key}`);
			this.entries.set(module.key, {
				module,
				running: false,
				disposers: [],
				exposed: /* @__PURE__ */ new Set(),
				apiPartOff: null,
				starting: null
			});
			registerStrings(module);
		}
	}
	/** Starts every enabled module (in stage order) that can run now. */
	startAll(app) {
		this.app = app;
		this.active = true;
		this.offMaestro ??= this.deps.bus.on("maestro:changed", () => this.followMaestro());
		return this.serial(async () => {
			for (const entry of this.ordered()) if (this.canStart(entry)) await this.start(entry);
		});
	}
	/** Stops every running module (reverse stage order). */
	stopAll() {
		this.active = false;
		return this.serial(async () => {
			for (const entry of this.ordered().reverse()) await this.stop(entry);
		});
	}
	/** stopAll() and stop following Maestro (app stop). */
	async dispose() {
		this.offMaestro?.();
		this.offMaestro = null;
		await this.stopAll();
	}
	list() {
		return this.ordered().map((entry) => ({
			module: entry.module,
			enabled: this.enabled(entry),
			running: entry.running
		}));
	}
	async enable(key) {
		const entry = this.entries.get(key);
		if (!entry) return;
		this.deps.settings.setModuleEnabled(key, true);
		if (this.canStart(entry)) await this.start(entry);
	}
	async disable(key) {
		const entry = this.entries.get(key);
		if (!entry) return;
		this.deps.settings.setModuleEnabled(key, false);
		await this.stop(entry);
	}
	api(key) {
		return this.apis.get(key);
	}
	/** App-level expose (not owned by a module): an API part stays until the app stops. */
	expose(key, api) {
		if (key === "api") {
			if (api && typeof api === "object") this.deps.registerApiPart(api);
			return;
		}
		if (api === void 0) this.apis.delete(key);
		else this.apis.set(key, api);
	}
	ordered() {
		return [...this.entries.values()].sort((a, b) => a.module.stage - b.module.stage);
	}
	enabled(entry) {
		return this.deps.settings.isModuleEnabled(entry.module.key, entry.module.enabledByDefault);
	}
	canStart(entry) {
		if (!this.active || !this.app || entry.running || !this.enabled(entry)) return false;
		return !entry.module.needsMaestro || this.deps.bridge.present();
	}
	serial(job) {
		const next = this.queue.then(job, job);
		this.queue = next.catch(() => void 0);
		return next;
	}
	/** Maestro came or went: start or stop the modules that need it. */
	followMaestro() {
		return this.serial(async () => {
			const present = this.deps.bridge.present();
			for (const entry of this.ordered()) {
				if (!entry.module.needsMaestro) continue;
				if (present && this.canStart(entry)) await this.start(entry);
				else if (!present) await this.stop(entry);
			}
		});
	}
	/** The App a module sees: its `modules.expose()` is bound to the module. */
	scopedApp(app, entry) {
		const owner = {
			list: () => this.list(),
			enable: (key) => this.enable(key),
			disable: (key) => this.disable(key),
			api: (key) => this.api(key),
			expose: (key, api) => this.exposeFor(entry, key, api)
		};
		return {
			...app,
			modules: owner
		};
	}
	exposeFor(entry, key, api) {
		if (key === "api") {
			entry.apiPartOff?.();
			entry.apiPartOff = api && typeof api === "object" ? this.deps.registerApiPart(api) : null;
			return;
		}
		if (api === void 0) {
			this.apis.delete(key);
			entry.exposed.delete(key);
			return;
		}
		this.apis.set(key, api);
		entry.exposed.add(key);
	}
	start(entry) {
		const app = this.app;
		if (!app || entry.running) return Promise.resolve();
		entry.starting ??= this.init(app, entry).finally(() => {
			entry.starting = null;
		});
		return entry.starting;
	}
	async init(app, entry) {
		const log = this.deps.log.scope(entry.module.key);
		try {
			await entry.module.init({
				app: this.scopedApp(app, entry),
				settings: this.deps.settings.module(entry.module.key, entry.module.defaults),
				log,
				own: (dispose) => entry.disposers.push(dispose)
			});
			entry.running = true;
			log.debug("started");
		} catch (error) {
			log.error("init failed", error);
			await this.release(entry);
		}
	}
	async stop(entry) {
		if (entry.starting) await entry.starting;
		if (!entry.running) return;
		entry.running = false;
		try {
			await entry.module.dispose?.();
		} catch (error) {
			this.deps.log.error(`dispose of ${entry.module.key} failed`, error);
		}
		await this.release(entry);
	}
	async release(entry) {
		for (const dispose of entry.disposers.splice(0).reverse()) try {
			await dispose();
		} catch (error) {
			this.deps.log.error(`release in ${entry.module.key} failed`, error);
		}
		entry.apiPartOff?.();
		entry.apiPartOff = null;
		this.apis.delete(entry.module.key);
		for (const key of entry.exposed) this.apis.delete(key);
		entry.exposed.clear();
	}
};
//#endregion
//#region src/app/registry.ts
var MODULES = [];
//#endregion
//#region src/app/app.ts
var DRAMATIS_VERSION = version;
/** The window `/dramatis` opens; a module registers the real one (the app keeps a placeholder underneath). */
var CAST_WINDOW_ID = "cast";
async function startDramatis(options = {}) {
	const log = createLogger();
	const host = createHost(log.scope("host"));
	const settings = new Settings(() => host.ctx().extensionSettings, () => host.ctx().saveSettingsDebounced(), log.scope("settings"));
	ConsoleLogger.setLevel(settings.get().debug ? "debug" : "info");
	const i18n = createI18n(() => {
		const choice = settings.get().uiLanguage;
		if (choice === "ru" || choice === "en") return choice;
		return hostLocale(() => host.ctx().getCurrentLocale?.());
	});
	i18n.register(CORE_STRINGS);
	i18n.register(UI_STRINGS);
	const bus = createBus(log.scope("bus"));
	const files = createFileStore(host, log.scope("files"));
	const bridge = createMaestroBridge(host, bus, log.scope("maestro"));
	const readers = createReaders(host, log.scope("readers"));
	const profiles = createProfileStore({
		host,
		files,
		bus,
		log: log.scope("profiles")
	});
	const state = createStateStore({
		host,
		files,
		profiles,
		bus,
		log: log.scope("state"),
		greeting: () => readers.card.greetingIndex()
	});
	const llm = createLlmRouter({
		host,
		settings,
		bridge,
		log: log.scope("llm")
	});
	const ephemeral = createEphemeral({
		host,
		log: log.scope("ephemeral")
	});
	const turn = createTurnTracker({
		host,
		bus,
		ephemeral,
		bridge,
		log: log.scope("turn")
	});
	const ui = createUi({
		host,
		i18n,
		log: log.scope("ui")
	});
	const api = createApiPublisher({
		version: DRAMATIS_VERSION,
		settings,
		bus,
		log: log.scope("api")
	});
	const modules = new Modules({
		settings,
		bridge,
		bus,
		log: log.scope("modules"),
		registerApiPart: (part) => api.registerPart(part)
	});
	const app = {
		version: DRAMATIS_VERSION,
		host,
		log,
		i18n,
		settings,
		files,
		profiles,
		state,
		llm,
		ephemeral,
		bus,
		readers,
		maestro: bridge,
		ui,
		rng: options.rng ?? Math.random,
		modules
	};
	modules.register(MODULES, (module) => {
		if (module.i18n) i18n.register(module.i18n);
	});
	bridge.install();
	readers.install();
	state.install();
	turn.install();
	ui.mount();
	const owned = [];
	owned.push(ui.addSettingsSection(generalSettingsSection({
		settings,
		i18n,
		host
	})));
	owned.push(ui.addWindow({
		id: CAST_WINDOW_ID,
		titleKey: "ui.window.cast",
		render(container) {
			container.append(el("div", {
				class: "dramatis-placeholder",
				text: i18n.t("ui.window.placeholder")
			}));
		}
	}));
	owned.push(ui.addSlashCommand("dramatis", "ui.slash.dramatis", () => {
		ui.openWindow(CAST_WINDOW_ID);
		return "";
	}));
	owned.push(settings.onChange((key) => {
		if (key === "debug" || key === "*") ConsoleLogger.setLevel(settings.get().debug ? "debug" : "info");
		if (key === "uiLanguage" || key === "*") ui.relabel();
		if (key === "enabled" || key === "*") {
			if (settings.get().enabled) modules.startAll(app);
			else modules.stopAll();
		}
	}));
	api.publish();
	if (settings.get().enabled) await modules.startAll(app);
	const appReady = host.events.name("APP_READY");
	if (appReady) owned.push(host.events.on(appReady, () => host.events.reassertOrder()));
	log.info(`${DRAMATIS_VERSION} started${bridge.present() ? " with Maestro" : ""}`);
	return {
		app,
		settings,
		modules,
		turn,
		bridge,
		readers,
		api,
		async stop() {
			for (const off of owned.splice(0)) off();
			await modules.dispose();
			api.dispose();
			ui.dispose();
			turn.dispose();
			state.dispose();
			readers.dispose();
			bridge.dispose();
			bus.clear();
			host.dispose();
		}
	};
}
//#endregion
//#region src/index.ts
var runtime = null;
var starting = null;
/** hooks.activate */
async function onActivate() {
	if (runtime || starting) return;
	starting = startDramatis();
	try {
		runtime = await starting;
		console.info("[Dramatis] activated");
	} catch (error) {
		console.error("[Dramatis] activation failed", error);
	} finally {
		starting = null;
	}
}
/** hooks.disable: quick cleanup within ST's 5 s window (DRAMATIS_API goes away with it). */
async function onDisable() {
	const pending = starting;
	if (pending) await pending.catch(() => void 0);
	const current = runtime;
	runtime = null;
	await current?.stop();
}
/** hooks.enable */
async function onEnable() {}
/** hooks.install */
async function onInstall() {}
/** hooks.update */
async function onUpdate() {}
/** hooks.delete */
async function onDelete() {
	await onDisable();
}
/** hooks.clean: removes Dramatis settings; its user files (dramatis-*) stay until the user deletes them. */
async function onClean() {
	const current = runtime;
	await onDisable();
	if (current) {
		current.settings.reset();
		return;
	}
	try {
		const context = SillyTavern.getContext();
		delete context.extensionSettings[SETTINGS_KEY];
		context.saveSettingsDebounced();
	} catch (error) {
		console.error("[Dramatis] could not clean settings", error);
	}
}
//#endregion
export { onActivate, onClean, onDelete, onDisable, onEnable, onInstall, onUpdate };

//# sourceMappingURL=index.js.map