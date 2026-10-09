# Dramatis: appetites, drives, vices, corruption. Research notes and design synthesis

Prepared 2026-10-09. Scope: mechanics, scales and update rules only. Everything here is non-graphic and about mechanisms. Items I could not confirm against a source are marked **(unverified)**. Items I wrote from memory and only partly confirmed are marked **(partly verified)**.

---

## 0. The short version

1. **Wanting is not liking** (Berridge & Robinson). Motivational pull ("wanting", which is cue-driven, dopamine-linked and sensitizable) and hedonic pleasure ("liking") are separate systems. Wanting can grow while pleasure stays flat or falls. In Dramatis this means two separate fields, `pressure` (wanting) and `liking` (payoff), and a third axis, `stance` (regard for a person). None of them is derived from the others.
2. **Hot states crowd out other goals and are mispredicted** (Loewenstein). Pressure should scale how much it overrides the other goals, how much risk the character accepts, and how much the brakes weaken. Characters in a cold state should underestimate what they will do in a hot one.
3. **Most desires are not enacted when they conflict with goals.** In Hofmann's field data about half of desires conflicted with goals, about 40% were resisted, and enactment fell from about 70% to about 17% when resisted. Realistic vice is mostly temptation, resistance and lapse, not constant indulgence. Situational factors such as alcohol, onlookers and depletion matter most at the enactment stage.
4. **The method is a separate choice from the appetite.** V5 Predator types, CK3 Seduce versus Abduct schemes and Pendragon ("a failed Chaste roll is a feeling, not an action") all keep *what drives you* apart from *how you get it*. Criminology supplies the "act now / wait / scheme" calculus: motivated actor + suitable target (VIVA) + absent guardian, and effort/risk/reward/excuses.
5. **Corruption is a slow, stage-gated track with catalysts, gifts and stains** (Pathfinder corruptions, V5 stains/remorse, CoC thresholds). It is fed by acts against convictions and enabled by moral-disengagement mechanisms (Bandura) and objectifying "gaze" modes (Nussbaum).
6. **LLMs drift to "too good"** (Yi et al., *Too Good to be Bad*, arXiv 2511.04962). Fidelity drops as character morality drops. The hardest traits are deceit and manipulation, and models swap them for shallow aggression. The engine has to state the method and the gaze explicitly, keep desire and affection in separate channels, and forbid want-to-love conversion.

---

## A. Psychology

### A1. Incentive-sensitization theory (Robinson & Berridge, 1993; review 2016)
- **Mechanism.** "Wanting" (incentive salience) is a motivational process that makes reward cues attention-grabbing and attractive. "Liking" is the hedonic impact of consumption and runs on smaller, fragile "hotspot" systems. The two can come apart: addiction is described as excessive amplification of *wanting*, triggered especially by cues, without a matching rise in liking. Liking may even fall, giving "wanting what you no longer enjoy".
- **Cue × state.** How strong a cue-triggered urge gets depends on both the cue's learned association and the person's current state. Stress, emotional excitement, relevant appetites and intoxication all amplify wanting peaks. Context gates it: urges spike when cues appear in the settings where the reward was previously obtained.
- **Persistence.** Sensitization comes from repeated, high, spaced exposures (binges). It is very long-lasting, possibly permanent, and can *grow* during abstinence ("incubation of craving"). Tolerance to the high, by contrast, is mostly temporary and fades within weeks of stopping.
- **Scope.** The review links the mechanism to gambling, food and other behavioural appetites, and notes overlap with ordinary desires. Wanting can drive relapse even when the person sincerely intends to abstain.
- **Design takeaway.** Use separate fields for `pressure` (current wanting), `liking` (payoff), `sensitization` (long-term cue multiplier that decays very slowly or never) and `tolerance` (shorter-lived dose escalation). A trigger list gives cue → +pressure, amplified by stress, intoxication or another appetite.
- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC5171207/

### A2. Visceral factors and the hot–cold empathy gap (Loewenstein 1996, 2005; Ariely & Loewenstein 2006)
- **Crowding out.** Visceral states (hunger, thirst, sexual arousal, drug craving, pain, desire for revenge) have a disproportionate effect on behaviour while they are felt. They push aside nearly every goal other than relieving the state. The gap between how much a person values the good and how much they think they *should* value it widens as intensity rises.
- **Empathy gaps.** People in a cold state underestimate how a hot state will change their own preferences. People in a hot state overestimate how stable their current preferences are. People also misjudge *others'* hot states, which is the interpersonal gap. Cold-state people under-invest in avoiding hot situations.
- **Arousal and ethics.** In Ariely & Loewenstein's study, sexually aroused participants (male students, hypothetical judgements) rated a wide range of activities as more appealing. They also reported more willingness to use ethically questionable means to obtain sex and more willingness to take risks, and they did not anticipate this shift. A later replication (Imhoff & Schmidt) moved the procedure into a controlled lab and extended it to women. All measures were hypothetical self-reports.
- **Design takeaway.** Pressure should do three things: (1) *narrow* the active goal set (at high pressure, unrelated goals are suspended); (2) *raise risk tolerance* and *lower the brakes* ("hot-state erosion"); (3) make cold-state plans unreliable, so a character who resolved "never again" mispredicts. The interpersonal gap is good drama: a sated character does not understand a starving one.
- Sources: https://www.cmu.edu/dietrich/sds/docs/loewenstein/Outofcontrol.PDF · https://en.wikipedia.org/wiki/Hot-cold_empathy_gap · https://www.cmu.edu/dietrich/sds/docs/loewenstein/HeatMoment.pdf · https://orbilu.uni.lu/bitstream/10993/17947/1/Imhoff-Schmidt_Sexual-disinhibition_ASEB_peer-version.pdf

### A3. Everyday temptation and self-control
**Hofmann, Vohs & Baumeister (2012), experience sampling.** The study had 205 adults, one week, about 7 prompts per day and about 7,800 desire reports.
- A desire was present at about half of the prompts. About half of those desires conflicted with other goals, and about 40% were actively resisted.
- **Enactment:** about 70% when not resisted, about 17% when resisted.
- The most common desires were eating, sleep, drinking, media, social contact and sex. Sleep and sex desires were the most intense. Media and work showed the most self-control failure.
- Strong and weak desires were equally likely to prompt resistance, but strong ones were least often contained.
- **Situational moderators of enactment.** Intoxication strengthened desire and weakened resistance. Other people present increased resistance, *unless* those people were indulging themselves, in which case enactment rose. Frequent and recent prior self-control that day predicted worse resistance later.
- **Trait moderators.** High trait self-control showed up as *fewer conflicts and weaker desires*, mainly through avoiding temptation rather than white-knuckling it. Narcissism went with *less conflict*, because those people felt entitled to their desires.
- Personality mattered more early in the process (strength, conflict). Situation mattered more late (resistance, enactment).
- Sources: https://bps.org.uk/research-digest/already-struggling-keep-new-year-resolutions-heres-first-detailed-study-daily · https://experts.umn.edu/en/publications/everyday-temptations-an-experience-sampling-study-of-desire-confl/

**Kotabe & Hofmann (2015), integrative self-control theory.** It has seven nodes: desire, higher-order goal, desire–goal conflict, control motivation, control capacity, control effort, and *enactment constraints*. Desire plus an incompatible goal gives conflict, which activates control motivation. Motivation × capacity gives potential effort. Enactment constraints, meaning external factors such as no opportunity or a locked door, can decide the outcome regardless of effort.
- Source: https://www.psychologicalscience.org/journals/perspectives/1745691615593382/

