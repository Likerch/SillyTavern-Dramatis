# Stack recon: what Maestro, BunnyMo, CarrotKernel and DES already model about character individuality

Recon date: 2026-10-09. Maestro 1.16.0, BunnyMo V3.0, CarrotKernel 1.0, DES 2.6.0. Refs are relative to the named repo (Maestro: `SillyTavern-Maestro/`, vendor clones: `SillyTavern-DES-RU/vendor/{BunnyMo,CarrotKernel,des}`).

## Bottom line

- **BunnyMo** models *how* a character behaves (style tags + a large prose sheet). Motives, values, fears and desires exist only as one-time prose fields of `!fullsheet`; they never reach the stored tag archive, and nothing tracks them in play.
- **CarrotKernel** is static: it re-injects archive tags; per-chat data is bookkeeping and RAG chunks.
- **DES** is the only per-turn dynamic layer: per NPC — appearance, demeanour, a relationship label from a fixed list (Lover/Friend/Ally/Enemy/Neutral), a ≤3-sentence inner monologue, optional numeric stats.
- **Maestro** stores no NPC goals, motives, agendas or initiative. Its voice cards have a "Goals" slot fed only by DES detail fields whose key looks like "goals" (absent by default) and DES quest titles naming the character → normally empty. Attitude = DES relationship label (M19 keeps its history, NPC → persona only; NPC↔NPC bonds are never produced).
- **Goals / agenda / drives / reasons / attitude-with-cause / NPC initiative are free territory.**

## BunnyMo

| Group | Tags | Covers |
|---|---|---|
| PHYSICAL | SPECIES, GENDER, AGE, BUILD, HAIR, EYECOLOR, SKIN, STYLE, FONT | body, look |
| GENRE | GENRE | story genre and pacing |
| PERSONALITY | DERE, MBTI `<XXXX-H/U>`, TRAIT (≤2), ATTACHMENT, CONFLICT, BOUNDARIES, FLIRTING, DECISION, COMFORT, VICE, LOYALTY, TRUST, MASK, ARCHETYPE | temperament and behavioural style |
| NSFW | ORIENTATION, POWER, KINK, CHEMISTRY, AROUSAL, TRAUMA, JEALOUSY | sexual/romantic psychology |
| HEALTH | BSM, CONDITION, MED/REC | mental/physical conditions |
| LING | LING | speech style |

- Trigger-bearing (pull pack text): SPECIES, DERE, GENRE, TRAIT, LING, BSM/MED/CONDITION, MBTI. The rest are informational only (read by the model and CK).
- No tag category for goals, motives, desires, fears, values, agenda or attitude toward {{user}}. No "relationship with X" tag; per-person qualifiers are dropped by CK's parser.
- Motive-like text exists only as generic per-archetype prose inside pack entries (Trait "What It Protects", MBTI "core psychological patterns").
- Entry sizes: Dere ≈1.7k chars, Trait ≈2.1k, MBTI ≈3.0k, CarrotCast genres ≈6.7k (max 20k), `!fullsheet` template 28.8k.
- Injection: pack entries keyword-triggered by the tag strings; character archive = lorebook entry keyed by name holding `<BunnymoTags>`; recursion fires pack entries. Baby Bunny writes archives at depth 2, role assistant.
- `!fullsheet`: 14 sections (Core Identity, Physical, Psyche & Behavioral Matrix, Relational Dynamics, Linguistic Signature, Origin Story, Aesthetic, Romantic Psychology, Chemistry Matrix, Trauma & Resilience, Seduction & Desire, Interpersonal Management, Hidden Depths & Secrets, Health), then TAG SYNTHESIS. Prose fields that touch our area: "Primary Motivational Drivers", "Moral Compass & Value System", "Deep Aversions", "Personal Growth Arc", "Key Relationship Bonds", "Loyalty Hierarchy", "Unresolved Threads", "Hidden Desires". Only TAG SYNTHESIS survives into the archive (prose reaches the model again only via CK RAG).
- Anti-sycophancy entries exist but are **disabled by default**: #62 "Spineless NPC Corrector", #60 "Meta Sycophancy", #63 "Anti-Hivemind". There is no "hostile characters stay hostile" text.
- Some content pushes toward softening: Dere "Don't make them abusive bullies…", MBTI-U "DON'T MAKE THEM one-dimensional tyrants", DES Knives "Do NOT make every knife paint the character as a villain", DES twist rules "make the story MORE interesting, not to punish the characters".

## CarrotKernel

