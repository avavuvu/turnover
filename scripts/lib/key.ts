import { Note } from "@tonaljs/tonal";

import type { KeySection } from "../../src/clip-info";
import { normaliseKey } from "../../src/clip-position";
import { essentia, SAMPLE_RATE, withVector } from "./essentia";

const SECTION_WINDOW_SECONDS = 8;
const SECTION_HOP_SECONDS = 4;
const MIN_WINDOW_SECONDS = 1;
const SILENCE_RMS = 10 ** (-50 / 20);

type KeyEstimate = { key: string; confidence: number };
type KeyWindow = { start: number; estimate: KeyEstimate | null };

export type KeyAnalysis = KeyEstimate & {
	camelot: string;
	tuningCents: number;
	sections: KeySection[];
};

const round = (value: number, decimals: number) => Number(value.toFixed(decimals));

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function camelotCode(key: string): string {
	const [tonic, mode] = key.split(" ");
	const chroma = Note.chroma(tonic)!;
	const relativeMajor = mode === "major" ? chroma : (chroma + 3) % 12;
	const number = ((((relativeMajor * 7) % 12) + 7) % 12) + 1;
	return `${number}${mode === "major" ? "B" : "A"}`;
}

function detectKey(samples: Float32Array): KeyEstimate | null {
	if (samples.length < MIN_WINDOW_SECONDS * SAMPLE_RATE) return null;
	return withVector(samples, (vector) => {
		if (essentia.RMS(vector).rms < SILENCE_RMS) return null;
		const { key, scale, strength } = essentia.KeyExtractor(vector);
		return { key: normaliseKey(`${key} ${scale}`), confidence: round(strength, 2) };
	});
}

function estimateTuningCents(samples: Float32Array): number {
	const frequencies = withVector(samples, (vector) =>
		essentia.vectorToArray(essentia.TuningFrequencyExtractor(vector).tuningFrequency)
	);
	const sorted = Float32Array.from(frequencies).sort();
	const median = sorted[Math.floor(sorted.length / 2)] ?? 440;
	return round(1200 * Math.log2(median / 440), 1);
}

function keyWindows(samples: Float32Array): KeyWindow[] {
	const windowLength = SECTION_WINDOW_SECONDS * SAMPLE_RATE;
	const hopLength = SECTION_HOP_SECONDS * SAMPLE_RATE;
	const windows: KeyWindow[] = [];
	for (let start = 0; start < samples.length; start += hopLength) {
		windows.push({
			start: start / SAMPLE_RATE,
			estimate: detectKey(samples.subarray(start, start + windowLength))
		});
	}
	return windows;
}

function mergeIntoSections(windows: KeyWindow[], durationSeconds: number): KeySection[] {
	const runs: { start: number; end: number; key: string; confidences: number[] }[] = [];

	windows.forEach(({ start, estimate }, index) => {
		if (!estimate) return;
		const end = windows[index + 1]?.start ?? durationSeconds;
		const run = runs.at(-1);
		if (run && run.key === estimate.key && run.end === start) {
			run.end = end;
			run.confidences.push(estimate.confidence);
		} else {
			runs.push({ start, end, key: estimate.key, confidences: [estimate.confidence] });
		}
	});

	return runs.map(({ start, end, key, confidences }) => ({
		start: round(start, 2),
		end: round(end, 2),
		key,
		confidence: round(mean(confidences), 2)
	}));
}

export function analyseKey(samples: Float32Array): KeyAnalysis {
	const overall = detectKey(samples);
	if (!overall) throw new Error("The audio is silent, so the key cannot be found.");

	return {
		...overall,
		camelot: camelotCode(overall.key),
		tuningCents: estimateTuningCents(samples),
		sections: mergeIntoSections(keyWindows(samples), samples.length / SAMPLE_RATE)
	};
}
