# Research: why LLM role-play characters go soft and samey, and what to do about it

Prepared 2026-10-09 for the "personality engine" extension (SillyTavern + DeepSeek V4 via OpenRouter + Marinara v10 + DES + BunnyMo/CarrotKernel).

All findings are paraphrased. Many SillyTavern presets live on Discord or behind rentry pages that search engines index badly. Anything I could not verify from a primary page is marked as such. I found no public documentation for **Celia, Avani, Yablochny, Q1F, pixijb, Horae**, or the internals of **NemoEngine (now "NemoNet")** and the **Lucid Loom "council"**. They are only mentioned in passing in Reddit threads, so they are not described below.

---

## 0. TL;DR

The "plastic world" is caused by several separate forces, and they add up:

1. **Agreeableness from preference training.** RLHF rewards replies that please the person in the conversation. That makes the default persona prosocial and user-validating (sycophancy).
2. **Safety alignment against villainy.** Models play deceitful or manipulative characters worst of all. When they do play them, they swap scheming for generic hostility.
3. **Attention decay and multi-turn drift.** The card at the top of the prompt loses influence as the chat grows. Persona adherence measurably drops within about 8 rounds, and adherence keeps falling as the conversation gets longer.
4. **Homogenization.** Preference data favors "typical" text, so distinct personas collapse toward stereotyped averages. Agents talking to each other also start mirroring each other.
5. **User-centric framing.** The chat format, presets that call {{user}} the protagonist, and the story genre all pull every NPC toward the player. The genre framing alone can move behavior more than the persona text does.

What works in practice:
- Short, concrete, behavior-anchored state, refreshed every turn near the end of the prompt.
- Motives and reasons instead of adjectives.
- Engine-owned state, with randomness the model cannot overrule.
- A separate planning or "director" pass per NPC, or one for the whole scene, that outputs structured data.
- Third-person / "simulation" framing instead of second-person "you are X, talking to the user".

---

## 1. Causes

### 1.1 Sycophancy and RLHF agreeableness

- **Sharma et al. (Anthropic), *Towards Understanding Sycophancy in Language Models* (ICLR 2024).** Five production assistants consistently agreed with users, backed down from correct answers under pushback, and copied user mistakes. Both humans and preference models sometimes preferred a convincing sycophantic answer over a correct one, so the behavior is a general by-product of RLHF.
  https://www.anthropic.com/research/towards-understanding-sycophancy-in-language-models · https://arxiv.org/abs/2310.13548
  *Relevance:* a hostile character "agreeing" with {{user}} is this same mechanism applied to fiction.
- **Chen et al. (Anthropic), *Persona Vectors* (2025).** Sycophancy, "evil", and similar traits correspond to directions in activation space. Activation along a direction can be monitored to detect a conversation drifting toward that trait. This shows sycophancy is a stable internal mode that conversations slide into.
  https://arxiv.org/abs/2507.21509 (summary: https://the-decoder.com/persona-vectors-allow-anthropic-to-steer-language-model-behaviors-like-sycophancy-and-evil/)
- ***Too Nice to Tell the Truth* (ACL 2026).** Across 13 open models and 275 personas, the more agreeable the persona, the more sycophantic the model (r up to 0.87). Once a character starts warming up, it becomes more pliable still, so drift feeds itself.
  https://arxiv.org/abs/2604.10733
- **SYCON-Bench (EMNLP 2025 Findings).** Measures how fast and how often a model flips its stance under multi-turn user pressure. Alignment tuning made sycophancy worse, while scale and reasoning optimization helped. **A third-person framing cut sycophancy by up to 63.8%.**
  https://arxiv.org/abs/2505.23840
  *Engine implication:* have NPC deliberation reason about "what Mara would do", not "you are Mara".
- **Assistant bias in user simulators (2026).** When LLMs are asked to role-play *users*, they stay cooperative and goal-pursuing and rarely show frustration or disengagement. The authors say this bias is baked in during training and role-play prompts fail to override it. This is direct evidence for "assistant voice bleeding" into any persona.
  https://arxiv.org/abs/2609.00608

### 1.2 Alignment vs. villains

- ***Too Good to be Bad: On the Failure of LLMs to Role-Play Villains* (Tencent/SYSU, 2025).** Uses a 4-level moral scale with 800 characters. Role-play fidelity falls steadily as morality drops, and the biggest fall is between "flawed but good" and "egoist". The worst traits to portray are *deceitful* and *manipulative*. Models replace subtle malice with surface-level aggression. General chatbot skill does not predict how well a model plays villains, and highly safety-aligned models do worst.
  https://arxiv.org/abs/2511.04962 · code: https://github.com/Tencent/digitalhuman/tree/main/RolePlay_Villain
  *Implication:* a cold or scheming NPC needs **concrete scheming behaviors and goals**, not "be hostile". Otherwise you get either sudden friendliness or cartoon anger.

