import "./style.css";
import * as MP4Box from "mp4box";
import "@strudel/repl";

import { videos, SEEK_CC, setupStrudel } from "./video.strudel.js";

const noteToVideo = new Map(Object.values(videos).map((v) => [v.note, v.file]));
const noteToChannel = new Map(Object.values(videos).map((v) => [v.note, v.audioChannel]));

const SEEK_FADE_SECONDS = 0.3;
const NOTE_OFF_FADE_SECONDS = 0.01;
const BUFFER_AHEAD_MICROS = 500_000;
const MAX_DECODE_QUEUE = 16;
const RENDER_SCALE = 2;
const NOTE_ON_DELAY_MS = 5;
const UNITY_GAIN_VELOCITY = 0.7;

type RawSample = MP4Box.Sample;

type DemuxResult = {
	videoSamples: RawSample[];
	audioSamples: RawSample[];
	videoConfig: VideoDecoderConfig;
	audioConfig: AudioDecoderConfig;
	durationSeconds: number;
	width: number;
	height: number;
};

type VideoFile = {
	videoSamples: RawSample[];
	videoConfig: VideoDecoderConfig;
	audioBuffer: AudioBuffer;
	durationSeconds: number;
	width: number;
	height: number;
};

type LoadedFrame = { bitmap: ImageBitmap; timestamp: number };

type Binding = {
	videoPath: string;
	videoDecoder: VideoDecoder;
	loadedFrames: LoadedFrame[];
	nextSampleIndex: number;
	playbackStartAudioTime: number;
	playbackStartVideoTimestamp: number;
	audioSource: AudioBufferSourceNode | null;
	audioSourceGain: GainNode | null;
	audioChannel: number;
	x: number;
	y: number;
};

type StrudelEditorElement = HTMLElement & {
	editor: {
		prebaked: Promise<unknown>;
		changeSetting(name: string, value: unknown): void;
	};
};

const canvas = document.querySelector("canvas")!;
const outputSelect = document.querySelector<HTMLSelectElement>("#audio-output")!;
const strudelEditor = document.querySelector<StrudelEditorElement>("strudel-editor")!;

let animFrameId: number;
let audioCtx: AudioContext;
let channelMerger: ChannelMergerNode;

const videoFiles = new Map<string, VideoFile>();
const bindings = new Map<number, Binding>();
const seekSeconds = new Map<number, number>();

const toMidiKey = (note: number, position: number) => (note << 7) | position;
const noteFromMidiKey = (midiKey: number) => midiKey >> 7;

const velocityToGain = (velocity: number) => velocity / 127 / UNITY_GAIN_VELOCITY;

const toMicros = (s: RawSample) => (s.cts * 1_000_000) / s.timescale;

const toChunkInit = (s: RawSample) => ({
	type: s.is_sync ? ("key" as const) : ("delta" as const),
	timestamp: toMicros(s),
	duration: (s.duration * 1_000_000) / s.timescale,
	data: s.data!
});

const toVideoChunk = (s: RawSample) => new EncodedVideoChunk(toChunkInit(s));
const toAudioChunk = (s: RawSample) => new EncodedAudioChunk(toChunkInit(s));

function setupAudioContext(sinkId?: string) {
	const options: any = sinkId ? { sinkId } : {};
	audioCtx = new AudioContext(options);

	const numChannels = audioCtx.destination.maxChannelCount;
	audioCtx.destination.channelCount = numChannels;
	audioCtx.destination.channelCountMode = "explicit";
	audioCtx.destination.channelInterpretation = "discrete";

	channelMerger = audioCtx.createChannelMerger(numChannels);
	channelMerger.connect(audioCtx.destination);
}

async function decodeAudioToBuffer(
	samples: RawSample[],
	config: AudioDecoderConfig
): Promise<AudioBuffer> {
	const chunks: AudioData[] = [];

	const decoder = new AudioDecoder({
		output: (data) => chunks.push(data),
		error: console.error
	});
	decoder.configure(config);
	for (const s of samples) decoder.decode(toAudioChunk(s));
	await decoder.flush();

	const totalFrames = chunks.reduce((sum, c) => sum + c.numberOfFrames, 0);
	const buffer = audioCtx.createBuffer(
		chunks[0].numberOfChannels,
		totalFrames,
		chunks[0].sampleRate
	);

	let frameOffset = 0;
	for (const data of chunks) {
		for (let ch = 0; ch < data.numberOfChannels; ch++) {
			data.copyTo(buffer.getChannelData(ch).subarray(frameOffset), {
				planeIndex: ch,
				format: "f32-planar"
			});
		}
		frameOffset += data.numberOfFrames;
		data.close();
	}

	return buffer;
}

