import { test, expect, withRetry } from '../fixtures';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signIn, OWNER } from './counting';
import { d1, d1File } from '../d1';
import { scaleSql, scaleClear, scaleFile } from '../../tools/seed-scale.mjs';

// Step 5 (follow-up): the Files page shows 48 files at a time. Filter, search and page live in the address (so they work without JavaScript, can be
// reloaded and shared), and the cost of the page no longer grows with the size of the library.
test.describe.configure({ mode: 'serial' });
const N = 130, PDFS = 5, PER = 48;
let owner: any, base: string;
let B = { all: 0, image: 0, pdf: 0 };
const total = () => N + PDFS + B.all, pages = () => Math.ceil(total() / PER);      // files already on the server before this test adds its own

const names = (html: string) => [...html.matchAll(/<p class="file-name" title="([^"]*)"/g)].map((m) => m[1]);
const get = async (qs = '') => { const r = await owner.get(`/dashboard/assets${qs}`); expect(r.status()).toBe(200); return r.text() as Promise<string>; };

test.beforeAll(async ({ playwright, baseURL }) => {
  base = baseURL!;
  owner = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
  await signIn(owner, baseURL!);
  d1('e2e-e', scaleClear());
  const [c] = d1('e2e-e', "SELECT COUNT(*) AS n, COALESCE(SUM(mime LIKE 'image/%'),0) AS i FROM assets") as any[];
  B = { all: c.n, image: c.i, pdf: c.n - c.i };
  const f = join(mkdtempSync(join(tmpdir(), 'paging-')), 'seed.sql');
  const pdfs = Array.from({ length: PDFS }, (_, i) => `INSERT INTO assets (id,r2_key,filename,mime,size,alt,decorative) VALUES ('scalepdf${String(i).padStart(4, '0')}','assets/scalepdf${i}/Doc-${i}.pdf','Doc-${i}.pdf','application/pdf',1000,'',0);`).join('\n');
  writeFileSync(f, scaleSql({ assets: N, projects: 2, bodyKb: 2 }) + '\n' + pdfs + `\nUPDATE assets SET alt = 'Sunset over the harbour' WHERE id = 'scale0000042';`);
  d1File('e2e-e', f);
});
test.afterAll(async () => { d1('e2e-e', scaleClear()); await owner?.dispose(); });

test('page 1 shows the newest 48 files, says what it is showing, and offers the next page', async () => {
  const h = await get();
  expect(names(h)).toHaveLength(PER);
  expect(h).toContain(`Showing 1–${PER} of ${total()}.`);
  expect(h).toContain(`Page 1 of ${pages()}`);
  expect(h).toMatch(/href="\/dashboard\/assets\?page=2"[^>]*rel="next"/);
  expect(h, 'there is no "previous" link on the first page').not.toContain('rel="prev"');
});

test('the pages together show every file exactly once, in order, with no gaps and no repeats', async () => {
  const seen: string[] = [];
  for (const p of [1, 2, 3]) seen.push(...names(await get(p === 1 ? '' : `?page=${p}`)));
  expect(seen).toHaveLength(total());
  expect(new Set(seen).size).toBe(total());
  const photos = seen.filter((n) => n.startsWith('Photo-')).map((n) => Number(n.match(/\d+/)![0]));
  expect(photos, 'newest first').toEqual([...photos].sort((a, b) => b - a));
  expect((await get('?page=3')).match(/rel="next"/)).toBeNull();
  expect(names(await get('?page=3'))).toHaveLength(total() - 2 * PER);
});

test('a page number that makes no sense falls back to something sensible, never an error', async () => {
  expect(await get('?page=99999')).toContain(`Page ${pages()} of ${pages()}`);
  for (const bad of ['?page=0', '?page=-4', '?page=abc', '?page=1e9', '?page=', '?page=2&page=3']) expect(names(await get(bad)).length, bad).toBeGreaterThan(0);
  expect(await get('?page=0')).toContain(`Page 1 of ${pages()}`);
});

test('the filter buttons count the whole library and each shows only its kind', async () => {
  const h = await get();
  expect(h).toMatch(new RegExp(`All <span>${total()}</span>`));
  expect(h).toMatch(new RegExp(`Images <span>${N + B.image}</span>`));
  expect(h).toMatch(new RegExp(`PDFs <span>${PDFS + B.pdf}</span>`));
  expect(names(await get('?type=pdf')).filter((n) => n.startsWith('Doc-')).sort()).toEqual(Array.from({ length: PDFS }, (_, i) => `Doc-${i}.pdf`).sort());
  const imgs = names(await get('?type=image'));
  expect(imgs).toHaveLength(PER); expect(imgs.every((n) => !n.endsWith('.pdf'))).toBe(true);
  expect(await get('?type=image')).toMatch(/aria-current="true"[^>]*>Images/);
  expect(names(await get('?type=nonsense')), 'an unknown type means all files').toHaveLength(PER);
});

