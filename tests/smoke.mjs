// Milestone 1 smoke test: synthetic mode and the fake camera both produce events.
import path from 'node:path';
import { setup, assert, OUT } from './helpers.mjs';

const { page, base, errors, close } = await setup();
try {
  console.log('synthetic mode');
  await page.goto(base);
  await page.waitForTimeout(2500);
  let s = await page.evaluate(() => window.__eventcam.pipeline.stats.summary());
  console.log('  stats', JSON.stringify(s));
  assert(s.fps > 20, `synthetic fps ${s.fps.toFixed(1)} > 20`);
  assert(s.evps > 1000, `synthetic events/s ${Math.round(s.evps)} > 1000`);
  assert(s.onps > 0 && s.offps > 0, 'both polarities present');
  await page.screenshot({ path: path.join(OUT, 'm1-synthetic.png') });

  console.log('fake camera');
  await page.click('#btnCamera');
  await page.waitForTimeout(3000);
  s = await page.evaluate(() => window.__eventcam.pipeline.stats.summary());
  const st = await page.evaluate(() => ({ mode: window.__eventcam.state.mode, clock: window.__eventcam.state.clock, status: document.getElementById('status').textContent }));
  console.log('  stats', JSON.stringify(s), JSON.stringify(st));
  assert(st.mode === 'camera', 'camera mode active');
  assert(s.fps > 10, `camera fps ${s.fps.toFixed(1)} > 10`);
  assert(s.evps > 100, `camera events/s ${Math.round(s.evps)} > 100`);
  await page.screenshot({ path: path.join(OUT, 'm1-camera.png') });

  for (const res of ['640x480', '160x120']) {
    await page.selectOption('#resolution', res);
    await page.waitForTimeout(1500);
    s = await page.evaluate(() => window.__eventcam.pipeline.stats.summary());
    console.log(`  ${res}`, JSON.stringify(s));
    assert(s.evps > 0, `events at ${res}`);
  }

  assert(errors.length === 0, `no console errors (${errors.join(' | ')})`);
  console.log('PASS smoke');
} finally {
  await close();
}
