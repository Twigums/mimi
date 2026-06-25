# Lyric Hold Notes — Design Plan (issue #39)

## Source proposal

From the latest comment on issue #39 (vekt0r-github):

> proposal: lyric notes are *larger* circles, and their gesture is to *hold* your
> cursor there for (approximately) the duration of the sung lyric. a single lyric
> note can represent multiple syllables — i wouldn't chart one for less than ~300ms.
> - they will have distinct judgement logic and issue types ... decide first whether
>   this can fit into the four-category-issues framework the other two use.
>   - when writing this consider the time it takes to leave the note, i think we want
>     to make it lenient enough we can theoretically chart a close-by note on the
>     beat this ends.
>   - they can ideally use the TextAlive API to autodetect the string to include ...
>   - charting philosophy: pick one lyric per phrase that stands out, chart around it.

## Decisions (confirmed with the author)

1. **Hold end = the next note's time.** A lyric note is held from `note.time` until
   the time of the **next note in the chart** (any kind). The end is modelled as an
   end-time, and "until the next note" supplies it. There is **no new `.mimi` field**
   — this keeps blast radius minimal until the chart format is rewritten. The next
   note literally bounds the hold ("we're authoring hold end as a note type anyway").
2. **No default, no cap.** The hold is exactly the gap to the next note. There is no
   maximum (charters keep gaps reasonable) and no default: a lyric with **no following
   note cannot be bounded**, so it is an **invalid chart** — the engine logs an error
   and judges the note as a miss rather than inventing a duration. There is likewise no
   floor; if the next note is close the hold is short (a charting guideline — don't
   chart a lyric with <~300 ms to the next note — not an enforced constraint).
3. **The sung string auto-fills from the whole hold window.** A lyric's text is the
   concatenation of *every* TextAlive character whose start time falls in the note's
   epsilon-adjusted hold window (`[max(note.time − ε, prevEnd − ε), holdEnd − ε)`, with
   ε = 20ms). Chars within ε of the lyric start are included, while chars within ε of the
   hold end are excluded so they belong to the following boundary. One note therefore
   covers the 1–4 syllables sung during its hold. This is **deterministic** under a
   reasonable model of the TextAlive output (a fixed, time-ordered character list once the
   video is ready): the only inputs are the note's hold window and that list. The lower
   bound is clamped to the previous boundary minus ε so adjacent windows tile cleanly with
   no char claimed twice. Deriving the hold *duration* from TextAlive remains out of scope
   (the charter sets it via note placement).

## Judgement model

The old lyric behaviour judged a lyric like a directionless cut that **required
motion** (a brush-through). That is the opposite of a hold and is fully replaced.

A held lyric is judged by a new pure function `judgeHold(note, pointerSamples)` that
slots into `judgeGesture` (dispatched on `kind === "lyric"`), so the engine call site,
the `pending`/`judged` protocol, and the test harness are unchanged. It needs the hold
length, carried as `holdMs` on the note.

It maps cleanly onto the existing four issue buckets — **no new issue type**:

| Issue       | Lyric meaning                                                            |
|-------------|--------------------------------------------------------------------------|
| `timing`    | When the pointer **enters** the circle, relative to `note.time`.         |
| `contact`   | The **closest** the pointer got to the center (did you reach the note).  |
| `direction` | **N/A** — lyric notes have no direction (unchanged).                     |
| `gesture`   | **Hold completeness** — the fraction of the required duration held.      |

Metrics, in detail:

- **Enter / timing.** `enterMs` = first sample inside the hold radius within the
  timing window around `note.time`. `offsetMs = enterMs - note.time`, scored with the
  shared timing tiers (lyric uses the cut windows: ±40/±80/±160 ms). If the pointer
  never enters within the late window, the note misses (timing/contact).
- **Held span / gesture.** From `enterMs`, the longest **contiguous** span the pointer
  stays within `LYRIC_HOLD_RADIUS`, intersected with `[note.time, holdEnd]`, is the
  held duration. The required target is `holdMs - LYRIC_RELEASE_GRACE` (so the player
  may release a little early and reach a note charted on the beat the hold ends — the
  leniency the proposal asked for). `heldFraction = clamp(held / required, 0, 1)` is
  capped through `LYRIC_HOLD_TIER*` (tier3 ≥ 0.95, tier2 ≥ 0.8, tier1 ≥ 0.55).
- **Contact.** Closest distance to center over the window, capped through the cut
  contact tiers (≤45/≤75/≤110 px). Distinguishes a sloppy edge-hold from a centered
  one, independent of how long it was held.