**Metcalfe & Mischel (1999), hot/cool systems.** A "go" (hot, stimulus-controlled, emotional) system works against a "know" (cool, strategic) system. Hiding the tempting object or reframing it as abstract weakens the hot system, and distraction strengthens the cool one. Stress, especially high stress, impairs the cool system and may *enhance* the hot one.
- Source: https://psychology.columbia.edu/sites/psychology.columbia.edu/files/2016-11/3.pdf

**Elaborated Intrusion theory of desire (Kavanagh, Andrade & May 2005).** Desire runs in two stages: (1) an *intrusion*, an unbidden thought set off by cues, bodily state or association; (2) *elaboration*, where the person dwells on it with vivid imagery that is pleasurable but also sharpens the felt deficit, which escalates craving. Elaboration uses working memory, so busy or distracted characters crave less. Whether craving becomes action depends on competing incentives, access and skills.
- Source: https://eprints.whiterose.ac.uk/id/eprint/509/

**Design takeaways.**
- *Pressure ≠ act.* An explicit gate sits between them: conflict → control motivation × capacity versus pressure, plus enactment constraints (opportunity).
- Capacity is a depletable resource: it drops with prior restraint, fatigue, intoxication and stress.
- Idle, alone or ruminating scenes add pressure through elaboration. Busy scenes do not.
- Social context cuts both ways: onlookers restrain unless they indulge too, and peer indulgence is a trigger.
- "Self-controlled" characters should mostly *avoid cues* rather than heroically resist.

### A4. Dual Control Model (Bancroft & Janssen) as a generic "accelerator / brake" parameterization
- Sexual response is the balance of an excitation propensity (**SES**) and two inhibition propensities. **SIS1** is inhibition from threat of performance failure, an internal anxiety brake. **SIS2** is inhibition from threat of consequences: discovery, harm, social or legal cost. SES and the SIS scales correlate only weakly, so they are independent dimensions. Low SIS2 is linked to risk-taking, because arousal is less restrained by risk information.
- **Design takeaway.** Give every appetite an **accelerator** (baseline intensity and cue sensitivity) and two **independent brakes**: an *internal* brake (anxiety, shame, values) and a *consequence* brake (fear of being caught or hurt). High-accelerator/low-SIS2 is the reckless predator. High-accelerator/high-SIS2 is the furtive schemer who waits for an absent guardian. Low-accelerator/low-brake is the opportunist.
- Sources: https://KINSEYINSTITUTE.ORG/pdf/CarpenterSISSES.pdf · https://pmc.ncbi.nlm.nih.gov/articles/PMC8416846/

### A5. Sociosexuality (SOI-R) and Sexual Strategies Theory
- **SOI-R (Penke & Asendorpf 2008)** splits sociosexual orientation into three facets with distinct correlates: *behaviour* (past uncommitted encounters), *attitude* (endorsement of uncommitted sex) and *desire* (desire for people outside a relationship). A character can want a lot while believing it is wrong and having done little, which is the ego-dystonic vice.
- **Sexual Strategies Theory (Buss & Schmitt 1993)** separates short-term from long-term mating strategies. Both can run at once (keep a long-term partner and seek extra-pair opportunities). Minimum standards (choosiness) are relaxed for short-term contexts, more so in men in the original data. Strategy shifts with *context*: own mate value, operational sex ratio, culture, life-history.
- **Parameterizing a fictional species-wide mating drive:**
  - `mating_desire` (SOI desire facet) is the species baseline plus individual deviation.
  - `strategy_mix` covers short-term (a single encounter, conquest) versus long-term (mate, husband, keep) versus *acquisitive* (possess a mate).
  - `choosiness` is the minimum target value needed to trigger pursuit. It drops when targets are scarce (sex-ratio logic: scarce human men means low choosiness and high rivalry).
  - `target_value(hero)` is the species-specific valuation (strength, novelty, "human essence", status).
  - `exclusivity` covers whether a claim excludes rivals or allows sharing.
  - `attitude` (does the culture endorse it) and `behaviour` (experience) shape *method* and *confidence*, not the urge itself.
- Sources: https://www.larspenke.eu/research/soi-r.html · https://en.wikipedia.org/wiki/Sexual_strategies_theory · https://labs.la.utexas.edu/buss/files/2015/09/Stone-Shackelford-Buss-EJSP-20071.pdf

### A6. Addiction dynamics: cycle, tolerance, withdrawal, relapse
- **Koob & Le Moal three-stage cycle:** *binge/intoxication* → *withdrawal/negative affect* (dysphoria, anxiety, irritability when access is cut) → *preoccupation/anticipation* (craving, cue- or stress-triggered reinstatement). Over time the motive shifts **from positive reinforcement (pleasure) to negative reinforcement (relief)**. Opponent processes dampen the high and recruit "anti-reward" stress systems, so the baseline mood of a dependent user drifts down.
- **Marlatt relapse-prevention model.** Covert antecedents (lifestyle imbalance, "seemingly irrelevant decisions" that drift toward risk) lead to a *high-risk situation*. Negative emotional states (anger, anxiety, boredom, frustration) carry the highest relapse rate, followed by interpersonal conflict and social pressure. The *coping response* matters more than the situation. Effective coping raises self-efficacy and makes a lapse less likely. Ineffective coping plus *positive outcome expectancies* ("one drink will calm me") produces a lapse. The **abstinence violation effect (AVE)** is guilt plus "I've already failed", which turns a lapse into a full relapse. In one study cited by Miller, exposure to high-risk situations was universal and did not discriminate. Avoidant coping and all-or-nothing beliefs did predict relapse.
- **Design takeaway.**
  - `dependence` creates a withdrawal state when time since last satisfaction exceeds a threshold. Withdrawal sets a **pressure floor** and a mood penalty, and it switches the method selector into *relief-seeking*, which means more desperate, lower brakes and shorter planning horizon.
  - `tolerance` reduces the pressure drop per satisfaction and so pushes toward larger or more frequent doses. It decays in weeks.
  - Negative mood, stress and interpersonal conflict are universal triggers for coping appetites.
  - Lapse handling: a committed abstainer who lapses rolls AVE. Either *recommit* (coping, a touchstone present) or *binge* (pressure → max, corruption check).
  - "Seemingly irrelevant decisions" make a good NPC behaviour script: the addict keeps choosing routes past the tavern.
- Sources: https://pmc.ncbi.nlm.nih.gov/articles/PMC2607326 · https://www.frontiersin.org/journals/psychiatry/articles/10.3389/fpsyt.2013.00072/pdf · https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6760427/ · https://williamrmiller.net/relapse-research-predicting-treatment-outcome/

### A7. Bandura's moral disengagement
- These are eight mechanisms that switch off moral self-sanctions in three loci:
  - **Conduct:** *moral justification* (it serves a worthy end), *euphemistic labelling* (sanitized words), *advantageous comparison* (others do worse).
  - **Agency:** *displacement of responsibility* (orders, the chief, the god, "my nature"), *diffusion of responsibility* (the group did it), *distortion/minimization of consequences*.
  - **Victim:** *dehumanization*, *attribution of blame* (they provoked or deserve it).
- The result is harmful action without guilt or any felt need to repair. Critics note the list is not exhaustive. Descriptions of displacement, diffusion and distortion are from general knowledge of Bandura **(partly verified)**.
- **Design takeaway.** Each character's *justification profile* is the list of mechanisms they actually use. A mechanism that is active toward a target class lowers the internal brake for that class. Corruption makes mechanisms *habitual* (always on). Culture supplies ready-made ones: the raider band says "captives are spoils" (euphemism, justification), "everyone takes them" (diffusion), "they're soft lowlanders" (dehumanization). These lines also serve as LLM dialogue cues, so characters *justify* rather than cackle.
- Sources: https://www.albertbandura.com/pdfs/MANUAL%20FOR%20CONSTRUCTING%20MORAL%20DISENGAGEMENT%20SCALES.pdf · https://link.springer.com/article/10.1007/s10551-020-04520-6