function getVideoDescription(mp4: any, trackId: number): Uint8Array | undefined {
	const trak = mp4.getTrackById(trackId);
	for (const entry of trak.mdia.minf.stbl.stsd.entries) {
		const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
		if (box) {
			const stream = new MP4Box.DataStream(undefined, 0, MP4Box.Endianness.BIG_ENDIAN);
			box.write(stream);
			return new Uint8Array(stream.buffer, 8);
		}
	}
}

function demux(arrayBuffer: ArrayBuffer): Promise<DemuxResult> {
	return new Promise((resolve, reject) => {
		const mp4 = MP4Box.createFile();
		const result: Partial<DemuxResult> = { videoSamples: [], audioSamples: [] };
		let videoTotal = 0;
		let audioTotal = 0;
		let videoGot = 0;
		let audioGot = 0;

		mp4.onReady = (info: any) => {
			const vt = info.tracks.find((t: any) => t.type === "video");
			const at = info.tracks.find((t: any) => t.type === "audio");

			videoTotal = vt.nb_samples;
			audioTotal = at.nb_samples;

			result.width = vt.video.width;
			result.height = vt.video.height;
			result.videoConfig = {
				codec: vt.codec,
				codedWidth: vt.video.width,
				codedHeight: vt.video.height,
				description: getVideoDescription(mp4, vt.id)
			};
			result.audioConfig = {
				codec: at.codec,
				sampleRate: at.audio.sample_rate,
				numberOfChannels: at.audio.channel_count
			};

			mp4.setExtractionOptions(vt.id, "video", { nbSamples: Infinity });
			mp4.setExtractionOptions(at.id, "audio", { nbSamples: Infinity });
			mp4.start();
		};

		mp4.onSamples = (_id: number, type: unknown, samples: RawSample[]) => {
			if (type === "video") {
				result.videoSamples!.push(...samples);
				videoGot += samples.length;
			} else {
				result.audioSamples!.push(...samples);
				audioGot += samples.length;
			}

			if (videoGot < videoTotal || audioGot < audioTotal) return;

			const last = result.videoSamples!.at(-1)!;
			result.durationSeconds = (last.cts + last.duration) / last.timescale;
			resolve(result as DemuxResult);
		};

		mp4.onError = reject;
		const buf = arrayBuffer as MP4Box.MP4BoxBuffer;
		buf.fileStart = 0;
		mp4.appendBuffer(buf);
		mp4.flush();
	});
}

async function loadVideoFile(path: string) {
	if (videoFiles.has(path)) return;

	const response = await fetch(path);
	const arrayBuffer = await response.arrayBuffer();
	const { audioSamples, audioConfig, ...file } = await demux(arrayBuffer);
	const audioBuffer = await decodeAudioToBuffer(audioSamples, audioConfig);

	videoFiles.set(path, { ...file, audioBuffer });
}

function frameToBitmap(frame: VideoFrame): ImageBitmap {
	const offscreen = new OffscreenCanvas(frame.codedWidth, frame.codedHeight);
	offscreen.getContext("2d")!.drawImage(frame, 0, 0);
	return offscreen.transferToImageBitmap();
}

function insertFrame(frames: LoadedFrame[], entry: LoadedFrame) {
	const idx = frames.findIndex((f) => f.timestamp > entry.timestamp);
	if (idx === -1) frames.push(entry);
	else frames.splice(idx, 0, entry);
}

function createVideoDecoder(binding: Binding): VideoDecoder {
	return new VideoDecoder({
		output(frame) {
			const timestamp = frame.timestamp;

			if (timestamp < binding.playbackStartVideoTimestamp) {
				frame.close();
				return;
			}

			const bitmap = frameToBitmap(frame);
			frame.close();

			insertFrame(binding.loadedFrames, { bitmap, timestamp });
		},
		error: console.error
	});
}

function createBinding(videoPath: string, audioChannel = 0): Binding {
	const file = videoFiles.get(videoPath)!;
	const binding: Binding = {
		videoPath,
		loadedFrames: [],
		nextSampleIndex: 0,
		playbackStartAudioTime: 0,
		playbackStartVideoTimestamp: 0,
		audioSource: null,
		audioSourceGain: null,
		audioChannel,
		videoDecoder: null!,
		x: Math.random() * (window.innerWidth - file.width),
		y: Math.random() * (window.innerHeight - file.height)
	};

	binding.videoDecoder = createVideoDecoder(binding);
	return binding;
}

