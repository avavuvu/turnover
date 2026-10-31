import { Essentia, EssentiaWASM } from "essentia.js"

export const SAMPLE_RATE = 44100

export const essentia = new Essentia(EssentiaWASM)

type Vector = ReturnType<Essentia["arrayToVector"]>

export const withVector = <T>(samples: Float32Array, use: (vector: Vector) => T): T => {
	const vector = essentia.arrayToVector(samples)
	try {
		return use(vector)
	} finally {
		vector.delete()
	}
}
