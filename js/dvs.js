// DVS (dynamic vision sensor) emulator.
//
// Per pixel: L = ln(Y + eps), with Y the 8-bit luma. Each pixel keeps a
// reference level `ref`. When L - ref >= C the pixel emits ON events, one per
// threshold crossing, and ref steps up by C for each event (OFF mirrors this).
// A per-pixel refractory period limits how often a pixel can fire, and an
// optional background-activity (BA) filter drops events whose 8 neighbours
// have not fired within a time window.
//
// All state lives in typed arrays. No per-pixel or per-event objects.

const LUMA_EPS = 5; // in 8-bit luma units; keeps dark pixels from exploding in log space
// Events inside a frame are spread over the frame interval and quantised to one of
// SLOTS sub-frame time slots, so the emitted stream is strictly time ordered.
const SLOTS = 16;

export class DVS {
  constructor(width, height) {
    this.C = 0.2; // contrast threshold (log units)
    this.refractory = 0.001; // seconds
    this.noiseFilter = true;
    this.baWindow = 0.04; // seconds
    this.emitList = false; // build a per-event list (only needed while recording)
    this.lut = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.lut[i] = Math.log(i + LUMA_EPS);
    this.resize(width, height);
  }

  resize(width, height, cellSize = 16) {
    this.w = width;
    this.h = height;
    const n = width * height;
    this.ref = new Float32Array(n);
    this.lastFire = new Float64Array(n).fill(-1e9);
    this.cand = new Int16Array(n); // signed candidate count this frame (pre-filter)
    this.te = new Float32Array(n); // fraction of the frame interval where emission may start
    this.on = new Uint8Array(n); // ON events this frame (post-filter)
    this.off = new Uint8Array(n); // OFF events this frame (post-filter)
    this.initialized = false;
    this.tPrev = 0;

    // Cell bookkeeping for the periodic-motion detector.
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.cellNet = new Float32Array(this.cols * this.rows);
    this.cellAbs = new Float32Array(this.cols * this.rows);
    this.cellOfX = new Uint16Array(width);
    for (let x = 0; x < width; x++) this.cellOfX[x] = Math.floor(x / cellSize);

    // Event list (time-sorted within the frame). Grows on demand.
    this._allocEvents(Math.max(65536, n));
    this.nEvents = 0;
    this.nOn = 0;
    this.nOff = 0;
    this.nFiltered = 0;
  }

  _allocEvents(cap) {
    this.evCap = cap;
    this.evX = new Uint16Array(cap);
    this.evY = new Uint16Array(cap);
    this.evP = new Int8Array(cap);
    this.evT = new Float64Array(cap);
    this._tmpX = new Uint16Array(cap);
    this._tmpY = new Uint16Array(cap);
    this._tmpP = new Int8Array(cap);
    this._tmpS = new Uint8Array(cap);
    this._tmpT = new Float64Array(cap);
  }

  reset() {
    this.initialized = false;
    this.lastFire.fill(-1e9);
  }

  // rgba: Uint8ClampedArray from getImageData (w*h*4). t: frame time in seconds.
  process(rgba, t) {
    const { w, h, ref, lastFire, cand, te, lut } = this;
    const n = w * h;
    const C = this.C;
    const invC = 1 / C;

    if (!this.initialized) {
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        ref[i] = lut[(77 * rgba[j] + 150 * rgba[j + 1] + 29 * rgba[j + 2]) >> 8];
      }
      this.on.fill(0);
      this.off.fill(0);
      this.cellNet.fill(0);
      this.cellAbs.fill(0);
      this.nEvents = this.nOn = this.nOff = this.nFiltered = 0;
      this.initialized = true;
      this.tPrev = t;
      return;
    }

    const tPrev = this.tPrev;
    const dt = Math.max(t - tPrev, 1e-6);
    const refr = this.refractory;

