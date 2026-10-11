import { createFrameTexture, createFullscreenTextureProgram, getBc1Format } from "../gl-utils";

export type FramePayload =
	| { kind: "video-frame"; frame: VideoFrame }
	| { kind: "bc1"; data: Uint8Array; width: number; height: number; release?: () => void };

export function releasePayload(payload: FramePayload) {
	if (payload.kind === "video-frame") payload.frame.close();
	else payload.release?.();
}

export class GridCompositor {
	private readonly gl: WebGL2RenderingContext;
	private bc1Format: GLenum | null = null;

	constructor(private readonly canvas: HTMLCanvasElement) {
		const gl = canvas.getContext("webgl2", { antialias: false });
		if (!gl) throw new Error("WebGL2 is not available");
		this.gl = gl;
		gl.useProgram(createFullscreenTextureProgram(gl));
	}

	createRgbaTexture(): WebGLTexture {
		return createFrameTexture(this.gl);
	}

	createBc1Texture(width: number, height: number): WebGLTexture {
		const gl = this.gl;
		this.bc1Format ??= getBc1Format(gl);
		const texture = createFrameTexture(gl);
		gl.texStorage2D(gl.TEXTURE_2D, 1, this.bc1Format, width, height);
		return texture;
	}

	deleteTexture(texture: WebGLTexture) {
		this.gl.deleteTexture(texture);
	}

	upload(texture: WebGLTexture, payload: FramePayload) {
		const gl = this.gl;
		gl.bindTexture(gl.TEXTURE_2D, texture);

		if (payload.kind === "video-frame") {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, payload.frame);
		} else {
			gl.compressedTexSubImage2D(
				gl.TEXTURE_2D,
				0,
				0,
				0,
				payload.width,
				payload.height,
				this.bc1Format!,
				payload.data
			);
		}

		releasePayload(payload);
	}

	draw(textures: WebGLTexture[]) {
		const gl = this.gl;
		const { width, height } = this.canvas;
		const columns = Math.ceil(Math.sqrt(textures.length));
		const rows = Math.ceil(textures.length / columns);
		const cellWidth = Math.floor(width / columns);
		const cellHeight = Math.floor(height / rows);

		gl.viewport(0, 0, width, height);
		gl.clearColor(0, 0, 0, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);

		textures.forEach((texture, i) => {
			const column = i % columns;
			const row = Math.floor(i / columns);
			gl.viewport(column * cellWidth, height - (row + 1) * cellHeight, cellWidth, cellHeight);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		});
	}
}
