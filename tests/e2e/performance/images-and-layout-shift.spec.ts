import { test, expect, type Page } from '@playwright/test';
import { WIDTHS, openPage } from '../helpers';

// Lighthouse findings: the largest image must start loading at once (not lazy), images must be the right size for their slot,
// and nothing may jump when an image arrives late (Cumulative Layout Shift).
const anon = { cookies: [], origins: [] };
test.use({ storageState: anon });

const imgs = (page: Page, sel: string) => page.locator(sel).evaluateAll((els) => els.map((e) => ({
  loading: e.getAttribute('loading'), priority: e.getAttribute('fetchpriority'), decoding: e.getAttribute('decoding'), sizes: e.getAttribute('sizes'),
})));

test.describe('which images load first', () => {
  test('home: the first project card is loaded at once with high priority; the next waits until it is near', async ({ page }) => {
    await openPage(page, '/');
    const cards = await imgs(page, '.pcard img');
    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(cards[0]).toMatchObject({ loading: 'eager', priority: 'high', decoding: 'sync' });
    expect(cards[1]).toMatchObject({ loading: 'lazy', priority: null, decoding: 'async' });
  });

  test('projects: the first two cards (top of the page) are eager, the rest lazy', async ({ page }) => {
    await openPage(page, '/projects');
    const cards = await imgs(page, '.pcard img');
    expect(cards.map((c) => c.loading)).toEqual(['eager', 'eager', 'lazy']);
    expect(cards[0].priority).toBe('high'); expect(cards[2].priority).toBeNull();
  });

  test('project page: the cover is eager and high priority', async ({ page }) => {
    await openPage(page, '/projects/wanderhost-booking');
    expect((await imgs(page, '.project-cover img'))[0]).toMatchObject({ loading: 'eager', priority: 'high' });
  });

  test('nothing but real above-the-fold images is eager (a lazy image must never be the first thing a visitor sees)', async ({ page }) => {
    await openPage(page, '/');
    const lazyInView = await page.locator('img[loading="lazy"]').evaluateAll((els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.top < innerHeight && r.bottom > 0; }).length);
    expect(lazyInView, 'a lazy image is inside the first screen, so it will be late').toBe(0);
  });
});

test.describe('the file the browser picks fits the slot ("sizes")', () => {
  test('a grid of 2 cards (they stretch) says 35rem; 3 or more says 24rem', async ({ page }) => {
    await openPage(page, '/');
    expect((await imgs(page, '.pcard img'))[0].sizes).toContain('35rem');
    await openPage(page, '/projects');
    expect((await imgs(page, '.pcard img'))[0].sizes).toContain('24rem');
  });

  test('on a wide screen the browser asks for the smallest file that covers the card (not a bigger one)', async ({ page }) => {
    const LADDER = [160, 320, 480, 640, 800, 1024, 1280, 1600, 2000]; // = WIDTHS in src/lib/media.ts
    for (const [path, expectCols] of [['/', 2], ['/projects', 3]] as const) {
      const wanted: number[] = [];
      const p = await page.context().newPage(); await p.setViewportSize({ width: 1350, height: 940 });
      p.on('request', (r) => { const m = /\/media\/[^/]+\/[^?]+\?w=(\d+)&f=avif/.exec(r.url()); if (m) wanted.push(+m[1]); });
      await openPage(p, path);
      const slot = await p.locator('.pcard img').first().evaluate((e) => e.getBoundingClientRect().width);
      const rung = LADDER.find((w) => w >= slot)!;
      expect(wanted.length, path).toBeGreaterThan(0);
      expect(Math.min(...wanted), `${path}: card is ${Math.round(slot)}px wide (${expectCols} cards), so ${rung}w is enough`).toBeLessThanOrEqual(rung);
      await p.close();
    }
  });
});

/** Layout shift caused by images arriving late: every /media/ response is delayed, like a slow phone connection. */
async function shiftWithLateImages(page: Page, path: string, delay = 1500) {
  await page.route('**/media/**', async (r) => { await new Promise((x) => setTimeout(x, delay)); await r.continue(); });
  await page.addInitScript(() => {
    (window as any).__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries() as any[]) if (!e.hadRecentInput) (window as any).__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(path, { waitUntil: 'load' });
  await page.waitForTimeout(delay + 700);
  return page.evaluate(() => (window as any).__cls as number);
}

test.describe('no layout shift when an image arrives late', () => {
  for (const [name, vp] of [['phone', { width: 412, height: 823 }], ['desktop', { width: 1350, height: 940 }]] as const) {
    for (const path of ['/projects/wanderhost-booking', '/projects/pocket-ledger', '/', '/projects', '/now', '/resume', '/contact']) {
      test(`${path} on a ${name}`, async ({ page }) => {
        await page.setViewportSize(vp);
        expect(await shiftWithLateImages(page, path)).toBeLessThan(0.01); // "good" is under 0.1; we have 0.000
      });
    }
  }

  test('no-JavaScript visitors do not get a dead search box', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false }); const page = await ctx.newPage();
    await page.goto('/projects'); await expect(page.locator('[data-search-wrap]')).toBeHidden(); await expect(page.locator('.chips')).toBeVisible();
    await ctx.close();
  });

  test('the Projects search box is in place from the first frame (it used to appear later and push the filters down)', async ({ page }) => {
    await page.addInitScript(() => { (window as any).__y = []; document.addEventListener('readystatechange', () => { const c = document.querySelector('.chips'); if (c) (window as any).__y.push(Math.round(c.getBoundingClientRect().y)); }); });
    await openPage(page, '/projects');
    const ys: number[] = await page.evaluate(() => (window as any).__y);
    expect(new Set(ys).size, `filters moved: ${ys.join(' → ')}`).toBe(1);
    await expect(page.locator('#q')).toBeVisible();
  });

  test('the cover and portrait keep exactly the same size and position before and after the image loads', async ({ page }) => {
    await page.route('**/media/**', async (r) => { await new Promise((x) => setTimeout(x, 2000)); await r.continue(); });
    for (const [path, sel] of [['/projects/wanderhost-booking', '.project-cover img'], ['/', '.portrait img']] as const) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);
      const box = () => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), done: (e as HTMLImageElement).complete }; });
      const before = await box(); expect(before.done).toBe(false);
      expect(before.h, `${sel} has no height before loading`).toBeGreaterThan(100);
      await expect.poll(async () => (await box()).done, { timeout: 8000 }).toBe(true);
      const after = await box();
      expect(Math.abs(after.w - before.w)).toBeLessThanOrEqual(1); expect(Math.abs(after.h - before.h)).toBeLessThanOrEqual(1);
    }
  });

  for (const w of WIDTHS) {
    test(`the cover is never wider than its frame at ${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await openPage(page, '/projects/wanderhost-booking');
      const [img, frame] = await Promise.all([page.locator('.project-cover img').boundingBox(), page.locator('.project-cover .frame').boundingBox()]);
      expect(img!.width).toBeLessThanOrEqual(frame!.width + 1);
    });
  }
});
