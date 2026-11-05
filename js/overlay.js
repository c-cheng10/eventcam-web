// Frequency heatmap overlay and colour scale.

// Turbo colormap, polynomial approximation (Mikhailov, Google 2019). t in [0, 1].
export function turbo(t) {
  t = Math.min(1, Math.max(0, t));
  const r = 0.13572138 + t * (4.6153926 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))));
  const g = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))));
  const b = 0.1066733 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))));
  const c = (v) => Math.round(255 * Math.min(1, Math.max(0, v)));
  return [c(r), c(g), c(b)];
}

export function turboGradient(steps = 12) {
  const stops = [];
  for (let i = 0; i <= steps; i++) {
    const [r, g, b] = turbo(i / steps);
    stops.push(`rgb(${r},${g},${b}) ${((i / steps) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export function drawOverlay(canvas, detector, results, enabled) {
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.round(canvas.clientWidth * dpr), ch = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, cw, ch);
  if (!enabled || !results) return;
  const { cols, rows, freq, strength } = detector;
  const thr = detector.strengthThreshold;
  const cellW = cw / cols, cellH = ch / rows;
  const fmax = results.nyquist;
  for (let c = 0; c < cols * rows; c++) {
    if (strength[c] < thr || freq[c] <= 0) continue;
    const [r, g, b] = turbo(freq[c] / fmax);
    const a = 0.25 + 0.35 * Math.min(1, (strength[c] - thr) / (1 - thr));
    const x = (c % cols) * cellW, y = ((c / cols) | 0) * cellH;
    ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
    ctx.fillRect(x, y, cellW, cellH);
    ctx.strokeStyle = `rgba(${r},${g},${b},0.9)`;
    ctx.lineWidth = dpr;
    ctx.strokeRect(x + 0.5 * dpr, y + 0.5 * dpr, cellW - dpr, cellH - dpr);
  }
  // Label clusters at their centroid.
  const fontPx = Math.round(Math.max(11, Math.min(16, cw / 60)) * dpr);
  ctx.font = `600 ${fontPx}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const cl of results.clusters.slice(0, 8)) {
    if (cl.cells < 2) continue;
    const label = `${cl.freq.toFixed(1)} Hz`;
    const x = cl.cx * cellW, y = cl.cy * cellH;
    const tw = ctx.measureText(label).width + 10 * dpr;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x - tw / 2, y - fontPx * 0.75, tw, fontPx * 1.5);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x, y);
  }
}
