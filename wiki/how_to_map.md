# How to Map a Song

Each difficulty is a `.mimi` chart file under `src/songs/<song-id>/`, one file per difficulty.

```text
src/songs/<song-id>/easy.mimi
src/songs/<song-id>/medium.mimi
src/songs/<song-id>/hard.mimi
src/songs/<song-id>/expert.mimi
```

The site discovers those files automatically and compiles each `.mimi` file to JSON at build time.

## Header

`.mimi` chart files begin with header fields before the first blank line. The home screen reads this header to build the difficulty selector.

```text
bpm: 130
time_unit: ms
beats_per_measure: 4
difficulty: 4
ar: 10
```

| Field | Required | Meaning |
|-------|----------|---------|
| `bpm` | Yes for beat-timed charts; recommended for all charts | Song tempo shown in the song list and used when `time_unit` is `beat` |
| `time_unit` | No | `ms` for millisecond note times, or `beat` for beat numbers; defaults to `beat` |
| `beats_per_measure` | No | Meter metadata for tools and chart readability |
| `offset` | Yes when `time_unit: beat` | Millisecond time of beat 1 |
| `difficulty` | Recommended | Numeric level shown in the difficulty selector |
| `ar` | Optional | Chart-recommended approach rate, AR 1-20 |

The difficulty selector also computes note count, cut/flow/lyric breakdown, playable length, and note density from the note rows. If `ar` is not present, the selector should display AR as unavailable rather than assuming the player's current setting or a default.

## Note Rows

Rows are comma-separated.

```text
# kind, time, degrees, x, y[, char]
c, 4200, 0, 400, 200
s, 4800, -45, 520, 260
l, 5100, 0, 360, 310
```

| Field | Meaning |
|-------|---------|
| `kind` | `c` cut, `s` flow anchor, or `l` lyric |
| `time` | Note time in the header's `time_unit` |
| `degrees` | Direction in degrees; ignored for lyric notes |
| `x` | Horizontal position in the 800 x 600 logical play area |
| `y` | Vertical position in the 800 x 600 logical play area |
| `char` | Optional lyric character override |

The compiler emits runtime notes with `kind`, `time`, `x`, `y`, `direction` in radians, `state: "pending"`, and optional `lyricChar`.

## Note Kinds

| Kind | Use when |
|------|----------|
| `c` Cut | A standalone directional slash |
| `s` Flow | An anchor in a connected phrase; consecutive anchors within 700 ms are linked |
| `l` Lyric | A sung character or directionless vocal accent |

Cut and flow notes do not require a mouse-button or key hold. Flow notes should be placed so the player can read a continuous path through the phrase.

During migration, older charts may still use `f` for cut-style notes. Prefer `c` for new maps.

## Coordinate System

The play area is a logical 800 x 600 canvas. `(0, 0)` is the top-left corner.

```text
(0,0) ---------------- (800,0)
  |                        |
  |      main play area    |
  |                        |
(0,600) -------------- (800,600)
```

Keep notes away from the edges. As a starting point, stay roughly inside `80-720` on x and `80-520` on y unless a chart has a clear reason to go wider.

## Direction

Direction is written in degrees in screen coordinates:

```text
        -90  up
          |
  180 ----+---- 0  right
          |
         90  down
```

Common values:

| Degrees | Direction |
|---------|-----------|
| `0` | right |
| `90` | down |
| `180` or `-180` | left |
| `-90` | up |
| `45` | down-right |
| `-45` | up-right |

The compiler converts authored degrees to the runtime radian angle used by the game engine.

## Timing

When `time_unit: ms`, note times are milliseconds from song start. TextAlive character `startTime` values can be used directly.

When `time_unit: beat`, note times are beat numbers and require `bpm` plus `offset`.

Cut notes use these timing tiers:

| Tier | Timing |
|------|--------|
| Tier 3 | +/- 30 ms |
| Tier 2 | +/- 60 ms |
| Tier 1 | +/- 120 ms |

## osu! Conversion

Charts may be authored in the osu! editor using linear sliders and converted with:

```bash
npm run --silent convert:osu -- path/to/file.osu > src/songs/<song-id>/hard.mimi
```

The osu play area is scaled into mimi's 800 x 600 play area. Linear sliders become cut notes with direction taken from slider start to endpoint. Add lyric rows manually when a note should display a sung character or vocal accent.

## Minimal Example

```text
bpm: 130
time_unit: ms
beats_per_measure: 4
difficulty: 2
ar: 10

# kind, time, degrees, x, y
c, 4200, 0, 400, 200
c, 4800, -45, 560, 320
s, 5100, 90, 300, 400
s, 5300, 90, 300, 500
l, 5600, 0, 450, 300
```
