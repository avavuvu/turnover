import { copyFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

import { Command, InvalidArgumentError } from "commander";

import type { ClipInfo, EncodeSettings } from "../src/clip-info";
import { normaliseKey } from "../src/clip-position";
import { SAMPLE_RATE } from "./lib/essentia";
import { analyseKey, camelotCode } from "./lib/key";
import { assertValidName, nameFromTitle, readLibrary, writeLibrary } from "./lib/library";
import { decodeMonoAudio, encodeAllIntra, hasAudio, probeVideo } from "./lib/media";
import { LIBRARY_FILE, ORIGINALS_DIR, PLAYBACK_DIR } from "./lib/paths";
import { estimateTempo } from "./lib/tempo";
import { downloadVideo, isUrl } from "./lib/youtube";

const DEFAULT_MAX_HEIGHT = 360;
const OUT_OF_TUNE_CENTS = 15;
const LOW_CONFIDENCE = 0.6;

type Options = {
	name?: string;
	title?: string;
	start?: number;
	end?: number;
	height: number;
	key?: string;
	bpm?: number;
	force?: boolean;
};

function parseTime(value: string): number {
	const parts = value.split(":").map(Number);
	if (parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
		throw new InvalidArgumentError("Use seconds or [hh:]mm:ss, for example 75 or 1:15.");
	}
	return parts.reduce((total, part) => total * 60 + part, 0);
}

function parseHeight(value: string): number {
	const height = Number(value);
	if (!Number.isInteger(height) || height <= 0) {
		throw new InvalidArgumentError("Use a whole number of pixels.");
	}
	return height;
}

function parseBpm(value: string): number {
	const bpm = Number(value);
	if (!Number.isFinite(bpm) || bpm <= 0) throw new InvalidArgumentError("Use a number.");
	return bpm;
}

function parseKey(value: string): string {
	try {
		return normaliseKey(value);
	} catch (error) {
		throw new InvalidArgumentError(error instanceof Error ? error.message : String(error));
	}
}

function readOptions() {
	const program = new Command()
		.name("bun run add-clip")
		.description(
			`Downloads (or reads) a video, encodes it for fast seeking, finds the key,
tuning, and tempo, and adds it to library/clips.json. The original is kept in
library/originals/ so the clip can be rebuilt with "bun run rebuild-clips".`
		)
		.argument("<input>", "YouTube URL or video file")
		.option(
			"--name <name>",
			'clip name for vid("<name>"): lowercase letters and digits (default: made from the title)'
		)
		.option("--title <text>", "title to store (default: the YouTube title or the file name)")
		.option("--start <time>", "start of the part to keep, for example 75 or 1:15", parseTime)
		.option("--end <time>", "end of the part to keep", parseTime)
		.option("--height <pixels>", "maximum video height", parseHeight, DEFAULT_MAX_HEIGHT)
		.option("--key <key>", "set the key yourself, for example Em or F#:major", parseKey)
		.option("--bpm <bpm>", "set the tempo yourself", parseBpm)
		.option("--force", "replace a clip that has the same name")
		.parse();

	const options = program.opts<Options>();
	if (options.start !== undefined && options.end !== undefined && options.end <= options.start) {
		program.error("error: --end must be after --start.");
	}
	return { input: program.args[0], ...options };
}

function step(message: string) {
	console.log(`\n▸ ${message}`);
}

function printSummary(name: string, clip: ClipInfo) {
	const key =
		clip.keyConfidence === null
			? `${clip.key} (${clip.camelot}), set by hand`
			: `${clip.key} (${clip.camelot}), confidence ${clip.keyConfidence}`;
	const tempo =
		clip.tempoBpm === null
			? "not found"
			: clip.tempoConfidence === null
				? `${clip.tempoBpm} BPM, set by hand`
				: `${clip.tempoBpm} BPM, confidence ${clip.tempoConfidence}`;

	console.log(`
Added "${name}"
  title:    ${clip.title}
  size:     ${clip.width}x${clip.height}, ${clip.fps} fps, ${clip.durationSeconds} s
  key:      ${key}
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
	if (clip.keyConfidence !== null && clip.keyConfidence < LOW_CONFIDENCE) {
		console.log(
			`\nWarning: the key confidence is low. Check the key by ear or in rekordbox, and set it with --key.`
		);
	}
	if (clip.tempoConfidence !== null && clip.tempoConfidence < LOW_CONFIDENCE) {
		console.log(`\nWarning: the tempo confidence is low. Set it with --bpm if it is wrong.`);
	}
	if (clip.keyConfidence === null && !clip.sections.some((section) => section.key === clip.key)) {
		console.log(
			`\nNote: no section was detected in ${clip.key}, so vid("${name}").key("${clip.key}") will not play.`
		);
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
	const previous = options.name === undefined ? undefined : library[options.name];

	mkdirSync(ORIGINALS_DIR, { recursive: true });
	mkdirSync(PLAYBACK_DIR, { recursive: true });

	let inputFile: string;
	let downloadedTitle: string | undefined;
	let sourceUrl: string | undefined;
	let uploader: string | undefined;

	if (isUrl(options.input)) {
		step(`Downloading ${options.input}`);
		const download = downloadVideo(options.input, ORIGINALS_DIR, options.height);
		inputFile = download.file;
		downloadedTitle = download.title;
		sourceUrl = download.url;
		uploader = download.uploader;
	} else {
		inputFile = resolve(options.input);
	}

	const title =
		options.title ?? downloadedTitle ?? previous?.title ?? basename(inputFile, extname(inputFile));
	const name = options.name ?? nameFromTitle(title, new Set(Object.keys(library)));
	assertValidName(name);

	if (!hasAudio(inputFile)) {
		throw new Error(`${basename(inputFile)} has no audio track. Clips need audio.`);
	}

	const originalFile = `${name}${extname(inputFile)}`;
	const originalPath = join(ORIGINALS_DIR, originalFile);
	if (inputFile !== originalPath) {
		if (isUrl(options.input)) renameSync(inputFile, originalPath);
		else copyFileSync(inputFile, originalPath);
	}

	const encode: EncodeSettings = {
		maxHeight: options.height,
		startSeconds: options.start,
		endSeconds: options.end
	};
	const playbackFile = `${name}.mp4`;
	const playbackPath = join(PLAYBACK_DIR, playbackFile);
	const partialPath = `${playbackPath}.partial`;

	try {
		step(`Encoding ${originalFile} as all-intra H.264 (max ${options.height} px high)`);
		encodeAllIntra(originalPath, partialPath, encode);

		step(options.bpm === undefined ? "Finding key, tuning, and tempo" : "Finding key and tuning");
		const video = probeVideo(partialPath);
		const samples = decodeMonoAudio(partialPath, SAMPLE_RATE);
		const keyAnalysis = analyseKey(samples);
		const tempo =
			options.bpm === undefined ? estimateTempo(samples) : { bpm: options.bpm, confidence: null };
		const key = options.key ?? keyAnalysis.key;

		const clip: ClipInfo = {
			title,
			source: sourceUrl ?? previous?.source,
			uploader: uploader ?? previous?.uploader,
			originalFile,
			playbackFile,
			encode,
			...video,
			tempoBpm: tempo?.bpm ?? null,
			tempoConfidence: tempo?.confidence ?? null,
			key,
			camelot: camelotCode(key),
			keyConfidence: options.key === undefined ? keyAnalysis.confidence : null,
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
