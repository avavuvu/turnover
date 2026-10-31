import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const EDITOR_DIR = fileURLToPath(new URL("../..", import.meta.url))
export const LIBRARY_DIR = join(EDITOR_DIR, "library")
export const LIBRARY_FILE = join(LIBRARY_DIR, "clips.json")
export const PLAYBACK_DIR = join(LIBRARY_DIR, "playback")
