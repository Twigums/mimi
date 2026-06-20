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

// Flow is the default marker for imported hit objects; a clap hitsound tags a
// lyric note instead. Direction is no longer derived — flow anchors take their
// direction from the ribbon tangent at runtime, so a fixed 0 is emitted.
type NoteKind = "s" | "l";

interface Note {
    time: number;
    x:    number;
    y:    number;
    kind: NoteKind;
}

const OSU_CLAP = 1 << 3; // hitSound bit: tags the object as a lyric note

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

    if (type & 8) return null;    // spinner
    if (type & 128) return null;  // mania hold

    // Hitcircles and slider heads alike become flow anchors (consecutive anchors
    // link into a phrase at runtime); a clap hitsound marks the object as a lyric.
    const kind: NoteKind = (hitSound & OSU_CLAP) ? "l" : "s";

    const xm = parseFloat((osuX * SCALE + OFFSET_X).toFixed(1));
    const ym = parseFloat((osuY * SCALE + OFFSET_Y).toFixed(1));

    return { time, x: xm, y: ym, kind };
}

function main(): void {
    const { fileArg, difficulty, bpm, beatsPerMeasure } = parseCliArgs(process.argv.slice(2));

    if (!fileArg) {
        process.stderr.write(
            "Usage: osu2mimi [--difficulty N] [--bpm N] [--beats-per-measure N] {file.osu}\n" +
            "Hit objects import as flow anchors; objects with a clap hitsound import as lyric notes.\n",
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

    // degrees is left empty (no authored direction): flow anchors derive direction
    // from the ribbon tangent at runtime, and lyric notes ignore it.
    for (const note of notes) {
        out.push(`${note.kind}, ${note.time}, , ${note.x}, ${note.y}`);
    }

    process.stdout.write(out.join("\n") + "\n");
}

main();
