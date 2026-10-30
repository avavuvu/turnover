import { normaliseKey, resolvePlaybackRange } from "./clip-position";
import type { Clip } from "./library";
import type { PictureRequest } from "./sampler";
import { errorMessage } from "./status";
import type { Hap, StrudelScope } from "./strudel-scope";

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

export type ClipPlayer = {
	clips: Record<string, Clip>;
	loadedAudio: ReadonlyMap<string, AudioBuffer>;
	playPicture(request: PictureRequest): void;
	warn(message: string): void;
};

const soundName = (clipName: string) => `vid_${clipName}`;

export async function loadClipAudio(
	scope: StrudelScope,
	clipName: string,
	clip: Clip
): Promise<AudioBuffer> {
	await scope.samples({ [soundName(clipName)]: clip.url });
	return scope.loadBuffer(clip.url, scope.getAudioContext(), soundName(clipName));
}

function clipEvent(value: string | [string, number]): ClipEvent {
	const [clipName, n] = Array.isArray(value) ? value : [value];
	return { clipName, ...(n !== undefined && { n }) };
}

function playbackRate(event: ClipEvent, audioSeconds: number): number {
	const speed = typeof event.speed === "number" ? event.speed : 1;
	return event.unit === "c" ? speed * audioSeconds : speed;
}

function triggerClip(
	scope: StrudelScope,
	player: ClipPlayer,
	hap: Hap<ClipEvent>,
	cps: number,
	targetTime: number
) {
	const event = hap.value;
	const clip = player.clips[event.clipName];
	if (!clip) {
		const known = Object.keys(player.clips).join(", ") || "none";
		player.warn(`Unknown clip "${event.clipName}". Known clips: ${known}`);
		return;
	}
	const audio = player.loadedAudio.get(event.clipName);
	if (!audio) {
		player.warn(`Clip "${event.clipName}" is still loading.`);
		return;
	}

	let range;
	try {
		range = resolvePlaybackRange(clip, event);
	} catch (error) {
		player.warn(errorMessage(error));
		return;
	}
	if (!range) {
		const found = [...new Set(clip.sections.map((section) => section.key))].join(", ");
		player.warn(
			`Clip "${event.clipName}" has no sections in ${normaliseKey(event.key)}. Keys found: ${found}`
		);
		return;
	}

	const rate = playbackRate(event, audio.duration);
	if (rate === 0 || range.endSeconds <= range.startSeconds) return;

	const isReversed = rate < 0;
	const sliceSeconds = (range.endSeconds - range.startSeconds) / Math.abs(rate);
	const durationSeconds = Math.min(hap.duration.valueOf() / cps, sliceSeconds);
	const toFraction = (seconds: number) => Math.min(1, Math.max(0, seconds / audio.duration));

	const { clipName, key, seek, ...soundControls } = event;
	scope
		.superdough(
			{
				...soundControls,
				s: soundName(clipName),
				n: 0,
				begin: toFraction(isReversed ? audio.duration - range.endSeconds : range.startSeconds),
				end: toFraction(isReversed ? audio.duration - range.startSeconds : range.endSeconds),
				clip: event.clip ?? 1
			},
			targetTime,
			durationSeconds,
			cps,
			hap.whole?.begin.valueOf()
		)
		.catch((error) => player.warn(`Audio for "${clipName}" failed: ${errorMessage(error)}`));

	player.playPicture({
		clipName,
		startAt: targetTime,
		mediaStartSeconds: isReversed ? range.endSeconds : range.startSeconds,
		rate,
		durationSeconds
	});
}

export function registerVid(scope: StrudelScope, player: ClipPlayer) {
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
				triggerClip(scope, player, hap, cps, targetTime)
			);

	Object.assign(globalThis, { clips: player.clips, vid });
}
