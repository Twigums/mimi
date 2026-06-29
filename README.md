# mimi

Hatsune Miku has lost her lyrics, and she needs your help to collect missing words! Mimi is an easy-to-learn rhythm game with cut notes, flow notes, and lyric notes. The objective is to beautifully swipe through the cut and flow notes and hold onto the lyric notes. The lyric notes are how you can help retrieve Miku’s words. By collecting these words, you can make her voice shine!

Customize your cursor color and game properties to fit the your preferred experience. Change between day and night-mode, change how fast each note appears on your screen, or change between English and Japanese! The choice is yours! The only thing we recommend is learning how mimi works through the tutorial.

Feel free to play using your PC’s mouse or tablet’s touchscreen!

We currently showcase "Answer Me" by imie, but we hope to chart more songs in the future!

### Supported Devices
We primarily support horizontal PC screens. Mouse and touchscreen are supported.

Depending on tablet environments, this game may also work. For example, iPad Pro 4th gen 13in on Firefox would work with tabs enabled. However, the same iPad on Safari will not work. This is due to the screen ratio. We added a warning breakpoint at 1.3:1 width to height ratio. Therefore, if you are able to, try to make your window flatter by having tabs or using "[Lok Board](https://apps.apple.com/us/app/lok-board/id1621242252)" (for iOS) or a similar application.

We hope to support more devices after the judging process!

## Details

**mimi** is a rhythm game web application built on primarily Typescript and compiled using Haskell via [Hakyll](https://jaspervdj.be/hakyll/). The `main` branch contains the source code to build the raw files, but the compiled docs will sit in the `docs` branch of this repository, which are built/served using GitHub Pages.

If you would like to build the site from source, please follow the "How to Build" section shown below. Ideally, this should be done under a Linux environment for simplicity. Otherwise, the `docs` branch of this repository should contain a working version of the full website. You can download `docs` and host that separately.

## How to Build

### Prerequisites

**Node.js >= 20.19.0 with `npm`**

Follow the instructions for **prebuilt Node.js** at [nodejs.org](https://nodejs.org/), or use a version manager such as `nvm`.

**Stack + GHC**

Follow the instructions at [docs.haskellstack.org](https://docs.haskellstack.org/en/stable/install_and_upgrade/#install-stack).

There is no need to install GHC; Stack will download and use its own sandboxed GHC if there is no existing installation.

Before proceeding, `node -v` and `stack --version` should both succeed and return updated versions.

### Build Instructions

Warning: building the Haskell binary will take a very long time.

1. Install dependencies + build Haskell binary:
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

The compiled site outputs to `./docs` by default. Running the third command will allow you to examine the site in `./docs`.

## Chart File Format

Chart data is stored at `src/songs/<name>/<difficulty>.mimi`.

An optional `src/songs/<name>/<difficulty>.story` file controls the TextAlive lyric storyboard. It is compiled to `songs/<name>/chart.json` alongside the chart. See `wiki/gameplay.md` for the full format reference.

## Common Issues

While building, `The program 'pkg-config' version >= ??? is required but it could not be found.`: This indicates that you need to install `pkg-config`. Refer to your package manager to install `pkg-config` properly.

On WSL/Linux, `sh: 1: esbuild: Permission denied` or `sh: 1: sass: Permission denied`: npm installed local bin targets without executable bits. From the repo root, repair the local install and rebuild:

```bash
find node_modules/.bin -type l -exec sh -c 'chmod +x "$(readlink -f "$1")"' sh {} \;
npm run rebuild
```

## Credits

Website Design: [Twigums](https://github.com/Twigums), [vekt0r](https://github.com/vekt0r-github)

Art Design + Assets: [Twigums](https://github.com/Twigums), [acousticguichar](https://www.instagram.com/acousticguichar?igsh=eXc0NnZmYjRpMXp2)

Mapping: [vekt0r-github](https://github.com/vekt0r-github), [IOException](https://osu.ppy.sh/users/2688103)
