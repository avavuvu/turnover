import * as Note from "@tonaljs/note";
import * as Scale from "@tonaljs/scale";

export type ClipTimeline = {
	durationSeconds: number;
	sections: { start: number; end: number; key: string }[];
};

export type PositionControls = {
	key?: unknown;
	n?: unknown;
	begin?: unknown;
	end?: unknown;
	seek?: unknown;
};

export type PlaybackRange = {
	startSeconds: number;
	endSeconds: number;
};

type Region = { start: number; end: number };
type Cue = { time: number; regionEnd: number };

const CUE_SPACING_SECONDS = 2;

const SHORT_KEY = /^([a-g][#b]*)(m?)$/i;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const toNumber = (value: unknown, fallback: number): number => {
	const number = Number(value);
	return value === undefined || value === null || !Number.isFinite(number) ? fallback : number;
}

const toScaleName = (text: string): string => {
	const short = SHORT_KEY.exec(text);
	return short ? `${short[1]} ${short[2] ? "minor" : "major"}` : text;
}

export const normaliseKey = (value: unknown): string => {
	const text = (Array.isArray(value) ? value.join(" ") : String(value))
		.replace(/[:\s]+/g, " ")
		.trim();
	const scale = Scale.get(toScaleName(text));
	const chroma = scale.tonic ? Note.chroma(scale.tonic) : undefined;

	if (chroma === undefined || (scale.type !== "major" && scale.type !== "minor")) {
		throw new Error(
			`Unknown key "${text}". Use a major or minor key, for example "E:minor", "Em", "F#:major", or "Bb".`
		);
	}
	return `${Note.pitchClass(Note.fromMidiSharps(chroma))} ${scale.type}`;
}

const regionsInKey = (timeline: ClipTimeline, key: unknown): Region[] => {
	if (key === undefined) return [{ start: 0, end: timeline.durationSeconds }];
	const wanted = normaliseKey(key);
	return timeline.sections.filter((section) => section.key === wanted);
}

const cuePoints = (regions: Region[]): Cue[] => {
	return regions.flatMap((region) => {
		const cues: Cue[] = [];
		for (let time = region.start; time < region.end; time += CUE_SPACING_SECONDS) {
			cues.push({ time, regionEnd: region.end });
		}
		return cues;
	});
}

export const resolvePlaybackRange = (
	timeline: ClipTimeline,
	controls: PositionControls
): PlaybackRange | null => {
	const cues = cuePoints(regionsInKey(timeline, controls.key));
	if (cues.length === 0) return null;

	const index = Math.floor(toNumber(controls.n, 0));
	const cue = cues[((index % cues.length) + cues.length) % cues.length];
	const regionLength = cue.regionEnd - cue.time;

	const begin = clamp(toNumber(controls.begin, 0), 0, 1);
	const end = clamp(toNumber(controls.end, 1), begin, 1);

	const seek = toNumber(controls.seek, 0);
	const toClipTime = (seconds: number) => clamp(seconds, 0, timeline.durationSeconds);

	return {
		startSeconds: toClipTime(cue.time + begin * regionLength + seek),
		endSeconds: toClipTime(cue.time + end * regionLength + seek)
	};
}
