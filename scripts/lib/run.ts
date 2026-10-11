import { spawnSync, type SpawnSyncReturns } from "node:child_process";

const INSTALL_HINTS: Record<string, string> = {
	"yt-dlp": "brew install yt-dlp",
	ffmpeg: "brew install ffmpeg",
	ffprobe: "brew install ffmpeg"
};

const MAX_OUTPUT_BYTES = 2 ** 31;

function check<T>(command: string, result: SpawnSyncReturns<T>): SpawnSyncReturns<T> {
	if (result.error) {
		const code = (result.error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			const hint = INSTALL_HINTS[command] ? ` Install it with: ${INSTALL_HINTS[command]}` : "";
			throw new Error(`${command} is not installed.${hint}`);
		}
		throw result.error;
	}
	if (result.status !== 0) {
		const stderr = result.stderr ? String(result.stderr).trim() : "";
		throw new Error(
			`${command} failed with exit code ${result.status}${stderr ? `:\n${stderr}` : ""}`
		);
	}
	return result;
}

export function runVisible(command: string, args: string[]) {
	check(command, spawnSync(command, args, { stdio: ["ignore", "inherit", "inherit"] }));
}

export function runText(command: string, args: string[]): string {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		maxBuffer: MAX_OUTPUT_BYTES,
		stdio: ["ignore", "pipe", "pipe"]
	});
	return check(command, result).stdout;
}

export function runBinary(command: string, args: string[]): Buffer {
	const result = spawnSync(command, args, {
		maxBuffer: MAX_OUTPUT_BYTES,
		stdio: ["ignore", "pipe", "pipe"]
	});
	return check(command, result).stdout;
}
