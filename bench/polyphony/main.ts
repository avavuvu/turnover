import charliIntraUrl from "../videos/charli_intra.mp4?url";
import mbvIntraUrl from "../videos/mbv_intra.mp4?url";
import nyilyIntraUrl from "../videos/nyily_intra.mp4?url";
import waterIntraUrl from "../videos/water_intra.mp4?url";
import charliHapUrl from "../videos/charli_hap.mov?url";
import mbvHapUrl from "../videos/mbv_hap.mov?url";
import nyilyHapUrl from "../videos/nyily_hap.mov?url";
import waterHapUrl from "../videos/water_hap.mov?url";

import {
	type IndexedVideo,
	indexVideo,
	lastIndexAtOrBefore,
	sampleIndexAtTime
} from "../indexed-video";
import { GridCompositor } from "./compositor";
import {
	type FrameSource,
	type FrameSourceHandlers,
	H264FrameSource,
	HapMainThreadSource,
	HapWorkerSource,
	loadHapWorker
} from "./frame-sources";
import type { LoadedClipInfo } from "./hap-worker";
import { type PolyphonyResult, runPolyphony, type TextureKind } from "./run";
import type { ClipTiming } from "./voice";

const INTRA_URLS = [mbvIntraUrl, nyilyIntraUrl, charliIntraUrl, waterIntraUrl];
const HAP_URLS = [mbvHapUrl, nyilyHapUrl, charliHapUrl, waterHapUrl];

const VOICE_COUNTS = [1, 4, 16, 32, 64, 128];
const WARMUP_MS = 1000;
const MEASURE_MS = 5000;
const RETRIGGER_MS = 125;
const SEED = 42;
const PAUSE_BETWEEN_RUNS_MS = 500;

type PreparedSetup = {
	clips: ClipTiming[];
	textureKind: TextureKind;
	createSource: (handlers: FrameSourceHandlers) => FrameSource;
	dispose(): void;
};

type Setup = { label: string; prepare(): Promise<PreparedSetup> };

const runButton = document.querySelector<HTMLButtonElement>("#run")!;
const statusLine = document.querySelector<HTMLParagraphElement>("#status")!;
const resultsBody = document.querySelector<HTMLTableSectionElement>("#results tbody")!;
const canvas = document.querySelector<HTMLCanvasElement>("#grid")!;

async function loadIndexedVideos(urls: string[]): Promise<IndexedVideo[]> {
	return Promise.all(urls.map(async (url) => indexVideo(await (await fetch(url)).arrayBuffer())));
}

function timingFromIndexedVideo(video: IndexedVideo): ClipTiming {
	return {
		width: video.width,
		height: video.height,
		durationMicros: video.durationMicros,
		sampleIndexAt: (timeMicros) => sampleIndexAtTime(video, timeMicros)
	};
}

function timingFromWorkerClip(clip: LoadedClipInfo): ClipTiming {
	const timestamps = clip.timestampsMicros;
	return {
		width: clip.width,
		height: clip.height,
		durationMicros: clip.durationMicros,
		sampleIndexAt: (timeMicros) =>
			lastIndexAtOrBefore((i) => timestamps[i], timestamps.length, timeMicros)
	};
}

let intraVideos: Promise<IndexedVideo[]> | null = null;
const loadIntraVideos = () => (intraVideos ??= loadIndexedVideos(INTRA_URLS));

function h264Setup(label: string, sharing: "per-voice" | "per-clip"): Setup {
	return {
		label,
		async prepare() {
			const videos = await loadIntraVideos();
			return {
				clips: videos.map(timingFromIndexedVideo),
				textureKind: "rgba",
				createSource: (handlers) => new H264FrameSource(videos, sharing, handlers),
				dispose() {}
			};
		}
	};
}

const SETUPS: Setup[] = [
	h264Setup("H.264 all-intra, one decoder per voice", "per-voice"),
	h264Setup("H.264 all-intra, one decoder per clip", "per-clip"),
	{
		label: "HAP, main thread",
		async prepare() {
			intraVideos = null;
			let videos: IndexedVideo[] = await loadIndexedVideos(HAP_URLS);
			return {
				clips: videos.map(timingFromIndexedVideo),
				textureKind: "bc1",
				createSource: (handlers) => new HapMainThreadSource(videos, handlers),
				dispose() {
					videos = [];
				}
			};
		}
	},
	{
		label: "HAP, Worker",
		async prepare() {
			const { worker, clips } = await loadHapWorker(HAP_URLS);
			return {
				clips: clips.map(timingFromWorkerClip),
				textureKind: "bc1",
				createSource: (handlers) => new HapWorkerSource(worker, clips, handlers),
				dispose: () => worker.terminate()
			};
		}
	}
];

const ms = (value: number) => `${value.toFixed(1)} ms`;
const pause = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs));

function addRow(values: string[]) {
	const row = resultsBody.insertRow();
	for (const value of values) row.insertCell().textContent = value;
}

function addResultRow(label: string, result: PolyphonyResult) {
	addRow([
		label,
		String(result.voiceCount),
		`${(result.onTimeFraction * 100).toFixed(1)} %`,
		`${result.framesDeliveredPerSecond.toFixed(0)} / ${result.framesNeededPerSecond.toFixed(0)}`,
		ms(result.latencyP95Ms),
		ms(result.latencyMaxMs),
		ms(result.tickGapMedianMs),
		ms(result.tickGapMaxMs),
		ms(result.tickWorkMaxMs),
		String(result.errors)
	]);
}

async function runSetup(setup: Setup, compositor: GridCompositor) {
	statusLine.textContent = `Loading: ${setup.label}`;
	const prepared = await setup.prepare();

	try {
		for (const voiceCount of VOICE_COUNTS) {
			statusLine.textContent = `Running: ${setup.label}, ${voiceCount} voices`;
			const result = await runPolyphony({
				voiceCount,
				clips: prepared.clips,
				textureKind: prepared.textureKind,
				compositor,
				createSource: prepared.createSource,
				warmupMs: WARMUP_MS,
				measureMs: MEASURE_MS,
				retriggerMs: RETRIGGER_MS,
				seed: SEED
			});
			addResultRow(setup.label, result);
			await pause(PAUSE_BETWEEN_RUNS_MS);
		}
	} finally {
		prepared.dispose();
	}
}

async function runAll() {
	runButton.disabled = true;
	resultsBody.replaceChildren();
	const compositor = new GridCompositor(canvas);

	for (const setup of SETUPS) {
		try {
			await runSetup(setup, compositor);
		} catch (error) {
			console.error(error);
			addRow([setup.label, "", "", "", "", "", "", "", "", String(error)]);
		}
	}

	statusLine.textContent = `Done. Each run: ${WARMUP_MS} ms warm-up, ${MEASURE_MS} ms measured, all voices retrigger every ${RETRIGGER_MS} ms.`;
	runButton.disabled = false;
}

runButton.addEventListener("click", runAll);
