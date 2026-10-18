// Dev tool: measures Cumulative Layout Shift (and what moved) when images arrive LATE, like on a slow phone connection.
//   BASE=http://localhost:8790 DELAY=1500 node tests/tools/cls.mjs /projects/wanderhost-booking [/other-path ...]
import { chromium } from '@playwright/test';
const BASE = process.env.BASE ?? 'http://localhost:8790', DELAY = Number(process.env.DELAY ?? 1500);
const b = await chromium.launch();
for (const path of process.argv.slice(2).length ? process.argv.slice(2) : ['/projects/wanderhost-booking']) {
  for (const [label, vp] of [['phone 412x823', { width: 412, height: 823, isMobile: true, hasTouch: true, deviceScaleFactor: 1.75 }], ['desktop 1350x940', { width: 1350, height: 940 }]]) {
    const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor ?? 1, extraHTTPHeaders: { 'cf-connecting-ip': '10.5.5.5' } });
    const page = await ctx.newPage();
    await page.route('**/media/**', async (r) => { await new Promise((x) => setTimeout(x, DELAY)); await r.continue(); });
    await page.addInitScript(() => { window.__cls = 0; window.__src = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__src.push(e.value.toFixed(3) + ' ' + (e.sources || []).map((s) => (s.node?.nodeName || '?') + '.' + (s.node?.className || '')).join(',')); } }).observe({ type: 'layout-shift', buffered: true }); });
    await page.goto(BASE + path, { waitUntil: 'load' }); await page.waitForTimeout(DELAY + 800);
    const r = await page.evaluate(() => ({ cls: window.__cls, src: window.__src }));
    console.log(`${path}  ${label.padEnd(17)} CLS=${r.cls.toFixed(3)}  ${r.src.slice(0, 3).join(' | ')}`);
    await ctx.close();
  }
}
await b.close();
