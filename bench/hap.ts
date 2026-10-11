import { snappyDecompress } from "./snappy";

export const HapTextureFormat = {
	RGB_DXT1: 0x0b,
	RGBA_DXT5: 0x0e,
	YCOCG_DXT5: 0x0f,
	RGBA_BC7: 0x0c,
	ALPHA_BC4: 0x01
} as const;

const HapCompressor = {
	NONE: 0xa0,
	SNAPPY: 0xb0,
	CHUNKED: 0xc0
} as const;

export type HapFrame = {
	textureFormat: number;
	texture: Uint8Array;
};

function readSectionHeader(data: Uint8Array) {
	const shortLength = data[0] | (data[1] << 8) | (data[2] << 16);
	const sectionType = data[3];
	if (shortLength !== 0) return { sectionType, length: shortLength, headerSize: 4 };

	const longLength = (data[4] | (data[5] << 8) | (data[6] << 16) | (data[7] << 24)) >>> 0;
	return { sectionType, length: longLength, headerSize: 8 };
}

export function decodeHapFrame(sample: Uint8Array, reuse?: Uint8Array): HapFrame {
	const { sectionType, length, headerSize } = readSectionHeader(sample);
	const compressor = sectionType & 0xf0;
	const textureFormat = sectionType & 0x0f;
	const payload = sample.subarray(headerSize, headerSize + length);

	switch (compressor) {
		case HapCompressor.NONE:
			return { textureFormat, texture: payload };
		case HapCompressor.SNAPPY:
			return { textureFormat, texture: snappyDecompress(payload, reuse) };
		case HapCompressor.CHUNKED:
			throw new Error("HAP: chunked frames are not supported. Encode with -chunks 1.");
		default:
			throw new Error(`HAP: unknown section type 0x${sectionType.toString(16)}`);
	}
}

export function bc1ByteLength(width: number, height: number): number {
	return Math.ceil(width / 4) * Math.ceil(height / 4) * 8;
}
