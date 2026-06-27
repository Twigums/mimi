// Regenerate test/fixtures/kotaete-timings.json from a TextAlive phrase dump + staff chorus jsonc.
//
//   npm run build:kotaete-timings
//
// Default API dump: test/fixtures/kotaete-hard-timings.json (legacy capture).
// Chorus overlay:   src/songs/kotaete/chorus-timings.jsonc
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { mergeChorusIntoPhrases, type PhraseGroup } from "../ts/song/chorusTimings";

const root = process.cwd();
const apiPath = resolve(root, process.argv[2] ?? "test/fixtures/kotaete-textalive-dump.json");
const chorusPath = resolve(root, "src/songs/kotaete/chorus-timings.jsonc");
const outPath = resolve(root, "test/fixtures/kotaete-timings.json");

const apiPhrases = JSON.parse(readFileSync(apiPath, "utf8")) as PhraseGroup[];
const chorusRaw = readFileSync(chorusPath, "utf8");
const merged = mergeChorusIntoPhrases(apiPhrases, chorusRaw);

writeFileSync(outPath, `${JSON.stringify(merged, null, 4)}\n`, "utf8");

const dropped = apiPhrases.length - merged.length + 2; // +2 chorus phrases added
console.log(`Wrote ${outPath} (${merged.length} phrases, ~${dropped} degenerate/overlap phrases adjusted)`);
