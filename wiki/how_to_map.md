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
# kind, time, degrees, x, y[, lyric_option...]
cut, 4200, 0, 400, 200
flow, 4800, -45, 520, 260
break
flow, 5000, auto, 300, 300
lyric, 5100, auto, 360, 310
lyric, 5400, auto, 410, 320, char=輝き, endchar
```

| Field | Meaning |
|-------|---------|
| `kind` | `cut`, `flow` anchor, or `lyric` (shorthands `c`/`f`/`l` also accepted) |
| `time` | Note time in the header's `time_unit` |
| `degrees` | Direction in degrees. Required for cut notes; ignored for lyric notes. For a flow anchor, write `auto` to derive the direction from the ribbon tangent (the normal case), or give a number to **pin** that anchor's tangent heading |
| `x` | Horizontal position in the 800 x 600 logical play area |
| `y` | Vertical position in the 800 x 600 logical play area |
| `lyric_option` | Optional lyric-only trailing tokens after `y`. Bare text or `char=<text>` overrides TextAlive's automatic lyric text; `span=N` takes N consecutive TextAlive characters into this one note; `src=<ms>` sources the funnel character from the TextAlive character at that timestamp instead of the note's own time; `endchar` extends the auto-fill text window past the hold end to include the closing syllable. Options can be combined in any order, for example `lyric, t, auto, x, y, char=輝き, endchar`. Older bare lyric overrides are still accepted, but new charts should use `char=` |
| `break` | A standalone line (not a note) that ends the current flow phrase; the next flow anchor starts a new phrase |
| `end` | An `end, time` line (no other fields): an inert lyric-end marker. It bounds a preceding lyric's hold at `time` without placing a playable note there, then is discarded. Use it to end a lyric where no note is charted |

The compiler emits runtime notes with `kind`, `time`, `x`, `y`, `direction` in radians, `state: "pending"`, and optional `lyricChar` / `lyricSpan` / `lyricSrcTime` / `includeEndChar`.

## Note Kinds

| Kind | Use when |
|------|----------|
| `c` Cut | A standalone directional slash |
| `f` Flow | An anchor in a connected phrase; consecutive flow anchors link until a `break` or a non-flow note ends the phrase |
| `l` Lyric | A directionless hold on a sung character (may cover several syllables) |

Cut and flow notes do not require a mouse-button or key hold. Flow notes should be placed so the player can read a continuous path through the phrase.

A lyric is a **hold**: the player keeps the cursor inside the circle from the note's time until the **next event strictly after it** — whichever comes first, the next note (any kind) or an explicit `end` marker. There is no default or cap, so **a lyric must not be the last event** (with nothing to bound it the engine logs an error and the note misses). Place the next note, or an `end, time` line, where the hold should end. Do not chart a lyric with less than roughly 300 ms before its bound, and pick one standout lyric per phrase rather than charting every word. The `degrees` field is unused for lyrics; the hold length is not authored as a row field. The displayed text auto-fills from every sung character in the hold window (use the `char=<text>` option only to correct it). A trailing `endchar` option on the row extends the text window past the hold end to include the closing syllable sung as the hold finishes.

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

The compiler converts authored degrees to the runtime radian angle used by the game engine. Cut notes always use the authored direction. A flow anchor with `auto` degrees derives its direction from the local ribbon tangent (the bisector of the chords to the neighbouring anchors), so chart the flow path by anchor positions and let the direction follow; supplying a number instead pins that anchor's tangent, which is useful for forcing the curve's heading at a chosen waypoint while the rest stay automatic.

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

Charts may be authored in the osu! editor and converted with:

```bash
npm run --silent convert:osu -- path/to/file.osu > src/songs/<song-id>/hard.mimi
```

The osu play area is scaled into mimi's 800 x 600 play area (spinners and holds are skipped). The note kind is chosen by the object type and its hitsound, so you author every kind directly in the osu editor:

| osu object + hitsound | mimi note |
|-----------------------|-----------|
| hitcircle (no special hitsound) | flow anchor, `auto` direction |
| slider (no special hitsound) | flow anchor, direction pinned to the slider's opening |
| slider with **whistle** | cut, direction from the slider's opening |
| **hitcircle** with **clap** | lyric (hold runs to the next note — no end override) |
| **slider** with **clap** | lyric **+ an `end` marker at the slider tail** (the slider duration sets the hold end) |

Cut and pinned flow take their direction from the slider, so use a slider for those; a whistle on a bare hitcircle has no direction and is imported as auto flow with a warning. **Cut and flow slider notes are positioned at the midpoint of the head and the first curve point** (sliders are expected to be linear), so author short linear sliders. A **clap slider** is how you author a lyric's hold end in osu: only its head time and duration matter (the body shape is ignored), so give it a distinctive shape or a low-SV inherited timing point to make it easy to spot. Adding the `finish` hitsound to a clap adds the lyric option `endchar`, extending its text window past the hold end to include the closing syllable; `finish` on a non-clap object is ignored. Consecutive flow anchors link into flowing phrases automatically.

## Lyrics and the Storyboard

Lyric notes pair with the TextAlive lyrics shown in the storyboard background. Each lyric note shows one or more characters; those characters **funnel** out of the displayed lyric and fly onto the note during its approach, and the displayed word **shines** the perfect-hit yellow once the note(s) covering it are hit.

### Funnel, fill, and word shine (golden notes)

This is the player-facing lyric feedback loop:

1. **Match** — at load time each lyric note claims one or more storyboard characters (see below). Those glyphs switch to **empty outlines** (`note-empty`).
2. **Funnel** — during the note's approach window, each mapped character **flies** from its storyboard position onto the note (multi-char notes launch in sequence, landing by hit time).
3. **Fill** — on a **hit**, that character's outline **fills** with the perfect-hit yellow (`note-filled`). On a **miss**, it stays empty.
4. **Word shine** — TextAlive groups characters into **words**. If you map notes onto some (not all) characters in a word, hitting **every mapped note** for that word shines the **entire word** gold, including unmapped syllables in the same word. Miss any mapped note and the word never shines.

Unmapped characters keep the normal sung animation (dim → active → sung) and never funnel.

### Overlapping phrases (lead + chorus)

TextAlive normally exposes one phrase at a time. When a song needs **concurrent** lines (lead vocal under chorus, or staff chorus timings that overlap the lead), set `lyric-chorus-timings: songs/<id>/chorus-timings.jsonc` on the song tab. The runtime merges staff chorus char timings as **overlay phrases** (`overlay: true`): the storyboard keeps the full lead line visible on the **right** while each active chorus line stacks on the **left**. Lyric **matching** still binds notes to chorus chars inside the chorus window; the lead glyphs remain visible for context but are omitted from matching in that window so notes do not grab the wrong line.

To reposition a stacked line manually, use a `.story` **`m`** move on that phrase's time range (see below). `h` highlights still apply per character; `x` excludes backing vocals from note matching without hiding them from the storyboard.

### How a lyric note gets its text

For each lyric note, in time order, the matcher resolves its source character **containment-first**: if the note's time falls inside a character's sung span, it sources that character and **shares** it (so several notes placed over one long-held character all source the same glyph); otherwise it claims the nearest **unclaimed** character within +/- 80 ms (so two notes near 自分 resolve to 自 then 分 instead of both grabbing 自). There are three ways to control the text:

| Form | Example row | Result |
|------|-------------|--------|
| Auto (no 6th field) | `lyric, 2000, auto, 400, 300` | Sources the character containing the note time (else nearest unclaimed) |
| Span | `lyric, 2000, auto, 400, 300, span=3` | Takes the source character plus the next 2 into this one note (a whole word funnels together) |
| Override | `lyric, 2000, auto, 400, 300, 自分` | Displays the literal text `自分`; sources from the character at the note time |
| Source timestamp | `lyric, 2000, auto, 400, 300, src=2350` | Sources the character at **2350 ms** (text = that character), regardless of the note time |
| Source + override | `lyric, 2000, auto, 400, 300, src=2350 がんばれ` | Sources the glyph at 2350 ms but displays the literal `がんばれ` |

The 6th field accepts these as space-separated tokens (`span=`, `src=`, and/or a literal). The override text can differ from the spoken character — if the lyric is 輝 and you map か, が, or やき onto it, that text funnels out of the **same** 輝 glyph. Use **`src=<ms>`** when a note's own time doesn't line up with the character you want to bring over: dump the lyric timestamps with `npm run dump:lyrics` (see `src/tools/README.md`) and copy the character's `start` value.

### Word shine

Shining happens at the TextAlive **word** level. If a word has several characters and you only map some of them, hitting **all** the mapped notes shines the **entire** word (including the unmapped characters); missing any of them leaves the word unshone.

### `.story` file

An optional `src/songs/<song-id>/<difficulty>.story` file (one per difficulty) drives storyboard highlights, position moves, lyric-match exclusions, manual lyrics, per-segment style, and reactive effects. Each non-blank, non-`#` line is one entry:

