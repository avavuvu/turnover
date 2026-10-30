import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

import { Command } from "commander";

import { readLibrary } from "./lib/library";
import { encodeAllIntra } from "./lib/media";
import { LIBRARY_FILE, ORIGINALS_DIR, PLAYBACK_DIR } from "./lib/paths";

const program = new Command()
	.name("bun run rebuild-clips")
	.description(
		`Re-encodes playback files in library/playback/ from the originals in
library/originals/, using the settings saved for each clip in library/clips.json.`
	)
	.argument("[names...]", "clips to rebuild (default: every clip)")
	.option("--missing", "only rebuild clips whose playback file is missing")
	.parse();

const { missing } = program.opts<{ missing?: boolean }>();
const library = readLibrary(LIBRARY_FILE);

const unknown = program.args.filter((name) => !library[name]);
if (unknown.length > 0) {
	program.error(
		`error: unknown clip ${unknown.join(", ")}. Known clips: ${Object.keys(library).join(", ")}`
	);
}

const names = program.args.length > 0 ? program.args : Object.keys(library);
mkdirSync(PLAYBACK_DIR, { recursive: true });

const failed: string[] = [];
for (const name of names) {
	const clip = library[name];
	const originalPath = join(ORIGINALS_DIR, clip.originalFile);
	const playbackPath = join(PLAYBACK_DIR, clip.playbackFile);
	const partialPath = `${playbackPath}.partial`;

	if (missing && existsSync(playbackPath)) continue;
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

if (failed.length > 0) {
	console.error(`\nCould not rebuild: ${failed.join(", ")}`);
	process.exit(1);
}
console.log("\nDone.");
