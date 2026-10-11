import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { KeySection } from "./key";

export type ClipEntry = {
	file: string;
	title: string;
	source?: string;
	uploader?: string;
	durationSeconds: number;
	width: number;
	height: number;
	fps: number;
	tempoBpm: number | null;
	tempoConfidence: number | null;
	key: string;
	camelot: string;
	keyConfidence: number;
	alternativeKey: string;
	tuningCents: number;
	sections: KeySection[];
};

export type ClipLibrary = Record<string, ClipEntry>;

const MAX_GENERATED_NAME_LENGTH = 12;
const VALID_NAME = /^[a-z][a-z0-9]*$/;

export function readLibrary(file: string): ClipLibrary {
	if (!existsSync(file)) return {};
	return JSON.parse(readFileSync(file, "utf8"));
}

export function writeLibrary(file: string, library: ClipLibrary) {
	const partial = `${file}.partial`;
	writeFileSync(partial, `${JSON.stringify(library, null, "\t")}\n`);
	renameSync(partial, file);
}

export function assertValidName(name: string) {
	if (!VALID_NAME.test(name)) {
		throw new Error(
			`Clip name "${name}" is not valid. Use only lowercase letters and digits, and start with a letter. Strudel mini-notation reads other characters as operators.`
		);
	}
}

export function nameFromTitle(title: string, takenNames: Set<string>): string {
	const letters = title
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "")
		.replace(/^[0-9]+/, "");
	const base = letters.slice(0, MAX_GENERATED_NAME_LENGTH) || "clip";

	let name = base;
	for (let suffix = 2; takenNames.has(name); suffix++) name = `${base}${suffix}`;
	return name;
}
