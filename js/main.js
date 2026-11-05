// UI wiring and frame scheduling.

import { Pipeline } from './pipeline.js';
import { SyntheticSource, SYNTH_W, SYNTH_H } from './synthetic.js';
import { PeriodicDetector } from './periodic.js';
import { drawOverlay, turbo, turboGradient } from './overlay.js';

const $ = (id) => document.getElementById(id);
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');

const eventCanvas = $('events');
const pipeline = new Pipeline(eventCanvas);
const synth = new SyntheticSource();
const detector = new PeriodicDetector();
pipeline.listeners.push(detector);
detector.resize(pipeline);

const state = {
  mode: 'none', // 'synthetic' | 'camera'
  stream: null,
  video: null,
  runId: 0, // bumps on every source switch; stale loops check it and exit
  clock: '-',
};

// ---------- sources ----------

function setInset(el) {
  const inset = $('inset');
  inset.replaceChildren(el);
}

function startSynthetic(message) {
  stopCamera();
  const run = ++state.runId;
  state.mode = 'synthetic';
  state.clock = 'simulated';
  pipeline.reset();
  setInset(synth.canvas);
  $('sourceBadge').textContent = 'synthetic';
  $('synthOpts').hidden = false;
  $('btnSynth').classList.add('active');
  $('btnCamera').classList.remove('active');
  setStatus(message || 'Synthetic scene running: a rotating bar and squares blinking at 2, 5 and 9 Hz.');

  // Simulated clock advanced in fixed steps of 1/fps, paced against real time.
  let simT = 0;
  let realStart = null;
  let frames = 0;
  const tick = (now) => {
    if (run !== state.runId) return;
    if (realStart === null) realStart = now;
    const dt = 1 / synth.fps;
    let steps = 0;
    // Catch up to real time, but never more than 4 frames per tick (falls behind gracefully).
    while ((frames + 1) * dt <= (now - realStart) / 1000 && steps < 4) {
      frames++;
      simT = frames * dt;
      synth.render(simT);
      pipeline.process(synth.canvas, SYNTH_W, SYNTH_H, simT);
      steps++;
    }
    if (steps === 4) realStart = now - frames * dt * 1000; // drop the backlog
    requestAnimationFrame(tick);
  };
  synth.render(0);
  pipeline.process(synth.canvas, SYNTH_W, SYNTH_H, 0);
  requestAnimationFrame(tick);
}

function stopCamera() {
  if (state.stream) {
    for (const tr of state.stream.getTracks()) tr.stop();
    state.stream = null;
  }
  if (state.video) {
    state.video.srcObject = null;
    state.video = null;
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    startSynthetic('This browser has no camera API (getUserMedia needs HTTPS). Showing the synthetic scene.');
    setStatus($('status').textContent, true);
    return;
  }
  setStatus('Requesting camera access…');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } },
      audio: false,
    });
  } catch (err) {
    startSynthetic(`Camera unavailable (${err.name}). Showing the synthetic scene instead.`);
    setStatus($('status').textContent, true);
    return;
  }
  stopCamera();
  const run = ++state.runId;
  state.mode = 'camera';
  state.stream = stream;
  const video = document.createElement('video');
  video.className = 'inset-media';
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.srcObject = stream;
  state.video = video;
  setInset(video);
  pipeline.reset();
  $('sourceBadge').textContent = 'webcam';
  $('synthOpts').hidden = true;
  $('btnCamera').classList.add('active');
  $('btnSynth').classList.remove('active');
  try { await video.play(); } catch { /* autoplay with muted video should not fail */ }
  const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
  setStatus(`Webcam: ${settings.width || video.videoWidth}×${settings.height || video.videoHeight}` +
    (settings.frameRate ? ` @ ${Math.round(settings.frameRate)} fps` : '') + '. Processed locally.');

  let tOrigin = null;
  let lastRaw = -Infinity;
  const toSeconds = (raw) => {
    if (tOrigin === null) tOrigin = raw;
    return (raw - tOrigin) / 1000;
  };

  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const onFrame = (now, meta) => {
      if (run !== state.runId) return;
      // Prefer the capture timestamp; fall back to media time, then callback time.
      let raw, clock;
      if (typeof meta.captureTime === 'number' && meta.captureTime > 0) { raw = meta.captureTime; clock = 'captureTime'; }
      else if (typeof meta.mediaTime === 'number' && meta.mediaTime > 0) { raw = meta.mediaTime * 1000; clock = 'mediaTime'; }
      else { raw = now; clock = 'rVFC now'; }
      if (raw <= lastRaw) { raw = now; clock = 'rVFC now'; tOrigin = null; } // non-monotonic source: reset origin
      lastRaw = raw;
      state.clock = clock;
      if (video.videoWidth) pipeline.process(video, video.videoWidth, video.videoHeight, toSeconds(raw));
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  } else {
    state.clock = 'rAF + performance.now()';
    const onRaf = () => {
      if (run !== state.runId) return;
      if (video.readyState >= 2 && video.videoWidth) {
        pipeline.process(video, video.videoWidth, video.videoHeight, toSeconds(performance.now()));
      }
      requestAnimationFrame(onRaf);
    };
    requestAnimationFrame(onRaf);
  }
}

