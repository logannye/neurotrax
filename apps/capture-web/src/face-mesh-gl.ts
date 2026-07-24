import { FaceLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import {
  EMPTY_RESULT,
  FACE_MESH_LANDMARK_COUNT,
  type FaceMeshRenderer,
  type FaceMeshRenderInput,
  type FaceMeshRenderResult,
  type MeshDrawOptions
} from "./face-mesh-renderer.js";
import { depthToColor, normalizeDepth } from "./mesh-depth.js";
import {
  BLUR_FRAG,
  COMPOSITE_FRAG,
  MESH_FRAG,
  MESH_VERT,
  QUAD_VERT
} from "./face-mesh-gl-shaders.js";

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

// Brighter accent contours (eyes/brows/lips/oval/iris), flattened once the same
// way as TESS_INDICES. Drawn over the tessellation with a higher alpha so the
// feature outlines read through the bloom.
const CONTOUR_INDICES: number[] = [
  ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
  ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
  ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
  ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
  ...FaceLandmarker.FACE_LANDMARKS_LIPS,
  ...FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
  ...FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
  ...FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS
].flatMap((c) => [c.start, c.end]);

/** An offscreen color-texture render target: an FBO with a single RGBA8 color texture. */
interface RenderTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
}

// Bloom composite strength eases from a punchier peak (early localize) to a
// calmer resting glow once the mesh has settled (introProgress -> 1).
const BLOOM_REST_STRENGTH = 0.7;
const BLOOM_PEAK_STRENGTH = 1.5;