```text
# Highlight: technicolor the active character while in this time range
h, 62500, 63200

# Move: later characters of the current phrase jump to a new position
m, 63000, 550, 300

# Move with style directives (color, font, scale, entrance, motion, beat pulse)
m, 70000, 200, 420, color=#ff629d, font=handwriting, scale=1.4, in=grow, motion=sway, pulse=beat

# Exclude: keep backing-vocal characters in this range out of note matching
x, 80000, 82000

# Manual lyric: self-contained text, independent of TextAlive
l, 90000, 92000, 400, 300, またね, 90000, 90600, 91200

# Manual lyric, auto-timed from the TextAlive characters, rising out on exit
l, 95000, 97000, 400, 300, ありがとう, autotime, out=rise

# Reactive header: live song-map effects (any subset)
reactive: amplitude mood chorus
```

### Worked lyric examples

**Single character, override funnel.** Spoken lyric 輝 at t = 100-1100 ms; map か onto it:

```text
lyric, 600, auto, 400, 300, か
```

か funnels out of the 輝 glyph onto the note; hitting the note shines 輝.

**Partial word, whole-word shine.** Spoken word 帰って; map only 帰 and て (っ stays unmapped):

```text
lyric, 1000, auto, 360, 300, 帰
lyric, 1300, auto, 440, 300, て
```

