import * as MP4Box from "mp4box";

export type ClipSample = {
	data: Uint8Array;
	timestampMicros: number;
};

export type Clip = {
	url: string;
	width: number;
	height: number;
	durationSeconds: number;
	decoderConfig: VideoDecoderConfig;
	samplesInPresentationOrder: ClipSample[];
};

type WritableBox = { write(stream: MP4Box.DataStream): void };
type CodecConfigBoxes = {
	avcC?: WritableBox;
	hvcC?: WritableBox;
	vpcC?: WritableBox;
	av1C?: WritableBox;
};

function readCodecDescription(mp4: MP4Box.ISOFile, trackId: number): Uint8Array | undefined {
	const entries = mp4.getTrackById(trackId).mdia.minf.stbl.stsd.entries as CodecConfigBoxes[];
	for (const entry of entries) {
		const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
		if (!box) continue;
		const stream = new MP4Box.DataStream(undefined, 0, MP4Box.Endianness.BIG_ENDIAN);
		box.write(stream);
		return new Uint8Array(stream.buffer, 8);
	}
}

function readVideoTrack(url: string, buffer: ArrayBuffer) {
	const mp4 = MP4Box.createFile();
	const mp4Buffer = buffer as MP4Box.MP4BoxBuffer;
	mp4Buffer.fileStart = 0;
	mp4.appendBuffer(mp4Buffer);
	mp4.flush();

	const track = mp4.getInfo().tracks.find((t) => t.type === "video");
	if (!track?.video) throw new Error(`${url}: no video track`);

	const rawSamples = mp4.getTrackSamplesInfo(track.id);
	if (rawSamples.some((s) => !s.is_sync)) {
		throw new Error(
			`${url}: every frame must be a keyframe. Add the clip with "bun run add-clip".`
		);
	}

	const toMicros = (value: number, timescale: number) =>
		Math.round((value * 1_000_000) / timescale);

	const samplesInPresentationOrder = rawSamples
		.map((s) => ({
			data: new Uint8Array(buffer, s.offset, s.size),
			timestampMicros: toMicros(s.cts, s.timescale),
			endMicros: toMicros(s.cts + s.duration, s.timescale)
		}))
		.sort((a, b) => a.timestampMicros - b.timestampMicros);

	const { width, height } = track.video;
	return {
		width,
		height,
		durationSeconds: samplesInPresentationOrder.at(-1)!.endMicros / 1_000_000,
		decoderConfig: {
			codec: track.codec,
			codedWidth: width,
			codedHeight: height,
			description: readCodecDescription(mp4, track.id),
			optimizeForLatency: true,
			hardwareAcceleration: "prefer-hardware"
		} satisfies VideoDecoderConfig,
		samplesInPresentationOrder: samplesInPresentationOrder.map(
			({ data, timestampMicros }): ClipSample => ({ data, timestampMicros })
		)
	};
}

export async function loadClip(url: string): Promise<Clip> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	return { url, ...readVideoTrack(url, await response.arrayBuffer()) };
}

export function sampleIndexAt(clip: Clip, timeMicros: number): number {
	const samples = clip.samplesInPresentationOrder;
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
