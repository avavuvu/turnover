import originalUrl from "../sources/mbv.mp4?url";
import gop8Url from "./videos/mbv_gop8.mp4?url";
import intraUrl from "./videos/mbv_intra.mp4?url";
import hapUrl from "./videos/mbv_hap.mov?url";

import { HapSeeker } from "./hap-seeker";
import { type IndexedVideo, indexVideo } from "./indexed-video";
import { seededRandom } from "./random";
import { decoderConfigFor, WebCodecsSeeker } from "./webcodecs-seeker";

const SEEK_COUNT = 200;
const WARMUP_SEEKS = 5;
const RANDOM_SEED = 1234;

type Source = { label: string; url: string; player: "webcodecs" | "hap" };

const SOURCES: Source[] = [
	{ label: "H.264 original (GOP ~10 s, B-frames)", url: originalUrl, player: "webcodecs" },
	{ label: "H.264 GOP 8, no B-frames", url: gop8Url, player: "webcodecs" },
	{ label: "H.264 all-intra", url: intraUrl, player: "webcodecs" },
	{ label: "HAP (DXT1 + Snappy)", url: hapUrl, player: "hap" }
];

type SeekTiming = { elapsedMs: number; decodedFrames: number; detailMs?: number };

type BenchResult = {
	fileMegabytes: number;
	fetchMs: number;
	indexMs: number;
	timings: SeekTiming[];
	missingFrames: number;
	detailLabel?: string;
};

const runButton = document.querySelector<HTMLButtonElement>("#run")!;
const statusLine = document.querySelector<HTMLParagraphElement>("#status")!;
const resultsBody = document.querySelector<HTMLTableSectionElement>("#results tbody")!;
const webCodecsCanvas = document.querySelector<HTMLCanvasElement>("#webcodecs-canvas")!;
const hapCanvas = document.querySelector<HTMLCanvasElement>("#hap-canvas")!;

function seekTargets(durationMicros: number, count: number): number[] {
	const random = seededRandom(RANDOM_SEED);
	return Array.from({ length: count }, () => Math.floor(random() * durationMicros));
}

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

function percentile(sortedValues: number[], fraction: number): number {
	const index = Math.min(sortedValues.length - 1, Math.floor(fraction * sortedValues.length));
	return sortedValues[index];
}

function drawVideoFrame(frame: VideoFrame) {
	webCodecsCanvas.width = frame.displayWidth;
	webCodecsCanvas.height = frame.displayHeight;
	webCodecsCanvas.getContext("2d")!.drawImage(frame, 0, 0);
}

async function benchWebCodecs(video: IndexedVideo, targets: number[]) {
	const support = await VideoDecoder.isConfigSupported(decoderConfigFor(video));
	if (!support.supported) throw new Error(`Decoder config not supported: ${video.codec}`);

	const seeker = new WebCodecsSeeker(video);
	const timings: SeekTiming[] = [];
	let missingFrames = 0;

	try {
		for (const [i, target] of targets.entries()) {
			const { elapsedMs, decodedFrames, frame } = await seeker.seek(target);
			if (!frame) missingFrames++;
			if (i >= WARMUP_SEEKS) timings.push({ elapsedMs, decodedFrames });
			if (frame) {
				drawVideoFrame(frame);
				frame.close();
			}
			await yieldToBrowser();
		}
	} finally {
		seeker.close();
	}

	return { timings, missingFrames };
}

async function benchHap(video: IndexedVideo, targets: number[]) {
	const seeker = new HapSeeker(video, hapCanvas);
	const timings: SeekTiming[] = [];

	for (const [i, target] of targets.entries()) {
		const { elapsedMs, decompressMs } = seeker.seek(target);
		if (i >= WARMUP_SEEKS) timings.push({ elapsedMs, decodedFrames: 1, detailMs: decompressMs });
		await yieldToBrowser();
	}

	return { timings, missingFrames: 0, detailLabel: "Snappy" };
}

async function benchSource(source: Source): Promise<BenchResult> {
	const fetchStarted = performance.now();
	const buffer = await (await fetch(source.url)).arrayBuffer();
	const fetchMs = performance.now() - fetchStarted;

	const indexStarted = performance.now();
	const video = indexVideo(buffer);
	const indexMs = performance.now() - indexStarted;

	const targets = seekTargets(video.durationMicros, SEEK_COUNT + WARMUP_SEEKS);
	const run = source.player === "hap" ? benchHap : benchWebCodecs;

	return {
		fileMegabytes: video.byteLength / 1_000_000,
		fetchMs,
		indexMs,
		...(await run(video, targets))
	};
}

const ms = (value: number) => `${value.toFixed(2)} ms`;

function addResultRow(label: string, result: BenchResult | Error) {
	const row = resultsBody.insertRow();
	const cells = (values: string[]) =>
		values.forEach((value) => (row.insertCell().textContent = value));

	if (result instanceof Error) {
		cells([label, "", "", "", "", "", "", result.message]);
		return;
	}

	const elapsed = result.timings.map((t) => t.elapsedMs).sort((a, b) => a - b);
	const averageDecoded =
		result.timings.reduce((sum, t) => sum + t.decodedFrames, 0) / result.timings.length;

	const notes: string[] = [];
	if (result.missingFrames > 0) notes.push(`${result.missingFrames} target frames missing`);
	if (result.detailLabel) {
		const details = result.timings.map((t) => t.detailMs ?? 0).sort((a, b) => a - b);
		notes.push(`${result.detailLabel} median ${ms(percentile(details, 0.5))}`);
	}

	cells([
		label,
		`${result.fileMegabytes.toFixed(1)} MB`,
		`${ms(result.fetchMs)} + ${ms(result.indexMs)}`,
		ms(percentile(elapsed, 0.5)),
		ms(percentile(elapsed, 0.95)),
		ms(elapsed.at(-1)!),
		averageDecoded.toFixed(1),
		notes.join(", ")
	]);
}

async function runAll() {
	runButton.disabled = true;
	resultsBody.replaceChildren();

	for (const source of SOURCES) {
		statusLine.textContent = `Running: ${source.label}`;
		try {
			addResultRow(source.label, await benchSource(source));
		} catch (error) {
			console.error(error);
			addResultRow(source.label, error instanceof Error ? error : new Error(String(error)));
		}
	}

	statusLine.textContent = `Done. ${SEEK_COUNT} random seeks per format, after ${WARMUP_SEEKS} warm-up seeks.`;
	runButton.disabled = false;
}

runButton.addEventListener("click", runAll);
