import { readFileSync } from "fs";

const OSU_WIDTH   = 512;
const OSU_HEIGHT  = 384;
const MIMI_WIDTH  = 800;
const MIMI_HEIGHT = 600;

// Fit osu play area inside mimi play area, preserving aspect ratio.
// Both are 4:3 so scale = 1.5625 and offsets are 0, but this handles
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

interface Note {
    time:    number;
    x:       number;
    y:       number;
    degrees: number;
    isSlider: boolean;
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

    const osuX = parseFloat(parts[0]);
    const osuY = parseFloat(parts[1]);
    const time = parseInt(parts[2], 10);
    const type = parseInt(parts[3], 10);

    if (type & 8) return null;  // spinner

    const isSlider = !!(type & 2);

    let degrees = 0;

    if (isSlider && parts.length >= 6) {
        const curveData = parts[5];
        const pipeIdx   = curveData.indexOf("|");
        if (pipeIdx !== -1) {
            // Take first curve point: "L|cx:cy|..." → "cx:cy"
            const firstPt        = curveData.slice(pipeIdx + 1).split("|")[0];
            const [cxStr, cyStr] = firstPt.split(":");
            const cx = parseFloat(cxStr);
            const cy = parseFloat(cyStr);
            const dx = cx - osuX;
            const dy = cy - osuY;
            // osu y increases down; standard math y increases up → negate dy
            degrees = Math.atan2(-dy, dx) * (180 / Math.PI);
        }
    }

    const xm = parseFloat((osuX * SCALE + OFFSET_X).toFixed(1));
    const ym = parseFloat((osuY * SCALE + OFFSET_Y).toFixed(1));

    return {
        time,
        x: xm,
        y: ym,
        degrees: parseFloat(degrees.toFixed(1)),
        isSlider,
    };
}

function main(): void {
    const { fileArg, difficulty, bpm, beatsPerMeasure } = parseCliArgs(process.argv.slice(2));

    if (!fileArg) {
        process.stderr.write("Usage: osu2mimi [--difficulty N] [--bpm N] [--beats-per-measure N] {file.osu}\n");
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

    for (const note of notes) {
        out.push(`c, ${note.time}, ${note.degrees}, ${note.x}, ${note.y}`);
    }

    process.stdout.write(out.join("\n") + "\n");
}

main();
