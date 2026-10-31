import { createFrameTexture, createFullscreenTextureProgram } from "./gl"

export type DrawItem = {
	texture: WebGLTexture
	x: number
	y: number
	width: number
	height: number
}

export class Compositor {
	private readonly gl: WebGL2RenderingContext

	constructor(private readonly canvas: HTMLCanvasElement) {
		const gl = canvas.getContext("webgl2", { antialias: false })
		if (!gl) throw new Error("WebGL2 is not available")
		this.gl = gl
		gl.useProgram(createFullscreenTextureProgram(gl))
	}

	get width() {
		return this.canvas.width
	}

	get height() {
		return this.canvas.height
	}

	resize(width: number, height: number) {
		this.canvas.width = width
		this.canvas.height = height
	}

	createTexture(): WebGLTexture {
		return createFrameTexture(this.gl)
	}

	deleteTexture(texture: WebGLTexture) {
		this.gl.deleteTexture(texture)
	}

	upload(texture: WebGLTexture, frame: VideoFrame) {
		const gl = this.gl
		gl.bindTexture(gl.TEXTURE_2D, texture)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame)
	}

	draw(items: DrawItem[]) {
		const gl = this.gl
		gl.viewport(0, 0, this.width, this.height)
		gl.clearColor(0, 0, 0, 1)
		gl.clear(gl.COLOR_BUFFER_BIT)

		for (const item of items) {
			gl.viewport(
				Math.round(item.x),
				Math.round(this.height - item.y - item.height),
				Math.round(item.width),
				Math.round(item.height)
			)
			gl.bindTexture(gl.TEXTURE_2D, item.texture)
			gl.drawArrays(gl.TRIANGLES, 0, 3)
		}
	}
}
