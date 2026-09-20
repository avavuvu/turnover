import nyilyFile from "./videos/nyily.mp4";
import charliFile from "./videos/charli_fixed.mp4";
import waterFile from "./videos/water_fixed.mp4";

const MIDI_PORT = "IAC Driver Bus 1";
const MIDI_CHANNEL = 2;
const DEFAULT_VELOCITY = 0.7;

export const SEEK_CC = 1;

export const videos = {
	nyily: { note: 60, file: nyilyFile, audioChannel: 4 },
	charli: { note: 61, file: charliFile, audioChannel: 4 },
	water: { note: 62, file: waterFile, audioChannel: 4 }
};

export function setupStrudel() {
	register("midiOut", (pat) =>
		pat
			.withValue((v) => ({ velocity: DEFAULT_VELOCITY, ...v }))
			.midichan(MIDI_CHANNEL)
			.midi(MIDI_PORT)
	);

	register("seek", (seconds, pat) =>
		pat
			.ccn(SEEK_CC)
			.ccv(seconds / 127)
			.midiOut()
	);

	globalThis.vid = (name, seconds) => note(reify(name).fmap((n) => videos[n].note)).seek(seconds);
}
