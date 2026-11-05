// Frame pipeline: source (video or canvas) -> downscaled canvas -> DVS ->
// renderer, detector, recorder, stats.

import { DVS } from './dvs.js';
import { EventRenderer } from './render.js';

export class Pipeline {
  constructor(eventCanvas) {
    this.work = document.createElement('canvas');
    this.wctx = this.work.getContext('2d', { willReadFrequently: true });
    this.dvs = new DVS(320, 240);
    this.renderer = new EventRenderer(eventCanvas);
    this.listeners = []; // called after each processed frame: fn(pipeline, t)
    this.stats = new Stats();
    this.setResolution(320, 240);
  }

  setResolution(w, h) {
    this.w = w;
    this.h = h;
    this.work.width = w;
    this.work.height = h;
    this.dvs.resize(w, h);
    this.renderer.resize(w, h);
    this.lastT = null;
    this.stats.reset();
    for (const l of this.listeners) l.resize?.(this);
  }

  reset() {
    this.dvs.reset();
    this.renderer.clear();
    this.lastT = null;
    this.stats.reset();
    for (const l of this.listeners) l.reset?.(this);
  }

  // Process one frame. srcW/srcH are the source's intrinsic size. t in seconds.
  process(source, srcW, srcH, t) {
    if (this.lastT !== null && t <= this.lastT) return; // duplicate or out-of-order frame
    const t0 = performance.now();
    const { w, h } = this;
    // Centre-crop the source to the working aspect ratio, then downscale.
    const targetAR = w / h, srcAR = srcW / srcH;
    let sx = 0, sy = 0, sw = srcW, sh = srcH;
    if (srcAR > targetAR) { sw = srcH * targetAR; sx = (srcW - sw) / 2; }
    else if (srcAR < targetAR) { sh = srcW / targetAR; sy = (srcH - sh) / 2; }
    this.wctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
    const img = this.wctx.getImageData(0, 0, w, h);

    const dvs = this.dvs;
    const first = !dvs.initialized;
    dvs.process(img.data, t);
    const dt = this.lastT === null ? 0 : t - this.lastT;
    this.renderer.update(dvs.on, dvs.off, dt);
    if (!first) for (const l of this.listeners) l.onFrame?.(this, t, dt);
    this.lastT = t;
    this.stats.push(t, dvs.nOn, dvs.nOff, dvs.nFiltered, performance.now() - t0);
  }
}

// Rolling statistics over the last ~1 s of frames.
class Stats {
  constructor() { this.reset(); }
  reset() { this.frames = []; }
  push(t, on, off, filtered, ms) {
    this.frames.push({ t, on, off, filtered, ms });
    while (this.frames.length > 2 && t - this.frames[0].t > 1.0) this.frames.shift();
  }
  summary() {
    const f = this.frames;
    if (f.length < 2) return { fps: 0, evps: 0, onps: 0, offps: 0, ratio: NaN, ms: 0, filtps: 0 };
    const span = f[f.length - 1].t - f[0].t;
    let on = 0, off = 0, filt = 0, ms = 0;
    for (let i = 1; i < f.length; i++) { on += f[i].on; off += f[i].off; filt += f[i].filtered; }
    for (const x of f) ms += x.ms;
    return {
      fps: (f.length - 1) / span,
      evps: (on + off) / span,
      onps: on / span,
      offps: off / span,
      filtps: filt / span,
      ratio: off > 0 ? on / off : (on > 0 ? Infinity : NaN),
      ms: ms / f.length,
    };
  }
}
