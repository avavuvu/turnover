import { copyFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import type { ClipInfo, EncodeSettings } from "../src/clip-info";
import { analyseKey } from "./lib/key";
import { assertValidName, nameFromTitle, readLibrary, writeLibrary } from "./lib/library";
import { decodeMonoAudio, encodeAllIntra, hasAudio, probeVideo } from "./lib/media";
import { LIBRARY_FILE, ORIGINALS_DIR, PLAYBACK_DIR } from "./lib/paths";
import { estimateTempo } from "./lib/tempo";
import { downloadVideo, isUrl } from "./lib/youtube";

const DEFAULT_MAX_HEIGHT = 360;

const ANALYSIS_SAMPLE_RATE = 22050;
const OUT_OF_TUNE_CENTS = 15;
const LOW_CONFIDENCE = 0.6;

const USAGE = `Usage: bun run add-clip <youtube-url | video-file> [options]

Downloads (or reads) a video, encodes it for fast seeking, finds the key,
tuning, and tempo, and adds it to library/clips.json. The original is kept in
library/originals/ so the clip can be rebuilt with "bun run rebuild-clips".

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
		encode: {
			maxHeight: parseInteger(values.height, "--height") ?? DEFAULT_MAX_HEIGHT,
			startSeconds,
			endSeconds
		} satisfies EncodeSettings,

		force: values.force
	};
}

function step(message: string) {
	console.log(`\n▸ ${message}`);
}

function printSummary(name: string, clip: ClipInfo) {
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

	mkdirSync(ORIGINALS_DIR, { recursive: true });
	mkdirSync(PLAYBACK_DIR, { recursive: true });

	let inputFile: string;
	let title: string;
	let sourceUrl: string | undefined;
	let uploader: string | undefined;

	if (isUrl(options.input)) {
		step(`Downloading ${options.input}`);
		const download = downloadVideo(options.input, ORIGINALS_DIR, options.encode.maxHeight);
		({ title, uploader } = download);
		sourceUrl = download.url;
		inputFile = download.file;
	} else {
		inputFile = resolve(options.input);
		title = basename(inputFile, extname(inputFile));
	}
	title = options.title ?? title;

	const name = options.name ?? nameFromTitle(title, new Set(Object.keys(library)));
	assertValidName(name);
	const previous = library[name];

	if (!hasAudio(inputFile)) {
		throw new Error(`${basename(inputFile)} has no audio track. Clips need audio.`);
	}

	const originalFile = `${name}${extname(inputFile)}`;
	const originalPath = join(ORIGINALS_DIR, originalFile);
	if (inputFile !== originalPath) {
		if (isUrl(options.input)) renameSync(inputFile, originalPath);
		else copyFileSync(inputFile, originalPath);
	}

	const playbackFile = `${name}.mp4`;
	const playbackPath = join(PLAYBACK_DIR, playbackFile);
	const partialPath = `${playbackPath}.partial`;

	try {
		step(`Encoding ${originalFile} as all-intra H.264 (max ${options.encode.maxHeight} px high)`);
		encodeAllIntra(originalPath, partialPath, options.encode);

		step("Finding key, tuning, and tempo");
		const video = probeVideo(partialPath);
		const samples = decodeMonoAudio(partialPath, ANALYSIS_SAMPLE_RATE);
		const keyAnalysis = analyseKey(samples, ANALYSIS_SAMPLE_RATE);
		const tempo = estimateTempo(samples, ANALYSIS_SAMPLE_RATE);

		const clip: ClipInfo = {
			title,
			source: sourceUrl ?? previous?.source,
			uploader: uploader ?? previous?.uploader,
			originalFile,
			playbackFile,
			encode: options.encode,
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

		renameSync(partialPath, playbackPath);
		library[name] = clip;
		writeLibrary(LIBRARY_FILE, library);
		printSummary(name, clip);
	} finally {
		rmSync(partialPath, { force: true });
	}
}

try {
	main();
} catch (error) {
	console.error(`\nError: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
}
