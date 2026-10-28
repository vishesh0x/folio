import { test, expect, withRetry } from '../fixtures';
import { readFileSync } from 'node:fs';
import { AUTH_FILE, header, sameOrigin } from '../helpers';
import { upload, removeAsset } from '../uploads';
import { d1, r2Put, r2Has } from '../d1';

// Step 4: files that are in storage but not on the Files list ("stray") cost space and are public to anyone with the address; entries whose
// file is missing ("broken") show empty pictures. The Storage check on the Files page finds both, and removes strays only.
test.describe.configure({ mode: 'serial' });
test.use({ storageState: AUTH_FILE });
const plain = readFileSync('tests/fixtures/plain.png');
const ask = async (a: any, baseURL: string, action: 'check' | 'clean', minAge = 0) =>
  (await a.post('/api/admin/assets/storage', { form: { action, min_age: String(minAge) }, headers: sameOrigin(baseURL), maxRedirects: 0 })).json();

test('a healthy site: no stray files, no broken entries (the starting point for the tests below)', async ({ playwright, baseURL }) => {
  const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
  const r = await ask(a, baseURL!, 'check');
  expect(r.ok).toBe(true); expect(r.objects).toBeGreaterThan(0); expect(r.strays, JSON.stringify(r.strays)).toEqual([]); expect(r.broken, JSON.stringify(r.broken)).toEqual([]); expect(r.truncated).toBe(false);
  await a.dispose();
});

test('a stray file is found, ignored while young, removed on request, and nothing the site uses is touched', async ({ playwright, baseURL }) => {
  const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE })), visitor = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
  const kept = await upload(a, baseURL!, 'keep.png', 'image/png', plain, 'Keep me');
  r2Put('e2e-a', 'assets/straytest01/left-over.png', Buffer.alloc(1500, 1)); r2Put('e2e-a', 'assets/straytest02/other.pdf', Buffer.alloc(700, 2));
  const young = await ask(a, baseURL!, 'check', 3600);
  expect(young.strays, 'files younger than an hour might be an upload in progress').toEqual([]);
  const r = await ask(a, baseURL!, 'check', 0);
  expect(r.strays.map((s: any) => s.key).sort()).toEqual(['assets/straytest01/left-over.png', 'assets/straytest02/other.pdf']);
  expect(r.strays.map((s: any) => s.size).sort((x: number, y: number) => x - y)).toEqual([700, 1500]);
  expect(r.strays.some((s: any) => s.key.includes(kept.json.asset.id)), 'a file the site uses must never be called stray').toBe(false);
  const done = await ask(a, baseURL!, 'clean', 0);
  expect(done).toMatchObject({ ok: true, removed: 2, bytes: 2200 });
  expect(r2Has('e2e-a', 'assets/straytest01/left-over.png')).toBe(false); expect(r2Has('e2e-a', 'assets/straytest02/other.pdf')).toBe(false);
  expect((await visitor.get(kept.json.asset.url)).status(), 'the real file still works').toBe(200);
  expect(await ask(a, baseURL!, 'clean', 0)).toMatchObject({ removed: 0 });
  await removeAsset(a, baseURL!, kept.json.asset.id); await a.dispose(); await visitor.dispose();
});

test('a broken entry (listed, but its file is gone) is reported and never silently changed', async ({ playwright, baseURL }) => {
  const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
  d1('e2e-a', "INSERT INTO assets (id, r2_key, filename, mime, size) VALUES ('brokentest01', 'assets/brokentest01/gone.png', 'gone.png', 'image/png', 10)");
  try {
    const r = await ask(a, baseURL!, 'check', 0);
    expect(r.broken).toEqual([{ id: 'brokentest01', filename: 'gone.png' }]);
    await ask(a, baseURL!, 'clean', 0);
    expect(d1('e2e-a', "SELECT count(*) n FROM assets WHERE id = 'brokentest01'")[0].n, 'clean-up removes stray files only, never entries').toBe(1);
  } finally { d1('e2e-a', "DELETE FROM assets WHERE id = 'brokentest01'"); }
  await a.dispose();
});

test('deleting a file removes both the entry and the stored object', async ({ playwright, baseURL }) => {
  const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
  const up = await upload(a, baseURL!, 'bye.png', 'image/png', plain, 'Bye');
  const key = d1('e2e-a', `SELECT r2_key k FROM assets WHERE id = '${up.json.asset.id}'`)[0].k as string;
  expect(key).toMatch(/^assets\/[\w-]+\/bye\.png$/); expect(r2Has('e2e-a', key)).toBe(true);
  expect((await removeAsset(a, baseURL!, up.json.asset.id)).status()).toBe(303);
  expect(r2Has('e2e-a', key)).toBe(false); expect(d1('e2e-a', `SELECT count(*) n FROM assets WHERE id = '${up.json.asset.id}'`)[0].n).toBe(0);
  expect((await removeAsset(a, baseURL!, up.json.asset.id)).status(), 'deleting something already gone is not an error page').toBeLessThan(500);
  await a.dispose();
});

test('refused uploads leave nothing behind in storage', async ({ playwright, baseURL }) => {
  const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
  const before = (await ask(a, baseURL!, 'check', 0)).objects;
  for (const [n, m, b] of [['x.png', 'image/png', Buffer.from('<html>no</html>')], ['y.png', 'image/png', Buffer.from([1, 2, 3])]] as const) expect((await upload(a, baseURL!, n, m, b)).status).toBe(400);
  const r = await ask(a, baseURL!, 'check', 0);
  expect(r.objects).toBe(before); expect(r.strays).toEqual([]);
  await a.dispose();
});

