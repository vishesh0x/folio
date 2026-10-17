import { test, expect, type Page } from '@playwright/test';
import { AUTH_FILE, openPage } from '../helpers';

// Everything you tap must be at least 44 x 44 CSS px (WCAG 2.5.5 / Apple HIG), on a touch screen.
// Text links inside a sentence are exempt, as the WCAG inline exception allows.
const tooSmall = (page: Page, selector: string) => page.evaluate((sel) => {
  const bad: string[] = [];
  for (const el of Array.from(document.querySelectorAll(sel))) {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!r.width || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (r.width < 43.5 || r.height < 43.5) bad.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className || ''} "${(el.textContent || '').trim().slice(0, 20)}" is ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return bad;
}, selector);

test.describe('public site, 375px touch', () => {
  test.use({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true, storageState: { cookies: [], origins: [] } });

  for (const path of ['/', '/projects', '/projects/wanderhost-booking', '/now', '/resume', '/contact', '/auth']) {
    test(`${path}`, async ({ page }) => {
      await openPage(page, path);
      const base = '.logo, [data-burger], .footer-links a, .chip, .btn, .now-done summary, .reveal .btn, .toc a, .link-rows a, .gate-back, .pwtoggle:not([hidden])';
      expect(await tooSmall(page, base)).toEqual([]);
    });
  }

  test('the opened menu: links and the theme switch', async ({ page }) => {
    await openPage(page, '/');
    await page.locator('[data-burger]').tap();
    expect(await tooSmall(page, '.nav a, .seg button')).toEqual([]);
  });
});

test.describe('dashboard, 375px touch', () => {
  test.use({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true, storageState: AUTH_FILE });
  const CONTROLS = '.dash-burger, details.more > summary, .btn, .filters a, .toggle, .choice, .check, .jump a, .md-grp button, .dash-shell .field input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=hidden]), .dash-shell .field select';
  for (const path of ['/dashboard', '/dashboard/projects', '/dashboard/projects/1', '/dashboard/now', '/dashboard/resume', '/dashboard/inbox', '/dashboard/settings']) {
    test(`${path}`, async ({ page }) => {
      await openPage(page, path);
      expect(await tooSmall(page, CONTROLS)).toEqual([]);
    });
  }
});
