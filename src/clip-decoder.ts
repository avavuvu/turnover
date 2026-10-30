import type { ClipMedia } from "./clip-media";

type PendingFrame = {
	resolve(frame: VideoFrame): void;
	reject(error: Error): void;
};

export class ClipDecoder {
	private decoder: VideoDecoder | null = null;
	private readonly pending = new Map<number, PendingFrame>();
	private nextRequestId = 0;

	constructor(private readonly media: ClipMedia) {}

	decode(sampleIndex: number): Promise<VideoFrame> {
		const requestId = this.nextRequestId++;
		const decoder = this.decoder ?? this.createDecoder();

		return new Promise((resolve, reject) => {
			this.pending.set(requestId, { resolve, reject });
			decoder.decode(
				new EncodedVideoChunk({
					type: "key",
					timestamp: requestId,
					data: this.media.samplesInPresentationOrder[sampleIndex].data
				})
			);
		});
	}

	close() {
		this.failPending(new Error("decoder closed"));
		if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
		this.decoder = null;
	}

	private createDecoder(): VideoDecoder {
		const decoder = new VideoDecoder({
			output: (frame) => this.deliver(frame),
			error: (error) => {
				console.error(`${this.media.url}:`, error);
				this.decoder = null;
				this.failPending(error);
			}
		});
		decoder.configure(this.media.decoderConfig);
		this.decoder = decoder;
		return decoder;
	}

	private deliver(frame: VideoFrame) {
		const request = this.pending.get(frame.timestamp);
		if (!request) {
			frame.close();
			return;
		}
		this.pending.delete(frame.timestamp);
		request.resolve(frame);
	}

	private failPending(error: Error) {
		for (const request of this.pending.values()) request.reject(error);
		this.pending.clear();
	}
}
