import { Command } from "commander"

import type { ClipInfo } from "../src/library/clip-info"
import { bold, cyan, dim, green, yellow } from "./lib/color"
import { readLibrary } from "./lib/library"
import { LIBRARY_FILE } from "./lib/paths"

new Command()
	.name("bun run list-clips")
	.description("Lists the clips in library/clips.json with their tempo, key, and the keys found.")
	.parse()

const shortKey = (key: string) => key.replace(" major", "").replace(" minor", "m")

const formatDuration = (seconds: number) => {
	const minutes = Math.floor(seconds / 60)
	return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
}

const keysByTime = (clip: ClipInfo): string[] => {
	const seconds = new Map<string, number>()
	for (const { key, start, end } of clip.sections) {
		seconds.set(key, (seconds.get(key) ?? 0) + end - start)
	}
	return [...seconds].sort((a, b) => b[1] - a[1]).map(([key]) => key)
}

const library = readLibrary(LIBRARY_FILE)
const names = Object.keys(library).sort()

if (names.length === 0) {
	console.log('The library is empty. Add a clip with "bun run add-clip".')
	process.exit(0)
}

const width = Math.max(...names.map((name) => name.length)) + 2
const indent = " ".repeat(width)

for (const name of names) {
	const clip = library[name]
	const tempo = clip.tempoBpm === null ? "tempo unknown" : `${clip.tempoBpm} BPM`
	const keys = keysByTime(clip).map((key) =>
		key === clip.key ? yellow(shortKey(key)) : green(shortKey(key))
	)
	console.log(`${bold(cyan(name.padEnd(width)))}${bold(clip.title)}
${indent}${dim(formatDuration(clip.durationSeconds))}\t\t${dim(tempo)}\t\t${yellow(shortKey(clip.key))} ${dim(`(${clip.camelot})`)}
${indent}${dim("keys:")} ${keys.join(dim(", ")) || dim("none found")}
`)
}
