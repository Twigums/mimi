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
- `src/templates/` — Hakyll HTML templates: `home.html`, `song.html`, `lang_toggle.html`, `settings_toggle.html`, `imports.html`, `sitemap.xml`
- `src/scss/` — SCSS partials; `default.scss` is the entry point, imports all `_*.scss` partials
- `src/ts/main.ts` — TypeScript entry point, compiled to `js/main.js`
- `src/ts/core/` — Shared primitives (no inter-island dependencies):
  - `utils.ts` — Math utilities (`clamp`, `angleDiff`)
  - `settings.ts` — Shared localStorage/event helpers for all settings. Numeric: `loadAr/Vol`, `saveAr/Vol`, `subscribeAr/Vol`, `arToMs`, `volToFactor`, hitsound volume, cursor size (`loadCursorSize/saveCursorSize/subscribeCursorSize`, range 4–20), cursor color channels (`loadCursorR/G/B`, `saveCursorR/G/B`, `subscribeCursorR/G/B`, each 0–255, defaults 0/255/255 = cyan), trail fade speed (`loadTrailFadeSpeed/saveTrailFadeSpeed/subscribeTrailFadeSpeed`, range 1–10). Boolean mod: `loadHiddenMod`, `saveHiddenMod`, `subscribeHiddenMod`. String: trail shape (`TrailShape`: `"circle"` | `"star"` | `"square"`, `loadTrailShape/saveTrailShape/subscribeTrailShape`, default `"circle"`); trail decay (`TrailDecay`: `"fade"` | `"scatter"`, `loadTrailDecay/saveTrailDecay/subscribeTrailDecay`, default `"fade"`; scatter tosses particles in random directions at random speed ≤ 0.15 canvas px/ms; trail fade speed only affects fade decay)
  - `sitePath.ts` — Site sub-path helpers (`getSitePath`, `withPath`)
  - `lang.ts` — Language toggle initialization; persists `en`/`jp` in `localStorage`
- `src/ts/game/` — Rhythm game engine island:
  - `engine.ts` — Note rendering, hit detection, scoring; instantiates `CursorRenderer` and calls `cursor.render(now)` after each frame draw
  - `draw.ts` — Canvas drawing utilities (`drawArrow`, `drawLyricNote`, `NOTE_RADIUS`, `LYRIC_RADIUS`, `drawFireworks`); cursor helpers: `drawCursorOrb` (inner solid + fuzzy shadow halo), `drawCursorParticle` (dispatches to circle/star/square by `TrailShape`; accepts optional `shape` and `angle` params)
  - `cursor.ts` — Custom cursor renderer (`createCursorRenderer`): tracks pointer over the canvas, maintains particle trail, exposes `render(now)` / `destroy()`; subscribes to cursor settings including `trailShape` and `trailDecay`; scatter decay assigns random velocity (≤ 0.15 px/ms) at spawn; each particle stores a random `angle` for star/square orientation
  - `grade.ts` — Grade and accuracy computation (`computeGrade`, `computeAccuracy`)
- `src/ts/song/` — Song page / TextAlive island:
  - `controller.ts` — Song page controller: TextAlive integration, chart loading, story loading, game loop, fullscreen toggle
  - `storyboard.ts` — TextAlive lyrics storyboard renderer; exports `StoryEntry`, `StoryHighlight`, `StoryMove`, `StoryLyric` types; `setStoryData(entries)` applies highlight ranges, character position moves, and manual lyric segments; manual lyrics (`StoryLyric`) are fully independent of TextAlive — each has a `from`/`to` window, absolute position, text, and per-character activation times
  - `textalive.ts` — TypeScript type declarations for the TextAlive App API
  - `share.ts` — Share / clipboard fallback for result sharing
