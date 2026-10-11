import { Bc1Renderer } from "./bc1-renderer";
import { bc1ByteLength, decodeHapFrame, HapTextureFormat } from "./hap";
import { type IndexedVideo, sampleIndexAtTime } from "./indexed-video";

export type HapSeekResult = {
	elapsedMs: number;
	decompressMs: number;
	uploadMs: number;
};

export class HapSeeker {
	private readonly renderer: Bc1Renderer;
	private readonly textureBuffer: Uint8Array;

	constructor(
		private readonly video: IndexedVideo,
		canvas: HTMLCanvasElement
	) {
		this.renderer = new Bc1Renderer(canvas, video.width, video.height);
		this.textureBuffer = new Uint8Array(bc1ByteLength(video.width, video.height));
	}

	seek(timeMicros: number): HapSeekResult {
		const sample = this.video.samples[sampleIndexAtTime(this.video, timeMicros)];

		const started = performance.now();
		const frame = decodeHapFrame(sample.data, this.textureBuffer);
		const decompressed = performance.now();

		if (frame.textureFormat !== HapTextureFormat.RGB_DXT1) {
			throw new Error(
				`Only HAP (DXT1) is supported, got format 0x${frame.textureFormat.toString(16)}`
			);
		}

		this.renderer.drawFrame(frame.texture);
		this.renderer.waitForGpu();
		const finished = performance.now();

		return {
			elapsedMs: finished - started,
			decompressMs: decompressed - started,
			uploadMs: finished - decompressed
		};
	}
}
