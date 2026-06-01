# How to Map a Song

A chart is a JSON file containing an array of `Note` objects. Place it under `src/songs/<song-id>/` and reference it via the `song-chart` field in the song's markdown frontmatter.

Charts may be authored in the osu! editor using linear sliders and converted with `npm run convert:osu`. See `README.md` for the command. The osu play area (512×384) is scaled to fit inside the mimi canvas (800×600) — both are 4:3, so the scale factor is uniform (1.5625×) with no offset. The direction of each note is the angle of the osu slider from its start point `(x, y)` to its linear endpoint `(cx, cy)`, expressed in standard math convention (CCW from right, y-axis pointing up). This requires negating the osu y-component before taking `atan2`, since osu uses screen coordinates (y increases downward).

## Chart Header Metadata

`.mimi` chart files begin with header fields before the first blank line. The home screen reads this header to build the difficulty selector.

| Field | Required | Meaning |
|-------|----------|---------|
| `bpm` | Yes for beat-timed charts; recommended for all charts | Song BPM shown in the song list and used when `time_unit` is `beat` |
| `time_unit` | No | `ms` or `beat`; defaults to `beat` |
| `offset` | Yes when `time_unit` is `beat` | First beat time in milliseconds |
| `difficulty` | Recommended | Numeric difficulty level shown on the difficulty badge |
| `ar` | Optional | Chart-recommended approach rate, AR 1-20 |

The difficulty selector also computes note count, click/stream/lyric breakdown, playable length, and note density from the note rows. If `ar` is not present, the selector should display AR as unavailable rather than assuming the player's current setting or a default.

## Note Format

```typescript
{
  kind:      "click" | "stream",  // note type (see below)
  time:      number,              // hit time in milliseconds from song start
  x:         number,              // horizontal position, 0–800 (left → right)
  y:         number,              // vertical position, 0–600 (top → bottom)
  direction: number,              // swipe direction in radians (see below)
  state:     "pending"            // always "pending" in chart files
}
```

## Coordinate System

The play area is a logical 800 × 600 canvas. (0, 0) is the top-left corner.

```
(0,0) ──────────────── (800,0)
  │                        │
  │   usable: ~80–720 x    │
  │            ~80–520 y   │
  │                        │
(0,600) ──────────── (800,600)
```

Keep notes away from edges — the game uses an 80 px padding margin on all sides.

## Note Kinds

| Kind | Use when |
|------|----------|
| `"click"` | Single isolated hit — one syllable standing alone |
| `"stream"` | Part of a rapid sequence — multiple syllables in one word/burst |

## Direction

Direction is a swipe angle in **radians**, measured clockwise from the right (standard Math convention):

```
        -π/2  (up)
          │
  π ──────┼────── 0   (right)
          │
        +π/2  (down)
```

Common values:

| Angle | Direction |
|-------|-----------|
| `0` | → right |
| `Math.PI / 2` | ↓ down |
| `Math.PI` or `-Math.PI` | ← left |
| `-Math.PI / 2` | ↑ up |
| `Math.PI / 4` | ↘ down-right |
| `-Math.PI / 4` | ↗ up-right |

The player must swipe **through the center of the note** in this direction while holding a key or mouse button. A tolerance of ±45° is accepted.

## Timing from TextAlive

Open the TextAlive portal for your song to get character/word start times. The `startTime` of each character (in ms) is what goes into the `time` field. Round to the nearest 10 ms if needed — the hit window is ±100 ms for a Good, ±32 ms for a Perfect.

The song's TextAlive lyric data (via the `textalive-lyric-id` frontmatter field) gives you phrase → word → character timings in this shape:

```
phrases[
  words[
    chars[ { startTime, endTime }, ... ],
    ...
  ],
  ...
]
```

Use those `startTime` values directly as `time` in each note.

## Minimal Example

```json
[
  { "kind": "click",  "time": 4200,  "x": 400, "y": 200, "direction": 0,           "state": "pending" },
  { "kind": "click",  "time": 4800,  "x": 560, "y": 320, "direction": -0.785,      "state": "pending" },
  { "kind": "stream", "time": 5100,  "x": 300, "y": 400, "direction": 1.571,       "state": "pending" },
  { "kind": "stream", "time": 5300,  "x": 300, "y": 500, "direction": 1.571,       "state": "pending" }
]
```
