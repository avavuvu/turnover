import * as MP4Box from "mp4box";

export type IndexedSample = {
	data: Uint8Array;
	timestampMicros: number;
	durationMicros: number;
	isKeyframe: boolean;
};

export type IndexedVideo = {
	codec: string;
	width: number;
	height: number;
	durationMicros: number;
	byteLength: number;
	description?: Uint8Array;
	samples: IndexedSample[];
	samplesInPresentationOrder: number[];
	keyframeSampleIndices: number[];
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

function toMicros(value: number, timescale: number): number {
	return Math.round((value * 1_000_000) / timescale);
}

export function indexVideo(buffer: ArrayBuffer): IndexedVideo {
	const mp4 = MP4Box.createFile();
	const mp4Buffer = buffer as MP4Box.MP4BoxBuffer;
	mp4Buffer.fileStart = 0;
	mp4.appendBuffer(mp4Buffer);
	mp4.flush();

	const track = mp4.getInfo().tracks.find((t) => t.type === "video" || t.codec.startsWith("Hap"));
	if (!track) throw new Error("No video track found");

	const samples = mp4.getTrackSamplesInfo(track.id).map((s) => ({
		data: new Uint8Array(buffer, s.offset, s.size),
		timestampMicros: toMicros(s.cts, s.timescale),
		durationMicros: toMicros(s.duration, s.timescale),
		isKeyframe: s.is_sync
	}));

	const samplesInPresentationOrder = samples
		.map((_, i) => i)
		.sort((a, b) => samples[a].timestampMicros - samples[b].timestampMicros);

	const keyframeSampleIndices = samples.flatMap((s, i) => (s.isKeyframe ? [i] : []));

	const durationMicros = Math.max(...samples.map((s) => s.timestampMicros + s.durationMicros));

	return {
		codec: track.codec,
		width: track.video?.width ?? track.track_width,
		height: track.video?.height ?? track.track_height,
		durationMicros,
		byteLength: buffer.byteLength,
		description: readCodecDescription(mp4, track.id),
		samples,
		samplesInPresentationOrder,
		keyframeSampleIndices
	};
}

export function lastIndexAtOrBefore(
	valueAt: (i: number) => number,
	length: number,
	target: number
) {
	let low = 0;
	let high = length - 1;
	let found = 0;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (valueAt(mid) <= target) {
			found = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return found;
}

export function sampleIndexAtTime(video: IndexedVideo, timeMicros: number): number {
	const order = video.samplesInPresentationOrder;
	const position = lastIndexAtOrBefore(
		(i) => video.samples[order[i]].timestampMicros,
		order.length,
		timeMicros
	);
	return order[position];
}

export function keyframeIndexAtOrBefore(video: IndexedVideo, sampleIndex: number): number {
	const keyframes = video.keyframeSampleIndices;
	return keyframes[lastIndexAtOrBefore((i) => keyframes[i], keyframes.length, sampleIndex)];
}
