const enabled = process.stdout.isTTY && !process.env.NO_COLOR

const style =
	(open: number, close: number) =>
	(text: string): string =>
		enabled ? `\x1b[${open}m${text}\x1b[${close}m` : text

export const bold = style(1, 22)
export const dim = style(2, 22)
export const cyan = style(36, 39)
export const green = style(32, 39)
export const yellow = style(33, 39)
