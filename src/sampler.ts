import { type ClipMedia, loadClipMedia, sampleIndexAt } from "./clip-media";
import { ClipDecoder } from "./clip-decoder";
import { Compositor, type DrawItem } from "./compositor";

export type PictureRequest = {
	clipName: string;
	startAt: number;
	mediaStartSeconds: number;
	rate: number;
	durationSeconds: number;
};

const MAX_VOICES = 32;
const FRAME_LEAD_MS = 25;
const RENDER_SCALE = 0.8;
const MAX_PLACEMENTS = 256;

type LoadedClip = {
	media: ClipMedia;
	decoder: ClipDecoder;
};

type Placement = { xFraction: number; yFraction: number };

type Voice = {
	clip: LoadedClip;
	placement: Placement;
	startAt: number;
	stopAt: number;
	mediaStartSeconds: number;
	rate: number;
	texture: WebGLTexture;
	plannedSample: number;
	shownSample: number;
	isDecoding: boolean;
	isRemoved: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function secondsUntilClipEdge(clip: LoadedClip, mediaStartSeconds: number, rate: number) {
	const remaining = rate > 0 ? clip.media.durationSeconds - mediaStartSeconds : mediaStartSeconds;
	return remaining / Math.abs(rate);
}

export class VideoSampler {
	private readonly compositor: Compositor;
	private readonly clips = new Map<string, LoadedClip>();
	private readonly placements = new Map<string, Placement>();
	private getClock: (() => AudioContext) | null = null;
	private voices: Voice[] = [];
	private animationFrame = 0;
	private pixelRatio = 1;

	constructor(canvas: HTMLCanvasElement) {
		this.compositor = new Compositor(canvas);
	}

	async load(clipName: string, url: string) {
		const media = await loadClipMedia(url);
		this.clips.set(clipName, { media, decoder: new ClipDecoder(media) });
	}

	useClock(getClock: () => AudioContext) {
		this.getClock = getClock;
	}

	start() {
		this.animationFrame = requestAnimationFrame(this.tick);
	}

	stop() {
		cancelAnimationFrame(this.animationFrame);
		for (const clip of this.clips.values()) clip.decoder.close();
	}

	resize(width: number, height: number, pixelRatio: number) {
		this.pixelRatio = pixelRatio;
		this.compositor.resize(Math.round(width * pixelRatio), Math.round(height * pixelRatio));
	}

	play(request: PictureRequest) {
		const clip = this.clips.get(request.clipName);
		if (!clip || request.rate === 0) return;

		if (this.voices.length >= MAX_VOICES) this.disposeVoice(this.voices.shift()!);

		const mediaStartSeconds = clamp(request.mediaStartSeconds, 0, clip.media.durationSeconds);
		const durationSeconds = Math.min(
			request.durationSeconds,
			secondsUntilClipEdge(clip, mediaStartSeconds, request.rate)
		);

		this.voices.push({
			clip,
			placement: this.placementFor(request.clipName, mediaStartSeconds),
			startAt: request.startAt,
			stopAt: request.startAt + durationSeconds,
			mediaStartSeconds,
			rate: request.rate,
			texture: this.compositor.createTexture(),
			plannedSample: -1,
			shownSample: -1,
			isDecoding: false,
			isRemoved: false
		});
	}

	private readonly tick = (tickMs: number) => {
		this.animationFrame = requestAnimationFrame(this.tick);
		const clock = this.getClock?.();
		if (!clock) return;

		const now = this.contextTimeAt(clock, tickMs);
		const planningTime = this.contextTimeAt(clock, tickMs + FRAME_LEAD_MS);

		this.removeFinishedVoices(now);
		this.compositor.draw(
			this.voices
				.filter((voice) => voice.shownSample >= 0 && now >= voice.startAt)
				.map((voice) => this.drawItem(voice))
		);
		for (const voice of this.voices) this.planFrame(voice, planningTime);
	};

	private contextTimeAt(clock: AudioContext, performanceMs: number): number {
		const { contextTime, performanceTime } = clock.getOutputTimestamp();
		if (contextTime !== undefined && performanceTime) {
			return contextTime + (performanceMs - performanceTime) / 1000;
		}
		return clock.currentTime + (performanceMs - performance.now()) / 1000;
	}

	private removeFinishedVoices(now: number) {
		this.voices = this.voices.filter((voice) => {
			if (now < voice.stopAt) return true;
			this.disposeVoice(voice);
			return false;
		});
	}

	private disposeVoice(voice: Voice) {
		voice.isRemoved = true;
		this.compositor.deleteTexture(voice.texture);
	}

	private planFrame(voice: Voice, time: number) {
		const elapsedSeconds = Math.max(0, time - voice.startAt);
		const mediaSeconds = clamp(
			voice.mediaStartSeconds + elapsedSeconds * voice.rate,
			0,
			voice.clip.media.durationSeconds
		);
		voice.plannedSample = sampleIndexAt(voice.clip.media, mediaSeconds * 1_000_000);
		this.decodePlannedFrame(voice);
	}

	private decodePlannedFrame(voice: Voice) {
		if (voice.isDecoding || voice.isRemoved || voice.shownSample === voice.plannedSample) return;

		const sampleIndex = voice.plannedSample;
		voice.isDecoding = true;

		voice.clip.decoder.decode(sampleIndex).then(
			(frame) => {
				if (!voice.isRemoved) {
					this.compositor.upload(voice.texture, frame);
					voice.shownSample = sampleIndex;
				}
				frame.close();
				voice.isDecoding = false;
				this.decodePlannedFrame(voice);
			},
			() => {
				voice.isDecoding = false;
			}
		);
	}

	private drawItem(voice: Voice): DrawItem {
		const scale = RENDER_SCALE * this.pixelRatio;
		const width = voice.clip.media.width * scale;
		const height = voice.clip.media.height * scale;
		return {
			texture: voice.texture,
			width,
			height,
			x: voice.placement.xFraction * Math.max(0, this.compositor.width - width),
			y: voice.placement.yFraction * Math.max(0, this.compositor.height - height)
		};
	}

	private placementFor(clipName: string, mediaStartSeconds: number): Placement {
		const key = `${clipName}@${mediaStartSeconds}`;
		let placement = this.placements.get(key);
		if (!placement) {
			placement = { xFraction: Math.random(), yFraction: Math.random() };
			this.placements.set(key, placement);
			if (this.placements.size > MAX_PLACEMENTS) {
				this.placements.delete(this.placements.keys().next().value!);
			}
		}
		return placement;
	}
}
