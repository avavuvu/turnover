import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, extname, join, resolve } from "node:path"

import { Command, InvalidArgumentError } from "commander"

import type { ClipInfo } from "../src/library/clip-info"
import { normaliseKey } from "../src/library/clip-position"
import { SAMPLE_RATE } from "./lib/essentia"
import { analyseKey, camelotCode } from "./lib/key"
import { assertValidName, nameFromTitle, readLibrary, writeLibrary } from "./lib/library"
import { decodeMonoAudio, encodeAllIntra, hasAudio, probeVideo } from "./lib/media"
import { LIBRARY_FILE, PLAYBACK_DIR } from "./lib/paths"
import { estimateTempo } from "./lib/tempo"
import { downloadVideo, isUrl } from "./lib/youtube"

const DEFAULT_MAX_HEIGHT = 360
const OUT_OF_TUNE_CENTS = 15
const LOW_CONFIDENCE = 0.6

type Options = {
	input: string
	name?: string
	title?: string
	start?: number
	end?: number
	height: number
	key?: string
	bpm?: number
	force?: boolean
}

type Source = { file: string; title: string; url?: string; uploader?: string }

const parseTime = (value: string): number => {
	const parts = value.split(":").map(Number)
	if (parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
		throw new InvalidArgumentError("Use seconds or [hh:]mm:ss, for example 75 or 1:15.")
	}
	return parts.reduce((total, part) => total * 60 + part, 0)
}

const parsePositive =
	(wholeNumber: boolean) =>
	(value: string): number => {
		const number = Number(value)
		if (!Number.isFinite(number) || number <= 0 || (wholeNumber && !Number.isInteger(number))) {
			throw new InvalidArgumentError(`Use a ${wholeNumber ? "whole " : ""}number above 0.`)
		}
		return number
	}

const parseKey = (value: string): string => {
	try {
		return normaliseKey(value)
	} catch (error) {
		throw new InvalidArgumentError(error instanceof Error ? error.message : String(error))
	}
}

const readOptions = (): Options => {
	const program = new Command()
		.name("bun run add-clip")
		.description(
			`Downloads video`
		)
		.argument("<input>", "YouTube URL or video file")
		.option(
			"--name <name>",
			'clip name for vid("<name>"): (default: made from the title)'
		)
		.option("--title <text>", "title to store (default: the YouTube title or the file name)")
		.option("--start <time>", "only download part of the video, pass seconds 75 or time 1:15", parseTime)
		.option("--end <time>", "only download part of the video, until end time", parseTime)
		.option("--height <pixels>", "maximum video height", parsePositive(true), DEFAULT_MAX_HEIGHT)
		.option("--key <key>", "override the key", parseKey)
		.option("--bpm <bpm>", "override ethe tempo", parsePositive(false))
		.option("--force", "replace a clip that has the same name")
		.parse()

	const options = program.opts<Omit<Options, "input">>()
	if (options.start !== undefined && options.end !== undefined && options.end <= options.start) {
		program.error("error: --end must be after --start.")
	}
	return { input: program.args[0], ...options }
}

const step = (message: string) => console.log(`\n▸ ${message}`)

const fetchSource = (input: string, maxHeight: number, downloadDir: string): Source => {
	if (isUrl(input)) {
		step(`Downloading ${input}`)
		return downloadVideo(input, downloadDir, maxHeight)
	}
	const file = resolve(input)
	if (!existsSync(file)) throw new Error(`${input} does not exist.`)
	return { file, title: basename(file, extname(file)) }
}

const analyseClip = (file: string, options: Options) => {
	step(options.bpm === undefined ? "Finding key, tuning, and tempo" : "Finding key and tuning")
	const samples = decodeMonoAudio(file, SAMPLE_RATE)
	const detected = analyseKey(samples)
	const key = options.key ?? detected.key
	const tempo =
		options.bpm === undefined ? estimateTempo(samples) : { bpm: options.bpm, confidence: null }

	return {
		...probeVideo(file),
		tempoBpm: tempo?.bpm ?? null,
		tempoConfidence: tempo?.confidence ?? null,
		key,
		camelot: camelotCode(key),
		keyConfidence: options.key === undefined ? detected.confidence : null,
		tuningCents: detected.tuningCents,
		sections: detected.sections
	}
}