- Archive: lorebook entry in a "Character Repo" book holding `<BunnymoTags><Name:…>, <GENRE:…> <PHYSICAL>…</PHYSICAL> <PERSONALITY>…</PERSONALITY> <NSFW>…</NSFW></BunnymoTags>` (+ optional `<Linguistics>` prose). Only `<K:V>` tags are parsed → MBTI `<XXXX-H>` is invisible to CK.
- "Character Consistency" injection (depth 4, system, ephemeral): "OOC MANDATORY: [CHARACTER CONTEXT - CarrotKernel Tags] {{TRIGGERED_CHARACTER_TAGS}} … Stay true to their personality traits…" plus the 10-carrot `<think>` requirement.
- All static: no mood, state or goal tracking. Tags change only via `!updatesheet` + manual edit.

## DES

- Per-NPC tracker JSON: `name, emoji, color, details{…}, relationship{status}, stats[]?, thoughts{content}`.
- `details` defaults: Appearance, Demeanor (on the user's server: «Внешность», «Поведение»).
- `relationship`: a text label from a fixed list (Lover/Friend/Ally/Enemy/Neutral; Russian labels added on the server). Not numeric. Workshop keeps a global per-name override.
- `thoughts`: first-person internal monologue, ≤3 sentences (prompt overridable).
- Injection: slot `dooms-tracker-inject` IN_CHAT depth 0 role user ("raise, lower, change, or keep the values… realistically") + previous tracker JSON as an assistant-role example.
- Storage: per message/swipe `extra.dooms_tracker_swipes`; per chat roster `chat_metadata.dooms_tracker.knownCharacters`; global name maps (aliases, relationships, appearance, knives).
- Goals/agenda: none. Closest = "Knives" (pre-written per-NPC secrets/debts/grudges fired by the Doom Counter, which is off on the user's server).

## Maestro modules on the boundary

| Module | Default | What it does here |
|---|---|---|
| M15 voices | off | Card per present character: speech (CK LING + Linguistics), MBTI, "Now" (DES demeanour), "Toward <persona>" (DES label + previous), "Unaware of" (M18), "Goals" (DES goal-like detail keys + quests naming the character). Slot `maestro_voices`, depth 1, system, cap 600 chars. Silences CK's consistency injection. No LLM. |
| M13/M14 director | on | Scene type flags `maestro_scene_*`; stall detection → director's note (depth 0) with twist sources: DES quests, living canon, chronicle, Qvink memories, promises, offscreen events, mechanics. No character motive logic. |
| M16 offscreen | on | Every 15 turns (10 in cinema) up to 3 important absent characters → LLM writes 1–3 sentence events (inputs: dossier, relationships, quests/promises, earlier events; **no goals input**). Saved to chat canon; rumours injected at depth 1 when relevant. |
| M17 calendar | on | Promises and deadlines; due ones become director twists. |
| M18 knowledge | off | Who knows what; feeds voices "Unaware of". |
| M19 relations | on | History of DES relationship labels NPC → persona only. |
| M25 mechanics | on (nothing active by default) | Templates "relationships" (hostile→devoted scale) and "social" (sympathy/trust/attraction 0–100, "trust falls fast and grows slowly") — overlap with an attitude model. |
| M12 quality | on | Judge flag `tooAgreeable` (runs only when another defect is suspected) → swipe with "Characters must not all agree with {user}; let them keep their own goals, doubts and objections." |
| M37 prepare | on, offered | New-chat extraction: characters (role, appearance, personality, speech, relations, outfit), world (setting, era, tone, laws, customs), places, **factions with goals**, items, traditions, time, promises, secrets, scenes, mechanics, direction. **No character goals**, although the canon "character" entry type has an unused `goals` field. `direction.genre/pacing/notes` are extracted but dropped. |
| M8 revision | on | Deliberately excludes intentions ("no moods of the moment, no plans that did not happen"); character development only as BunnyMo tag changes. |
| M7 dossier «Оформить» | on | The only place Maestro generates personality data: BunnyMo tags/MBTI/LING for a new NPC's CK archive. Tags only, no goals. |

## Integration surface

- Maestro publishes only `globalThis.MAESTRO_PLACES` v1 and the interceptor `MAESTRO_Intercept`; app, LLM client, bus, journal are not exposed.
- Adapters, M36 neighbour-prompt descriptors, M38 slot owners (by prefix) and M20 budget sources are closed lists.
- Precedent for our own neighbours: the neighbour publishes a versioned `globalThis.X_API` (DESRU_API, NAI_STUDIO_API with `registerSceneProvider` / `registerPassportProvider` / `registerQualityGate`, LOREBOOK_LOCALIZER_API); Maestro adds `src/adapters/<id>` that registers providers or claims functions (DES-RU function ownership: `setMaestroOwned`).
- Background LLM (`src/core/llm.ts`): Connection Manager profile per task, fallback profile, retries, circuit breaker, background cost cap, `reasoning_effort:'none'` on OpenRouter for background tasks, `json_schema` strict output, cost recorded per task. Not exposed externally — an engine would need a published Maestro API or its own client.
- All Maestro injections are ephemeral `setExtensionPrompt('maestro_<key>')`, system role, mostly depth 0–1.
