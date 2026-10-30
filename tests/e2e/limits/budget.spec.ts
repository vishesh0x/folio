import { test, expect, withRetry } from '../fixtures';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { counted, signIn } from './counting';
import { d1, d1File, r2Put } from '../d1';
import { upload, pdf } from '../uploads';
import { r2Has } from '../d1';
import { scaleSql, scaleClear, scaleId, scaleFile } from '../../tools/seed-scale.mjs';

// Step 5: Workers limits on the FREE plan. A request may make at most 50 calls to Cloudflare services (database, file storage, the page cache,
// image processing, outgoing fetches) and use about 10 ms of CPU. Server E runs the site through a wrapper that COUNTS those calls (it changes nothing else).
// Rule used here: ordinary pages stay under a third of the limit; the two bulk jobs the owner can start (deleting a picture, cleaning old pictures) stay
// under it with room to spare, so adding one more step to either can never push a real request over the edge unnoticed.
test.describe.configure({ mode: 'serial' });
const FREE_LIMIT = 50;
const png = readFileSync('tests/fixtures/plain.png'), dirty = readFileSync('tests/fixtures/photo-gps.jpg');
let anon: any, owner: any, base: string;

test.beforeAll(async ({ playwright, baseURL }) => {
  base = baseURL!;
  anon = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
  owner = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
  await signIn(owner, baseURL!);
});
test.afterAll(async () => { await anon?.dispose(); await owner?.dispose(); });

test.describe('ordinary pages', () => {
  for (const path of ['/', '/projects', '/projects/wanderhost-booking', '/now', '/resume', '/contact', '/no-such-page', '/sitemap.xml', '/robots.txt']) {
    test(`a visitor's ${path} (built fresh, not from the page cache) makes few calls`, async () => {
      const { res, counts } = await counted(anon, base, 'GET', `${path}?fresh=${Math.random().toString(36).slice(2)}`);
      expect(res.status()).toBeLessThan(500);
      expect(counts.total, counts.calls.join('\n')).toBeLessThanOrEqual(Math.floor(FREE_LIMIT / 3));
    });
  }
  for (const path of ['/dashboard', '/dashboard/assets', '/dashboard/projects', '/dashboard/settings', '/dashboard/seo', '/dashboard/inbox', '/dashboard/now', '/dashboard/resume']) {
    test(`the owner's ${path} makes few calls`, async () => {
      const { res, counts } = await counted(owner, base, 'GET', path);
      expect(res.status()).toBe(200);
      expect(counts.total, counts.calls.join('\n')).toBeLessThanOrEqual(Math.floor(FREE_LIMIT / 3));
    });
  }
});