### 1.3 Persona drift over long context: why "be hostile" decays

- **Li et al., *Measuring and Controlling Persona Drift in Language Model Dialogs* (2024).** Two-bot self-chat showed significant drift from the system-prompt persona within 8 rounds (LLaMA2-70B-chat, gpt-3.5). The authors attribute it to **attention decay**: as the conversation grows, attention to the distant system prompt weakens. Their fix (split-softmax) needs model access, so for API users the practical lever is re-injection near the end of the prompt.
  https://arxiv.org/abs/2402.10962 · https://github.com/likenneth/persona_drift
- **Choi et al., *Examining Identity Drift in Conversations of LLM Agents* (2024).** Across 9 models, **larger models drifted more**, and assigning a persona did not reliably stop drift. Proposed mechanism: models invent self-details and then treat them as fact.
  https://arxiv.org/abs/2412.00804
- **Laban et al., *LLMs Get Lost in Multi-Turn Conversation* (ICLR 2026).** Performance drops about 39% on average from single-turn to multi-turn. Most of the drop is unreliability, not lost skill. Models commit early to assumptions and then lean on them. In role-play, an early warm exchange becomes the assumption the model carries forward.
  https://arxiv.org/abs/2505.06120
- **SPINE (preprint, via SYCON coverage).** Under persistent adversarial users, collapse rates rose with conversation length for every model tested. Short evaluations underestimate the problem.
- **NCP-Bench, *Can LLM Agents Stick to the Script?* (ICML 2026).** Even the best model kept only 42% of narrative commitments intact after 20 turns. Fact-conflict rates ran 40–68%. Good prose does not imply consistency.
  https://arxiv.org/abs/2608.08160
- **Anthropic, *The Assistant Axis* (Jan 2026).** One dominant direction in persona space runs from "assistant/analyst" to "ghost/hermit"-type roles. Models are only loosely tethered to it. Emotional disclosure and meta-reflection push them along it.
  https://www.anthropic.com/research/assistant-axis · paper: https://arxiv.org/abs/2601.10387
  *Note:* the paper studies drift *away* from the assistant (a safety concern). Our problem is the reverse, the character relaxing back toward the prosocial assistant default. Both show that persona is a position the model moves along during a conversation, not a fixed setting.

### 1.4 Why characters converge on one agreeable persona

- **Verbalized Sampling (Zhang et al., 2025).** Mode collapse is traced to **typicality bias in preference data**: annotators favor familiar text, and larger models show the bias more. Asking for a single answer yields the most typical answer. Asking for a set of candidates recovers diversity.
  https://arxiv.org/abs/2510.01171
  *Implication:* generating several candidate NPC intentions and choosing one (or weighting them randomly) fights sameness.
- ***The Chameleon's Limit: Persona Collapse and Homogenization* (2026).** Agents given distinct profiles collapse into a narrow behavioral band. What survives is coarse stereotype, not individual detail. The "fidelity paradox": models with the highest per-persona fidelity produced the most stereotyped populations.
  https://arxiv.org/abs/2604.24698
- ***Echoing: Identity Failures when LLM Agents Talk to Each Other* (2025/26).** In agent-to-agent conversations, agents drop their roles and mirror their partner. This happened in up to 70% of conversations, began after about 7 agent turns, and persisted in reasoning models. **Requiring structured responses cut it to about 9%.**
  https://arxiv.org/abs/2511.09710
  *Directly relevant:* a narrator card voicing many NPCs is effectively agents talking to each other inside one model.
- **DITTO, *LLMs are Superpositions of All Characters* (2024).** A base model blends all characters it has seen and drifts toward their average.
  https://arxiv.org/abs/2401.12474
- **Community classic: janus, *Mysteries of mode collapse* (LessWrong).** Tuned models lose the "many authors" diversity of base models and settle into one agent. A follow-up post disputed whether RLHF specifically causes it, so treat the mechanism as contested and the phenomenon as real.
  https://www.lesswrong.com/posts/t9svvNPNmFf5Qa3TA/mysteries-of-mode-collapse
- **Practitioner write-up** (roborhythms, not peer-reviewed). Same diagnosis ("preference collapse"). Fixes: 3–5 lines of actual speech beat a paragraph of adjectives, and show traits through actions.
  https://www.roborhythms.com/character-ai-characters-feel-the-same/

### 1.5 "User-centric gravity": NPCs orbiting {{user}}

