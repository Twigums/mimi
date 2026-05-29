# Gameplay Semantics Tuning Plan

Status: planning RFC, to be committed before implementation.
Date: 2026-05-29.

This plan is for the gameplay tuning PR whose goal is to make mimi easier to understand quickly, more accessible on first contact, and still satisfying for experienced rhythm-game players chasing precision.

## Design Goal

mimi should get players to the good part of rhythm games faster: learning what the game expects, executing it, and feeling the music answer back.

The game should be contest-friendly and accessible by default. A first-time player should be able to finish a beginner chart and understand why each note did or did not work. An experienced rhythm-game player should be able to read the mechanic quickly, trust the judgement, and find a precision ceiling that cannot be reached by random mashing.

## Design Principles

- Leniency should protect song flow; precision should protect mastery.
- The player should always know the verb: cross the note, on time, in the shown direction when direction exists.
- Non-perfect feedback should teach the next attempt, not just punish the current one.
- Difficulty should come primarily from chart density, pathing, rhythm, and note combinations. Stricter semantics may exist, but only through visible profiles or difficulty rules.
- Extra input should be harmless when it is not solving the chart, but noisy movement should not produce high scores.
- Accessibility assists should reduce physical barriers without hiding what the game expects.

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
- Different note types can ask for different kinds of "well." A lyric note might reward expressive timing and contact more than angle. A stream note might reward continuity and hold intention. A directional cut note might reward direction, travel, and follow-through.
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

## Proposed Semantics

### 0. Reward the gesture, not just the collision

The basic directional note should be understood as a small musical gesture: prepare, move through the note in the shown direction, and continue enough for the action to feel intentional.

Success should correlate with how satisfying that gesture feels. A strict center-plane crossing is probably too arbitrary to be the whole definition of timing or quality. The semantic target is broader: did the player perform a clear, timely, directional motion that interacted with the note in a way the visual language promised?

### 1. Separate acceptance from precision

A note should have two questions:

1. Did the player's gesture satisfy the note?
2. If yes, how accurately did it satisfy the note?

This lets beginner play stay musical without giving away expert scores. A late but intentional swipe can keep the song moving, while top results still require noticeably tighter timing and cleaner gesture execution.

For now, describe judgement bands qualitatively:

| Band | Meaning |
|------|---------|
| Top judgement | Very accurate timing and clean gesture. This is the precision ceiling. |
| Strong judgement | Clearly correct play, but not top precision. |
| Accepted judgement | The player understood and performed the note well enough to stay in flow. |
| Poor accepted judgement | The player was close enough to learn from it, but the result should have low value and should not feel competitively good. |
| Miss | The player did not satisfy the note's timing or physical intention. |

The exact number of judgement bands, names, score values, and combo behavior are intentionally undecided.

### 2. Make gesture validity intentional

Keep the current "cross through the note" contract, but define it in one place:

- Directional notes: the pointer segment must cross the note center plane from behind to past the arrow direction.
- Lyric notes: the pointer segment must pass through the lyric interaction circle.
- The movement segment must exceed a small distance threshold.
- Directional notes must have enough projected movement in the note direction, not just sideways jitter.
- Stream notes require a clear held-action intention.

This keeps broad timing from turning into all-out mashing.

### 3. Tune gesture tolerance without hidden surprise

If tolerance differs by difficulty or note type, it should be visible to the player and map author. A player should not have to reverse-engineer why the same physical motion behaves differently.

Beginner-friendly tolerance can be relatively wide, especially for note types where the main skill is rhythm and motion rather than exact angle. Higher-level play can demand cleaner timing, cleaner direction, denser patterns, and more intentional holds.

### 4. Feedback must teach

Every non-top successful hit should eventually expose at least timing direction:

- early
- late
- close but low quality

Miss feedback should eventually distinguish the likely cause:

- too early
- too late
- did not cross the note cleanly
- wrong or unclear direction
- missing hold intention

The goal is not to flood the player with labels. The goal is for the player to understand the next correction.

### 5. Results should show learning signal

Add lightweight summary data after the song:

- average timing offset for resolved notes
- early vs late count
- judgement breakdown for all tiers

If most non-perfects are early or late, the results screen can point players toward the existing music offset setting later. This should be phrased as calibration help, not blame.

## Deferred Implementation Work

Implementation details are intentionally paused until the semantics feel right. Do not lock in exact timing windows, score values, combo rules, profile tables, or engine refactors from this document yet.

## Workshop Questions

- Do we want the new judgement names `Perfect`, `Great`, `Good`, `Near`, `Miss`, or should `Near` be called something more encouraging?
- Should poor-but-accepted hits preserve combo on beginner charts, or should combo remain a clearer mastery signal?
- Should early difficulties use visibly wider gesture tolerance, or should all difficulties share gesture tolerance and rely mostly on charting?
- Should note types carry different tolerance philosophies, like Chunithm-style generous action notes versus stricter intentional swipe notes?
- What first-run target feels right for the contest entry: "a new player can finish" or "a new player can finish with a C/B while understanding how to improve"?

## Next Research Passes

- Chunithm-specific pass: note types, beginner onboarding, judgement display, and why it feels lenient without being trivial.
- Anti-mashing pass: how music games consume bad input, break combo, drain life, or otherwise prevent random input from becoming optimal.
- Beginner charting pass: density, pathing, repetition, rhythm vocabulary, and how much the chart can teach without changing engine rules.
- Feedback pass: what information should appear during play versus on the results screen.
