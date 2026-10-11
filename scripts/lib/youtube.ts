import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runVisible } from "./run";

export type DownloadedVideo = {
	file: string;
	title: string;
	url: string;
	uploader?: string;
};

export function isUrl(input: string): boolean {
	return /^https?:\/\//i.test(input);
}

export function downloadVideo(url: string, directory: string, maxHeight: number): DownloadedVideo {
	const format = [`bv*[height<=${maxHeight}]+ba`, `b[height<=${maxHeight}]`, "bv*+ba", "b"].join(
		"/"
	);
	const pathFile = join(directory, ".download-path.txt");
	rmSync(pathFile, { force: true });

	runVisible("yt-dlp", [
		"--no-playlist",
		"--format",
		format,
		"--merge-output-format",
		"mkv",
		"--output",
		join(directory, "%(id)s.%(ext)s"),
		"--write-info-json",
		"--print-to-file",
		"after_move:filepath",
		pathFile,
		url
	]);

	const file = readFileSync(pathFile, "utf8").trim().split("\n").at(-1);
	rmSync(pathFile);
	if (!file) throw new Error(`yt-dlp did not report a file for ${url}`);

	const infoFile = file.replace(/\.[^.]+$/, ".info.json");
	const info = JSON.parse(readFileSync(infoFile, "utf8"));
	rmSync(infoFile);

	return {
		file,
		title: info.title ?? info.id,
		url: info.webpage_url ?? url,
		uploader: info.uploader ?? undefined
	};
}
