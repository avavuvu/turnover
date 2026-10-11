import { runBinary, runText, runVisible } from "./run";

export type EncodeOptions = {
	maxHeight: number;
	startSeconds?: number;
	endSeconds?: number;
};

export type VideoProbe = {
	width: number;
	height: number;
	fps: number;
	durationSeconds: number;
};

export function encodeAllIntra(input: string, output: string, options: EncodeOptions) {
	const trim = [
		...(options.startSeconds !== undefined ? ["-ss", String(options.startSeconds)] : []),
		...(options.endSeconds !== undefined ? ["-to", String(options.endSeconds)] : [])
	];
	const scale = `scale=-2:'trunc(min(${options.maxHeight},ih)/2)*2',setsar=1`;

	runVisible("ffmpeg", [
		"-hide_banner",
		"-loglevel",
		"error",
		"-stats",
		"-y",
		...trim,
		"-i",
		input,
		"-map",
		"0:v:0",
		"-map",
		"0:a:0",
		"-vf",
		scale,
		"-c:v",
		"libx264",
		"-profile:v",
		"high",
		"-pix_fmt",
		"yuv420p",
		"-crf",
		"20",
		"-g",
		"1",
		"-bf",
		"0",
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		"-ar",
		"48000",
		"-movflags",
		"+faststart",
		"-f",
		"mp4",
		output
	]);
}

export function probeVideo(file: string): VideoProbe {
	const json = JSON.parse(
		runText("ffprobe", [
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=width,height,avg_frame_rate:format=duration",
			"-of",
			"json",
			file
		])
	);
	const stream = json.streams?.[0];
	if (!stream) throw new Error(`${file}: no video stream`);

	const [numerator, denominator] = String(stream.avg_frame_rate).split("/").map(Number);
	return {
		width: stream.width,
		height: stream.height,
		fps: Number((numerator / (denominator || 1)).toFixed(3)),
		durationSeconds: Number(Number(json.format.duration).toFixed(3))
	};
}

export function decodeMonoAudio(file: string, sampleRate: number): Float32Array {
	const pcm = runBinary("ffmpeg", [
		"-v",
		"error",
		"-i",
		file,
		"-vn",
		"-ac",
		"1",
		"-ar",
		String(sampleRate),
		"-f",
		"f32le",
		"pipe:1"
	]);
	return new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
}
