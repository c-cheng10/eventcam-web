// Periodic-motion detector.
//
// The image is split into cells (16x16 px by default). Every frame, each cell's
// net event count (ON - OFF) goes into a ring buffer covering ~3 s. Every
// ~250 ms each active cell's series is integrated (which reconstructs the cell's
// log-brightness in units of C), detrended, Hann-windowed, zero-padded and run
// through an FFT. The spectral peak gives the cell's frequency; the fraction of
// power in that peak gives its strength.
//
// Using net polarity, not total counts, matters: a blinking light fires ON on
// the rising edge and OFF on the falling edge, so total counts would show
// twice the real frequency.

import { fft, nextPow2 } from './fft.js';

export class PeriodicDetector {
  constructor({ windowSec = 3, maxFps = 130, minFreq = 0.7, minEvents = 150 } = {}) {
    this.windowSec = windowSec;
    this.maxFps = maxFps;
    this.minFreq = minFreq;
    this.minEvents = minEvents;
    this.strengthThreshold = 0.35;
    this.results = null;
  }

  resize(pipeline) {
    const { cols, rows } = pipeline.dvs;
    this.cols = cols;
    this.rows = rows;
    this.nCells = cols * rows;
    this.cap = Math.ceil(this.windowSec * this.maxFps) + 8;
    this.net = new Float32Array(this.nCells * this.cap);
    this.abs = new Float32Array(this.nCells * this.cap);
    this.times = new Float64Array(this.cap);
    this.freq = new Float32Array(this.nCells);
    this.strength = new Float32Array(this.nCells);
    this.activity = new Float32Array(this.nCells);
    this.reset();
  }

  reset() {
    this.head = 0;
    this.len = 0;
    this.freq?.fill(0);
    this.strength?.fill(0);
    this.activity?.fill(0);
    this.results = null;
  }

  onFrame(pipeline, t) {
    const { cellNet, cellAbs } = pipeline.dvs;
    const { cap, head, net, abs } = this;
    for (let c = 0; c < this.nCells; c++) {
      net[c * cap + head] = cellNet[c];
      abs[c * cap + head] = cellAbs[c];
    }
    this.times[head] = t;
    this.head = (head + 1) % cap;
    if (this.len < cap) this.len++;
  }

  analyze() {
    const { cap, times } = this;
    if (this.len < 16) return (this.results = null);
    const newest = (this.head - 1 + cap) % cap;
    const tNew = times[newest];
    // Walk back to find frames inside the window.
    let n = 0;
    while (n < this.len && tNew - times[(newest - n + cap) % cap] <= this.windowSec) n++;
    const oldest = (newest - n + 1 + cap) % cap;
    const span = tNew - times[oldest];
    if (n < 16 || span <= 0) return (this.results = null);
    const fs = (n - 1) / span;
    const nyquist = fs / 2;
    const N = Math.min(4096, nextPow2(Math.max(4 * n, 512)));
    const re = new Float64Array(N), im = new Float64Array(N);
    const series = new Float64Array(n);
    const hann = new Float64Array(n);
    for (let k = 0; k < n; k++) hann[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1));
    const kMin = Math.max(1, Math.ceil((this.minFreq / fs) * N));
    const kMax = N / 2 - 1;
    const lobe = Math.max(2, Math.round((2 * N) / n)); // Hann main-lobe half width in bins
    // Activity floor scales with frame count so sensor noise does not pass at high fps.
    const minAct = Math.max(this.minEvents, 3 * n);

    // Linear-detrend helpers.
    const xm = (n - 1) / 2;
    let sxx = 0;
    for (let k = 0; k < n; k++) sxx += (k - xm) * (k - xm);

