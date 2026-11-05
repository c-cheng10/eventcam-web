# Progress

## Status

- [x] Milestone 1: frames to events (synthetic scene and fake camera)
- [x] Milestone 2: periodic-motion detection, with an automated ±0.3 Hz test
- [x] Milestone 3: recording, CSV/binary export, explainer, README, Pages workflow
- [ ] Turn on Pages: Settings → Pages → Source: GitHub Actions
- [ ] Try it with a real webcam

## What works (verified in headless Chromium)

- Webcam through getUserMedia, timed with requestVideoFrameCallback (`captureTime`, then `mediaTime`, then the
  callback time), with rAF + performance.now() as the fallback.
- DVS model in typed arrays: log-luma lookup table, per-pixel reference level, one event per threshold crossing,
  refractory period, background-activity filter.
- Event view with decay, raw-input inset, and live stats (events/s, ON/OFF ratio, fps, processing time,
  filtered/s).
- Synthetic scene: rotating bar, squares at 2, 5 and 9 Hz, optional 22 Hz alias demo, selectable 30/60/120 fps.
- Frequency detector: 16 px cells, 3 s window, FFT every 250 ms, heatmap, cluster labels, dominant frequency,
  Nyquist readout. Measured 2.000 / 5.000 / 9.000 Hz at both 30 and 60 fps, and 22 Hz read as 8.00 Hz at 30 fps.
- Recording up to 5M events with a counter and progress bar; CSV, 9-byte binary and JSON sidecar exports.
  The README's NumPy loader was checked against an exported file.
- Layout checked at 1360 px and 390 px wide (no horizontal scroll).
- Processing time: about 3 ms per frame at 320 × 240 (synthetic), about 10 ms with the fake camera.

## Decisions

- The source is centre-cropped to 4:3 before scaling, so the working size is exactly 320 × 240 (or 160 × 120 or
  640 × 480).
- Synthetic frames are rendered at exact simulated times (fixed 1/fps steps, paced against real time), so the
  ground truth doesn't depend on browser timing.
- Events within a frame are spread over the part of the frame interval the refractory period allows, then
  quantised to 16 sub-frame slots. The stream is strictly time ordered, and the refractory period caps
  events per frame even when it's shorter than the frame interval.
- The noise filter runs after every pixel has been updated, so neighbours firing in the same frame count as support.
  Filtered events still move the pixel's reference level, since the filter sits after the sensor.
- The display is binary per frame (a pixel either fired or didn't), then decays. Drawing raw counts saturated
  fast edges and left long trails.
- The detector uses the integrated `ON − OFF` series, not total counts. Total counts read a blinking light at twice
  its real rate.
- Detector noise rejection: a cell needs at least max(150, 3 × frames) events in the window, and a peak sitting at
  the lowest searched frequency on a falling spectrum is ignored (integrated noise looks like that).
- Binary record order is `t_us, x, y, p` (9 bytes, packed). Polarity is +1/−1.
- A source or resolution change stops the recording, so one file never mixes coordinate systems.
- The webcam image isn't mirrored, so event x/y match the camera's own pixel grid.

## Known issues / not tested

- Never run with a physical webcam. Chromium's fake camera runs at 20 fps, and real cameras may report timestamps
  differently. If `captureTime` is missing or jumps, the code falls back to the callback time.
- The synthetic scene produces about 700k events/s, so it reaches the 5M recording cap in about 7 s. A real webcam
  scene usually produces far fewer.
- Exporting a full 5M-event CSV builds about 100 MB of text in memory. Fine on a laptop, but it may struggle on a phone.
- The CI test workflow can't be checked from the development session. Its first run on GitHub will show whether it
  passes.

## Next

- Try it with real webcams in Chrome, Firefox and Safari, and adjust the default C and noise filter.
- Optional: export a .zip with the .bin and .json together, and a click-to-inspect spectrum for one cell.
