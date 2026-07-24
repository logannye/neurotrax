// Positions arrive already in clip space (x,y in -1..1, y flipped by the CPU).
export const MESH_VERT = `#version 300 es
precision highp float;
in vec2 aPos;
in float aDepth;
out float vDepth;
void main() {
  vDepth = aDepth;
  gl_PointSize = 1.5 + aDepth * 3.0;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const MESH_FRAG = `#version 300 es
precision highp float;
in float vDepth;
uniform vec3 uNearColor;
uniform vec3 uFarColor;
uniform float uAlpha;
out vec4 outColor;
void main() {
  vec3 col = mix(uFarColor, uNearColor, vDepth);
  float a = uAlpha * (0.28 + 0.5 * vDepth);
  outColor = vec4(col * a, a); // premultiplied for additive blending
}`;
