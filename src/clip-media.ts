import { BufferSource, EncodedPacketSink, Input, MP4 } from "mediabunny";

import { fetchFile } from "./fetch-file";

export type ClipSample = {
	data: Uint8Array;
	timestampMicros: number;
};

export type ClipMedia = {
	url: string;
	width: number;
	height: number;
	durationSeconds: number;
	decoderConfig: VideoDecoderConfig;
	samplesInPresentationOrder: ClipSample[];
};

export async function loadClipMedia(url: string): Promise<ClipMedia> {
	const response = await fetchFile(url);
	const input = new Input({
		source: new BufferSource(await response.arrayBuffer()),
		formats: [MP4]
	});
	const track = await input.getPrimaryVideoTrack();
	if (!track) throw new Error(`${url}: no video track`);
	const decoderConfig = await track.getDecoderConfig();
	if (!decoderConfig) throw new Error(`${url}: unsupported video codec`);

	const samples: ClipSample[] = [];
	let durationSeconds = 0;
	for await (const packet of new EncodedPacketSink(track).packets()) {
		if (packet.type !== "key") {
			throw new Error(
				`${url}: every frame must be a keyframe. Add the clip with "bun run add-clip".`
			);
		}
		samples.push({ data: packet.data, timestampMicros: Math.round(packet.timestamp * 1_000_000) });
		durationSeconds = Math.max(durationSeconds, packet.timestamp + packet.duration);
	}
	samples.sort((a, b) => a.timestampMicros - b.timestampMicros);

	return {
		url,
		width: track.codedWidth,
		height: track.codedHeight,
		durationSeconds,
		decoderConfig: {
			...decoderConfig,
			optimizeForLatency: true,
			hardwareAcceleration: "prefer-hardware"
		},
		samplesInPresentationOrder: samples
	};
}

export function sampleIndexAt(media: ClipMedia, timeMicros: number): number {
	const samples = media.samplesInPresentationOrder;
	let low = 0;
	let high = samples.length - 1;
	let found = 0;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (samples[mid].timestampMicros <= timeMicros) {
			found = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return found;
}
