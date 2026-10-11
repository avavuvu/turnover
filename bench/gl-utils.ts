export { createFrameTexture, createFullscreenTextureProgram } from "../src/gl";

export function getBc1Format(gl: WebGL2RenderingContext): GLenum {
	const s3tc = gl.getExtension("WEBGL_compressed_texture_s3tc");
	if (!s3tc) throw new Error("WEBGL_compressed_texture_s3tc is not available");
	return s3tc.COMPRESSED_RGB_S3TC_DXT1_EXT;
}
