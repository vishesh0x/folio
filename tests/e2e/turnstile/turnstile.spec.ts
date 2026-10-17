import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../fixtures';
import { freshIp, sameOrigin, header, cspDirective } from '../helpers';

// Audit 1.1: Cloudflare Turnstile. Runs against server B (both keys set) with a FAKE verifier on :9911 that can be told to
// succeed, fail, hang, drop the connection or answer garbage. "Fail closed" = in every one of those cases, nothing is handed out.
const V = 'http://127.0.0.1:9911';
let n = 0; const tok = (kind: string) => `${kind}-${Date.now()}-${++n}`;
const reveal = (request: APIRequestContext, baseURL: string, token: string | undefined, ip = freshIp(), kind = 'email') =>
  request.post('/api/reveal', { data: token === undefined ? { kind } : { kind, token }, headers: sameOrigin(baseURL, ip) });
const calls = async (request: APIRequestContext) => (await (await request.get(`${V}/calls`)).json()) as Array<{ token: string; secret: string; remoteip: string | null }>;

test.beforeEach(async ({ request }) => { await request.get(`${V}/reset`); });

// The fresh database has no site email, so a *valid* token ends in 404 "Not available" rather than 400 "spam check".
// 400 therefore means "Turnstile refused"; 404 means "Turnstile passed, nothing to show".
const REFUSED = 400, PASSED = 404;

test.describe('/api/reveal verifies the token server-side', () => {
  test('no token → refused, and Cloudflare is not even asked', async ({ request, baseURL }) => {
    expect((await reveal(request, baseURL!, undefined)).status()).toBe(REFUSED);
    expect(await calls(request)).toHaveLength(0);
  });

  test('empty token, non-string token → refused', async ({ request, baseURL }) => {
    expect((await reveal(request, baseURL!, '')).status()).toBe(REFUSED);
    const res = await request.post('/api/reveal', { data: { kind: 'email', token: 12345 }, headers: sameOrigin(baseURL!) });
    expect(res.status()).toBe(REFUSED);
  });

  test('over-long token (>2048 chars) → refused without calling Cloudflare', async ({ request, baseURL }) => {
    expect((await reveal(request, baseURL!, 'good-' + 'a'.repeat(3000))).status()).toBe(REFUSED);
    expect(await calls(request)).toHaveLength(0);
  });

  test('token Cloudflare rejects → refused', async ({ request, baseURL }) => {
    expect((await reveal(request, baseURL!, tok('bad'))).status()).toBe(REFUSED);
    expect(await calls(request)).toHaveLength(1);
  });

  test('valid token → passes; the SAME token a second time → refused (one-time use)', async ({ request, baseURL }) => {
    const t = tok('good');
    expect((await reveal(request, baseURL!, t)).status()).toBe(PASSED);
    expect((await reveal(request, baseURL!, t)).status()).toBe(REFUSED);
  });

  test('the secret key and the visitor IP are what Cloudflare receives; the secret is never sent to the browser', async ({ request, baseURL }) => {
    const ip = freshIp(); await reveal(request, baseURL!, tok('good'), ip);
    const [c] = await calls(request);
    expect(c.secret).toBe('test-secret');
    expect(c.remoteip).toBe(ip);
  });

  test('unknown kind → 404 and the token is NOT spent (verifier not called)', async ({ request, baseURL }) => {
    expect((await reveal(request, baseURL!, tok('good'), freshIp(), 'password')).status()).toBe(404);
    expect(await calls(request)).toHaveLength(0);
  });

  test('cross-site request → 403 and the token is NOT spent', async ({ request }) => {
    const res = await request.post('/api/reveal', { data: { kind: 'email', token: tok('good') }, headers: { 'sec-fetch-site': 'cross-site', 'cf-connecting-ip': freshIp() } });
    expect(res.status()).toBe(403);
    expect(await calls(request)).toHaveLength(0);
  });

  test('rate limit (10/h/IP) is applied BEFORE verification, so floods cannot burn Cloudflare calls', async ({ request, baseURL }) => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) await reveal(request, baseURL!, tok('bad'), ip);
    expect(await calls(request)).toHaveLength(10);
    expect((await reveal(request, baseURL!, tok('good'), ip)).status()).toBe(429);
    expect(await calls(request)).toHaveLength(10); // unchanged
  });
});

