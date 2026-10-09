# Personality engine for LLM roleplay characters: a survey of borrowable models

Scope: models of individuality (goals, motives, values, fears, stance toward the player) that can be turned into data fields and update rules for a SillyTavern engine where one LLM acts and a cheap background LLM ("analyst") maintains state.
Conventions: each item gives **Mechanics** (what the source actually specifies), **Borrow** (what to lift into the engine), and **Source**. Numbers marked *(unverified)* come from memory or secondary sources and were not checked against the primary text.

---

## A. Psychology and motivation models as data schemas

### A1. Big Five / HEXACO, and why trait-only profiles are flat
**Mechanics**
- HEXACO adds Honesty-Humility (facets: Sincerity, Fairness, Greed-Avoidance, Modesty) to five factors. Agreeableness facets: Forgiveness, Gentleness, Flexibility, Patience. The split matters for characters. H-H is "will I exploit you when I could get away with it", while HEXACO-Agreeableness is "will I stay calm and forgive when you wrong me". Anger/irritability sits at low Agreeableness, not at Emotionality. Sentimentality moved to Emotionality.
- So a character can be a polite, patient schemer (high A, low H) or a blunt, irritable but scrupulously fair one (low A, high H). Big Five merges these, and that merge is one reason LLM villains collapse into "nice but grumpy".
- Why traits alone produce flat characters:
  - McAdams & Pals' "New Big Five" splits personality into three layers: (1) dispositional traits; (2) characteristic adaptations (goals, values, strategies, concerns, all context-bound); (3) an integrative life narrative. Traits are only the outline.
  - Fleeson's Whole Trait Theory: within a few weeks most people show almost every level of every trait. A trait is the *distribution* of states, and momentary goals explain a large share of state variance.
  - Mischel & Shoda's CAPS: what stays stable is a pattern of **if-then signatures** ("if teased by a superior, then goes cold; if teased by a peer, then laughs"). Average trait levels are not what stays stable.
  - A 2026 study (Chameleon) estimates ~74% of variance is within-person state and finds LLMs are "state-blind" (they answer to the trait and ignore the state).

**Borrow:** a 6-slider HEXACO core (−2..+2), plus 3–6 **if-then behavioral signatures** per character, plus goals/values in a separate layer. Generate per-scene state as a draw from the trait distribution, steered by the current goal.
**Sources:** https://www.Wikipedia.org/wiki/HEXACO · https://cehd.uchicago.edu/wp-content/uploads/2022/03/Lee-Ashton-Psychometric-Properties-HO_2022-03-27a_lds.pdf · https://cee.nd.edu/news/documents/McAdamsSummary.pdf · https://en.wikipedia.org/wiki/Whole_Trait_Theory · https://en.wikipedia.org/wiki/Cognitive-affective_personality_system · https://arxiv.org/abs/2601.15395

### A2. Schwartz basic human values (circumplex)
**Mechanics**
- 10 values on a circle (19 in the refined theory): Self-Direction, Stimulation, Hedonism, Achievement, Power, Security, Conformity, Tradition, Benevolence, Universalism.
- Adjacent values are compatible and opposite values conflict. Two axes: Openness-to-change vs Conservation, and Self-Enhancement vs Self-Transcendence. Power vs Universalism and Tradition vs Hedonism are near-universal conflicts.
- What defines a person is the *priority order* of the values, since everyone holds all of them. People pursue conflicting values in different acts, at different times and in different settings, never in one act.

**Borrow:** store a ranked top-3 and a bottom-1 ("what they will sacrifice"). Use circle distance to (a) auto-generate inner conflict when a scene pits two high values against each other, and (b) seed friction between characters whose top values sit opposite each other.
**Source:** https://scholarworks.gvsu.edu/orpc/vol2/iss1/11/ · https://i2insights.org/2022/05/10/schwartz-theory-of-basic-values/amp/

### A3. Reiss 16 basic desires
**Mechanics**
- The 16 desires: Power, Independence, Curiosity, Acceptance, Order, Saving, Honor, Idealism, Social contact, Family, Status, Vengeance, Romance, Eating, Physical activity, Tranquility.
- Each is rated high / average / low. Individuality comes from the combination of extremes. Average desires have little effect on behaviour.
- Reiss claims people with similar profiles bond and people with clashing profiles separate.

**Borrow:** a cheap motive vector. Store only the 2–4 *high* and 1–3 *low* desires. They read as concrete wants (Vengeance-high, Tranquility-low), which fits prompt text better than abstract values. Profile similarity can serve as a default affinity seed between NPCs.
**Source:** https://news.osu.edu/new-theory-of-motivation-lists-16-basic-desires-that-guide-us/

### A4. Maslow, as a priority layer (with corrections)
**Mechanics**
- The classic pyramid orders needs: physiological, safety, belonging, esteem, self-actualization.
- Tay & Diener (Gallup data, 123 countries) found needs are universal but the order in which they are met did not matter for well-being.
- Kenrick et al.'s "renovated pyramid" keeps the levels but makes them **overlapping and re-activatable by cues** (a threat cue brings safety back to the top).

**Borrow:** do not hard-gate higher goals behind lower ones. Use the levels as an *urgency override*: a salient threat to safety or physical needs temporarily multiplies the weight of those goals, and the weight decays once the cue is gone.
**Sources:** https://pmc.ncbi.nlm.nih.gov/articles/PMC3161123/ · https://news.illinois.edu/researchers-look-for-ingredients-of-happiness-around-the-world/

### A5. Self-Determination Theory (autonomy, competence, relatedness)
**Mechanics**
- Only three needs qualify, because frustrating any of them predicts ill-being:
  - Autonomy: acting from endorsed choice, which is not the same as having no rules.
  - Competence: feeling effective.
  - Relatedness: being cared for *and* contributing to others.
- A need can be satisfied or frustrated. Frustration produces defensive or controlling behaviour.

**Borrow:** three meters (0–10) that any scene can satisfy or frustrate, for example "player ordered me around" lowers autonomy. They are the generic bridge from "what happened" to "why I am now prickly". They also tell the actor *what the character wants from the player* in the moment: respect for their choices, acknowledgement of their skill, or closeness.
**Source:** https://selfdeterminationtheory.org/topics/application-basic-psychological-needs/

### A6. Appraisal theory: the OCC model (key for "why does the character react")
**Mechanics**
- OCC has 22 emotion types arising from three appraisal targets:
  - consequences of **events**, judged against **goals** (desirability);
  - **actions of agents**, judged against **standards** (praiseworthiness);
  - **aspects of objects**, judged against **attitudes** (appealingness).
