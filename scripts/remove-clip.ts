import { rmSync } from "node:fs"
import { join } from "node:path"

import { Command } from "commander"

import { readLibrary, writeLibrary } from "./lib/library"
import { LIBRARY_FILE, PLAYBACK_DIR } from "./lib/paths"

const program = new Command()
	.name("bun run remove-clip")
	.description("Removes clips from library/clips.json and deletes their playback files.")
	.argument("<names...>", "clips to remove")
	.parse()

const library = readLibrary(LIBRARY_FILE)
const names = [...new Set(program.args)]

const unknown = names.filter((name) => !library[name])
if (unknown.length > 0) {
	const known = Object.keys(library)
	program.error(
		`error: unknown clip ${unknown.join(", ")}. ${known.length > 0 ? `Known clips: ${known.join(", ")}` : "The library is empty."}`
	)
}

const playbackFiles = names.map((name) => library[name].playbackFile)
for (const name of names) delete library[name]

writeLibrary(LIBRARY_FILE, library)
for (const file of playbackFiles) rmSync(join(PLAYBACK_DIR, file), { force: true })

console.log(`Removed ${names.map((name) => `"${name}"`).join(", ")}`)
