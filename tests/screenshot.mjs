// Regenerate docs/screenshot.png (synthetic mode, desktop) and a phone-width check image.
import path from 'node:path';
import { setup, ROOT, OUT, assert } from './helpers.mjs';

{
  const { page, base, errors, close } = await setup({ viewport: { width: 1360, height: 860 }, scale: 2 });
  await page.goto(base + '?fps=30');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(ROOT, 'docs', 'screenshot.png') });
  assert(errors.length === 0, 'no console errors (desktop)');
  await close();
}
{
  const { page, base, errors, close } = await setup({ viewport: { width: 390, height: 844 }, scale: 2 });
  await page.goto(base);
  await page.waitForTimeout(4500);
  await page.screenshot({ path: path.join(OUT, 'phone.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 0, `no horizontal scroll on phone (overflow ${overflow}px)`);
  assert(errors.length === 0, 'no console errors (phone)');
  await close();
}
console.log('PASS screenshots');
