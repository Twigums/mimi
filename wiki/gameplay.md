# Gameplay Aspect of mimi

mimi is a gesture rhythm game played with a mouse, touch, or other pointer. The player moves through notes in time with the song inside an 800 x 600 logical play area.

The game uses one ruleset for every difficulty. Difficulty comes from chart density, rhythm, pathing, spacing, and note combinations.

## Notes

| Note | Meaning | Gesture |
|------|---------|---------|
| Cut | A directional slash target | Move through the target in the shown direction |
| Flow | A connected phrase of timed anchors | Keep a continuous motion through the phrase path |
| Lyric | A sung character or vocal accent | Hold the cursor inside the larger circle for the lyric's duration |

No note requires holding a mouse button or key. The lyric hold is a *position* hold — keep the pointer inside the circle — not a button press. If a future note requires a press, it should be a distinct note type with its own visual language.

All note types gradually appear as the song approaches their hit time. Cut and flow notes start as faint outlines and fill with color as the hit time approaches. Lyric notes show a dotted circle; the character stroke appears early and fills inward from a growing radial clip as the hit time approaches. While a lyric is being held, a progress ring sweeps around it, bright while the cursor is inside and dim while the hold lapses without it.

## Note Eligibility

The game does not use notelock. Every pending note whose hit time is within the early timing window is eligible for consideration on each frame. A note stops being eligible once it is hit or missed. Notes more than 160 ms in the future are not considered yet, and cut notes can remain pending briefly after the timing window while their gesture metrics are finalized.

A pointer path that stays outside a note's contact zone does not immediately judge that note. The note stays pending until a qualifying path appears or the note expires.

Overlapping notes can therefore be judged by the same pointer motion when that motion satisfies each note. Charting should avoid accidental overlaps unless a simultaneous gesture is intended.

## Cut Judgement

Cut notes start with a timing tier, then gesture quality can cap the final result. The final result is the lowest tier allowed by timing, contact, direction, and travel.

| Tier | Timing | Score weight |
|------|--------|--------------|
| Tier 3 | +/- 40 ms | 100% |
| Tier 2 | +/- 80 ms | 90% |
| Tier 1 | +/- 160 ms | 50% |
| Miss | outside +/- 160 ms, or invalid gesture | 0% |

| Gesture metric | Tier 3 | Tier 2 | Tier 1 | Miss |
|----------------|--------|--------|--------|------|
| Direction error | <= 25 degrees | <= 45 degrees | <= 70 degrees | > 70 degrees |
| Contact distance | <= 45 logical px | <= 75 logical px | <= 110 logical px | > 110 logical px |
| Travel | >= 40 logical px | >= 24 logical px | >= 8 logical px | < 8 logical px |
| Path straightness | >= 0.85 | >= 0.65 | >= 0.40 | < 0.40 |

Calculation of gesture metrics observes the cursor movement through a "judgement window" (currently +/- 240 ms for each, but can be tweaked per metric) and algorithmically selects the optimal start/end points to judge as the cut. This is because the player may perform multiple gestures within the window at higher densities.

- "Optimal" is chosen greedily based on tier, and starting at +0ms (the note's exact time), the engine will end early to give feedback on a judgement as early as it knows the player can't do any better for that note.
- A cut also finalizes the moment its gesture has "settled" — the pointer has left the contact zone — because a better-timed re-cut is then implausible. This keeps feedback (hitsound and visuals) from lagging behind an early cut instead of waiting for the timing window to lapse. The earliest a cut may settle this way is `max(note_time - Tier 1 window, previous_note_time)`: never before the note's own Tier 1 (Good) window opens (earlier than that no result is even a non-miss, so a sweep leaving the zone sooner is not yet this note's gesture), and never during the previous note's territory, so at higher densities a motion sweeping toward an adjacent note cannot claim this note early.
- Direction error is the angle between the note arrow and the gesture direction formed by the chosen start/end points.
- Contact distance is the closest distance achieved between the note center and the player's pointer path within the chosen gesture, calculated using the data points that lie between the chosen start/end points. Note that the interaction zone is intentionally larger than the visible note.
- Travel is the distance between the chosen start/end points.
- Path straightness is the net displacement between the chosen start/end points divided by the actual path length walked between them (1 for a perfectly straight slash, lower the more the path wanders or doubles back). It forces the scored gesture to be **one coherent stroke**, so contact and direction cannot be borrowed from different motions inside the window: any slice that passes the note while reversing scores low here. This is what makes a backward or flailing swipe fail — a clean forward stroke through the note still scores, but a pass that doubles back cannot be dressed up as a slash by the window's endpoints. Reported in the Gesture issue slot alongside travel.
- There is currently no accounting for the duration between the chosen start/end points. It can be incorporated later if needed for tuning, but this decision naturally makes travel requirements easier for beginners, as higher densities prevent spending a full judgement window on a gesture for a single note.

## Flow Judgement

