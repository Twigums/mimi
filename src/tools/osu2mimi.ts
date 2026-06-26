import { readFileSync } from "fs";

const OSU_WIDTH   = 512;
const OSU_HEIGHT  = 384;
const MIMI_WIDTH  = 800;
const MIMI_HEIGHT = 600;

// both osu and mimi are 4:3
const SCALE    = Math.min(MIMI_WIDTH / OSU_WIDTH, MIMI_HEIGHT / OSU_HEIGHT);
const OFFSET_X = (MIMI_WIDTH  - OSU_WIDTH  * SCALE) / 2;
const OFFSET_Y = (MIMI_HEIGHT - OSU_HEIGHT * SCALE) / 2;

const toMimiX = (osuX: number): number => parseFloat((osuX * SCALE + OFFSET_X).toFixed(1));
const toMimiY = (osuY: number): number => parseFloat((osuY * SCALE + OFFSET_Y).toFixed(1));

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
//   clap                  -> lyric (hold); a clap SLIDER also emits an `end` marker at
//                            its tail so the slider duration becomes the lyric hold end.
//                            A finish on the clap adds the `endchar` flag (the char-fetch
//                            window then extends past the hold end to claim the closing syllable)
//   whistle (on a slider) -> cut, direction from the slider
//   plain slider          -> flow, pinned to the slider's direction
//   plain hitcircle       -> flow, direction "auto" (the ribbon tangent at runtime)
// Cut and pinned flow need a direction, which only a slider provides; a whistle on a
// bare circle has no direction and is warned + imported as auto flow. finish marks a
// lyric's closing syllable (see above) and is otherwise unused.
// Cut/flow sliders are positioned at the MIDPOINT of head -> first curve point (sliders
// are expected to be linear), so the note sits on the slider body, not its head.
type NoteKind  = "cut" | "flow" | "lyric";
type EntryKind = NoteKind | "end";

interface Note {
    time:           number;
    x:              number;
    y:              number;
    kind:           EntryKind;
    degrees:        number | null;
    newCombo:       boolean;
    includeEndChar?: boolean;  // lyric only: emits the `endchar` flag (osu finish hitsound)
}

const OSU_TYPE_SLIDER   = 1 << 1;
const OSU_TYPE_NEWCOMBO = 1 << 2;
const OSU_TYPE_SPINNER  = 1 << 3;
const OSU_TYPE_HOLD     = 1 << 7;
const OSU_HIT_WHISTLE   = 1 << 1;
const OSU_HIT_FINISH    = 1 << 2;
const OSU_HIT_CLAP      = 1 << 3;

// Same-time emit order so the engine reads simultaneous events sensibly: an `end` marker
// (which bounds the preceding lyric's hold) comes first, then cut/flow notes that lead
// in, then the lyric itself last (so its hold extends to the next strictly-later event,
// not a note charted on its own beat).
const EMIT_ORDER: Record<EntryKind, number> = { end: 0, cut: 1, flow: 1, lyric: 2 };

// First curve point of a slider (the first `x:y` after the curve-type letter). For the
// expected linear sliders this is the slider's end point.
function sliderFirstPoint(parts: string[]): { x: number; y: number } | null {
    if (parts.length < 6) return null;
    const pipeIdx = parts[5].indexOf("|");
    if (pipeIdx === -1) return null;
    const [cxStr, cyStr] = parts[5].slice(pipeIdx + 1).split("|")[0].split(":");
    const cx = parseFloat(cxStr);
    const cy = parseFloat(cyStr);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    return { x: cx, y: cy };
}

// Direction (mimi screen-degrees) of a slider's opening, from its head to its first
// curve point. Returns null when the head and point coincide.
function sliderDegrees(first: { x: number; y: number }, osuX: number, osuY: number): number | null {
    const dx = first.x - osuX;
    const dy = first.y - osuY;
    if (dx === 0 && dy === 0) return null;
    return parseFloat((Math.atan2(-dy, dx) * (180 / Math.PI)).toFixed(1));
}

interface TimingPoint {
    time:        number;
    beatLength:  number;  // ms per beat (uninherited) or negative SV encoding (inherited)
    uninherited: boolean;
}

function parseTimingPoints(lines: string[]): TimingPoint[] {
    const pts: TimingPoint[] = [];
    for (const line of lines) {
        const p = line.split(",");
        if (p.length < 2) continue;
        const time       = parseFloat(p[0]);
        const beatLength  = parseFloat(p[1]);
        if (!Number.isFinite(time) || !Number.isFinite(beatLength)) continue;
        // The `uninherited` flag is field 7; older maps omit it, where a positive
        // beatLength means uninherited (a real tempo) and a negative one means inherited.
        const uninherited = p.length > 6 ? p[6].trim() === "1" : beatLength > 0;
        pts.push({ time, beatLength, uninherited });
    }
    pts.sort((a, b) => a.time - b.time);
    return pts;
}

function parseSliderMultiplier(lines: string[]): number {
    for (const line of lines) {
        const m = line.match(/^SliderMultiplier\s*:\s*([\d.]+)/);
        if (m) return parseFloat(m[1]);
    }
    process.stderr.write("warning: [Difficulty] SliderMultiplier missing; defaulting to 1.4\n");
    return 1.4;
}