const describe = (value: string, confidence: number | null) =>
	confidence === null ? `${value}, set by hand` : `${value}, confidence ${confidence}`

const printSummary = (name: string, clip: ClipInfo) => {
	const tempo =
		clip.tempoBpm === null ? "not found" : describe(`${clip.tempoBpm} BPM`, clip.tempoConfidence)
	const sections = clip.sections.map(
		({ start, end, key }) =>
			`    ${start.toFixed(1).padStart(7)} s – ${end.toFixed(1).padStart(7)} s  ${key}`
	)

	console.log(`
Added "${name}"
  title:    ${clip.title}
  size:     ${clip.width}x${clip.height}, ${clip.fps} fps, ${clip.durationSeconds} s
  key:      ${describe(`${clip.key} (${clip.camelot})`, clip.keyConfidence)}
  tuning:   ${clip.tuningCents > 0 ? "+" : ""}${clip.tuningCents} cents from A = 440 Hz
  tempo:    ${tempo}
  sections:
${sections.join("\n")}`)

	const warnings = [
		Math.abs(clip.tuningCents) > OUT_OF_TUNE_CENTS &&
			`Warning: the clip is ${clip.tuningCents} cents away from A = 440 Hz.`,
		clip.keyConfidence !== null &&
			clip.keyConfidence < LOW_CONFIDENCE &&
			"Warning: the key confidence is low. Check the key by ear or in rekordbox, and set it with --key.",
		clip.tempoConfidence !== null &&
			clip.tempoConfidence < LOW_CONFIDENCE &&
			"Warning: the tempo confidence is low. Set it with --bpm if it is wrong.",
		clip.keyConfidence === null &&
			!clip.sections.some((section) => section.key === clip.key) &&
			`Note: no section was detected in ${clip.key}, so vid("${name}").key("${clip.key}") will not play.`
	]
	for (const warning of warnings) if (warning) console.log(`\n${warning}`)

	console.log(`\nUse it in Strudel: vid("${name}")`)
}

const main = () => {
	const options = readOptions()
	const library = readLibrary(LIBRARY_FILE)

	if (options.name !== undefined) {
		assertValidName(options.name)
		if (library[options.name] && !options.force) {
			throw new Error(`A clip named "${options.name}" exists. Use --force to replace it.`)
		}
	}

	const downloadDir = mkdtempSync(join(tmpdir(), "add-clip-"))
	let partialPath: string | undefined
	try {
		const source = fetchSource(options.input, options.height, downloadDir)
		if (!hasAudio(source.file)) {
			throw new Error(`${basename(source.file)} has no audio track. Clips need audio.`)
		}

		const title = options.title ?? source.title
		const name = options.name ?? nameFromTitle(title, new Set(Object.keys(library)))
		const playbackFile = `${name}.mp4`
		const playbackPath = join(PLAYBACK_DIR, playbackFile)
		partialPath = `${playbackPath}.partial`

		mkdirSync(PLAYBACK_DIR, { recursive: true })
		step(`Encoding ${basename(source.file)} as all-intra H.264 (max ${options.height} px high)`)
		encodeAllIntra(source.file, partialPath, {
			maxHeight: options.height,
			startSeconds: options.start,
			endSeconds: options.end
		})

		const clip: ClipInfo = {
			title,
			source: source.url,
			uploader: source.uploader,
			playbackFile,
			...analyseClip(partialPath, options)
		}

		renameSync(partialPath, playbackPath)
		library[name] = clip
		writeLibrary(LIBRARY_FILE, library)
		printSummary(name, clip)
	} finally {
		if (partialPath) rmSync(partialPath, { force: true })
		rmSync(downloadDir, { recursive: true, force: true })
	}
}

try {
	main()
} catch (error) {
	console.error(`\nError: ${error instanceof Error ? error.message : error}`)
	process.exit(1)
}
