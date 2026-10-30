import { test, expect, type Page } from '@playwright/test';
import { AUTH_FILE, sameOrigin, openPage } from '../helpers';

// Mermaid diagrams written in Markdown (```mermaid), as in Obsidian. The demo project "wanderhost-booking" has three; "edge-notes" has a broken one.
const anon = { cookies: [], origins: [] };
const PAGE = '/projects/wanderhost-booking';

/** Collects anything that would be a problem: console errors/warnings (CSP violations show up here), uncaught errors, dialogs. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => { problems.push(`dialog: ${d.message()}`); void d.dismiss(); });
  return problems;
}
/** Scroll each diagram into view (they are drawn when near the screen) and wait until all are drawn. */
async function drawAll(page: Page, n: number) {
  const figs = page.locator('figure.diagram');
  for (let i = 0; i < await figs.count(); i++) await figs.nth(i).scrollIntoViewIfNeeded();
  await expect(page.locator('figure.diagram[data-state="ready"]')).toHaveCount(n, { timeout: 20_000 });
}

test.describe('public page', () => {
  test.use({ storageState: anon });

  test('all three diagrams are drawn, with no console errors or CSP violations (strict production CSP)', async ({ page }) => {
    const problems = watch(page);
    await openPage(page, PAGE);
    await drawAll(page, 3);
    await expect(page.locator('figure.diagram .diagram-view svg')).toHaveCount(3);
    expect(problems).toEqual([]);
  });

  test('accessible: each drawing is an image with a name, and the source stays available', async ({ page }) => {
    await openPage(page, PAGE); await drawAll(page, 3);
    const v = page.locator('.diagram-view').first();
    await expect(v).toHaveAttribute('role', 'img'); await expect(v).toHaveAttribute('aria-label', /\S/);
    const src = page.locator('details.diagram-src').first();
    await expect(src.locator('summary')).toHaveText('Diagram source');
    await expect(src.locator('pre')).toBeHidden();
    await src.locator('summary').click();
    await expect(src.locator('pre')).toContainText('flowchart LR');
    await expect(src.locator('pre')).toHaveAttribute('tabindex', '0');
  });

  test('uses the site\'s typeface, and follows light/dark when the theme changes', async ({ page }) => {
    await openPage(page, PAGE); await drawAll(page, 3);
    const look = () => page.locator('figure.diagram').first().evaluate((f) => {
      const node = f.querySelector('svg .node rect, svg .node path, svg rect') as SVGElement;
      return { fill: getComputedStyle(node).fill, font: getComputedStyle(f.querySelector('svg text, svg span') as Element).fontFamily, box: getComputedStyle(f.querySelector('.diagram-view')!).backgroundColor };
    });
    await page.locator('[data-theme-choice="light"]').first().evaluate((b: HTMLElement) => b.click());
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.waitForTimeout(600);
    const light = await look();
    expect(light.font).toContain('Paper Mono');
    await page.locator('[data-theme-choice="dark"]').first().evaluate((b: HTMLElement) => b.click());
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(async () => (await look()).fill, { timeout: 10_000, message: 'diagram colours did not change with the theme' }).not.toBe(light.fill);
    const dark = await look();
    expect(dark.box).not.toBe(light.box);
    await expect(page.locator('figure.diagram[data-state="ready"]')).toHaveCount(3);
  });

  for (const w of [320, 375]) {
    test(`at ${w}px: a wide diagram scrolls inside its own box and the page never scrolls sideways`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: 740 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage(); const problems = watch(page);
      await openPage(page, PAGE); await drawAll(page, 3);
      const wide = page.locator('.diagram-view').nth(2);
      expect(await wide.evaluate((e) => e.scrollWidth > e.clientWidth), 'the wide diagram should scroll in its box').toBe(true);
      for (let i = 0; i < 3; i++) {
        const b = (await page.locator('figure.diagram').nth(i).boundingBox())!;
        expect(b.x + b.width, `diagram ${i} is wider than the screen`).toBeLessThanOrEqual(w + 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(problems).toEqual([]);
      await ctx.close();
    });
  }

  test('the source is shown (as text, not drawn) when JavaScript is off', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage(); await page.goto(PAGE);
    const first = page.locator('figure.diagram pre').first();
    await expect(first).toBeVisible(); await expect(first).toContainText('flowchart LR'); await expect(first).toContainText('Visitor');
    await expect(page.locator('figure.diagram svg')).toHaveCount(0);
    await ctx.close();
  });

  test('a diagram with a mistake shows its source and a clear note, and does not break the page', async ({ page }) => {
    const problems = watch(page);
    await openPage(page, '/projects/edge-notes');
    const fig = page.locator('figure.diagram');
    await fig.scrollIntoViewIfNeeded();
    await expect(fig).toHaveAttribute('data-state', 'error', { timeout: 20_000 });
    await expect(fig.locator('pre')).toBeVisible(); await expect(fig.locator('pre')).toContainText('flowchart LR');
    await expect(fig.locator('.diagram-error')).toContainText('could not be drawn');
    await expect(fig.locator('svg')).toHaveCount(0);
    expect(await page.locator('[id^="ddiagram-"]').count(), 'Mermaid left its error drawing on the page').toBe(0);
    await expect(page.locator('h1')).toBeVisible(); await expect(page.locator('footer')).toBeVisible();
    expect(problems.filter((p) => !/parse|syntax|diagram/i.test(p)), 'unexpected errors').toEqual([]);
  });

  test('diagram code is only downloaded on pages that have a diagram', async ({ page }) => {
    const seen: string[] = [];
    page.on('response', (r) => { if (/\/_astro\/.*\.js/.test(r.url())) seen.push(r.url().split('/').pop()!); });
    await openPage(page, PAGE); await drawAll(page, 3);
    expect(seen.some((f) => /^diagrams\./.test(f))).toBe(true);
    expect(seen.length, 'Mermaid itself is split into many on-demand files').toBeGreaterThan(3);
  });

  test('the 1.4 MB ELK layout engine is never downloaded: flowcharts are laid out by the small dagre engine', async ({ page }) => {
    // Mermaid 12.1 lays flowcharts out with ELK unless told otherwise; ELK is about 420 KB over the wire and unused by anything else on the page.
    const sizes: Record<string, number> = {};
    page.on('response', async (r) => { if (/\/_astro\/.*\.js/.test(r.url())) sizes[r.url().split('/').pop()!] = (await r.body().catch(() => Buffer.alloc(0))).length; });
    await openPage(page, PAGE); await drawAll(page, 3);
    expect(Object.keys(sizes).filter((f) => /^elk-/.test(f)), 'ELK requested').toEqual([]);
    expect(Math.max(...Object.values(sizes)) / 1024, 'no single script file is larger than 400 KB').toBeLessThan(400);
    expect(Object.keys(sizes).some((f) => /^dagre-/.test(f)), 'the dagre layout engine is used').toBe(true);
  });
});

