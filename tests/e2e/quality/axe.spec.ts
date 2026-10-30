import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { AUTH_FILE } from '../helpers';

// Step 6: axe-core (the accessibility checker used by Google Lighthouse) over every page, in light and dark, on a desktop and on a phone.
// Rules: WCAG 2.0, 2.1 and 2.2 level A and AA (colour contrast, names and labels, landmarks, headings, target size...) plus axe's best practices.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const PUBLIC = ['/', '/projects', '/projects/wanderhost-booking', '/projects/pocket-ledger', '/now', '/resume', '/contact', '/auth', '/no-such-page'];
const DASH = ['/dashboard', '/dashboard/projects', '/dashboard/assets', '/dashboard/settings', '/dashboard/seo', '/dashboard/inbox', '/dashboard/now', '/dashboard/resume'];
const SCREENS = [{ name: 'desktop', viewport: { width: 1280, height: 900 } }, { name: 'phone', viewport: { width: 390, height: 844 } }];

async function scan(page: any, path: string) {
  await page.goto(path, { waitUntil: 'networkidle' });
  if (path.includes('/projects/')) { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(1500); }   // draw the lazy diagrams too
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return r.violations.flatMap((v) => v.nodes.map((n) => `${path}: [${v.impact}] ${v.id} - ${v.help}\n      ${n.target.join(' ')}\n      ${n.html.slice(0, 120)}\n      ${(n.any[0]?.message ?? '').slice(0, 160)}`));
}

test.describe('the axe scanner itself', () => {
  test('can fail: a deliberately broken page is flagged (so a clean result elsewhere means something)', async ({ page }) => {
    await page.setContent('<html lang="en"><head><title>x</title></head><body><img src="a.png"><button></button><p style="color:#bbb;background:#fff">low contrast</p><input type="text"></body></html>');
    const ids = (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => v.id);
    for (const id of ['image-alt', 'button-name', 'color-contrast', 'label']) expect(ids).toContain(id);
  });
});

for (const scheme of ['light', 'dark'] as const) for (const screen of SCREENS) {
  test.describe(`${scheme} / ${screen.name}`, () => {
    test.use({ colorScheme: scheme, viewport: screen.viewport, reducedMotion: 'reduce' });
    test.describe('visitor pages', () => {
      test.use({ storageState: { cookies: [], origins: [] } });
      test('no accessibility violations', async ({ page }) => {
        const found: string[] = []; for (const p of PUBLIC) found.push(...(await scan(page, p)));
        expect(found.join('\n')).toBe('');
      });
    });
    test.describe('owner pages', () => {
      test.use({ storageState: AUTH_FILE });
      test('no accessibility violations', async ({ page }) => {
        const found: string[] = []; for (const p of DASH) found.push(...(await scan(page, p)));
        await page.goto('/dashboard/projects'); const edit = await page.locator('a[href^="/dashboard/projects/"]').first().getAttribute('href');
        if (edit) found.push(...(await scan(page, edit)));
        expect(found.join('\n')).toBe('');
      });
    });
  });
}