### A8. Nussbaum's notions of objectification (plus Langton's additions)
- Nussbaum's seven are instrumentality, denial of autonomy, inertness, fungibility, violability, ownership and denial of subjectivity. Langton adds reduction to body, reduction to appearance and silencing.
- It is a *cluster concept*. The features are separable and not all of them are always present. Nussbaum argues some, in some contexts, are not inherently bad, because consensual and reciprocal contexts differ.
- **Design takeaway: "gaze" toward a target as a set of flags.** Flags combine into a few named modes (see D3). They are what make "wanting without liking" coherent. The goblin can *value* a captive highly (ownership, high target value) while denying subjectivity entirely (stance −1, "it's mine"). A lamia can want the hero with ownership and violability flags *and* positive stance (possessive love). A succubus may hold fungibility (any man will do) and still court rather than coerce.
- Source: https://plato.stanford.edu/entries/feminism-objectification/

### A9. Opportunity: routine activity theory, VIVA, rational choice and situational crime prevention
- **Routine activity theory (Cohen & Felson 1979).** An offence happens when a *likely offender*, a *suitable target* and the *absence of a capable guardian* converge in time and space. Motivation is treated as given, and the variance is in convergence.
- **VIVA (target suitability):** **V**alue (real or symbolic, to this offender), **I**nertia (how hard to move or overcome), **V**isibility (noticed by the offender), **A**ccess (reachable, escape routes). CRAVED (Clarke) is the product-theft analogue.
- **Rational choice / situational crime prevention (Cornish & Clarke 2003).** Offenders choose crime-specifically by weighing perceived **effort**, **risk**, **reward**, **provocations** and **excuses**. The 25 techniques are the inverse: harden targets, extend guardianship, conceal or remove targets, reduce frustration and arousal, set rules and "alert conscience", control alcohol.
- **Design takeaway: a per-turn opportunity calculus.** `opportunity = f(VIVA of target, guardian presence, actor capability, escape)`. Combined with pressure and brakes, it decides **act now / wait / scheme**. "Reduce provocations" and "remove excuses" map onto pressure triggers and moral-disengagement mechanisms. In fiction, the hero's allies, a chaperone, daylight or a crowded inn are guardians. A predator *creates* opportunity by separating the target, impairing guardians or changing routes, and that is what a scheme clock tracks.
- Sources: https://en.wikipedia.org/wiki/Routine_activity_theory · https://popcenter.asu.edu/sites/default/files/Responses/crime_prevention/PDFs/Cornish&Clarke.pdf · https://www.unodc.org/documents/e4j/CPCJ/CPCJ_Module_2_Crime_Prevention_-_table_25_opportunity_reducing_techniques.pdf

### A10. Dark Triad / Tetrad as brake-removers
- The traits are Machiavellianism, narcissism, psychopathy and (everyday) sadism. Buckels, Jones & Paulhus (2013): only high-sadism participants spent extra effort to hurt an innocent, which suggests an *intrinsic appetite for cruelty* that the other three traits lack. Affective empathy is reduced across psychopathy, Machiavellianism and sadism. Narcissists can keep or even exceed others in *cognitive* empathy, which helps manipulation.
- **Design takeaway.**
  - Psychopathy and Machiavellianism *lower internal brakes* (low guilt, low affective empathy) but may keep consequence brakes; Machiavellians are patient schemers.
  - Narcissism gives *entitlement*, so less desire–goal conflict (matches Hofmann).
  - Sadism is *its own appetite* (cruelty as a satisfier), not just a missing brake.
  - High cognitive and low affective empathy is the signature of a good seducer-predator: they read you perfectly and do not care.
- Sources: https://www2.psych.ubc.ca/~dpaulhus/research/DARK_TRAITS/ARTICLES/PS.2013.Buckels-Jones-Paulhus.pdf · https://www.psichi.org/page/283JNFall2023-Dark-Tetrad-And-Empathy

---

## B. Game and tabletop mechanics

### B1. Vampire: The Masquerade 5th ed. (the best single template)
- **Hunger 0–5.** Hunger replaces that many dice in every pool with Hunger dice. Using the Blood requires a **Rouse check** (one die, and on a failure Hunger +1). The same check is made on waking each night, so pressure drifts up passively and with exertion.
- **Consequences of Hunger dice.** A *messy critical* (crit with a 10 on a Hunger die) succeeds "like an animal", in a brutal, uncontrolled way. A *bestial failure* (fail with a 1 on a Hunger die) means the Beast intrudes and causes trouble. Willpower cannot reroll Hunger dice. At Hunger 5 the vampire cannot voluntarily rouse, and a forced rouse becomes a hunger-frenzy test.
- **Compulsions** (general ones such as Hunger, Dominance, Harm and Paranoia, plus clan-specific ones) are temporary behaviour overrides triggered by Hunger-die results, with penalties until satisfied **(partly verified)**.
- **Slaking.** Feeding reduces Hunger by fixed amounts: a non-lethal sip −1 or −2, a full drain −5. Only killing gets you to 0, so a floor of 1 is enforced for the non-lethal feeder. This is a built-in temptation toward the worst act.
- **Predator types = method of satisfying the appetite.** Each grants a Discipline dot, a specialty and an advantage/flaw package, and sets the *hunting pool*. Core list **(partly verified; pools from fan sources and memory)**:
  - **Alleycat**: violent ambush or mugging (Strength+Brawl or Wits+Streetwise). Costs Humanity −1 and gives criminal contacts.
  - **Bagger**: stolen or bought blood bags (Intelligence+Streetwise). Indirect, low-contact.
  - **Blood Leech**: feeds on other vampires. Humanity −1 and shunned.
  - **Cleaver**: feeds covertly on their own mortal family or friends (Manipulation+Subterfuge). Herd, Dark Secret.
  - **Consensualist**: only with consent (Manipulation+Persuasion). Humanity +1, plus a flaw that bars non-consensual feeding.
  - **Farmer**: animals only (Composure+Animal Ken). Humanity +1, plus a flaw.
  - **Osiris**: a cult or fan following as a herd (Manipulation+Subterfuge or Intimidation+Fame).
  - **Sandman**: sleeping victims, burglary (Dexterity+Stealth).
  - **Scene Queen**: feeds inside a subculture they dominate (Manipulation+Persuasion or Intimidation+Etiquette).
  - **Siren**: seduction (Charisma+Subterfuge). Looks merit, plus an enemy such as a spurned lover.
  - Later books add more (the *Tattered Façade* supplement covers 16 types).
- **Humanity 0–10 as corruption.** Acts against Chronicle Tenets, harm to Touchstones, or violated **Convictions** mark **Stains**. At session end with Stains the character makes a **Remorse** roll (dice = unmarked, unstained boxes): success clears the Stains, failure costs 1 Humanity. Convictions can excuse acts. Touchstones are living humans tied to each Conviction **(partly verified; community sources)**.
- **Takeaways for Dramatis.** Pressure dice that *contaminate competence* (high hunger makes success itself brutal). A pressure floor above zero unless the worst act is committed. Predator type as a *standing method profile* with built-in social costs. Stains as *pending* moral damage that remorse can clear. Ethical predator types (Consensualist, Farmer) are a real choice with a cost.
- Sources: https://roll20.net/compendium/vtm/Rules:Rouse%20checks%20and%20using%20the%20Blood · https://roll20.net/compendium/vtm/Rules:Feeding · https://roll20.net/compendium/vtm/Messy%20criticals · https://roll20.net/compendium/vtm/Bestial%20failure · https://www.strangeassembly.com/?p=9877 · https://www.worldanvil.com/w/chicago-by-night-eddielicious/a/predator-types-ritual · https://forums.modiphius.com/t/humanity-loss-and-stains/9639