test.describe('the owner\'s bulk jobs', () => {
  test('deleting a picture (which forgets every cached size of it) stays under the limit, with a few calls to spare', async () => {
    const up = await upload(owner, base, `limits-${Date.now().toString(36)}.png`, 'image/png', png, 'x');
    const { res, counts } = await counted(owner, base, 'POST', '/api/admin/assets/delete', { form: { id: up.json.asset.id } });
    expect(decodeURIComponent(res.headers()['location'] ?? '')).toContain('ok=Deleted');
    expect(counts.cache, 'every variant this site can ask for (11 widths x AVIF/WebP/PNG, the share JPEG, the original and the "missing" marker)').toBe(11 * 3 + 1 + 2);
    // Measured: 44 of the 50 allowed. If this fails after adding a width to the ladder (src/lib/media.ts), the delete is about to stop fitting.
    expect(counts.total, counts.calls.join('\n')).toBeLessThanOrEqual(FREE_LIMIT - 5);
  });

  test('deleting a JPEG forgets one format less (its own format is the share-image format)', async () => {
    const jpg = readFileSync('tests/fixtures/photo-gps.jpg');
    const up = await upload(owner, base, `limits-${Date.now().toString(36)}.jpg`, 'image/jpeg', jpg, 'x');
    expect(up.status).toBe(200);
    const { res, counts } = await counted(owner, base, 'POST', '/api/admin/assets/delete', { form: { id: up.json.asset.id } });
    expect(decodeURIComponent(res.headers()['location'] ?? '')).toContain('ok=Deleted');
    expect(counts.cache).toBe(11 * 3 + 2);
  });

  test('deleting a PDF forgets only the two cached entries it can have', async () => {
    const up = await upload(owner, base, `limits-${Date.now().toString(36)}.pdf`, 'application/pdf', pdf(), null);
    expect(up.status).toBe(200);
    const { res, counts } = await counted(owner, base, 'POST', '/api/admin/assets/delete', { form: { id: up.json.asset.id } });
    expect(decodeURIComponent(res.headers()['location'] ?? '')).toContain('ok=Deleted');
    expect(counts.cache).toBe(2);
    expect(counts.total, counts.calls.join('\n')).toBeLessThanOrEqual(12);
  });

  test('a delete that runs out of calls still finishes: the file is gone, the owner sees "Deleted", not an error page', async () => {
    const up = await upload(owner, base, `limits-${Date.now().toString(36)}.png`, 'image/png', png, 'x');
    const id = up.json.asset.id as string, key = `assets/${id}/${up.json.asset.filename}`;
    expect(r2Has('e2e-e', key)).toBe(true);
    // the cache allows only 20 calls, as if it had been given more work than a request may do
    const { res, counts } = await counted(owner, base, 'POST', '/api/admin/assets/delete', { form: { id }, limitCache: 20 });
    expect(counts.refused, 'the squeeze was real: some cache calls were refused').toBeGreaterThan(0);
    expect(decodeURIComponent(res.headers()['location'] ?? '')).toContain('ok=Deleted');
    expect(d1('e2e-e', `SELECT id FROM assets WHERE id='${id}'`)).toHaveLength(0);
    expect(r2Has('e2e-e', key), 'the stored file was removed before the cache work began').toBe(false);
  });

  test('"Remove location data from existing pictures" does one batch of pictures per click, under the limit', async () => {
    const ids: string[] = [];
    const rows: string[] = [];
    for (let i = 0; i < 9; i++) {
      const id = `limdirty${String(i).padStart(4, '0')}`, key = `assets/${id}/photo-${i}.jpg`;
      r2Put('e2e-e', key, dirty); ids.push(id);
      rows.push(`INSERT INTO assets (id,r2_key,filename,mime,size,width,height,alt,decorative) VALUES ('${id}','${key}','photo-${i}.jpg','image/jpeg',${dirty.length},100,100,'x',0);`);
    }
    d1('e2e-e', rows.join(' '));
    try {
      const { res, counts } = await counted(owner, base, 'POST', '/api/admin/assets/storage', { form: { action: 'scrub', offset: '0' } });
      expect(res.status()).toBe(200);
      const body: any = await res.json();
      expect(JSON.stringify(body)).toMatch(/clean|scrub|done|fixed|removed/i);
      expect(counts.r2, 'it really read and rewrote pictures').toBeGreaterThanOrEqual(8);
      expect(counts.total, counts.calls.join('\n')).toBeLessThanOrEqual(FREE_LIMIT - 5);
    } finally { d1('e2e-e', `DELETE FROM assets WHERE id LIKE 'limdirty%'`); }
  });

  test('"Check storage" stays under the limit', async () => {
    const { res, counts } = await counted(owner, base, 'POST', '/api/admin/assets/storage', { form: { action: 'check' } });
    expect(res.status()).toBe(200);
    expect(counts.total, counts.calls.join('\n')).toBeLessThanOrEqual(FREE_LIMIT - 5);
  });
});

// The Files page lists every file. It must not ask the database more questions, or call anything more, as the library grows.
const tmp = () => join(mkdtempSync(join(tmpdir(), 'scale-')), 'seed.sql');
test.describe('the Files page as the library grows', () => {
  test.afterAll(() => { d1('e2e-e', scaleClear()); });
  test('it makes the same number of calls with 10 files as with 300, and draws at most one page of cards', async () => {
    d1('e2e-e', scaleClear());
    const f1 = tmp(); writeFileSync(f1, scaleSql({ assets: 10, projects: 5, bodyKb: 5 })); d1File('e2e-e', f1);
    const small = await counted(owner, base, 'GET', '/dashboard/assets');
    d1('e2e-e', scaleClear());
    const f2 = tmp(); writeFileSync(f2, scaleSql({ assets: 300, projects: 30, bodyKb: 20 })); d1File('e2e-e', f2);
    const big = await counted(owner, base, 'GET', '/dashboard/assets');
    expect(small.res.status()).toBe(200); expect(big.res.status()).toBe(200);
    expect(big.counts.total, `10 files: ${small.counts.total} calls, 300 files: ${big.counts.total}`).toBe(small.counts.total);
    const bigText = await big.res.text(), smallText = await small.res.text();
    const cards = (bigText.match(/<li class="file"/g) ?? []).length, fewer = (smallText.match(/<li class="file"/g) ?? []).length;
    expect(cards, '300 files are listed 48 at a time').toBe(48);
    // The page's CPU cost is mostly drawing one card per file (about 12 microseconds each, measured), so the weight of ONE card is what to watch (today about 2.3 KB):
    // the difference between a page of 48 cards and a page of 10, divided by the 38 extra cards.
    expect((bigText.length - smallText.length) / (cards - fewer), 'bytes per card').toBeLessThan(3_500);
  });
});