test('the storage API is for the signed-in owner only, and tolerates odd input', async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });   // no session
  expect((await request.post('/api/admin/assets/storage', { form: { action: 'check' }, headers: sameOrigin(baseURL!), maxRedirects: 0 })).status()).toBe(401);
  const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
  await request.dispose();
  expect((await a.post('/api/admin/assets/storage', { form: { action: 'check' }, headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }, maxRedirects: 0 })).status()).toBe(403);
  for (const min_age of ['-5', 'abc', '99999999', '', '1e9']) expect((await a.post('/api/admin/assets/storage', { form: { action: 'check', min_age }, headers: sameOrigin(baseURL!) })).status(), min_age).toBe(200);
  expect((await a.post('/api/admin/assets/storage', { form: { action: 'explode' }, headers: sameOrigin(baseURL!) })).status()).toBe(400);
  await a.dispose();
});

test('the Files page offers the check, and shows its answer', async ({ page }) => {
  await page.goto('/dashboard/assets');
  await expect(page.getByRole('heading', { name: 'Storage check' })).toBeVisible();
  await page.getByRole('button', { name: 'Check storage' }).click();
  await expect(page.locator('[data-storage-result]')).toContainText(/\d+ files in storage/); await expect(page.locator('[data-storage-result]')).toContainText('No stray files.');
});

test.describe('pictures uploaded BEFORE uploads were cleaned automatically', () => {
  // Simulated the way it really happened: the file went into storage as the phone made it (location and all) with a database entry.
  const LEGACY = [['legacy00001', 'photo-gps.jpg', 'image/jpeg'], ['legacy00002', 'photo-meta.png', 'image/png'], ['legacy00003', 'photo-meta.webp', 'image/webp'], ['legacy00004', 'plain.png', 'image/png']] as const;
  const SECRETS = ['SecretCamera', 'SECRET-COMMENT', 'SECRET-XMP', 'SECRET-PERSON', 'SECRET-ITXT', 'SERIAL-1234'];
  const scrubAll = async (a: any, baseURL: string) => {
    let offset: number | null = 0; const total = { checked: 0, cleaned: 0, bytesSaved: 0, failed: 0 };
    for (let guard = 0; offset !== null && guard < 50; guard++) {
      const d: any = await (await a.post('/api/admin/assets/storage', { form: { action: 'scrub', offset: String(offset) }, headers: sameOrigin(baseURL) })).json();
      total.checked += d.checked; total.cleaned += d.cleaned; total.bytesSaved += d.bytesSaved; total.failed += d.failed; offset = d.next;
    }
    return total;
  };
  test('the Files page clean-up removes the data from old files, and only from files that have some', async ({ playwright, baseURL }) => {
    test.setTimeout(120_000);                       // sets up four files through the wrangler command line, about 3 s each
    const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE })), visitor = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
    const sizes: Record<string, number> = {};
    for (const [id, file, mime] of LEGACY) {
      const bytes = readFileSync(`tests/fixtures/${file}`); sizes[id] = bytes.length;
      r2Put('e2e-a', `assets/${id}/${file}`, bytes);
      d1('e2e-a', `INSERT OR REPLACE INTO assets (id, r2_key, filename, mime, size, width, height, alt) VALUES ('${id}', 'assets/${id}/${file}', '${file}', '${mime}', ${bytes.length}, 32, 32, 'legacy')`);
    }
    try {
      const body = async (id: string, file: string) => Buffer.from(await (await visitor.get(`/media/${id}/${file}`)).body());
      for (const [id, file] of LEGACY.slice(0, 3)) {                                       // the problem, demonstrated (and now cached, as it would be on a real site)
        const b = await body(id, file); await body(id, file);
        expect(SECRETS.filter((s) => b.toString('latin1').includes(s)).length, `${file} should still carry data before the clean-up`).toBeGreaterThan(0);
      }
      const first = await scrubAll(a, baseURL!);
      expect(first.failed).toBe(0); expect(first.cleaned, 'the three files with data').toBe(3); expect(first.bytesSaved).toBeGreaterThan(300);
      for (const [id, file] of LEGACY.slice(0, 3)) {
        const b = await body(id, file);                                                    // straight after: the cached old copy must be gone too
        expect(SECRETS.filter((s) => b.toString('latin1').includes(s)), `${file} still carries data after the clean-up`).toEqual([]);
        expect(b.length).toBeLessThan(sizes[id]);
        expect(d1('e2e-a', `SELECT size FROM assets WHERE id = '${id}'`)[0].size, 'the recorded size follows the file').toBe(b.length);
      }
      const plainBytes = await body('legacy00004', 'plain.png');
      expect(plainBytes.equals(readFileSync('tests/fixtures/plain.png')), 'a file with nothing to remove is left untouched').toBe(true);
      expect(d1('e2e-a', "SELECT size FROM assets WHERE id = 'legacy00004'")[0].size).toBe(sizes.legacy00004);
      const again = await scrubAll(a, baseURL!);
      expect(again.cleaned, 'running it again changes nothing').toBe(0);
    } finally { d1('e2e-a', "DELETE FROM assets WHERE id LIKE 'legacy0000%'"); await ask(a, baseURL!, 'clean', 0); }
    await a.dispose(); await visitor.dispose();
  });
  test('works through many pictures a few at a time (each request does a small, bounded amount of work)', async ({ playwright, baseURL }) => {
    const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
    const d: any = await (await a.post('/api/admin/assets/storage', { form: { action: 'scrub', offset: '0' }, headers: sameOrigin(baseURL!) })).json();
    expect(d.checked).toBeLessThanOrEqual(8); expect(d.ok).toBe(true);
    for (const offset of ['-3', 'abc', '99999999']) expect((await a.post('/api/admin/assets/storage', { form: { action: 'scrub', offset }, headers: sameOrigin(baseURL!) })).status(), offset).toBe(200);
    await a.dispose();
  });
});
