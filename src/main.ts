import "./style.css";
import "@strudel/repl";

import { VideoSampler } from "./sampler";
import type { StrudelEditorElement } from "./strudel-scope";
import { clipUrls, setupStrudel } from "./strudel-clips";

const canvas = document.querySelector<HTMLCanvasElement>("#video-canvas")!;
const strudelEditor = document.querySelector<StrudelEditorElement>("strudel-editor")!;

const sampler = new VideoSampler(canvas);

function fitCanvasToWindow() {
	sampler.resize(window.innerWidth, window.innerHeight);
}

async function loadClips() {
	canvas.hidden = false;
	fitCanvasToWindow();
	window.addEventListener("resize", fitCanvasToWindow);
	window.addEventListener("beforeunload", () => sampler.stop());
	sampler.start();
	await sampler.load(clipUrls());
}

async function loadStrudelPrelude() {
	await customElements.whenDefined("strudel-editor");
	strudelEditor.editor.changeSetting("isTabIndentationEnabled", true);
	await strudelEditor.editor.prebaked;

	const scope = setupStrudel((request) => sampler.play(request));
	sampler.useClock(() => scope.getAudioContext());
}

loadClips().catch(console.error);
loadStrudelPrelude().catch(console.error);
