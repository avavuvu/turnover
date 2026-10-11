import { bc1ByteLength, decodeHapFrame } from "../hap";
import type { IndexedVideo } from "../indexed-video";
import { decoderConfigFor } from "../webcodecs-seeker";
import type { FramePayload } from "./compositor";
import type { HapWorkerRequest, HapWorkerResponse, LoadedClipInfo } from "./hap-worker";
import type { Voice } from "./voice";

export type FrameSourceHandlers = {
	onFrame(voice: Voice, sampleIndex: number, payload: FramePayload): void;
	onFailed(voice: Voice): void;
};

export interface FrameSource {
	readonly errorCount: number;
	request(voice: Voice, sampleIndex: number): void;
	close(): void;
}

type PendingRequest = { voice: Voice; sampleIndex: number };

class TaggedDecoder {
	private decoder: VideoDecoder | null = null;
	private readonly pending = new Map<number, PendingRequest>();

	constructor(
		private readonly video: IndexedVideo,
		private readonly handlers: FrameSourceHandlers,
		private readonly onError: () => void
	) {}

	decode(tag: number, voice: Voice, sampleIndex: number) {
		const decoder = this.decoder ?? this.createDecoder();
		this.pending.set(tag, { voice, sampleIndex });
		decoder.decode(
			new EncodedVideoChunk({
				type: "key",
				timestamp: tag,
				data: this.video.samples[sampleIndex].data
			})
		);
	}

	close() {
		this.pending.clear();
		if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
		this.decoder = null;
	}

	private createDecoder(): VideoDecoder {
		const decoder = new VideoDecoder({
			output: (frame) => this.deliver(frame),
			error: () => this.fail()
		});
		decoder.configure(decoderConfigFor(this.video));
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
		this.handlers.onFrame(request.voice, request.sampleIndex, { kind: "video-frame", frame });
	}

	private fail() {
		this.onError();
		this.decoder = null;
		for (const { voice } of this.pending.values()) this.handlers.onFailed(voice);
		this.pending.clear();
	}
}

export type DecoderSharing = "per-voice" | "per-clip";

export class H264FrameSource implements FrameSource {
	errorCount = 0;
	private readonly decoders = new Map<number, TaggedDecoder>();
	private nextTag = 0;

	constructor(
		private readonly videos: IndexedVideo[],
		private readonly sharing: DecoderSharing,
		private readonly handlers: FrameSourceHandlers
	) {}

	request(voice: Voice, sampleIndex: number) {
		const key = this.sharing === "per-voice" ? voice.index : voice.clipIndex;
		let decoder = this.decoders.get(key);
		if (!decoder) {
			decoder = new TaggedDecoder(this.videos[voice.clipIndex], this.handlers, () => {
				this.errorCount++;
			});
			this.decoders.set(key, decoder);
		}
		decoder.decode(this.nextTag++, voice, sampleIndex);
	}

	close() {
		for (const decoder of this.decoders.values()) decoder.close();
		this.decoders.clear();
	}
}

export class HapMainThreadSource implements FrameSource {
	readonly errorCount = 0;
	private readonly textureBuffers: Uint8Array[];

	constructor(
		private readonly videos: IndexedVideo[],
		private readonly handlers: FrameSourceHandlers
	) {
		this.textureBuffers = videos.map((v) => new Uint8Array(bc1ByteLength(v.width, v.height)));
	}

	request(voice: Voice, sampleIndex: number) {
		const video = this.videos[voice.clipIndex];
		const { texture } = decodeHapFrame(
			video.samples[sampleIndex].data,
			this.textureBuffers[voice.clipIndex]
		);
		this.handlers.onFrame(voice, sampleIndex, {
			kind: "bc1",
			data: texture,
			width: video.width,
			height: video.height
		});
	}

	close() {}
}

export function loadHapWorker(
	urls: string[]
): Promise<{ worker: Worker; clips: LoadedClipInfo[] }> {
	const worker = new Worker(new URL("./hap-worker.ts", import.meta.url), { type: "module" });

	return new Promise((resolve, reject) => {
		worker.onmessage = (event: MessageEvent<HapWorkerResponse>) => {
			const message = event.data;
			if (message.type === "loaded") resolve({ worker, clips: message.clips });
			if (message.type === "load-failed") reject(new Error(message.message));
		};
		worker.onerror = (event) => reject(new Error(event.message));
		worker.postMessage({ type: "load", urls } satisfies HapWorkerRequest);
	});
}

export class HapWorkerSource implements FrameSource {
	errorCount = 0;
	private nextRequestId = 0;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly freeBuffers: ArrayBuffer[][];

	constructor(
		private readonly worker: Worker,
		private readonly clips: LoadedClipInfo[],
		private readonly handlers: FrameSourceHandlers
	) {
		this.freeBuffers = clips.map(() => []);
		worker.onmessage = (event: MessageEvent<HapWorkerResponse>) => this.receive(event.data);
	}

	request(voice: Voice, sampleIndex: number) {
		const clip = this.clips[voice.clipIndex];
		const buffer =
			this.freeBuffers[voice.clipIndex].pop() ??
			new ArrayBuffer(bc1ByteLength(clip.width, clip.height));
		const requestId = this.nextRequestId++;

		this.pending.set(requestId, { voice, sampleIndex });
		const message: HapWorkerRequest = {
			type: "decode",
			requestId,
			clipIndex: voice.clipIndex,
			sampleIndex,
			buffer
		};
		this.worker.postMessage(message, [buffer]);
	}

	close() {
		this.pending.clear();
	}

	private receive(message: HapWorkerResponse) {
		if (message.type !== "frame" && message.type !== "decode-failed") return;

		const request = this.pending.get(message.requestId);
		if (!request) return;
		this.pending.delete(message.requestId);

		const { voice, sampleIndex } = request;
		const release = () => this.freeBuffers[voice.clipIndex].push(message.buffer);

		if (message.type === "decode-failed") {
			this.errorCount++;
			release();
			this.handlers.onFailed(voice);
			return;
		}

		const clip = this.clips[voice.clipIndex];
		this.handlers.onFrame(voice, sampleIndex, {
			kind: "bc1",
			data: new Uint8Array(message.buffer, 0, message.byteLength),
			width: clip.width,
			height: clip.height,
			release
		});
	}
}
