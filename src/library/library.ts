import type { ClipInfo, ClipLibrary } from "./clip-info";
import { fetchFile } from "../fetch-file";

export type Clip = ClipInfo & { url: string };

const LIBRARY_URL = new URL("library/", document.baseURI);

export const loadLibrary = async (): Promise<Record<string, Clip>> => {
	const libraryFile = new URL("clips.json", LIBRARY_URL).href;
	const response = await fetchFile(libraryFile).catch(() => {
		throw new Error('No clip library found. Add a clip with "bun run add-clip".');
	});

	let library: ClipLibrary;
	try {
		library = await response.json();
	} catch {
		throw new Error("library/clips.json is not valid JSON.");
	}

	return Object.fromEntries(
		Object.entries(library).map(([clipName, info]) => [
			clipName,
			{ ...info, url: new URL(`playback/${info.playbackFile}`, LIBRARY_URL).href }
		])
	);
}
