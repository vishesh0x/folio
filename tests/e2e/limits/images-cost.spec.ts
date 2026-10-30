import { test, expect, withRetry } from '../fixtures';
import { readFileSync } from 'node:fs';
import { counted, signIn } from './counting';
import { upload } from '../uploads';
import { r2Has } from '../d1';

// Step 7: Cloudflare bills EVERY call to the Images binding as a transformation (5,000 a month free), and the page cache is per DATA CENTER with a
// 7-day life. Each resized picture is therefore made once and kept in R2; another data center reads that copy instead of transforming again.
// "x-count-other-colo" makes the counting server behave like a data center that has never seen the picture.
const png = readFileSync('tests/fixtures/plain.png');
let owner: any, base: string;
test.beforeAll(async ({ playwright, baseURL }) => {
  base = baseURL!; owner = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } })); await signIn(owner, baseURL!);
});
test.afterAll(async () => { await owner?.dispose(); });
const fresh = async (tag: string) => { const up = await upload(owner, base, `cost-${tag}-${Date.now().toString(36)}.png`, 'image/png', png, 'x'); return { id: up.json.asset.id as string, name: up.json.asset.filename as string }; };
const get = (id: string, name: string, q: string, o: { otherColo?: boolean; failImages?: boolean } = {}) => counted(owner, base, 'GET', `/media/${id}/${name}?${q}`, o);

test('a size is transformed once; the copy is kept in R2; a data center without a cached copy reads it instead of transforming again', async () => {
  const { id, name } = await fresh('once');
  const first = await get(id, name, 'w=640&f=avif');
  expect(first.res.status()).toBe(200);
  expect(first.counts.images, 'made once').toBe(1);
  expect(r2Has('e2e-e', `variants/${id}/640-avif`), 'and kept').toBe(true);
  const bytes = (await first.res.body()).toString('base64');
  const elsewhere = await get(id, name, 'w=640&f=avif', { otherColo: true });
  expect(elsewhere.res.status()).toBe(200);
  expect(elsewhere.counts.images, 'no second transformation in another data center').toBe(0);
  expect((await elsewhere.res.body()).toString('base64'), 'the same picture').toBe(bytes);
  expect(elsewhere.res.headers()['content-type']).toBe('image/avif');
  expect(elsewhere.res.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
});

test('6 sizes seen by 4 data centers each cost 6 transformations, not 24', async () => {
  const { id, name } = await fresh('many');
  let images = 0;
  for (const q of ['w=320&f=avif', 'w=640&f=webp', 'w=720&f=avif', 'w=800&f=png', 'w=1024&f=webp', 'w=1280&f=jpeg']) {
    images += (await get(id, name, q)).counts.images;
    for (let colo = 0; colo < 3; colo++) images += (await get(id, name, q, { otherColo: true })).counts.images;
  }
  expect(images).toBe(6);
});

test('deleting a picture removes its kept resized copies too', async () => {
  const { id, name } = await fresh('del');
  for (const q of ['w=640&f=avif', 'w=640&f=webp', 'w=1280&f=jpeg']) await get(id, name, q);
  for (const k of ['640-avif', '640-webp', '1280-jpeg']) expect(r2Has('e2e-e', `variants/${id}/${k}`), k).toBe(true);
  const del = await counted(owner, base, 'POST', '/api/admin/assets/delete', { form: { id } });
  expect(decodeURIComponent(del.res.headers()['location'] ?? '')).toContain('ok=Deleted');
  for (const k of ['640-avif', '640-webp', '1280-jpeg']) expect(r2Has('e2e-e', `variants/${id}/${k}`), `${k} removed`).toBe(false);
  expect(del.counts.total, del.counts.calls.join('\n')).toBeLessThanOrEqual(45);
  expect((await get(id, name, 'w=640&f=avif', { otherColo: true })).res.status(), 'and nothing is served any more').toBe(404);
});

test('when a resized picture cannot be made (allowance used up) the visitor still gets the picture, briefly, and it is NOT remembered for long', async () => {
  const { id, name } = await fresh('fail');
  const bad = await get(id, name, 'w=640&f=avif', { failImages: true });
  expect(bad.res.status()).toBe(200);
  expect(bad.res.headers()['content-type'], 'the original stands in').toBe('image/png');
  expect(bad.res.headers()['cache-control'], 'short-lived, never immutable').toBe('public, max-age=60');
  expect(bad.res.headers()['x-degraded']).toBeUndefined();
  expect(r2Has('e2e-e', `variants/${id}/640-avif`), 'nothing is kept').toBe(false);
  const good = await get(id, name, 'w=640&f=avif');                     // the problem has passed: the real thing replaces the stand-in at once
  expect(good.counts.images).toBe(1);
  expect(good.res.headers()['content-type']).toBe('image/avif');
  expect(good.res.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
});