Flow timing is more lenient than cut, and the gesture metrics are deliberately more forgiving too, so a continuous motion through a phrase doesn't demand cut-level precision at each anchor. Flow anchors are grouped into phrases explicitly, not by timing: consecutive flow anchors form one phrase until a `break` (or a non-flow note) ends it and the next anchor starts a new phrase. The anchors of a phrase are read as a single shaped ribbon: the path drawn between consecutive anchors is the line the player traces. Each anchor is scored individually against that shape.

| Timing | Tier 3 | Tier 2 | Tier 1 |
|--------|--------|--------|--------|
| Cut | +/- 40 ms | +/- 80 ms | +/- 160 ms |
| Flow | +/- 70 ms | +/- 120 ms | +/- 160 ms |

Score weights and the Miss boundary match the cut table; only the perfect/great windows widen for flow (Tier 1 stays at +/- 160 ms).

Unlike a cut, a flow anchor has no single authored direction. The ribbon between consecutive anchors is a smooth curve, and the anchor is judged by how well the gesture **traces the local shape** of that curve rather than by hitting one angle. This is what makes flow feel different from cut: a continuous motion that follows the ribbon's bend scores well, while flicking across each anchor in an unrelated direction does not.

| Gesture metric | Tier 3 | Tier 2 | Tier 1 | Miss |
|----------------|--------|--------|--------|------|
| Contact distance | <= 45 logical px | <= 75 logical px | <= 110 logical px | > 110 logical px |
| Travel | >= 24 logical px | >= 12 logical px | >= 4 logical px | < 4 logical px |
| Shape error | <= 60 degrees | <= 75 degrees | <= 100 degrees | > 100 degrees |

Shape error compares the gesture and the ribbon as **heading sequences**: each is resampled along its length into a fixed number of segments, and the error is the average angle between the matching segments. Because it uses only headings, it measures the *shape* of the motion (its direction and how it bends) and is independent of position — staying near the anchor is the separate contact metric. The perfect threshold stays generous (a following motion keeps full credit through curves and corners), but the great/good boundaries are deliberately tight: a sweep ~60 degrees off the ribbon lands in Tier 1, not Tier 2, and motion further off (~70+ degrees, including a perpendicular or backward trace) misses, so flailing across anchors cannot farm Greats. A lone flow anchor with no linked neighbours has no ribbon shape, so it is judged on its own motion alone, free of any heading constraint. The shape error depends only on the player's own motion, never on how a neighbouring anchor was judged, so one weak anchor does not cap the rest of the phrase.

Contact currently uses the same thresholds as cut while flow contact is being tuned. Travel still requires real motion through the anchor.

The ribbon between anchors is a smooth curve whose heading at each anchor is the tangent to that curve. By default the tangent is derived automatically from the neighbouring anchors, but a chart may pin an anchor's tangent by authoring a `degrees` value (see the chart format), which forces the curve's heading there while the rest stay automatic.

## Lyric Judgement

A lyric note is a **hold**: the player keeps the cursor inside the (larger) lyric circle for the duration of the note. A single lyric note can stand in for multiple sung syllables; they should not be charted for very short durations.

The hold lasts from the note time **until the next event in the chart strictly after it** — there is no default and no cap. That bounding event is whichever comes first: the **next note** (any kind) or an explicit **lyric-end marker** (the `end` chart line, which lets a hold end where no playable note sits). Charts control hold length by where that following event sits. "Strictly after" means a note charted on the lyric's own beat (for instance a cut leading into it) does not collapse the hold to zero. A lyric with no later note or marker cannot be bounded and is an invalid chart: it is logged and judged as a miss rather than given a fabricated duration. Because the hold ends where a note can be charted on the same beat, the required hold is slightly shorter than the nominal duration (an early-release grace), so the player has time to leave for that next note without losing the hold.

Lyric notes use the same timing tiers and score weights as cut. They have no direction. The three remaining metrics map onto the shared issue buckets:

| Gesture metric | Issue | Meaning |
|----------------|-------|---------|
| Enter timing | `timing` | When the cursor enters the circle, relative to the note time. Being present at or before the note start is on time; only a late entry is penalized. |
| Contact distance | `contact` | The closest the pointer gets to the center over the hold window (did you reach the note, not just its edge). Same thresholds as cut: <= 45 / <= 75 / <= 110 logical px. |
| Hold completeness | `gesture` | The fraction of the required hold actually sustained, measured as the longest contiguous span the cursor stays inside the hold radius. Tier 3 >= 95%, Tier 2 >= 80%, Tier 1 >= 55%. Releasing early caps the result here. |

The final result is the lowest tier allowed by the three metrics, and the reported issue is the binding one in the shared priority order. A clean hold is Tier 3 with no issue. The hold finalizes (for feedback) as soon as the outcome can no longer improve — the moment the cursor leaves the circle, the full hold completes, or the window elapses — so feedback lands on the beat the hold ends rather than waiting out the duration.

Lyric notes display the Japanese characters sung during the hold: every TextAlive character whose start time falls in the note's epsilon-adjusted hold window (so one note shows the 1–4 syllables it covers), unless the chart provides an explicit character override. The window starts 20 ms before the note time so a character rounded slightly before the lyric start is included. It ends 20 ms before the hold end, so a character within 20 ms of the bounding event (the next note or `end` marker) is excluded and belongs to the next boundary. Adjacent lyric windows therefore partition the syllables with no overlap. If no vocal character falls in the window, the note shows nothing and a warning is logged before play.

