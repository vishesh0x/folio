import { test, expect } from '@playwright/test';
import { AUTH_FILE } from '../helpers';

// Step 6: what search engines and link previews see. Server A, as an anonymous visitor.
test.use({ storageState: { cookies: [], origins: [] } });
const PUBLIC = ['/', '/projects', '/projects/wanderhost-booking', '/projects/pocket-ledger', '/now', '/resume', '/contact'];

type Meta = { title: string; lang: string; viewport: string | null; desc: string | null; canonical: string[]; robots: string | null; og: Record<string, string>; tw: Record<string, string>; h: number[]; ld: string[]; };
async function meta(page: any, path: string): Promise<{ status: number; headers: Record<string, string>; m: Meta }> {
  const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
  const m = await page.evaluate(() => ({
    title: document.title, lang: document.documentElement.lang, viewport: document.querySelector('meta[name=viewport]')?.getAttribute('content') ?? null,
    desc: document.querySelector('meta[name=description]')?.getAttribute('content') ?? null, canonical: [...document.querySelectorAll('link[rel=canonical]')].map((l) => l.getAttribute('href')!),
    robots: document.querySelector('meta[name=robots]')?.getAttribute('content') ?? null,
    og: Object.fromEntries([...document.querySelectorAll('meta[property^="og:"],meta[property^="article:"]')].map((e) => [e.getAttribute('property')!, e.getAttribute('content')!])),
    tw: Object.fromEntries([...document.querySelectorAll('meta[name^="twitter:"]')].map((e) => [e.getAttribute('name')!, e.getAttribute('content')!])),
    h: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1])), ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent ?? ''),
  }));
  return { status: res!.status(), headers: res!.headers(), m: m as Meta };
}

test.describe('every public page', () => {
  const titles = new Map<string, string>();
  for (const path of PUBLIC) {
    test(`${path}: title, description, language, canonical address, headings and sharing tags are all right`, async ({ page }) => {
      const { status, headers, m } = await meta(page, path);
      expect(status).toBe(200);
      expect(headers['x-robots-tag'], 'public pages are not marked noindex by header').toBeUndefined();
      expect(m.robots, 'and not by tag').toBeNull();
      expect(m.lang).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/);
      expect(m.viewport).toContain('width=device-width');
      expect(m.title.length, 'a title').toBeGreaterThan(3); expect(m.title.length, 'short enough to show in a result').toBeLessThanOrEqual(70);
      expect(titles.get(m.title), `title "${m.title}" is already used by ${titles.get(m.title)}`).toBeUndefined(); titles.set(m.title, path);
      expect((m.desc ?? '').length, 'a description').toBeGreaterThan(10); expect(m.desc!.length).toBeLessThanOrEqual(320);
      // one canonical address: an absolute https URL for exactly this page
      expect(m.canonical, 'exactly one canonical link').toHaveLength(1);
      const canon = new URL(m.canonical[0]);
      expect(canon.protocol).toBe('https:'); expect(canon.pathname).toBe(path); expect(canon.search + canon.hash).toBe('');
      // sharing tags agree with the page
      expect(m.og['og:url']).toBe(m.canonical[0]); expect(m.og['og:title']).toBe(m.title);
      expect(m.og['og:description']).toBe(m.desc); expect(m.og['og:site_name']).toBeTruthy(); expect(['website', 'article']).toContain(m.og['og:type']);
      const img = m.og['og:image'];
      expect(m.tw['twitter:card'], 'a big preview card only when there is an image').toBe(img ? 'summary_large_image' : 'summary');
      if (img) { expect(new URL(img).protocol).toBe('https:'); expect(m.og['og:image:alt'], 'the image has a description').toBeTruthy(); expect(m.og['og:image:type']).toBe('image/jpeg'); }
      // headings: one h1, and the outline never jumps down a level (h2 straight to h4)
      expect(m.h.filter((n) => n === 1), 'exactly one h1').toHaveLength(1); expect(m.h[0]).toBe(1);
      m.h.forEach((n, i) => { if (i) expect(n, `heading ${i} follows h${m.h[i - 1]}`).toBeLessThanOrEqual(m.h[i - 1] + 1); });
    });
  }
  test('a project page says when it was published and updated, and offers a share image description', async ({ page }) => {
    const { m } = await meta(page, '/projects/wanderhost-booking');
    expect(m.og['og:type']).toBe('article');
    for (const k of ['article:published_time', 'article:modified_time']) expect(new Date(m.og[k]).toISOString(), k).toBe(m.og[k]);
  });
});

