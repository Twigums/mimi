# osu2mimi

Converts an osu! standard `.osu` beatmap into a mimi `.mimi` chart.

```bash
npm run --silent convert:osu -- [--difficulty N] [--bpm N] [--beats-per-measure N] path/to/file.osu > out.mimi
```

The osu play area (512×384) is scaled into mimi's 800×600 logical area, preserving aspect ratio.

## Input map (the contract)

The mimi note **kind** is chosen explicitly from each hit object's **type** and **hitsound** — there is no cut-vs-flow auto-detection. Direction, where a kind needs one, always comes from a slider's geometry.

| osu hit object | hitsound | → mimi note | direction |
|----------------|----------|-------------|-----------|
| slider | whistle | `cut` | from the slider's opening (head → first curve point) |
| slider | (none) | `flow` | pinned to the slider's opening |
| hitcircle | (none) | `flow` | `auto` (runtime ribbon tangent) |
| any | clap | `lyric` | n/a (lyrics ignore direction) |

Rules and edge cases:

- **clap wins**: a clap hitsound makes the object a `lyric` regardless of type.
- **whistle = cut**, but a cut needs a direction, so it must be a **slider**. A whistle on a bare hitcircle has no direction — it is imported as `auto` flow and a warning is printed to stderr.
- **finish** is unused / reserved.
- **Spinners and holds are skipped.**
- **New combo = phrase break.** An object with osu's new-combo flag emits a `break` line before it, which ends the previous flow phrase. Flow phrases are otherwise just runs of consecutive `flow` anchors (a non-flow note also ends a phrase). This is how phrasing is encoded in the chart rather than inferred from timing.

## Output

A `.mimi` chart: a small header (`time_unit: ms`, optional `bpm`/`difficulty`, `beats_per_measure`) followed by `kind, time_ms, degrees, x, y` rows, with `break` lines between flow phrases. `degrees` is a number for `cut`/pinned-`flow`, or `auto` otherwise. See `wiki/how_to_map.md` for the full chart format.
