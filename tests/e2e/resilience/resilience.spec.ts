import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, freshIp, header, sameOrigin, cspDirective } from '../helpers';
import { SETUP_TOKEN } from '../../../playwright.config';
import { d1, breakDb, restoreDb } from '../d1';
import { readFileSync } from 'node:fs';

// Step 3: "what does the site do when the database is unavailable?" Server D has its own database, which these tests really break (every
// table renamed away, so every query fails) and then restore. The rules being checked:
//   public pages that were already cached keep working (fail OPEN: a visitor loses nothing);
//   everything that needs the database answers 503 + Retry-After and never pretends to succeed (fail CLOSED: nothing is written, nobody is let in);
//   no placeholder page is ever cached, and everything comes back by itself.
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);
const BASE = 'http://localhost:8789';
const anon = { cookies: [], origins: [] };
let admin: APIRequestContext, visitor: APIRequestContext;
const get = (path: string, ctx = visitor) => ctx.get(BASE + path, { maxRedirects: 0, headers: { connection: 'close', 'cf-connecting-ip': freshIp() } });
const count = (sql: string) => d1('e2e-d', sql)[0].n as number;

test.afterAll(async () => { try { restoreDb('e2e-d'); } catch {} await admin?.dispose(); await visitor?.dispose(); });

test('only one first administrator can be created, even when several setups arrive together', async () => {
  const racer = await pwRequest.newContext({ baseURL: BASE, storageState: anon });   // whoever creates the account is signed in as it, so keep that apart from the anonymous visitor
  const setup = (i: number) => racer.post('/auth', { form: { mode: 'setup', token: SETUP_TOKEN, email: `race${i}@example.com`, password: ADMIN_PASSWORD, confirm: ADMIN_PASSWORD }, headers: { ...sameOrigin(BASE, freshIp()), connection: 'close' }, maxRedirects: 0 });
  const rs = await Promise.all([0, 1, 2, 3, 4, 5].map(setup));
  const codes = rs.map((r) => r.status()).sort();
  expect(codes.filter((c) => c === 302).length, `statuses ${codes}`).toBe(1);
  expect(codes.filter((c) => c === 403 || c === 409).length).toBe(5);
  expect(count('SELECT count(*) n FROM users')).toBe(1);
  const email = d1('e2e-d', 'SELECT email FROM users')[0].email as string;
  await racer.dispose();
  visitor = await pwRequest.newContext({ baseURL: BASE, storageState: anon });
  admin = await pwRequest.newContext({ baseURL: BASE });
  const l = await admin.post('/auth', { form: { mode: 'login', email, password: ADMIN_PASSWORD }, headers: { ...sameOrigin(BASE, freshIp()), connection: 'close' }, maxRedirects: 0 });
  expect(l.status()).toBe(302);
});

