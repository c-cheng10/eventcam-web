// Record ~1.5 s of synthetic events, export CSV/BIN/JSON and check the files agree.
import fs from 'node:fs';
import path from 'node:path';
import { setup, assert, OUT } from './helpers.mjs';

const { page, base, errors, close } = await setup();
try {
  await page.goto(base);
  await page.waitForTimeout(800);
  await page.click('#btnRec');
  await page.waitForTimeout(1500);
  await page.click('#btnRec');
  const n = await page.evaluate(() => window.__eventcam.recorder.n);
  const counter = await page.textContent('#recCount');
  console.log(`  recorded ${n} events, counter shows ${counter}`);
  assert(n > 1000, 'recorded events');
  assert(counter === n.toLocaleString('en-US'), 'visible counter matches buffer');
  await page.screenshot({ path: path.join(OUT, 'm3-recorded.png') });

  const grab = async (sel) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
    const file = path.join(OUT, dl.suggestedFilename());
    await dl.saveAs(file);
    return file;
  };
  const csv = fs.readFileSync(await grab('#btnCsv'), 'utf8').trim().split('\n');
  const bin = fs.readFileSync(await grab('#btnBin'));
  const meta = JSON.parse(fs.readFileSync(await grab('#btnJson'), 'utf8'));

  assert(csv[0] === 'x,y,t_us,p', 'CSV header is x,y,t_us,p');
  assert(csv.length - 1 === n, `CSV has ${n} rows`);
  assert(bin.length === n * 9, 'binary is 9 bytes per event');
  assert(meta.num_events === n && meta.width === 320 && meta.height === 240 && meta.contrast_threshold === 0.2, 'sidecar metadata');

  let sorted = true, prev = -1, polOk = true, inBounds = true;
  for (let i = 0; i < n; i++) {
    const o = i * 9;
    const t = bin.readUInt32LE(o), x = bin.readUInt16LE(o + 4), y = bin.readUInt16LE(o + 6), p = bin.readInt8(o + 8);
    if (t < prev) sorted = false;
    prev = t;
    if (p !== 1 && p !== -1) polOk = false;
    if (x >= 320 || y >= 240) inBounds = false;
    if (i < 1000 || i === n - 1) {
      const [cx, cy, ct, cp] = csv[i + 1].split(',').map(Number);
      if (cx !== x || cy !== y || ct !== t || cp !== p) throw new Error(`CSV/BIN mismatch at ${i}`);
    }
  }
  assert(sorted, 'timestamps are non-decreasing');
  assert(polOk && inBounds, 'polarity is ±1 and coordinates are in range');
  const dur = prev / 1e6;
  console.log(`  duration ${dur.toFixed(3)} s`);
  assert(dur > 1.0 && dur < 2.5, 'duration matches wall-clock recording time');
  assert(errors.length === 0, `no console errors (${errors.join(' | ')})`);
  console.log('PASS record');
} finally {
  await close();
}
