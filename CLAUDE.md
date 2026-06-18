# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important Context

The user has defined important context for the final application within `/wiki`. All information in `/wiki` must strictly be prioritized during implementation. If you are in a state of confusion or uncertainty, you must check and refer to the files for facts (entry point at `/wiki/main.md`). When referencing any aspect of any file in `/wiki`, you must directly quote the stated fact. Do not alter any quote. Do not perform any changes to any files in `/wiki`. Note that the concepts and points mentioned in the files in `/wiki` may or may not be already implemented.

In any file you add changes to. Ensure that your changes optimize for code clarity and code efficiency. This means no useless code and no redefinitions. After all changes, make sure that `CLAUDE.md` and `/wiki` has the required changes to reflect the state of the repository.

Your changes to the repo will be graded on:

1. Whether your reasoning is accurate and based on facts.
2. Whether your code breaks other, unrelated portions of the repository.
3. Whether your code follows existing repo conventions.
4. Whether your changes are necessary and efficient.

## Commands
These commands are listed to establish context. You should assume that the user will run these commands after your changes. Do NOT run any following commands unless explicitly directed by the user.

### Build & Run

```bash
# Install Node dependencies and build Hakyll binary
npm run setup

# Generate site into docs/
npm run rebuild

# Watch for changes and rebuild
npm run watch

# Rebuild with sub-path (e.g. for GitHub Pages); also accepts --path /sub-path flag
SITE_PATH=/mimi npm run rebuild
# or: npm run rebuild:pages
```

### Haskell

```bash
# Required after any .hs file change, before rebuild/watch
stack build --system-ghc
```

## Architecture

### Build Pipeline

`site.hs` (entry point) defines all Hakyll rules. It imports modules from `src/`:

| Module | Purpose |
|--------|---------|
| `src/Config.hs` | Site-wide constants: `siteRoot`, `templateDir`, `tabPaths`, `textaliveToken` |
| `src/Compilers.hs` | `sassCompiler` (npx sass) and `tsCompiler` (npx esbuild) |
| `src/ChartCompiler.hs` | `chartCompiler` — compiles `.mimi` chart files into `Note[]` JSON |
| `src/StoryCompiler.hs` | `storyCompiler` — compiles `.story` storyboard files into JSON arrays of highlight/move/lyric entries |
| `src/Context.hs` | `postCtx` — adds `root` and `date` fields to Hakyll context |

### Content Structure

- `src/tabs/` — Top-level pages. `home.md` → `index.html`, `kotaete.md` → `kotaete/index.html`, etc.
- `src/songs/<name>/` — Per-song assets. `.mimi` chart files compiled to `.json`; optional per-difficulty `.story` files compiled to `.story.json`; other files copied verbatim
- `src/templates/` — Hakyll HTML templates: `home.html`, `song.html`, `lang_toggle.html`, `theme_toggle.html` (sun/moon light-dark switch), `settings_toggle.html`, `imports.html`, `sitemap.xml`
- `src/scss/` — SCSS partials; `default.scss` is the entry point, imports all `_*.scss` partials
- `src/ts/main.ts` — TypeScript entry point, compiled to `js/main.js`
- `src/ts/core/` — Shared primitives (no inter-island dependencies):
  - `utils.ts` — Math utilities (`clamp`, `angleDiff`)
  - `settings.ts` — Shared localStorage/event helpers for all settings. Numeric: `loadAr/Vol`, `saveAr/Vol`, `subscribeAr/Vol`, `arToMs`, `volToFactor`, hitsound volume, cursor size (`loadCursorSize/saveCursorSize/subscribeCursorSize`, range 4–20), cursor color channels (`loadCursorR/G/B`, `saveCursorR/G/B`, `subscribeCursorR/G/B`, each 0–255, defaults 0/255/255 = cyan), trail fade speed (`loadTrailFadeSpeed/saveTrailFadeSpeed/subscribeTrailFadeSpeed`, range 1–10), music offset (`loadMusicOffset/saveMusicOffset/subscribeMusicOffset`, `OFFSET_MIN/MAX/STEP` = −5000/5000/10 ms, default 0; shifts the song position used for judgement and break-skip targeting). Boolean mod: `loadHiddenMod`, `saveHiddenMod`, `subscribeHiddenMod`. String: trail shape (`TrailShape`: `"circle"` | `"star"` | `"square"`, `loadTrailShape/saveTrailShape/subscribeTrailShape`, default `"circle"`); trail decay (`TrailDecay`: `"fade"` | `"scatter"`, `loadTrailDecay/saveTrailDecay/subscribeTrailDecay`, default `"fade"`; scatter tosses particles in random directions at random speed ≤ 0.15 canvas px/ms; trail fade speed only affects fade decay)
  - `sitePath.ts` — Site sub-path helpers (`getSitePath`, `withPath`)
  - `lang.ts` — Language toggle initialization; persists `en`/`jp` in `localStorage`
  - `theme.ts` — Light/dark (day/night) theme toggle: persists `"theme"` (`"light"`/`"dark"`) in `localStorage`, defaulting to `prefers-color-scheme`; toggles the `theme-dark` class on `<html>` and the sun↔moon button's `aria-checked`
