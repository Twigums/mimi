# Gameplay Aspect of mimi

This file will explain everything on the gameplay aspect of mimi, specifically for all songs. This includes the core gameplay, mechanics, and gameplay visuals.

The gameplay will officially support these dimensions:
- Monitor: 1920 x 1080 px

## Core Gameplay
This is a rhythm game that focuses on mouse movement and accuracy. Notes appear in relation to the beats in the selected song. The goal of the player is to accurately hit the notes and complete the song.

The game should feel satisfying and rhythmic. The margins for the judgement window and the acceptable range of angles are the defining factor in making the gameplay feel satisfying.

A good analogy is comparing this gameplay to Beat Saber, where note hitting is determined by swiping (slashing in Beat Saber).

The TextAlive song information should be from `/wiki/6W2N_chorus_timings.jsonc`.
The TextAlive API token to use is: N6S7A1HvahiwDLUg.

## Notes
There are three different types of notes in the game:
- Click: A red note with a specified direction. The direction can be defined in any direction in the 360 degrees around the note.
- Stream: A series of blue notes (> 1) with specified directions. The directions can be defined in any direction in the 360 degrees around each note. The notes in the stream should have directions orientated in a manner that would be feasible for a human player to properly hit them.
- Lyric: A directionless note displaying the Japanese character from the TextAlive lyrics closest in time to the note (within ±80 ms). If no vocal character falls within that window, the note is invisible and a warning is logged before play. The character appears first as a stroke outline, then fills inward from a growing radial clip — identical timing to the arrow fill animation. Hit by swiping through the character with the cursor (no direction requirement, no hold required).

Directions will have an acceptable margin of error window, so the player can hit the note successfully from a range of angles. A successful hit is defined as moving from behind the note to past the arrow in the specified direction while a key is held (or dragged for touchscreen devices). When the cursor reaches the center of the note is when the judgement is called and a score is obtained for that hit if it is a successful hit.

The hold requirement differs between note types. Stream notes require the mouse button (or touch) to be held when the cursor crosses the note; click notes and lyric notes do not require holding.

All types will appear and disappear in the same way. They will gradually appear as the song progresses. Each note will appear as a faint outline at first, and click/stream notes fill with color as the hit time approaches (defined by the judgement window). Lyric notes show a dotted circle throughout; the character stroke snaps into view early and fills inward from a growing radial clip as the hit time approaches.

## Judgement Window
The judgement window is the acceptable margin of error for valid hits. Score is determined by when a note is correctly hit relative to the judgement window. The judgement window and scores are defined as such:
- Perfect: +/- 32 ms  -> 5 points
- Good:    +/- 100 ms -> 2 points
- Miss:    otherwise  -> 0 points

## Scoring
Scoring is simply defined as the sum of points obtained by the player according to the judgement window by the end of the song.

A live score counter is displayed in the game area and updates on each hit.

## Combo
A combo counter tracks consecutive successful hits (perfect or good). It increments on each successful hit and resets to zero on a miss. The current combo is displayed in the bottom-left of the game area.

## Accuracy and Grade
At the end of a song, an accuracy percentage and letter grade are computed.

**Accuracy formula:**
```
accuracy = (perfect × 5 + good × 2) / (total × 5)
```

**Grade thresholds:**
| Grade | Accuracy |
|-------|----------|
| SSS   | 100%     |
| SS    | ≥ 99%    |
| S     | ≥ 95%    |
| A     | ≥ 85%    |
| B     | ≥ 70%    |
| C     | ≥ 50%    |
| F     | < 50%    |

## Approach Rate (AR)
The approach rate controls how far in advance notes become visible before their hit time. It is configurable by the player from the options panel.

- **Range:** AR 1–20 (default: AR 10)
- **Window formula (piecewise linear):**
  - AR 1–10: `2000 - (ar - 1) × (1000 / 9)` ms → 2000 ms at AR 1, 1000 ms at AR 10
  - AR 10–20: `1000 - (ar - 10) × (700 / 10)` ms → 1000 ms at AR 10, 300 ms at AR 20

The setting persists across sessions.

## Play Flow and Break Skipping

Gameplay starts from an intentional player gesture on the game surface, such as a click, tap, or keyboard input. The song page does not keep a persistent play/stop button over the chart. If browser media rules block the first playback request, the game surface may continue to present a start affordance until another gesture successfully starts the song.

When a chart contains long spans with no notes, playback skips those breaks automatically. This applies to the intro before the first note, gaps between notes, and the outro after the final note. Skips must preserve enough lead-in for the next note to approach visibly and safely within the judgement window. Seeking over a no-note gap must not generate misses; note judgement resumes from the normal TextAlive player position after the seek.

## Mods
Mods are optional gameplay modifiers toggled from the options panel under the **Mods** section.

| Mod    | Effect |
|--------|--------|
| Hidden | Notes show only their outline; the fill animation is suppressed. For lyric notes, the character fill is suppressed (stroke outline and dotted circle remain visible). |

Mod states persist across sessions via `localStorage`.

## Angular Tolerance
The acceptable margin of error for swipe direction is **±30°** (π/6 radians) from the note's specified direction.

## Hitsound
A short sound plays on every successful hit (perfect or good).

## Story File (`.story`)

An optional per-song `.story` file (`src/songs/<name>/chart.story`) controls storyboard highlights and character position overrides. It is compiled by Hakyll to `songs/<name>/chart.json` and loaded at runtime alongside the chart.

Each non-blank, non-comment (`#`) line is one entry:

| Format | Meaning |
|--------|---------|
| `h, time1, time2` | Highlight the storyboard character whose time falls within `[time1, time2]` with the technicolor effect while the song position is also in that range |
| `m, time, x, y` | Within the current phrase, all characters at time ≥ `time` break off into a separate vertical segment positioned at logical coordinates `(x, y)` (800 × 600 space) |

Times are in milliseconds. `x`/`y` use the same 800 × 600 logical coordinate space as chart notes.

Example:
```
# highlight chorus lyric
h, 62500, 63200

# drop last two chars of phrase to center-right
m, 63000, 550, 300
```

## Completion Screen
When the song ends, a results overlay appears inside the game area. It displays:
- Letter grade (color-coded)
- Total score
- Accuracy percentage
- Breakdown of perfect, good, and miss counts

Three actions are available: **Share** (shares the result), **Try Again** (resets playback), and **Back** (returns to the home tab).
