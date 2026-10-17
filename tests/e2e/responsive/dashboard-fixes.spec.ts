import { test, expect } from '@playwright/test';
import { AUTH_FILE, openPage } from '../helpers';

// Regression tests for the dashboard problems reported with screenshots.
test.use({ storageState: AUTH_FILE });

test.describe('Now board: "Add a category" (Icon label wrapped and pushed its box down)', () => {
  test('desktop: Name and Icon boxes sit on the same line, and "Icon (optional)" is one line', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openPage(page, '/dashboard/now');
    const [name, icon, label] = [(await page.locator('#c-name').boundingBox())!, (await page.locator('#c-icon').boundingBox())!, (await page.locator('label[for="c-icon"]').boundingBox())!];
    expect(Math.abs(name.y - icon.y), 'tops differ').toBeLessThanOrEqual(1);
    expect(Math.abs(name.height - icon.height), 'heights differ').toBeLessThanOrEqual(1);
    expect(label.height, 'label wraps onto two lines').toBeLessThan(30);
  });
  test('phone: the two fields stack and nothing is clipped', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await openPage(page, '/dashboard/now');
    const [name, icon] = [(await page.locator('#c-name').boundingBox())!, (await page.locator('#c-icon').boundingBox())!];
    expect(icon.y).toBeGreaterThan(name.y + name.height);
    expect(name.x + name.width).toBeLessThanOrEqual(321);
  });
});

test.describe('Resume builder: "What to show"', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme} theme: a checked chip shows a tick that contrasts with its box`, async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: AUTH_FILE, colorScheme: scheme, viewport: { width: 1000, height: 800 } });
      const page = await ctx.newPage(); await openPage(page, '/dashboard/resume');
      const chip = page.locator('.toggle:has(input[name="show_email"])');
      await expect(chip.locator('input')).toBeChecked();
      const c = await chip.evaluate((el) => {
        const box = getComputedStyle(el, '::before'), tick = getComputedStyle(el, '::after');
        return { boxBg: box.backgroundColor, tick: tick.borderRightColor, tickOpacity: tick.opacity };
      });
      expect(c.tickOpacity).toBe('1');
      expect(c.tick, 'tick is the same colour as the box, so it is invisible').not.toBe(c.boxBg);
      // and an unchecked chip shows no tick
      const off = page.locator('.toggle:has(input[name="show_phone"])');
      await expect(off.locator('input')).not.toBeChecked();
      expect(await off.evaluate((el) => getComputedStyle(el, '::after').opacity)).toBe('0');
      await ctx.close();
    });
  }

  for (const w of [1280, 375]) {
    test(`${w}px: the "Print this page" explanation is under its checkbox, not beside it`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await openPage(page, '/dashboard/resume');
      const label = page.locator('label.check:has(input[name="print_reveal"])');
      const hint = label.locator('xpath=following-sibling::*[contains(@class,"hint")][1]');
      const [l, h] = [(await label.boundingBox())!, (await hint.boundingBox())!];
      expect(h.y, 'hint should start below the label').toBeGreaterThanOrEqual(l.y + l.height - 1);
    });
  }
});

test.describe('Project editor: "Address" box', () => {
  for (const w of [320, 375, 1280]) {
    test(`${w}px: the address never breaks in the middle of a word`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await openPage(page, '/dashboard/projects/1');
      const view = page.locator('[data-slug-view]');
      await expect(view).toBeVisible();
      // For each word of the address, the browser must lay it out on ONE line (a broken word has two client rects)
      const broken = await view.locator('.slug .pre').evaluate((el) => {
        const out: string[] = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
          for (const m of (n.textContent || '').matchAll(/[A-Za-z0-9]+/g)) {
            const r = document.createRange(); r.setStart(n, m.index!); r.setEnd(n, m.index! + m[0].length);
            if (r.getClientRects().length > 1) out.push(m[0]);
          }
        }
        return out;
      });
      expect(broken, 'words split across lines').toEqual([]);
      const box = (await view.locator('.slug-full').boundingBox())!;
      const inner = await view.locator('.slug').evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      expect(inner).toBe(true); expect(box.x + box.width).toBeLessThanOrEqual(w + 1);
    });
  }
});

test.describe('"…" row menus stay on screen', () => {
  for (const w of [320, 375]) {
    test(`projects list at ${w}px`, async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: AUTH_FILE, viewport: { width: w, height: 740 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage(); await openPage(page, '/dashboard/projects');
      await page.locator('details.more > summary').first().tap();
      const panel = page.locator('details.more[open] .more-panel').first();
      await expect(panel).toBeVisible();
      const b = (await panel.boundingBox())!;
      expect(b.x, 'menu runs off the left edge').toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, 'menu runs off the right edge').toBeLessThanOrEqual(w + 1);
      await ctx.close();
    });
    test(`now board at ${w}px`, async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: AUTH_FILE, viewport: { width: w, height: 740 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage(); await openPage(page, '/dashboard/now');
      await page.locator('details.more > summary').first().tap();
      const b = (await page.locator('details.more[open] .more-panel').first().boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(w + 1);
      await ctx.close();
    });
  }
});
