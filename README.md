## How to Build

Requires `node >=20.19.0`/`npm` and `stack`. Stack will use a compatible GHC from `~/.stack` (or a compatible system GHC if you already have one).

1. Install dependencies + build haskell binary:
   ```bash
   npm run setup
   ```
2. Generate the static site:
   ```bash
   npm run rebuild
   ```
3. Preview locally (optional):
   ```bash
   npm run watch (-- --host {IP_ADDRESS})
   ```
4. Deploy to GitHub Pages:
   ```bash
   git add -A
   git commit -m "publish."
   git push origin
   ```

The compiled site outputs to `./docs`. Configure GitHub Pages to serve from the `docs` folder on your main branch.

Set `SITE_PATH=/sub-path` (or pass `--path /sub-path`) when hosting at a sub-path. The CI workflow sets this automatically from the repo name.

## Converting osu! Charts

Charts can be authored in the [osu! editor](https://osu.ppy.sh/home/download) using linear sliders, then converted to `.mimi` format:

```bash
npm run --silent convert:osu -- path/to/file.osu > src/songs/<name>/chart.mimi
```

## Storyboard Story Files

An optional `src/songs/<name>/chart.story` file controls the TextAlive lyric storyboard. It is compiled to `songs/<name>/chart.json` alongside the chart. See `wiki/gameplay.md` for the full format reference.

## Common Issues

While building, `The program 'pkg-config' version >= ??? is required but it could not be found.`: This indicates that you need to install `pkg-config`.

On WSL/Linux, `sh: 1: esbuild: Permission denied` or `sh: 1: sass: Permission denied`: npm installed local bin targets without executable bits. From the repo root, repair the local install and rebuild:

```bash
find node_modules/.bin -type l -exec sh -c 'chmod +x "$(readlink -f "$1")"' sh {} \;
npm run rebuild
```