### B2. Pendragon: opposed traits and passions
- There are 13 trait pairs that each sum to 20 (Chaste/Lustful, Temperate/Indulgent, Merciful/Cruel, Honest/Deceitful, Just/Arbitrary, Prudent/Reckless, etc.).
  - 16+ is **Famous**: you act on it *without a roll*, and acting against it requires a roll. 20+ is Exalted.
  - A trait roll is d20 ≤ value. On a failure you roll the opposite trait. If both fail, the player chooses. A fumble means you act strongly on the opposite trait.
  - **Directed traits** target a specific person or thing (e.g. Lustful (Lady X) +5). **Obsessions** are hyper-directed traits that force a roll on every encounter with the object.
  - Traits shift through experience checks (winter phase).
  - Virtue is cultural: Chaste is a Christian virtue and Lustful a Pagan one.
  - Key line: *a failed Chaste or successful Lustful roll is a feeling, not an action*.
- **Passions** (Love, Hate, Amor, Loyalty...) give inspiration bonuses when invoked. A failure causes a crisis, then melancholy or madness.
- **Takeaways.** (1) The appetite fires as *feeling*, and the method is decided separately. (2) **Directed appetite** toward a specific target is first-class, which is exactly "appetite toward X". (3) A Famous trait means acting by default and needing a roll to resist, which suits pressure ≥ 4. (4) Opposed pairs give brakes as the *counter-trait*, and culture decides which side is virtuous.
- Source: https://pendragonwiki.chaosium.com/rules/traits-and-passions.html

### B3. Crusader Kings 3: vice traits, stress, schemes
- **Personality traits:**
  - **Lustful**: Seduce scheme faster, +25% fertility, ±10 opinion with same/opposite trait.
  - **Chaste**: Seduce scheme much slower, −25% fertility.
  - **Gluttonous**: extra stress loss.
  - **Sadistic**: loses stress from executions and murders, and can scheme against own children.
  - **Compassionate**: *gains* stress from imprisoning, torturing, executing and similar acts.
  - **Callous**: +25% Dread gain.
- **Stress 0–400.** Levels 1/2/3 at 100/200/300 bring rising health and fertility penalties. Crossing a level forces a **mental break** that offers a choice between taking a coping trait, a worse trait, or more stress. Breaks happen at most once every 5 years. Stress comes mainly from *acting against your own personality*.
- **Coping vices** give +20% stress loss each and unlock an "indulge" decision on a 3-year cooldown:
  - **Drunkard**: skill penalties and a health penalty.
  - **Hashishiyah**: the cultural or religious alternative to Drunkard.
  - **Rakish**: requires Lustful, Deceitful or a similar trait; blocked by Chaste.
  - **Comfort Eater**: food.
  - **Flagellant**: the Chaste/Temperate counterpart.
  - **Irritable**: increases Dread.
  - Others.
