# Gameplay Semantics Tuning Plan

Status: gameplay design proposal, awaiting feedback before implementation.
Date: 2026-06-07.

This plan is for the gameplay tuning PR whose goal is to make mimi easier to understand quickly, more accessible on first contact, and still satisfying for experienced rhythm-game players chasing precision.

## Design Thesis

mimi should get players to the good part of rhythm games faster: learning what the game expects, executing it, and feeling the music answer back.

The current game has the right core instinct: rhythm should be expressed through cursor motion, not keyboard lanes. The problem is that its verbs are still inherited from an earlier version of the design. "Click" no longer means click, "stream" mostly means "same swipe but hold a button", and judgement currently asks whether a single frame crossed a geometric line. That makes the game playable, but not fully coherent.

The proposed direction is to treat mimi as a small gesture-rhythm game. Notes should ask the player to perform readable musical motions: cut through a directional target, flow through a connected phrase, or touch a lyric accent. The implementation should judge the gesture as a short motion phrase with timing, contact, direction, and commitment, then answer with visual and audio feedback.

The result should be a single ruleset that feels fair from Easy through Expert. Difficulty should come from chart density, rhythm vocabulary, pathing, spacing, and note combinations, not hidden judgement changes.

## Design Goal Priorities

The design priorities are split into gameplay design and player feedback. Gameplay design comes first because it defines what the player is actually doing; player feedback exists to make those rules legible, satisfying, and learnable.

### Gameplay Design

#### 1. Make every note type have a physical meaning

The player should not have to remember arbitrary input flags. If a note type exists, it should ask for a different kind of musical motion: cut through an arrow, flow through a phrase, or catch a lyric accent. Those notes can judge different qualities, but only because the physical verbs are genuinely different.

Why: the removed click requirement made the old click-vs-stream distinction weak. Keeping meaningless distinctions makes the game harder to learn and harder to chart well. Lyric notes already prove that mimi wants note-specific physical contracts; the rest of the ruleset should be just as honest about what each note is asking the player to do.

#### 2. Judge gestures, not isolated collisions

A hit should be based on a short motion phrase around the note: approach, contact, direction, travel, and follow-through.

Why: a rhythm game about cursor movement should reward intentional motion. A one-frame center crossing is easy to implement, but it does not describe why a swipe felt good or bad.

#### 3. Make anti-mashing emerge from gesture quality

Random motion should not be optimal because it lacks timing, contact, direction, and follow-through, not because the game silently ignores most inputs.

Why: good anti-mash design should make sloppy play visibly and audibly low quality. It should not make the rules feel brittle.

#### 4. Separate acceptance from mastery with one ruleset

The outer successful window should be broad enough to keep a beginner in the song, while the top judgement remains strict enough for expert play. That acceptance/mastery split should be the same on every difficulty: timing windows, gesture thresholds, scoring, and grade math should not change between Easy, Normal, Hard, and Expert.

Why: beginners need flow and trust; experienced players need a ceiling. Layered judgements let both coexist, and a single ruleset keeps the meaning of those layers stable. Players should be able to trust that an A on Easy and an A on Hard use the same engine; difficulty should be authored in the chart, not smuggled into the rules.

### Player Feedback

#### 5. Make feedback sensory first, textual second

The player should primarily feel the result through burst shape, color, brightness, sound, timing nudge, and result breakdown. Text labels can exist, especially for beginners, but they should not be the main teaching channel.

Why: judgement words on a busy playfield are not the fun part. Good feedback should be readable in peripheral vision and audible in rhythm.

#### 6. Make grades match player intuition

For a player on an appropriate chart, A should mean "I played well", B should mean "okay, but clearly rough", and C should mean "I did not really get it yet."

Why: grades are emotional feedback. If grade thresholds do not match player self-assessment, results feel arbitrary even when the math is consistent.

## Research Pass 1 Notes

This pass looked at English, Japanese, and Chinese sources. The point is not to copy another game's numbers. Layered timing is standard in music games; the useful part is how different games separate participation, score precision, physical intention, anti-mashing, and player feedback.

### Broad Lessons