export class FaceMeshGLRenderer implements FaceMeshRenderer {
  private canvas: OffscreenCanvas | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private posBuf: WebGLBuffer | null = null;
  private depthBuf: WebGLBuffer | null = null;
  private lineIndexBuf: WebGLBuffer | null = null;
  private contourIndexBuf: WebGLBuffer | null = null;
  // Bloom pipeline: post-process programs, a no-op VAO for the fullscreen
  // triangle, the full-res scene target and two half-res ping-pong blur targets.
  private blurProgram: WebGLProgram | null = null;
  private compositeProgram: WebGLProgram | null = null;
  private quadVao: WebGLVertexArrayObject | null = null;
  private sceneTarget: RenderTarget | null = null;
  private blurTargets: RenderTarget[] = [];
  private fboWidth = 0;
  private fboHeight = 0;
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
      // Static contour index buffer (eyes/brows/lips/oval/iris), built the same
      // way as the tessellation buffer; shares the mesh's pos/depth attributes.
      this.contourIndexBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.contourIndexBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(CONTOUR_INDICES), gl.STATIC_DRAW);
      // Bloom setup lives inside this same try so a shader/FBO failure degrades
      // to attach()===false (the worker falls back to 2D) instead of throwing.
      this.blurProgram = link(gl, QUAD_VERT, BLUR_FRAG);
      this.compositeProgram = link(gl, QUAD_VERT, COMPOSITE_FRAG);
      this.quadVao = gl.createVertexArray();
      if (!this.quadVao) throw new Error("failed to create quad VAO");
      // Allocate placeholder targets now (validates the FBO-completeness path);
      // drawFrame reallocates them at the real canvas size on the first frame.
      this.allocTargets(gl, 1, 1);
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
      if (this.contourIndexBuf) gl.deleteBuffer(this.contourIndexBuf);
      if (this.blurProgram) gl.deleteProgram(this.blurProgram);
      if (this.compositeProgram) gl.deleteProgram(this.compositeProgram);
      if (this.quadVao) gl.deleteVertexArray(this.quadVao);
      this.freeTargets(gl);
      this.gl = null;
      this.canvas = null;
      this.program = null;
      this.posBuf = null;
      this.depthBuf = null;
      this.lineIndexBuf = null;
      this.contourIndexBuf = null;
      this.blurProgram = null;
      this.compositeProgram = null;
      this.quadVao = null;
      this.fboWidth = 0;
      this.fboHeight = 0;
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

  /** Create a LINEAR/CLAMP_TO_EDGE RGBA8 color texture wired to a fresh FBO. */
  private createTarget(gl: WebGL2RenderingContext, w: number, h: number): RenderTarget {
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) {
      if (tex) gl.deleteTexture(tex);
      if (fbo) gl.deleteFramebuffer(fbo);
      throw new Error("failed to allocate bloom render target");
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(tex);
      gl.deleteFramebuffer(fbo);
      throw new Error(`bloom render target incomplete: 0x${status.toString(16)}`);
    }
    return { fbo, tex };
  }

  private freeTarget(gl: WebGL2RenderingContext, t: RenderTarget): void {
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fbo);
  }

  private freeTargets(gl: WebGL2RenderingContext): void {
    if (this.sceneTarget) this.freeTarget(gl, this.sceneTarget);
    for (const t of this.blurTargets) this.freeTarget(gl, t);
    this.sceneTarget = null;
    this.blurTargets = [];
  }

  /**
   * (Re)allocate the scene target (full res) and both blur targets (half res).
   * New targets are built first; only on full success are the previous ones
   * freed and swapped in, so a mid-allocation failure leaves the old, valid
   * targets in place and never leaks the partial new ones.
   */
  private allocTargets(gl: WebGL2RenderingContext, width: number, height: number): void {
    const halfW = Math.max(1, Math.floor(width / 2));
    const halfH = Math.max(1, Math.floor(height / 2));
    let scene: RenderTarget | null = null;
    let b0: RenderTarget | null = null;
    let b1: RenderTarget | null = null;
    try {
      scene = this.createTarget(gl, width, height);
      b0 = this.createTarget(gl, halfW, halfH);
      b1 = this.createTarget(gl, halfW, halfH);
    } catch (err) {
      if (scene) this.freeTarget(gl, scene);
      if (b0) this.freeTarget(gl, b0);
      if (b1) this.freeTarget(gl, b1);
      throw err;
    }
    this.freeTargets(gl);
    this.sceneTarget = scene;
    this.blurTargets = [b0, b1];
    this.fboWidth = width;
    this.fboHeight = height;
  }

  drawFrame(
    nowMs: number,
    introProgress = 1,
    options?: MeshDrawOptions
  ): FaceMeshRenderResult {
    // Reduced motion forces a static frame; the governor's effectLevel (0..1)
    // sheds effects in order — bloom first, then hue drift last.
    const reducedMotion = options?.reducedMotion === true;
    const rawEffect = options?.effectLevel;
    const effectLevel =
      typeof rawEffect === "number" && Number.isFinite(rawEffect)
        ? Math.min(1, Math.max(0, rawEffect))
        : 1;
    // Shed order: bloom (below 0.33) -> hue freeze (~0).
    const applyBloom = effectLevel > 0.33;
    const freezeHue = reducedMotion || effectLevel <= 0.05;
    // Reduced motion collapses the intro so the mesh renders at its resting
    // scale/alpha/bloom with no animation.
    const introProgressEff = reducedMotion ? 1 : introProgress;
    const gl = this.gl;
    const canvas = this.canvas;
    const input = this.latest;
    if (
      !gl ||
      !canvas ||
      !this.program ||
      !this.blurProgram ||
      !this.compositeProgram ||
      !this.quadVao ||
      !input
    ) {
      return EMPTY_RESULT;
    }
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

    // Recreate render targets when the canvas size changes.
    if (this.fboWidth !== width || this.fboHeight !== height) {
      try {
        this.allocTargets(gl, width, height);
      } catch {
        // Keep the previous (valid) targets and skip this frame rather than
        // throw; the next frame retries the reallocation.
        return EMPTY_RESULT;
      }
    }
    const sceneTarget = this.sceneTarget;
    const blurTargets = this.blurTargets;
    if (!sceneTarget || blurTargets.length < 2) return EMPTY_RESULT;
    const halfW = Math.max(1, Math.floor(width / 2));
    const halfH = Math.max(1, Math.floor(height / 2));

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

    // Hue drift is the last effect the governor sheds (and is off under reduced
    // motion): a frozen hue holds the base palette with no time-varying shift.
    const hueShift = freezeHue ? 0 : (nowMs * 0.02) % 360;
    const near = depthToColor(1, hueShift);
    const far = depthToColor(0, hueShift);
    const alpha = introProgressEff; // fade in during localize

    // Intro scale-in: clip positions ease from 0.965 -> 1.0 as introProgress->1.
    const introP = Math.min(1, Math.max(0, introProgressEff));
    const uScaleVal = 0.965 + (1 - 0.965) * introP;

    // ---- Pass 1: draw the mesh into the full-res scene target (additive) ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTarget.fbo);
    gl.viewport(0, 0, width, height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // additive (premultiplied)
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(null); // mesh attributes live on the default VAO

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
    // uTime drives the per-vertex twinkle; zeroed under reduced motion so the
    // shimmer holds a static phase instead of animating.
    gl.uniform1f(
      gl.getUniformLocation(this.program, "uTime"),
      reducedMotion ? 0 : nowMs * 0.001
    );
    gl.uniform1f(gl.getUniformLocation(this.program, "uScale"), uScaleVal);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineIndexBuf);
    gl.drawElements(gl.LINES, TESS_INDICES.length, gl.UNSIGNED_SHORT, 0);
    gl.drawArrays(gl.POINTS, 0, n);

    // Brighter feature contours over the tessellation, same additive scene pass
    // so they bloom; they reuse the mesh's already-bound pos/depth attributes.
    gl.uniform1f(gl.getUniformLocation(this.program, "uAlpha"), Math.min(1, alpha * 1.8));
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.contourIndexBuf);
    gl.drawElements(gl.LINES, CONTOUR_INDICES.length, gl.UNSIGNED_SHORT, 0);

    // ---- Post-process: optional bloom blur, then composite ----
    // The fullscreen triangle uses no attributes, so bind the quad VAO up front
    // for both the (optional) blur and the always-run composite. Each fullscreen
    // pass fully overwrites its target, so disable blending here.
    gl.bindVertexArray(this.quadVao);
    gl.disable(gl.BLEND);

    // Pass 2: separable Gaussian blur (half res). Skipped once the governor has
    // shed bloom — the composite below then draws the scene straight.
    if (applyBloom) {
      gl.viewport(0, 0, halfW, halfH);
      gl.useProgram(this.blurProgram);
      const uTexel = gl.getUniformLocation(this.blurProgram, "uTexel");
      const uDir = gl.getUniformLocation(this.blurProgram, "uDir");
      const uTex = gl.getUniformLocation(this.blurProgram, "uTex");
      gl.uniform1i(uTex, 0);
      gl.uniform2f(uTexel, 1 / halfW, 1 / halfH);
      gl.activeTexture(gl.TEXTURE0);

      // Horizontal: scene.tex -> blurTargets[0]
      gl.bindFramebuffer(gl.FRAMEBUFFER, blurTargets[0].fbo);
      gl.bindTexture(gl.TEXTURE_2D, sceneTarget.tex);
      gl.uniform2f(uDir, 1, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Vertical: blurTargets[0].tex -> blurTargets[1]
      gl.bindFramebuffer(gl.FRAMEBUFFER, blurTargets[1].fbo);
      gl.bindTexture(gl.TEXTURE_2D, blurTargets[0].tex);
      gl.uniform2f(uDir, 0, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ---- Pass 3: composite scene + bloom to the default framebuffer ----
    // When bloom is shed, strength is 0 so the (stale but valid) bloom texture
    // contributes nothing and the scene is drawn straight.
    const p = Math.min(1, Math.max(0, introProgressEff));
    const bloomStrength = applyBloom
      ? BLOOM_REST_STRENGTH + (BLOOM_PEAK_STRENGTH - BLOOM_REST_STRENGTH) * (1 - p)
      : 0;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied over
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.compositeProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTarget.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blurTargets[1].tex);
    gl.uniform1i(gl.getUniformLocation(this.compositeProgram, "uScene"), 0);
    gl.uniform1i(gl.getUniformLocation(this.compositeProgram, "uBloom"), 1);
    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, "uBloomStrength"), bloomStrength);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0); // leave unit 0 active for the next frame

    return { rendered: true, landmarkDots: dots, tessellationEdges: TESS_INDICES.length / 2, accentAnchors: 0 };
  }

  clear(): void {
    const { gl, canvas } = this;
    if (gl && canvas) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
      if (this.contourIndexBuf) gl.deleteBuffer(this.contourIndexBuf);
      if (this.blurProgram) gl.deleteProgram(this.blurProgram);
      if (this.compositeProgram) gl.deleteProgram(this.compositeProgram);
      if (this.quadVao) gl.deleteVertexArray(this.quadVao);
      this.freeTargets(gl);
    }
    this.gl = null;
    this.canvas = null;
    this.program = null;
    this.posBuf = null;
    this.depthBuf = null;
    this.lineIndexBuf = null;
    this.contourIndexBuf = null;
    this.blurProgram = null;
    this.compositeProgram = null;
    this.quadVao = null;
    this.sceneTarget = null;
    this.blurTargets = [];
    this.fboWidth = 0;
    this.fboHeight = 0;
    this.latest = null;
  }
}