test('search finds files by name or description, ignoring capitals, and the page links keep the search', async () => {
  expect(names(await get('?q=photo-12')).sort()).toEqual(['Photo-12.jpg', ...Array.from({ length: 10 }, (_, i) => `Photo-12${i}.jpg`)].sort());
  expect(names(await get('?q=PHOTO-12'))).toHaveLength(11);
  expect(names(await get('?q=HARBOUR'))).toEqual([scaleFile(42)]);               // found through its description
  const h = await get('?q=photo&type=image');
  expect(h).toMatch(/href="\/dashboard\/assets\?type=image&amp;q=photo&amp;page=2"/);
  expect(h).toContain('value="photo"');                                           // the box keeps what was typed
});

test('nothing matching says so; hostile or odd search text is just text', async () => {
  const none = await get('?q=zzzz-no-such-file');
  expect(none).toContain('No files match.'); expect(names(none)).toHaveLength(0); expect(none).toContain('>Clear<');
  for (const q of ["' OR 1=1 --", '%', '_', '%%%%', '"; DROP TABLE assets; --', '<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', 'x'.repeat(500), '\u0000', '😀']) {
    const r = await owner.get('/dashboard/assets', { params: { q } });
    expect(r.status(), q.slice(0, 20)).toBe(200);
    const h = await r.text();
    expect(names(h), `"${q.slice(0, 20)}" matches nothing literal`).toHaveLength(0);
    if (q.includes('"')) expect(h, 'a double quote cannot break out of the search box\'s value="..."').not.toMatch(/value="[^"]*"[^>]*onerror/);
  }
  expect(names(await get()), 'the table is intact').toHaveLength(PER);
});

test('a library of any size draws at most one page of cards, and the page stays light', async () => {
  const h = await get();
  expect((h.match(/<li class="file"/g) ?? []).length).toBe(PER);
  expect(h.length / PER, 'bytes of page per card').toBeLessThan(5_000);
});

test('in a real browser: Older, Images, search and Clear work with the mouse and the keyboard', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: base });
  await ctx.addCookies((await owner.storageState()).cookies);
  const page = await ctx.newPage();
  await page.goto('/dashboard/assets');
  await expect(page.locator('li.file')).toHaveCount(PER);
  await page.getByRole('link', { name: 'Older →' }).click();
  await expect(page).toHaveURL(/page=2$/); await expect(page.getByText(`Page 2 of ${pages()}`)).toBeVisible();
  await page.getByRole('link', { name: /^Images/ }).click();
  await expect(page).toHaveURL(/type=image$/); await expect(page.locator('li.file')).toHaveCount(PER);
  await page.getByRole('searchbox', { name: 'Search files' }).fill('photo-7'); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/type=image&q=photo-7/);
  await expect(page.locator('li.file')).toHaveCount(11);       // Photo-7, Photo-70..79
  await page.getByRole('link', { name: 'Clear' }).click();
  await expect(page).toHaveURL(/type=image$/);
  await ctx.close();
});

test('it works with JavaScript switched off (filters and paging are plain links and a plain form)', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: base, javaScriptEnabled: false });
  await ctx.addCookies((await owner.storageState()).cookies);
  const page = await ctx.newPage();
  await page.goto('/dashboard/assets?type=pdf');
  await expect(page.locator('li.file')).toHaveCount(PDFS + B.pdf);
  await page.getByRole('searchbox', { name: 'Search files' }).fill('doc-3'); await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('li.file')).toHaveCount(1);
  void OWNER; await ctx.close();
});

test('search text that tries to break out of the page is shown as plain text and runs nothing', async ({ browser }) => {
  const payload = '"><img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
  const ctx = await browser.newContext({ baseURL: base });
  await ctx.addCookies((await owner.storageState()).cookies);
  const page = await ctx.newPage();
  await page.goto('/dashboard/assets?q=' + encodeURIComponent(payload));
  await expect(page.getByRole('searchbox', { name: 'Search files' })).toHaveValue(payload.slice(0, 80));
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  await ctx.close();
});