- Layered timing is the norm. Rhythm games commonly use nested judgement bands so that a broad successful hit can coexist with a much stricter top judgement. The design question for mimi is not whether to layer timing, but what each layer means emotionally and competitively.
- Leniency works best when it preserves musical flow while still recording low-quality execution. A forgiving outer band can help beginners stay in the song, but it should not collapse into high score value.
- Anti-mashing is not just strictness. Some games punish, consume, or visibly label poor hits, which can make random input less useful than simply ignoring it until something happens to line up.
- Feedback is a teaching surface. FAST/LATE indicators, judgement detail displays, and result breakdowns are common because they help players connect a miss or lower judgement to a specific correction.
- Note-type semantics matter. Good music-game leniency is often attached to the physical intention of a note type, not applied as one universal "make everything easier" slider.
- Beginner accessibility can come from charting before rules. Lower density, clearer rhythms, readable pathing, and fewer ambiguous gestures may matter more than widening every judgement.
- Flow research is directionally useful but not prescriptive. The relevant takeaway is that clear goals, clear feedback, and challenge matched to skill are more important than exact numeric strictness at this stage.

### Game References

- osu! / osu!mania documents nested timing windows and mode-specific judgement rules. This is useful as a baseline example of standard layered timing, not as a model for mimi's learning curve. Sources: [osu! hit window](https://osu.ppy.sh/wiki/en/Gameplay/Hit_window), [osu!mania judgement](https://osu.ppy.sh/wiki/en/Gameplay/Judgement/osu%21mania).
- Chunithm is relevant because it combines generous broad success with high-score precision and note-type-specific physical contracts. AIR/AIR-ACTION style leniency, ExTAP-style guaranteed high judgement, and configurable FAST/LATE detail are all useful design references. Sources: [Chunithm gameplay guide](https://chunithm.org/basic/gameplay/), [Chunithm timing guide](https://chunithm.org/basic/timing/), [Chunithm settings guide](https://chunithm.org/basic/settings/).
- maimai exposes FAST/LATE and judgement-display options, reinforcing that timing feedback belongs close to play rather than only in hidden scoring math. Source: [maimai official update notes](https://info-maimai.sega.jp/3737/).
- Arcaea result screens and scoring culture put meaningful attention on early/late and judgement breakdowns, supporting the idea that post-song feedback should teach calibration and consistency. Source: [Arcaea scoring](https://arcaea.fandom.com/wiki/Scoring).
- ITG/StepMania's poorer outer judgements are a useful anti-mashing example. Community documentation notes that disabling bad-hit windows can make mashing easier, because sloppy inputs are no longer consumed as poor judgements. Source: [ITG judgements](https://itgwiki.dominick.cc/en/software/stepmania-judgements).
- Milthm's Chinese documentation has a useful note-type lesson: some holds care that a finger remains on screen after the initial hit, not that it stays exactly over the note. This is a good example of making the intended physical action clearer and less fussy without removing rhythm-game skill. Source: [Milthm judgment system](https://milthm.com/wiki/hans/manual/judgment/).
- Flow and motor-learning research supports the broad direction of matching challenge to skill and giving clear feedback, but it should not be treated as a source of timing-window numbers. Source: [Flow Experiences During Visuomotor Skill Acquisition](https://pmc.ncbi.nlm.nih.gov/articles/PMC6530424/).

### Open Research Threads

- Japanese arcade design writing around beginner onboarding, especially for Chunithm, maimai, and Sound Voltex.
- Chinese and Taiwanese rhythm-game community writing on "anti-mash" design and beginner chart readability.
- Korean rhythm-game sources for DJMAX, EZ2ON, and arcade rhythm games; this pass did not yet surface a strong primary or semi-primary source worth anchoring the RFC around.
- Any postmortems or interviews about note-type design, not just timing-window documentation.

## Research Pass 2 Notes: Gesture Quality

This pass focuses on the basic physical question for mimi: if the player is asked to make a directional cursor motion, what does it mean for that gesture to be executed well?

The natural parallel is Beat Saber, but the goal is not to copy Beat Saber's scoring formula. The useful question is broader: how do motion-based rhythm games make a gesture feel good, readable, and worth rewarding?

### Broad Lessons

- A good gesture is usually judged as a motion phrase, not a single geometric instant. Timing matters, but the satisfying object is the whole action: preparation, contact, follow-through, and recovery into the next gesture.
- Directional accuracy should describe intent. For a cutting gesture, "well" usually means the player committed to the shown direction with enough motion before and after the note. It should not feel like the game only cared about crossing one invisible plane.
- Aim can matter, but aim should match the fantasy. If the fantasy is "cut through this note," closest approach to the note center can be one signal. It should not become the entire skill unless the game is explicitly an aiming game.
- Motion energy matters. A tiny twitch in the correct direction may satisfy a mathematical check, but it rarely feels like a good cut. Several gesture games reward or require enough swing, punch, trace, or body movement to make the action legible.
- Follow-through is a design tool. Beat Saber explicitly rewards pre-cut and post-cut swing; even outside Beat Saber, motion games tend to make gestures feel better when the player is encouraged to move through the target rather than stop on it.
- Charting and scoring are inseparable. A scoring model can only reward satisfying gestures if the chart gives the player enough setup, space, and recovery to perform them.
- Unconventional gesture games often use note-type-specific expectations. A punch, trace, hold, pose, air raise, flick, and cut can all be rhythm gestures, but "well-executed" means different things for each.
- Lenient gesture success can coexist with stricter gesture quality scoring. The game can accept a broad, readable motion while reserving top judgement for cleaner direction, fuller motion, better timing, and stronger flow.

### Game References

- Beat Saber scores cuts from multiple motion qualities: pre-cut swing, post-cut swing, and center accuracy. The exact formula is not the point for mimi; the important lesson is that Beat Saber rewards a committed slicing gesture instead of only checking whether the saber touched the cube. Sources: [Beat Saber scoring guide](https://bsmg.wiki/ranking-guide.html), [Beat Saber mapping guide](https://bsmg.wiki/mapping/basic-mapping.html), [PlayStation interview on Beat Saber feel](https://blog.playstation.com/2019/06/27/how-the-beat-saber-devs-make-their-game-feel-so-fun/).
- Pistol Whip separates shot timing from shot accuracy. This is useful because it treats rhythmic execution and spatial execution as distinct axes instead of pretending one timestamp can describe the whole action. Source: [Pistol Whip scoring breakdown](https://pistolwhip.zendesk.com/hc/en-us/articles/6588435452692-Scoring-Breakdown).
- Audica combines rhythmic shooting with target aim. Its lesson for mimi is similar to Pistol Whip: when the game asks for spatial skill, aim/proximity can be scored separately from timing rather than hidden inside one hit/miss gate. Source: [Audica scoring guide](https://steamcommunity.com/sharedfiles/filedetails/?id=1725944274).
- Synth Riders distinguishes taps, holds, rails, walls, and force-style hits. It is useful because its gestures include continuous following and larger body movement, not just discrete impact timing. Source: [Synth Riders gameplay update notes](https://store.steampowered.com/news/posts/?appids=885000&enddate=1601575020&feed=steam_community_announcements).
- Chunithm has note types whose physical meanings differ sharply: taps, holds, slides, flicks, AIR notes, and AIR-ACTION notes. This supports treating mimi's note types as different physical contracts rather than one universal hit test. Source: [Chunithm gameplay guide](https://chunithm.org/basic/gameplay/).
- Fantasia: Music Evolved is useful as a design-process reference because it treats gestures as expressive conducting/remixing motions, not just binary input. Its lesson is that gesture prompts can be musical affordances: the player should feel invited into the motion before being graded on it. Source: [Fantasia design interview](https://www.sidequesting.com/2014/10/breathing-magic-into-disney-fantasia-music-evolved-interview-with-lead-designer-jonathan-mintz/).
- OhShape asks players to match body silhouettes, punch notes, and dodge walls. Its lesson is that full-body rhythm games often grade whether the player's pose or movement fits the presented physical idea, not whether a single point crosses a line. Source: [OhShape official site](https://ohshapevr.com/).
- Samba de Amigo is an older but useful gesture reference: shake direction, pose, and musical timing are bundled into playful maraca performance. It reinforces that "correct" can mean performing a readable musical gesture, not just hitting a target. Source: [Samba de Amigo: Party Central overview](https://samba-de-amigo.fandom.com/wiki/Samba_de_Amigo%3A_Party_Central).
- Fruit Ninja is not a music game, but it is a useful reference for cut satisfaction. The satisfaction comes from a visible continuous slice through an object, the separation response, and comboable follow-through. For mimi, the relevant idea is that a cut feels good when the game responds to the motion as a whole.

### Implications For mimi

- The basic directional note should reward a convincing directional motion through the note, not only a plane-crossing timestamp.
- Timing may be better understood as the placement of the gesture's impact or peak commitment near the musical moment, rather than the exact frame where the cursor crosses an invisible center plane.
- Gesture quality likely has several qualitative ingredients:
  - temporal placement near the beat or lyric
  - clear directional intent
  - enough travel or velocity to feel committed
  - close enough contact with the note to satisfy the visual promise
  - follow-through past the note
  - recoverable flow into the next note
- Aim should probably be a quality component, not the whole definition of success. If the player makes a satisfying slash near the note, the game should feel like it understood the attempt even when it scores the execution lower.
- The chart has to set up satisfying gestures. Directional notes need approach space, exit space, and sequence flow; otherwise even a good scoring model will make the player perform cramped corrections instead of musical motion.
- Different note types can ask for different kinds of "well." A lyric note might reward expressive timing and contact more than angle. A flow phrase might reward continuity through a path. A directional cut note might reward direction, travel, and follow-through.
- This reframes anti-mashing: random motion should not be optimal because it lacks readable direction, timing placement, commitment, and flow, not because the hitbox is arbitrarily strict.

### Open Gesture Questions

- For a directional note, what moment should feel like the musical "impact": first contact, closest approach, center crossing, peak speed, or a weighted center of the whole motion?
- Should mimi display notes in a way that invites preparation and follow-through, not just target acquisition?
- Should a basic note have separate qualitative feedback for timing, direction, and contact, or would that be too noisy?
- How much physical travel should count as a committed gesture on mouse, touch, and trackpad?
- How much should the game reward follow-through if charts may later become dense?
- What does a satisfying "miss" look like, where the player recognizes that the game understood the gesture but marked it as too weak, too off-angle, or too early/late?

## Current Implementation Snapshot

The current engine behavior is simple and readable:

- `Perfect`: +/- 32 ms, 5 points.
- `Good`: +/- 100 ms, 2 points.
- `Miss`: anything outside the good window, 0 points.
- Click and stream notes require the cursor segment to cross the note from behind to past the arrow direction.
- Stream notes require an action hold; click notes do not.
- Lyric notes require swiping through the lyric radius, with no direction or hold requirement.
- Directional notes use a +/- 30 degree angle tolerance.
- Directional notes use a 42 logical px hit radius; lyric notes use 28 logical px.
- Timing is scored with the frame's `songMs`, not an interpolated cursor crossing timestamp.
- Feedback says only `perfect`, `good`, or `miss`; it does not say early/late, angle, or distance cause.
- `wiki/how_to_map.md` still says +/- 45 degree tolerance, while `wiki/gameplay.md` and code say +/- 30 degrees.

## Proposed Ruleset

This section is intentionally concrete enough to implement and criticize. The numbers are first-pass targets, not sacred constants.

### 1. Cut note timing tiers

Start cut notes with three successful timing tiers plus miss. Labels can be renamed or hidden; the important thing is that each tier has a distinct score, visual effect, and audio response.

| Internal tier | Timing window | Score weight | Player meaning |
|---------------|---------------|--------------|----------------|
| Tier 3 | +/- 30 ms | 100% | Locked in. This is the precision ceiling. |
| Tier 2 | +/- 60 ms | 90% | Clearly good play. |
| Tier 1 | +/- 120 ms | 50% | Correct idea, rough execution. |
| Miss | outside +/- 120 ms, or invalid gesture | 0% | The note's timing or physical contract was not satisfied. |

Why these numbers:

- The current top window is +/- 32 ms, so the strict ceiling stays familiar.
- The old accepted window was +/- 100 ms, so +/- 120 ms keeps the first version a little lenient.
- Three successful tiers are enough to separate strong, good, and accepted play without pretending the first gesture-quality model can perfectly rank every nuance.
- Lyric and flow notes can start by sharing the same score weights, but this chart is specifically the first cut-note timing contract.

Accuracy should be `earnedWeight / maxWeight`, not raw point sum divided by a magic constant. Existing grade thresholds can remain the first implementation target:

| Grade | Accuracy |
|-------|----------|
| SSS | 100% |
| SS | >= 99% |
| S | >= 95% |
| A | >= 85% |
| B | >= 70% |
| C | >= 50% |
| F | < 50% |

This makes A achievable on Easy when the player mostly hits Tier 2/Tier 3 with some Tier 1, while B and C still communicate roughness.

### 2. Gesture quality can cap the timing tier

Timing picks the best possible tier. Gesture quality can cap it downward or turn it into a miss.

This is the key shift from the current engine. A player who crosses at the perfect time with a tiny sideways twitch did not perform the note well. A player who makes a real cut slightly late should get an accepted result and useful feedback.

For the first implementation, keep gesture quality deliberately simple. Timing sets the starting tier, then cut notes apply three independent caps:

| Quality | Used by | Meaning |
|---------|---------|---------|
| Contact | cut, lyric | Closest distance from the gesture path to the note center. |
| Direction | cut | Difference between the gesture direction and the arrow direction. |
| Travel | cut, lyric | How far the pointer moved during the gesture phrase. |

Final tier should be the minimum of the timing tier and each quality cap. This is a simple AND-style model: a Tier 3 timing hit only stays Tier 3 if contact, direction, and travel all qualify for Tier 3. If any quality only qualifies for Tier 1, the final result is Tier 1. If any required quality is invalid, the note is a miss.

Cut metrics should be calculated from the motion phrase around the note impact:

- Impact time: interpolated time at the closest approach to the note center, using pointer samples rather than the current animation frame.
- Contact distance: closest distance from the pointer path to the note center during the timing window.
- Direction error: angle between the arrow direction and the pointer displacement across the phrase.
- Travel: pointer distance across the phrase. Follow-through can be recorded for tuning, but should not cap the first implementation.

This intentionally avoids a weighted multi-factor score for now. The first version should be readable, tunable, and lenient enough to survive noisy mouse, trackpad, and touch input.

### 3. Retire "click" as a gameplay concept

Existing `click` notes should become `cut` notes in the design language. A cut is a directional slash through a target. It does not require a mouse click or button hold.

Cut contract:

- The cursor motion phrase must pass through the target region.
- The impact time is interpolated from the cursor trajectory, not approximated by the current animation frame.
- The motion must have enough travel to read as a cut.
- The motion direction must broadly match the arrow direction.
- Follow-through improves quality; lack of follow-through can cap the result.

Initial numeric targets:

| Dimension | Tier 3 cap | Tier 2 cap | Tier 1 cap | Miss if |
|-----------|------------|------------|------------|---------|
| Direction error | <= 25 degrees | <= 45 degrees | <= 70 degrees | > 70 degrees |
| Contact distance | <= 45 logical px | <= 75 logical px | <= 110 logical px | > 110 logical px |
| Travel | >= 70 logical px | >= 40 logical px | >= 20 logical px | < 20 logical px |

Why: this preserves the original "slash in the shown direction" idea while dropping the obsolete click vocabulary.

### 4. Replace button-hold stream semantics with flow semantics

Existing `stream` notes should become `flow` notes. A flow phrase is a connected run of timed anchors that asks the player to keep moving through a path. It should not mean "do the same cut while holding a mouse button."

Flow contract:

- Each anchor uses the same global timing tiers.
- The phrase rewards continuity between anchors.
- The player should be able to read the intended path from visuals before the phrase begins.
- Breaking the path, stalling, or teleporting the cursor caps later anchors until motion becomes coherent again.
- Button hold is not required. If we later want a true hold/press mechanic, it should be introduced as a separate note type with a clear visual language.

First implementation option:

- Keep the existing chart schema temporarily.
- Treat consecutive `stream` notes as a flow phrase when they are close enough in time.
- Draw a subtle ribbon between upcoming anchors.
- Score each anchor individually, but add a continuity cap based on movement from the previous anchor.

More radical later option:

- Add an explicit `flow` chart object with a start time, end time, path, and sampled ticks.
- Judge continuous path following instead of only judging anchor crossings.

Why: this gives the old stream idea a real musical purpose. It becomes about flow, not about an arbitrary input state.

### 5. Keep lyric notes directionless, but make them expressive

Lyric notes should remain directionless because their fantasy is different: touch the sung character or vocal accent, not cut an arrow.

Lyric contract:

- The cursor motion phrase must pass through the lyric interaction circle.
- Timing and contact determine the base tier.
- Direction does not matter.
- Commitment still matters; a stationary cursor sitting on the glyph should not earn high judgement.
- The feedback should visually bloom from the character, not reuse arrow-cut effects unchanged.

Why: lyric notes are a good reason to let note types have different semantics. They should feel like catching or brushing the lyric, not like a directionless version of an arrow.

### 6. Candidate-based hit resolution

The current engine tries to resolve a note every frame using only the current pointer segment. The proposed implementation should instead maintain a small input history and resolve gesture candidates.

Implementation shape:

1. Keep a ring buffer of pointer samples: logical x/y, song time, wall time, held state if needed later.
2. For pending notes inside the outer timing window, detect candidate contact events.
3. Compute an interpolated impact time from the trajectory.
4. Keep improving the candidate until the note window closes or the candidate is clearly final.
5. Resolve the note once with timing tier plus gesture quality caps.
6. Store detail stats: timing offset, early/late, contact quality, direction quality, commitment quality, final tier.

This allows the engine to understand a gesture as a phrase rather than a single frame. It also gives a principled anti-mash behavior: random movement creates low-quality candidates instead of repeatedly fishing for a perfect segment.

Feedback delay should be kept short. A candidate can produce immediate contact feedback, then final judgement feedback within the outer window. If that feels mushy in practice, resolve earlier for simple cut and lyric notes while keeping the same data model.

### 7. Feedback model

During play, feedback should be mostly sensory:

| Result dimension | Feedback direction |
|------------------|-------------------|
| Higher tier | brighter burst, cleaner shape, fuller hitsound |
| Lower accepted tier | smaller burst, softer or duller hitsound |
| Early | burst leans or ticks slightly before/left of the note's timing accent |
| Late | burst leans or ticks slightly after/right of the note's timing accent |
| Direction issue | cut spark shears or fragments against the arrow direction |
| Contact issue | burst appears off-center or incomplete |
| Miss | target dissolves or cracks without the normal hit sound |

Text labels can remain as an accessibility/beginner option, but the default design should not depend on reading judgement words.

Results should show the learning signal that is too noisy for the playfield:

- judgement tier breakdown
- average timing offset
- early vs late count
- direction/contact/commitment issue counts
- max combo, if combo remains

If most low-tier hits are early or late, the result screen can gently point toward music offset calibration.

### 8. Combo and score

Score and accuracy should be the primary performance signal. Combo can stay, but it should not carry the whole meaning of mastery.

Recommended first implementation:

- Tier 3 and Tier 2 preserve combo.
- Tier 1 breaks combo but still awards low score.
- Miss breaks combo.

Why: this makes combo a cleaner signal without making barely accepted hits feel identical to misses. This is also easy to revisit after playtesting.

Alternative to test:

- All accepted tiers preserve combo.
- Add a separate "clean combo" or "top chain" stat for mastery.

### 9. Charting must carry difficulty

The same rules should feel different across difficulties because charts ask different things.

Easy charting should use:

- fewer simultaneous concepts
- larger spacing between gestures
- repeated direction patterns
- lyric notes as readable anchors
- flow phrases that teach motion continuity
- simple rhythms that let the player self-correct

Harder charting should add:

- denser rhythms
- faster direction changes
- tighter pathing
- longer flow phrases
- more off-beat lyric accents
- recovery demands after misses or low-quality gestures

No chart should rely on hidden leniency changes.

## Implementation Plan

### Phase 1: Engine vocabulary and stats

- Replace `perfect/good/miss` with three accepted tiers plus miss.
- Add per-hit detail data: timing offset, early/late, note kind, quality caps, and miss reason.
- Rework accuracy to use score weight over max weight.
- Keep the old labels mapped temporarily in the UI so this can ship incrementally.

### Phase 2: Pointer sample buffer and interpolated timing

- Store recent pointer samples with song timestamps.
- Compute contact/intersection time by interpolation.
- Stop using the current frame's `songMs` as the hit timestamp.
- Keep the old hit detection available behind a temporary flag until the new resolver is stable.

### Phase 3: Cut and lyric gesture quality

- Implement cut candidates with direction, contact, commitment, and follow-through caps.
- Implement lyric candidates with timing, contact, and commitment caps.
- Remove ordinary hold requirement from directional gameplay.
- Tune first-pass constants using existing charts.

### Phase 4: Flow phrases

- Group existing `stream` notes into phrases.
- Add ribbon visuals and continuity scoring.
- Remove the current stream hold requirement.
- Decide whether the chart schema needs explicit `flow` objects.

### Phase 5: Feedback and results

- Add tier-specific visual and audio feedback.
- Add early/late and quality issue data to results.
- Make text judgement labels optional or visually secondary.
- Update mapper docs once the rules feel stable.

## Open Questions For Feedback

- Should Tier 1 break combo, or should all accepted hits preserve combo while score/accuracy carry the distinction?
- Should flow phrases remain anchor-based for this contest version, or should we jump straight to explicit continuous path objects?
- Are the proposed timing windows too lenient at the outer edge, or does the low 50% weight make that acceptable?
- Should lyric notes be allowed to trigger from a stationary cursor if the player intentionally placed it early, or should every note require motion?
- Should cut follow-through be required for validity, or only used as a quality cap?
