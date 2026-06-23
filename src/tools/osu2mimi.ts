import { readFileSync } from "fs";

const OSU_WIDTH   = 512;
const OSU_HEIGHT  = 384;
const MIMI_WIDTH  = 800;
const MIMI_HEIGHT = 600;

// both osu and mimi are 4:3
const SCALE    = Math.min(MIMI_WIDTH / OSU_WIDTH, MIMI_HEIGHT / OSU_HEIGHT);
const OFFSET_X = (MIMI_WIDTH  - OSU_WIDTH  * SCALE) / 2;
const OFFSET_Y = (MIMI_HEIGHT - OSU_HEIGHT * SCALE) / 2;

function parseSections(text: string): Map<string, string[]> {
    const sections = new Map<string, string[]>();
    let current = "";
    for (const raw of text.split("\n")) {
        const line = raw.trim();
        const m = line.match(/^\[(.+)\]$/);
        if (m) {
            current = m[1];
            sections.set(current, []);
        } else if (current && line && !line.startsWith("//")) {
            sections.get(current)!.push(line);
        }
    }

    return sections;
}

// Hit objects map to mimi kinds explicitly via object type + hitsound:
//   clap                  -> lyric
//   whistle (on a slider) -> cut, direction from the slider
//   plain slider          -> flow, pinned to the slider's direction
//   plain hitcircle       -> flow, direction "auto" (the ribbon tangent at runtime)
// Cut and pinned flow need a direction, which only a slider provides; a whistle on a
// bare circle has no direction and is warned + imported as auto flow. finish is unused.
type NoteKind = "cut" | "flow" | "lyric";

interface Note {
    time:     number;
    x:        number;
    y:        number;
    kind:     NoteKind;
    degrees:  number | null;
    newCombo: boolean;
}

const OSU_TYPE_SLIDER   = 1 << 1;
const OSU_TYPE_NEWCOMBO = 1 << 2;
const OSU_TYPE_SPINNER  = 1 << 3;
const OSU_TYPE_HOLD     = 1 << 7;
const OSU_HIT_WHISTLE   = 1 << 1;
const OSU_HIT_CLAP      = 1 << 3;

// Direction (mimi screen-degrees) of a slider's opening, from its head to the first
// curve point. Returns null when the slider has no usable curve data.
function sliderDegrees(parts: string[], osuX: number, osuY: number): number | null {
    if (parts.length < 6) return null;
    const pipeIdx = parts[5].indexOf("|");
    if (pipeIdx === -1) return null;
    const [cxStr, cyStr] = parts[5].slice(pipeIdx + 1).split("|")[0].split(":");
    const cx = parseFloat(cxStr);
    const cy = parseFloat(cyStr);
    const dx = cx - osuX;
    const dy = cy - osuY;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return null;
    return parseFloat((Math.atan2(-dy, dx) * (180 / Math.PI)).toFixed(1));
}

interface CliOptions {
    fileArg: string | null;
    difficulty?: number;
    bpm?: number;
    beatsPerMeasure: number;
}

function parseCliArgs(args: string[]): CliOptions {
    const opts: CliOptions = { fileArg: null, beatsPerMeasure: 4 };
    let i = 0;

    while (i < args.length) {
        const arg = args[i];
        if (arg === "--") {
            i += 1;
            if (i < args.length) opts.fileArg = args[i];
            break;
        }

        if (arg === "--difficulty") {
            i += 1;
            opts.difficulty = Number(args[i]);
        } else if (arg === "--bpm") {
            i += 1;
            opts.bpm = Number(args[i]);
        } else if (arg === "--beats-per-measure") {
            i += 1;
            opts.beatsPerMeasure = Number(args[i]);
        } else if (arg.startsWith("--")) {
            process.stderr.write(`Unknown option: ${arg}\n`);
            process.exit(1);
        } else if (!opts.fileArg) {
            opts.fileArg = arg;
        }
        i += 1;
    }

    return opts;
}

function parseHitObject(line: string): Note | null {
    const parts = line.split(",");
    if (parts.length < 5) return null;

    const osuX     = parseFloat(parts[0]);
    const osuY     = parseFloat(parts[1]);
    const time     = parseInt(parts[2], 10);
    const type     = parseInt(parts[3], 10);
    const hitSound = parseInt(parts[4], 10);

    if (type & OSU_TYPE_SPINNER) return null;
    if (type & OSU_TYPE_HOLD) return null;

    const isSlider = !!(type & OSU_TYPE_SLIDER);
    const newCombo = !!(type & OSU_TYPE_NEWCOMBO);
    const xm = parseFloat((osuX * SCALE + OFFSET_X).toFixed(1));
    const ym = parseFloat((osuY * SCALE + OFFSET_Y).toFixed(1));

    let kind: NoteKind;
    let degrees: number | null;
    if (hitSound & OSU_HIT_CLAP) {
        kind = "lyric";
        degrees = null;
    } else if (hitSound & OSU_HIT_WHISTLE) {
        const dir = isSlider ? sliderDegrees(parts, osuX, osuY) : null;
        if (dir === null) {
            process.stderr.write(`warning: cut (whistle) at ${time}ms needs a slider with a direction; importing as auto flow\n`);
            kind = "flow";
            degrees = null;
        } else {
            kind = "cut";
            degrees = dir;
        }
    } else if (isSlider) {
        kind = "flow";
        degrees = sliderDegrees(parts, osuX, osuY); // pinned to the slider, or auto if none
    } else {
        kind = "flow";
        degrees = null; // plain circle: auto flow
    }

    return { time, x: xm, y: ym, kind, degrees, newCombo };
}

function main(): void {
    const { fileArg, difficulty, bpm, beatsPerMeasure } = parseCliArgs(process.argv.slice(2));

    if (!fileArg) {
        process.stderr.write(
            "Usage: osu2mimi [--difficulty N] [--bpm N] [--beats-per-measure N] {file.osu}\n" +
            "Kind from hitsound/type: clap -> lyric; whistle on a slider -> cut; plain\n" +
            "slider -> flow pinned to the slider direction; plain circle -> flow (auto).\n" +
            "A new-combo object emits a `break`, ending the previous flow phrase.\n",
        );
        process.exit(1);
    }

    let content: string;
    try {
        content = readFileSync(fileArg, "utf-8");
    } catch {
        process.stderr.write(`Cannot read: ${fileArg}\n`);
        process.exit(1);
    }

    const sections = parseSections(content);
    const hitObjectLines = sections.get("HitObjects") ?? [];

    const notes: Note[] = [];
    for (const line of hitObjectLines) {
        const note = parseHitObject(line);
        if (note) notes.push(note);
    }

    notes.sort((a, b) => a.time - b.time);

    const out: string[] = [
        "time_unit: ms",
    ];
    if (bpm !== undefined) out.push(`bpm: ${bpm}`);
    if (difficulty !== undefined) out.push(`difficulty: ${difficulty}`);
    out.push(`beats_per_measure: ${beatsPerMeasure}`);
    out.push(
        "",
        "# kind, time_ms, degrees, x, y",
    );

    notes.forEach((note, i) => {
        const mayNeedBreak = i > 0 && note.kind === "flow" && notes[i - 1].kind === "flow";
        if (note.newCombo && mayNeedBreak) out.push("break");
        const deg = note.degrees === null ? "auto" : note.degrees;
        out.push(`${note.kind}, ${note.time}, ${deg}, ${note.x}, ${note.y}`);
    });

    process.stdout.write(out.join("\n") + "\n");
}

main();