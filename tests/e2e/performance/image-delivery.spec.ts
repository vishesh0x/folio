import { test, expect, withRetry } from '../fixtures';
import { AUTH_FILE, header, sameOrigin } from '../helpers';

// Step 2: Cloudflare Images pipeline. Every image goes through /media with a snapped width and an explicit format (AVIF, WebP, original).
// The important property: ONE cache entry per (image, width, format). Anything else a visitor can put in the URL must not cause new work.
const anon = { cookies: [], origins: [] };
const ID = 'demoCover0001';
const RUNGS = [160, 320, 480, 640, 720, 800, 900, 1024, 1280, 1600, 2000];   // = WIDTHS in src/lib/media.ts
// A real 1x1 PNG, used to upload a throwaway image for the delete test
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.describe('media: one cache entry per image variant', () => {
  test.use({ storageState: anon });

  test('headers: a year in the browser, immutable, validator, nosniff; MISS then HIT both say so', async ({ request }) => {
    const url = `/media/${ID}/a.png?w=640&f=avif`;
    const first = await request.get(url);
    if (header(first, 'x-cache') === 'MISS') expect(header(first, 'cache-control')).toBe('public, max-age=31536000, immutable');
    const r = await request.get(url);
    expect(header(r, 'x-cache')).toBe('HIT');
    expect(header(r, 'cache-control')).toBe('public, max-age=31536000, immutable');   // the shared cache's own copy is stored for a week (next test)
    expect(header(r, 'etag')).toBe(`"${ID}-640-avif"`);
    expect(header(r, 'content-type')).toBe('image/avif');
    expect(header(r, 'x-content-type-options')).toBe('nosniff');
  });

  test('the shared cache keeps its own copy for a week only, even though browsers keep theirs for a year', async () => {
    const src = (await import('node:fs')).readFileSync('src/lib/media.ts', 'utf8');
    expect(src).toContain("const EDGE = 'public, max-age=604800, immutable';");
    expect(src).toMatch(/stored\.set\('Cache-Control', EDGE\)/);                       // what is put in the shared cache
    expect(src).toMatch(/h\.set\('Cache-Control', FOREVER\)/);                         // what is sent out on a hit
  });

  test('a 644-pixel slot (PageSpeed on a phone: 368 CSS px at 1.75x) is served the 720 file, not the 800 one', async ({ request }) => {
    const at = async (w: number) => (await (await request.get(`/media/${ID}/a.png?w=${w}&f=avif`)).body()).toString('base64');
    const [a644, a720, a721, a800] = [await at(644), await at(720), await at(721), await at(800)];
    expect(a644, '644 snaps to 720').toBe(a720);
    expect(a721, '721 is a different (bigger) file: 800').toBe(a800);
    expect(a721).not.toBe(a720);
  });

  test('junk query strings, other file names and widths that snap to the same size all share the one entry', async ({ request }) => {
    await request.get(`/media/${ID}/a.png?w=480&f=webp`);
    const variants = [`/media/${ID}/a.png?w=480&f=webp&x=1`, `/media/${ID}/other-name.png?w=480&f=webp`, `/media/${ID}/a.png?w=470&f=webp`, `/media/${ID}/a.png?w=321&f=webp`, `/media/${ID}/a.png?f=webp&w=479.5&utm_source=x`];
    const base = await (await request.get(`/media/${ID}/a.png?w=480&f=webp`)).body();
    for (const v of variants) {
      const r = await request.get(v);
      expect(header(r, 'x-cache'), v).toBe('HIT');
      expect((await r.body()).equals(base), `${v} must be byte-identical`).toBe(true);
    }
  });

  test('widths snap to the fixed ladder, so there are at most 9 sizes per format', async ({ request }) => {
    for (const w of [1, 100, 161, 479, 1025, 1999, 2001, 99999]) {
      const r = await request.get(`/media/${ID}/a.png?w=${w}&f=avif`);
      expect(r.status(), `w=${w}`).toBe(200);
      const snapped = RUNGS.find((x) => x >= w) ?? 2000;
      expect(header(r, 'etag'), `w=${w}`).toBe(`"${ID}-${snapped}-avif"`);
    }
  });

  test('bad or missing width/format fall back to the original file, never to something new', async ({ request }) => {
    const orig = await (await request.get(`/media/${ID}/a.png`)).body();
    for (const q of ['?w=0&f=avif', '?w=-5&f=avif', '?w=abc&f=avif', '?w=800', '?f=avif', '?w=800&f=gif', '?w=800&f=../../etc', '?w=800&f=']) {
      const r = await request.get(`/media/${ID}/a.png${q}`);
      expect(r.status(), q).toBe(200); expect(header(r, 'content-type'), q).toBe('image/png');
      expect((await r.body()).equals(orig), q).toBe(true);
    }
  });

  test('the original supports 304 (strong or weak validator), and so does every cached variant', async ({ request }) => {
    for (const [url, tag] of [[`/media/${ID}/a.png`, `"${ID}"`], [`/media/${ID}/a.png?w=800&f=webp`, `"${ID}-800-webp"`]] as const) {
      await request.get(url);
      for (const v of [tag, `W/${tag}`]) {
        const r = await request.get(url, { headers: { 'if-none-match': v } });
        expect(r.status(), `${url} ${v}`).toBe(304); expect((await r.body()).length).toBe(0);
      }
      expect((await request.get(url, { headers: { 'if-none-match': '"other"' } })).status()).toBe(200);
    }
  });

  test('ids that cannot be real never reach the database; unknown real-looking ids are remembered for a minute', async ({ request }) => {
    for (const id of ['x', 'short', 'a'.repeat(40), 'bad%20id!!', '..%2f..%2fetc']) {
      const r = await request.get(`/media/${id}/a.png`);
      expect(r.status(), id).toBe(404); expect(header(r, 'x-cache'), id).toBe(''); expect(header(r, 'cache-control')).toBe('no-store');
    }
    const id = `nope${Date.now()}`;
    expect((await request.get(`/media/${id}/a.png`)).status()).toBe(404);
    const again = await request.get(`/media/${id}/a.png?w=800&f=avif`);   // any variant of an unknown id
    expect(again.status()).toBe(404); expect(header(again, 'x-cache')).toBe('HIT');
  });

  test('the SVG/PDF safety headers still apply to originals', async ({ request }) => {
    const r = await request.get(`/media/${ID}/a.png`);
    expect(header(r, 'cross-origin-resource-policy')).toBe('cross-origin'); expect(header(r, 'content-disposition')).toContain('inline');
  });
});

