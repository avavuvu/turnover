const WARNING_SECONDS = 8
const READY_SECONDS = 3

type Message = { element: HTMLLIElement; timer?: number }

export type LoadingProgress = { ready: number; failed: number; total: number }

export const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error)

export class StatusPanel {
	private readonly loading: HTMLParagraphElement
	private readonly list: HTMLUListElement
	private readonly messages = new Map<string, Message>()
	private loadingTimer?: number

	constructor(root: HTMLElement) {
		this.loading = root.appendChild(document.createElement("p"))
		this.loading.className = "status-loading"
		this.loading.hidden = true
		this.list = root.appendChild(document.createElement("ul"))
	}

	warn(text: string) {
		const message = this.show(text, "warning")
		window.clearTimeout(message.timer)
		message.timer = window.setTimeout(() => this.dismiss(text), WARNING_SECONDS * 1000)
	}

	error(text: string) {
		const message = this.show(text, "error")
		message.element.title = "Click to dismiss"
		message.element.onclick = () => this.dismiss(text)
	}

	showLoading({ ready, failed, total }: LoadingProgress) {
		window.clearTimeout(this.loadingTimer)
		this.loading.hidden = total === 0
		if (ready + failed < total) {
			this.loading.textContent = `Loading clips: ${ready + failed} of ${total}`
			return
		}
		this.loading.textContent =
			failed === 0 ? `${total} clips ready` : `${ready} of ${total} clips ready`
		this.loadingTimer = window.setTimeout(() => (this.loading.hidden = true), READY_SECONDS * 1000)
	}

	private show(text: string, level: "warning" | "error"): Message {
		const existing = this.messages.get(text)
		if (existing) return existing

		;(level === "error" ? console.error : console.warn)(text)
		const element = this.list.appendChild(document.createElement("li"))
		element.className = `status-${level}`
		element.textContent = text
		const message: Message = { element }
		this.messages.set(text, message)
		return message
	}

	dismiss(text: string) {
		const message = this.messages.get(text)
		if (!message) return
		window.clearTimeout(message.timer)
		message.element.remove()
		this.messages.delete(text)
	}
}