- Event emotions split into:
  - self-prospect: hope/fear, then satisfaction / fears-confirmed / relief / disappointment;
  - fortunes of others: happy-for, resentment, gloating, pity, chosen by whether the other is liked or disliked;
  - joy/distress.
- Agent emotions: pride, shame, admiration, reproach. Compounds: gratitude and anger (an action by agent X that blocked my goal), gratification and remorse. Object emotions: love and hate.
- Intensity variables include desirability, likelihood, effort, praiseworthiness, unexpectedness and arousal. Each emotion has a threshold.

**Borrow:** this is the core of the "reason" layer. For each event the analyst outputs `{emotion, intensity 1-5, target, cause, which goal/standard}`. A character with no goal touched by an event feels nothing about it. That is what stops characters from orbiting the player: the player's actions only matter emotionally insofar as they touch *this* character's goals and standards.
**Sources:** https://users.cs.northwestern.edu/~ortony/Andrew_Ortony_files/2013%20-%20OCC%20and%20constructionism.pdf · https://cdn.aaai.org/AAAI/2007/AAAI07-021.pdf

### A7. Lazarus' cognitive-motivational-relational theory, and EMA (its computational descendant)
**Mechanics**
- Primary appraisal asks whether the event is goal-relevant, whether it is goal-congruent, and what kind of ego involvement it carries. If the event is irrelevant, appraisal stops there.
- Secondary appraisal covers blame/credit, coping potential (what control do I have) and future expectancy.
- Each emotion has a "core relational theme". For example, anger is a demeaning offence against me or mine, anxiety is an uncertain existential threat, and guilt is having transgressed a moral imperative.
- EMA (Marsella & Gratch) implements this on top of a BDI/planning representation. Coping is either **problem-focused** (act on the world: plan, seek help) or **emotion-focused** (act on beliefs and intentions: reinterpret, deny, shift blame, give up the goal). Re-appraisal loops produce emotions that unfold over time.

**Borrow:**
- A two-stage gate for the cheap analyst. Stage 1 is the relevance check (one line). Only if the event is relevant, run stage 2: who is to blame, what control do I have, and what will I do about it.
- Per character, store a **preferred coping style** ("attacks the problem", "shifts blame", "withdraws", "denies"). It is a strong personality signature.

**Sources:** https://en.wikipedia.org/wiki/Core_relational_theme · https://www.khoury.northeastern.edu/home/marsella/publications/abstracts/MarsellaCSR09-abstract.html

### A8. PAD mood model, and ALMA (emotion → mood → personality)
**Mechanics**
- Mood is a point in Pleasure / Arousal / Dominance space (each −1..+1). The eight octants are named Exuberant, Dependent, Relaxed, Docile, Hostile, Anxious, Disdainful, Bored.
- ALMA (Gebhard 2005):
  - Default mood comes from Big Five via Mehrabian's formulas (S = emotional stability):
    - P = 0.21E + 0.59A + 0.19S
    - A = 0.15O + 0.30A − 0.57S
    - D = 0.25O + 0.17C + 0.60E − 0.32A
  - Each OCC emotion maps to a PAD point. Anger, for example, is roughly (−0.51, +0.59, +0.25), in the Hostile octant.
  - The active emotions form a "virtual emotion centre". Mood is *pulled* toward it, and once past it is *pushed* deeper into the same octant, so repeated same-direction experiences intensify the mood.
  - Emotions decay (linearly, over about 20 s in the demo). Mood drifts back to default; the configured return time is 20 minutes and the usual mood-change time 10 minutes.

