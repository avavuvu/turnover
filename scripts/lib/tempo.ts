import { essentia, withVector } from "./essentia"

const MAX_RHYTHM_CONFIDENCE = 5.32

export type TempoEstimate = { bpm: number; confidence: number }

export const estimateTempo = (samples: Float32Array): TempoEstimate | null => {
	const { bpm, confidence } = withVector(samples, (vector) => essentia.RhythmExtractor2013(vector))
	if (!bpm) return null
	return {
		bpm: Number(bpm.toFixed(1)),
		confidence: Number(Math.min(1, confidence / MAX_RHYTHM_CONFIDENCE).toFixed(2))
	}
}