    for (let c = 0; c < this.nCells; c++) {
      const base = c * cap;
      let act = 0, cum = 0, sum = 0;
      for (let k = 0; k < n; k++) {
        const idx = base + ((oldest + k) % cap);
        act += this.abs[idx];
        cum += this.net[idx];
        series[k] = cum;
        sum += cum;
      }
      this.activity[c] = act;
      if (act < minAct) { this.freq[c] = 0; this.strength[c] = 0; continue; }
      const mean = sum / n;
      let sxy = 0;
      for (let k = 0; k < n; k++) sxy += (k - xm) * (series[k] - mean);
      const slope = sxy / sxx;
      re.fill(0); im.fill(0);
      for (let k = 0; k < n; k++) re[k] = (series[k] - mean - slope * (k - xm)) * hann[k];
      fft(re, im);
      let total = 0, best = -1, bestP = 0;
      for (let k = 1; k <= kMax; k++) {
        const p = re[k] * re[k] + im[k] * im[k];
        re[k] = p; // reuse as power spectrum
        total += p;
      }
      for (let k = kMin; k <= kMax; k++) if (re[k] > bestP) { bestP = re[k]; best = k; }
      // Reject a "peak" that is just the bottom edge of a spectrum rising toward 0 Hz
      // (integrated noise is a random walk with a 1/f^2 spectrum).
      if (best < 0 || total <= 0 || (best === kMin && re[best - 1] >= re[best])) {
        this.freq[c] = 0; this.strength[c] = 0; continue;
      }
      let peakP = 0;
      for (let k = Math.max(1, best - lobe); k <= Math.min(kMax, best + lobe); k++) peakP += re[k];
      // Parabolic interpolation on log power for a sub-bin peak estimate.
      let delta = 0;
      if (best > 1 && best < kMax) {
        const a = Math.log(re[best - 1] + 1e-12), b = Math.log(re[best] + 1e-12), g = Math.log(re[best + 1] + 1e-12);
        const den = a - 2 * b + g;
        if (den < 0) delta = Math.max(-0.5, Math.min(0.5, 0.5 * (a - g) / den));
      }
      this.freq[c] = ((best + delta) * fs) / N;
      this.strength[c] = peakP / total;
    }

    this.results = { fs, nyquist, n, span, clusters: this._cluster() };
    return this.results;
  }

  // Group neighbouring cells with similar frequency into clusters (4-connected flood fill).
  _cluster() {
    const { cols, rows, freq, strength, activity } = this;
    const thr = this.strengthThreshold;
    const seen = new Uint8Array(this.nCells);
    const clusters = [];
    const stack = [];
    for (let s = 0; s < this.nCells; s++) {
      if (seen[s] || strength[s] < thr || freq[s] <= 0) continue;
      const cells = [];
      stack.push(s);
      seen[s] = 1;
      while (stack.length) {
        const c = stack.pop();
        cells.push(c);
        const x = c % cols, y = (c / cols) | 0;
        const nbs = [x > 0 ? c - 1 : -1, x < cols - 1 ? c + 1 : -1, y > 0 ? c - cols : -1, y < rows - 1 ? c + cols : -1];
        for (const nb of nbs) {
          if (nb < 0 || seen[nb] || strength[nb] < thr) continue;
          const tol = Math.max(0.4, 0.05 * freq[c]);
          if (Math.abs(freq[nb] - freq[c]) > tol) continue;
          seen[nb] = 1;
          stack.push(nb);
        }
      }
      let w = 0, fw = 0, cx = 0, cy = 0;
      for (const c of cells) {
        const wt = strength[c] * activity[c];
        w += wt; fw += wt * freq[c];
        cx += (c % cols) + 0.5; cy += ((c / cols) | 0) + 0.5;
      }
      clusters.push({ freq: fw / w, weight: w, cells: cells.length, cx: cx / cells.length, cy: cy / cells.length, members: cells });
    }
    clusters.sort((a, b) => b.weight - a.weight);
    return clusters;
  }

  cellAt(nx, ny) {
    const x = Math.min(this.cols - 1, Math.floor(nx * this.cols));
    const y = Math.min(this.rows - 1, Math.floor(ny * this.rows));
    const c = y * this.cols + x;
    return { freq: this.freq[c], strength: this.strength[c], activity: this.activity[c] };
  }
}
