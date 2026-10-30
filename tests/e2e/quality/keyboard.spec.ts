import { test, expect } from '@playwright/test';

// Step 6: using the site without a mouse (WCAG 2.1.1, 2.4.1, 2.4.7, 2.4.11, 3.3.1).
test.use({ storageState: { cookies: [], origins: [] } });
const PAGES = ['/', '/projects', '/projects/wanderhost-booking', '/now', '/resume', '/contact'];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });
    for (const path of PAGES) {
      test(`${path}: the first Tab stop is a visible "skip to content" link that works`, async ({ page }) => {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await page.keyboard.press('Tab');
        const skip = page.locator(':focus');
        await expect(skip).toHaveAttribute('href', '#main');
        await expect(skip).toBeInViewport(); expect(await skip.evaluate((e) => { const r = e.getBoundingClientRect(); return r.width > 20 && r.height > 20; })).toBe(true);
        await page.keyboard.press('Enter');
        expect(new URL(page.url()).hash).toBe('#main');
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => !!document.activeElement?.closest('main')), 'the next Tab stop is inside the page content, not back in the menu').toBe(true);
      });

      test(`${path}: every Tab stop shows a visible focus mark and is never hidden behind the sticky header`, async ({ page }) => {
        await page.goto(path, { waitUntil: 'networkidle' });
        const seen = new Set<string>(); const problems: string[] = [];
        for (let i = 0; i < 80; i++) {
          await page.keyboard.press('Tab');
          const r = await page.evaluate(() => {
            const e = document.activeElement as HTMLElement; if (!e || e === document.body) return null;
            const cs = getComputedStyle(e), box = e.getBoundingClientRect(), hdr = document.querySelector('header')?.getBoundingClientRect();
            const sticky = hdr && getComputedStyle(document.querySelector('header')!).position !== 'static';
            const out = (c: CSSStyleDeclaration) => c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) >= 2;
            let ring = out(cs) || (cs.boxShadow !== 'none' && /\d/.test(cs.boxShadow));
            for (let n = e.parentElement, k = 0; n && k < 4 && !ring; n = n.parentElement, k++) ring = out(getComputedStyle(n));   // a card link rings its whole card
            return { id: `${e.tagName.toLowerCase()}|${e.getAttribute('href') ?? e.getAttribute('name') ?? e.id ?? ''}|${Math.round(box.x)},${Math.round(box.y + scrollY)}`, label: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30), ring, hidden: !!sticky && !e.closest('header') && !e.matches('a[href="#main"]') && box.top < hdr!.bottom - 1 && box.bottom > 0, vis: box.width > 0 && box.height > 0 };
          });
          if (!r) continue; if (seen.has(r.id)) break; seen.add(r.id);
          if (!r.vis) problems.push(`${r.id} "${r.label}" has no size`);
          if (!r.ring) problems.push(`${r.id} "${r.label}" shows no focus mark`);
          if (r.hidden) problems.push(`${r.id} "${r.label}" is hidden behind the sticky header`);
        }
        expect(seen.size, 'there are focusable things on the page').toBeGreaterThan(3);
        expect(problems).toEqual([]);
      });
    }
  });
}

test.describe('mobile menu', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('opens with the keyboard, is announced as expanded, closes with Escape and returns focus to its button', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const btn = page.locator('[data-burger]');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.focus(); await page.keyboard.press('Enter');
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(await btn.evaluate((e) => e === document.activeElement), 'focus is back on the menu button').toBe(true);
  });
});

test.describe('when something goes wrong, the error takes focus (so a keyboard or screen reader user hears it and is in the right place)', () => {
  test('contact form: an empty send puts focus on the error summary, and each field points at its own message', async ({ page }) => {
    await page.goto('/contact', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2600);               // the anti-spam timer: a form sent sooner is refused with a different message
    await page.getByRole('button', { name: /send/i }).click();
    await expect(page.locator('#form-error')).toBeFocused();
    await expect(page.locator('#form-error')).toHaveAttribute('role', 'alert');
    for (const f of ['name', 'email', 'message']) {
      const input = page.locator(`#${f}`);
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      const id = await input.getAttribute('aria-describedby'); expect(id).toBe(`${f}-err`);
      expect((await page.locator(`#${id}`).textContent())!.trim().length).toBeGreaterThan(5);
    }
  });
  test('sign-in: a wrong password puts focus on the message', async ({ page }) => {
    await page.goto('/auth', { waitUntil: 'networkidle' });
    await page.locator('input[name=email]').fill('nobody@example.com'); await page.locator('input[name=password]').fill('definitely not it');
    await page.locator('form button[type=submit]').click();
    await expect(page.getByRole('alert')).toBeFocused();
  });
});

test.describe('diagrams that scroll sideways', () => {
  test('a diagram wider than its box can be reached with Tab and scrolled with the arrow keys; one that fits adds no Tab stop', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/projects/wanderhost-booking', { waitUntil: 'networkidle' });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForSelector('figure[data-diagram] svg', { state: 'attached' });
    await expect(page.locator('figure[data-diagram] svg')).toHaveCount(3, { timeout: 8000 });
    const info = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.diagram-view')].map((v) => ({ overflow: v.scrollWidth > v.clientWidth + 1, tab: v.getAttribute('tabindex') })));
    expect(info.some((i) => i.overflow), 'at least one demo diagram is wider than a phone').toBe(true);
    for (const i of info) expect(i.tab, 'focusable exactly when it overflows').toBe(i.overflow ? '0' : null);
    const wide = page.locator('.diagram-view[tabindex="0"]').first();
    await wide.focus(); await expect(wide).toBeFocused();
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    expect(await wide.evaluate((e) => e.scrollLeft), 'arrow keys scroll it').toBeGreaterThan(0);
    // a wide screen: every diagram fits, so none is a Tab stop
    await page.setViewportSize({ width: 1600, height: 900 });
    await expect.poll(() => page.locator('.diagram-view[tabindex]').count()).toBeLessThan(info.filter((i) => i.overflow).length);
  });
});