- **Result** = `min(timing, contact, gesture)`; **issue** = first binding metric in
  the existing priority order (`timing → contact → direction → gesture`). A clean hold
  is Tier 3 with no issue.

**Finalization (pending vs judged).** Like cut's early-settle: once the pointer has
**released** (left `LYRIC_HOLD_RADIUS` after entering) the held fraction can no longer
improve, so the note finalizes immediately — this is what lets feedback land on the
beat the hold ends rather than lagging to `holdEnd`. It also finalizes when the held
fraction already reaches Tier 3, or at `holdEnd` (plus the metric-window grace) as a
backstop. Before the pointer ever enters, it stays `pending` through the late timing
window, then misses.

## Engine changes

- `Note` and `SpawnSpec` gain `holdMs?: number`.
- A `computeLyricHolds()` pass (run in `setChart`, after sort/normalize, alongside
  `linkFlowPhrases`) sets each lyric's `holdMs = nextNoteTime - time`. A lyric with **no
  next note** is left `holdMs = undefined` and logged as an invalid chart. `spawnNote`
  passes the caller's `spec.holdMs` straight through (no engine default); the testplay
  surface supplies an explicit preview length.
- An invalid (unbounded) lyric — `holdMs` undefined — is judged as a miss (`judgeHold`
  treats the missing length as a zero-length window) and drawn as a bare circle.
- Hit-window scan is unchanged: it breaks only on **future** notes (`n.time > songMs +
  TIER1_MS`); a hold whose start has passed keeps being tried each frame until it
  resolves.
- `expireMisses` backstop uses the note's **effective end** (`time + (holdMs ?? 0) +
  CUT_METRIC_WINDOW_MS`) so a long hold is not mass-missed at `time + window`.
- `draw` keeps a lyric on screen until `holdEnd`, drawing a **hold-progress ring**
  (fills `(songMs - note.time) / holdMs`) tinted by whether the pointer is currently
  inside, in addition to the existing approach animation before `note.time`.
- The pointer-sample ring buffer cap (256) is sized to span a reasonable hold plus the
  metric windows even at high refresh rates.
- The char lookup (`controller.ts`) becomes a **range query** — the text of every char
  whose start time is in `[startMs, endMs)`, concatenated — and `populateLyricChars`
  fills each lyric from its hold window.

## Visual

- `LYRIC_RADIUS` grows so the hold target reads as larger than before.
- `drawLyricNote` gains optional `holdProgress` / `holding` params for the progress
  ring; the approach/fill animation before the hit time is unchanged.

## Constants (initial values, tunable)

| Constant                     | Value   | Meaning                                            |
|------------------------------|---------|----------------------------------------------------|
| `LYRIC_HOLD_RADIUS`          | 110     | "Still holding" tolerance (gameplay px).           |
| `LYRIC_RELEASE_GRACE`        | 100     | Early-release window counted as a full hold.       |
| `LYRIC_HOLD_TIER3/2/1`       | .95/.8/.55 | Held-fraction tier thresholds.                  |
| `LYRIC_CHAR_BOUNDARY_EPSILON_MS` | 20  | Boundary tolerance for TextAlive char lookup.      |

The hold length itself has **no constant** — it is the gap to the next note, with no
default or cap.

## Update — explicit lyric-end marker (implemented)

The "dedicated release-marker note kind" below is now in. A new inert `end, time` chart
line bounds a lyric's hold where no playable note sits:

- **Format/compiler.** `ChartCompiler.hs` parses `end, time` into a minimal
  `{"kind":"end","time":…}`. No position/direction — it is not drawn or judged.
- **Engine.** `setChart` extracts `end` markers before normalization, feeds their times
  to `computeLyricHolds`, then discards them, so no non-playable kind leaks into
  judging/drawing/stats/`pendingStart`. `computeLyricHolds` now binds each lyric to the
  **nearest event strictly after it** across all note times + marker times (was
  `notes[i+1]`), which also makes the bound robust to same-time notes.
- **osu converter.** A clap **slider** emits the lyric + an `end` marker at the slider
  tail (duration from `SliderMultiplier` + timing points); a clap **circle** is just a
  next-note-bound lyric. Same-time events are ordered `end` → cut/flow → lyric.

## Out of scope / follow-ups

- TextAlive-derived hold *duration* (the string auto-fills from the hold window; the
  duration is set by note placement).
- "Miku singing" theming tie-in (post).
