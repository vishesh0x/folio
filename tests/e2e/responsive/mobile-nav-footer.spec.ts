import { test, expect } from '@playwright/test';
import { openPage } from '../helpers';

const anon = { cookies: [], origins: [] };
const phone = (width: number, height = 740) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, storageState: anon });

for (const w of [320, 375, 414]) {
  test.describe(`navbar on a ${w}px phone`, () => {
    test.use(phone(w));

    test('shows the whole name (no "Vishesh Raghuv…" cut-off) next to a Menu button', async ({ page }) => {
      await openPage(page, '/projects');
      const logo = page.locator('.logo'), burger = page.locator('[data-burger]');
      await expect(burger).toBeVisible();
      await expect(page.locator('.nav')).toBeHidden();
      const clipped = await logo.evaluate((el) => el.scrollWidth > el.clientWidth + 1 || getComputedStyle(el).textOverflow === 'ellipsis' && getComputedStyle(el).overflow === 'hidden');
      expect(clipped, 'logo text is cut off').toBe(false);
      const [l, b] = [(await logo.boundingBox())!, (await burger.boundingBox())!];
      expect(l.x + l.width, 'logo overlaps the Menu button').toBeLessThanOrEqual(b.x);
      expect(await logo.innerText()).toContain('Vishesh Raghuvanshi');
    });

    test('the menu opens, lists every page, and is fully on screen', async ({ page }) => {
      await openPage(page, '/projects');
      const burger = page.locator('[data-burger]'), menu = page.locator('#site-menu');
      await burger.tap();
      await expect(burger).toHaveAttribute('aria-expanded', 'true');
      await expect(burger).toHaveText('Close');
      for (const n of ['Projects', 'Now', 'Resume', 'Contact']) await expect(menu.getByRole('link', { name: n })).toBeVisible();
      for (const b of ['light', 'dark', 'system']) await expect(menu.getByRole('button', { name: b })).toBeVisible();
      const box = (await menu.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(w + 1);
      expect(box.y + box.height, 'menu runs off the bottom of the screen').toBeLessThanOrEqual(740 + 1);
    });

    test('Escape closes it and returns focus to the button; tapping outside closes it; tapping a link goes there', async ({ page }) => {
      await openPage(page, '/contact');
      const burger = page.locator('[data-burger]'), menu = page.locator('#site-menu');
      await burger.tap(); await expect(menu).toHaveClass(/open/);
      await page.keyboard.press('Escape');
      await expect(menu).not.toHaveClass(/open/); await expect(burger).toBeFocused();
      await burger.tap(); await expect(menu).toHaveClass(/open/);
      await page.locator('main').dispatchEvent('click');          // a tap on the page itself
      await expect(menu).not.toHaveClass(/open/); await expect(burger).toHaveAttribute('aria-expanded', 'false');
      await burger.tap(); await menu.getByRole('link', { name: 'Now' }).tap();
      await expect(page).toHaveURL(/\/now$/);
    });
  });
}

test.describe('navbar on other screens', () => {
  test('a phone turned sideways: the menu stays on screen', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 667, height: 320 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(); await openPage(page, '/');
    await page.locator('[data-burger]').tap();
    const b = (await page.locator('#site-menu').boundingBox())!;
    expect(b.y + b.height, 'menu runs off the bottom').toBeLessThanOrEqual(320 + 1);
    await ctx.close();
  });

  test('a very short window (240px tall): the menu scrolls, so the theme switch is still reachable', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 667, height: 240 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(); await openPage(page, '/');
    await page.locator('[data-burger]').tap();
    const menu = page.locator('#site-menu');
    expect(await menu.evaluate((el) => el.scrollHeight > el.clientHeight), 'menu should scroll, not run off screen').toBe(true);
    const b = (await menu.boundingBox())!; expect(b.y + b.height).toBeLessThanOrEqual(240 + 1);
    const sys = page.locator('[data-theme-choice="system"]'); await sys.scrollIntoViewIfNeeded(); await sys.tap();
    await expect(sys).toHaveAttribute('aria-pressed', 'true');
    await ctx.close();
  });

  test('tablet/desktop: no Menu button, links are in the bar; growing the window closes an open menu', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 600, height: 700 } });
    const page = await ctx.newPage(); await openPage(page, '/');
    await page.locator('[data-burger]').click(); await expect(page.locator('#site-menu')).toHaveClass(/open/);
    await page.setViewportSize({ width: 1100, height: 700 });
    await expect(page.locator('[data-burger]')).toBeHidden();
    await expect(page.locator('#site-menu')).not.toHaveClass(/open/);
    await expect(page.locator('.nav a')).toHaveCount(4);
    for (const a of await page.locator('.nav a').all()) await expect(a).toBeVisible();
    await ctx.close();
  });

  test('JavaScript off: the links are still all there, in the bar, with no overflow', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 740 }, isMobile: true, javaScriptEnabled: false });
    const page = await ctx.newPage(); await page.goto('/');
    await expect(page.locator('[data-burger]')).toBeHidden();
    for (const n of ['Projects', 'Now', 'Resume', 'Contact']) await expect(page.locator('.nav').getByRole('link', { name: n })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await ctx.close();
  });
});

test.describe('footer', () => {
  test.describe('phone', () => {
    test.use(phone(375));
    test('copyright and tagline are on separate lines; every link stays inside the screen', async ({ page }) => {
      await openPage(page, '/');
      const lines = page.locator('.foot-line');
      const [a, b] = [(await lines.nth(0).boundingBox())!, (await lines.nth(1).boundingBox())!];
      expect(b.y, 'tagline should start below the copyright line').toBeGreaterThanOrEqual(a.y + a.height - 1);
      for (const l of await page.locator('.footer-links a').all()) {
        const box = (await l.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(376);
      }
    });
  });
  test.describe('desktop', () => {
    test.use({ viewport: { width: 1280, height: 800 }, storageState: anon });
    test('copyright and tagline share one line', async ({ page }) => {
      await openPage(page, '/');
      const lines = page.locator('.foot-line');
      const [a, b] = [(await lines.nth(0).boundingBox())!, (await lines.nth(1).boundingBox())!];
      expect(Math.abs(a.y - b.y)).toBeLessThan(4);
    });
  });
});
