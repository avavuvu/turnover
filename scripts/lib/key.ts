import { Range } from "@tonaljs/tonal";
import { SpectrumAnalyser } from "./fft";

const PITCH_CLASSES = Range.chromatic(["C0", "B0"], { sharps: true, pitchClass: true });

const KRUMHANSL_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KRUMHANSL_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const FRAME_SIZE = 8192;
const HOP_SIZE = 2048;
const TUNING_MIN_HZ = 100;
const TUNING_MAX_HZ = 4000;
const TUNING_PEAK_THRESHOLD = 0.2;
const CHROMA_MIN_HZ = 55;
const CHROMA_MAX_HZ = 1760;
const SILENCE_RMS = 10 ** (-50 / 20);
const SECTION_WINDOW_SECONDS = 8;
const SECTION_HOP_SECONDS = 4;

type Mode = "major" | "minor";
type Key = { tonic: number; mode: Mode };
type Chroma = Float64Array;

export type KeyEstimate = {
	key: string;
	camelot: string;
	confidence: number;
	alternativeKey: string;
};

export type KeySection = {
	start: number;
	end: number;
	key: string;
	confidence: number;
};

export type KeyAnalysis = {
	tuningCents: number;
	overall: KeyEstimate;
	sections: KeySection[];
};

const keyName = ({ tonic, mode }: Key) => `${PITCH_CLASSES[tonic]} ${mode}`;

function camelotCode({ tonic, mode }: Key): string {
	const relativeMajor = mode === "major" ? tonic : (tonic + 3) % 12;
	const number = ((((relativeMajor * 7) % 12) + 7) % 12) + 1;
	return `${number}${mode === "major" ? "B" : "A"}`;
}

function frameRms(samples: Float32Array, start: number): number {
	let sum = 0;
	const end = Math.min(samples.length, start + FRAME_SIZE);
	for (let i = start; i < end; i++) sum += samples[i] * samples[i];
	return Math.sqrt(sum / FRAME_SIZE);
}

function frameStarts(samples: Float32Array): number[] {
	const starts: number[] = [];
	for (let start = 0; start + FRAME_SIZE <= samples.length; start += HOP_SIZE) starts.push(start);
	return starts;
}

function estimateTuningCents(samples: Float32Array, sampleRate: number): number {
	const analyser = new SpectrumAnalyser(FRAME_SIZE);
	const minBin = Math.ceil((TUNING_MIN_HZ * FRAME_SIZE) / sampleRate);
	const maxBin = Math.floor((TUNING_MAX_HZ * FRAME_SIZE) / sampleRate);
	let sumCos = 0;
	let sumSin = 0;

	for (const start of frameStarts(samples)) {
		if (frameRms(samples, start) < SILENCE_RMS) continue;
		const magnitudes = analyser.analyse(samples, start);

		let frameMax = 0;
		for (let k = minBin; k <= maxBin; k++) frameMax = Math.max(frameMax, magnitudes[k]);
		const threshold = frameMax * TUNING_PEAK_THRESHOLD;

		for (let k = minBin; k <= maxBin; k++) {
			const peak = magnitudes[k];
			if (peak < threshold || peak <= magnitudes[k - 1] || peak < magnitudes[k + 1]) continue;

			const left = Math.log(magnitudes[k - 1] + 1e-12);
			const centre = Math.log(peak + 1e-12);
			const right = Math.log(magnitudes[k + 1] + 1e-12);
			const offset = (0.5 * (left - right)) / (left - 2 * centre + right);
			const frequency = analyser.binFrequency(k + offset, sampleRate);

			const cents = 1200 * Math.log2(frequency / 440);
			const angle = (2 * Math.PI * cents) / 100;
			sumCos += peak * Math.cos(angle);
			sumSin += peak * Math.sin(angle);
		}
	}

	if (sumCos === 0 && sumSin === 0) return 0;
	return (Math.atan2(sumSin, sumCos) * 100) / (2 * Math.PI);
}

function chromaFrames(
	samples: Float32Array,
	sampleRate: number,
	tuningCents: number
): (Chroma | null)[] {
	const analyser = new SpectrumAnalyser(FRAME_SIZE);
	const referenceHz = 440 * 2 ** (tuningCents / 1200);
	const minBin = Math.ceil((CHROMA_MIN_HZ * FRAME_SIZE) / sampleRate);
	const maxBin = Math.floor((CHROMA_MAX_HZ * FRAME_SIZE) / sampleRate);

	const binPitchClass = new Int8Array(maxBin + 1);
	const binWeight = new Float32Array(maxBin + 1);
	for (let k = minBin; k <= maxBin; k++) {
		const midi = 69 + 12 * Math.log2(analyser.binFrequency(k, sampleRate) / referenceHz);
		const nearest = Math.round(midi);
		binPitchClass[k] = ((nearest % 12) + 12) % 12;
		binWeight[k] = Math.max(0, 1 - 2 * Math.abs(midi - nearest));
	}

	return frameStarts(samples).map((start) => {
		if (frameRms(samples, start) < SILENCE_RMS) return null;
		const magnitudes = analyser.analyse(samples, start);
		const chroma: Chroma = new Float64Array(12);
		for (let k = minBin; k <= maxBin; k++) {
			chroma[binPitchClass[k]] += binWeight[k] * Math.sqrt(magnitudes[k]);
		}
		const peak = Math.max(...chroma);
		if (peak > 0) for (let pc = 0; pc < 12; pc++) chroma[pc] /= peak;
		return chroma;
	});
}