test.describe('fails CLOSED when Cloudflare misbehaves', () => {
  test('connection dropped → refused', async ({ request, baseURL }) => {
    expect((await reveal(request, baseURL!, tok('drop'))).status()).toBe(REFUSED);
  });
  test('unreadable (non-JSON) answer → refused', async ({ request, baseURL }) => {
    expect((await reveal(request, baseURL!, tok('garbage'))).status()).toBe(REFUSED);
  });
  test('no answer within 5 s → refused, after about 5 s (not hanging for the verifier\'s 7 s)', async ({ request, baseURL }) => {
    test.setTimeout(20_000);
    const t0 = Date.now();
    const res = await reveal(request, baseURL!, tok('slow')); // this token WOULD be valid if the Worker waited
    const took = Date.now() - t0;
    expect(res.status()).toBe(REFUSED);
    expect(took).toBeGreaterThan(4000); expect(took).toBeLessThan(6600);
  });
});

test.describe('contact form with Turnstile on', () => {
  const formToken = async (request: APIRequestContext, ip: string) =>
    /name="t" value="([^"]+)"/.exec(await (await request.get('/contact', { headers: { 'cf-connecting-ip': ip } })).text())![1];
  const send = (request: APIRequestContext, baseURL: string, ip: string, t: string, ts?: string) =>
    request.post('/contact', { form: { name: 'Tester', email: 'tester@example.com', message: 'A real message from the test suite.', website: '', t, ...(ts === undefined ? {} : { 'cf-turnstile-response': ts }) }, headers: sameOrigin(baseURL, ip), maxRedirects: 0 });

  test('the widget is rendered with the PUBLIC site key and an action, and the CSP allows exactly Cloudflare\'s host', async ({ request }) => {
    const res = await request.get('/contact'); const html = await res.text();
    expect(html).toContain('class="cf-turnstile"'); expect(html).toContain('data-sitekey="1x00000000000000000000AA"'); expect(html).toContain('data-action="contact"');
    const csp = header(res, 'content-security-policy');
    expect(cspDirective(csp, 'script-src')).toContain('https://challenges.cloudflare.com');
    expect(cspDirective(csp, 'frame-src')).toEqual(['https://challenges.cloudflare.com']);
    expect(cspDirective(csp, 'connect-src')).toContain('https://challenges.cloudflare.com');
  });

  test('pages that do not use Turnstile do not get its host in their CSP', async ({ request }) => {
    for (const p of ['/', '/projects', '/now', '/auth']) expect(header(await request.get(p), 'content-security-policy')).not.toContain('challenges.cloudflare.com');
  });

  test('without a Turnstile response the message is refused (400), with a good one it is accepted (303), a reused one is refused', async ({ request, baseURL }) => {
    const ip = freshIp(); const t = await formToken(request, ip);
    await new Promise((r) => setTimeout(r, 3300));
    expect((await send(request, baseURL!, ip, t)).status()).toBe(400);
    const ts = tok('good');
    expect((await send(request, baseURL!, ip, t, ts)).status()).toBe(303);
    expect((await send(request, baseURL!, ip, t, ts)).status()).toBe(400);
  });

  test('Cloudflare outage → the contact form refuses (fails closed) rather than letting spam through', async ({ request, baseURL }) => {
    const ip = freshIp(); const t = await formToken(request, ip);
    await new Promise((r) => setTimeout(r, 3300));
    expect((await send(request, baseURL!, ip, t, tok('drop'))).status()).toBe(400);
  });
});

test.describe('the secret never reaches the browser', () => {
  test('not in any page, any script, or the reveal answers', async ({ request }) => {
    const pages = ['/', '/contact', '/resume', '/projects', '/now', '/auth'];
    const bodies: string[] = [];
    const assets = new Set<string>();
    for (const p of pages) {
      const html = await (await request.get(p)).text(); bodies.push(html);
      for (const m of html.matchAll(/(?:src|href)="(\/_astro\/[^"]+\.(?:js|css))"/g)) assets.add(m[1]);
    }
    for (const a of assets) bodies.push(await (await request.get(a)).text());
    expect(assets.size).toBeGreaterThan(0);
    for (const b of bodies) { expect(b).not.toContain('test-secret'); expect(b).not.toContain('TURNSTILE_SECRET_KEY'); }
  });
});

// Known findings (audit-progress.md, Step 1). Remove `.fixme` once fixed.
test.describe('known findings', () => {
  test.fixme('FINDING S1-M1: the TEST-ONLY TURNSTILE_VERIFY_URL variable must be ignored in a production build', async () => {
    // Today it is honoured everywhere: if it were ever set on the real Worker, a verifier of the attacker's choosing
    // would approve every token. Gate it behind `import.meta.env.DEV` or a build-time flag, then assert here that a
    // production build still calls challenges.cloudflare.com (e.g. by making that host unreachable and expecting 400, not 200).
  });
  test.fixme('FINDING S1-L1: verify that Cloudflare\'s answer names OUR hostname (and the expected action outside test mode)', async ({ request, baseURL }) => {
    // The fake verifier can answer hostname "evil.example"; the Worker should then refuse.
    expect(true).toBe(false);
  });
});