// osu slider duration: length / (SliderMultiplier * 100 * SV) beats, times the active
// uninherited beat length, times the repeat count. Returns null when no tempo applies or
// the geometry is unusable.
function sliderDurationMs(
    startTime: number, length: number, slides: number,
    sliderMultiplier: number, timingPoints: TimingPoint[],
): number | null {
    if (!Number.isFinite(length) || length <= 0) return null;
    let beatLength = NaN;
    let sv = 1.0;
    for (const tp of timingPoints) {
        if (tp.time > startTime) break;
        if (tp.uninherited) { beatLength = tp.beatLength; sv = 1.0; }
        else if (tp.beatLength < 0) { sv = -100 / tp.beatLength; }
    }
    if (!Number.isFinite(beatLength) || beatLength <= 0) return null;
    const beats = length / (sliderMultiplier * 100 * sv);
    return beats * beatLength * Math.max(1, slides);
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

interface MapContext {
    sliderMultiplier: number;
    timingPoints:     TimingPoint[];
}

function parseHitObject(line: string, ctx: MapContext): Note[] {
    const parts = line.split(",");
    if (parts.length < 5) return [];

    const osuX     = parseFloat(parts[0]);
    const osuY     = parseFloat(parts[1]);
    const time     = parseInt(parts[2], 10);
    const type     = parseInt(parts[3], 10);
    const hitSound = parseInt(parts[4], 10);

    if (type & OSU_TYPE_SPINNER) return [];
    if (type & OSU_TYPE_HOLD) return [];

    const isSlider = !!(type & OSU_TYPE_SLIDER);
    const newCombo = !!(type & OSU_TYPE_NEWCOMBO);
    const first    = isSlider ? sliderFirstPoint(parts) : null;
    const headX    = toMimiX(osuX);
    const headY    = toMimiY(osuY);

    // clap -> lyric (held). The lyric sits at the head; a clap SLIDER's body shape is
    // ignored except for its duration, which becomes the hold end via an `end` marker. A
    // finish on the clap flags the lyric to claim its closing syllable (the `endchar` flag).
    if (hitSound & OSU_HIT_CLAP) {
        const includeEndChar = !!(hitSound & OSU_HIT_FINISH);
        const notes: Note[] = [{ time, x: headX, y: headY, kind: "lyric", degrees: null, newCombo, includeEndChar }];
        if (isSlider) {
            const slides = parseInt(parts[6] ?? "1", 10) || 1;
            const length = parseFloat(parts[7] ?? "");
            const dur    = sliderDurationMs(time, length, slides, ctx.sliderMultiplier, ctx.timingPoints);
            if (dur !== null) {
                notes.push({ time: Math.round(time + dur), x: 0, y: 0, kind: "end", degrees: null, newCombo: false });
            } else {
                process.stderr.write(`warning: clap slider at ${time}ms has no usable duration; lyric falls back to the next-note bound\n`);
            }
        }
        return notes;
    }

    // whistle -> cut; needs a slider direction. Positioned at the slider midpoint.
    if (hitSound & OSU_HIT_WHISTLE) {
        const dir = first ? sliderDegrees(first, osuX, osuY) : null;
        if (dir === null) {
            process.stderr.write(`warning: cut (whistle) at ${time}ms needs a slider with a direction; importing as auto flow\n`);
            return [{ time, x: headX, y: headY, kind: "flow", degrees: null, newCombo }];
        }
        const mx = toMimiX((osuX + first!.x) / 2);
        const my = toMimiY((osuY + first!.y) / 2);
        return [{ time, x: mx, y: my, kind: "cut", degrees: dir, newCombo }];
    }

    // plain slider -> flow pinned to its direction, positioned at the slider midpoint.
    if (isSlider) {
        const dir = first ? sliderDegrees(first, osuX, osuY) : null;
        const mx  = first ? toMimiX((osuX + first.x) / 2) : headX;
        const my  = first ? toMimiY((osuY + first.y) / 2) : headY;
        return [{ time, x: mx, y: my, kind: "flow", degrees: dir, newCombo }];
    }

    // plain circle -> auto flow at the head.
    return [{ time, x: headX, y: headY, kind: "flow", degrees: null, newCombo }];
}

function main(): void {
    const { fileArg, difficulty, bpm, beatsPerMeasure } = parseCliArgs(process.argv.slice(2));

    if (!fileArg) {
        process.stderr.write(
            "Usage: osu2mimi [--difficulty N] [--bpm N] [--beats-per-measure N] {file.osu}\n" +
            "Kind from hitsound/type: clap -> lyric (clap slider also bounds the hold at its\n" +
            "tail); whistle on a slider -> cut; plain slider -> flow pinned to the slider;\n" +
            "plain circle -> flow (auto). Cut/flow sliders sit at the head->first-point\n" +
            "midpoint. A new-combo object emits a `break`, ending the previous flow phrase.\n",
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
    const ctx: MapContext = {
        sliderMultiplier: parseSliderMultiplier(sections.get("Difficulty") ?? []),
        timingPoints:     parseTimingPoints(sections.get("TimingPoints") ?? []),
    };
    const hitObjectLines = sections.get("HitObjects") ?? [];

    const notes: Note[] = [];
    for (const line of hitObjectLines) {
        notes.push(...parseHitObject(line, ctx));
    }

    notes.sort((a, b) => a.time - b.time || EMIT_ORDER[a.kind] - EMIT_ORDER[b.kind]);

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

    // A `break` ends a flow phrase only between consecutive flow notes; `end` markers are
    // inert (stripped by the engine), so the adjacency check ignores them.
    let prevKind: NoteKind | null = null;
    for (const note of notes) {
        if (note.kind === "end") {
            out.push(`end, ${note.time}`);
            continue;
        }
        if (note.newCombo && note.kind === "flow" && prevKind === "flow") out.push("break");
        const deg = note.degrees === null ? "auto" : note.degrees;
        const endTag = note.includeEndChar ? ", endchar" : "";
        out.push(`${note.kind}, ${note.time}, ${deg}, ${note.x}, ${note.y}${endTag}`);
        prevKind = note.kind;
    }

    process.stdout.write(out.join("\n") + "\n");
}

main();