test.describe('deleting an image removes every cached copy straight away', () => {
  test('upload → cached variants served → delete → all gone (no stale image for a week)', async ({ playwright, baseURL }) => {
    const admin = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
    const h = sameOrigin(baseURL!);
    const up = await admin.post('/api/admin/assets/upload', { multipart: { file: { name: 'tiny.png', mimeType: 'image/png', buffer: PNG_1PX }, alt: 'tiny' }, headers: h });
    expect(up.status()).toBe(200);
    const id: string = (await up.json()).asset.id;
    const visitor = withRetry(await playwright.request.newContext({ baseURL }));
    // every kind of variant this site's own pages can ask for: the original, WebP, AVIF, the picture's own format, and the share-image JPEG
    const urls = [`/media/${id}/tiny.png`, `/media/${id}/tiny.png?w=160&f=webp`, `/media/${id}/tiny.png?w=320&f=avif`, `/media/${id}/tiny.png?w=720&f=png`, `/media/${id}/tiny.png?w=900&f=avif`, `/media/${id}/tiny.png?w=1280&f=jpeg`];
    for (const u of urls) { await visitor.get(u); expect(header(await visitor.get(u), 'x-cache'), u).toBe('HIT'); }
    const del = await admin.post('/api/admin/assets/delete', { form: { id }, headers: h, maxRedirects: 0 });
    expect(del.status()).toBe(303); expect(header(del, 'location')).toContain('ok=');
    for (const u of urls) expect((await visitor.get(u)).status(), `${u} still served after delete`).toBe(404);
    await admin.dispose(); await visitor.dispose();
  });
});

