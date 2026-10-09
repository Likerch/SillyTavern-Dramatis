# BunnyMo: what it already encodes about drives, vices and corruption

Recon date: 2026-10-09, BunnyMo V3.0 + packs (vendor clone in `SillyTavern-DES-RU/vendor/BunnyMo`). Entries are cited by uid.

## Headline

BunnyMo encodes the **kind** and **style** of desire and habit. It does not encode **how strong** a drive is or **what state** it is in. No tag stores intensity, current hunger/satiety or heat phase, compulsion level, escalation or corruption stage, or the method of pursuit (seduce / pressure / force). Those exist only as prose prompts in the sheet templates and in species prose. The one per-turn state machine is the Medicine Check for meds and recreational substances (core #41).

## How the tags behave

- Full-sheet template (core #2): personality `<DECISION> <COMFORT>×2 <VICE> <LOYALTY> <TRUST> <MASK>`; NSFW `<ORIENTATION> <POWER> <KINK>×4 <CHEMISTRY> <AROUSAL> <TRAUMA> <JEALOUSY>`; health `<BSM>×2 <CONDITION> <MED>×2 <REC>`.
- AROUSAL, POWER, KINK, CHEMISTRY, JEALOUSY, ORIENTATION, VICE and COMFORT have **no pack entry keyed on them**: only the model and CarrotKernel read them. Exception: `<TRAUMA:PTSD>` keys BSM uid 4.
- Master definitions are keyed on commands (`!arousal`, `<AROUSAL_PATTERNS>`), so in normal play only the bare tag reaches the model.
- Only COMFORT and VICE have closed value lists; the rest are open.

## NSFW and personality tags (all "how" / "what kind")

| Tag | Values | Gist |
|---|---|---|
| AROUSAL (#13) | Spontaneous / Responsive / Contextual / Cyclic | onset pattern; "Cyclic" is the only periodic notion; no strength scale |
| POWER (#26) | Soft/Hard/Service Dom, Brat Tamer…; Service Sub, Brat, Pet…; Switch, Vanilla Plus | role preference |
| KINK (#26) | free-form, categories Sensation / Control / Role Play / Psychological | preference; updatesheet adds STABLE / INTENSIFYING / FADING |
| CHEMISTRY (#16) | Magnetic / Strong / Moderate / Weak / Repelling (+ Explosive, Toxic) | per pair, five components incl. Physical and Sexual — the only numeric "attraction strength", and it is per pair |
| TRAUMA (#39) | Abandonment / Betrayal / Rejection / Abuse / Neglect | history and response style |
| JEALOUSY (#24) | Possessive / Competitive / Withdrawn / Investigative / Destructive / Denial | expression mode; Possessive and Destructive imply a method |
| COMFORT (#17) | TOUCH, FOOD, ISOLATION, SOCIAL, ACTIVITY, CREATIVE, SUBSTANCE, NATURE, RITUAL, ESCAPISM, NESTING, ANIMAL | coping route; SUBSTANCE = self-medication |
| VICE (#40) | SMOKING, DRINKING, CAFFEINE, EATING, SCROLLING, GAMBLING, SHOPPING, OVERWORKING, FIDGETING, THRILLS, COLLECTING | everyday indulgence, explicitly "not clinical addiction"; no sexual vice. Its "VICE DYNAMICS" (Trigger / Awareness / Control / Escalation) are prose prompts only |
| FLIRTING (#21) | Physical / Traditional / Sincere / Playful / Polite + competency 1–5 | nearest thing to a "seduction method" |

Drive-related TRAIT tags (these DO fire pack entries): ADDICTED/COMPULSIVE/DEPENDENT (60), ALCOHOLIC (42), GLUTTONOUS (51), HEDONISTIC/INDULGENT (67), EPICUREAN (45), LASCIVIOUS/LUSTFUL (20), FERAL (12), CHASTE (48).

## Species pack: instincts in prose

- 101 species cards, 2.2–3.8k chars each, position before/after character at depth 4–5; `<SPECIES:X>` in an archive fires them.
- Sections: `[🧬 BIOLOGY]` (Diet & Metabolism, Reproduction, Habitat), `[💘 REPRODUCTION & SEX]` (Baseline, Courtship, Mechanics, Arousal, Aftercare), `[⚠️ UNHEALTHY PATTERNS]`, plus some species-specific `[🩸 FEEDING MECHANICS]`, `[🌕 LUNAR INFLUENCE]`, `[🌋 CORRUPTION MECHANICS]`, `[🍖 HUNTING TACTICS]`.
- Heat/rut/seasonal cycles: Orc, Tiefling, Werewolf, Catfolk, Wolffolk, Foxfolk, Bearfolk, Fairy, Satyr, Siren, Werebeast, Lamia, Minotaur, Arachne.
- Examples: Succubus (feeding drive via sex, starvation without it), Vampire (blood mandatory, feedings bind will), Werewolf (cravings surge near lunar peaks), Orc (seasonal heat, sparring for mating rights), Demon (feeds on fear; courtship by intimidation and gradual corruption), Siren (predatory toward humans, compulsive hunting), Goblin ("successful raids earn breeding rights"), Lamia (hunger makes temper vicious).
- Coercion is consistently placed under `[⚠️ UNHEALTHY PATTERNS]` and labelled harmful, with in-world consent cues.

## Addiction

- BSM uid 25 SUBSTANCE USE DISORDER (keys `<SUBSTANCE_USE>`, `<BSM:SUBSTANCE_USE>`, `<SUD>`, `<ADDICTION:SUBSTANCE>`): tolerance, withdrawal by class, craving, triggers, denial, relapse cycle, stages. Also GAMBLING (26), KLEPTOMANIA (27), PYROMANIA (28), BINGE_EATING (21), BULIMIA (20), OCD (13), STOCKHOLM/TRAUMA_BOND (31).
- BunnyRX: `<REC:WEED/COCAINE/CRACK/HEROIN/FENTANYL/METH/NICOTINE/LEAN>` (uids 20–27) and dependence-prone meds, with WITHDRAWAL / DEPENDENCY MATH / PROGRESSION sections; libido modifiers (Prozac, Wellbutrin, Abilify, Meth, HRT).
- **Core #41 Medicine Check** (enabled, depth 4, key `/^/`): a per-turn, model-written state machine for every character carrying `<MED:>`/`<REC:>` — ON SCHEDULE / APPROACHING DOSE / MISSED DOSE / RECENTLY TAKEN / DOUBLE-DOSED / WITHDRAWAL. Overlaps with an engine-owned dependence state.
- No clinical sexual-compulsion or hypersexuality entry exists.

## Corruption

- No per-character corruption tag or tracker.
- Demon (species uid 48) `[🌋 CORRUPTION MECHANICS]`: nudge → habit → bond → rewrite — the only staged model, describing what a demon does to victims.
- CarrotCast "Erotic" genre (uid 55): "Corruption Arc", "The Addiction Spiral" — thematic prompts only.
- Updatesheet (core #6): STABLE / STRENGTHENING / WEAKENING / FADING per tag, MBTI -H ↔ -U — the only built-in change-over-time mechanism, written by the model.

## Desire vs affection; softening guards

- Separation exists in places: Chemistry splits Physical/Sexual from Emotional; Intimacy (#23) tracks dimensions at different rates; auto-trigger #51 separates "genuine interest" from "sexual conquest"; species cards treat sex as feeding or territory.
- Built-in softening/consent guards: KINK master negotiation elements; Boundaries master lists "pushing past no" as a violation; LASCIVIOUS trait ("consent is hotter"); Sadodere/Erodere "don't romanticize"; ADDICTED "[NO ROMANTICIZATION]"; species unhealthy patterns labelled harmful. The CarrotCast Erotic genre is the only unguarded entry.

## What the engine reads vs adds

- **Read:** AROUSAL, POWER/KINK, JEALOUSY, COMFORT/VICE, drive-related TRAIT tags, BSM compulsion tags, MED/REC (+ Medicine Check state), species biology and unhealthy patterns.
- **Add (missing in BunnyMo):** drive intensity, current pressure / satiety / heat phase, per-target desirability and gaze, pursuit method, restraints, schemes, rivalry, corruption stage.
