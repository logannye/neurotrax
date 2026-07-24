// Deterministic mulberry32 PRNG so motes are reproducible (no Math.random).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Mote { x: number; y: number; vy: number; life: number; }

export class MoteField {
  private motes: Mote[] = [];
  private rng = mulberry32(0x9e3779b9);
  private pos: Float32Array;
  private alpha: Float32Array;

  constructor(private readonly capacity: number) {
    this.pos = new Float32Array(capacity * 2);
    this.alpha = new Float32Array(capacity);
  }

  update(
    dtMs: number,
    spawn: (index: number) => { x: number; y: number; depth: number },
    seedNodeCount: number
  ): void {
    const dt = dtMs / 1000;
    if (this.motes.length < this.capacity && this.rng() < 0.6) {
      const idx = Math.floor(this.rng() * Math.max(1, seedNodeCount));
      const s = spawn(idx);
      // clip space: x,y in -1..1
      this.motes.push({ x: s.x * 2 - 1, y: 1 - s.y * 2, vy: 0.15 + this.rng() * 0.35, life: 1 });
    }
    for (let i = this.motes.length - 1; i >= 0; i -= 1) {
      const m = this.motes[i];
      m.y += m.vy * dt; // drift up (clip y increases upward)
      m.life -= dt * 0.7;
      if (m.life <= 0) this.motes.splice(i, 1);
    }
    this.pos.fill(0);
    this.alpha.fill(0);
    for (let i = 0; i < this.motes.length && i < this.capacity; i += 1) {
      this.pos[i * 2] = this.motes[i].x;
      this.pos[i * 2 + 1] = this.motes[i].y;
      this.alpha[i] = Math.max(0, Math.min(1, this.motes[i].life));
    }
  }

  positions(): Float32Array { return this.pos; }
  alphas(): Float32Array { return this.alpha; }
  count(): number { return Math.min(this.motes.length, this.capacity); }
}
