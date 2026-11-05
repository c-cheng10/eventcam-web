// Event-view renderer: per-pixel ON/OFF accumulators with exponential decay,
// composited additively onto a dark background into an RGBA ImageData.

export const ON_RGB = [76, 201, 240]; // #4cc9f0
export const OFF_RGB = [255, 138, 61]; // #ff8a3d
const BG_RGB = [9, 11, 14];

export class EventRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tau = 0.06; // decay time constant (s); 0 = show only the latest frame
    this.gain = 1; // brightness of a pixel that fired in the current frame
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.accOn = new Float32Array(w * h);
    this.accOff = new Float32Array(w * h);
    this.img = this.ctx.createImageData(w, h);
    this.px = new Uint32Array(this.img.data.buffer);
    // 256-level lookup tables: intensity level -> channel contribution.
    this.lutOn = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
    this.lutOff = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
    for (let v = 0; v < 256; v++) {
      for (let c = 0; c < 3; c++) {
        this.lutOn[c][v] = Math.round((ON_RGB[c] - 0) * v / 255);
        this.lutOff[c][v] = Math.round((OFF_RGB[c] - 0) * v / 255);
      }
    }
    this.clear();
  }

  clear() {
    this.accOn.fill(0);
    this.accOff.fill(0);
    this.px.fill(0xff000000 | (BG_RGB[2] << 16) | (BG_RGB[1] << 8) | BG_RGB[0]);
    this.draw();
  }

  update(on, off, dt) {
    const f = this.tau > 0 ? Math.exp(-dt / this.tau) : 0;
    const { accOn, accOff, px, gain } = this;
    const [onR, onG, onB] = this.lutOn;
    const [offR, offG, offB] = this.lutOff;
    const n = accOn.length;
    const br = BG_RGB[0], bg = BG_RGB[1], bb = BG_RGB[2];
    for (let i = 0; i < n; i++) {
      // Binary per frame: a pixel that fired is fully lit, then decays. Counting every
      // event would saturate fast edges and leave long trails.
      const a = on[i] ? 1 : accOn[i] * f;
      const b = off[i] ? 1 : accOff[i] * f;
      accOn[i] = a;
      accOff[i] = b;
      let va = (a * gain * 255) | 0; if (va > 255) va = 255;
      let vb = (b * gain * 255) | 0; if (vb > 255) vb = 255;
      let r = br + onR[va] + offR[vb]; if (r > 255) r = 255;
      let g = bg + onG[va] + offG[vb]; if (g > 255) g = 255;
      let bl = bb + onB[va] + offB[vb]; if (bl > 255) bl = 255;
      px[i] = 0xff000000 | (bl << 16) | (g << 8) | r;
    }
    this.draw();
  }

  draw() {
    this.ctx.putImageData(this.img, 0, 0);
  }
}
