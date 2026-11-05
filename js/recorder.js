// Event recorder and exporters.
//
// Binary format (little-endian, packed, 9 bytes per event):
//   uint32 t_us  microseconds since recording start
//   uint16 x
//   uint16 y
//   int8   p     +1 = ON, -1 = OFF
// A JSON sidecar carries resolution, C, start time and the dtype.

export const MAX_EVENTS = 5_000_000;
const RECORD_SIZE = 9;

export class Recorder {
  constructor() {
    this.recording = false;
    this.clear();
  }

  clear() {
    this.cap = 1 << 20;
    this.x = new Uint16Array(this.cap);
    this.y = new Uint16Array(this.cap);
    this.t = new Uint32Array(this.cap);
    this.p = new Int8Array(this.cap);
    this.n = 0;
    this.t0 = null;
    this.tLast = 0;
    this.meta = null;
    this.full = false;
  }

  start(pipeline, meta) {
    this.clear();
    this.recording = true;
    pipeline.dvs.emitList = true;
    this.meta = { ...meta, start_time_iso: new Date().toISOString(), start_time_unix_us: Date.now() * 1000 };
  }

  stop(pipeline) {
    this.recording = false;
    pipeline.dvs.emitList = false;
  }

  _grow(need) {
    let cap = this.cap;
    while (cap < need) cap *= 2;
    cap = Math.min(cap, MAX_EVENTS);
    for (const k of ['x', 'y', 't', 'p']) {
      const next = new this[k].constructor(cap);
      next.set(this[k].subarray(0, this.n));
      this[k] = next;
    }
    this.cap = cap;
  }

  // Pipeline listener hooks. A source or resolution change ends the recording,
  // so a file never mixes coordinate systems or clocks.
  reset(pipeline) { if (this.recording) { this.stop(pipeline); this.onAutoStop?.(); } }
  resize(pipeline) { this.reset(pipeline); }

  onFrame(pipeline, frameT, dt) {
    if (!this.recording) return;
    const d = pipeline.dvs;
    // Time zero is the start of the first recorded frame interval.
    if (this.t0 === null) this.t0 = frameT - dt;
    let m = d.nEvents;
    if (this.n + m > MAX_EVENTS) { m = MAX_EVENTS - this.n; this.full = true; }
    if (this.n + m > this.cap) this._grow(this.n + m);
    const { x, y, t, p } = this;
    const t0 = this.t0;
    for (let i = 0; i < m; i++) {
      const k = this.n + i;
      x[k] = d.evX[i];
      y[k] = d.evY[i];
      p[k] = d.evP[i];
      const us = Math.round((d.evT[i] - t0) * 1e6);
      t[k] = us > 0 ? us : 0;
    }
    this.n += m;
    if (m > 0) this.tLast = t[this.n - 1];
    if (this.full) { this.stop(pipeline); this.onAutoStop?.(); }
  }

  durationSec() { return this.tLast / 1e6; }

  sidecar() {
    return {
      format: 'eventcam-v1',
      record_size_bytes: RECORD_SIZE,
      byte_order: 'little-endian',
      fields: [
        { name: 't_us', type: 'uint32', unit: 'microseconds since start' },
        { name: 'x', type: 'uint16' },
        { name: 'y', type: 'uint16' },
        { name: 'p', type: 'int8', values: { '1': 'ON', '-1': 'OFF' } },
      ],
      numpy_dtype: [['t_us', '<u4'], ['x', '<u2'], ['y', '<u2'], ['p', 'i1']],
      num_events: this.n,
      duration_us: this.tLast,
      ...this.meta,
    };
  }

  toBinary() {
    const buf = new ArrayBuffer(this.n * RECORD_SIZE);
    const dv = new DataView(buf);
    for (let i = 0, o = 0; i < this.n; i++, o += RECORD_SIZE) {
      dv.setUint32(o, this.t[i], true);
      dv.setUint16(o + 4, this.x[i], true);
      dv.setUint16(o + 6, this.y[i], true);
      dv.setInt8(o + 8, this.p[i]);
    }
    return new Blob([buf], { type: 'application/octet-stream' });
  }

  toCSV() {
    const parts = ['x,y,t_us,p\n'];
    const CHUNK = 100_000;
    for (let s = 0; s < this.n; s += CHUNK) {
      const e = Math.min(this.n, s + CHUNK);
      let str = '';
      for (let i = s; i < e; i++) str += `${this.x[i]},${this.y[i]},${this.t[i]},${this.p[i]}\n`;
      parts.push(str);
    }
    return new Blob(parts, { type: 'text/csv' });
  }
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