- `src/ts/react/` — React components:
  - `GameSurface.tsx` — canvas + score display + hit feedback toasts + `ResultsOverlay`
  - `HomeLayoutSwitcher.tsx` — home page layout state (original / play / info / tutorial); picks EN/JP `info`/`tutorial` content by current language; tutorial pane scroll masks its text top/bottom and routes `spawn:<kind>` link clicks to the `TutorialCanvas` handle
  - `OptionsPanel.tsx` — settings modal with volume/hitsound sliders always visible, plus three `<details>` accordions: Mods (Hidden mod checkbox), Notes (AR slider + animated approach preview; AR locked on song page), Cursor (size slider, HSV color picker, trail shape segmented buttons [Circle/Star/Square], trail decay segmented buttons [Fade/Scatter], trail fade speed slider, animated cursor preview); accordion open/closed states persist in localStorage
  - `ColorPicker.tsx` — inline HSV color picker: SV square canvas + hue bar canvas, both draggable with pointer capture; converts HSV↔RGB; preserves hue across low-saturation colors via `localH` state
  - `ResultsOverlay.tsx` — post-song results screen (grade, stats, share, try again)
  - `ApproachPreview.tsx` — animated arrow canvas preview for AR setting; accepts `hidden` prop to mirror Hidden mod state
  - `CursorPreview.tsx` — animated canvas preview of the custom cursor; renders a Lissajous path with orb + trail using current cursor settings; accepts `trailShape` and `trailDecay` props; uses refs so rAF loop survives prop changes
  - `TutorialCanvas.tsx` — interactive tutorial mini-engine; `forwardRef` exposing `spawnNote(kind)` via `TutorialCanvasHandle`; spawns flick/stream/lyric notes at canvas centre and runs its own progress-based hit detection, fireworks, and judgment toasts independent of the song engine
  - `hooks/useLang.ts` — hook: current language from `localStorage`, re-reads on toggle click
  - `hooks/useSettings.ts` — consolidated setting hooks: `useApproachRate`, `useVolume`, `useHitsoundVolume` (numeric, shared `useNumericSetting` helper); `useHiddenMod` (boolean); `useCursorSize`, `useCursorR`, `useCursorG`, `useCursorB`, `useTrailFadeSpeed` (numeric); `useTrailShape`, `useTrailDecay` (string, shared `useStringSetting` helper)
- `src/tools/osu2mimi.ts` — CLI converter from `.osu` format to `.mimi`: sliders → `f` (flick) notes with computed direction, hit circles → `l` (lyric) notes
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
f, 2388, -30.6, 396.9,  92.2
s, 3080,  68.2, 381.3, 425.0
l, 5000,     0, 300.0, 250.0
l, 5500,     0, 400.0, 300.0, か
```

- `bpm`: song tempo; read by `site.hs` from the first available difficulty file and included as a numeric `bpm` field in the songs manifest JSON
- `time_unit`: always `ms`
- `difficulty`: integer level shown on the difficulty selection button
- `beats_per_measure`: optional, informational only
- `kind`: `f` (flick, red — no hold required), `s` (stream, blue — requires holding), or `l` (lyric, white circle — swipe-through, no hold, char from TextAlive within ±80 ms)
- `char` (lyric notes only, optional): overrides the TextAlive character lookup; baked into the compiled JSON as `"lyricChar"`
- `time_ms`: milliseconds from song start when the note should be hit
- `degrees`: direction in standard math convention (0 = right, 90 = up, CCW); converted to canvas radians on compile
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
- **CSS custom properties** on `:root` — typography (`--font-display` = M PLUS Rounded 1c, loaded via Google Fonts in `imports.html`; used for display text, buttons, and hit judgments), Miku palette (`--miku-teal`, `--miku-teal-deep`, `--ink`, `--ink-soft`, `--cloud-fill`, `--cloud-glow`), base page colors, hit judgment colors (`--color-perfect/good/miss`), grade colors, background gradients (bright blue home / dark song), shape radii (`--radius-pill`, `--radius-card`), z-index layers, and motion constants (incl. `--motion-ease-bouncy` for springy hover and entrance animations)

Theme: the home tab is light blue/white with cloud-shaped buttons — `.btn-main`/`.btn-back` build puffs from absolutely-positioned pseudo-element circles merged by `filter: drop-shadow` (so puffs share the button background and use no borders); `.diff-btn` suppresses the puffs to keep its diagonal split badge. A decorative `.bg-bubbles` SVG (circles + ♪ text, drifting via CSS keyframes) lives inside `.bg-overlay` in `home.html`. The song tab keeps its dark play-field; shared chrome (lang toggle capsule, settings button, options panel, results buttons) is styled per page via `.home-page`/`.song-page` scoping. `_transitions.scss` staggers `.layout-pane`/`.song-pane`/`.song-list`/`.difficulty-list` children with `paneItemIn` (max 8 staggered delays) and guards all motion behind `prefers-reduced-motion`.

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