function setStatus(msg, isErr = false) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('err', isErr);
}

// ---------- controls ----------

function bindSlider(id, outId, fmt, apply) {
  const input = $(id), out = $(outId);
  const update = () => { const v = parseFloat(input.value); out.textContent = fmt(v); apply(v); };
  input.addEventListener('input', update);
  update();
}

bindSlider('cC', 'oC', (v) => v.toFixed(2), (v) => { pipeline.dvs.C = v; });
bindSlider('cRefr', 'oRefr', (v) => `${v} ms`, (v) => { pipeline.dvs.refractory = v / 1000; });
bindSlider('cBA', 'oBA', (v) => `${v} ms`, (v) => { pipeline.dvs.baWindow = v / 1000; });
bindSlider('cDecay', 'oDecay', (v) => (v === 0 ? 'off' : `${v} ms`), (v) => { pipeline.renderer.tau = v / 1000; });

bindSlider('cStrength', 'oStrength', (v) => v.toFixed(2), (v) => { detector.strengthThreshold = v; });
$('cHeat').addEventListener('change', () => refreshFrequency());
$('colorbar').style.background = turboGradient();

$('cNoise').addEventListener('change', (e) => { pipeline.dvs.noiseFilter = e.target.checked; });
$('cInset').addEventListener('change', (e) => { $('inset').classList.toggle('hidden', !e.target.checked); });
$('resolution').addEventListener('change', (e) => {
  const [w, h] = e.target.value.split('x').map(Number);
  pipeline.setResolution(w, h);
});
$('synthFps').addEventListener('change', (e) => { synth.fps = Number(e.target.value); pipeline.reset(); });
$('aliasToggle').addEventListener('change', (e) => { synth.showAlias = e.target.checked; });
$('btnCamera').addEventListener('click', () => startCamera());
$('btnSynth').addEventListener('click', () => startSynthetic());

// ---------- stats ----------

setInterval(() => {
  const s = pipeline.stats.summary();
  $('sEvps').textContent = fmtInt(s.evps);
  $('sRatio').textContent = Number.isFinite(s.ratio) ? s.ratio.toFixed(2) : (s.ratio === Infinity ? '∞' : '-');
  $('sFps').textContent = s.fps ? s.fps.toFixed(1) : '-';
  $('sMs').textContent = s.ms ? `${s.ms.toFixed(1)} ms` : '-';
  $('sFilt').textContent = pipeline.dvs.noiseFilter ? fmtInt(s.filtps) : 'off';
}, 500);

// ---------- periodic-motion readout ----------

function refreshFrequency() {
  const res = detector.analyze();
  drawOverlay($('overlay'), detector, res, $('cHeat').checked);
  if (!res) {
    $('fDominant').textContent = '-';
    $('fNyquist').textContent = '-';
    $('fPeaks').replaceChildren();
    return;
  }
  const nyq = res.nyquist;
  $('fNyquist').textContent = `${nyq.toFixed(1)} Hz`;
  $('cbMid').textContent = `${(nyq / 2).toFixed(1)} Hz`;
  $('cbMax').textContent = `${nyq.toFixed(1)} Hz`;
  const top = res.clusters.filter((c) => c.cells >= 2);
  $('fDominant').textContent = top.length ? `${top[0].freq.toFixed(2)} Hz` : 'none';
  $('fPeaks').replaceChildren(...top.slice(0, 6).map((c) => {
    const el = document.createElement('span');
    el.className = 'peak';
    const sw = document.createElement('i');
    const [r, g, b] = turbo(c.freq / nyq);
    sw.style.background = `rgb(${r},${g},${b})`;
    el.append(sw, `${c.freq.toFixed(2)} Hz · ${c.cells} cells`);
    return el;
  }));
}
setInterval(refreshFrequency, 250);
window.addEventListener('resize', () => drawOverlay($('overlay'), detector, detector.results, $('cHeat').checked));

// ---------- boot ----------

const params = new URLSearchParams(location.search);
if (params.get('fps')) { synth.fps = Number(params.get('fps')); $('synthFps').value = String(synth.fps); }
if (params.get('alias') === '1') { synth.showAlias = true; $('aliasToggle').checked = true; }
if (params.get('source') === 'camera') startCamera();
else startSynthetic();

// Test/debug hook.
window.__eventcam = { pipeline, synth, state, detector };