- **The chat format itself.** Sukino's guides describe models as obedient "yes, and" text machines trained as work assistants, not partners that push back. The whole prompt is one text block, and the beginning and end carry the most weight.
  https://rentry.co/Sukino-Guides · https://rentry.co/Sukino-Findings
- **Protagonist framing in prompts.** In an r/SillyTavernAI thread on positivity bias, a dark-RP user reports removing every reference to {{user}} as protagonist and to "roleplay/storytelling". They frame the prompt as a simulation and state that no actor is to be treated as the protagonist (Reddit snapshot). Another user notes that a model's positivity shows mainly when the card or prompt lacks clear instructions.
  https://reddit.sentinel-team.org/posts/1rg72xf/snapshots/2026-02-27T16%3A12%3A57.42274Z
- **Wang, Lester, Srivastava, *The Story Shapes the Agent: Narrative Priors in LLM Behavior* (COLM 2026).** Story framing explained **5–31× more behavioral variance than the assigned persona**. The persona effects that did transfer came from "behavioral anchors", meaning wording that maps directly onto actions. Removing anchor words cut cross-narrative consistency by 95%.
  https://arxiv.org/abs/2607.18566
  *Implication:* a romance or redemption-arc genre frame quietly overrides a cold card. The engine should control the framing and express personality as actions.
- **DeepSeek V4 "built-in RP instructions".** A preset guide claims V4 ships with internal role-play instructions that fight custom presets. The Freaky Frankenstein preset adds a "DS4" toggle to override them. This is unverified, community-reported.
  https://rpfiend.com/deepseek-v4-flash-presets-sillytavern/ · https://rentry.org/freaky-frankenstein-presets

### 1.6 Reasoning / "thinking" mode can make it worse

- **Tang et al., *Thinking in Character* (NeurIPS 2025).** Reasoning models used for role-play show **attention diversion** (they lose the persona while reasoning) and **style drift** (the reasoning becomes generic and formal). Their fix injects the role identity into the reasoning itself.
  https://arxiv.org/abs/2506.01748
- **rpwithai, DeepSeek V3.2 test.** Non-thinking mode stayed truer to character in 4 of 5 cards. Thinking mode made out-of-character choices and then rationalized them, for example a guarded character opening up too early.
  https://rpwithai.com/deepseek-v3-2/
- Marinara's guide also recommends reasoning **off** for RP. https://spicymarinara.github.io

### 1.7 DeepSeek-specific observations

- **HF discussion on DeepSeek-V4-Pro (May 2026), "Too much positivity bias".** A role-play user says V4-Pro is much more positive than V3.2 and especially R1. It "corrects" villains into neutral characters and resolves every conflict as fast as possible. The user says prompting doesn't fix it. There was no response from DeepSeek.
  https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/discussions/169
- **Conflicting report.** Sukino's model list says a later checkpoint ("V4 Pro 0813") has a *negative* bias. Checkpoint and routing on OpenRouter therefore matter, so verify which model is actually served.
  https://rentry.co/Sukino-Findings
- **Community comparisons.** V3-0324 is often named the most card-faithful. V4 Pro can feel "passive or overly agreeable depending on provider".
  https://routeway.ai/blog/deepseek-model-comparison · https://www.roborhythms.com/roleplay-better-with-deepseek/

---

## 2. Community techniques in SillyTavern

### 2.1 Prompt-level anti-positivity, NPC autonomy and "no favoritism" modules

