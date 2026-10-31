import "./style.css"
import "@strudel/repl"

import { type Clip, loadLibrary } from "./library/library"
import { VideoSampler } from "./video/sampler"
import { errorMessage, type LoadingProgress, StatusPanel } from "./status"
import { loadClipAudio, registerVid } from "./strudel/clips"
import { type StrudelEditorElement, strudelScope, type StrudelScope } from "./strudel/scope"

const canvas = document.querySelector<HTMLCanvasElement>("#video-canvas")!
const strudelEditor = document.querySelector<StrudelEditorElement>("strudel-editor")!

const status = new StatusPanel(document.querySelector<HTMLElement>("#status")!)
const sampler = new VideoSampler(canvas)
const loadedAudio = new Map<string, AudioBuffer>()

const handledLater = <T>(promise: Promise<T>): Promise<T> => {
	promise.catch(() => {})
	return promise
}

const fitCanvasToWindow = () => {
	sampler.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio)
}

const waitForStrudel = async (): Promise<StrudelScope> => {
	await customElements.whenDefined("strudel-editor")
	strudelEditor.editor.changeSetting("isTabIndentationEnabled", true)
	try {
		await strudelEditor.editor.prebaked
	} catch (error) {
		throw new Error(`Strudel could not finish loading its sounds: ${errorMessage(error)}`, {
			cause: error
		})
	}
	return strudelScope()
}

const loadLibraryOrNothing = async (): Promise<Record<string, Clip>> => {
	try {
		return await loadLibrary()
	} catch (error) {
		status.error(errorMessage(error))
		return {}
	}
}

const loadClips = (
	clips: Record<string, Clip>,
	scope: StrudelScope,
	pictures: Map<string, Promise<void>>
) => {
	const progress: LoadingProgress = { ready: 0, failed: 0, total: pictures.size }
	status.showLoading(progress)

	for (const [clipName, picture] of pictures) {
		Promise.all([picture, loadClipAudio(scope, clipName, clips[clipName])])
			.then(([, audio]) => {
				loadedAudio.set(clipName, audio)
				progress.ready++
			})
			.catch((error) => {
				status.error(`Clip "${clipName}" did not load: ${errorMessage(error)}`)
				progress.failed++
			})
			.finally(() => status.showLoading(progress))
	}
}

const start = async () => {
	canvas.hidden = false
	fitCanvasToWindow()
	window.addEventListener("resize", fitCanvasToWindow)
	window.addEventListener("beforeunload", () => sampler.stop())
	sampler.start()

	const strudel = waitForStrudel()
	const clips = await loadLibraryOrNothing()
	const pictures = new Map(
		Object.entries(clips).map(([clipName, clip]) => {
			return [clipName, handledLater(sampler.load(clipName, clip.url))]
		})
	)

	const scope = await strudel
	sampler.useClock(() => scope.getAudioContext())
	registerVid(scope, {
		clips,
		loadedAudio,
		playPicture: (request) => sampler.play(request),
		warn: (message) => status.warn(message)
	})
	loadClips(clips, scope, pictures)
}

const strudelErrors = new Set<string>()

const showStrudelLog = (event: Event) => {
	const { message, type } = (event as CustomEvent<{ message: string; type?: string }>).detail
	if (message === "[eval] code updated") {
		for (const error of strudelErrors) status.dismiss(error)
		strudelErrors.clear()
		return
	}
	if (type !== "error" && !/^\[\w+\] error: /.test(message)) return
	strudelErrors.add(message)
	status.error(message)
}

document.addEventListener("strudel.log", showStrudelLog)
start().catch((error) => status.error(errorMessage(error)))
