import { test, expect } from '../fixtures';
import { withRetry } from '../fixtures';
import { AUTH_FILE, header, sameOrigin } from '../helpers';

// Step 2: cache rules. Public pages are cached at the edge by the Worker (Cache API), keyed by a "content version" that moves on at every
// dashboard save, so a save shows up at once and nothing ever needs purging. Browsers always revalidate (cheap 304).
const anon = { cookies: [], origins: [] };
const PAGES = ['/', '/projects', '/projects/wanderhost-booking', '/now', '/resume'];
const REVALIDATE = 'public, max-age=0, must-revalidate';

/** Any dashboard save moves the content version on. "Mark all read" is the lightest one. */
async function save(playwright: any, baseURL: string) {
  const ctx = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
  const r = await ctx.post('/api/admin/inbox', { form: { action: 'mark-all-read' }, headers: sameOrigin(baseURL), maxRedirects: 0 });
  expect(r.status()).toBe(303);
  await ctx.dispose();
}
const etagOf = async (request: any, path: string) => header(await request.get(path), 'etag');

test.describe('public pages: edge cache', () => {
  test.use({ storageState: anon });

  for (const path of PAGES) {
    test(`${path}: the second request is a cache HIT with a validator, revalidated by the browser`, async ({ request }) => {
      await request.get(path);
      const r = await request.get(path);
      expect(header(r, 'x-cache')).toBe('HIT');
      expect(header(r, 'cache-control')).toBe(REVALIDATE);
      expect(header(r, 'etag')).toMatch(/^"v\d+-[\w]+"$/);
      expect(header(r, 'set-cookie'), 'a cacheable page must never carry a cookie').toBe('');
      expect(header(r, 'vary')).not.toMatch(/cookie/i);
    });
  }

  test('tracking tags (utm_*, fbclid, gclid, ref) share the cached copy; any other query string is never cached', async ({ request }) => {
    await request.get('/projects'); const base = await etagOf(request, '/projects');
    for (const q of ['?utm_source=x&utm_medium=y', '?fbclid=abc', '?gclid=1', '?ref=friend']) {
      const r = await request.get('/projects' + q);
      expect(header(r, 'x-cache'), q).toBe('HIT'); expect(header(r, 'etag'), q).toBe(base);
    }
    for (const q of ['?a=1', '?q=hello', '?utm_source=x&other=1']) {
      const r = await request.get('/projects' + q);
      expect(header(r, 'x-cache'), `${q} must bypass the cache`).toBe('');
      expect(header(r, 'etag')).toBe('');
    }
  });

  test('cache keys cannot be multiplied by a visitor: random query strings do not create cache entries', async ({ request }) => {
    for (let i = 0; i < 5; i++) expect(header(await request.get(`/now?junk=${i}`), 'x-cache')).toBe('');
  });

  test('POST and other methods are never answered from the cache', async ({ request, baseURL }) => {
    await request.get('/now');
    const r = await request.post('/now', { data: {}, headers: sameOrigin(baseURL!) });
    expect(header(r, 'x-cache')).toBe('');
  });
});

test.describe('conditional requests (the 304 that makes revisits nearly free)', () => {
  test.use({ storageState: anon });

  test('strong, weak (as a compressing CDN would send it), listed and * validators all give an empty 304', async ({ request }) => {
    await request.get('/now'); const e = await etagOf(request, '/now');
    for (const v of [e, `W/${e}`, `"nope", ${e}`, `W/"nope", W/${e}`]) {
      const r = await request.get('/now', { headers: { 'if-none-match': v } });
      expect(r.status(), v).toBe(304); expect((await r.body()).length, 'a 304 has no body').toBe(0);
      expect(header(r, 'etag')).toBe(e); expect(header(r, 'cache-control')).toBe(REVALIDATE);
    }
  });
  test('a stale or different validator gets the full page', async ({ request }) => {
    for (const v of ['"v1-old"', 'W/"v1-old"', '"v1-old", "v2-old"', '*']) {   // "*" is not a version we hold, so never a 304 for a page
      const r = await request.get('/now', { headers: { 'if-none-match': v } });
      expect(r.status(), v).toBe(200); expect((await r.body()).length).toBeGreaterThan(1000);
    }
  });
});

test.describe('a dashboard save shows up at once', () => {
  test.use({ storageState: anon });
  test('the ETag changes, the old validator stops matching, and the next request rebuilds then caches again', async ({ request, playwright, baseURL }) => {
    await request.get('/projects/pocket-ledger'); const before = await etagOf(request, '/projects/pocket-ledger');
    await save(playwright, baseURL!);
    expect((await request.get('/projects/pocket-ledger', { headers: { 'if-none-match': before } })).status(), 'old validator must not match').toBe(200);
    const after = await etagOf(request, '/projects/pocket-ledger');
    expect(after).not.toBe(before);
    expect(header(await request.get('/projects/pocket-ledger'), 'x-cache')).toBe('HIT');
  });
});

test.describe('pages that must never be cached', () => {
  test('sign-in, the contact form (one-time token), dashboard and admin API are private, no-store', async ({ request, playwright, baseURL }) => {
    for (const p of ['/auth', '/contact']) expect(header(await request.get(p), 'cache-control'), p).toBe('private, no-store');
    const authed = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
    for (const p of ['/dashboard', '/dashboard/projects', '/dashboard/now', '/dashboard/settings']) {
      const r = await authed.get(p); expect(header(r, 'cache-control'), p).toBe('private, no-store'); expect(header(r, 'x-cache')).toBe('');
    }
    await authed.dispose();
    expect(header(await request.get('/api/admin/projects/1/export'), 'cache-control')).toContain('no-store');
  });
});

