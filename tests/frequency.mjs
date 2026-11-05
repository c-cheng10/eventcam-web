// Acceptance test: in synthetic mode the detected blink frequencies match ground truth within ±0.3 Hz.
import path from 'node:path';
import { setup, assert, OUT } from './helpers.mjs';

const TOL = 0.3;
const { page, base, errors, close } = await setup();

async function measure(query) {
  await page.goto(base + query);
  await page.waitForTimeout(5000); // 3 s window + margin
  return page.evaluate(() => {
    const { detector, synth } = window.__eventcam;
    const res = detector.analyze();
    return {
      fs: res?.fs, nyquist: res?.nyquist,
      squares: synth.squares().map((sq) => ({ truth: sq.freq, ...detector.cellAt(sq.cx, sq.cy) })),
      clusters: (res?.clusters || []).filter((c) => c.cells >= 2).map((c) => +c.freq.toFixed(2)),
    };
  });
}

try {
  for (const fps of [30, 60]) {
    console.log(`synthetic @ ${fps} fps`);
    const r = await measure(`?fps=${fps}`);
    console.log(`  fs=${r.fs?.toFixed(2)} nyquist=${r.nyquist?.toFixed(2)} clusters=${JSON.stringify(r.clusters)}`);
    for (const sq of r.squares) {
      assert(Math.abs(sq.freq - sq.truth) <= TOL,
        `${sq.truth} Hz square detected at ${sq.freq.toFixed(3)} Hz (strength ${sq.strength.toFixed(2)})`);
      assert(r.clusters.some((f) => Math.abs(f - sq.truth) <= TOL), `${sq.truth} Hz appears in the peak list`);
    }
    await page.screenshot({ path: path.join(OUT, `m2-freq-${fps}fps.png`) });
  }

  console.log('aliasing: 22 Hz square at 30 fps should read as |22 - 30| = 8 Hz');
  const r = await measure('?fps=30&alias=1');
  const alias = r.squares.find((s) => s.truth === 22);
  console.log(`  detected ${alias.freq.toFixed(3)} Hz`);
  assert(Math.abs(alias.freq - 8) <= TOL, '22 Hz square aliases to 8 Hz at 30 fps');
  await page.screenshot({ path: path.join(OUT, 'm2-alias.png') });

  assert(errors.length === 0, `no console errors (${errors.join(' | ')})`);
  console.log('PASS frequency');
} finally {
  await close();
}
