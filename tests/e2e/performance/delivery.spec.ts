import { test, expect } from '@playwright/test';
import { cspDirective, header, openPage } from '../helpers';

// Lighthouse findings: render-blocking CSS, the font request chain, and the Cloudflare analytics beacon blocked by the CSP.
const anon = { cookies: [], origins: [] };
test.use({ storageState: anon });
const PUBLIC = ['/', '/projects', '/projects/wanderhost-booking', '/projects/pocket-ledger', '/now', '/resume', '/contact', '/no-such-page'];

test.describe('CSS does not block the first paint', () => {
  for (const path of PUBLIC) {
    test(`${path}: styles are inside the page, there is no separate stylesheet to wait for`, async ({ request }) => {
      const html = await (await request.get(path)).text();
      expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet["']/i);
      expect(html).toMatch(/<style[\s>]/i);
    });
  }
  test('fonts and images are still separate files (only CSS is inlined)', async ({ request }) => {
    const html = await (await request.get('/')).text();
    expect(html).not.toMatch(/url\(data:font/i);
    expect(html).toMatch(/\/_astro\/PaperMono-VF\.[\w-]+\.woff2/);
  });
});

test.describe('fonts', () => {
  test('Paper Mono is preloaded on every page, so it is not discovered late through the CSS', async ({ request }) => {
    for (const path of PUBLIC) {
      const html = await (await request.get(path)).text();
      expect(html, path).toMatch(/<link rel="preload" href="\/_astro\/PaperMono-VF\.[\w-]+\.woff2" as="font" type="font\/woff2" crossorigin/);
    }
  });
  test('the code font is preloaded only on pages that show code', async ({ request }) => {
    const code = /rel="preload" href="\/_astro\/jetbrains-mono-latin-wght-normal\.[\w-]+\.woff2"/;
    expect(await (await request.get('/projects/wanderhost-booking')).text()).toMatch(code);   // has a code block
    for (const path of ['/projects/pocket-ledger', '/', '/projects', '/now']) expect(await (await request.get(path)).text(), path).not.toMatch(code);
  });
  test('preloaded fonts exist and are served as long-lived font files', async ({ request }) => {
    const html = await (await request.get('/projects/wanderhost-booking')).text();
    for (const m of html.matchAll(/rel="preload" href="([^"]+\.woff2)"/g)) {
      const r = await request.get(m[1]);
      expect(r.status(), m[1]).toBe(200);
      expect(header(r, 'content-type')).toContain('font/woff2');
      expect(header(r, 'cache-control')).toMatch(/immutable/);
    }
  });
  test('while Paper Mono loads, the fallback has the same character width (so text does not re-wrap and jump)', async ({ request }) => {
    const html = await (await request.get('/')).text();
    expect(html).toMatch(/font-family:\s*['"]?Paper Mono Fallback Consolas['"]?[^}]*size-adjust:\s*110\.2%/);
    expect(html).toMatch(/font-family:\s*['"]?Paper Mono Fallback['"]?[^}]*size-adjust:\s*101%/);
    expect(html).toMatch(/--font-body:\s*['"]Paper Mono['"],\s*['"]Paper Mono Fallback Consolas['"],\s*['"]Paper Mono Fallback['"]/);
  });
});

test.describe('Cloudflare Web Analytics beacon (Cloudflare adds it to HTML pages when the feature is on)', () => {
  const BEACON = 'https://static.cloudflareinsights.com', REPORT = 'https://cloudflareinsights.com';
  test('public pages allow exactly the two Cloudflare hosts it needs, and nothing broader', async ({ request }) => {
    for (const path of ['/', '/projects', '/projects/wanderhost-booking', '/contact', '/now', '/resume', '/no-such-page']) {
      const csp = header(await request.get(path), 'content-security-policy');
      expect(cspDirective(csp, 'script-src'), path).toContain(BEACON);
      expect(cspDirective(csp, 'connect-src'), path).toContain(REPORT);
      for (const s of cspDirective(csp, 'script-src')!) expect(s).not.toMatch(/^('unsafe-inline'|'unsafe-eval'|\*|https?:|data:|blob:)$/);
    }
  });
  test('sign-in and the dashboard do NOT allow it (admin pages are not tracked)', async ({ request, playwright, baseURL }) => {
    expect(header(await request.get('/auth'), 'content-security-policy')).not.toContain('cloudflareinsights');
    const authed = await playwright.request.newContext({ baseURL, storageState: 'tests/.auth/admin.json' });
    expect(header(await authed.get('/dashboard'), 'content-security-policy')).not.toContain('cloudflareinsights');
    await authed.dispose();
  });
  test('real browser: a beacon script added the way Cloudflare does it runs on a public page, and is blocked on sign-in', async ({ page }) => {
    await page.route(`${BEACON}/**`, (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.__beacon = 1;' }));
    const inject = () => page.evaluate(() => new Promise<boolean>((done) => {
      const s = document.createElement('script'); s.defer = true; s.src = 'https://static.cloudflareinsights.com/beacon.min.js/test';
      s.onload = () => done(true); s.onerror = () => done(false); document.body.appendChild(s);
    }));
    await openPage(page, '/');
    expect(await inject(), 'beacon should load on a public page').toBe(true);
    expect(await page.evaluate(() => (window as any).__beacon)).toBe(1);
    await openPage(page, '/auth');
    expect(await inject(), 'beacon must be blocked on the sign-in page').toBe(false);
  });
});

test.describe('pages without diagrams ship almost no JavaScript', () => {
  for (const path of ['/', '/projects', '/projects/pocket-ledger', '/now', '/resume', '/contact']) {
    test(`${path}`, async ({ page }) => {
      let bytes = 0; const files: string[] = [];
      page.on('response', async (r) => { if (/\/_astro\/.*\.js(\?|$)/.test(r.url())) { files.push(r.url().split('/').pop()!); bytes += (await r.body().catch(() => Buffer.alloc(0))).length; } });
      await openPage(page, path);
      expect(files.filter((f) => /diagrams|mermaid|cytoscape|katex|elk/i.test(f)), 'diagram code downloaded on a page with no diagram').toEqual([]);
      expect(bytes, `${files.join(', ')}`).toBeLessThan(30_000);
    });
  }
});
