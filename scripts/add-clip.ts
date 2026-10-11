import { mkdirSync, renameSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { analyseKey } from "./lib/key";
import {
	assertValidName,
	type ClipEntry,
	nameFromTitle,
	readLibrary,
	writeLibrary
} from "./lib/library";
import { decodeMonoAudio, encodeAllIntra, probeVideo } from "./lib/media";
import { estimateTempo } from "./lib/tempo";
import { downloadVideo, isUrl } from "./lib/youtube";

const EDITOR_DIR = fileURLToPath(new URL("..", import.meta.url));
const VIDEOS_DIR = join(EDITOR_DIR, "src", "videos");
const SOURCES_DIR = join(EDITOR_DIR, "sources");
const LIBRARY_FILE = join(VIDEOS_DIR, "clips.json");

const DEFAULT_MAX_HEIGHT = 360;

const ANALYSIS_SAMPLE_RATE = 22050;
const OUT_OF_TUNE_CENTS = 15;
const LOW_CONFIDENCE = 0.6;

const USAGE = `Usage: bun run add-clip <youtube-url | video-file> [options]

Downloads (or reads) a video, encodes it for fast seeking, finds the key,
tuning, and tempo, and adds it to src/videos/clips.json.

Options:
  --name <name>      Clip name for vid("<name>"). Lowercase letters and digits.
                     Default: made from the video title.
  --title <text>     Title to store. Default: the YouTube title or the file name.
  --start <time>     Start of the part to keep, for example 75 or 1:15.
  --end <time>       End of the part to keep.
  --height <pixels>  Maximum video height. Default: ${DEFAULT_MAX_HEIGHT}.

  --force            Replace a clip that has the same name.
  --help             Show this text.`;

function parseTime(value: string | undefined, option: string): number | undefined {
	if (value === undefined) return undefined;
	const parts = value.split(":").map(Number);
	if (parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
		throw new Error(`${option} must be seconds or [hh:]mm:ss, got "${value}".`);
	}
	return parts.reduce((total, part) => total * 60 + part, 0);
}

function parseInteger(value: string | undefined, option: string): number | undefined {
	if (value === undefined) return undefined;
	const number = Number(value);
	if (!Number.isInteger(number) || number < 0) {
		throw new Error(`${option} must be a whole number, got "${value}".`);
	}
	return number;
}

function readOptions() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			name: { type: "string" },
			title: { type: "string" },
			start: { type: "string" },
			end: { type: "string" },
			height: { type: "string" },

			force: { type: "boolean", default: false },
			help: { type: "boolean", default: false }
		}
	});

	if (values.help || positionals.length !== 1) {
		console.log(USAGE);
		process.exit(values.help ? 0 : 1);
	}

	const startSeconds = parseTime(values.start, "--start");
	const endSeconds = parseTime(values.end, "--end");
	if (startSeconds !== undefined && endSeconds !== undefined && endSeconds <= startSeconds) {
		throw new Error("--end must be after --start.");
	}

	return {
		input: positionals[0],
		name: values.name,
		title: values.title,
		startSeconds,
		endSeconds,
		maxHeight: parseInteger(values.height, "--height") ?? DEFAULT_MAX_HEIGHT,

		force: values.force
	};
}

function step(message: string) {
	console.log(`\n▸ ${message}`);
}

function printSummary(name: string, clip: ClipEntry) {
	const tempo =
		clip.tempoBpm === null
			? "not found"
			: `${clip.tempoBpm} BPM (confidence ${clip.tempoConfidence})`;

	console.log(`
Added "${name}"
  title:    ${clip.title}
  size:     ${clip.width}x${clip.height}, ${clip.fps} fps, ${clip.durationSeconds} s
  key:      ${clip.key} (${clip.camelot}), confidence ${clip.keyConfidence}, alternative ${clip.alternativeKey}
  tuning:   ${clip.tuningCents > 0 ? "+" : ""}${clip.tuningCents} cents from A = 440 Hz
  tempo:    ${tempo}
  sections:`);
	for (const section of clip.sections) {
		console.log(
			`    ${section.start.toFixed(1).padStart(7)} s – ${section.end.toFixed(1).padStart(7)} s  ${section.key}`
		);
	}

	if (Math.abs(clip.tuningCents) > OUT_OF_TUNE_CENTS) {
		console.log(`\nWarning: the clip is ${clip.tuningCents} cents away from A = 440 Hz.`);
	}
	if (clip.keyConfidence < LOW_CONFIDENCE) {
		console.log(`\nWarning: the key confidence is low. Check the key by ear or in rekordbox.`);
	}
	console.log(`\nUse it in Strudel: vid("${name}")`);
}

function main() {
	const options = readOptions();
	const library = readLibrary(LIBRARY_FILE);

	if (options.name !== undefined) {
		assertValidName(options.name);
		if (library[options.name] && !options.force) {
			throw new Error(`A clip named "${options.name}" exists. Use --force to replace it.`);
		}
	}

	mkdirSync(VIDEOS_DIR, { recursive: true });
	mkdirSync(SOURCES_DIR, { recursive: true });

	let sourceFile: string;
	let title: string;
	let sourceUrl: string | undefined;
	let uploader: string | undefined;

	if (isUrl(options.input)) {
		step(`Downloading ${options.input}`);
		const download = downloadVideo(options.input, SOURCES_DIR, options.maxHeight);
		({ title, uploader } = download);
		sourceUrl = download.url;
		sourceFile = download.file;
	} else {
		sourceFile = resolve(options.input);
		title = basename(sourceFile, extname(sourceFile));
	}
	title = options.title ?? title;

	const name = options.name ?? nameFromTitle(title, new Set(Object.keys(library)));
	assertValidName(name);
	const previous = library[name];

	if (isUrl(options.input)) {
		const namedSource = join(SOURCES_DIR, `${name}${extname(sourceFile)}`);
		renameSync(sourceFile, namedSource);
		sourceFile = namedSource;
	}

	const clipFile = `${name}.mp4`;
	const outputPath = join(VIDEOS_DIR, clipFile);
	const partialPath = `${outputPath}.partial`;

	step(`Encoding ${basename(sourceFile)} as all-intra H.264 (max ${options.maxHeight} px high)`);
	encodeAllIntra(sourceFile, partialPath, options);
	renameSync(partialPath, outputPath);

	step("Finding key, tuning, and tempo");
	const video = probeVideo(outputPath);
	const samples = decodeMonoAudio(outputPath, ANALYSIS_SAMPLE_RATE);
	const keyAnalysis = analyseKey(samples, ANALYSIS_SAMPLE_RATE);
	const tempo = estimateTempo(samples, ANALYSIS_SAMPLE_RATE);

	const clip: ClipEntry = {
		file: clipFile,
		title,
		source: sourceUrl ?? previous?.source,
		uploader: uploader ?? previous?.uploader,
		...video,
		tempoBpm: tempo?.bpm ?? null,
		tempoConfidence: tempo?.confidence ?? null,
		key: keyAnalysis.overall.key,
		camelot: keyAnalysis.overall.camelot,
		keyConfidence: keyAnalysis.overall.confidence,
		alternativeKey: keyAnalysis.overall.alternativeKey,
		tuningCents: keyAnalysis.tuningCents,
		sections: keyAnalysis.sections
	};

	library[name] = clip;
	writeLibrary(LIBRARY_FILE, library);
	printSummary(name, clip);
}

try {
	main();
} catch (error) {
	console.error(`\nError: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
}