    // Pass 1: sensor model. Decide how many events each pixel fires this frame.
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const L = lut[(77 * rgba[j] + 150 * rgba[j + 1] + 29 * rgba[j + 2]) >> 8];
      const d = L - ref[i];
      let c = 0;
      if (d >= C || d <= -C) {
        // Earliest time this pixel may fire (refractory), clipped to the frame interval.
        const tEarliest = Math.max(tPrev, lastFire[i] + refr);
        if (tEarliest <= t) {
          let k = Math.floor((d > 0 ? d : -d) * invC);
          if (refr > 0) {
            const kmax = Math.max(1, Math.floor((t - tEarliest) / refr));
            if (k > kmax) k = kmax;
          }
          if (k > 255) k = 255;
          c = d > 0 ? k : -k;
          ref[i] += c * C;
          lastFire[i] = t;
          te[i] = (tEarliest - tPrev) / dt;
        }
      }
      cand[i] = c;
    }

    // Pass 2: background-activity filter, outputs, per-cell counts, event list.
    const on = this.on, off = this.off;
    const cellNet = this.cellNet, cellAbs = this.cellAbs, cellOfX = this.cellOfX;
    const cols = this.cols, cs = this.cellSize;
    cellNet.fill(0);
    cellAbs.fill(0);
    const filter = this.noiseFilter;
    const tSupport = t - this.baWindow;
    const wantList = this.emitList;
    let nOn = 0, nOff = 0, nFiltered = 0, m = 0;
    const slotCount = wantList ? new Uint32Array(SLOTS + 1) : null;

    for (let y = 0; y < h; y++) {
      const row = y * w;
      const cellRow = Math.floor(y / cs) * cols;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        const c = cand[i];
        on[i] = 0;
        off[i] = 0;
        if (c === 0) continue;
        if (filter) {
          let supported = false;
          const y0 = y > 0 ? y - 1 : 0, y1 = y < h - 1 ? y + 1 : y;
          const x0 = x > 0 ? x - 1 : 0, x1 = x < w - 1 ? x + 1 : x;
          for (let yy = y0; yy <= y1 && !supported; yy++) {
            const r = yy * w;
            for (let xx = x0; xx <= x1; xx++) {
              if ((xx !== x || yy !== y) && lastFire[r + xx] >= tSupport) { supported = true; break; }
            }
          }
          if (!supported) { nFiltered += c > 0 ? c : -c; continue; }
        }
        const k = c > 0 ? c : -c;
        if (c > 0) { on[i] = k; nOn += k; } else { off[i] = k; nOff += k; }
        const cell = cellRow + cellOfX[x];
        cellNet[cell] += c;
        cellAbs[cell] += k;

        if (wantList) {
          if (m + k > this.evCap) this._growEvents(m + k);
          // Spread the k events uniformly over (tEarliest, t].
          const f0 = te[i];
          const step = (1 - f0) / k;
          const p = c > 0 ? 1 : -1;
          for (let e = 1; e <= k; e++) {
            const frac = f0 + e * step;
            let s = (frac * SLOTS) | 0;
            if (s >= SLOTS) s = SLOTS - 1;
            this._tmpX[m] = x; this._tmpY[m] = y; this._tmpP[m] = p;
            this._tmpT[m] = tPrev + ((s + 1) / SLOTS) * dt; this._tmpS[m] = s;
            slotCount[s + 1]++;
            m++;
          }
        }
      }
    }

    if (wantList) {
      // Counting sort by sub-frame slot: all events in a slot share one timestamp.
      for (let s = 1; s <= SLOTS; s++) slotCount[s] += slotCount[s - 1];
      const { evX, evY, evP, evT, _tmpX, _tmpY, _tmpP, _tmpT, _tmpS } = this;
      for (let e = 0; e < m; e++) {
        const dst = slotCount[_tmpS[e]]++;
        evX[dst] = _tmpX[e]; evY[dst] = _tmpY[e]; evP[dst] = _tmpP[e]; evT[dst] = _tmpT[e];
      }
    }

    this.nEvents = wantList ? m : nOn + nOff;
    this.nOn = nOn;
    this.nOff = nOff;
    this.nFiltered = nFiltered;
    this.tPrev = t;
  }

  _growEvents(need) {
    let cap = this.evCap;
    while (cap < need) cap *= 2;
    const old = { x: this._tmpX, y: this._tmpY, p: this._tmpP, t: this._tmpT, s: this._tmpS };
    this._allocEvents(cap);
    this._tmpX.set(old.x); this._tmpY.set(old.y); this._tmpP.set(old.p);
    this._tmpT.set(old.t); this._tmpS.set(old.s);
  }
}
