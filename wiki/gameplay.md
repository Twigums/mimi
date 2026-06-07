# Gameplay Aspect of mimi

mimi is a gesture rhythm game played with a mouse, touch, or other pointer. The player moves through notes in time with the song inside an 800 x 600 logical play area.

The game uses one ruleset for every difficulty. Difficulty comes from chart density, rhythm, pathing, spacing, and note combinations.

## Notes

| Note | Meaning | Gesture |
|------|---------|---------|
| Cut | A directional slash target | Move through the target in the shown direction |
| Flow | A connected phrase of timed anchors | Keep a continuous motion through the phrase path |
| Lyric | A sung character or vocal accent | Brush through the lyric target; direction does not matter |

No ordinary note requires holding a mouse button or key. If a future note requires a press, it should be a distinct note type with its own visual language.

All note types gradually appear as the song approaches their hit time. Cut and flow notes start as faint outlines and fill with color as the hit time approaches. Lyric notes show a dotted circle; the character stroke appears early and fills inward from a growing radial clip as the hit time approaches.

## Cut Judgement

Cut notes start with a timing tier, then gesture quality can cap the final result. The final result is the lowest tier allowed by timing, contact, direction, and travel.

| Tier | Timing | Score weight |
|------|--------|--------------|
| Tier 3 | +/- 30 ms | 100% |
| Tier 2 | +/- 60 ms | 90% |
| Tier 1 | +/- 120 ms | 50% |
| Miss | outside +/- 120 ms, or invalid gesture | 0% |

| Gesture metric | Tier 3 | Tier 2 | Tier 1 | Miss |
|----------------|--------|--------|--------|------|
| Direction error | <= 25 degrees | <= 45 degrees | <= 70 degrees | > 70 degrees |
| Contact distance | <= 45 logical px | <= 75 logical px | <= 110 logical px | > 110 logical px |
| Travel | >= 70 logical px | >= 40 logical px | >= 20 logical px | < 20 logical px |

The interaction zone is intentionally larger than the visible note. Visual size should communicate the target, not define the entire hitbox.

## Flow Judgement

Flow notes use the same timing tiers as cut notes. Each anchor is scored individually, and continuity through the phrase can cap later anchors when the pointer stalls, breaks path, or jumps between anchors without a readable motion.

## Lyric Judgement

Lyric notes use the same timing tiers and score weights. The player must move through the lyric interaction circle. Direction does not matter, but meaningful motion still matters; resting on the character should not earn a high result.

Lyric notes display the Japanese character from the TextAlive lyrics closest to the note time, within +/- 80 ms unless the chart provides an explicit character override. If no vocal character is close enough, the note is hidden and a warning is logged before play.

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

Hit feedback should be sensory first. Stronger hits should produce brighter visual bursts and fuller sounds. Lower accepted hits should be smaller or softer. Early/late and contact/direction issues should be available in result details without making the playfield depend on reading judgement text.

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

When the song ends, a results overlay appears inside the game area. It displays grade, score, accuracy, judgement breakdown, and actions for Share, Try Again, and Back.
