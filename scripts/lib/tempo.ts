import { SpectrumAnalyser } from "./fft";

const FRAME_SIZE = 1024;
const HOP_SIZE = 256;
const MIN_BPM = 60;
const MAX_BPM = 200;
const BPM_STEP = 0.1;
const BEAT_MULTIPLES = 4;
const PRIOR_CENTRE_BPM = 120;
const PRIOR_WIDTH_OCTAVES = 1;
const LOCAL_MEAN_SECONDS = 1;
const LOG_COMPRESSION = 1000;

function spectralFlux(samples: Float32Array): Float64Array {
	const analyser = new SpectrumAnalyser(FRAME_SIZE);
	const binCount = FRAME_SIZE / 2 + 1;
	const frameCount = Math.max(0, Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1);
	const flux = new Float64Array(frameCount);
	let previous = new Float32Array(binCount);
	let current = new Float32Array(binCount);

	for (let frame = 0; frame < frameCount; frame++) {
		const magnitudes = analyser.analyse(samples, frame * HOP_SIZE);
		let rise = 0;
		for (let k = 0; k < binCount; k++) {
			current[k] = Math.log1p(LOG_COMPRESSION * magnitudes[k]);
			rise += Math.max(0, current[k] - previous[k]);
		}
		flux[frame] = frame === 0 ? 0 : rise;
		[previous, current] = [current, previous];
	}
	return flux;
}

function removeLocalMean(signal: Float64Array, radius: number): Float64Array {
	const prefix = new Float64Array(signal.length + 1);
	for (let i = 0; i < signal.length; i++) prefix[i + 1] = prefix[i] + signal[i];

	return signal.map((value, i) => {
		const from = Math.max(0, i - radius);
		const to = Math.min(signal.length, i + radius + 1);
		return Math.max(0, value - (prefix[to] - prefix[from]) / (to - from));
	});
}

function autocorrelation(signal: Float64Array, maxLag: number): Float64Array {
	const result = new Float64Array(maxLag + 1);
	for (let lag = 0; lag <= maxLag && lag < signal.length; lag++) {
		let sum = 0;
		for (let i = 0; i + lag < signal.length; i++) sum += signal[i] * signal[i + lag];
		result[lag] = sum / (signal.length - lag);
	}
	return result;
}

function valueAt(values: Float64Array, position: number): number {
	const index = Math.floor(position);
	if (index + 1 >= values.length) return 0;
	const fraction = position - index;
	return values[index] * (1 - fraction) + values[index + 1] * fraction;
}

export type TempoEstimate = { bpm: number; confidence: number };

export function estimateTempo(samples: Float32Array, sampleRate: number): TempoEstimate | null {
	const framesPerSecond = sampleRate / HOP_SIZE;
	const onsets = removeLocalMean(
		spectralFlux(samples),
		Math.round(LOCAL_MEAN_SECONDS * framesPerSecond)
	);

	const lagForBpm = (bpm: number) => (60 / bpm) * framesPerSecond;
	const acf = autocorrelation(onsets, Math.ceil(lagForBpm(MIN_BPM) * BEAT_MULTIPLES) + 1);
	if (acf[0] === 0) return null;

	const meanPeriodicity = (bpm: number) => {
		let sum = 0;
		for (let multiple = 1; multiple <= BEAT_MULTIPLES; multiple++) {
			sum += valueAt(acf, lagForBpm(bpm) * multiple);
		}
		return sum / BEAT_MULTIPLES;
	};

	let bestBpm: number | null = null;
	let bestScore = 0;
	for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += BPM_STEP) {
		const octavesFromCentre = Math.log2(bpm / PRIOR_CENTRE_BPM) / PRIOR_WIDTH_OCTAVES;
		const score = meanPeriodicity(bpm) * Math.exp(-0.5 * octavesFromCentre ** 2);
		if (score > bestScore) {
			bestScore = score;
			bestBpm = bpm;
		}
	}
	if (bestBpm === null) return null;

	return {
		bpm: Number(bestBpm.toFixed(1)),
		confidence: Number(Math.min(1, meanPeriodicity(bestBpm) / acf[0]).toFixed(2))
	};
}
