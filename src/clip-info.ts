export type KeySection = {
	start: number;
	end: number;
	key: string;
	confidence: number;
};

export type EncodeSettings = {
	maxHeight: number;
	startSeconds?: number;
	endSeconds?: number;
};

export type ClipInfo = {
	title: string;
	source?: string;
	uploader?: string;

	originalFile: string;
	playbackFile: string;
	encode: EncodeSettings;

	width: number;
	height: number;
	fps: number;
	durationSeconds: number;

	tempoBpm: number | null;
	tempoConfidence: number | null;
	key: string;
	camelot: string;
	keyConfidence: number | null;
	tuningCents: number;
	sections: KeySection[];
};

export type ClipLibrary = Record<string, ClipInfo>;
