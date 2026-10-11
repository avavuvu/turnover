import clips from "./videos/clips.json";
import { normaliseKey, resolvePlaybackRange } from "./clip-position";
import type { PictureRequest } from "./sampler";
import { type Hap, strudelScope, type StrudelScope } from "./strudel-scope";

type ClipRecord = (typeof clips)[keyof typeof clips];
export type Video = ClipRecord & { file: string };

type ClipEvent = Record<string, unknown> & {
	video: string;
	n?: unknown;
	key?: unknown;
	begin?: unknown;
	end?: unknown;
	seek?: unknown;
	speed?: unknown;
	unit?: unknown;
	clip?: unknown;
};

type PlayPicture = (request: PictureRequest) => void;

const clipUrls = import.meta.glob<string>("./videos/*.mp4", {
	query: "?url",
	import: "default",
	eager: true
});

export const videos: Record<string, Video> = Object.fromEntries(
	Object.entries(clips).flatMap(([name, clip]): [string, Video][] => {
		const file = clipUrls[`./videos/${clip.file}`];
		if (!file) {
			console.warn(`Clip "${name}": file src/videos/${clip.file} is missing.`);
			return [];
		}
		return [[name, { ...clip, file }]];
	})
);

export const soundName = (video: string) => `vid_${video}`;

const reportedProblems = new Set<string>();

function reportOnce(message: string) {
	if (reportedProblems.has(message)) return;
	reportedProblems.add(message);
	console.warn(message);
}

function clipEvent(value: string | [string, number]): ClipEvent {
	const [video, n] = Array.isArray(value) ? value : [value];
	return { video, ...(n !== undefined && { n }) };
}

function playbackRate(event: ClipEvent, clip: Video): number {
	const speed = typeof event.speed === "number" ? event.speed : 1;
	return event.unit === "c" ? speed * clip.durationSeconds : speed;
}

function triggerVideo(
	scope: StrudelScope,
	playPicture: PlayPicture,
	hap: Hap<ClipEvent>,
	cps: number,
	targetTime: number
) {
	const event = hap.value;
	const clip = videos[event.video];
	if (!clip) {
		reportOnce(`Unknown clip "${event.video}". Known clips: ${Object.keys(videos).join(", ")}`);
		return;
	}

	let range;
	try {
		range = resolvePlaybackRange(clip, event);
	} catch (error) {
		reportOnce(error instanceof Error ? error.message : String(error));
		return;
	}
	if (!range) {
		const found = [...new Set(clip.sections.map((section) => section.key))].join(", ");
		reportOnce(
			`Clip "${event.video}" has no sections in ${normaliseKey(event.key)}. Keys found: ${found}`
		);
		return;
	}

	const rate = playbackRate(event, clip);
	if (rate === 0 || range.endSeconds <= range.startSeconds) return;

	const isReversed = rate < 0;
	const sliceSeconds = (range.endSeconds - range.startSeconds) / Math.abs(rate);
	const durationSeconds = Math.min(hap.duration.valueOf() / cps, sliceSeconds);
	const toFraction = (seconds: number) => seconds / clip.durationSeconds;

	const { video, key, seek, ...soundControls } = event;
	scope
		.superdough(
			{
				...soundControls,
				s: soundName(video),
				n: 0,
				begin: toFraction(
					isReversed ? clip.durationSeconds - range.endSeconds : range.startSeconds
				),
				end: toFraction(isReversed ? clip.durationSeconds - range.startSeconds : range.endSeconds),
				clip: event.clip ?? 1
			},
			targetTime,
			durationSeconds,
			cps,
			hap.whole?.begin.valueOf()
		)
		.catch((error) => reportOnce(`Audio for "${video}" failed: ${error}`));

	playPicture({
		video,
		startAt: targetTime,
		mediaStartSeconds: isReversed ? range.endSeconds : range.startSeconds,
		rate,
		durationSeconds
	});
}

function registerClipSounds(scope: StrudelScope) {
	scope.samples(
		Object.fromEntries(Object.entries(videos).map(([name, video]) => [soundName(name), video.file]))
	);
	const context = scope.getAudioContext();
	for (const [name, video] of Object.entries(videos)) {
		scope
			.loadBuffer(video.file, context, soundName(name))
			.catch((error) => console.error(`Audio for "${name}" did not load:`, error));
	}
}

export function setupStrudel(playPicture: PlayPicture) {
	const scope = strudelScope();
	registerClipSounds(scope);

	scope.register<ClipEvent, unknown>("seek", (seek, pattern) =>
		pattern.withValue((value) => ({ ...value, seek }))
	);
	scope.register<ClipEvent, unknown>("key", (key, pattern) =>
		pattern.withValue((value) => ({ ...value, key }))
	);

	const vid = (name: string, seconds: number = 0) =>
		scope
			.reify(name)
			.fmap(clipEvent)
			.seek(seconds)
			.onTrigger((hap, _currentTime, cps, targetTime) =>
				triggerVideo(scope, playPicture, hap, cps, targetTime)
			);

	Object.assign(globalThis, { clips: videos, vid });
	return scope;
}
