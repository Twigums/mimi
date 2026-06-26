# osu2mimi

Converts an osu! standard `.osu` beatmap into a mimi `.mimi` chart.

```bash
npm run --silent convert:osu -- [--difficulty N] [--bpm N] [--beats-per-measure N] path/to/file.osu > out.mimi
```

The osu play area (512×384) is scaled into mimi's 800×600 logical area, preserving aspect ratio.

## Input map (the contract)

The mimi note **kind** is chosen explicitly from each hit object's **type** and **hitsound** — there is no cut-vs-flow auto-detection. Direction, where a kind needs one, always comes from a slider's geometry.

| osu hit object | hitsound | → mimi note | direction | position |
|----------------|----------|-------------|-----------|----------|
| slider | whistle | `cut` | from the slider's opening (head → first curve point) | head → first-point **midpoint** |
| slider | (none) | `flow` | pinned to the slider's opening | head → first-point **midpoint** |
| hitcircle | (none) | `flow` | `auto` (runtime ribbon tangent) | head |
| hitcircle | clap | `lyric` | n/a (lyrics ignore direction) | head |
| slider | clap | `lyric` **+ `end` marker** | n/a | head; hold ends at the slider tail |

Rules and edge cases:

- **clap wins**: a clap hitsound makes the object a `lyric` regardless of type.
  - A **clap hitcircle** is a lyric with **no end override** — its hold runs to the next note in the chart (mimi's default lyric bound).
  - A **clap slider** is a lyric with an **end-time override**: its slider duration is converted to an `end, <time>` marker emitted at the slider's tail, so the hold ends there instead of at the next note. The clap slider's **body shape is irrelevant** (only the head time, slider duration, and tail time matter) — author it as a short, distinctive shape, or set it on a **low-SV inherited timing point**, so it's easy to pick out and edit in the osu editor. If the slider's duration can't be computed (no tempo / no length) the converter warns and the lyric falls back to the next-note bound.
  - Adding a **finish** to either clap form flags the lyric `endchar` (see below).
- **whistle = cut**, but a cut needs a direction, so it must be a **slider**. A whistle on a bare hitcircle has no direction — it is imported as `auto` flow and a warning is printed to stderr.
- **cut/flow sliders sit at the midpoint** of the head and the first curve point (sliders are expected to be **linear**, so this is the slider's centre). Direction still runs head → first point. Plain circles and lyrics stay at the head.
- **finish marks a lyric's closing syllable.** A `finish` added to a **clap** (i.e. on a lyric) emits the `endchar` flag on the row, which extends the lyric's char-fetch window past its hold end to include the syllable sung as the hold finishes. `finish` on a non-clap object is ignored.
- **Spinners and holds are skipped.**
- **New combo = phrase break.** An object with osu's new-combo flag emits a `break` line before it, which ends the previous flow phrase. Flow phrases are otherwise just runs of consecutive `flow` anchors (a non-flow note also ends a phrase; inert `end` markers do not). This is how phrasing is encoded in the chart rather than inferred from timing.
- **Same-time ordering.** When events share a time, they are emitted `end` marker → cut/flow → `lyric` last, so a cut leading into a lyric precedes it and a lyric's hold extends to the next strictly-later event rather than collapsing on a note charted on its own beat.

## Output

A `.mimi` chart: a small header (`time_unit: ms`, optional `bpm`/`difficulty`, `beats_per_measure`) followed by `kind, time_ms, degrees, x, y` rows, with `break` lines between flow phrases and `end, time` lines bounding clap-slider lyric holds. A `finish`-marked lyric row carries a trailing `endchar` flag. `degrees` is a number for `cut`/pinned-`flow`, or `auto` otherwise. See `wiki/how_to_map.md` for the full chart format.

---

# lyrictrace

Traces what the lyric char-population logic does to a compiled chart's lyric notes, against a **mocked** TextAlive video — no live API or browser needed. It reuses the real runtime functions (`makeCharLookup`, `computeLyricHolds`, `populateLyricChars`), so the output reflects exactly what the engine produces at load time.

```bash
npm run --silent trace:lyrics -- [chart.json] [--chars chars.json] [--json]
```

- `chart.json` — compiled chart (default `docs/songs/kotaete/hard.json`).
- `--chars FILE` — real TextAlive timings to reconcile against the chart. Either **phrase-grouped** `[{ startTime, endTime, chars: [{ text, startTime, endTime }] }]` or a **flat** `[{ text, startTime, endTime }]` list. Without it, a small illustrative mock runs so the tool works out of the box.
- `--json` — emit the per-lyric trace as JSON instead of the readable report.
- `--help` — usage plus a browser-console snippet to capture the real char timings from the song page.

## What it shows

Per lyric note: its chart time/position, computed `holdMs` and bounding event, the exact epsilon-adjusted char window `[start - 20ms, end - 20ms)`, the auto-filled text, the chars selected (each with its offset from the note time), and the chars **just outside** the window with their offset to the window bounds. Because a chart's note times need not match the API's char `startTime`s exactly, those nearby-char offsets let an empty or wrong syllable be reconciled by eye.

It also reports a **dedup check**: the shipped `makeCharLookup` collects each char once, whereas the old unbounded cross-phrase walk re-collected later chars once per preceding phrase (a phrase-3 char three times) — the cause of the duplicated/garbled syllables this tool was written to diagnose.