function closeFrames(binding: Binding) {
	for (const f of binding.loadedFrames) f.bitmap.close();
	binding.loadedFrames = [];
}

function stopVideo(binding: Binding) {
	closeFrames(binding);
	if (binding.videoDecoder.state !== "closed") binding.videoDecoder.reset();
}

function fadeOutAudio(binding: Binding, fadeSeconds: number) {
	if (!binding.audioSource || !binding.audioSourceGain) return;

	const now = audioCtx.currentTime;
	binding.audioSourceGain.gain.cancelAndHoldAtTime(now);
	binding.audioSourceGain.gain.linearRampToValueAtTime(0, now + fadeSeconds);
	try {
		binding.audioSource.stop(now + fadeSeconds);
	} catch {}
}

function startAudio(
	binding: Binding,
	file: VideoFile,
	startTime: number,
	offsetSeconds: number,
	gainValue: number
) {
	const gain = audioCtx.createGain();
	gain.gain.value = gainValue;
	gain.channelCount = 1;
	gain.channelCountMode = "explicit";

	const source = audioCtx.createBufferSource();
	source.buffer = file.audioBuffer;
	source.connect(gain);

	const channel = Math.min(binding.audioChannel, channelMerger.numberOfInputs - 1);
	gain.connect(channelMerger, 0, channel);
	source.start(startTime, offsetSeconds);

	binding.audioSource = source;
	binding.audioSourceGain = gain;
}

function resetVideoDecoder(binding: Binding, file: VideoFile) {
	if (binding.videoDecoder.state === "closed") {
		binding.videoDecoder = createVideoDecoder(binding);
	} else {
		binding.videoDecoder.reset();
	}
	binding.videoDecoder.configure(file.videoConfig);
}

function findKeyframeIndex(samples: RawSample[], timeMicros: number): number {
	let keyIndex = 0;
	for (let i = 0; i < samples.length; i++) {
		if (samples[i].is_sync && toMicros(samples[i]) <= timeMicros) keyIndex = i;
	}
	return keyIndex;
}

function feedVideo(binding: Binding, file: VideoFile, untilMicros: number) {
	const samples = file.videoSamples;
	const decoder = binding.videoDecoder;
	if (decoder.state !== "configured") return;

	while (binding.nextSampleIndex < samples.length && decoder.decodeQueueSize < MAX_DECODE_QUEUE) {
		const sample = samples[binding.nextSampleIndex];
		if (toMicros(sample) > untilMicros) break;
		decoder.decode(toVideoChunk(sample));
		binding.nextSampleIndex++;
	}
}

function seekAndPlay(binding: Binding, timeSeconds: number, gainValue: number) {
	const file = videoFiles.get(binding.videoPath)!;
	const timeMicros = timeSeconds * 1_000_000;
	const now = audioCtx.currentTime;

	fadeOutAudio(binding, SEEK_FADE_SECONDS);
	closeFrames(binding);
	resetVideoDecoder(binding, file);

	binding.playbackStartVideoTimestamp = timeMicros;
	binding.playbackStartAudioTime = now;

	startAudio(binding, file, now, timeSeconds, gainValue);

	binding.nextSampleIndex = findKeyframeIndex(file.videoSamples, timeMicros);
	feedVideo(binding, file, timeMicros + BUFFER_AHEAD_MICROS);
}

function handleNoteOff(note: number) {
	for (const [midiKey, binding] of bindings) {
		if (noteFromMidiKey(midiKey) !== note) continue;

		fadeOutAudio(binding, NOTE_OFF_FADE_SECONDS);
		binding.audioSource = null;
		binding.audioSourceGain = null;
		stopVideo(binding);
	}
}

function handleNoteOn(note: number, midiChannel: number, velocity: number) {
	const videoPath = noteToVideo.get(note);
	if (!videoPath) return;

	const seconds = seekSeconds.get(midiChannel) ?? 0;
	const midiKey = toMidiKey(note, seconds);
	let binding = bindings.get(midiKey);
	if (!binding) {
		binding = createBinding(videoPath, noteToChannel.get(note) ?? 0);
		bindings.set(midiKey, binding);
	}

	const file = videoFiles.get(videoPath)!;
	seekAndPlay(binding, Math.min(seconds, file.durationSeconds), velocityToGain(velocity));
}

function handleControlChange(midiChannel: number, controller: number, value: number) {
	if (controller === SEEK_CC) seekSeconds.set(midiChannel, value);
}