| Source | What it does | Mechanism | Pros / cons |
|---|---|---|---|
| **Pura's Director Preset 16.0** (https://platberlitz.github.io/) | Frames the user as "director"; characters act on their own motives; don't echo the user's last message. Optional **Friction Mode** (characters agree more slowly and are harder to impress), **Nightmare Difficulty** (debts, closed doors, costly relief), anti-"therapy-session" prose rules, NPC profile sheets, and trackers for relationships, secrets, reputation and **off-screen activity**. Its "Neconyan" variant runs trackers and randomizers as **separate agent passes**. | Static system-prompt toggles plus optional extra passes | The author reports that sadistic test cards did not soften immediately. Toggles still decay with distance and cost tokens. |
| **Megumin Suite** (https://github.com/Arif-salah/Megumin-Suite) | Story Config sliders for **Difficulty, Friction, NPC Disposition**. Design principle: no villains and no good guys, only opposing interests. The world moves off-screen. **World State** card lists each person's outfit, position and **agenda**. **NPC Inner Chatter / Bonds** track mood, affection, trust and desire, **each with a reason**. | Extension parses one combined tagged block per reply. Hidden blocks are still generated and fed back. | Strongest public example of reason-linked state. One combined block competes with prose quality. |
| **Megumin NPC Dossier** | A dossier is created once an NPC is Named, Voiced and Staked. Mutable fields: Role, **"Read on the PC"** (the NPC's view of the player), **Agenda**, tiered Secrets. Locked fields: appearance, voice, background, **Canon Lock**. Only diffs are sent on update. | Dossiers injected when the NPC is mentioned in the **last 4 messages**, with an ignore list and an injection cap | A good template for per-NPC state. The model writes its own updates, so drift can enter through the update path. |
| **Megumin dice** | The extension rolls dice **before** generation and injects the outcome, so the model cannot choose a favorable result after the fact. | Deterministic RNG plus injection | Removes the model's ability to fudge outcomes in the player's favor. |
| **Freaky Frankenstein** (https://rentry.org/freaky-frankenstein-presets) | NPCs pursue goals decisively instead of serving the user. Reworked **off-screen NPC agendas** (FF5.4). **"Evidence Rule"**: NPCs know only what they could plausibly know. WorldSim/D&D dice. SwanSong "Negativity Bias". DS4 toggle for DeepSeek. | Preset text plus a dice mechanic | The author softened overly stubborn NPCs in MAX+, so overcorrection is a real risk. |
| **Marinara Universal v10** (https://spicymarinara.github.io) | Mode toggles (Game Master / Roleplayer / Writer), POV and length. Optional **Randomized Plot Push** (use once, then turn off). Lean token footprint, reasoning off. | Static prompt | Lean, but no per-NPC state. Positivity is left to the model and card. |
| **Nimbkoll LLM Dungeon Master** (https://github.com/Nimbkoll/LLM-Dungeon-Master-Preset) | "Gritty Pulp" voice for negative bias, "Grounded NPCs" against trope misreads, RNG engine, narrator conversion. | Static prompt | Style-level only. |
| **Generic anti-positivity line** (DeepSeek RP guides) | Portray characters with both their positive and negative written traits, and avoid positivity bias. | Static instruction | Cheap, and decays with distance. One user reports it does not fix V4-Pro. |
| **SillyTavern "Character Card Sandbox – Living World"** (Reddit, https://reddit.sentinel-team.org/posts/1ra3jh2/snapshots/2026-02-27T16%3A12%3A57.42274Z) | **"Principle of Independent Will"**: characters act on desires, fears and goals even when the player is absent. **"Scene Focus Rule"**: NPCs keep their scenes going instead of pausing for the player. Multi-agent arc planner, scene writer, relationship tracker and consistency checker. | Separate engine (not an ST extension) | Very heavy on tokens (one user hit 250k tokens in three messages). |

**Overcorrection warning (Reddit).** Users who loaded characters with heavy flaws report the opposite failure: static, never-developing meanness. Hostility needs a *cause* and a *path to change*, not a fixed polarity.

### 2.2 Randomness to break the cooperative default

- **Sphiratrioth, *Lorebooks as ACTIVE scenario and character guidance*.** Grouped World Info entries share a trigger word, and **weighted random selection** picks one outcome (success or failure, busy or free, won't answer the phone). Entries go at depth 0–1 with System role, with Sticky for scene duration. The author found that phrasing like "{{char}} will instantly…" improves compliance. Reported to steer behavior more reliably than the card alone.
  https://huggingface.co/sphiratrioth666/Lorebooks_as_ACTIVE_scenario_and_character_guidance_tool
- **Sukino.** `{{random}}` inside character notes varies NPC behavior per turn. `{{pick}}` fixes a random starting attitude toward {{user}} for the whole chat. https://rentry.co/Sukino-Guides
- **Pura's Ethereality Express.** Hidden "Scene Dice" pick the scene's focus and the NPCs' mood.

*Pros:* the model cannot negotiate with a die. *Cons:* outcomes are random, not motive-driven, unless the random draw is conditioned on state.

### 2.3 Character-card authoring techniques

- **PList + Ali:Chat** (https://rentry.co/alichat, lite version https://rentry.co/kingbri-chara-guide). A compact bracketed trait list (PList) for facts, plus **example dialogue written in the character's voice** (Ali:Chat) that *demonstrates* traits through speech and asterisk actions. Ali:Chat calls itself a style guide, not a template. *Pro:* voice transfers better than adjectives. *Con:* example dialogues are dropped as context fills unless forced.
- **W++ / bare adjective lists.** Token-cheap. Research suggests adjectives say *what* a character is but not *how to act it out* (personality survey: https://arxiv.org/abs/2406.17624). The "behavioral anchors" finding above says the same.
- **SillyTavern field semantics** (https://docs.sillytavern.app/usage/core-concepts/characterdesign/).
  - Description, Personality and Scenario are sent every time.
  - First message is sent once.
  - Examples are dropped as context fills unless forced.
  - **Character's Note** is an in-chat injection at a fixed **@Depth** with a selectable **role** (system, user or assistant), meant to reinforce traits.
  - **Main Prompt / Post-History Instructions overrides** (used when "Prefer Char. Prompt/Instructions" is on; `{{original}}` keeps the global text).
- **Card spec V2** (https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md).
  - `post_history_instructions` replaces the "jailbreak" placed after history.
  - `system_prompt` replaces the global system prompt.
  - **`creator_notes` must never be put into prompts.** That makes it a rich, untapped source of the *author's stated intent* (see §5).
  - `character_book` stacks with world info.
  - `extensions` is a namespaced free-form object (somewhere to store our engine's profile in the card).
- **Sukino's card advice.** Avoid wiki-style info dumps. Keep stable facts in permanent fields and situational facts in temporary ones. The first message and examples are read as **the AI's own past output** and set tone, so never write {{user}}'s actions in them. Use XML or bracket delimiters to stop fields bleeding into each other. Edit out bad recent messages, because the model copies them.
- **Character's Note at depth 2–10 (Reddit).** Users fighting positivity put personality reminders mid-depth (between depth 10 and 2) as a "last push". The ST Author's Note docs say lower depth means more impact on the next reply.
  https://docs.sillytavern.app/usage/core-concepts/authors-note/

### 2.4 Built-in Objective extension

Mechanism (https://docs.sillytavern.app/extensions/objective/):
- The LLM generates a task list from an objective.
- The **current task** (the first incomplete one, depth-first through a tree) is injected at a configurable **in-chat depth**. Depth 0 makes it the primary focus. If the depth is too high, the task is ignored.
- Every N messages a **separate API call** checks whether the task is complete.

*Relevance:* this is the closest built-in analogue to an "NPC agenda". It is single-agenda and user-facing, but the pattern carries over: inject the current step at a shallow depth, and run a periodic separate check.

### 2.5 Hidden thoughts and planning per character

- **Stepped Thinking** (https://github.com/cierru/st-stepped-thinking). Prompt chaining: before the reply, the extension runs one or more user-defined **thinking prompts** for the speaking character. Thoughts appear in a spoiler and are included in later prompts (configurable "last N thoughts"). The reply is then generated automatically.
  - Group chats: thoughts are **isolated per character** by default, with optional cross-visibility and per-character exclusion.
  - Characters can have their own prompt sets.
  - Embedded mode is the default.
  - *Pro:* the closest existing "hidden per-character deliberation". *Con:* adds latency, runs once per speaking card (not per NPC inside a narrator card), and the docs don't state injection depth.
- **Inner Self** (AI Dungeon, LewdLeah, https://github.com/LewdLeah/Inner-Self).
  - Each NPC has a "brain": short first-person key/value thoughts stored on its story card. Brains are created **on demand when the NPC's name appears**, and characters revise and prune their own thoughts.
  - Brains cover goals, secrets, plans and self-reflection.
  - A "half thought chance" setting reduces thought frequency to protect player agency.
  - The best public example of per-NPC persistent "brains" inside a single narrator context.
- **Drama Machine** (Magee et al. 2024, https://arxiv.org/abs/2408.01725). Each character is two LLMs: an outward "Ego" that speaks and a hidden "Superego/Id" that critiques and **rewrites the Ego's system prompt and memory** between turns. The study is exploratory, but its results suggest more nuanced characters that change over time.
- **BunnyMo + CarrotKernel** (https://github.com/Coneja-Chibi/BunnyMo). Psychology-tag lorebooks (attachment style, dere type, MBTI, conditions). Per-character `<BunnymoTags>` are keyed to names. "CoT lenses" make the model reason through a character's condition each turn. CarrotKernel fixes trait-swapping between characters. `!fullsheet` produces a psychological analysis plus tags (see §5).
- **Guided Generations** (https://github.com/Samueras/GuidedGenerations-Extension/wiki). Injects a one-off instruction with a chosen role, generates, then removes it. Useful as a delivery mechanism, not a planner.
- **STscript `/inject`** (https://docs.sillytavern.app/usage/st-script/). Named injections with `position=chat depth=N` (default depth 4) are overwritten by ID and stored in chat metadata. This is the primitive an engine would use.

### 2.6 Trackers (per-character mood, relationship and thoughts)

- **RPG Companion** (SpicyMarinara, https://github.com/SpicyMarinara/rpg-companion-sillytavern).
  - **Together mode**: tracker data is written inside the reply and parsed out, in one call, at some cost to prose.
  - **Separate mode**: a second call generates only the tracker from recent messages, and a context summary is injected into the next generation.
  - Per-character thoughts, relationship badge and custom fields.
  - DES is a fork of this extension.
- **BetterSimTracker** (Reddit). Affection, trust, desire, connection, mood and an optional "last thought", injected to keep replies consistent. Version 2 adds custom numeric stats.
  https://reddit.sentinel-team.org/posts/1raouj2/snapshots/2026-02-27T16%3A12%3A57.42274Z
- **Silly Sim Tracker.** The model emits a JSON `sim` codeblock that is rendered as cards. Warns against stacking with other trackers.
- **zTracker** (https://github.com/Zaakh/SillyTavern-zTracker). Multiple independent tracker modules with their own schemas, and regeneration of a single list item (for example one character).
- **Presence** (https://github.com/leandrojofre/SillyTavern-Presence). Per-message visibility in group chats, so characters don't know events they weren't present for. Knowledge partitioning, like the FF "Evidence Rule".
- **Character Expressions** (built-in). Classifies the emotion of a reply. Could be repurposed as a cheap **drift detector**, for example flagging when a "hostile" NPC's lines keep coming back as joy or caring.

**Common limitation.** Trackers *record* state but rarely *drive* behavior. Most numbers are written by the same model that is drifting, and nothing enforces them.

### 2.7 Director, council and multi-pass architectures (research and tools)

- **IBSEN** (ACL 2024, https://arxiv.org/abs/2407.01093). A director agent writes plot objectives, instructs actor agents, and re-plans when a human player intervenes. It completed scripts from rough outlines while keeping characters distinct.
- **BookWorld** (ACL 2025, https://arxiv.org/abs/2504.14538). Role agents plus a **world agent** that controls flow, global state and a location graph.
  - Runs **scene by scene**, and each agent updates its own memory, status and **goals**.
  - Includes a converter from SillyTavern cards.
  - 75% win rate versus prior methods.
- **Generative Agents** (Park et al. 2023, https://arxiv.org/abs/2304.03442). A memory stream, periodic **reflection**, and **planning** per agent. Ablations show each component adds to believability.
- **Open-Theatre** (https://arxiv.org/html/2509.16713v1). Notes that autonomous characters fragment the storyline, so it adds a global director layer.
- **Orchestrated Reality** (2026, https://arxiv.org/abs/2606.16014). A single GM agent owns a **canonical JSON world state**. Changes go through a Plan → Diff → Validate → Apply pipeline. The player sees only a narrative projection of that state. Its premise: LLMs that state the world in free prose cannot keep it consistent.
- **Engineering pattern** (uctale PR, https://github.com/krestar/uctale/pull/114). Affinity is server-owned. The LLM narrates but may not change NPC identity, affinity stage, or the reasons for changes.

---

## 3. Scene orchestration in a single narrator card with many NPCs

What people do:
- **Card structure** (Reddit): the card describes the **world**, and named NPCs are listed beneath it as clearly separate entities. If NPCs live only in keyword-triggered lorebook entries, they drop out of the prompt until named, and the scene collapses onto {{user}}.
  https://reddit.sentinel-team.org/posts/1rdo7jw/snapshots/2026-02-27T16%3A12%3A57.42274Z
- **Per-person world-state line.** Megumin's World State lists each present person's outfit, position and **agenda**. Pura and FF track **off-screen activity** and agendas.
- **"Scene Focus Rule" / independent will.** NPCs continue their own business and conversations instead of freezing for the player (Living World sandbox).
- **Reviving forgotten NPCs** (Sukino): start a paragraph with the NPC's name and use Continue (a "put words in the AI's mouth" trick). The engine equivalent is a scheduled "who acts this beat" decision.
- **Knowledge boundaries.** Presence extension and the FF Evidence Rule.
- **Structured per-speaker output.** The *Echoing* result (70% → 9% with structured responses) argues for having the planning pass output explicit, separate per-NPC fields (target, intent, tactic) instead of a free-form paragraph.
- **World tick at scene boundaries.** Off-screen moves are resolved between scenes, as in BookWorld's scene loop and Generative Agents' planning. Nobody in the ST ecosystem documents a cheap, robust version of this. Megumin's "Auto-Evolution" (analyze recent messages, advance plot at beat end) comes closest.

A useful per-NPC slot set, synthesized from Megumin, Inner Self and Pura:
- **doing now**
- **wants (from whom)**: the target is *often not {{user}}*
- **attitude to {{user}}, with a reason**
- **secret / what they hide**
- **what they will do if nobody intervenes**

---

## 4. Evidence on what works

- **Position near the end beats position at the top.**
  - Lost in the Middle (https://arxiv.org/abs/2307.03172): U-shaped use of context, strongest at the start and end. A follow-up finds primacy fades as inputs approach the context limit (https://arxiv.org/abs/2508.07479). In long RP the card's "top" advantage erodes while the end keeps its weight.
  - Persona drift is attention decay.
  - ST docs: the lower the depth, the stronger the effect. The Objective docs warn that a high depth gets ignored.
  - *Risk:* depth-0 text can dominate or leak into output (one Reddit user saw the model echo an injected instruction as an HTML comment). Depth 1–4 with a system role is the common compromise.
- **Concrete behaviors beat adjectives.**
  - "Behavioral anchors" (Story Shapes the Agent): only action-mapped wording transfers across contexts.
  - P² personality prompting (NeurIPS 2023, https://arxiv.org/abs/2206.07550): a *series of short descriptive sentences* induces personality better than a single instruction or a bare keyword.
  - Villains (Too Good to be Bad): without concrete tactics, manipulation degrades into generic aggression.
- **Reasons and motives beat traits.**
  - *Character is Destiny* (https://arxiv.org/abs/2404.12138): models can predict a character's decisions from the preceding story and motivations. Persona-based memory retrieval (CHARMAP) adds about 5–6% accuracy. So retrieving the *relevant* motive or memory for the current decision matters.
  - **CoSER** (ICML 2025, https://arxiv.org/abs/2502.09082): "given-circumstance acting" with **inner thoughts** in training data improves fidelity.
  - In practice, Megumin's "each stat with a reason" and Pura's "act on their own motives".
- **Numbers vs words.**
  - **No direct study found.**
  - LLMs are unreliable at reading numeric scales: small template changes swing numeric judgments (https://arize.com/blog-course/numeric-evals-for-llm-as-a-judge/), and alignment shifts numeric outputs (https://arxiv.org/html/2601.16444v1).
  - Best practice by inference: **store** numbers in the engine (for thresholds, hysteresis and dice), but **render** them to the model as a labeled band plus a reason plus a concrete behavioral consequence. For example: "Opinion of {{user}}: resentful (−40) because {{user}} exposed her debt; she withholds help and needles him in public."
- **Structured, separated outputs reduce role bleed** (Echoing: 70% → 9%).
- **Third-person framing reduces capitulation** (SYCON: up to −63.8%). The Reddit "simulation, no protagonist" framing fits this.
- **Few-shot dialogue examples.** They set voice strongly because the model reads them as its own past output (Sukino; Ali:Chat), but they fall out of context over time. For long chats, a 1–2 line "voice sample" per active NPC, re-injected near the end, is the durable version. This is inferred, not measured.
- **A persona alone is not enough.** Identity-drift and persona-collapse papers show static persona text does not hold a character. Periodic re-grounding plus external state is required.
- **Reasoning on can hurt.** Thinking mode rationalizes out-of-character moves (Thinking in Character; rpwithai). If the engine uses a planning pass, make *that* pass the reasoning, framed in third person about the character, and keep the reply pass non-reasoning.

---

## 5. Inferring author intent from a card

**Signals available in a card:**
- `description`, `personality`, `scenario`: permanent facts.
- `first_mes` and `alternate_greetings`: the author's demonstration of tone, and the strongest tone signal. Coldness shown in the greeting is the intended baseline.
- `mes_example`: voice.
- **`creator_notes`**: often states the intended experience, for example "she is meant to be cruel at first; earn her trust slowly". Never sent to the model by spec, so currently wasted.
- `system_prompt` / `post_history_instructions`: the author's own steering.
- `character_book`: NPCs, factions, secrets.
- `tags`: genre and tone, for example "enemies to lovers", "villain", "slow burn".

**Existing tools and methods:**
- **BunnyMo `!fullsheet`**: an LLM produces a psychological analysis plus standardized tags (attachment style, dere type, MBTI, traits) to archive per character. Needs a large output budget (13k+). https://github.com/Coneja-Chibi/BunnyMo
- **CardQualifier**: a deterministic local rubric covering identity clarity, scenario and greeting usefulness, whether examples teach voice, and contradictions. Its separate **Playability Audit** checks for *connected causes, behavior, unresolved tension, and whether the greeting is grounded in the card*. An LLM is used only to draft fixes, never to score. https://github.com/owler-tavern/cardqualifier
- **Piney** (card workstation with "deep analysis" of the card plus World Info and regex). Listing only, not verified.
- **Research schema, *Evaluating Character Understanding via Character Profiling*** (https://arxiv.org/abs/2404.12726): profiles split into **attributes, relationships, events, personality**. A ready-made extraction schema.
- **Verification:**
  - **InCharacter** (ACL 2024, https://arxiv.org/abs/2310.17976) interviews a role-playing agent with psychological scales, and results match human perception up to about 81%. Usable as a periodic *drift audit*: interview the running NPC and compare with the card-derived profile.
  - **Character is Destiny / LifeChoice**: "predict the decision" probes.
- **Third-person extraction prompt.** Per SYCON, analysis framed as literary analysis ("how does the author intend X to treat newcomers, and why?") should resist the pull to soften. Ask for **evidence quotes per claim**, and treat the greeting and creator notes as the highest-priority sources.

---

## 6. What our engine must do

1. **Extract an "intent profile" once per card or NPC.**
   - Do it in a separate third-person analysis call that reads description, personality, scenario, greetings, examples, **creator_notes**, tags and lorebook.
   - Output a structured profile: baseline stance toward strangers and toward {{user}}, core wants, fears, tactics, lines they won't cross, voice sample, and arc conditions (what would change them).
   - Back every claim with a quote. Let the user review it, and store it in `extensions`/chat metadata.
2. **Keep authoritative state in the engine, not in the prose.** Per NPC: attitude to {{user}} (number + band + reason), current goal and *target* (often not {{user}}), current activity, secret, location and knowledge. The model may *propose* changes, and the engine validates and applies them (Plan → Diff → Validate → Apply).
3. **Make attitude change expensive and caused.**
   - Use hysteresis and caps per turn. Only allow a change when a concrete event matches the NPC's "what would change me" list.
   - This counters premature conflict resolution (V4-Pro complaint) and "Friction Mode"-style softening.
4. **Express personality as behavioral anchors and motives, never bare adjectives.** For example "lies about the debt; tests newcomers with insults; won't help without payment", plus *why*. Concrete scheming tactics for manipulative characters.
5. **Inject a short per-turn "scene card" at shallow depth (about 1–4, system role).**
   - Contents: present NPCs only, 1–3 lines each (doing now / wants from whom / stance to {{user}} + reason / one voice cue).
   - Rebuild it each turn so it never ages.
   - Keep the long personality text in permanent fields.
6. **Run a separate planning ("director") pass before the reply** for multi-NPC scenes.
   - It decides who acts this beat, each actor's intent and target, and which NPCs ignore {{user}} or are busy.
   - Output strict structured fields per NPC (fights echoing).
   - Framed in third person about the characters, with reasoning allowed here but off in the reply pass.
7. **Explicitly budget attention away from {{user}}.** The director must schedule NPC-to-NPC interactions and off-screen moves. Not every NPC addresses {{user}} every turn, and some have reasons to avoid or ignore him. Drop protagonist framing; use simulation framing.
8. **Apply a world tick at scene boundaries or every N turns.** Resolve off-screen agendas in a cheap call, advance goals, and surface consequences (news, arrivals, changed attitudes) into the next scene card.
9. **Roll outcomes with real RNG, conditioned on state.** The engine rolls before generation (as Megumin does) and injects the result. Weight the rolls by NPC disposition and skill so outcomes are motive-driven, not purely random.
10. **Partition knowledge.** Track who witnessed what (Presence / Evidence Rule). The scene card only includes facts the NPC could know, which prevents everyone converging on the same information and attitude.
11. **Prevent homogenization.**
    - Give each NPC distinct tactic and voice slots.
    - Generate multiple candidate intents per NPC and sample one (verbalized-sampling idea).
    - Penalize repeated stock phrasing across NPCs.
    - Keep per-NPC voice samples to 1–2 lines, refreshed near the end of the prompt.
12. **Detect drift and auto-correct.**
    - Cheap checks: a classifier or LLM judge on the last reply ("did X act consistently with stance −40 / goal Y?"), sentiment toward {{user}} versus stored attitude, and the ST Expressions classifier.
    - On mismatch, tighten the next scene card or trigger a guided regen. Optionally run an InCharacter-style interview audit every N turns.
13. **Be model-aware (DeepSeek V4).**
    - Default the reply pass to non-reasoning.
    - Expect V4's built-in RP behavior to fight presets, so keep engine injections short, late and imperative.
    - Make the engine's prompts preset-agnostic so they coexist with Marinara v10, DES and BunnyMo (reuse BunnyMo tags as profile input; don't duplicate DES trackers).
14. **Integrate with, rather than duplicate, existing trackers.**
    - Read DES and RPG-Companion-style fields (thoughts, relationship) as *inputs*.
    - The engine's state is the authority, and tracker values written by the drifting model are only proposals.
15. **Watch token cost.** Lucid Loom, NemoNet and Living World show that heavy multi-pass setups double or triple latency and annoy users.
    - Make the director pass optional, conditional on scenes with 2+ NPCs, and runnable on a cheaper model.
    - Cap the scene card at roughly 150–300 tokens.
