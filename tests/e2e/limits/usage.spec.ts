import { test, expect, withRetry } from '../fixtures';
import { counted, signIn } from './counting';

// Step 7: the Workers FREE plan's DAILY allowances for D1 are 5,000,000 rows read and 100,000 rows written; when either is used up, EVERY query
// (so every page) fails until midnight UTC. These budgets are set a little above what each route costs today (measured with the counting server),
// so a change that makes a public page start writing, or read ten times more, fails here before it can matter.
//   what they allow:  reading: 5,000,000 / 50 rows = 100,000 uncached public page builds a day; writing: 100,000 rows = about 16,000 failed sign-ins a day.
test.describe.configure({ mode: 'serial' });
let anon: any, owner: any, base: string;
test.beforeAll(async ({ playwright, baseURL }) => {
  base = baseURL!;
  anon = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
  owner = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } })); await signIn(owner, baseURL!);
  for (const p of ['/', '/contact', '/projects']) await counted(anon, base, 'GET', `${p}?warm=1`);   // the first /contact view creates the form's signing key (one write, once ever)
});
test.afterAll(async () => { await anon?.dispose(); await owner?.dispose(); });
const q = () => Math.random().toString(36).slice(2);

test.describe('what a visitor costs', () => {
  for (const path of ['/', '/projects', '/projects/wanderhost-booking', '/now', '/resume', '/contact', '/robots.txt', '/sitemap.xml']) {
    test(`${path}, built fresh: reads at most 50 rows and writes none`, async () => {
      const { res, counts } = await counted(anon, base, 'GET', `${path}?fresh=${q()}`);
      expect(res.status()).toBe(200);
      expect(counts.rowsWritten, counts.calls.join('\n')).toBe(0);
      expect(counts.rowsRead, counts.calls.join('\n')).toBeLessThanOrEqual(50);
    });
  }
  test('a page from the cache reads and writes nothing at all', async () => {
    await counted(anon, base, 'GET', '/projects');
    const { counts } = await counted(anon, base, 'GET', '/projects');
    expect([counts.rowsRead, counts.rowsWritten, counts.d1]).toEqual([0, 0, 0]);
  });
  test('a page that does not exist (what bots scanning for /wp-admin hit) reads a few rows, writes none', async () => {
    const { res, counts } = await counted(anon, base, 'GET', `/wp-login-${q()}.php`);
    expect(res.status()).toBe(404);
    expect(counts.rowsRead).toBeLessThanOrEqual(20); expect(counts.rowsWritten).toBe(0);
  });
  test('a picture reads at most one row on its first request and nothing afterwards', async () => {
    const first = await counted(anon, base, 'GET', '/media/demoCover0001/x.png?w=640&f=webp');
    expect(first.counts.rowsRead).toBeLessThanOrEqual(1); expect(first.counts.rowsWritten).toBe(0);
    const again = await counted(anon, base, 'GET', '/media/demoCover0001/x.png?w=640&f=webp');
    expect([again.counts.rowsRead, again.counts.rowsWritten]).toEqual([0, 0]);
  });
  test('someone guessing picture addresses costs nothing after the first guess', async () => {
    const id = 'ZZZZZZZZZZZZ';
    await counted(anon, base, 'GET', `/media/${id}/a.png`);
    const { res, counts } = await counted(anon, base, 'GET', `/media/${id}/a.png?w=640&f=avif`);
    expect(res.status()).toBe(404); expect(counts.rowsRead).toBe(0); expect(counts.rowsWritten).toBe(0);
  });
});

test.describe('what a hostile visitor can make the site write', () => {
  const ip = () => `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
  test('a failed sign-in writes at most 8 rows, and nothing once that visitor is throttled', async ({ playwright }) => {
    const v = withRetry(await playwright.request.newContext({ baseURL: base, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { 'cf-connecting-ip': ip() } }));
    const bad = { mode: 'login', email: 'nobody@example.com', password: 'not the password 1' };
    const first = await counted(v, base, 'POST', '/auth', { form: bad });
    expect(first.res.status()).toBe(401); expect(first.counts.rowsWritten).toBeLessThanOrEqual(8);
    let last = first;
    for (let i = 0; i < 25 && last.res.status() !== 429; i++) last = await counted(v, base, 'POST', '/auth', { form: bad });
    expect(last.res.status(), 'the visitor is throttled after a few failures').toBe(429);
    const more = await counted(v, base, 'POST', '/auth', { form: bad });
    expect([more.res.status(), more.counts.rowsWritten], 'a throttled visitor writes nothing').toEqual([429, 0]);
    await v.dispose();
  });
  test('a rejected contact form writes nothing', async ({ playwright }) => {
    const v = withRetry(await playwright.request.newContext({ baseURL: base, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { 'cf-connecting-ip': ip() } }));
    const { res, counts } = await counted(v, base, 'POST', '/contact', { form: { name: 'A', email: 'a@example.com', message: 'hello there', website: '', t: '1' } });
    expect(res.status()).toBe(400); expect(counts.rowsWritten).toBe(0);
    await v.dispose();
  });
});

test.describe('what the owner costs', () => {
  for (const path of ['/dashboard', '/dashboard/projects', '/dashboard/assets', '/dashboard/settings', '/dashboard/seo', '/dashboard/inbox', '/dashboard/now', '/dashboard/resume']) {
    test(`${path} reads at most 100 rows and writes none`, async () => {
      const { res, counts } = await counted(owner, base, 'GET', path);
      expect(res.status()).toBe(200);
      expect(counts.rowsWritten, counts.calls.join('\n')).toBe(0);
      expect(counts.rowsRead, counts.calls.join('\n')).toBeLessThanOrEqual(100);
    });
  }
});
