import { randomFromKey } from "../random";

export type ClipTiming = {
	width: number;
	height: number;
	durationMicros: number;
	sampleIndexAt(timeMicros: number): number;
};

export type Voice = {
	index: number;
	clipIndex: number;
	clip: ClipTiming;
	texture: WebGLTexture;
	plannedSample: number;
	displayedSample: number;
	pendingSample: number | null;
	requestedAtMs: number;
};

export type TriggerGrid = {
	startMs: number;
	intervalMs: number;
	seed: number;
};

const END_MARGIN_MS = 100;

export function voiceMediaTimeMicros(voice: Voice, grid: TriggerGrid, nowMs: number): number {
	const elapsedMs = Math.max(0, nowMs - grid.startMs);
	const triggerNumber = Math.floor(elapsedMs / grid.intervalMs);
	const sinceTriggerMs = elapsedMs - triggerNumber * grid.intervalMs;

	const latestStartMicros = Math.max(
		0,
		voice.clip.durationMicros - (grid.intervalMs + END_MARGIN_MS) * 1000
	);
	const startMicros = randomFromKey(grid.seed, voice.index, triggerNumber) * latestStartMicros;

	return startMicros + sinceTriggerMs * 1000;
}
