import { test, expect } from '../fixtures';
import { withRetry } from '../fixtures';
import { ADMIN_EMAIL, ADMIN_PASSWORD, AUTH_FILE, freshIp, sameOrigin, header, login } from '../helpers';

// Audit: everything under /dashboard and /api/admin must be unreachable without a valid session, including by URL tricks.
const anon = { cookies: [], origins: [] };

test.describe('unauthenticated', () => {
  test.use({ storageState: anon });

  const PAGES = ['/dashboard', '/dashboard/', '/dashboard/projects', '/dashboard/projects/1', '/dashboard/assets', '/dashboard/inbox', '/dashboard/inbox/1',
    '/dashboard/settings', '/dashboard/seo', '/dashboard/resume', '/dashboard/now',
    // URL-encoding / normalisation tricks aimed at the middleware's path check:
    '/%64ashboard', '/%64ashboard/settings', '//dashboard', '/dashboard/../dashboard', '/dashboard/%2e%2e/dashboard'];
  for (const p of PAGES) {
    test(`page ${p} redirects to /auth`, async ({ request, baseURL }) => {
      const res = await request.get(`${baseURL}${p}`, { maxRedirects: 0 }); // absolute URL: "//dashboard" alone would be read as a host name
      // either redirected to sign-in, or not found: never the page
      expect([302, 404], `${p} → ${res.status()}`).toContain(res.status());
      if (res.status() === 302) expect(header(res, 'location')).toMatch(/\/auth$/);
      expect(await res.text()).not.toContain('Dashboard');
    });
  }

  const API_GET = ['/api/admin/projects/1/export', '/api/%61dmin/projects/1/export'];
  for (const p of API_GET) test(`GET ${p} → 401`, async ({ request }) => {
    expect((await request.get(p, { maxRedirects: 0 })).status()).toBe(401);
  });

  const API_POST = ['/api/admin/inbox', '/api/admin/projects', '/api/admin/now', '/api/admin/preview', '/api/admin/assets', '/api/admin/assets/upload',
    '/api/admin/assets/delete', '/api/admin/assets/update', '/api/%61dmin/inbox'];
  for (const p of API_POST) test(`POST ${p} → 401 even with a spoofed same-origin header`, async ({ request, baseURL }) => {
    const res = await request.post(p, { data: { md: 'x' }, headers: sameOrigin(baseURL!), maxRedirects: 0 });
    expect(res.status()).toBe(401);
    expect(header(res, 'cache-control')).toContain('no-store');
  });

  test('a forged or garbage session cookie is rejected', async ({ request }) => {
    for (const name of ['__Host-session', 'session']) {
      const res = await request.get('/dashboard', { headers: { cookie: `${name}=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` }, maxRedirects: 0 });
      expect(res.status()).toBe(302);
    }
  });

  test('GET /auth/logout is not a logout (POST only)', async ({ request }) => {
    expect([404, 405]).toContain((await request.get('/auth/logout', { maxRedirects: 0 })).status());
  });

  test('first-admin registration is closed once an admin exists', async ({ request, baseURL }) => {
    const res = await request.post('/auth', {
      form: { mode: 'setup', token: 'e2e-setup-token-0123456789abcdef', email: 'second@example.com', password: 'another long password 123', confirm: 'another long password 123' },
      headers: sameOrigin(baseURL!), maxRedirects: 0,
    });
    expect(res.status()).toBe(403);
    expect(await res.text()).toContain('Registration is closed');
  });
});

test.describe('session cookie and lifecycle', () => {
  test.use({ storageState: anon });

  test('cookie is __Host-prefixed, HttpOnly, Secure, SameSite=Lax, path=/, no Domain', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'cf-connecting-ip': freshIp() } });
    const page = await ctx.newPage();
    await page.goto(`${baseURL}/auth`);
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.locator('#pw').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const c = (await ctx.cookies()).find((x) => x.name === '__Host-session')!;
    expect(c, 'session cookie present').toBeTruthy();
    expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    expect(c.value.length).toBeGreaterThanOrEqual(40); // 256 random bits
    expect(await page.evaluate(() => document.cookie)).not.toContain('session'); // invisible to scripts
    await ctx.close();
  });

  test('every login issues a different session token (no fixation)', async ({ playwright, baseURL }) => {
    const tokens: string[] = [];
    for (let i = 0; i < 2; i++) {
      const ctx = withRetry(await playwright.request.newContext({ baseURL }));
      const res = await login(ctx, baseURL!, ADMIN_EMAIL, ADMIN_PASSWORD, freshIp());
      expect(res.status()).toBe(302);
      tokens.push(/__Host-session=([^;]+)/.exec(header(res, 'set-cookie'))![1]);
      await ctx.dispose();
    }
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  test('logout kills the session on the server, so a copied cookie stops working', async ({ playwright, baseURL }) => {
    const ctx = withRetry(await playwright.request.newContext({ baseURL }));
    const res = await login(ctx, baseURL!, ADMIN_EMAIL, ADMIN_PASSWORD, freshIp());
    const cookie = `__Host-session=${/__Host-session=([^;]+)/.exec(header(res, 'set-cookie'))![1]}`;
    expect((await ctx.get('/dashboard', { maxRedirects: 0 })).status()).toBe(200);
    const out = await ctx.post('/auth/logout', { headers: sameOrigin(baseURL!), maxRedirects: 0 });
    expect(out.status()).toBe(303);
    const replay = withRetry(await playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie } }));
    expect((await replay.get('/dashboard', { maxRedirects: 0 })).status()).toBe(302);
    await replay.dispose(); await ctx.dispose();
  });

  test('dashboard responses are private and never cached', async ({ playwright, baseURL }) => {
    const ctx = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
    expect(header(await ctx.get('/dashboard'), 'cache-control')).toBe('private, no-store');
    await ctx.dispose();
  });
});
