import { createFrameTexture, createFullscreenTextureProgram, getBc1Format } from "./gl-utils";

export class Bc1Renderer {
	private readonly gl: WebGL2RenderingContext;
	private readonly format: GLenum;
	private readonly readbackPixel = new Uint8Array(4);

	constructor(
		canvas: HTMLCanvasElement,
		private readonly width: number,
		private readonly height: number
	) {
		if (width % 4 !== 0 || height % 4 !== 0) {
			throw new Error(`BC1 frame size must be a multiple of 4, got ${width}x${height}`);
		}

		canvas.width = width;
		canvas.height = height;

		const gl = canvas.getContext("webgl2");
		if (!gl) throw new Error("WebGL2 is not available");

		this.gl = gl;
		this.format = getBc1Format(gl);

		createFrameTexture(gl);
		gl.texStorage2D(gl.TEXTURE_2D, 1, this.format, width, height);
		gl.useProgram(createFullscreenTextureProgram(gl));
		gl.viewport(0, 0, width, height);
	}

	drawFrame(bc1: Uint8Array) {
		const gl = this.gl;
		gl.compressedTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, this.format, bc1);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}

	waitForGpu() {
		const gl = this.gl;
		gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.readbackPixel);
	}
}