function correlation(chroma: Chroma, profile: number[], tonic: number): number {
	let meanChroma = 0;
	let meanProfile = 0;
	for (let pc = 0; pc < 12; pc++) {
		meanChroma += chroma[pc] / 12;
		meanProfile += profile[pc] / 12;
	}
	let covariance = 0;
	let varianceChroma = 0;
	let varianceProfile = 0;
	for (let pc = 0; pc < 12; pc++) {
		const c = chroma[pc] - meanChroma;
		const p = profile[(pc - tonic + 12) % 12] - meanProfile;
		covariance += c * p;
		varianceChroma += c * c;
		varianceProfile += p * p;
	}
	if (varianceChroma === 0) return 0;
	return covariance / Math.sqrt(varianceChroma * varianceProfile);
}

function rankKeys(chroma: Chroma): { key: Key; score: number }[] {
	const candidates: { key: Key; score: number }[] = [];
	for (let tonic = 0; tonic < 12; tonic++) {
		candidates.push({
			key: { tonic, mode: "major" },
			score: correlation(chroma, KRUMHANSL_MAJOR, tonic)
		});
		candidates.push({
			key: { tonic, mode: "minor" },
			score: correlation(chroma, KRUMHANSL_MINOR, tonic)
		});
	}
	return candidates.sort((a, b) => b.score - a.score);
}

function sumChroma(frames: (Chroma | null)[], from: number, to: number): Chroma | null {
	const total: Chroma = new Float64Array(12);
	let count = 0;
	for (let i = from; i < Math.min(to, frames.length); i++) {
		const frame = frames[i];
		if (!frame) continue;
		for (let pc = 0; pc < 12; pc++) total[pc] += frame[pc];
		count++;
	}
	return count > 0 ? total : null;
}

const round = (value: number, decimals: number) => Number(value.toFixed(decimals));

type WindowKey = { start: number; key: string | null; score: number };

function windowKeys(frames: (Chroma | null)[], framesPerSecond: number): WindowKey[] {
	const windowFrames = Math.round(SECTION_WINDOW_SECONDS * framesPerSecond);
	const hopFrames = Math.round(SECTION_HOP_SECONDS * framesPerSecond);
	const windows: WindowKey[] = [];

	for (let first = 0; first < frames.length; first += hopFrames) {
		const chroma = sumChroma(frames, first, first + windowFrames);
		const best = chroma ? rankKeys(chroma)[0] : null;
		windows.push({
			start: first / framesPerSecond,
			key: best ? keyName(best.key) : null,
			score: best?.score ?? 0
		});
	}
	return windows;
}

function mergeIntoSections(windows: WindowKey[], durationSeconds: number): KeySection[] {
	const sections: KeySection[] = [];
	let run: WindowKey[] = [];

	const closeRun = (end: number) => {
		if (run.length === 0 || run[0].key === null) return;
		const meanScore = run.reduce((sum, w) => sum + w.score, 0) / run.length;
		sections.push({
			start: round(run[0].start, 2),
			end: round(end, 2),
			key: run[0].key,
			confidence: round(meanScore, 2)
		});
	};

	for (const window of windows) {
		if (run.length > 0 && run[0].key === window.key) {
			run.push(window);
			continue;
		}
		closeRun(window.start);
		run = [window];
	}
	closeRun(durationSeconds);

	return sections;
}

export function analyseKey(samples: Float32Array, sampleRate: number): KeyAnalysis {
	const tuningCents = estimateTuningCents(samples, sampleRate);
	const frames = chromaFrames(samples, sampleRate, tuningCents);

	const total = sumChroma(frames, 0, frames.length);
	if (!total) throw new Error("The audio is silent, so the key cannot be found.");
	const [best, second] = rankKeys(total);

	return {
		tuningCents: round(tuningCents, 1),
		overall: {
			key: keyName(best.key),
			camelot: camelotCode(best.key),
			confidence: round(best.score, 2),
			alternativeKey: keyName(second.key)
		},
		sections: mergeIntoSections(
			windowKeys(frames, sampleRate / HOP_SIZE),
			samples.length / sampleRate
		)
	};
}