function handleMidiMessage(event: MIDIMessageEvent) {
	if (!event?.data) return;

	const [status, data1, data2] = event.data;
	const command = status & 0xf0;
	const midiChannel = status & 0x0f;

	if (command === 0xb0) {
		handleControlChange(midiChannel, data1, data2);
		return;
	}

	const isNoteOn = command === 0x90 && data2 > 0;
	const isNoteOff = command === 0x80 || (command === 0x90 && data2 === 0);

	if (isNoteOn) setTimeout(() => handleNoteOn(data1, midiChannel, data2), NOTE_ON_DELAY_MS);
	if (isNoteOff) handleNoteOff(data1);
}

function currentVideoMicros(binding: Binding): number {
	const elapsedSeconds = audioCtx.currentTime - binding.playbackStartAudioTime;
	return binding.playbackStartVideoTimestamp + elapsedSeconds * 1_000_000;
}

function dropStaleFrames(binding: Binding, currentMicros: number) {
	const frames = binding.loadedFrames;
	while (frames.length > 1 && frames[1].timestamp <= currentMicros) {
		frames.shift()!.bitmap.close();
	}
}

function drawBinding(
	ctx: CanvasRenderingContext2D,
	binding: Binding,
	file: VideoFile,
	currentMicros: number
) {
	if (binding.loadedFrames.length === 0) return;

	dropStaleFrames(binding, currentMicros);

	const frame = binding.loadedFrames[0];
	if (frame.timestamp > currentMicros) return;

	try {
		ctx.drawImage(
			frame.bitmap,
			binding.x,
			binding.y,
			file.width * RENDER_SCALE,
			file.height * RENDER_SCALE
		);
	} catch {
		binding.loadedFrames.shift();
	}
}

function renderLoop() {
	const ctx = canvas.getContext("2d");
	if (ctx) {
		ctx.fillStyle = "black";
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		for (const binding of bindings.values()) {
			const file = videoFiles.get(binding.videoPath)!;
			const currentMicros = currentVideoMicros(binding);
			feedVideo(binding, file, currentMicros + BUFFER_AHEAD_MICROS);
			drawBinding(ctx, binding, file, currentMicros);
		}
	}

	animFrameId = requestAnimationFrame(renderLoop);
}

function onresize() {
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
}

function startCanvas() {
	canvas.hidden = false;
	onresize();
	window.addEventListener("resize", onresize);
	renderLoop();
}

function stopCanvas() {
	cancelAnimationFrame(animFrameId);
	window.removeEventListener("resize", onresize);
	for (const binding of bindings.values()) closeFrames(binding);
}

async function loadAudioOutputs() {
	await navigator.mediaDevices.getUserMedia({ audio: true });
	const devices = await navigator.mediaDevices.enumerateDevices();
	const outputs = devices.filter((d) => d.kind === "audiooutput");

	outputSelect.replaceChildren(
		...outputs.map((device) => {
			const option = document.createElement("option");
			option.value = device.deviceId;
			option.textContent = device.label || device.deviceId || "Default";
			return option;
		})
	);
	outputSelect.value = "default";
	outputSelect.hidden = false;
}

async function setAudioOutput(deviceId: string) {
	for (const binding of bindings.values()) {
		if (!binding.audioSource) continue;
		try {
			binding.audioSource.stop();
		} catch {}
		binding.audioSource = null;
		binding.audioSourceGain = null;
	}

	await audioCtx.close();
	setupAudioContext(deviceId);
}

async function loadStrudelPrelude() {
	await customElements.whenDefined("strudel-editor");
	strudelEditor.editor.changeSetting("isTabIndentationEnabled", true);
	await strudelEditor.editor.prebaked;
	setupStrudel();
}

async function init() {
	setupAudioContext();

	const uniquePaths = [...new Set(noteToVideo.values())];
	await Promise.all(uniquePaths.map(loadVideoFile));

	for (const [note, videoPath] of noteToVideo) {
		bindings.set(toMidiKey(note, 0), createBinding(videoPath, noteToChannel.get(note) ?? 0));
	}

	await loadAudioOutputs();
	outputSelect.addEventListener("change", () => setAudioOutput(outputSelect.value));

	const access = await navigator.requestMIDIAccess();
	for (const input of access.inputs.values()) {
		input.onmidimessage = handleMidiMessage;
	}

	startCanvas();
	window.addEventListener("beforeunload", stopCanvas);
}

init().catch(console.error);
loadStrudelPrelude().catch(console.error);
