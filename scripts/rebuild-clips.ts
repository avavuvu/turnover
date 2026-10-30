import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { readLibrary } from "./lib/library";
import { encodeAllIntra } from "./lib/media";
import { LIBRARY_FILE, ORIGINALS_DIR, PLAYBACK_DIR } from "./lib/paths";

const USAGE = `Usage: bun run rebuild-clips [name ...]

Re-encodes playback files in library/playback/ from the originals in
library/originals/, using the settings saved for each clip in library/clips.json.
With no names, rebuilds every clip.

Options:
  --missing  Only rebuild clips whose playback file is missing.
  --help     Show this text.`;

function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			missing: { type: "boolean", default: false },
			help: { type: "boolean", default: false }
		}
	});
	if (values.help) {
		console.log(USAGE);
		return;
	}

	const library = readLibrary(LIBRARY_FILE);
	const unknown = positionals.filter((name) => !library[name]);
	if (unknown.length > 0) {
		throw new Error(
			`Unknown clip: ${unknown.join(", ")}. Known clips: ${Object.keys(library).join(", ")}`
		);
	}

	const names = positionals.length > 0 ? positionals : Object.keys(library);
	mkdirSync(PLAYBACK_DIR, { recursive: true });

	const failed: string[] = [];
	for (const name of names) {
		const clip = library[name];
		const originalPath = join(ORIGINALS_DIR, clip.originalFile);
		const playbackPath = join(PLAYBACK_DIR, clip.playbackFile);
		const partialPath = `${playbackPath}.partial`;

		if (values.missing && existsSync(playbackPath)) continue;
		if (!existsSync(originalPath)) {
			console.error(`\n✗ ${name}: original library/originals/${clip.originalFile} is missing.`);
			failed.push(name);
			continue;
		}

		console.log(`\n▸ ${name}: encoding ${clip.originalFile}`);
		try {
			encodeAllIntra(originalPath, partialPath, clip.encode);
			renameSync(partialPath, playbackPath);
		} catch (error) {
			console.error(`✗ ${name}: ${error instanceof Error ? error.message : error}`);
			failed.push(name);
		} finally {
			rmSync(partialPath, { force: true });
		}
	}

	if (failed.length > 0) throw new Error(`Could not rebuild: ${failed.join(", ")}`);
	console.log("\nDone.");
}

try {
	main();
} catch (error) {
	console.error(`\nError: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
}
