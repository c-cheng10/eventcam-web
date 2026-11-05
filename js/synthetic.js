// Synthetic video source: a deterministic scene rendered at an exact simulated
// time. A rotating two-armed bar (a slow "propeller") and squares blinking at
// known frequencies, plus a little sensor-like noise. Frames are fed straight
// into the pipeline with their simulated timestamps, so the ground truth is exact.

export const SYNTH_W = 640;
export const SYNTH_H = 480;

// Positions are normalised (0..1). `size` is a fraction of the width.
export const SYNTH_SQUARES = [
  { cx: 0.6, cy: 0.27, size: 0.14, freq: 2 },
  { cx: 0.8, cy: 0.27, size: 0.14, freq: 5 },
  { cx: 0.6, cy: 0.66, size: 0.14, freq: 9 },
];
// Optional square above the Nyquist limit of a 30 fps camera (aliasing demo).
export const SYNTH_ALIAS_SQUARE = { cx: 0.8, cy: 0.66, size: 0.14, freq: 22, alias: true };
export const SYNTH_BAR = { cx: 0.25, cy: 0.5, halfLen: 0.2, thick: 0.028, revPerSec: 0.6 };

export class SyntheticSource {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SYNTH_W;
    this.canvas.height = SYNTH_H;
    this.canvas.className = 'inset-media';
    this.ctx = this.canvas.getContext('2d');
    this.noiseAmount = 0.5; // alpha of the speckle layer
    this.showAlias = false;
    this.fps = 30;

    // Pre-generated noise texture, drawn with a random offset each frame.
    const nc = document.createElement('canvas');
    nc.width = nc.height = 256;
    const nctx = nc.getContext('2d');
    const img = nctx.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      // Sparse salt-and-pepper speckles: isolated noise events for the BA filter to remove.
      const r = Math.random();
      const v = r < 0.002 ? 255 : 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = r < 0.004 ? 255 : 0;
    }
    nctx.putImageData(img, 0, 0);
    this.noise = nc;

    // Static background: dim vignette and some texture (static -> no events).
    const bgc = document.createElement('canvas');
    bgc.width = SYNTH_W;
    bgc.height = SYNTH_H;
    const b = bgc.getContext('2d');
    const grad = b.createRadialGradient(SYNTH_W / 2, SYNTH_H / 2, 50, SYNTH_W / 2, SYNTH_H / 2, 420);
    grad.addColorStop(0, '#2a2d31');
    grad.addColorStop(1, '#16181b');
    b.fillStyle = grad;
    b.fillRect(0, 0, SYNTH_W, SYNTH_H);
    b.strokeStyle = 'rgba(255,255,255,0.04)';
    for (let x = 0; x < SYNTH_W; x += 40) { b.beginPath(); b.moveTo(x, 0); b.lineTo(x, SYNTH_H); b.stroke(); }
    for (let y = 0; y < SYNTH_H; y += 40) { b.beginPath(); b.moveTo(0, y); b.lineTo(SYNTH_W, y); b.stroke(); }
    this.bg = bgc;
  }

  squares() {
    return this.showAlias ? [...SYNTH_SQUARES, SYNTH_ALIAS_SQUARE] : SYNTH_SQUARES;
  }

  // Render the scene at simulated time t (seconds).
  render(t) {
    const ctx = this.ctx;
    const W = SYNTH_W, H = SYNTH_H;
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.bg, 0, 0);

    // Rotating two-armed bar.
    const bar = SYNTH_BAR;
    const ang = 2 * Math.PI * bar.revPerSec * t;
    ctx.save();
    ctx.translate(bar.cx * W, bar.cy * H);
    ctx.rotate(ang);
    ctx.fillStyle = '#e6e6e6';
    const L = bar.halfLen * W, T = bar.thick * W;
    ctx.fillRect(-L, -T / 2, 2 * L, T);
    ctx.beginPath();
    ctx.arc(0, 0, T * 0.9, 0, 2 * Math.PI);
    ctx.fillStyle = '#9a9a9a';
    ctx.fill();
    ctx.restore();

    // Blinking squares: 50% duty square waves.
    ctx.font = '600 15px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    for (const sq of this.squares()) {
      const lit = ((sq.freq * t) % 1 + 1) % 1 < 0.5;
      const s = sq.size * W;
      const x = sq.cx * W - s / 2, y = sq.cy * H - s / 2;
      ctx.fillStyle = lit ? '#d2d2d2' : '#2c2c2c';
      ctx.fillRect(x, y, s, s);
      ctx.strokeStyle = '#555';
      ctx.strokeRect(x - 3.5, y - 3.5, s + 7, s + 7);
      ctx.fillStyle = sq.alias ? '#ff8a3d' : '#9aa4ae';
      ctx.fillText(`${sq.freq} Hz`, sq.cx * W, y + s + 22);
    }

    // Noise: random-offset speckle texture, nearest-neighbour scaled 2x.
    if (this.noiseAmount > 0) {
      ctx.globalAlpha = this.noiseAmount;
      ctx.imageSmoothingEnabled = false;
      const ox = -2 * Math.floor(Math.random() * 128), oy = -2 * Math.floor(Math.random() * 128);
      for (let y = oy; y < H; y += 512) {
        for (let x = ox; x < W; x += 512) ctx.drawImage(this.noise, x, y, 512, 512);
      }
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = true;
    }
  }
}
