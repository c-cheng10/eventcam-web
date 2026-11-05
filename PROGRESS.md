# PROGRESS

## Status
- [x] Milestone 1: frames -> events (synthetic mode + fake camera verified in headless Chromium)
- [ ] Milestone 2: periodic-motion detection
- [ ] Milestone 3: record/export, explainer, README, Pages deploy

## What works
- Webcam via getUserMedia; frames timed with requestVideoFrameCallback (captureTime -> mediaTime -> callback time),
  falling back to rAF + performance.now().
- DVS model in typed arrays: log-luma LUT, per-pixel reference, one event per threshold crossing,
  refractory period, background-activity filter (8-neighbour, configurable window).
- Event view with ON/OFF colours, exponential decay, raw-input inset, live stats.
- Synthetic scene: rotating two-armed bar + squares blinking at 2, 5, 9 Hz (+ optional 22 Hz alias demo).
- Headless test: `node tests/smoke.mjs` (synthetic ~2.5 ms/frame and fake camera ~10 ms/frame at 320x240).

## Decisions
- Source is centre-cropped to 4:3 before downscaling so the working resolution is exactly 320x240 etc.
- Synthetic frames are rendered at an exact simulated time (fixed 1/fps steps paced against real time),
  so frequency ground truth is exact and independent of the browser's rAF jitter.
- Events emitted in one frame are spread uniformly over the part of the frame interval the refractory
  period allows, then counting-sorted into 16 sub-frame slots so the recorded stream is time ordered.
  This also makes the refractory period meaningful below the frame interval (it caps events per frame).
- BA filter runs as a second pass after all pixels have been updated, so neighbours that fire in the same
  frame (to the right or below) count as support. Filtered events still update the pixel's reference
  (the filter sits downstream of the sensor, as in hardware).
- Display is binary per frame (pixel fired or not) then decays; accumulating raw counts saturated edges.
- Luma eps = 5 (8-bit units) so near-black pixels don't produce a storm of events.
- No mirroring of the webcam image: event x/y match the camera's own pixel grid.

## Known issues / not tested
- Not tested with a real webcam (cloud session has none). Chromium's fake device runs at 20 fps.
