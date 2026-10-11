export class SpectrumAnalyser {
	readonly magnitudes: Float32Array;
	private readonly window: Float32Array;
	private readonly real: Float64Array;
	private readonly imag: Float64Array;
	private readonly cos: Float64Array;
	private readonly sin: Float64Array;
	private readonly bitReversed: Uint32Array;

	constructor(readonly size: number) {
		if (size < 2 || (size & (size - 1)) !== 0) throw new Error(`FFT size must be a power of 2`);

		this.magnitudes = new Float32Array(size / 2 + 1);
		this.real = new Float64Array(size);
		this.imag = new Float64Array(size);
		this.window = Float32Array.from(
			{ length: size },
			(_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)
		);
		this.cos = Float64Array.from({ length: size / 2 }, (_, k) =>
			Math.cos((2 * Math.PI * k) / size)
		);
		this.sin = Float64Array.from({ length: size / 2 }, (_, k) =>
			Math.sin((2 * Math.PI * k) / size)
		);

		const bits = Math.log2(size);
		this.bitReversed = Uint32Array.from({ length: size }, (_, i) => {
			let reversed = 0;
			for (let b = 0; b < bits; b++) reversed |= ((i >> b) & 1) << (bits - 1 - b);
			return reversed;
		});
	}

	binFrequency(bin: number, sampleRate: number): number {
		return (bin * sampleRate) / this.size;
	}

	analyse(samples: Float32Array, start: number): Float32Array {
		const { size, real, imag, window, cos, sin, bitReversed } = this;

		for (let i = 0; i < size; i++) {
			const index = start + i;
			real[bitReversed[i]] = index < samples.length ? samples[index] * window[i] : 0;
			imag[i] = 0;
		}

		for (let half = 1; half < size; half *= 2) {
			const twiddleStep = size / (half * 2);
			for (let block = 0; block < size; block += half * 2) {
				for (let k = 0; k < half; k++) {
					const c = cos[k * twiddleStep];
					const s = sin[k * twiddleStep];
					const a = block + k;
					const b = a + half;
					const productReal = real[b] * c + imag[b] * s;
					const productImag = imag[b] * c - real[b] * s;
					real[b] = real[a] - productReal;
					imag[b] = imag[a] - productImag;
					real[a] += productReal;
					imag[a] += productImag;
				}
			}
		}

		for (let k = 0; k <= size / 2; k++) this.magnitudes[k] = Math.hypot(real[k], imag[k]);
		return this.magnitudes;
	}
}
