const LITERAL = 0;
const COPY_1_BYTE_OFFSET = 1;
const COPY_2_BYTE_OFFSET = 2;

function readLittleEndian(input: Uint8Array, pos: number, byteCount: number): number {
	let value = 0;
	for (let i = 0; i < byteCount; i++) value += input[pos + i] * 2 ** (8 * i);
	return value;
}

export function snappyUncompressedLength(input: Uint8Array): {
	length: number;
	headerSize: number;
} {
	let length = 0;
	let pos = 0;
	for (let shift = 0; ; shift += 7) {
		const byte = input[pos++];
		length += (byte & 0x7f) * 2 ** shift;
		if (byte < 0x80) return { length, headerSize: pos };
	}
}

export function snappyDecompress(input: Uint8Array, reuse?: Uint8Array): Uint8Array {
	const { length: outputLength, headerSize } = snappyUncompressedLength(input);
	const output =
		reuse && reuse.length >= outputLength
			? reuse.subarray(0, outputLength)
			: new Uint8Array(outputLength);

	let pos = headerSize;
	let out = 0;

	while (pos < input.length) {
		const tag = input[pos++];
		const elementType = tag & 3;

		if (elementType === LITERAL) {
			let length = tag >> 2;
			if (length >= 60) {
				const byteCount = length - 59;
				length = readLittleEndian(input, pos, byteCount);
				pos += byteCount;
			}
			length += 1;
			output.set(input.subarray(pos, pos + length), out);
			pos += length;
			out += length;
			continue;
		}

		let length: number;
		let offset: number;
		if (elementType === COPY_1_BYTE_OFFSET) {
			length = ((tag >> 2) & 7) + 4;
			offset = ((tag >> 5) << 8) | input[pos];
			pos += 1;
		} else if (elementType === COPY_2_BYTE_OFFSET) {
			length = (tag >> 2) + 1;
			offset = readLittleEndian(input, pos, 2);
			pos += 2;
		} else {
			length = (tag >> 2) + 1;
			offset = readLittleEndian(input, pos, 4);
			pos += 4;
		}

		if (offset === 0 || offset > out) throw new Error(`snappy: bad copy offset ${offset}`);

		if (offset >= length) {
			output.copyWithin(out, out - offset, out - offset + length);
			out += length;
		} else {
			for (const end = out + length; out < end; out++) output[out] = output[out - offset];
		}
	}

	if (out !== outputLength) throw new Error(`snappy: wrote ${out} of ${outputLength} bytes`);
	return output;
}
