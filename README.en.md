# Dramatis

[Русский](README.md) · **English**

A personality engine for [SillyTavern](https://github.com/SillyTavern/SillyTavern). Characters act from **their own** goals, motives and grudges instead of orbiting the player: each has something to do right now, an aim in the scene, a stance toward you with a reason, and the events that could change them. The model writes the reply; Dramatis keeps the personalities, runs the rules and, every turn, briefly reminds the model who is busy with what and why.

|             |                                                               |
| ----------- | ------------------------------------------------------------- |
| SillyTavern | 1.19.0 or newer                                               |
| Maestro     | optional; everything "live" needs it (1.17+, 1.19+ preferred) |
| Chats       | one character or a narrator card; group chats not yet         |
| Interface   | Russian, English                                              |
| License     | AGPL-3.0                                                      |

The user guide is in Russian: [docs/guide](docs/guide/README.md). The engine's model and the reasoning behind it: [docs/model.md](docs/model.md) (Russian).

## Why

Language models are sycophantic: characters warm up for no reason, villains reform, everyone looks at the player and speaks in one voice. General rules like "the world is alive" do not help — the model needs specifics. Dramatis provides them:

- **Reasons before traits.** A stance toward you is a step from War to Ally with reasons and lifetimes: "cold: you are an imperial courier (permanent); you ruined her delivery (3 scenes)".
- **The world does not revolve around the player.** The engine computes who cares about you right now. Everyone else is busy with their own business — and the prompt says so.
- **The author's intent is sacred.** Hostility written in the card is the baseline. Only events can move it, slowly and with a cause.
- **The model proposes, the code decides.** The background model only finds events in the text; steps, dice and lifetimes are computed by code.
- **Wanting is not liking.** Appetites (drink, gambling, plunder, power…) are a separate axis: the one who is wanted does not become a friend.

## Features

**Without Maestro:**

- **Reading the author's intent.** Reads the whole card — description, greetings, creator's notes, lorebook, tags, CarrotKernel archives — into an "intent sheet": core, values, wound, goals, ties, appetites, group rules, the starting reputation, names (English, short, a Russian form for a Russian story). A field the sources have a line for carries it as a quote; what was read without one is kept and marked "from the card, no quote". The stance toward you keeps the author's full strength — hostility and unconditional devotion alike.
- **The intent sheet.** A window with the cast and a full editor: fix, lock 🔒 or remove any field; secrets stay under a spoiler. Open it from the extensions menu (the magic wand button by the input field) — **«Intent sheet (Dramatis)»**, with `/dramatis` or with the **«Open the intent sheet»** button in the Dramatis settings.
- **The motive card.** A short block near the end of the prompt: who is present, what they are doing, what they want and from whom, how they treat you and why, who is busy with their own. A character's move reads decisively, and when they started something with you, your short «wait» does not stop them — only a clear act or an out-of-character request (`((…))`, OOC) does.
- **Descriptions in Russian.** Dramatis keeps descriptions in English for the model and shows them to you in Russian in the sheet and the DES tab when the story is Russian: each line is translated once and remembered; editor fields keep the stored text with the translation under them.

**With Maestro — everything live:**

- **Turn pass.** After each reply the background model finds the events; when you send your next message, code applies them: reasons and inertia of stances, mood, intentions, attention and initiative, appetite pressure, brakes and methods, schemes, corruption, reputation and rumours. A swipe or an edit drops the draft.
- **Who left the scene.** Whoever left («Liza nodded and walked out») is off the card from the next turn, even while the DES tracker still lists them — and back when a reply shows them again or you call them. With Maestro's scene split (1.23+) absent characters with live business get one separate line, for the «Around» block only.
- **Drift control.** When a reply plays a character warmer than the engine holds them, the next card restates the stance harder — or stress builds to a break — or you get a "Redo" button.
- **Generator.** New faces get a sketch at once; those who stay get a draft and a portrait; empty fields of written characters are filled from the card's own text, with no dice, and the author's are never touched.
- **Living world.** Agendas with clocks, off-screen actions, schemes with secrecy, rumours about you per group and place.
- **Arcs.** Key events and choices under pressure move a character's arc: the lie holds → cracking → truth glimpsed → embraced or rejected. Each step arrives as a Maestro card.
- **Corruption with gifts and brands.** At 3, 5 and 7 a character is branded and decides whether to take the gift; at 7 the craving becomes part of who they are.
- **Director in Cinema mode.** Right before the reply a short request decides who acts this beat, with what intent and toward whom.
- **Measurements.** The share of NPC lines addressed to you, initiative, drift, distinguishable voices — on the "Measurements" page and with `/dramatis-stats`.
- **The workshop** (Maestro 1.21+). In the chat of a helper card tagged «мастерская» (a scenario or character creator) Dramatis stays silent altogether — no AI requests, no prompt injections, no notices — and comes back when you return to the story.
- **Chat preparation and the Character Sheet.** Maestro's chat preparation reads the intent too and shows the result with an **«Open»** link to the sheet; DES's Character Sheet / Workshop gets a **«Dramatis»** tab: how they stand toward you, what they want, what is going on now, appetites, who they are and their secrets.

## How it works

1. **Reading the intent** — once per card (automatically for a new chat or on demand). The result lives in the card's own file; the card itself is never changed.
2. **Every generation.** Before the request Dramatis builds the motive card from the stored state and injects it into the chat at depth 1 as a system message. There is no AI on the send path — except the director in Cinema mode.
3. **After a reply** (with Maestro) the background model analyses it; the draft waits until you send your next message.
4. **On send** the draft is applied: stances, moods, appetites, agendas. Every turn is a Maestro journal entry with undo.
5. **From time to time** the world ticks: important characters and factions take one action each off-screen.

With Maestro, the motive card and Maestro's voice cards merge into one block per character and the CarrotKernel injection is silenced — the model does not read the same thing three times.

## Installation

1. SillyTavern → **Extensions** → **Install extension**.
2. Paste the repository URL `https://github.com/Likerch/SillyTavern-Dramatis` and save.
3. Reload the page. The settings are in the extensions panel, block **Dramatis**.

Update with SillyTavern's extension update button. Uninstall there too; the engine's files (`dramatis-*.json`) stay in your user files until you delete them.

**Neighbours Dramatis reads** (all optional, none of their files is changed): [Maestro](https://github.com/Likerch/SillyTavern-Maestro) — the conductor of the stack; Doom's Enhancement Suite (DES) — who is in the scene, place, time, relationship labels; BunnyMo and CarrotKernel — character tags and archives; Qvink Memory — event memory.

## Settings and levers

The **Dramatis** block of the extensions panel:

- **Basics:** enable Dramatis, interface language, **mode** (Economy / Balanced / Cinema), motive card language (English with names as the story writes them, or Russian), a connection profile for work without Maestro, merging with Maestro's voice cards, CarrotKernel archives for portraits, card budget and depth.
- **Levers:** world tone toward the player, player gravity, stance inertia, fidelity to the author, diversity of new faces, drift response (correct / stress / redo), secrets visibility, appetite strength, hunters per scene, corruption.
- **Author's intent:** read the intent automatically, read it now, open the intent sheet.
- **Per-chat levers:** any lever, the mode and the card's parameters can be set for one chat only — the intent sheet window → «This chat's levers».
- **Descriptions in windows:** the language of descriptions in the sheet and the DES tab (auto — the story's language from Maestro, else the interface language; Russian; English as stored) and a «Translate now» button.
- **Living world:** how often the world ticks, whether to announce its events.

## Commands

| Command                | What it does                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `/dramatis`            | opens the intent sheet window                                                                       |
| `/dramatis-sheet Ilva` | opens a character's page                                                                            |
| `/dramatis-card`       | shows the motive card the next generation will get                                                  |
| `/dramatis-read`       | reads the author's intent again (your edits stay)                                                   |
| `/dramatis-stats`      | this chat's measurements and the "Measurements" page; `/dramatis-stats reset` starts counting again |

## Data

Everything is stored in SillyTavern's user files (`data/<user>/user/files/`):

- `dramatis-card-<hash>.json` — the card's characters: what was read from the intent, filled by the generator or edited by you;
- `dramatis-card-<hash>-ru.json` — Russian translations of the card's descriptions for the windows (up to 2000 lines);
- `dramatis-chat-<hash>-state.json` — the chat state: stances with reasons, moods, appetite pressure, agendas, reputation, the story log, measurements.

Files carry a schema version and are protected against overwriting another tab's save. Cleaning the extension removes its settings only; the files stay.

## Privacy

- Dramatis sends nothing anywhere except to your own model: requests go through Maestro's profiles or SillyTavern's Connection Manager — wherever you pointed them.
- The background model sees the last exchange and short sheets of the characters present; reading the intent sees the card's fields, its lorebook and archives; translating descriptions sees the English lines themselves and the characters' names.
- No telemetry, no analytics, no external servers. The data stays on your SillyTavern server.
- With Maestro, its treasurer counts the cost of background requests, and its daily cap applies.

## For developers

TypeScript + Vite, Vitest, ESLint/Prettier. `npm run check` runs the type check, the linter and the tests; `npm run build` builds into `dist/`. Code layers follow Maestro: `shared` → `domain` (the pure model, tested) → `host` → `core` → `adapters` → `ui` → `features` → `app`. Development plan: [docs/dev-plan.md](docs/dev-plan.md).

## License

[AGPL-3.0](LICENSE).
