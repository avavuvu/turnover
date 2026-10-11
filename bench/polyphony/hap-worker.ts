import { decodeHapFrame } from "../hap";
import { type IndexedVideo, indexVideo } from "../indexed-video";

export type LoadedClipInfo = {
	width: number;
	height: number;
	durationMicros: number;
	byteLength: number;
	timestampsMicros: Float64Array;
};

export type HapWorkerRequest =
	| { type: "load"; urls: string[] }
	| {
			type: "decode";
			requestId: number;
			clipIndex: number;
			sampleIndex: number;
			buffer: ArrayBuffer;
	  };

export type HapWorkerResponse =
	| { type: "loaded"; clips: LoadedClipInfo[] }
	| { type: "load-failed"; message: string }
	| { type: "frame"; requestId: number; buffer: ArrayBuffer; byteLength: number }
	| { type: "decode-failed"; requestId: number; buffer: ArrayBuffer; message: string };

let clips: IndexedVideo[] = [];

function reply(message: HapWorkerResponse, transfer: Transferable[] = []) {
	self.postMessage(message, { transfer });
}

async function loadClips(urls: string[]) {
	try {
		clips = await Promise.all(
			urls.map(async (url) => indexVideo(await (await fetch(url)).arrayBuffer()))
		);
		reply({
			type: "loaded",
			clips: clips.map((clip) => ({
				width: clip.width,
				height: clip.height,
				durationMicros: clip.durationMicros,
				byteLength: clip.byteLength,
				timestampsMicros: Float64Array.from(clip.samples, (s) => s.timestampMicros)
			}))
		});
	} catch (error) {
		reply({ type: "load-failed", message: String(error) });
	}
}

function decodeFrame(request: Extract<HapWorkerRequest, { type: "decode" }>) {
	const { requestId, clipIndex, sampleIndex, buffer } = request;
	try {
		const target = new Uint8Array(buffer);
		const { texture } = decodeHapFrame(clips[clipIndex].samples[sampleIndex].data, target);
		if (texture.buffer !== buffer) target.set(texture);
		reply({ type: "frame", requestId, buffer, byteLength: texture.length }, [buffer]);
	} catch (error) {
		reply({ type: "decode-failed", requestId, buffer, message: String(error) }, [buffer]);
	}
}

self.addEventListener("message", (event: MessageEvent<HapWorkerRequest>) => {
	const request = event.data;
	if (request.type === "load") loadClips(request.urls);
	else decodeFrame(request);
});