## Scoring

Accuracy is based on earned score weight divided by the maximum possible score weight.

```
accuracy = earnedWeight / maxWeight
```

Grade thresholds:

| Grade | Accuracy |
|-------|----------|
| SSS | 100% |
| SS | >= 99% |
| S | >= 95% |
| A | >= 85% |
| B | >= 70% |
| C | >= 50% |
| F | < 50% |

## Combo

Tier 3 and Tier 2 results preserve combo. Tier 1 and Miss break combo.

## Feedback

Hit feedback should be sensory first. Stronger hits should produce brighter visual bursts and fuller sounds. Lower accepted hits should be smaller or softer. Results include max combo, average timing offset, early/late counts, and a breakdown of imperfect hits by tier, note kind, and issue (see Completion Screen), without making the playfield depend on reading judgement text.

## Approach Rate

The approach rate controls how far in advance notes become visible before their hit time. It is configurable from the options panel.

- Range: AR 1-20
- Default: AR 10
- AR 1-10: `2000 - (ar - 1) * (1000 / 9)` ms
- AR 10-20: `1000 - (ar - 10) * (700 / 10)` ms

The setting persists across sessions.

## Music Offset
A player-configurable timing offset (set from the **Timing** section of the options panel) shifts the song position used for note judgement relative to the audio, compensating for audio/display latency. The offset is applied to the position fed to the game each tick and to break-skip targeting.

- **Range:** −5000 ms to +5000 ms in 10 ms steps (default: 0 ms; values within one step of zero snap to 0)

The setting persists across sessions.

## Play Flow and Break Skipping

Gameplay starts from an intentional player gesture on the game surface, such as a click, tap, or keyboard input. The song page does not keep a persistent play/stop button over the chart. If browser media rules block the first playback request, the game surface may continue to present a start affordance until another gesture successfully starts the song.

When a chart contains no-note spans of at least 3 seconds, the game may offer a Skip or Finish action. This applies to the intro before the first note, gaps between notes, and the outro after the final note. Break skipping must always require an intentional player action. Skips must preserve enough lead-in for the next note to approach visibly and safely within the judgement window. Seeking over a no-note gap must not generate misses; note judgement resumes from the normal TextAlive player position after the seek.

## Mods

| Mod | Effect |
|-----|--------|
| Hidden | Notes show only their outline; fill animation is suppressed. Lyric notes keep the stroke outline and dotted circle. |

Mod states persist across sessions.

## Hitsound

A short sound plays on accepted hits. Higher-quality hits may use a fuller or brighter response than lower-quality hits.

## Story File

An optional per-difficulty `.story` file at `src/songs/<name>/<difficulty>.story` controls storyboard highlights, character position overrides, and manual lyric segments. It is compiled to `songs/<name>/<difficulty>.story.json` and loaded at runtime alongside the matching chart.

Each non-blank, non-comment line is one entry:

| Format | Meaning |
|--------|---------|
| `h, time1, time2` | Highlight the storyboard character whose time falls within `[time1, time2]` with the technicolor effect while the song position is also in that range |
| `m, time, x, y` | Within the current phrase, move characters at time >= `time` into a separate vertical segment at logical coordinates `(x, y)` |
| `l, from, to, x, y, text[, char_time1, char_time2, ...]` | A self-contained manual lyric segment, independent of TextAlive: appears at `from` ms, fades out at `to` ms, positioned at logical `(x, y)`; `text` is the lyric string and each optional `char_time` is the ms when the next character activates |

Times are in milliseconds. `x` and `y` use the 800 x 600 logical play area.

## Completion Screen

When the song ends, a results overlay appears inside the game area. It displays grade, score, accuracy, a judgement breakdown, and actions for Share, Try Again, and Back.

The breakdown accounts for every imperfect hit (Great, Good, Miss) across three linked dimensions: by tier, by note kind (cut / flow / lyric), and by issue. The **issue** is the single binding constraint that held the hit below Tier 3 — the lowest-scoring gesture metric for that hit. There are four issue buckets:

| Issue | Meaning |
|-------|---------|
| Timing | Timing was the limiting factor (the hit landed outside the higher tier's window) |
| Contact | The pointer path did not pass close enough to the note |
| Direction | The slash angle was too far from the note's arrow |
| Gesture | The stroke itself was the limit: a cut's travel/slash distance, a flow's traced shape, or a lyric's hold completeness |

Every note kind can produce a Timing, Contact, or Gesture issue. Direction applies to cut only — lyric notes have no direction, and a flow anchor's heading is folded into its shape, which reports as a Gesture issue. There is no separate travel, flow, continuity, or hold issue; cut travel, flow shape, and lyric hold completeness all surface as Gesture.

The three dimensions are cross-linked: hovering any cell scopes the other two dimensions to the hits matching it.
