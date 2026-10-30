# dj-video

Live-code video clips with [Strudel](https://strudel.cc). Each clip plays its sound through
Strudel and its picture on a canvas behind the editor, in sync.

## Setup

Needs [Bun](https://bun.sh), plus `ffmpeg` and `yt-dlp` for adding clips:

```sh
brew install ffmpeg yt-dlp
bun install
bun run dev
```

## Adding clips

| Command                                          | What it does                   |
| ------------------------------------------------ | ------------------------------ |
| `bun run add-clip https://youtube.com/watch?v=…` | Download from YouTube          |
| `bun run add-clip ~/Videos/set.mp4 --name set`   | Use a local file               |
| `bun run add-clip <url> --start 1:15 --end 2:30` | Keep only part of a video      |
| `bun run add-clip <url> --key Em --bpm 95.4`     | Set the key and tempo yourself |

This keeps the original, makes a playback copy where every frame is a keyframe (so any
moment can be shown instantly), and finds the key, tuning, and tempo with
[Essentia.js](https://mtg.github.io/essentia.js/). Run `bun run add-clip --help` for all options.

Detection is a guess, especially for speech, live sets, and very short clips. When you set the
key or tempo yourself, its confidence is stored as `null`. Key sections are always detected, so
`.key()` follows what the detector heard.

Bun 1.1 splits quoted arguments passed through `bun run`. For a value with spaces, such as
`--title "Live at Home"`, run `bun scripts/add-clip.ts` instead.

## The library

Clips live in `library/`, which is not in this repo:

```
library/
  clips.json   name, key, tempo, sections, and how each clip was encoded
  originals/   the downloaded or copied source videos
  playback/    the copies the app plays; can be rebuilt from originals
```

To recreate playback files (for example after deleting them, or on a new machine with
only `originals/` and `clips.json`):

| Command                            | What it does                     |
| ---------------------------------- | -------------------------------- |
| `bun run rebuild-clips`            | Rebuild every clip               |
| `bun run rebuild-clips mack oklou` | Rebuild some clips               |
| `bun run rebuild-clips --missing`  | Only clips with no playback file |

The app reads `library/` when the page loads, so reload the page after adding a clip.
`bun run build` does not copy the library; serve `library/` next to the built files.

## Playing clips in Strudel

| Code                                 | What it does                               |
| ------------------------------------ | ------------------------------------------ |
| `vid("mack")`                        | Play the clip from the start               |
| `vid("<mack oklou>")`                | Mini-notation works as usual               |
| `vid("mack:3")`                      | Jump to cue 3 (cues are every 2 seconds)   |
| `vid("mack").key("Em")`              | Only cue into parts of the clip in E minor |
| `vid("mack:2").begin(0.25).end(0.5)` | Play part of the stretch after cue 2       |
| `vid("mack", 30)`                    | Start 30 seconds in (same as `.seek(30)`)  |
| `vid("mack").speed(-1)`              | Play backwards                             |

- `key` accepts names like `"E:minor"`, `"Em"`, `"F#:major"`, or `"Bb"`. With a key, cues
  only fall in sections detected in that key.
- `begin` and `end` are fractions of the stretch from the cue to the end of its section.
- Other Strudel sound controls (`gain`, `lpf`, `room`, …) apply to the clip's audio.
- `clips` holds the library, so `clips.mack.tempoBpm` gives a clip's tempo.

Loading progress and problems, such as an unknown clip name, appear in the bottom-right corner.
Warnings fade after a few seconds; click an error to dismiss it.

## Scripts

| Command                 | What it does                          |
| ----------------------- | ------------------------------------- |
| `bun run dev`           | Start the app                         |
| `bun run add-clip`      | Add a clip to the library             |
| `bun run rebuild-clips` | Rebuild playback files from originals |
| `bun run check`         | Typecheck the app and scripts         |
| `bun run format`        | Format with Prettier                  |