test.describe('format negotiation and responsive markup', () => {
  test.use({ storageState: anon });

  test('every picture offers AVIF then WebP then the original, with dimensions, from the width ladder only', async ({ request }) => {
    for (const path of ['/', '/projects', '/projects/wanderhost-booking']) {
      const html = await (await request.get(path)).text();
      const pics = html.match(/<picture>[\s\S]*?<\/picture>/g) ?? [];
      expect(pics.length, path).toBeGreaterThan(0);
      for (const p of pics) {
        expect(p).toMatch(/<source type="image\/avif" srcset=/); expect(p).toMatch(/<source type="image\/webp" srcset=/);
        expect(p.indexOf('image/avif')).toBeLessThan(p.indexOf('image/webp'));
        expect(p).toMatch(/<img [^>]*width="\d+"[^>]*height="\d+"|<img [^>]*height="\d+"[^>]*width="\d+"/);
        expect(p).toMatch(/<img [^>]*\balt="/);
        for (const m of p.matchAll(/[?&]w=(\d+)/g)) expect(RUNGS, `${path}: w=${m[1]} is not on the ladder`).toContain(Number(m[1]));
        for (const m of p.matchAll(/\/media\/[^\s"]+/g)) expect(m[0], 'image URLs must be same-site /media').toMatch(/^\/media\/[\w-]+\/[^?]+\?w=\d+&amp;f=(avif|webp|png|jpeg)/);
      }
    }
  });

  test('the AVIF and WebP files really are those formats and smaller than the original', async ({ request }) => {
    const html = await (await request.get('/projects')).text();
    const pic = html.match(/<picture>[\s\S]*?<\/picture>/)![0];
    const pick = (type: string) => /srcset="([^"]+)"/.exec(pic.match(new RegExp(`<source type="image/${type}"[^>]*>`))![0])![1].split(',').map((s) => s.trim().split(' ')[0].replace(/&amp;/g, '&')).pop()!;
    const sizes: Record<string, number> = {};
    for (const [type, mime] of [['avif', 'image/avif'], ['webp', 'image/webp']] as const) {
      const r = await request.get(pick(type)); expect(header(r, 'content-type')).toBe(mime); sizes[type] = (await r.body()).length;
    }
    const fallback = await request.get(/<img src="([^"]+)"/.exec(pic)![1].replace(/&amp;/g, '&'));
    sizes.fallback = (await fallback.body()).length;
    expect(sizes.avif, JSON.stringify(sizes)).toBeLessThan(sizes.fallback); expect(sizes.webp, JSON.stringify(sizes)).toBeLessThan(sizes.fallback);
  });

  test('share image: a JPEG no wider than 1280px on the same site, for every page', async ({ request }) => {
    for (const path of ['/projects/wanderhost-booking', '/projects/pocket-ledger']) {   // (the demo site has no site-wide share image, so the home page has none)
      const html = await (await request.get(path)).text();
      const og = /<meta property="og:image" content="([^"]+)"/.exec(html)![1].replace(/&amp;/g, '&');
      expect(og, path).toMatch(/^https:\/\/visheshraghuvanshi\.in\/media\/[\w-]+\/[^?]+\?w=(1280|1024|800)&f=jpeg$/);
      const r = await request.get(new URL(og).pathname + new URL(og).search);
      expect(header(r, 'content-type')).toBe('image/jpeg'); expect((await r.body()).length, 'share images should stay light').toBeLessThan(1_500_000);
    }
  });
});

test.describe('regression: the "unknown id" marker must never hide a real image', () => {
  test.use({ storageState: anon });
  test('with the original already cached, a variant that was never built is still built (not a 404)', async ({ request }) => {
    expect((await request.get(`/media/${ID}/first.png`)).status()).toBe(200);            // original is now cached
    for (const q of ['?w=160&f=png', '?w=1600&f=webp', '?w=2000&f=avif']) expect((await request.get(`/media/${ID}/first.png${q}`)).status(), q).toBe(200);
  });
});