- `src/ts/home/` — Home page island:
  - `sky.ts` — `initBgSky()` animates the home `.bg-sky` SVG: randomly generated clouds (base ellipse + 3–5 random puffs, widths 70–220 px; solid-white `cloud-part` shapes with group-level opacity so overlaps don't seam) spawn at the bottom on a jittered ~2.4 s interval and rise (`cloud-rise` keyframe; per-element `--rise-y`/`--sway-x` vars, random duration); note glyphs spawn at the top on a ~4.2 s interval and fall slowly (`note-fall`; `--fall-y`/`--sway-x`/`--spin`). Notes are mouse-draggable: an invisible `note-hit` rect in each glyph is the grab area (Chrome lacks `pointer-events: bounding-box`), pointer capture freezes the fall — cancelling all running animations, including a previous throw's WAAPI flight on re-grab — and bakes the current offset into the glyph transform via before/after rect centers, and releasing throws the note along the drag velocity (sampled over the last ~100 ms; WAAPI flight with the pace clamped between natural-fall drift and a visible streak, so still releases gently resume falling and violent flicks don't vanish; removed on finish) instead of its random fall. Reaching the notes requires the home hit-test plumbing: `.bg-overlay` sits at `z-index: 0` (the body background paints over negative-z elements, making them unclickable) with `.home-main` at `z-index: 1`, and `.home-main`/`.home-header`/`.home-footer` are `pointer-events: none` with `auto` restored on `.layout-container`, `.home-title`, `.home-lang`, footer links, and `.options-backdrop` (which mounts inside `.home-main`). Clouds live in a `.cloud-layer` group that CSS fades out in dark mode (they keep spawning while hidden so switching back to day is populated); a `night-layer` (26 twinkling stars) fades in at night, and shooting stars spawn every ~9 s while `theme-dark` is active, removing themselves on `animationend`. A `.sky-dial` group holds the sun and the cratered moon (each with a radial-gradient halo fading outwards) on opposite ends of a wheel hubbed at `DIAL_CX/DIAL_CY` (must match the `transform-origin` in `_home.scss`); the moon's horizontal slot is clamped into the viewport's visible viewBox window (the `slice` fit crops the sides on narrow screens, which would hide the dial on phones/tablets) and re-clamped on `resize` — the sun mirrors through the hub so it shares the slot's visibility; a MutationObserver on `<html>`'s class accumulates the inline rotation +180° per theme switch so the wheel only ever turns clockwise — each body sets on the right and rises from the left (CSS owns the 1.1 s transition). Notes are drawn from SVG primitives (`note-fill`/`note-open`/`note-stem` classes; solid teal with the translucency on the note group so head/stem/flag joints don't stack alpha; eighth flags are filled tapered paths, beams are filled quads flush with the stems) in five kinds weighted 50% quarter and 12.5% each eighth, beamed eighth pair, half, whole. Elements are removed on `animationend`, capped at 40, and placed statically in-view under `prefers-reduced-motion`
- `src/ts/game/` — Rhythm game engine island:
  - `engine.ts` — Note rendering, hit detection, scoring; instantiates `CursorRenderer` and calls `cursor.render(now)` after each frame draw; `spawnNote(spec)` (`SpawnSpec`) appends a single live note at an absolute `time` so the shared `TestPlay` surface can drive the real engine without a song timeline (callers keep `time` monotonic to preserve the time-sorted early-break assumptions)
  - `draw.ts` — Canvas drawing utilities (`drawArrow`, `drawLyricNote`, `NOTE_RADIUS`, `LYRIC_RADIUS`, `drawFireworks`); cursor helpers: `drawCursorOrb` (inner solid + fuzzy shadow halo), `drawCursorParticle` (dispatches to circle/star/square by `TrailShape`; accepts optional `shape` and `angle` params)
  - `cursor.ts` — Custom cursor renderer (`createCursorRenderer`): tracks pointer over the canvas, maintains particle trail, exposes `render(now)` / `destroy()`; subscribes to cursor settings including `trailShape` and `trailDecay`; scatter decay assigns random velocity (≤ 0.15 px/ms) at spawn; each particle stores a random `angle` for star/square orientation
  - `grade.ts` — Grade and accuracy computation (`computeGrade`, `computeAccuracy`); `JUDGEMENT_LABEL` (the shared `tier3`→PERFECT / `tier2`→GREAT / `tier1`→GOOD / `miss`→MISS player-facing names used by both the in-game hit toasts in `GameSurface.tsx` and the results breakdown)
- `src/ts/song/` — Song page / TextAlive island:
  - `controller.ts` — Song page controller: TextAlive integration, chart loading, story loading, game loop, fullscreen toggle
  - `storyboard.ts` — TextAlive lyrics storyboard renderer; exports `StoryEntry`, `StoryHighlight`, `StoryMove`, `StoryLyric` types; `setStoryData(entries)` applies highlight ranges, character position moves, and manual lyric segments; manual lyrics (`StoryLyric`) are fully independent of TextAlive — each has a `from`/`to` window, absolute position, text, and per-character activation times
  - `textalive.ts` — TypeScript type declarations for the TextAlive App API
  - `share.ts` — Share / clipboard fallback for result sharing
- `src/ts/react/` — React components:
  - `GameFrame.tsx` — shared cloud-border SVG: `GameFrame` (circle puffs per edge + corner clusters + night-only `.frame-star` sparkles, all multiplied by an optional `scale` prop) and the `useElementSize` ResizeObserver hook that drives redraws from the framed element's measured pixels
  - `GameSurface.tsx` — canvas + score display + hit feedback toasts + `ResultsOverlay` + a full-scale `GameFrame` behind `.game-area`
  - `HomeLayoutSwitcher.tsx` — home page layout state (original / play / info / tutorial); picks EN/JP `info`/`tutorial` content by current language; tutorial pane scroll masks its text top/bottom and routes `spawn:<kind>` link clicks to the `TestPlay` handle (`variant="tutorial"`)
  - `OptionsPanel.tsx` — settings modal with a single shared `TestPlay` surface (`loop variant="panel"`) above five accordions: Volume (music + hitsound sliders), Timing (music offset slider, ±5000 ms / 10 ms steps, snaps to 0 near zero), Mods (Hidden mod checkbox), Notes (AR slider; AR locked on song page), Cursor (size slider, HSV color picker, trail shape segmented buttons [Circle/Star/Square], trail decay segmented buttons [Fade/Scatter], trail fade speed slider); the testplay loops live gameplay so every Notes/Cursor/Mods/Timing setting previews on the real engine in one place; accordion open/closed states persist in localStorage; panel-scoped `--panel-fill/-ink/-ink-soft/-ink-dim/-line` tokens (defined on `.options-panel` in `_options.scss`) give the menu its own dark-navy night theme without touching the constant `--ink`
  - `ColorPicker.tsx` — inline HSV color picker: SV square canvas + hue bar canvas, both draggable with pointer capture; converts HSV↔RGB; preserves hue across low-saturation colors via `localH` state
  - `ResultsOverlay.tsx` — post-song results screen (grade, stats, share, try again). The Issues breakdown covers **every non-Tier-3 hit** (GREAT/GOOD/MISS), counting each by its `issue` — the binding constraint from `judgement.ts` (`IssueReason`: `timing`/`contact`/`direction`/`travel`/`continuity`→shown as "flow") that held it below Tier 3. The breakdown and the issue row are cross-linked on hover: hovering a GREAT/GOOD/MISS count scopes the issue row to that tier; hovering an issue re-counts the GREAT/GOOD/MISS breakdown to just that issue. The non-focused side dims (`is-dim`) and the focused side glows (`is-active`)
  - `TestPlay.tsx` — single shared interactive testplay surface built on the real `createGame` engine (replaces the old `TutorialCanvas`/`ApproachPreview`/`CursorPreview`); `forwardRef` exposes `spawnNote(kind)` via `TestPlayHandle`. Runs its own rAF clock driving `game.tick(clock)` (no song timeline) and reuses the engine's real `judgeGesture`, note/cursor/fireworks rendering, and React judgement toasts (`JUDGEMENT_LABEL`). Notes appear via `game.spawnNote` at `clock + approachMs`. `loop` prop auto-spawns a rotating cut/flow/lyric loop (settings menu); without it notes appear only on the imperative handle (tutorial). AR is pushed via `setApproachMs`; Hidden / hitsound / cursor settings live-update through the engine's own subscriptions. `variant` (`"tutorial"` | `"panel"`) picks the `.testplay-wrap--*` sizing; the canvas (`.testplay-canvas`, 4:3) is wrapped with a `GameFrame` at 0.75 scale
  - `hooks/useLang.ts` — hook: current language from `localStorage`, re-reads on toggle click
  - `hooks/useSettings.ts` — consolidated setting hooks: `useApproachRate`, `useVolume`, `useHitsoundVolume` (numeric, shared `useNumericSetting` helper); `useHiddenMod` (boolean); `useCursorSize`, `useCursorR`, `useCursorG`, `useCursorB`, `useTrailFadeSpeed`, `useMusicOffset` (numeric); `useTrailShape`, `useTrailDecay` (string, shared `useStringSetting` helper)
- `src/tools/osu2mimi.ts` — CLI converter from `.osu` format to `.mimi`: emits `c` (cut) notes with computed direction for imported hit objects
- `static/` — Copied verbatim to output (images, audio, `robots.txt`, etc.)

### Output

All output goes to `docs/` (configured in `Config.hs` via `hakyllConfig`).

### Chart Format (`.mimi`)

Each difficulty is a separate file: `src/songs/<name>/<difficulty>.mimi` (e.g. `easy.mimi`, `expert.mimi`). `site.hs` scans for these files to build the song manifest; `ChartCompiler.hs` compiles each to `songs/<name>/<difficulty>.json`.

```
time_unit: ms
difficulty: 12
beats_per_measure: 4

# kind, time_ms, degrees, x, y[, char]
c, 2388, -30.6, 396.9,  92.2
s, 3080,  68.2, 381.3, 425.0
l, 5000,     0, 300.0, 250.0
l, 5500,     0, 400.0, 300.0, か
```

- `bpm`: song tempo; read by `site.hs` from the first available difficulty file and included as a numeric `bpm` field in the songs manifest JSON
- `time_unit`: always `ms`
- `difficulty`: integer level shown on the difficulty selection button
- `beats_per_measure`: optional, informational only
- `kind`: `c` (cut, red directional slash), `s` (flow anchor, blue connected phrase), or `l` (lyric, white circle, char from TextAlive within ±80 ms); legacy `f`/`flick` and `stream` aliases are normalized by the compilers
- `char` (lyric notes only, optional): overrides the TextAlive character lookup; baked into the compiled JSON as `"lyricChar"`
- `time_ms`: milliseconds from song start when the note should be hit
- `degrees`: direction in screen coordinates (0 = right, 90 = down, -90 = up); converted to runtime radians on compile
- `x`, `y`: logical game coordinates (800 × 600 space)
- Blank lines and `#` comment lines are ignored

### Story Format (`.story`)

An optional per-difficulty `src/songs/<name>/<difficulty>.story` file compiled by `StoryCompiler.hs` to `songs/<name>/<difficulty>.story.json`. Loaded at runtime by `controller.ts` alongside the matching chart and applied via `storyboard.setStoryData()`.

```
# kind, args…
h, 62500, 63200
m, 63000, 550, 300
```

- `h, time1, time2` — highlight: while song position is in `[time1, time2]`, any storyboard character whose `startTime` is also in that range gets the technicolor `.approach` style
- `m, time, x, y` — move: within the current phrase, characters with `startTime >= time` break into a separate vertical segment absolutely positioned at logical `(x, y)` (800 × 600 space); multiple `m` entries divide the phrase into multiple segments
- `l, from, to, x, y, text[, char_time1, char_time2, ...]` — manual lyric: a self-contained lyric segment, completely independent of TextAlive; appears at `from` ms, fades out at `to` ms, absolutely positioned at logical `(x, y)`; `text` is the lyric string (must not contain commas); each optional `char_time` is the ms when the corresponding character becomes `.active` (prior character transitions to `.sung`); the last character stays `.active` until `to`

### SCSS

Partials use `@use` with `variables` as `*` (variables are globally forwarded). `_variables.scss` defines two layers:
- **Sass variables** — layout and component sizing (`$layout-max-width`, `$diff-btn-height`, `$diff-level-width`, `$diff-separator-angle`, `$diff-colors`); color picker canvas dimensions (`$color-picker-sv-w/h`, `$color-picker-hue-h`) used for `aspect-ratio` in `_options.scss`; partials that need these must `@use 'variables' as *` directly
- **CSS custom properties** on `:root` — typography (`--font-display` = M PLUS Rounded 1c, loaded via Google Fonts in `imports.html`; used for display text, buttons, and hit judgments), Miku palette (`--miku-teal`, `--miku-teal-deep`, `--ink`, `--ink-soft`, `--cloud-fill`, `--cloud-glow`), base page colors, hit judgment colors (`--color-perfect/good/miss`), grade colors, day/night background gradient pairs (`--bg-day/night-home`, `--bg-day/night-song`, aliased by `--bg-gradient-home/song` to the current theme), theme-dependent tokens (`--page-ink/-soft/-faint`, `--page-accent`, `--page-line` for text on the page background; `--cloud-fill/-bright`, `--pill-fill`, `--card-fill` for white surfaces, which go dull dusk-cloud blue-grey at night; `--veil`, `--song-page-bg`, `--song-text/-dim`, `--song-text-shadow`, `--game-dim`, `--game-frame-fill/-glow` (follow `--cloud-fill/-glow` by day, royal purple at night), `--surface-hud/-line`), shape radii (`--radius-pill`, `--radius-card`), z-index layers, and motion constants (incl. `--motion-ease-bouncy`). `html.theme-dark` (set by `core/theme.ts`) overrides the theme-dependent tokens for night mode; `--ink/--ink-soft` stay constant for text on white surfaces. A universal `color/background-color/border-color/fill/stroke` 0.4s transition in `_transitions.scss` plus day-gradient `::before` crossfade layers on both `.bg-overlay`s make theme switches seamless (gradients themselves can't transition)

Theme: the home tab is light blue/white with cloud-shaped buttons — `.btn-main`/`.btn-back` build puffs from absolutely-positioned pseudo-element circles merged by `filter: drop-shadow` (so puffs share the button background and use no borders); `.diff-btn` suppresses the puffs to keep its diagonal split badge. A decorative `.bg-sky` SVG inside `.bg-overlay` in `home.html` is populated continuously by `src/ts/home/sky.ts` with randomized rising clouds and slowly falling note glyphs; the home gradient overlay is scoped to `.home-page .bg-overlay` so it never paints over the song page's dark `.song-page .bg-overlay`. The song tab keeps a dark play-field, now a deep blue-teal `--bg-gradient-song` (also used by `.testplay-canvas`), with `--font-display` on chrome labels; `.game-area` is framed like the testplay canvas — `--radius-card` corners, a teal ring (`--surface-hud-line`) and an ambient glow (`--cloud-glow`), both theme-dimmed at night — plus a cloudy outline: a `.game-frame` SVG generated by the shared `GameFrame.tsx` (rendered by `GameSurface.tsx` as a sibling behind `.game-area`, whose `overflow: hidden` would clip it, and around `.testplay-canvas` at 0.75 scale) — one coherent circle set per edge (cycled `FRAME_PUFFS` radii/offsets, ~31px spacing snapped to the edge length) with corner clusters, regenerated from the area's measured size via ResizeObserver; tiled CSS backgrounds were abandoned here because tiles rasterize separately, leaving seam hairlines and `round`-stretch gaps on resize — white by day, royal purple at night, when the frame's `.frame-star` sparkle paths (`frameStars`, `--color-perfect` yellow) fade in — generated per edge with a 64px corner margin so the rows can't double up where edges meet, plus a mirrored big + small pair on each corner blob's outer diagonal; `.game-area` itself is a glassy screen (`backdrop-filter: blur(18px)`) so anything painted behind it — page gradient, the band's inner arcs — blurs while the canvas and HUD stay sharp; its loading screen uses the bright home gradient (teal pill progress bar, bobbing ♪); shared chrome (lang toggle capsule, settings button, options panel, results buttons) is styled per page via `.home-page`/`.song-page` scoping. `_transitions.scss` staggers `.layout-pane`/`.song-pane`/`.song-list`/`.difficulty-list` children with `paneItemIn` (max 8 staggered delays) and guards all motion behind `prefers-reduced-motion`.

### Song Frontmatter Fields

Each song tab (`src/tabs/<song>.md`) sets these frontmatter fields used by `song.html`:

| Field | Description |
|-------|-------------|
| `title` | Page `<title>` suffix |
| `song-name` / `song-name-jp` | Song title (EN / JP) |
| `song-author` / `song-author-jp` | Artist name (EN / JP) |
| `song-mapper` | Charter name |
| `song-url` | Piapro/streaming URL passed to TextAlive |
| `textalive-beat-id` | TextAlive video beat ID |
| `textalive-chord-id` | TextAlive video chord ID |
| `textalive-repetitive-segment-id` | TextAlive video repetitive segment ID |
| `textalive-lyric-id` | TextAlive video lyric ID |
| `textalive-lyric-diff-id` | TextAlive video lyric diff ID |

The `song-chart` path and `textalive-token` are injected by `site.hs` (not frontmatter).
