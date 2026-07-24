import { FaceLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import {
  EMPTY_RESULT,
  FACE_MESH_LANDMARK_COUNT,
  type FaceMeshRenderer,
  type FaceMeshRenderInput,
  type FaceMeshRenderResult
} from "./face-mesh-renderer.js";
import { depthToColor, normalizeDepth } from "./mesh-depth.js";
import { MESH_FRAG, MESH_VERT } from "./face-mesh-gl-shaders.js";

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) ?? "shader compile failed";
    // Don't leak the failed shader object — it never reaches a program, so
    // no later cleanup path can free it for us.
    gl.deleteShader(s);
    throw new Error(log);
  }
  return s;
}
function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  let vShader: WebGLShader | null = null;
  let fShader: WebGLShader | null = null;
  try {
    vShader = compile(gl, gl.VERTEX_SHADER, vs);
    fShader = compile(gl, gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, vShader);
    gl.attachShader(p, fShader);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) ?? "program link failed");
    }
  } catch (err) {
    // Free whatever partial GL objects this attempt created before letting
    // the error propagate — a compile failure leaves the other shader (or
    // none) created, and a link failure leaves both shaders attached.
    if (vShader) gl.deleteShader(vShader);
    if (fShader) gl.deleteShader(fShader);
    gl.deleteProgram(p);
    throw err;
  }
  // Shaders marked for deletion stay alive while attached to the program,
  // then free automatically when the program itself is deleted.
  gl.deleteShader(vShader!);
  gl.deleteShader(fShader!);
  return p;
}

// Flatten the static MediaPipe tessellation into a line-index array once.
const TESS_INDICES: number[] = FaceLandmarker.FACE_LANDMARKS_TESSELATION.flatMap(
  (c) => [c.start, c.end]
);

export class FaceMeshGLRenderer implements FaceMeshRenderer {
  private canvas: OffscreenCanvas | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private posBuf: WebGLBuffer | null = null;
  private depthBuf: WebGLBuffer | null = null;
  private lineIndexBuf: WebGLBuffer | null = null;
  private latest: FaceMeshRenderInput | null = null;
  private positions = new Float32Array(FACE_MESH_LANDMARK_COUNT * 2);
  private depths = new Float32Array(FACE_MESH_LANDMARK_COUNT);

  attach(canvas: OffscreenCanvas, _maxRenderHz: number): boolean {
    this.detach();
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true
    });
    if (!gl) return false;
    try {
      this.canvas = canvas;
      this.gl = gl;
      this.program = link(gl, MESH_VERT, MESH_FRAG);
      this.posBuf = gl.createBuffer();
      this.depthBuf = gl.createBuffer();
      this.lineIndexBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineIndexBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(TESS_INDICES), gl.STATIC_DRAW);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE); // additive (premultiplied)
    } catch {
      // Any GL-init failure (blocklisted GPU, shader compile/link bug, driver
      // quirk) must be isolated here so the caller can fall back to the 2D
      // renderer instead of the exception propagating out of attach().
      if (this.program) gl.deleteProgram(this.program);
      if (this.posBuf) gl.deleteBuffer(this.posBuf);
      if (this.depthBuf) gl.deleteBuffer(this.depthBuf);
      if (this.lineIndexBuf) gl.deleteBuffer(this.lineIndexBuf);
      this.gl = null;
      this.canvas = null;
      this.program = null;
      this.posBuf = null;
      this.depthBuf = null;
      this.lineIndexBuf = null;
      return false;
    }
    return true;
  }

  isAttached(): boolean {
    return this.gl !== null && this.program !== null;
  }

  updateLandmarks(input: FaceMeshRenderInput): void {
    this.latest = input;
  }

  drawFrame(nowMs: number, introProgress = 1): FaceMeshRenderResult {
    const gl = this.gl;
    const canvas = this.canvas;
    const input = this.latest;
    if (!gl || !canvas || !this.program || !input) return EMPTY_RESULT;
    if (
      !Number.isFinite(input.width) ||
      !Number.isFinite(input.height) ||
      !Number.isFinite(nowMs)
    ) {
      return EMPTY_RESULT;
    }
    const width = Math.round(input.width);
    const height = Math.round(input.height);
    if (width <= 0 || height <= 0) return EMPTY_RESULT;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const n = Math.min(FACE_MESH_LANDMARK_COUNT, input.landmarks.length);
    const depthNorm = normalizeDepth(
      input.landmarks.slice(0, n).map((l: NormalizedLandmark) => l.z ?? 0)
    );
    let dots = 0;
    for (let i = 0; i < n; i += 1) {
      const l = input.landmarks[i];
      const ok = Number.isFinite(l.x) && Number.isFinite(l.y);
      // clip space: x in -1..1; y flipped (canvas y-down -> GL y-up)
      this.positions[i * 2] = ok ? l.x * 2 - 1 : 0;
      this.positions[i * 2 + 1] = ok ? 1 - l.y * 2 : 0;
      this.depths[i] = ok ? depthNorm[i] : 0;
      if (ok) dots += 1;
    }

    const near = depthToColor(1, (nowMs * 0.02) % 360);
    const far = depthToColor(0, (nowMs * 0.02) % 360);
    const alpha = introProgress; // fade in during localize

    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.positions.subarray(0, n * 2), gl.DYNAMIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.depthBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.depths.subarray(0, n), gl.DYNAMIC_DRAW);
    const aDepth = gl.getAttribLocation(this.program, "aDepth");
    gl.enableVertexAttribArray(aDepth);
    gl.vertexAttribPointer(aDepth, 1, gl.FLOAT, false, 0, 0);
    gl.uniform3f(gl.getUniformLocation(this.program, "uNearColor"), near.r, near.g, near.b);
    gl.uniform3f(gl.getUniformLocation(this.program, "uFarColor"), far.r, far.g, far.b);
    gl.uniform1f(gl.getUniformLocation(this.program, "uAlpha"), alpha);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineIndexBuf);
    gl.drawElements(gl.LINES, TESS_INDICES.length, gl.UNSIGNED_SHORT, 0);
    gl.drawArrays(gl.POINTS, 0, n);

    return { rendered: true, landmarkDots: dots, tessellationEdges: TESS_INDICES.length / 2, accentAnchors: 0 };
  }

  clear(): void {
    const { gl, canvas } = this;
    if (gl && canvas) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  detach(): void {
    const gl = this.gl;
    if (gl) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.posBuf) gl.deleteBuffer(this.posBuf);
      if (this.depthBuf) gl.deleteBuffer(this.depthBuf);
      if (this.lineIndexBuf) gl.deleteBuffer(this.lineIndexBuf);
    }
    this.gl = null;
    this.canvas = null;
    this.program = null;
    this.posBuf = null;
    this.depthBuf = null;
    this.lineIndexBuf = null;
    this.latest = null;
  }
}
