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

// Fullscreen-triangle vertex shader. No vertex buffers: gl_VertexID 0..2 emits a
// triangle that covers the clip-space quad, and vUv spans 0..1 over the viewport.
//   id 0 -> uv (0,0) -> pos (-1,-1)
//   id 1 -> uv (2,0) -> pos ( 3,-1)
//   id 2 -> uv (0,2) -> pos (-1, 3)
export const QUAD_VERT = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = uv;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

// Separable 9-tap Gaussian. Run once per axis: uDir=(1,0) horizontal, (0,1)
// vertical. uTexel is the 1/size of the working resolution so the blur radius is
// resolution-relative. Weights are the classic normalized Gaussian (sum == 1).
export const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform vec2 uDir;
out vec4 outColor;
void main() {
  const float w[5] = float[5](
    0.2270270270,
    0.1945945946,
    0.1216216216,
    0.0540540541,
    0.0162162162
  );
  vec2 texStep = uTexel * uDir;
  vec4 sum = texture(uTex, vUv) * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 off = texStep * float(i);
    sum += texture(uTex, vUv + off) * w[i];
    sum += texture(uTex, vUv - off) * w[i];
  }
  outColor = sum;
}`;

// Composite the scene FBO with the blurred bloom texture. Both are stored
// premultiplied, so a straight add preserves premultiplied-alpha semantics; the
// caller draws this with premultiplied-over blending onto the transparent canvas.
export const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
out vec4 outColor;
void main() {
  vec4 sceneColor = texture(uScene, vUv);
  vec4 bloom = texture(uBloom, vUv);
  outColor = sceneColor + bloom * uBloomStrength;
}`;
