import library from "../library/clips.json";
import type { ClipInfo, ClipLibrary } from "./clip-info";
import { normaliseKey, resolvePlaybackRange } from "./clip-position";
import type { PictureRequest } from "./sampler";
import { type Hap, strudelScope, type StrudelScope } from "./strudel-scope";

export type Clip = ClipInfo & { url: string };

type ClipEvent = Record<string, unknown> & {
	clipName: string;
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

const playbackUrls = import.meta.glob<string>("../library/playback/*.mp4", {
	query: "?url",
	import: "default",
	eager: true
});

const clipLibrary: ClipLibrary = library;

export const clips: Record<string, Clip> = Object.fromEntries(
	Object.entries(clipLibrary).flatMap(([clipName, info]): [string, Clip][] => {
		const url = playbackUrls[`../library/playback/${info.playbackFile}`];
		if (!url) {
			console.warn(`Clip "${clipName}": library/playback/${info.playbackFile} is missing.`);
			return [];
		}
		return [[clipName, { ...info, url }]];
	})
);

export const clipUrls = (): Record<string, string> =>
	Object.fromEntries(Object.entries(clips).map(([clipName, clip]) => [clipName, clip.url]));

const soundName = (clipName: string) => `vid_${clipName}`;

const reportedProblems = new Set<string>();

function reportOnce(message: string) {
	if (reportedProblems.has(message)) return;
	reportedProblems.add(message);
	console.warn(message);
}

function clipEvent(value: string | [string, number]): ClipEvent {
	const [clipName, n] = Array.isArray(value) ? value : [value];
	return { clipName, ...(n !== undefined && { n }) };
}

function playbackRate(event: ClipEvent, clip: Clip): number {
	const speed = typeof event.speed === "number" ? event.speed : 1;
	return event.unit === "c" ? speed * clip.durationSeconds : speed;
}

function triggerClip(
	scope: StrudelScope,
	playPicture: PlayPicture,
	hap: Hap<ClipEvent>,
	cps: number,
	targetTime: number
) {
	const event = hap.value;
	const clip = clips[event.clipName];
	if (!clip) {
		reportOnce(`Unknown clip "${event.clipName}". Known clips: ${Object.keys(clips).join(", ")}`);
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
			`Clip "${event.clipName}" has no sections in ${normaliseKey(event.key)}. Keys found: ${found}`
		);
		return;
	}

	const rate = playbackRate(event, clip);
	if (rate === 0 || range.endSeconds <= range.startSeconds) return;

	const isReversed = rate < 0;
	const sliceSeconds = (range.endSeconds - range.startSeconds) / Math.abs(rate);
	const durationSeconds = Math.min(hap.duration.valueOf() / cps, sliceSeconds);
	const toFraction = (seconds: number) => seconds / clip.durationSeconds;

	const { clipName, key, seek, ...soundControls } = event;
	scope
		.superdough(
			{
				...soundControls,
				s: soundName(clipName),
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
		.catch((error) => reportOnce(`Audio for "${clipName}" failed: ${error}`));

	playPicture({
		clipName,
		startAt: targetTime,
		mediaStartSeconds: isReversed ? range.endSeconds : range.startSeconds,
		rate,
		durationSeconds
	});
}

function registerClipSounds(scope: StrudelScope) {
	scope.samples(
		Object.fromEntries(
			Object.entries(clips).map(([clipName, clip]) => [soundName(clipName), clip.url])
		)
	);
	const context = scope.getAudioContext();
	for (const [clipName, clip] of Object.entries(clips)) {
		scope
			.loadBuffer(clip.url, context, soundName(clipName))
			.catch((error) => console.error(`Audio for "${clipName}" did not load:`, error));
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
				triggerClip(scope, playPicture, hap, cps, targetTime)
			);

	Object.assign(globalThis, { clips, vid });
	return scope;
}