test.describe('while the database is down', () => {
  let msgsBefore = 0, unreadBefore = 0;
  const warmed = ['/', '/projects', '/projects/wanderhost-booking', '/now'];

  test.beforeAll(async () => {
    for (const p of warmed) { await get(p); expect((await get(p)).status(), p).toBe(200); }
    expect((await get('/media/demoCover0001/x.png?w=640&f=webp')).status()).toBe(200);
    msgsBefore = count('SELECT count(*) n FROM messages');
    d1('e2e-d', "INSERT INTO messages (name, email, body, is_read) VALUES ('t', 't@example.com', 'unread one', 0)"); unreadBefore = count('SELECT count(*) n FROM messages WHERE is_read = 0'); msgsBefore++;
    await new Promise((r) => setTimeout(r, 3000));     // the test server counts a page as fresh for 2 s, so by now the warmed pages are "stale"
    breakDb('e2e-d');
    await new Promise((r) => setTimeout(r, 6000));     // let the 5 s content-version memo expire, so nothing can lean on remembered database answers
  });
  test.afterAll(() => { restoreDb('e2e-d'); });

  test('pages already in the cache are still served, with their real content, even though they are past their freshness window', async () => {
    for (const p of warmed) {
      const r = await get(p);
      expect(r.status(), p).toBe(200);
      expect(header(r, 'x-cache'), p).toBe('STALE');
      expect(header(r, 'cache-control')).toBe('public, max-age=0, must-revalidate');
      expect(await r.text(), 'real branding, not placeholder').toContain('Vishesh Raghuvanshi');
    }
  });
  test('a cached image keeps being served; an image that was never built is a clean 503', async () => {
    const hit = await get('/media/demoCover0001/x.png?w=640&f=webp'); expect(hit.status()).toBe(200); expect(header(hit, 'x-cache')).toBe('HIT');
    const miss = await get('/media/demoCover0001/x.png?w=1600&f=png'); expect(miss.status()).toBe(503); expect(header(miss, 'retry-after')).toBe('30');
  });
  test('a page that was never cached answers 503: Retry-After, never stored, no database-free lies about the site', async () => {
    for (const p of ['/projects/pocket-ledger', '/resume', '/auth']) {
      const r = await get(p);
      expect(r.status(), p).toBe(503);
      expect(header(r, 'retry-after'), p).toBe('30'); expect(header(r, 'cache-control')).toBe('no-store');
      expect(header(r, 'content-type')).toContain('text/html'); expect(header(r, 'x-content-type-options')).toBe('nosniff'); expect(header(r, 'x-frame-options')).toBe('DENY');
      expect(cspDirective(header(r, 'content-security-policy'), 'default-src')).toEqual(["'none'"]);
      const body = await r.text();
      expect(body).toContain('Back in a moment'); expect(body).toContain('<meta name="robots" content="noindex">');
      expect(body).not.toMatch(/Your Name|Error:|D1_|SQLITE|no such table|at .*\.(ts|js):\d+/);   // nothing internal is shown
    }
  });
  test('someone with no session is still sent to sign-in without needing the database at all', async () => {
    const r = await get('/dashboard'); expect(r.status()).toBe(302); expect(header(r, 'location')).toMatch(/\/auth$/);
  });
  test('API calls answer 503 as JSON', async () => {
    const r = await visitor.post(BASE + '/api/reveal', { data: { kind: 'email' }, headers: { ...sameOrigin(BASE, freshIp()), connection: 'close' } });
    expect(r.status()).toBe(503); expect(header(r, 'retry-after')).toBe('30'); expect(header(r, 'content-type')).toContain('application/json');
    expect((await r.json()).error).toMatch(/temporarily unavailable/i);
  });
  test('writes fail closed: the contact form says the message was NOT sent, and nothing is stored', async () => {
    const r = await visitor.post(BASE + '/contact', { form: { name: 'T', email: 't@example.com', message: 'This must not vanish silently', website: '', t: '1.x' }, headers: { ...sameOrigin(BASE, freshIp()), connection: 'close' }, maxRedirects: 0 });
    expect(r.status()).toBe(503); expect(await r.text()).toContain('it was not sent');
  });
  test('nobody can sign in, and a signed-in owner is not shown anything', async () => {
    const l = await visitor.post(BASE + '/auth', { form: { mode: 'login', email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, headers: { ...sameOrigin(BASE, freshIp()), connection: 'close' }, maxRedirects: 0 });
    expect(l.status()).toBe(503); expect(header(l, 'set-cookie'), 'no session may be issued').toBe('');
    const dash = await get('/dashboard', admin); expect(dash.status()).toBe(503); expect(await dash.text()).not.toContain('Overview');
    const write = await admin.post(BASE + '/api/admin/inbox', { form: { action: 'mark-all-read' }, headers: { ...sameOrigin(BASE, freshIp()), connection: 'close' }, maxRedirects: 0 });
    expect(write.status()).toBe(503);
  });
  test('an upload is refused with 503 and leaves nothing in storage', async () => {
    const r = await admin.post(BASE + '/api/admin/assets/upload', { multipart: { file: { name: 'x.png', mimeType: 'image/png', buffer: readFileSync('tests/fixtures/plain.png') }, alt: 'during the outage' }, headers: { ...sameOrigin(BASE, freshIp()), connection: 'close' }, maxRedirects: 0 });
    expect(r.status()).toBe(503); expect(header(r, 'retry-after')).toBe('30');
  });
  test('error pages still render (they must not depend on the database), flagged so they are never cached', async () => {
    const r = await get('/definitely-not-a-page');
    expect(r.status()).toBe(404); expect(await r.text()).toContain('wandered off'); expect(header(r, 'x-cache')).toBe('');
  });
  test('a missing project address during the outage is a 503, not a (cacheable) 404', async () => {
    expect((await get('/projects/typo-during-outage')).status()).toBe(503);
  });

  test.describe('after it comes back', () => {
    test.beforeAll(() => { restoreDb('e2e-d'); });
    test('the site recovers by itself, with no restart', async () => {
      await expect.poll(async () => (await get('/projects/pocket-ledger')).status(), { timeout: 20_000, intervals: [1000] }).toBe(200);
      expect((await get('/auth')).status()).toBe(200);
      const l = await admin.get(BASE + '/dashboard', { maxRedirects: 0 }); expect(l.status()).toBe(200);
    });
    test('the failed writes left no trace, and the owner can still sign in', async () => {
      expect(count('SELECT count(*) n FROM messages')).toBe(msgsBefore);
      expect(count('SELECT count(*) n FROM messages WHERE is_read = 0'), '"mark all read" must not have half-applied').toBe(unreadBefore);
      const relog = await visitor.post(BASE + '/auth', { form: { mode: 'login', email: d1('e2e-d', 'SELECT email FROM users')[0].email, password: ADMIN_PASSWORD }, headers: { ...sameOrigin(BASE, freshIp()), connection: 'close' }, maxRedirects: 0 });
      expect(relog.status()).toBe(302);
    });
    test('storage and the database still agree: the refused upload left no stray file and no entry', async () => {
      const r = await admin.post(BASE + '/api/admin/assets/storage', { form: { action: 'check', min_age: '0' }, headers: { ...sameOrigin(BASE, freshIp()), connection: 'close' } });
      const j = await r.json(); expect(j.strays, JSON.stringify(j.strays)).toEqual([]); expect(j.broken).toEqual([]);
    });
    test('nothing from the outage was cached: pages built now are real, the stale copy is replaced', async () => {
      const first = await get('/'); const body = await first.text();
      expect(first.status()).toBe(200); expect(body).toContain('Vishesh Raghuvanshi'); expect(body).not.toContain('Your Name');
      expect(header(first, 'x-cache')).toBe('MISS');
      expect(header(await get('/'), 'x-cache')).toBe('HIT');
      const gone = await get('/projects/typo-during-outage'); expect(gone.status()).toBe(404); expect(header(gone, 'x-cache')).toBe('MISS');
    });
  });
});

test.describe('a failure of just ONE query must not produce a wrong page that gets cached', () => {
  // The old code swallowed such errors and used defaults, so a "hide from search" page could be built without its noindex and kept for 5 minutes.
  test('with the search-hiding settings unreadable, the page fails (503) instead of being built without noindex', async () => {
    restoreDb('e2e-d');
    d1('e2e-d', "INSERT OR REPLACE INTO seo_pages (page, noindex) VALUES ('resume', 1)");
    breakDb('e2e-d', ['seo_pages']);
    try {
      const during = await get('/resume');
      expect(during.status(), 'must fail, never serve a page that has lost its noindex').toBe(503);
    } finally { restoreDb('e2e-d', ['seo_pages']); }
    const after = await get('/resume');
    expect(after.status()).toBe(200); expect(header(after, 'x-cache')).toBe('MISS');
    expect(await after.text()).toMatch(/<meta name="robots" content="noindex/);
  });
  test('with the main settings unreadable, a normal page fails (503); it is not built with "Your Name" and cached', async () => {
    // a page nobody has requested yet (a cached older copy would, correctly, be shown instead: see "stale" above)
    breakDb('e2e-d', ['settings']);
    try { expect((await get('/projects/edge-notes')).status()).toBe(503); } finally { restoreDb('e2e-d', ['settings']); }
    const r = await get('/projects/edge-notes'); expect(r.status()).toBe(200); expect(header(r, 'x-cache')).toBe('MISS'); expect(await r.text()).toContain('Vishesh Raghuvanshi');
  });
});
