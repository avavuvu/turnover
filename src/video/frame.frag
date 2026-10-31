#version 300 es
precision mediump float;
uniform sampler2D frameTexture;
in vec2 uv;
out vec4 color;
void main() {
	color = vec4(texture(frameTexture, uv).rgb, 1.0);
}
