import FRAGMENT_SHADER from "./frame.frag?raw"
import VERTEX_SHADER from "./fullscreen.vert?raw"

const compileShader = (gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader => {
	const shader = gl.createShader(type)!
	gl.shaderSource(shader, source)
	gl.compileShader(shader)
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		throw new Error(gl.getShaderInfoLog(shader) ?? "Shader compile failed")
	}
	return shader
}

export const createFullscreenTextureProgram = (gl: WebGL2RenderingContext): WebGLProgram => {
	const program = gl.createProgram()
	gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER))
	gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER))
	gl.linkProgram(program)
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		throw new Error(gl.getProgramInfoLog(program) ?? "Program link failed")
	}
	return program
}

export const createFrameTexture = (gl: WebGL2RenderingContext): WebGLTexture => {
	const texture = gl.createTexture()
	gl.bindTexture(gl.TEXTURE_2D, texture)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
	return texture
}