帰 funnels first, て second; after both notes are hit the entire 帰って shines. Miss either and the word stays dim.

**Mixed single + multi-character funnel.** Spoken word おねがい; map お alone, then ねがい as one note:

```text
lyric, 2000, auto, 320, 300, お
lyric, 2400, auto, 460, 300, span=3
```

The first note funnels お; the second funnels ね, が, い together onto one note.

Lyric notes you do not map behave normally — they simply animate in the storyboard without funneling or shining.

### Kotaete chorus example

`kotaete.md` sets `lyric-chorus-timings: songs/kotaete/chorus-timings.jsonc` (Magical Mirai staff ms timings). During ~52–66 s the lead line *自分を重ねて聞いてた* and the two chorus lines *どれほどの苦しみも…* / *きっと私の目指す…* display together. Chart the chorus with `lyric` notes in that window; on hit, their glyphs funnel from the **left overlay line** and fill yellow, and word shine applies within each chorus word group defined in the jsonc.

## Minimal Example

```text
bpm: 130
time_unit: ms
beats_per_measure: 4
difficulty: 2
ar: 10

# kind, time, degrees, x, y[, lyric_option...]
c, 4200, 0, 400, 200
c, 4800, -45, 560, 320
f, 5100, auto, 300, 400
f, 5300, auto, 300, 500
f, 5500, 90, 300, 560
l, 5600, auto, 450, 300
```