**Borrow:**
- Keep one PAD mood per character, with a default derived from the core (or authored directly: a hostile character's baseline sits in −P +D).
- Update it per turn with pull/push and decay toward baseline *per scene* rather than per minute.
- The octant name doubles as a one-word mood tag for the prompt.
- Authoring the *default* mood is the cleanest way to preserve the author's intended hostility, because the character always relaxes back to it.

**Sources:** https://alma.dfki.de/ · https://cs.huji.ac.il/course/2005/aisemin/articles2006/docs/pa1a3_29.pdf · https://www.cs.uky.edu/~sgware/reading/papers/mehrabian1996analysis.pdf

### A9. BDI (Beliefs-Desires-Intentions)
**Mechanics**
- Desires are many and may conflict. Intentions are the few desires the agent has *committed* to, with a partial plan.
- Intentions act as a **filter of admissibility** (Bratman): options that conflict with current intentions are not even considered. This is what makes agents stable and purposeful.
- Commitment strategies *(from memory: Rao & Georgeff 1991)*:
  - blind: keep until believed achieved;
  - single-minded: keep until achieved or believed impossible;
  - open-minded: keep while still desired.
- Intention reconsideration is costly. Kinny & Georgeff found that "bold" agents, which rarely reconsider, win in stable worlds, while "cautious" agents win in fast-changing ones.

**Borrow:**
- Separate `desires[]` (many, weighted) from `intentions[]` (1–2 committed, each with a next step and drop conditions).
- Make the commitment strategy a *personality parameter*: a stubborn character is single-minded, a fickle one open-minded.
- The analyst reconsiders intentions only on triggers (goal achieved, goal impossible, strong new opportunity, value violation). Otherwise the character keeps pursuing its own agenda even when the player waves something shiny.

**Sources:** https://apice.unibo.it/xwiki/bin/view/Publication/BdiIcmas95 · https://eprints.nottingham.ac.uk/65903/1/Thesis.pdf

### A10. Attachment (adult, two-dimensional)
**Mechanics**
- Two continuous axes:
  - **Anxiety** (fear of rejection or abandonment; the model of self);
  - **Avoidance** (discomfort with closeness or dependence; the model of others).
- The quadrants are Secure (low/low), Preoccupied (high anxiety, low avoidance), Dismissing-avoidant (low anxiety, high avoidance) and Fearful-avoidant (high/high). The categories are prototypes, so prefer the dimensions.

**Borrow:** two numbers that drive *how warmth is received*. A dismissing character answers player kindness with distance. A preoccupied one tests and clings. A fearful one approaches then punishes. This is the right place to encode "hard to befriend" without making the character hostile.
**Source:** https://labs.psychology.illinois.edu/~rcfraley/measures/newmeasures.html · https://ecampusontario.pressbooks.pub/psychologydevelopmental/chapter/7-10-attachment-in-young-adulthood/

### A11. "Core wound / lie": the clinical analogue is maladaptive schemas
**Mechanics**
- "Ghost/wound/lie" is a craft term (see B1), not a psychology construct. The closest clinical analogue is Young's **18 early maladaptive schemas** in 5 domains, each tied to an unmet childhood need. Examples: Abandonment, Mistrust/Abuse, Defectiveness/Shame, Subjugation, Unrelenting Standards, Entitlement, Punitiveness.
- Schema therapy describes three coping responses when a schema is triggered *(from memory)*: **surrender** (act as if it is true), **avoidance** (steer away from triggers) and **overcompensation** (do the opposite, often aggressively).

**Borrow:** `wound = {schema, origin event (ghost), trigger cues[], coping: surrender|avoid|overcompensate}`. When the analyst detects a trigger cue in the scene, it injects "the old wound is touched; this character will <coping>". This gives *motivated* irrationality instead of random mood swings.
**Source:** https://en.wikipedia.org/wiki/Schema_therapy · https://schematherapysociety.org/Schema-Therapy

---

## B. Fiction-writing craft models

### B1. K.M. Weiland: Want vs Need, the Lie, the Ghost
**Mechanics**
- The **Ghost** is a past event. It created the **Lie**, a false belief that fills the hole left by the Ghost.
- The **Want** is the concrete goal through which the Lie is acted out. It may look positive, but its motivation is Lie-based.
- The **Need** is the Truth that would disprove the Lie.
- An arc is the character's Lie being pressured until they take the Need over the Want, or refuse it (a flat or negative arc).

**Borrow:** `ghost`, `lie`, `want`, `need`, plus an `arc_stage` (lie intact / cracking / truth glimpsed / embraced / rejected) that the analyst moves only on strong evidence. For NPCs whose arc is *not* supposed to change (villains), lock `arc_stage`. Their Want then stays the engine of autonomous action.
**Sources:** https://www.helpingwritersbecomeauthors.com/character-arcs-3/ · https://www.helpingwritersbecomeauthors.com/character-arcs-4/

### B2. Debra Dixon: GMC (Goal, Motivation, Conflict)
**Mechanics**
- For each of goal, motivation and conflict there is an **external** version (concrete, binary, either achieved or not) and an **internal** one (emotional). Ideally the two goals are at odds.
- Sentence test: "X wants GOAL *because* MOTIVATION, *but* CONFLICT."

**Borrow:** the minimum viable agenda for any NPC is one GMC sentence each for external and internal. It is cheap enough to auto-generate for minor NPCs and serves as the analyst's check: "is this NPC currently acting on its G, given its M, against its C?"
**Sources:** https://plottr.com/goal-motivation-conflict/ · https://www.novlr.org/the-reading-room/how-to-create-a-compelling-character-in-minutes

### B3. McKee: true character is revealed by choice under pressure
**Mechanics:** McKee separates *characterization* (all the observable surface: age, speech, job, style) from *true character*, which shows only in choices made under pressure. The higher the stakes, the deeper the reveal.
**Borrow:** the analyst should create **dilemma moments**, where a character's two high values or a value and a want collide in a costly way, rather than descriptive flavour. Store revealed choices as canonical memories ("chose the mission over his brother"), and treat them as stronger evidence of personality than any trait text.
**Source:** https://writersstore.com/blogs/news/structure-and-character-excerpted-with-permission-from-the-book-story-part-one

### B4. Egri: tridimensional character
**Mechanics:** physiology (body, health, appearance), sociology (class, upbringing, occupation, religion, politics) and psychology (morals, ambition, temperament, frustrations). Psychology is treated as the product of the other two. These facts should show through behaviour, not exposition.
**Borrow:** a checklist for the *static background* block. It is mainly useful because physiology and sociology produce concrete **constraints and resources** (a limp, debts, a guild rank) that shape which goals are feasible.
**Source:** https://neiloseman.com/the-art-of-dramatic-writing-by-lajos-egri/

### B5. Dramatica
**Mechanics**
- Four throughlines: Overall Story (they), Main Character (I), Influence Character (you, the one who challenges the main character's worldview, not necessarily the villain) and Relationship Story (we).
- Characters are built from quads of elements across four dimensions: **Motivation** (what drives), **Methodology** (how), **Evaluation** (how progress is measured) and **Purpose** (direction).

**Borrow:**
- Give important NPCs an explicit role *relative to the player*: obstacle, ally, influence (worldview challenger), or relationship partner.
- The Method and Evaluation fields are useful: two NPCs with the same goal but a different method are naturally distinct.

**Source:** https://dramatica.com/questions/can-you-provide-a-definition-of-the-four-throughlines · https://www.storymind.com/dramatica/dramatica_theory_book/chapter_09.html

### B6. Scene agenda: Swain's scene and sequel
**Mechanics**
- A scene is **Goal → Conflict → Disaster**: what the viewpoint character wants this scene, what opposes it, and the setback.
- A sequel is **Reaction → Dilemma → Decision**, and the decision becomes the next scene's goal.

**Borrow:** this is the per-scene loop for every present NPC. At scene start, each NPC gets a `scene_goal` (derived from its intentions) and an `obstacle`. At scene end, the analyst runs a sequel step (reaction emotion, dilemma, decision) that sets the next intention. Giving *every* character in the room a scene goal is the most direct fix for "everyone waits for the player".
**Source:** https://en.wikipedia.org/wiki/Scene_and_sequel

### B7. John Truby: weakness/need and the moral argument
**Mechanics**
- The seven key steps are weakness and need, desire, opponent, plan, battle, self-revelation, new equilibrium.
- *(From the book, unverified here)* Truby distinguishes a **psychological** weakness, which hurts only the character, from a **moral** weakness, which hurts others.
- The best opponent wants the same thing, or the hero's mirror.
- The **moral argument** is carried by how the character's actions toward others change over the story.

**Borrow:** a `moral_weakness` field ("uses people as tools when afraid") is what makes an NPC act *on others*, including the player, in characteristic ways. Tag rivals as "competing for the same goal" rather than "evil".
**Source:** https://berniegourley.com/2019/04/30/book-review-the-anatomy-of-story-by-john-truby/ · https://www.arcstudiopro.com/blog/22-building-blocks-john-truby

### B8. Brandon Sanderson's sliding scales
**Mechanics:** three independent sliders: **Proactivity** (pursues goals vs reacts), **Likability/Sympathy** and **Competence**. Most engaging characters are high on two and low on one. Villains and antiheroes are typically high proactivity and competence with low likability. The model is diagnostic, not a creation method.
**Borrow:**
- Store `proactivity 0–10` per NPC as a *hard input* to the turn loop. It sets how often the NPC initiates (turns their scene goal into an unprompted action) versus responds.
- Raising proactivity on antagonists is exactly the "do not orbit the player" lever.
- Do not let likability drift up by default; LLMs inflate it (see D7).

**Source:** https://maryrobinettekowal.com/journal/writing-excuses-9-13-three-pronged-character-development/ · https://brandonsanderson.com/blogs/blog/creating-proactive-relatable-and-capable-characters-brandon-sandersons-writing-lecture-5-2025

### B9. "Every NPC is the hero of their own story" (GM practice)
**Mechanics**
- Consistent advice: every NPC needs a concrete want, a reason, a stake, and an answer to **"what happens if the PCs ignore them"**.
- The OGAS mnemonic: Occupation, Goal, Attitude, Stake, where stake is how hard they push.
- Leverage (what the PCs can offer or threaten) determines negotiability.
- Avoid NPCs who exist to steer players back to the GM's plan.

**Borrow:**
- `stake` (how much effort or risk the NPC will spend) and `if_ignored` (what the NPC does off-screen), as required fields.
- `leverage_on_me[]` gives the player legitimate routes to change a hostile NPC, as opposed to the LLM caving to charm.

**Source:** https://www.tribality.com/?p=28303 · https://rancourt.substack.com/p/synthesizing-good-npc-advice

### B10. Apocalypse World / Dungeon World fronts
**Mechanics**
- A front groups 2–3 dangers. Each danger has a type, an **impulse** (its drive), **grim portents** (an ordered list of escalation steps that happen unless someone intervenes) and an **impending doom**. Stakes questions are written as "Will X…?".
- Countdown clocks give threats their own momentum, so the GM is not deciding by whim.
- The MC agenda forbids railroading. Threats act according to their impulse, not the plot.
- Advice: at most three fronts; when unsure, advance a danger toward its next portent.

**Borrow:** each important NPC or faction has `impulse` + `portents[]` + `doom`. The analyst advances one portent when its clock fills or when the player ignores the thread. That is how the world moves without the player.
**Sources:** https://roll20.net/compendium/dw/Fronts · https://necropraxis.com/?p=6210

### B11. Blades in the Dark: factions, status, clocks
**Mechanics**
- Faction **status −3..+3**, with explicit behavioural meaning:
  - +3 Allies: help even against their own interest.
  - +2 Friendly: help unless it causes serious problems for them.
  - +1 Helpful: help if it costs little.
  - 0 Neutral.
  - −1 Interfering: cause trouble when it is cheap.
  - −2 Hostile: seek to hurt you without serious risk.
  - −3 War: go out of their way to hurt you.
- Status moves ±1–2 per significant act.
- Tier and hold describe power. Faction projects run on segmented **progress clocks** advanced in downtime.

**Borrow:** use this exact 7-step stance ladder for each NPC's *stance toward the player*. The behavioural definitions are prompt-ready, and the small step size is a built-in hysteresis that stops a hostile NPC flipping to friendly in one turn. Add clocks for NPC projects.
**Source:** https://bladesinthedark.com/faction-game

### B12. The Alexandrian: Universal NPC Template; "Don't prep plots"
**Mechanics**
- NPC sheet: Appearance (1–2 sentences), Roleplaying (about three *distinct* bullets: values, mannerism, speech), Background (key concepts bolded), Key Info (the NPC's function).
- Experimental sections: **Actions** (proactive moves the NPC will attempt), **Reactions** and **Resources**.
- "Don't prep plots, prep situations": prepare tools such as actors, wants and resources, not outcome sequences.

**Borrow:** keep the actor-facing card small (three distinct roleplaying bullets). Put "Actions: things this NPC will try unprompted" on it, because that list is what makes an NPC proactive in play.
**Sources:** https://thealexandrian.net/wordpress/37916/roleplaying-games/universal-npc-roleplaying-template · https://thealexandrian.net/wordpress/46250/roleplaying-games/advanced-npc-templates · https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots

### B13. Faction turns (Stars/Worlds Without Number)
**Mechanics**
- Factions have stats (Force/Cunning/Wealth, plus HP and income) and a **goal** (for example "don't attack for four turns", expansion or conquest), and own assets.
- On each faction turn a faction takes one action type (attack, move, repair, expand influence, create asset, hide, sell) across its assets.
- Completing a goal grants advancement.

**Borrow:** a periodic, cheap "faction/NPC turn" run every N chat turns or at scene change. Each off-screen actor picks one action toward its goal and the result goes into world state and rumours.
**Source:** https://glyphngrok.substack.com/p/creating-factions-in-an-open-world

### B14. NPC behaviour oracles (solo-RPG tables)
**Mechanics** *(details unverified)*
- Solo tools (Mythic GME, Juice Oracle) give NPCs a disposition (passive or active) and roll on an NPC-action table. Results look like "continues current activity", "acts in own interest", "acts in PC's interest", "changes topic", "takes/gives something", "causes harm".
- Context ("activity in the current scene") shifts the roll.

**Borrow:** a randomized "next move type" sampled from a disposition-weighted distribution. Feed it to the actor as a constraint ("this turn: acts in own interest"). It is a cheap anti-sycophancy injection that breaks the LLM habit of always cooperating.
**Source:** https://thunder9861.itch.io/juice-oracle/devlog/838352/v10-pocketfold-released

---

## C. Game AI implementations of personality and living worlds

### C1. Dwarf Fortress
**Mechanics**
- **50 facets**, each 0–100. The 40–60 band is neutral and unreported.
- **33 values/beliefs** (LAW, LOYALTY, FAMILY, POWER, TRUTH, HARMONY, KNOWLEDGE…), each −50..+50.
- **Goals/dreams** (13: start a family, rule the world, craft a masterwork, become a legendary warrior, bathe the world in chaos…). Realizing one gives a strong happy thought.
- **Needs** come from facets and values, at levels 1/2/5/10. A need resets to 400 when satisfied and decays without limit when unmet. The aggregate of all needs sets **focus**, which ranges from −50% to +50% effective skill.
- Facets also drive crisis behaviour (high anger propensity leads to tantrums; stress vulnerability to catatonia). Facets that differ by more than 20 points can create grudges.

**Borrow:**
- The *neutral band* idea: only report extremes to the prompt.
- Needs derived from personality instead of authored separately.
- One "dream" per character as the slowest-changing goal.

**Sources:** https://dwarffortresswiki.org/index.php/Personality_trait · https://dwarffortresswiki.org/index.php/DF2014:Personality_value · https://dwarffortresswiki.org/index.php/DF2014:Personality_goal · https://dwarffortresswiki.org/index.php/Need

### C2. Crusader Kings 3
**Mechanics**
- Personality traits set **AI value weights**: boldness, compassion, energy, greed, honor, rationality, sociability, vengefulness, zeal. Examples: Brave +200 boldness, Just +200 honor, Vengeful +200 vengefulness, Forgiving −200 vengefulness. Each trait has opposites.
- **Opinion** is a sum of modifiers, many of them time-limited (Broke Truce −50 for 3 years; Attacked an Ally −25 for 3 years). Most decay to 0. A shared trait gives about +10 opinion and an opposite trait about −10.
- **Stress**: acting *against your traits* raises stress (a Compassionate ruler executing a prisoner gains about 42). Crossing a stress level triggers a personality-specific **mental break**, which lets the character dump stress, often in exchange for a lasting coping trait.

**Borrow:**
- Opinion modelled as a list of `{reason, value, expires}` modifiers rather than a single number. It is explainable ("still angry because you lied at the inn") and decays naturally.
- **Stress for acting against one's values.** When the actor makes the character behave out of character (for example a villain being nice to the player), stress accrues and eventually triggers a characteristic snap. This penalizes and also *dramatizes* drift.

**Sources:** https://ck3.paradoxwikis.com/Traits · https://ck3.paradoxwikis.com/Opinion · https://forum.paradoxplaza.com/forum/threads/ck3-dev-diary-31-a-stressful-situation.1399764/

### C3. RimWorld
**Mechanics**
- Mood (0–100%) is the baseline plus the sum of active **thoughts**. Each thought has a mood value, a **duration**, a **stack limit** and a **stack multiplier** for repeats; for example social memories last 20 days, stack to 10, ×0.9 each.
- The mood bar moves toward its target at a capped rate.
- Break thresholds sit at about 35% (minor), 20% (major) and 5% (extreme), shifted by traits. High mood can roll an **inspiration**.
- **Opinion** (−100..+100) comes from interactions: chitchat about +10, deep talk +15, slight −5, insult −15. Low opinion multiplies the chance of insults (6× at −100), which feeds back into fights.

**Borrow:**
- Thought objects with duration and diminishing stacking, so the player cannot farm affection by repeating compliments.
- A rate-limited mood bar.
- Negative opinion that raises the *probability of hostile initiatives*, a feedback loop that keeps antagonism alive.

**Sources:** https://rimworldwiki.com/wiki/Mood · https://rimworldwiki.com/wiki/Mental_break · https://rimworldwiki.com/wiki/Social · https://rimworldwiki.com/wiki/Inspiration

### C4. The Sims: needs plus utility, with "smart objects"
**Mechanics**
- Motives run −100..+100 (hunger, energy, social, fun…) and decay at individual rates.
- Objects **advertise** what they offer for each motive. A Sim scores every advertisement, weighted by how depleted the matching motive is (a tired Sim sees the bed's energy offer amplified), then picks *randomly among the top few* to avoid robotic choices.
- Attenuation limits how far an advertisement reaches. Some interactions override everything (phone, school bus).
- Autonomy is deliberately imperfect, to leave room for the player.

**Borrow:**
- **Affordances live in the world, not the character.** Scene, location and the other characters advertise opportunities (tavern: social, rumours; rival: vengeance), and the character scores them by its current needs and desires.
- Top-k random selection avoids the same move every time.

**Sources:** https://gameindustrylibrary.com/documents/gmtk-the-genius-ai-behind-the-sims · https://woobsha.com/diy-TTABTutorialMac.htm

### C5. Versu (Evans & Short): the most relevant precedent
**Mechanics**
- **Social practices** (dinner, greeting, conversation, a norm-violation response…) are role-agnostic reactive joint plans. They *offer* affordances and never control agents. Many practices run concurrently.
- Every agent, every turn, uses **utility-based reactive action selection**. It simulates each available action's *actual* consequences one step ahead, scores the resulting world state against its **desires**, then undoes them. The method is broad rather than deep.
- Desires are arbitrary logical sentences with a utility weight, and each satisfied instance adds weight. Example: Brown, a poet with a chip on his shoulder, wants upper-class men to be displeased with him (+20 per instance). The authors argue this gives as many personalities as there are sentences, beyond a fixed trait set.
- Most NPCs have strong desires to respect social norms. The drama manager occasionally lowers those desires in one agent for drama. The player can violate norms, and a violation spawns a subpractice offering others the options to disapprove, forgive, get angry or evict.
- **Relationships are role evaluations**: multiple, asymmetric, and stored *with a reason* (Agent.relationship.Other.role!Value!Explanation; for example, Darcy is a bad suitor because he was rude at the dance).
  - Evaluations are hard-coded, acquired by *interpreting* an action (the interpretation is itself a choice), or adopted from gossip.
  - Separately there is a symmetric **public relationship state** (friends, lovers, enemies).
- Emotion is a single current state with a **target and cause** ("annoyed with Brown because of his insult"). Previous emotions are remembered so mood switching can be modelled.
- Reactions are short-lived practices that expire when something newer happens, so nobody reacts to "old news".
- Design rules:
  - Relationship-state changes must take several moves and an active choice. An NPC should never unilaterally flip its relationship with the player, though it can force a fork such as "marry me or we're done".
  - Each action should change several core qualities at once.
  - Character arcs: internal choices about what the character *wants to be*, with authored epilogues.
- Admitted limit: only the player can choose against their own desires, so NPCs do not transform.

**Borrow:**
- **Ranked desires as weighted conditions** that the analyst scores candidate actions against.
- **Practices as scene-type affordance menus.**
- Evaluations-with-reasons.
- Emotions with target and cause.
- Reaction expiry.
- The "relationship changes need multiple moves" rule, which is exactly the protection against hostility collapsing.

**Sources:** https://www.cs.uky.edu/~sgware/reading/papers/evans2014versu.pdf · https://ojs.aaai.org/index.php/AIIDE/article/view/27537 (Praxish reconstruction)

### C6. Comme il Faut / Prom Week, and Ensemble
**Mechanics**
- Social state:
  - binary **traits** (permanent) and **statuses** (temporary and directional, for example "angry at X", "has a crush on Y");
  - binary **relationships** (friends, dating, enemies);
  - **scalar directional networks** (buddy, romance, cool in Prom Week);
  - a **cultural knowledge base** of objects with shared opinions plus personal likes/dislikes/wants/has;
  - a **social facts database** (SFDB), a history of labelled past exchanges (mean, nice, embarrassing…).
- **Volition formation** is recomputed after every exchange. **Influence rules** (condition → weight) add up per intent, grouped into **microtheories** that are consulted only when a predicate holds (for example the "has a crush on" microtheory). The result is each character's *ranked list* of desired social exchanges.
- The **responder** has its own rule set that decides accept or reject.
- **Trigger rules** fire globally (dating two people at once gives the status "two-timer").
- Prom Week used more than 5,000 influence rules, 44 traits, 34 statuses and 13 SFDB labels.
- Ensemble (2015) generalized CiF into an authoring tool.

**Borrow:**
- Every NPC keeps a *ranked list of intents toward each other character*, recomputed after every exchange. For the player in particular, also store the NPC's current intent toward them (start rivalry, extract info, recruit, ignore).
- A **responder check** for player requests, evaluated against the NPC's own rules and not the LLM's helpfulness.
- Statuses with expiry.
- SFDB-style labelled history ("the player was cruel to me 3 scenes ago") as the cheap memory that rules query.

**Sources:** https://cs.uky.edu/~sgware/reading/papers/mccoy2014cif.pdf · https://ojs.aaai.org/index.php/AIIDE/article/view/12454 · https://www.kmjn.org/publications/SocialPhysics_ICIDS22.pdf

### C7. Façade: drama manager and beats
**Mechanics**
- Characters are written in ABL, a reactive planning language, as **joint dialogue behaviours** (exchanges of 1–5 lines).
- A **beat** groups 10–100 of these around one narrative goal, with handlers for player interjections. Only one beat is active at a time.
- The **drama manager** picks the next beat from a pool by preconditions, by effects on story values (tension, affinity), and by fit to an authored **tension arc**.

**Borrow:** a lightweight "director" pass that tracks one or two story values (tension, the player's affinity toward each NPC) against a target curve. When the curve sags, it raises pressure from proactive NPCs (fronts) instead of having NPCs fawn over the player.
**Sources:** https://ojs.aaai.org/index.php/AIIDE/article/view/18722 · https://course.ccs.neu.edu/cs5150f14/readings/mateas_abl.pdf

### C8. Talk of the Town (James Ryan)
**Mechanics**
- Characters hold **subjective beliefs** about others. Beliefs form by observation, by hearsay (true or false), or by confabulation from related knowledge.
- Salient attributes are remembered better. Beliefs decay and can be misremembered.
- Characters propagate knowledge and can lie, and repeating a claim increases one's own commitment to it.
- Admitted weakness: without salience to *drama*, characters mostly gossip about trivia (hair colour).

**Borrow:**
- Per-NPC `beliefs_about[target]` with a source (saw / heard from X / assumed) and a confidence.
- Off-screen gossip that spreads what the player did to characters who were not present.
- Weight propagation by *dramatic relevance* (goal-relevance from A6), not by attribute salience.

**Sources:** https://ojs.aaai.org/index.php/AIIDE/article/view/12825 · https://emshort.blog/2019/05/28/curating-simulated-storyworlds-james-ryan-ch-6f/

### C9. Shadow of Mordor / War: the Nemesis system
**Mechanics**
- Orc captains are individuals with a rank in a visible hierarchy, specific **strengths, weaknesses and fears** (fire, for example), bodyguards, and a **history with the player**.
- If an orc kills the player or survives an encounter, it is promoted, gains abilities, and greets the player with a taunt that refers to the specific prior encounter (and scars from it).
- Vacancies are filled from below, and orcs feud and betray one another.
- The patent (US 10,926,179, expires about 2036) covers *the specific system*, not the general ideas of memory and grudges, but avoid copying its structure literally.

**Borrow:**
- `encounters_with_player[]` (outcome, humiliation or victory, a scar) that NPCs *bring up themselves*.
- Grudges that raise the NPC's priority to pursue the player.
- Off-screen rank and power changes among NPCs.
- Fears and weaknesses as leverage.

**Sources:** https://kotaku.com/middle-earth-shadow-of-wars-nemesis-system-is-about-fr-1793067914 · https://gdcvault.com/play/1025150/Helping-Players-Hate-(or-Love) · https://dwo.co.il/the-patent-protection-of-the-nemesis-system-of-the-game-middle-earth-shadow-of-mordor/

### C10. Utility AI / Infinite Axis Utility System (Dave Mark)
**Mechanics**
- Each candidate behaviour has several **considerations**. Each consideration takes an input, normalizes it to 0–1, and passes it through a **response curve**.
- Considerations are **multiplied**, so any 0 vetoes the behaviour. Because the product shrinks as considerations are added, a **compensation factor** or geometric mean is applied.
- Behaviour × target pairs are scored and the best (or a weighted random pick) is chosen.

**Borrow:** to make "does X engage the player" deterministic and tunable, compute it in code from analyst-extracted inputs (goal relevance, opinion, proximity, need, urgency of the competing agenda), each through a curve, multiplied. The LLM then only explains the choice. Curves make personality differences explicit (a vengeful NPC's curve on "player wronged me" is steep).
**Sources:** https://en.wikipedia.org/wiki/Utility_system · https://gameai.com/iaus.php · https://github.com/ProjectBorealis/IAUS/wiki

---

## D. LLM-agent research on believable characters

### D1. Generative Agents (Park et al., 2023)
**Mechanics**
- A **memory stream** of natural-language observations. Retrieval score = recency + importance + relevance, each normalized and equally weighted.
  - Recency is an exponential decay per game hour. The paper states 0.995; the released code ships 0.99.
  - Importance is self-rated by the LLM on 1–10.
  - Relevance is embedding cosine similarity.
- **Reflection** fires when the summed importance of recent memories exceeds 150 (`importance_trigger_max` in the code). The agent asks what the most salient high-level questions about its recent memories are, retrieves evidence, and writes insights back as memories, forming reflection trees.
- **Planning** is top-down: a day plan in broad strokes, recursively decomposed to hours and then to 5–15-minute actions, and re-planned when observations warrant a reaction.
- An ablation showed that observation, planning and reflection each matter. Known failures: agents grow over-polite and cooperative, and memory retrieval misses relevant items.

**Borrow:**
- Importance-gated reflection is the right trigger for the *slow* analyst pass: run it when accumulated event importance crosses a threshold, not every turn.
- Plans give NPCs something to do when the player is not around.

**Sources:** https://arxiv.org/abs/2304.03442 · https://github.com/joonspk-research/generative_agents

### D2. Generative Agent Simulations of 1,000 People (Park et al., 2024)
**Mechanics:** agents seeded with a **2-hour qualitative interview** transcript of a real person replicate that person's General Social Survey answers at 85% of the person's own two-week test-retest consistency. Agents built from demographics alone, or from short persona paragraphs, both score about 77%. Interview agents also reduce demographic bias.
**Borrow:** **rich, specific biographical narrative beats trait labels** for fidelity. A character card that contains concrete episodes, opinions in the character's own voice and specific choices predicts behaviour better than an adjective list. This supports making the "revealed choices" and "ghost" episodes first-class.
**Source:** https://arxiv.org/abs/2411.10109

### D3. Humanoid Agents (Wang et al., 2023)
**Mechanics**
- Adds System-1 drivers to Generative Agents:
  - **Basic needs**: fullness, fun, health, social and energy, each 0–10. A need is "unmet" at ≤3 and then rendered in words with intensity modifiers ("slightly/very/extremely hungry"). Needs decay probabilistically.
  - **Emotion**: one of 7 Ekman-style labels.
  - **Closeness** per relationship: 0–30 in bands (under 5 distant, 5–9 rather close, 10–14 close, 15+ very close). It changes by ±1 after each conversation depending on whether the agent enjoyed it, so it takes about 5 conversations to move a band.
- After each 15-minute activity the agent re-evaluates its needs and emotion and may revise its plan in one sentence.

**Borrow:**
- Numeric state rendered as **graded natural language** only when it crosses a threshold.
- **Slow, banded relationship change (±1 per interaction, about 5 to change band)**, a simple anti-whiplash rule.

**Source:** https://arxiv.org/abs/2310.05418 · https://github.com/HumanoidAgents/HumanoidAgents

### D4. Lyfe Agents (2023)
**Mechanics**
- **Option-action**: a "cognitive controller" LLM call picks a high-level option (talk, move…) plus a subgoal only when the current option terminates. Cheap per-step calls then execute it. Termination comes from non-LLM triggers (time, repetition detection).
- **Asynchronous self-monitoring**: a running narrative summary of recent events, filtered for relevance to the agent's goal and updated off the critical path.
- **Summarize-and-forget memory**: working memory → recent → long-term, with cluster-then-summarize and deletion of near-duplicates above a similarity threshold.
- Reported cost is 10–100× cheaper than Generative Agents, about $0.50 per agent-hour on GPT-3.5.

**Borrow:**
- This is the closest architecture to "actor + cheap background analyst". The analyst maintains the self-monitoring summary and decides options (intentions) asynchronously; the actor executes.
- Re-decide the high-level option only on termination events.

**Source:** https://arxiv.org/abs/2310.02172

### D5. AgentSims, Affordable Generative Agents, Project Sid / PIANO
**Mechanics**
- *AgentSims*: a sandbox with pluggable memory and planning modules for task-based evaluation.
- *Affordable GA* (Tencent): a **Lifestyle Policy** that reuses previously generated plans and actions for recurring situations, and **Social Memory** that avoids regenerating repeated information in multi-turn exchanges. Both cut LLM cost substantially.
- *Project Sid / PIANO*: concurrent modules (memory, social, goals, action) run in parallel, with a **Cognitive Controller** behind an information **bottleneck**. Its decision is broadcast to the talk and act modules so the agent does not say one thing and do another. Routing social information through the bottleneck makes agents more social. Tested with up to about 1,000 Minecraft agents.

**Borrow:**
- Cache routines for off-screen NPCs.
- One "decision" object per turn per character that both narration and dialogue must obey (coherence).
- Choose deliberately what passes through the bottleneck into the actor prompt. For example, only include the player's relevance when it is above threshold.

**Sources:** https://arxiv.org/abs/2308.04026 · https://arxiv.org/abs/2402.02053 · https://arxiv.org/abs/2411.00114

### D6. Inworld Goals & Actions; Convai narrative design
**Mechanics**
- *Inworld Goals 2.0*: goal = activation (a recognized intent or a client trigger with parameters) + action (an instruction or verbatim line, an emotion change). Goals can be repeatable and send a completion signal.
- *Convai*: a narrative graph of sections, each with an **objective** the character pursues in dialogue, plus decision notes and triggers that advance sections.
- In both, "motivation" is mostly authored text, and the agency is event-driven.

**Borrow:** a trigger → instruction mechanism for authored beats ("when the player mentions the ring, this NPC tries to steal it"). These are useful *on top of* the simulation for author intent, but they are not a personality model.
**Sources:** https://docs.inworld.ai/docs/tutorial-basics/goals · https://docs.convai.com/api-docs/plugins-and-integrations/web-plugin/narrative-design-guide

### D7. Persona consistency and drift
**Mechanics**
- *Character-LLM*: fine-tunes on reconstructed "experiences" plus **protective experiences**, where the character is confused by out-of-world knowledge, to reduce character hallucination.
- *RoleLLM / RoleBench*: 100 roles; metrics for speaking style, answer accuracy and role knowledge.
- *CharacterEval*: 4 dimensions (conversational ability, character consistency, role-play attractiveness, personality back-testing) and 13 metrics, scored with a trained reward model.
- *PersonaGym*: per-persona environments plus tasks including Expected Action, Action Justification and Linguistic Habits. Finding: bigger models are not reliably better at staying in persona.
- *Persona drift* (Li et al., 2024): LLaMA2-70B and GPT-3.5 drift from system-prompt personas **within about 8 rounds**, attributed to attention decay over long context. Split-softmax (boosting attention to the system prompt at inference) helps.
- *Too Good to be Bad* (2025/26): role-play fidelity **falls as character morality falls**. Models are worst at deceitful and manipulative traits and substitute crude aggression for subtle malice. Safety-aligned models are worst.

**Borrow:**
- Re-inject a compact, *current* state card every turn near the end of the context (fights drift).
- Have the analyst score each response on "acted per stance and goal?" with a short rubric in the style of PersonaGym's Expected Action, and feed corrections back.
- For villains, write **explicit tactics** ("lies by omission, flatters to extract, never threatens openly") rather than "evil", because the model defaults to shouting.

**Sources:** https://arxiv.org/abs/2310.10158 · https://arxiv.org/abs/2310.00746 · https://aclanthology.org/2024.acl-long.638 · https://arxiv.org/abs/2407.18416 · https://arxiv.org/abs/2402.10962 · https://arxiv.org/abs/2511.04962

### D8. BDI + LLM hybrids
**Mechanics**
- Prompt-level BDI inference: the LLM, acting as an NPC's mind, proposes belief, desire and intention sets from dialogue history and refines them with counterfactual reflection (arXiv 2501.15355).
- LLMs placed inside a rule-based BDI agent for intent recognition and response generation, with the BDI core keeping control (arXiv 2509.16784).
- ChatBDI ("think BDI, talk LLM"), AAMAS 2025.
- Earlier, BDI sales-dialogue NPCs at AIIDE.
- A common caution: hallucinated content can corrupt beliefs, so belief updates need validation.

**Borrow:**
- Let the LLM *propose* belief, desire and intention updates as structured diffs, and let code *accept or clamp* them using commitment rules, step limits and author locks.
- Think in BDI (state), talk in the LLM (surface).

**Sources:** https://arxiv.org/pdf/2501.15355 · https://arxiv.org/abs/2509.16784 · https://cdn.aaai.org/ojs/12517/12517-52-16039-1-2-20201228.pdf

---

## E. Synthesis: a practical character-individuality model

### E1. Three layers, by rate of change

**1. Core (author-owned, locked; changes only by explicit author edit or a rare arc event).**
- `hexaco` (6 × −2..+2; report only the extremes)
- `values_ranked` (Schwartz: top 3 + sacrificed 1)
- `desires_high/low` (Reiss: 2–4 / 1–3)
- `attachment {anxiety, avoidance}`
- `wound {ghost, lie/schema, triggers[], coping}`
- `want / need` and `arc_lock` (true for villains and fixed characters)
- `moral_weakness`
- `signatures[]`: 3–6 "if <situation> then <behaviour>" lines, the most useful field for the actor
- `coping_style`, `commitment_style` (single-minded / open-minded)
- `proactivity 0–10`
- `default_mood` (PAD octant)
- `stance_floor/ceiling` per target class (for example "never above −1 toward imperial agents without an arc event")
- `voice` (3 distinct bullets)
- `tactics[]`: *how* they pursue goals (especially for manipulative characters)

**2. Slow state (analyst-maintained; updated at scene end or when the reflection threshold is crossed).**
- `dream`: one lifelong goal (DF).
- `goals[]`: GMC external and internal, with priority.
- `intentions[1–2]`: `{goal, plan_next_step, started, drop_if[], clock}` (BDI).
- `relationships[target]`:
  - `stance −3..+3` (Blades ladder);
  - axes `affection / trust / respect / fear`, each −100..100;
  - `modifiers[] {reason, delta, expires_after_scenes, stack_n}` (CK3 / RimWorld);
  - `evaluations[] {role, value, because}` (Versu);
  - `intent_toward` (CiF);
  - `debts / grudges / encounters[]` (Nemesis).
- `beliefs[] {about, claim, source: saw|heard_from|assumed, confidence}` (Talk of the Town).
- `needs {autonomy, competence, relatedness}` 0–10 (SDT).
- `stress 0–100`, raised when acting against values or stance (CK3).
- `arc_stage`.
- `front {impulse, portents[], doom, clock k/n}` for important NPCs and factions.

**3. Scene state (per turn; cheap).**
- `scene_goal`, `obstacle`, `fallback` (Swain).
- `mood_pad` plus the active `emotion {type (OCC), intensity 1–5, target, cause, expires}`.
- `attention_target`.
- `move_type` (one of: pursue own goal / respond / initiate toward X / withdraw / obstruct).
- `stance_now` (may differ from the slow stance by ±1 at most).
- `revealed_choice` (if a dilemma occurred).

### E2. Per-turn update loop (the analyst runs after each assistant/user pair; JSON in, JSON out)
1. **Perceive.** Extract events as `who did what to whom` and stated intentions.
2. **Relevance gate (Lazarus stage 1).** For each present character, check whether the event touches a goal, value, standard, need or wound trigger. If not, skip that character.
3. **Appraise (OCC + stage 2).** Output emotion, intensity, target, cause and blame. Update PAD with pull/push and a per-turn decay toward `default_mood`.
4. **Relationship modifiers.** Add `{reason, delta, expires}`. Cap the net stance change at ±1 per scene, and require two or more consistent events in different scenes to move stance (Versu + Blades hysteresis). Repeated identical events stack with ×0.9 diminishing returns (RimWorld).
5. **Stress.** If the actor made the character act against `values / stance / signatures` without a cause, add stress and log a correction note. When stress crosses a threshold, schedule a characteristic snap based on `coping_style`.
6. **Intention reconsideration (BDI), only on triggers**: achieved, impossible, `drop_if` met, or a new option whose utility beats the current one by a margin scaled by `commitment_style`.
7. **Choose the scene move (utility).** Candidate moves come from the scene's affordances (Sims/Versu). Score each = Π(curves over goal progress, values fit, need, stance, risk) (IAUS). Sample from the top 2–3. Emit one **decision object** that the actor must realize (PIANO coherence).
8. **World tick** (every N turns or at scene change). Advance fronts and clocks, take one off-screen faction/NPC action, propagate gossip to absent characters.
9. **Slow pass** (reflection threshold, as in Generative Agents, or scene end). Run the sequel step (reaction → dilemma → decision), update goals and arc stage, compress memory (summarize-and-forget).
10. **Render** a ≤150-token **director card** per active character: stance + why, current goal, this turn's move, active emotion with cause, one relevant signature, one tactic. Inject it late in the context every turn.

### E3. "Does this character care about the player right now?"
Compute `player_relevance` in code from analyst-extracted inputs, IAUS style:
- **goal involvement**: is the player a means, obstacle, target or threat for the current intention? (0 / 0.5 / 1)
- **relationship salience**: |stance|, open debts and grudges, unresolved encounters
- **need pull**: low relatedness × attachment anxiety means seeking; avoidance means withdrawing
- **situational**: proximity, being addressed directly, social practice obligations (host, guard)

Multiply these, then subtract **agenda urgency** (the competing clock nearing completion) × `proactivity`.

The result is a band:
- **ignore**: background; the NPC pursues its own scene goal, and the player is at most an obstacle;
- **instrumental**: deal with the player only as a means to its goal;
- **engaged**: the player is the focus.

The *direction* (help vs hinder) comes from `stance` plus goal involvement, not from the band. A hostile NPC with high relevance **pursues** the player; with low relevance it **ignores** them, which is also hostility.

### E4. Pitfalls
- **LLM positivity and sycophancy.** Models drift toward agreeable, helpful, and likable-by-default within about 8 turns, and fail at deceptive or manipulative villainy. Countermeasures:
  - authored stance floors;
  - a hysteresis cap on stance changes;
  - stress for out-of-character kindness;
  - explicit tactics;
  - per-turn re-injection of the card;
  - an analyst audit with an Expected-Action-style rubric.
- **Trait soup.** Adjective lists give flat characters. Prefer signatures, revealed choices and concrete episodes (interview-style richness beats personas: D2).
- **Everything is about the player.** Without goals, every event appraises as "about the player". Give every NPC a scene goal and an off-screen front; gate appraisal by goal relevance.
- **Whiplash.** Uncapped numeric deltas let one compliment flip a nemesis. Use banded, slow relationship change, reason-tagged modifiers with expiry, and diminishing stacks.
- **State bloat and cost.** Report only extremes, render numbers as graded words, re-plan only on termination, cache routines, run the slow pass only on importance thresholds.
- **Analyst hallucination corrupting beliefs.** Treat analyst output as proposed diffs. Validate in code (enums, clamps, locks). Keep `source` and `confidence` on beliefs.
- **Over-simulation without drama.** Talk of the Town's lesson: propagate and record what is *goal-relevant*. Add a director pass tracking tension so proactive NPCs, not fawning ones, fill lulls.
- **Mixing NPC change with player agency.** Following Versu, keep NPC transformations rare and authored (arc_lock). Let relationship-state changes with the player be explicit forks rather than silent drift.
