import "./style.css";
import "@strudel/repl";

import { type Clip, loadLibrary } from "./library";
import { VideoSampler } from "./sampler";
import { errorMessage, type LoadingProgress, StatusPanel } from "./status";
import { loadClipAudio, registerVid } from "./strudel-clips";
import { type StrudelEditorElement, strudelScope, type StrudelScope } from "./strudel-scope";

const canvas = document.querySelector<HTMLCanvasElement>("#video-canvas")!;
const strudelEditor = document.querySelector<StrudelEditorElement>("strudel-editor")!;

const status = new StatusPanel(document.querySelector<HTMLElement>("#status")!);
const sampler = new VideoSampler(canvas);
const loadedAudio = new Map<string, AudioBuffer>();

function handledLater<T>(promise: Promise<T>): Promise<T> {
	promise.catch(() => {});
	return promise;
}

function fitCanvasToWindow() {
	sampler.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
}

async function waitForStrudel(): Promise<StrudelScope> {
	await customElements.whenDefined("strudel-editor");
	strudelEditor.editor.changeSetting("isTabIndentationEnabled", true);
	try {
		await strudelEditor.editor.prebaked;
	} catch (error) {
		throw new Error(`Strudel could not finish loading its sounds: ${errorMessage(error)}`);
	}
	return strudelScope();
}

async function loadLibraryOrNothing(): Promise<Record<string, Clip>> {
	try {
		return await loadLibrary();
	} catch (error) {
		status.error(errorMessage(error));
		return {};
	}
}

function loadClips(
	clips: Record<string, Clip>,
	scope: StrudelScope,
	pictures: Map<string, Promise<void>>
) {
	const progress: LoadingProgress = { ready: 0, failed: 0, total: pictures.size };
	status.showLoading(progress);

	for (const [clipName, picture] of pictures) {
		Promise.all([picture, loadClipAudio(scope, clipName, clips[clipName])])
			.then(([, audio]) => {
				loadedAudio.set(clipName, audio);
				progress.ready++;
			})
			.catch((error) => {
				status.error(`Clip "${clipName}" did not load: ${errorMessage(error)}`);
				progress.failed++;
			})
			.finally(() => status.showLoading(progress));
	}
}

async function start() {
	canvas.hidden = false;
	fitCanvasToWindow();
	window.addEventListener("resize", fitCanvasToWindow);
	window.addEventListener("beforeunload", () => sampler.stop());
	sampler.start();

	const strudel = waitForStrudel();
	const clips = await loadLibraryOrNothing();
	const pictures = new Map(
		Object.entries(clips).map(([clipName, clip]) => {
			return [clipName, handledLater(sampler.load(clipName, clip.url))];
		})
	);

	const scope = await strudel;
	sampler.useClock(() => scope.getAudioContext());
	registerVid(scope, {
		clips,
		loadedAudio,
		playPicture: (request) => sampler.play(request),
		warn: (message) => status.warn(message)
	});
	loadClips(clips, scope, pictures);
}

start().catch((error) => status.error(errorMessage(error)));
