# Turnover

[Strudel](https://strudel.cc) combined with video sampling

![An apple turnover](/turnover.jpg)

This is a WIP and currently only works locally and while connected to the internet. I have plans to make it into a proper desktop app.

```javascript
$: vid("charli")
    .seek(rand.range(0,100))
    .dist(2)
    .ply(4)

$: s("bd*4").bank("tr808")
```

## Syntax

Turnover adds the `vid()` function to Strudel to allow for playing videos.

| Code                                   |                                            |
| ------------------------------------   | ------------------------------------------ |
| `vid("charli")`                        | Plays a video clip             |
| `vid("<charli [<oklou charli> -]>")`                | Mini notation works on `vid`            |
| `vid("charli").seek(30)`                    | Start 30 seconds in  |
| `vid("charli").key("Em")`              | Skips to part of the video in E minor. It will fail if the video doesn't have a section in that key |
| `vid("charli").lpf(1000).dist(2)`              | All normal Strudel audio functions work on the video clips                            |


## Requirements
 - [Bun](https://bun.sh)
 - It only works in Chrome / Chromium

### For adding YouTube videos
- [ffmpeg](https://ffmpeg.org/)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)

## Setup
```
bun install
bun run dev
```

## Adding clips

| Command                                          |                                |
| ------------------------------------------------ | ------------------------------ |
| `bun run add-clip "https://www.youtube.com/watch?v=JobigFZqvc0"` | Download from YouTube          |
| `bun run add-clip ~/Videos/set.mp4 --name set`   | Use a local file               |
| `bun run add-clip <url> --start 1:15 --end 2:30` | Keep only part of a video      |
| `bun run add-clip <url> --key Em --bpm 95.4`     | Override the tempo and key informatioon|
| `bun run list-clips`                             | List clips with their tempo and keys |
| `bun run remove-clip charli`                     | Remove a clip and its video file (you can remove multiple clips at the same time) |

Adding a clip will create a `library/` folder and a new clips.json file.

```
library/
  clips.json   
  playback/     video files for turnover
```
