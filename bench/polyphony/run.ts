import { type FramePayload, GridCompositor, releasePayload } from "./compositor";
import type { FrameSource, FrameSourceHandlers } from "./frame-sources";
import { type ClipTiming, type TriggerGrid, type Voice, voiceMediaTimeMicros } from "./voice";

export type TextureKind = "rgba" | "bc1";

export type PolyphonyOptions = {
	voiceCount: number;
	clips: ClipTiming[];
	textureKind: TextureKind;
	compositor: GridCompositor;
	createSource: (handlers: FrameSourceHandlers) => FrameSource;
	warmupMs: number;
	measureMs: number;
	retriggerMs: number;
	seed: number;
};

export type PolyphonyResult = {
	voiceCount: number;
	onTimeFraction: number;
	framesNeededPerSecond: number;
	framesDeliveredPerSecond: number;
	latencyP95Ms: number;
	latencyMaxMs: number;
	tickGapMedianMs: number;
	tickGapMaxMs: number;
	tickWorkMaxMs: number;
	errors: number;
};

const ASSUMED_TICK_MS = 1000 / 60;
const TICK_ESTIMATE_SMOOTHING = 0.1;

function percentile(values: number[], fraction: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

const nextAnimationFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

export async function runPolyphony(options: PolyphonyOptions): Promise<PolyphonyResult> {
	const { compositor, clips, voiceCount } = options;

	const voices: Voice[] = Array.from({ length: voiceCount }, (_, index) => {
		const clipIndex = index % clips.length;
		const clip = clips[clipIndex];
		return {
			index,
			clipIndex,
			clip,
			texture:
				options.textureKind === "bc1"
					? compositor.createBc1Texture(clip.width, clip.height)
					: compositor.createRgbaTexture(),
			plannedSample: -1,
			displayedSample: -1,
			pendingSample: null,
			requestedAtMs: 0
		};
	});

	let measuring = false;
	let finished = false;
	let voiceTicks = 0;
	let staleVoiceTicks = 0;
	let framesNeeded = 0;
	let framesDelivered = 0;
	const latenciesMs: number[] = [];
	const tickGapsMs: number[] = [];
	const tickWorkMs: number[] = [];

	const handlers: FrameSourceHandlers = {
		onFrame(voice: Voice, sampleIndex: number, payload: FramePayload) {
			if (finished) {
				releasePayload(payload);
				return;
			}
			compositor.upload(voice.texture, payload);
			voice.displayedSample = sampleIndex;
			voice.pendingSample = null;
			if (measuring) {
				latenciesMs.push(performance.now() - voice.requestedAtMs);
				framesDelivered++;
			}
			if (voice.plannedSample !== voice.displayedSample) requestFrame(voice);
		},
		onFailed(voice: Voice) {
			voice.pendingSample = null;
		}
	};

	const source = options.createSource(handlers);

	function requestFrame(voice: Voice) {
		voice.pendingSample = voice.plannedSample;
		voice.requestedAtMs = performance.now();
		source.request(voice, voice.plannedSample);
	}

	const runStartMs = performance.now();
	const grid: TriggerGrid = {
		startMs: runStartMs,
		intervalMs: options.retriggerMs,
		seed: options.seed
	};
	let tickEstimateMs = ASSUMED_TICK_MS;
	let previousTickMs = runStartMs;

	try {
		for (;;) {
			await nextAnimationFrame();
			const tickStartMs = performance.now();
			const gapMs = tickStartMs - previousTickMs;
			previousTickMs = tickStartMs;
			tickEstimateMs += (gapMs - tickEstimateMs) * TICK_ESTIMATE_SMOOTHING;

			const elapsedMs = tickStartMs - runStartMs;
			if (elapsedMs >= options.warmupMs + options.measureMs) break;
			measuring = elapsedMs >= options.warmupMs;

			if (measuring) {
				tickGapsMs.push(gapMs);
				for (const voice of voices) {
					voiceTicks++;
					if (voice.displayedSample !== voice.plannedSample) staleVoiceTicks++;
				}
			}

			compositor.draw(voices.map((v) => v.texture));

			const nextTickMs = tickStartMs + tickEstimateMs;
			for (const voice of voices) {
				const planned = voice.clip.sampleIndexAt(voiceMediaTimeMicros(voice, grid, nextTickMs));
				if (planned !== voice.plannedSample && measuring) framesNeeded++;
				voice.plannedSample = planned;
				if (voice.pendingSample === null && voice.displayedSample !== planned) {
					requestFrame(voice);
				}
			}

			if (measuring) tickWorkMs.push(performance.now() - tickStartMs);
		}
	} finally {
		finished = true;
		source.close();
		for (const voice of voices) compositor.deleteTexture(voice.texture);
	}

	const measuredSeconds = options.measureMs / 1000;
	return {
		voiceCount,
		onTimeFraction: voiceTicks === 0 ? 0 : 1 - staleVoiceTicks / voiceTicks,
		framesNeededPerSecond: framesNeeded / measuredSeconds,
		framesDeliveredPerSecond: framesDelivered / measuredSeconds,
		latencyP95Ms: percentile(latenciesMs, 0.95),
		latencyMaxMs: Math.max(0, ...latenciesMs),
		tickGapMedianMs: percentile(tickGapsMs, 0.5),
		tickGapMaxMs: Math.max(0, ...tickGapsMs),
		tickWorkMaxMs: Math.max(0, ...tickWorkMs),
		errors: source.errorCount
	};
}
