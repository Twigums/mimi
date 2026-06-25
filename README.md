# Mimi

Mimi is a rhythm game web application built on primarily Typescript and compiled using Haskell via [Hakyll](https://jaspervdj.be/hakyll/). The `main` branch contains the source code to build the raw files, but the compiled docs will sit in the `docs` branch of this repository, which are built/served using GitHub Pages.

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
3. Preview locally (optionally, set {IP_ADDRESS} and {PORT} to a custom ip and a port):
   ```bash
   npm run watch (-- --host {IP_ADDRESS} --port {PORT})
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

Mimi delegates charting to using the "osu!" format for simplicity. See [`src/tools/README.md`](src/tools/README.md) for more charting information.

## Storyboard Story Files

An optional `src/songs/<name>/chart.story` file controls the TextAlive lyric storyboard. It is compiled to `songs/<name>/chart.json` alongside the chart. See `wiki/gameplay.md` for the full format reference.

## Common Issues

While building, `The program 'pkg-config' version >= ??? is required but it could not be found.`: This indicates that you need to install `pkg-config`. Refer to your package manager to install `pkg-config` properly.

On WSL/Linux, `sh: 1: esbuild: Permission denied` or `sh: 1: sass: Permission denied`: npm installed local bin targets without executable bits. From the repo root, repair the local install and rebuild:

```bash
find node_modules/.bin -type l -exec sh -c 'chmod +x "$(readlink -f "$1")"' sh {} \;
npm run rebuild
``