test.describe('safety', () => {
  test.use({ storageState: AUTH_FILE });
  const EVIL = '```mermaid\nflowchart LR\n  A["<img src=x onerror=window.__pwned=1>"] --> B["<script>window.__pwned=1</script>"]\n  click A href "javascript:window.__pwned=1"\n```\n\nAfter: </code></pre><script>window.__pwned=1</script>';

  test('the preview endpoint escapes diagram source (no raw tags reach the page)', async ({ request, baseURL }) => {
    const r = await request.post('/api/admin/preview', { data: { md: EVIL }, headers: sameOrigin(baseURL!) });
    const html: string = (await r.json()).html;
    expect(html).toContain('data-diagram');
    expect(html).not.toMatch(/<img[^>]+onerror/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('&lt;img');
  });

  test('real browser: a hostile diagram cannot run script', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/dashboard/projects/1'); await page.waitForLoadState('networkidle');
    await page.locator('#body').fill(EVIL);
    await page.getByRole('tab', { name: 'Preview' }).click();
    await expect(page.locator('[data-preview] figure.diagram')).toHaveAttribute('data-state', /ready|error/, { timeout: 20_000 });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__pwned), 'script ran').toBeUndefined();
    expect(await page.locator('[data-preview] [onerror], [data-preview] script').count()).toBe(0);
    expect(problems.filter((p) => p.startsWith('dialog'))).toEqual([]);
  });
});

test.describe('editor preview', () => {
  test.use({ storageState: AUTH_FILE });
  test('Preview draws the diagrams straight away', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/dashboard/projects/1'); await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: 'Preview' }).click();
    await expect(page.locator('[data-preview] figure.diagram[data-state="ready"]')).toHaveCount(3, { timeout: 25_000 });
    await expect(page.locator('[data-preview] .diagram-view svg')).toHaveCount(3);
    expect(problems).toEqual([]);
  });
  test('the syntax help mentions diagrams', async ({ page }) => {
    await page.goto('/dashboard/projects/1');
    await expect(page.locator('ul.syntax')).toContainText('mermaid');
  });
});