test.describe('structured data (JSON-LD)', () => {
  for (const path of [...PUBLIC]) {
    test(`${path}: every block is valid JSON for schema.org and cannot break out of its script tag`, async ({ page, request }) => {
      const { m } = await meta(page, path);
      for (const raw of m.ld) { const j = JSON.parse(raw); expect(j['@context']).toBe('https://schema.org'); expect(j['@type']).toBeTruthy(); }
      const html = await (await request.get(path)).text();
      for (const block of html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) ?? []) expect(block.slice(40, -9), 'no raw "<" inside').not.toContain('<');
    });
  }
  test('the home page describes the site and the person; a project describes the work and its place in the site', async ({ page }) => {
    const home = (await meta(page, '/')).m.ld.map((x) => JSON.parse(x));
    expect(home.map((x) => x['@type']).sort()).toEqual(['Person', 'WebSite']);
    const proj = await meta(page, '/projects/wanderhost-booking');
    const blocks = proj.m.ld.map((x) => JSON.parse(x));
    const crumbs = blocks.find((x) => x['@type'] === 'BreadcrumbList');
    expect(crumbs.itemListElement.map((i: any) => i.position)).toEqual([1, 2, 3]);
    expect(crumbs.itemListElement.map((i: any) => i.name)).toEqual(['Home', 'Projects', 'WanderHost booking platform']);
    for (const i of crumbs.itemListElement) expect(new URL(i.item).protocol).toBe('https:');
    expect(crumbs.itemListElement[2].item, 'the last crumb is this page').toBe(proj.m.canonical[0]);
    const work = blocks.find((x) => x['@type'] === 'CreativeWork');
    expect(work.name).toBe('WanderHost booking platform'); expect(new Date(work.dateCreated).toISOString()).toBe(work.dateCreated);
  });
});

test.describe('pages that must stay out of search results', () => {
  for (const [path, status] of [['/auth', 200], ['/no-such-page', 404], ['/projects/secret-draft', 404], ['/error/403', 403]] as [string, number][]) {
    test(`${path} (${status}) is marked noindex and names no canonical address`, async ({ page }) => {
      const { status: got, headers, m } = await meta(page, path);
      expect(got).toBe(status);
      expect(m.robots).toContain('noindex');
      expect(m.canonical, 'nothing to be the preferred copy of').toEqual([]);
      if (path !== '/no-such-page' && path !== '/projects/secret-draft') expect(headers['x-robots-tag']).toBe('noindex, nofollow');
    });
  }
  test('sign-in, error pages and the download carry a noindex header; a visitor who asks for the owner area is only redirected to sign-in', async ({ request }) => {
    for (const path of ['/auth', '/error/401', '/resume/download']) expect((await request.get(path, { maxRedirects: 0 })).headers()['x-robots-tag'], path).toBe('noindex, nofollow');
    for (const path of ['/dashboard', '/dashboard/assets']) { const r = await request.get(path, { maxRedirects: 0 }); expect([r.status(), r.headers()['location']], path).toEqual([302, '/auth']); }
  });
  test('the owner area carries the noindex header once signed in', async ({ playwright, baseURL }) => {
    const owner = await playwright.request.newContext({ baseURL, storageState: AUTH_FILE });
    for (const path of ['/dashboard', '/dashboard/assets', '/dashboard/projects']) { const r = await owner.get(path, { maxRedirects: 0 }); expect(r.status(), path).toBe(200); expect(r.headers()['x-robots-tag'], path).toBe('noindex, nofollow'); }
    await owner.dispose();
  });
});

test.describe('sitemap.xml and robots.txt', () => {
  test('the sitemap lists every public page once, with absolute addresses, and nothing private', async ({ request }) => {
    const r = await request.get('/sitemap.xml');
    expect(r.status()).toBe(200); expect(r.headers()['content-type']).toMatch(/xml/);
    const xml = await r.text();
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\s*<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(new Set(locs).size, 'no repeats').toBe(locs.length);
    const paths = locs.map((l) => { const u = new URL(l); expect(u.protocol).toBe('https:'); expect(u.search + u.hash).toBe(''); return u.pathname; });
    for (const p of ['/', '/projects', '/projects/wanderhost-booking', '/projects/pocket-ledger', '/now', '/resume', '/contact']) expect(paths, p).toContain(p);
    for (const bad of ['/auth', '/dashboard', '/projects/secret-draft', '/404', '/500']) expect(paths, `${bad} must not be listed`).not.toContain(bad);
    expect(paths.filter((p) => /^\/(dashboard|api|auth|error|media)\b/.test(p))).toEqual([]);
    for (const d of xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) expect(d[1]).toMatch(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/);
  });
  test('every address in the sitemap really is an indexable page', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    for (const m of xml.matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g)) {
      const r = await request.get(m[1], { maxRedirects: 0 });
      expect(r.status(), m[1]).toBe(200);
      expect(r.headers()['x-robots-tag'] ?? '', m[1]).not.toContain('noindex');
      expect(await r.text(), m[1]).not.toMatch(/<meta name="robots" content="[^"]*noindex/);
    }
  });
  test('robots.txt points at the sitemap, keeps crawlers out of private areas, and does not hide what pages need to render', async ({ request }) => {
    const t = await (await request.get('/robots.txt')).text();
    expect(t).toMatch(/^Sitemap: https:\/\/[^\s]+\/sitemap\.xml$/m);
    for (const d of ['/dashboard', '/auth', '/api/']) expect(t).toContain(`Disallow: ${d}`);
    for (const must of ['/_astro/', '/media/', '/']) expect(t, `${must} stays crawlable`).not.toMatch(new RegExp(`^Disallow: ${must}$`, 'm'));
    expect(t).toMatch(/^User-agent: \*$/m);
  });
});