- **Schemes.**
  - *Personal* schemes (Seduce, Sway, Befriend) have no secrecy or agents and are opinion-driven. A failed Seduce can cost opinion and expose a secret.
  - *Hostile* schemes (Murder, **Abduct**) build **Advantage** over time, can recruit up to 5 **agents** (the target's spymaster, spouse or guardian give large bonuses), and have **Secrecy**. Each month carries a "breach" chance equal to one-tenth of missing secrecy, and 5 breaches end the scheme.
  - Abduct needs the Kidnapper perk. Success is capped at 85% and the base is very low while at war. Target traits (Paranoid etc.) resist it.
  - Agents are persuaded by opinion, gold or **hooks** (leverage from secrets). Characters terrified of the target (Dread) will not join without a strong hook.
- **Takeaways.** (1) Stress converts *suppressed* or *contrary-to-trait* behaviour into pressure on coping appetites. (2) A vice is a coping channel with a cooldown and a side-cost. (3) The *schemes as methods* split, consent-seeking (opinion) versus hostile (advantage, secrecy, agents), is directly reusable as the "scheme clock". (4) Hooks and Dread are *leverage* methods distinct from force.
- Sources: https://ck3.paradoxwikis.com/Schemes · https://ck3.paradoxwikis.com/Traits · https://ck3.paradoxwikis.com/Attributes · https://forum.paradoxplaza.com/forum/threads/ck3-dev-diary-31-a-stressful-situation.1399764/

### B4. RimWorld and Darkest Dungeon
- **RimWorld.**
  - **Tolerance** rises with use. It shortens the high but does not weaken it, and it multiplies addiction chance steeply (about 1× at 0% tolerance, about 5× at 50%, about 15× at 80%). High tolerance also causes organ damage.
  - **Addiction** creates a *need*. Unmet need brings withdrawal (harmful, scaled to drug strength). Long abstinence clears the addiction; the alcohol addiction hediff starts at 50% severity and falls about 3.3 points per day.
  - **Chemical interest/fascination** traits create a *chemical need* (−6/−12 mood when unmet). These pawns use drugs on their own initiative, ignoring orders.
  - Merely *having drugs in the colony* enables a **drug binge** mental break (major for social drugs, extreme for hard drugs), during which restrictions are ignored.
  - **Bloodlust** removes gore penalties and gives a mood boost from killing. **Psychopath** removes empathy-based penalties. **Teetotaler** never binges.
- **Darkest Dungeon.** Town stress relief comes through vice venues (Tavern: bar, gambling, brothel) or the Abbey (meditation, prayer, flagellation). Vice venues have *more side effects*: a hero may go missing, lose money, or pick up a quirk. Quirks *lock* a hero into one outlet or forbid another (e.g. the brothel-only "Love Interest", "Deviant Tastes" blocking the brothel, Dipsomania-style craving). If allowed outlets are blocked, stress cannot be relieved.
- **Takeaways.** Availability is itself a trigger ("drugs in the colony"). Mental-break binges ignore rules. Outlet *locking* gives vices identity and creates *problems* (no outlet available leads to escalation). Side effects make indulgence costly in plot terms.
- Sources: https://rimworldwiki.com/wiki/Drugs · https://rimworldwiki.com/wiki/Traits · https://darkestdungeon.wiki.gg/wiki/Town

### B5. Adult games (mechanics only)
- **Corruption of Champions (Fenoxo).**
  - **Corruption 0–100** runs from "pure" to "demonic". Many events and transformations raise it by fixed or *diminishing* amounts (e.g. +1 below 50, +0.5 below 75, +0.25 above). Purifying items, meditation and perks reduce it or halve future gains.
  - **Thresholds unlock perks and options** (around 25, 35, 40, 50, 60, 70, 75, 80 for progressively corrupt perks).
  - Separately, **Lust** is a combat resource. Opponents can win by raising your lust to max instead of reducing HP, and you can do the same to them. Libido raises lust gain and minimum lust. *The lust-combat specifics are from memory* **(partly verified)**.
- **Lilith's Throne (Innoxia).**
  - Each fetish has a **5-step desire scale**: hate / dislike / indifferent / like / love (values 0–4, clamped at both ends, stepping one level at a time). It modifies how much an action raises *lust*.
  - Desire can shift with experience. A **corruption** attribute gates which actions a character will initiate or accept **(partly verified; desire enum confirmed in source code, the gating behaviour is from memory)**.
- **Takeaways.**
  - *Diminishing* corruption gains are realistic (the first transgression is the big one).
  - Thresholds *unlock behaviours* instead of directly changing personality.
  - A per-activity desire ladder (hate→love) is the "liking" axis, separate from current pressure.
  - Lust-as-a-weapon generalizes into: *some characters pursue an appetite by inducing the corresponding state in the target* (seduction, intoxication) rather than by force. In Dramatis that is the "induce/impair" method family. Keep this abstract and non-explicit in prompts.
- Sources: https://wiki.smutosaur.us/CoC/Corruption · https://raw.githubusercontent.com/Innoxia/liliths-throne-public/master/src/com/lilithsthrone/game/character/fetishes/FetishDesire.java

### B6. Monster Girl Encyclopedia (Kenkou Cross) as a "species drive + approach style" schema
- **Premise (verified at summary level).** A succubus-line Demon Lord ("mamono lord") transformed all monsters into female forms whose core drive is to take human men as mates. Before that, monsters preyed on people. In the old era some families (lamia, harpy) already depended on human men to reproduce, usually *without* affection. A fan-wiki summary of the author's Q&A says the man was usually killed after offspring, with rare monsters "awakening" to love. So the canon itself frames drive and affection as separable, with affection as an emergent exception.
- **Schema used by the entries (each species page specifies these; per-species details below are from general knowledge of the books (unverified per entry)):**
  - *Habitat/encounter context*: where you meet them.
  - *Disposition toward men*: aggressive, shy, devoted, predatory, playful.
  - **Approach style.** Examples:
    - Lizardman: challenge to a duel, and she mates with whoever defeats her.
    - Harpy: snatch from the air and carry to the nest.
    - Arachne / jorōgumo: trap, web, lure under a disguise.
    - Mimic: ambush disguised as treasure.
    - Goblin / orc: pack raid, dominance.
    - Amazoness / dark elf: cultural capture or bondage-contract norms.
    - Mantis: direct, initially emotionless.
    - Lamia: possessive coiling, jealous.
    - Succubus: seduction.
    - Kikimora: devoted service.
    - Dragon: hoarding, tests of worth.
  - *Post-capture disposition*: a "husband" bond, often possessive.
  - *Group structure*: solitary, pack or tribal.
- **Use as a schema.** Each species gets `drive_target`, `drive_intensity_distribution`, `approach_style` (a weighted list), `choosiness`, `possessiveness/exclusivity`, `group_mode` and `affection_onset` (how and whether affection can develop). Individuals sample from the species distributions, and stance stays an independent per-individual variable.
- Sources: https://en.wikipedia.org/wiki/Monster_girl · https://deepcuts.blog/tag/kenkou-cross/ · https://monstergirlencyclopedia.miraheze.org/wiki/Lamia/Extra (seen via search excerpt; direct fetch failed)

### B7. Pathfinder 1e corruptions (Horror Adventures, 2016)
- There are 11 corruptions (Vampirism, Lycanthropy, Accursed/hag-like, Hive, Ghoul, Promethean, etc.).
  - A **catalyst** describes how the corruption is contracted, how it progresses and how it is cured.
  - Stages go **0 → 1 → 2 → 3**. At stage 3 the character is lost and becomes an NPC.
  - Each corruption has a **progression save**. A failure advances one stage. Saves are spaced over weeks or months, and no rerolls or temporary bonuses apply. The GM decides when progression comes up.
  - **Manifestations** arrive roughly every 2 levels (max 9), each pairing a **gift** (power) with a **stain** (drawback).
  - Variants: *useful corruption* lets you refuse stains. *Vile corruption* forces stains, and refusing gifts grants a bonus on progression saves (temptation-to-power framing).
  - A reviewer notes some corruptions (e.g. vampirism) push the character to commit *minor* transgressions to avoid losing control to worse ones. Exact vampirism catalyst text was not retrieved **(unverified)**.
- **Takeaways.** Corruption as *gift + stain* pairs, so power is the temptation. Rare, *slow*, GM-timed checks instead of per-turn drift. "Refuse the gift to resist the fall" as a moral choice. A point-of-no-return final stage.
- Sources: https://www.aonprd.com/Rules.aspx?ID=2278 · https://www.strangeassembly.com/?p=7405 · https://paizo.com/blog/the-monster-within

### B8. Kult: Divinity Lost (4e)
- Characters take **Disadvantages** that act as triggered drives (e.g. *Drug Addict*, *Victim of Passion*, *Nightmares*, *Schizophrenia*, *Depression*, *Cursed*) and **Dark Secrets** (*Pact with Dark Forces*, *Victim of Crime*, *Curse*...).
- Drug Addict: you roll when the character uses or has the *opportunity* to use. A high result (15+) means the urge is under control for now. Lower bands impose a compulsion or cost **(lower bands unverified)**.
- *Sexual Neurosis* is believed to work the same way (opportunity → roll → control or compulsion) **(unverified)**.
- **Takeaway.** *Opportunity triggers a test*: the drive does not fire on a timer, it fires when the world offers it. The Dark Secret is a hidden backstory hook the GM can activate. Both map to `triggers` and a `secret` flag on an appetite.
- Sources: https://dev.rpg.net/reviews/archive/18/18031.phtml · https://en.wikipedia.org/wiki/Kult_(role-playing_game)

---

## C. The LLM roleplay angle

- **Too Good to be Bad (Yi et al., arXiv 2511.04962; ACL Findings 2026).**
  - **Benchmark:** the *Moral RolePlay* benchmark has 4 moral levels (Paragons, Flawed-but-Good, Egoists, Villains) and 800 evaluation characters.
  - **Fidelity drops as morality drops:** about 3.21 → 3.14 → 2.71 → 2.62 average. The big cliff is Flawed→Egoist, which suggests *self-interest itself* is hard for models, not only violence.
  - **Most penalized traits:** Hypocritical, Deceitful, Selfish, Suspicious/Paranoid, Greedy. Models replace subtle manipulation with *open insults and superficial aggression*.
  - **Reasoning modes and general capability:** reasoning ("thinking") modes did not help and slightly hurt for levels 2–4. General chatbot ranking poorly predicts villain skill. In their table GLM-4.6 led villain play, and Claude Sonnet 4.5 and Opus 4.1 ranked low.
  - **Implication for Dramatis:** *selfish wanting* (the Egoist tier) is exactly the appetite layer, and it is where models fail first. The engine must spell out the motive, the gaze and the *method* (deceive, trade, wait) so the model does not fall back to either niceness or cartoon snarling.
- **Community observations.**
  - Villains soften, ask "are you okay?", apologize mid-conflict and fall into therapy-speak. Tension resolves early.
  - Typical fixes: ban therapy-speak in the card, swipe the first soft reply, pin an out-of-character (OOC) tone note.
  - Another reported fix is removing "the user is the protagonist" framing and stating that no actor is privileged. That directly addresses "everything orbits the player".
- **Companion and romance research.** Grogan et al. (arXiv 2502.20231) find that assigning romantic-partner personas significantly changes model responses, with stereotyped effects and sycophancy tested. A broader companion literature reports high sycophancy. Taken together, this suggests a pull toward *agreeable devotion*, which is the want-to-love drift (an inference, not a direct measurement).
- **Existing ST techniques.**
  - **BetterSimTracker** (ghostd93) tracks *affection, trust, desire, connection* as **separate** 0–100 stats with per-turn clamped deltas and confidence scaling. Its default rule only raises desire on explicitly romantic or sexual context. It is a precedent for desire ≠ affection, but its desire is still *romantic* attraction, not appetite in general.
  - **Doom's Enhancement Suite** keeps per-character internal thoughts and custom fields, which could carry an "appetite/gaze" line.
  - A "Megumin Suite NPC Inner Chatter desire field" could not be found **(unverified)**.
- **Prompt-level countermeasures distilled:**
  1. Give each appetite *its own line*, separate from relationship stats.
  2. State the gaze in plain terms ("sees him as prey/property/prize").
  3. State the *chosen method* and its *tactics*: deception, patience, leverage, ambush.
  4. Forbid conversions explicitly: "Desire does not imply affection; satisfaction does not raise regard; do not soften into romance unless stance rises for its own reasons."
  5. Encourage *justification speech* (moral disengagement lines) instead of shouting.
  6. Use an off-screen scheme clock so predatory intent shows through *preparations*, not monologues.
- Sources: https://arxiv.org/abs/2511.04962 · https://www.alphaxiv.org/abs/2511.04962 · https://www.roborhythms.com/character-ai-bots-too-wholesome/ · https://arxiv.org/abs/2502.20231 · https://github.com/ghostd93/BetterSimTracker · https://reddit.sentinel-team.org/posts/1raouj2/snapshots/2026-02-27T16%3A12%3A57.42274Z

---

## D. Synthesized design for the Dramatis "Appetites" layer

### D1. The Appetite object (per character, 0–4 of them active)
| Field | Scale | Meaning / source |
|---|---|---|
| `kind` | enum | food, drink/alcohol, substance:X, mating/sex, possession/plunder (captives, loot), dominance, cruelty (sadism), blood/feeding (world-specific), gambling/thrill, status/adoration, revenge |
| `source` | enum + weight | individual · species/biological · culture/group norm · situational (siege, war, famine, heat season) · world rule (curse, moon, Demon Lord's decree). Several can stack. |
| `target_class` | tag | generic (any ale) or person-bearing ("human men", "captives", "the weak"). Person-bearing appetites spawn per-target entries (D2). |
| `baseline` | 0–5 | trait-level accelerator (SES-like). Species and culture set the mean, the individual deviates. |
| `pressure` | 0–5 | current *wanting* (V5 Hunger-like). See the ladder below. |
| `liking` | −2…+2 | hedonic payoff when satisfied (LT hate…love). Can drift *down* while pressure grows (sensitized). |
| `sensitization` | 0–3 | long-term cue multiplier. +1 after repeated binge-like satisfactions. Decays very slowly or never, and can *incubate* during abstinence. |
| `tolerance` | 0–3 | shrinks the satisfaction drop. Decays over weeks of abstinence. |
| `dependence` | 0–3 | 0 = none. Above 0, withdrawal exists, with floor = dependence and relief-seeking mode. |
| `triggers` | list | cues (objects, places, smells, people), states (stress, boredom, anger, intoxication, another appetite), social (others indulging), availability ("drugs in the colony"). |
| `satisfiers` | list → Δ | what counts and how much: a sip −1, a full meal −3, a "kill/drain"-class act −5 (only *that* reaches 0 for some world appetites). |
| `withdrawal` | profile | mood penalty, irritability, physical signs, and a shift to relief-seeking. |
| `endorsement` | ego-syntonic / ambivalent / ego-dystonic | Is the character proud of it, conflicted, or fighting it? (SOI attitude facet; Hofmann conflict.) |
| `commitment` | none / limiting / abstaining | Abstaining enables AVE on lapse. |
| `visibility` | open / discreet / secret | Secret ties to a Kult-style dark-secret hook. |
| `method_profile` | ref (D5) | the V5 Predator-type analogue: preferred methods, hunting ground, signature. |

**Pressure ladder** (rendered to the LLM as words, not numbers):
- **0 sated.** Uninterested. May feel mild aversion (satiation).
- **1 background.** Notices cues.
- **2 present.** Thinks about it when idle and seeks low-cost chances.
- **3 preoccupied.** Attention capture. Plans around it. Irritable when blocked.
- **4 driving.** Crowds out other goals (only survival and very high goals remain). Risk tolerance up. Internal brake −1.
- **5 compulsive.** Acts at the first viable opportunity. Only *hard brakes* hold (mortal fear, an absolute conviction, a present overpowering guardian). Competence becomes "messy" (V5): succeeds brutally or fails bestially.

**Update rules (per scene tick, or per in-world time step):**
1. **Drift.** `pressure += drift(baseline, kind)`. Hunger and thirst are daily. Mating can be seasonal or world-driven. Plunder is opportunity-driven, with no drift. Vampiric blood follows a rouse-like random +1 on exertion.
2. **Cue.** If a trigger is present, `+1`, and `+1` more if `sensitization ≥ 2` *or* an amplifying state (stress, intoxication, another appetite at 4+) holds. Cap per scene at +2.
3. **Elaboration.** An idle/alone/ruminating scene with a cue earlier gives `+1`. A busy or demanding scene gives 0 (working-memory competition).
4. **Satisfaction.** `pressure −= max(1, satisfier_Δ − tolerance)`. Mood changes by `liking`. Repeated satisfactions at pressure ≥ 4 count toward `sensitization` (e.g. 3 such episodes → +1) and `tolerance` (+1 per N uses).
5. **Withdrawal.** If `dependence > 0` and time since satisfaction exceeds the threshold, enter *withdrawal*: `pressure = max(pressure, dependence + 2)`, mood penalty, capacity −1, method mode becomes *relief* (shorter horizon, accepts higher coercion).
6. **Stress coupling.** Stress or negative mood adds +1 to *coping* appetites (CK3, Marlatt, Koob). Acting against one's own traits generates stress (CK3).
7. **Lapse / AVE.** If `commitment = abstaining` and the character satisfies the appetite: if a touchstone or coping support is present, recommit (pressure → 1, self-efficacy +). Otherwise *binge* (pressure → 5 next tick, corruption check if the act was transgressive).
8. **Decay.** Without cues, pressure for non-drifting appetites decays by 1 per long rest. Tolerance decays slowly. Sensitization essentially never decays.

### D2. Per-target "appetite toward X", separate from stance
For person-bearing appetites, each relevant pair (A → X) gets:
- `want` 0–5: how much A wants X *as an object of this appetite* = species/target valuation × individual taste × novelty/scarcity × current pressure. It is a *Directed* appetite (Pendragon), and `want ≥ 4` behaves like an Obsession: every encounter forces a check.
- `stance` −3…+3: the existing Dramatis regard ladder with reasons. **It is never computed from `want`.**
- `gaze`: see D3.
- `claim`: none / interest / claimed / possessed. This drives rivalry and jealousy.
- `method_current` + `clock` (D5).

**Separation rules (hard):**
- `want` changes from the appetite's sources (pressure, cues, novelty, scarcity, satisfaction).
- `stance` changes only from stance-relevant events: help, harm, respect, betrayal, shared hardship.
- Satisfaction lowers `want` (satiation) and does **not** raise stance.
- Proximity and repeated encounters raise *familiarity*, not affection, unless a stance event happens.
- Affection can emerge (the MGE "awakening"), but only through explicit stance events and corruption ≤ threshold. It then *changes gaze* (fewer objectifying flags) and the method ceiling.

The quadrants are useful to the LLM:

| | stance −3…−1 | stance 0 | stance +1…+3 |
|---|---|---|---|
| **want 0–1** | enemy or contempt, no appetite | stranger | friend, ally, family |
| **want 2–3** | exploitative: use them if cheap | opportunistic or transactional | attraction alongside regard: courtship, flirtation |
| **want 4–5** | **predatory**: hunt, capture, own | **acquisitive**: obtain, then decide | **possessive love**: devoted *and* controlling, jealous, won't let go |

### D3. Gaze modes: how A sees X (Nussbaum/Langton flags)
Store flags; render as a named mode.

| Mode | Flags typically on | Typical behaviour |
|---|---|---|
| **Person** | none | negotiates, accepts refusal, cares about X's experience |
| **Prize** | reduction to appearance/body, partial instrumentality | courts or competes for X, boasts, loses interest once won |
| **Instrument** | instrumentality, fungibility | X is a means (a dose, a coin, a key). Any equivalent will do. |
| **Property** | ownership, denial of autonomy, (violability) | keeps, guards, trades X. May *maintain* X well, as one keeps livestock or treasure. Jealous of "theft". |
| **Prey** | inertness, violability, denial of subjectivity, fungibility | stalks, separates, ambushes. X's words are noise (silencing). |
| **Mate-resource** (species drive) | instrumentality toward reproduction/essence, ownership, varying subjectivity | pursues "a husband". Can co-occur with Person or with Prey depending on the individual. |

The gaze shifts **toward objectification** with corruption, culture (raiders: captives = property), moral-disengagement mechanisms, and pressure (at 5, everyone is Instrument or Prey). It shifts **toward Person** with stance-raising events, the target's displays of agency that the character *has to* acknowledge (X defeats the lizardwoman, saves her life, outwits her), touchstones, and remorse.

### D4. Restraints (brakes)
`brake_total(A, X, method)` is the sum of these, then reduced by heat:
- **Values (internal, SIS1-like):** convictions and trait counter-poles (Pendragon Chaste vs Lustful, Merciful vs Cruel) that apply to *this method*, weighted by `endorsement` (ego-dystonic appetites have stronger internal brakes but more conflict and stress).
- **Consequence fear (SIS2-like):** perceived risk of discovery, retaliation, law, the god's wrath, the chief's punishment.
- **Guardian (RAT):** presence and capability of protectors of X, witnesses, daylight, a crowd. Note Hofmann: onlookers restrain *unless they indulge too*.
- **Group norm:** the in-group forbids it (+) or endorses it (−; a raider band *pushes* toward taking captives; diffusion of responsibility).
- **Regard:** positive stance toward X caps coercive methods (you won't drug a friend unless corrupted). Negative stance removes this cap.
- **Capacity:** self-control reserve, −1 after prior resistance today, fatigue, intoxication, stress. Restored by rest and support.
- **Disengagement:** each active Bandura mechanism toward X's class −1 to values.
- **Dark traits:** psychopathy and Machiavellianism set values ≈ 0 for out-group targets but keep consequence fear (patient schemers). Sadism adds cruelty as a satisfier. Narcissism lowers conflict (entitlement).
- **Hot-state erosion:** at pressure 4, values −1 and consequence fear −1. At pressure 5, values −2, consequence fear −2, and capacity is ignored. Withdrawal counts as +1 pressure for erosion. Intoxication −1 to all.

Cold-state planning (pressure ≤ 2) **under-predicts** later behaviour. The character can sincerely promise "never again" and then break it in a hot state. That is a feature to expose in thoughts, not a contradiction.

### D5. Method selection
Methods are ordered by **coercion level** (C):

| C | Method | Notes / examples |
|---|---|---|
| 0 | **Abstain / sublimate** | redirect to another activity. Costs stress if pressure ≥ 3. |
| 1 | **Substitute** | another target or a proxy (a different drink, a willing partner, an animal for a vampire: Farmer). |
| 2 | **Wait / position** | cultivate opportunity: change routes, ingratiate, get invited, learn routines. |
| 3 | **Court / seduce / ask** | consent-seeking (Siren/Consensualist, CK3 Seduce). Accepts refusal. |
| 4 | **Trade / bargain** | pay, offer favours, contracts, debts (Bagger, a patron). |
| 5 | **Deceive / manipulate** | false pretences, gaslighting, exploiting trust (Cleaver, the "Egoist" tier LLMs fail at). |
| 6 | **Impair / induce** | intoxicate, wear down, isolate, exploit exhaustion. Kept abstract in narration. |
| 7 | **Leverage / coerce** | threats, blackmail, hooks, dread, debt slavery. |
| 8 | **Force / ambush / abduct** | overpower, snatch, raid (Alleycat, harpy snatch, goblin raid). |
| – | **Scheme (wrapper)** | any of 5–8 that needs preparation becomes a **clock**. |

**Selection procedure (per scene where the character is on stage or ticked off-screen):**
1. **Gate.** Act on the appetite this scene only if `pressure + want_bonus ≥ 3` *or* an opportunity arises with pressure ≥ 2. Otherwise background thoughts only. This matches Hofmann: most desire goes unenacted.
2. **Ceiling.** `C_max = f(brake_total, stance, gaze, culture script, dark traits)`. Positive stance plus Person gaze typically gives C_max ≤ 4. Neutral with Instrument gives ≤ 5–6. Negative with Property or Prey plus an endorsing culture gives up to 8.
3. **Opportunity.** VIVA of X (value to A, inertia = X's capability or resistance, visibility, access) × guardian absence × A's capability (skills, allies/agents, tools) × escape.
4. **Pick.** Take the *lowest-C* method with acceptable success odds at the current urgency. Urgency = pressure (5 is now, 3 is this week). Withdrawal mode means a shorter horizon.
   - Opportunity high and odds good: **act now**.
   - Odds poor, method C ≥ 5, and patience trait or Machiavellianism present: **scheme** (start a clock).
   - Odds poor and no scheme capacity: **wait/position**, or **substitute**.
5. **Escalation.** Each failure or refusal at level C while pressure ≥ 3 moves the next attempt to C+1, but never above C_max. If the needed C exceeds C_max, the result is **frustration**: +stress, displacement onto a substitute, or a corruption *temptation event* (D7: "cross the line?").
6. **Style.** The method profile (predator type) biases step 4. A *Siren* prefers 3 even when 8 is allowed. An *Alleycat* goes to 8 quickly. A *Spider* (trap) prefers 2→5→8 via a clock.

**Scheme clock (CK3 hostile-scheme analogue):**
- 4–8 segments, depending on target inertia and guardian strength.
- **+1** per off-screen interval with opportunity, **+1** per agent or accomplice, **+1** for insider access (a servant, a spouse), and **−1** if the target is paranoid or guarded.
- **Secrecy 0–100%**: each tick, a breach chance = (100 − secrecy)/10 %, and 5 breaches (or one dramatic discovery) burn the scheme.
- On completion, run the opportunity scene. The LLM narrates *preparations* while the clock runs (questions about the target's routines, a bribed guard), so the threat is visible without monologue.

**Method profile examples (Dramatis "predator types"):**
- *Siren*: seduces, prefers C3, gaze Prize.
- *Patron*: trades, C4.
- *Cleaver*: exploits own circle, C5, secret.
- *Spider*: lures and traps, C2→5→8 via a clock.
- *Raider*: pack ambush, C8, culture-endorsed, Property gaze.
- *Sandman*: takes the sleeping or helpless, C6–8, avoids confrontation.
- *Shepherd*: keeps a "herd" of willing or dependent sources, C4–7, Osiris/Farmer analogue.
- *Duelist*: challenge and claim by right of victory (lizardwoman), formally consensual within the culture.
- *Consensualist*: C ≤ 3 always, +1 values brake, frustration-prone.

### D6. Corruption track
- **Scale 0–10** (0 = principled, 10 = lost). Internally it is a V5-style track with **stains**.
- **Stain sources:**
  - An act at coercion C ≥ 5 against a target whose gaze was Person or whose stance was ≥ 0 gives 1–2.
  - Breaking one's own conviction gives 1–3.
  - A first-time **catalyst** (first captive, first kill for appetite, first betrayal of a touchstone) gives +2 and forces a check.
  - Diminishing returns: the same act repeated stains less (CoC-style: full at corruption < 3, half at 3–6, quarter above). The first fall is the big one.
- **Arc-end remorse (per day or chapter):** dice = 10 − corruption − stains (min 1). Success clears stains. Failure gives corruption +1 and clears stains. A **touchstone** present gives +1 die. An active disengagement mechanism gives −1 die. An endorsing culture gives −1.
- **Thresholds unlock behaviour** (not a personality rewrite):
  - **≥ 3**: moral-disengagement lines become habitual toward the appetite's targets. Euphemisms appear in speech.
  - **≥ 5**: the default gaze toward out-group targets shifts one step toward objectification. C_max +1. The appetite becomes partly ego-syntonic.
  - **≥ 7**: the appetite is identity ("I am a hunter"). Sadism or cruelty can attach as a secondary satisfier. Remorse only with a touchstone.
  - **10**: lost (Pathfinder stage 3). An irredeemable NPC unless a world-level event intervenes.
- **Gifts and stains (Pathfinder).** Each threshold can grant a *gift* (confidence, status in a depraved group, a predator-type perk, fear aura/Dread) and a *stain* (social marks, compulsions, lost touchstones). Refusing a gift is a valid resistance move and gives a bonus on the next remorse roll (the "vile corruption" variant).
- **Recovery** is slow: an extended abstinence period, acceptance of responsibility (counter-disengagement), restitution, a touchstone relationship. Corruption −1 per completed arc at most. Sensitization stays, so relapse risk persists (incubation).

### D7. Group, species and world appetite rules
- **Species/world rule** (e.g. "every monster girl desires the human hero as a mate"). Define:
  - `drive_target`: human men; the hero is one instance, and others may exist.
  - `intensity_distribution`: e.g. 20% low (0–1, sated, mated, uninterested now), 50% medium (2–3), 30% high (4–5).
  - `approach_style` weights per species (D5 profiles).
  - `choosiness`: minimum target value; scarcity of human men → lower choosiness and higher rivalry.
  - `exclusivity`: exclusive claim / shared / harem-tolerant.
  - `affection_onset`: never / rare / possible / common; this governs whether stance can rise *from* this relationship.
  - `group_mode`: solitary / pack / tribe.
  - Each individual samples `baseline`, `want(hero)`, `approach_style` and *independently* `stance(hero)`. A high-want, negative-stance harpy snatches. A high-want, positive-stance lamia courts possessively. A medium-want, neutral kikimora offers service as a long game.
- **Culture/group norm** (goblin raiders, orc warbands, slaver cities):
  - The norm sets `source = culture` and an *endorsement* that turns the group-norm brake **negative**.
  - It supplies the gaze for out-group targets (Property) and stock disengagement lines.
  - It provides *diffusion of responsibility* in group action. Individuals deviate: some raiders are squeamish (stress from acting against Compassionate-like traits), and some are worse than the norm.
- **Situational:** famine raises food pressure and the coercion ceiling for food. War removes guardians and so raises opportunity. A festival is a culturally licensed indulgence window (Pendragon's pagan feast). Captivity forces withdrawal (RimWorld/CK3 dungeon breaks).
- **Rivalry.** When several characters have `want ≥ 3` toward the same X:
  - `claim` escalates (interest → claimed).
  - Rivals' methods interact: one seduces while another sets a trap, and a third sabotages both.
  - Rivals can form coalitions (CK3 agents) or fight over the claim.
  - The *target's* guardians include rivals: a possessive claimant guards X against others.
- **Off-screen budget (anti-orbit).** At most N (2–3) characters may have the *hero* as their *active* appetite target in a given scene. The rest pursue appetites toward other NPCs, the world, or are sated. The species rule biases toward the hero but samples real alternatives, such as other travellers, captives taken by others, or rivals' mates.

### D8. Rendering to the LLM (compact, per character in scene)
Example lines:
- "Grukk (goblin raider): **appetite** plunder/captives, *driving* (4/5), culture-endorsed. **Toward Mira**: wants 4, regard −1 (contempt), sees her as **property** (loot to keep or sell). **Brakes**: chief's ban on raids near the road (chief absent); fears the hero's sword. **Method now**: *scheme 3/5*, separating her from the caravan at the ford at dusk. Justifies it: 'lowlanders leave their goods unguarded; taking is our right.'"
- "Seraphine (lamia): **mating drive** *preoccupied* (3/5), species-wide. **Toward the hero**: wants 4, regard +2, gaze mate-resource leaning possessive. **Method**: court (C3), jealous of rivals; would escalate to C5 (deceive) if refused twice."

Always add the constraint line: *"Desire ≠ affection. Satisfying or nearing an appetite does not raise regard. Show wanting through attention, calculation, preparation and justification, not through warmth. Prefer cunning (patience, deceit, leverage) over shouting."*

### D9. Pitfalls and guards
1. **Everyone orbits the player again, via appetite.** Use the off-screen budget, species intensity distributions with real zeros, alternative targets, and rivals pursuing each other. Most NPC appetites are about food, drink, coin, status and *other NPCs*.
2. **Romanticizing drift** (want → love, predator → devoted partner). Keep separate update channels for `want` and `stance`. Stance changes need a named reason. Affection onset is a species/individual parameter. Audit: if stance rose with no stance event, revert.
3. **Sanitized addiction** (one sip and fine, instant recovery, no relapse). Use the withdrawal floor, tolerance, AVE, incubation, and "seemingly irrelevant decisions" behaviour.
4. **Caricature / constant predation.** Use the Hofmann base rates: most desires are *not* enacted, especially when conflicting and observed. The act gate needs opportunity. High-control characters avoid cues. Show temptation and restraint as much as indulgence.
5. **Shallow villainy** (Too Good to be Bad). Specify method, tactics and justification. Deceit and patience are the default for Machiavellian or high-consequence-fear predators.
6. **Moralizing reversal** (the villain repents mid-scene). Gate remorse by the corruption track and the presence of a touchstone. Remorse happens at arc ends, not on demand.
7. **Stat soup.** Render 2–3 lines max per on-stage character. Words for pressure levels, no raw numbers.
8. **Graphic escalation.** The engine is about *motives and methods*. Narration of acts follows the user's content settings (elide or fade where configured). The data never needs explicit detail.
9. **Monoculture of methods.** Use method profiles and species style weights so ten monster girls do not all "ambush and drag to the lair".
10. **Hero always escapes / always caught.** Use clocks, secrecy and guardians to make outcomes depend on world state, not author fiat.

---

## Unverified / partly verified items (consolidated)
- V5 individual predator-type pools and costs (from fan wikis and memory). V5 compulsion details and exact remorse/degeneration wording.
- CoC lust-combat specifics. Lilith's Throne corruption gating of actions.
- MGE per-species approach styles (from general knowledge of the books; the wiki was not fetchable).
- Pathfinder vampirism catalyst and progression details.
- Kult *Sexual Neurosis* and the lower result bands for *Drug Addict*.
- The "Megumin Suite Inner Chatter desire field" could not be found.
- Hofmann 2012 numbers come from a reputable secondary summary (BPS Research Digest). The primary PDF was not accessible (403).
- Bandura's displacement, diffusion and distortion descriptions are from general knowledge.