test.describe('one address per page', () => {
  test.use({ storageState: anon });
  for (const [from, to] of [['/projects/', '/projects'], ['/now/', '/now'], ['/projects/wanderhost-booking/', '/projects/wanderhost-booking'], ['/projects/?utm_source=x', '/projects?utm_source=x'], ['/robots.txt/', '/robots.txt']] as const) {
    test(`${from} → 301 ${to}`, async ({ request }) => {
      const r = await request.get(from, { maxRedirects: 0 });
      expect(r.status()).toBe(301); expect(new URL(header(r, 'location'), 'http://x').pathname + new URL(header(r, 'location'), 'http://x').search).toBe(to);
      expect(header(r, 'cache-control')).toContain('max-age');
    });
  }
  test('the redirect can never leave the site (//host/ and ///host// style paths)', async ({ request, baseURL }) => {
    for (const p of ['//evil.example/', '///evil.example//', '/%2Fevil.example/', '//evil.example/path/']) {
      const r = await request.get(`${baseURL}${p}`, { maxRedirects: 0 });
      if (r.status() === 301 || r.status() === 302) {
        const loc = header(r, 'location');
        expect(loc.startsWith('//'), `${p} → ${loc}`).toBe(false);
        expect(new URL(loc, baseURL).origin, `${p} → ${loc}`).toBe(new URL(baseURL!).origin);
      }
    }
  });
  test('the dashboard and sign-in are not rewritten (they keep answering as before)', async ({ request }) => {
    const r = await request.get('/dashboard/', { maxRedirects: 0 });
    expect(r.status()).toBe(302); expect(header(r, 'location')).toMatch(/\/auth$/);
  });
});

test.describe('pages that are not found', () => {
  test.use({ storageState: anon });
  test('a missing project is remembered for a minute (no database work per repeat), without a validator', async ({ request, playwright, baseURL }) => {
    const first = await request.get('/projects/does-not-exist-yet');
    expect(first.status()).toBe(404);
    const again = await request.get('/projects/does-not-exist-yet');
    expect(again.status()).toBe(404); expect(header(again, 'x-cache')).toBe('HIT'); expect(header(again, 'etag')).toBe('');
    expect((await request.get('/projects/does-not-exist-yet', { headers: { 'if-none-match': '*' } })).status(), 'a 404 is never turned into a 304').toBe(404);
    await save(playwright, baseURL!);   // publishing it would bump the version the same way
    expect(header(await request.get('/projects/does-not-exist-yet'), 'x-cache')).toBe('MISS');
  });
});

test.describe('static files', () => {
  test.use({ storageState: anon });
  test('built scripts and fonts are cached for a year and marked immutable (their names change when they do)', async ({ request }) => {
    const html = await (await request.get('/projects/wanderhost-booking')).text();
    const files = [...new Set([...html.matchAll(/(?:src|href)="(\/_astro\/[^"]+)"/g)].map((m) => m[1]))];
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      const r = await request.get(f);
      expect(r.status(), f).toBe(200); expect(header(r, 'cache-control'), f).toBe('public, max-age=31536000, immutable');
      expect(f, 'immutable files need content-hashed names').toMatch(/\.[A-Za-z0-9_-]{8}\.\w+$/);
    }
  });
});

test.describe('sitemap, robots, manifest, icons', () => {
  test.use({ storageState: anon });
  for (const path of ['/sitemap.xml', '/robots.txt', '/manifest.webmanifest', '/icons/favicon.svg']) {
    test(`${path} is built once per content version, then served from the edge`, async ({ request }) => {
      await request.get(path);
      const r = await request.get(path);
      expect(r.status()).toBe(200); expect(header(r, 'x-cache')).toBe('HIT'); expect(header(r, 'cache-control')).toMatch(/max-age=\d+/);
    });
  }
  test('the sitemap lists published pages only, and a save refreshes it', async ({ request, playwright, baseURL }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    expect(xml).toContain('/projects/wanderhost-booking'); expect(xml).not.toContain('secret-draft');
    expect(xml).toMatch(/^<\?xml/); expect(xml).toContain('<loc>https://visheshraghuvanshi.in/projects/wanderhost-booking</loc>');
    await save(playwright, baseURL!);
    expect(header(await request.get('/sitemap.xml'), 'x-cache')).toBe('MISS');
  });
  test('icon URLs cannot create cache entries: unknown names are refused early, ?v= values share one entry', async ({ request }) => {
    for (const p of ['/icons/nope.png', '/icons/../x', '/icons/1.png']) expect([404], p).toContain((await request.get(p)).status());
    await request.get('/icons/favicon.svg?v=1');
    for (const v of ['2', 'abc', 'zzz']) expect(header(await request.get(`/icons/favicon.svg?v=${v}`), 'x-cache')).toBe('HIT');
  });
  test('/favicon.ico is a cacheable redirect (browsers ask for it on their own)', async ({ request }) => {
    const r = await request.get('/favicon.ico', { maxRedirects: 0 });
    expect(r.status()).toBe(302); expect(header(r, 'cache-control')).toBe('public, max-age=3600'); expect(header(r, 'location')).toMatch(/^\/icons\//);
  });
});
