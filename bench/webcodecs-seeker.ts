import { type IndexedVideo, keyframeIndexAtOrBefore, sampleIndexAtTime } from "./indexed-video";

export type WebCodecsSeekResult = {
	elapsedMs: number;
	decodedFrames: number;
	frame: VideoFrame | undefined;
};

export function decoderConfigFor(video: IndexedVideo): VideoDecoderConfig {
	return {
		codec: video.codec,
		codedWidth: video.width,
		codedHeight: video.height,
		description: video.description,
		optimizeForLatency: true,
		hardwareAcceleration: "prefer-hardware"
	};
}

export class WebCodecsSeeker {
	private readonly decoder: VideoDecoder;
	private decodedFrames: VideoFrame[] = [];

	constructor(private readonly video: IndexedVideo) {
		this.decoder = new VideoDecoder({
			output: (frame) => this.decodedFrames.push(frame),
			error: (error) => console.error(error)
		});
		this.decoder.configure(decoderConfigFor(video));
	}

	async seek(timeMicros: number): Promise<WebCodecsSeekResult> {
		const targetIndex = sampleIndexAtTime(this.video, timeMicros);
		const keyframeIndex = keyframeIndexAtOrBefore(this.video, targetIndex);
		const targetTimestamp = this.video.samples[targetIndex].timestampMicros;

		const started = performance.now();
		for (let i = keyframeIndex; i <= targetIndex; i++) {
			const sample = this.video.samples[i];
			this.decoder.decode(
				new EncodedVideoChunk({
					type: sample.isKeyframe ? "key" : "delta",
					timestamp: sample.timestampMicros,
					duration: sample.durationMicros,
					data: sample.data
				})
			);
		}
		await this.decoder.flush();
		const elapsedMs = performance.now() - started;

		const frames = this.decodedFrames;
		this.decodedFrames = [];
		const frame = frames.find((f) => f.timestamp === targetTimestamp);
		for (const f of frames) if (f !== frame) f.close();

		return { elapsedMs, decodedFrames: targetIndex - keyframeIndex + 1, frame };
	}

	close() {
		for (const f of this.decodedFrames) f.close();
		if (this.decoder.state !== "closed") this.decoder.close();
	}
}
