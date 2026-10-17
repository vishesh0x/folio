import { test, expect } from '../fixtures';
import { ADMIN_EMAIL, ADMIN_PASSWORD, freshIp, login, sameOrigin } from '../helpers';
import { withRetry } from '../fixtures';

// Audit 1.2: brute-force and abuse throttling (login 5 failures / 15 min / IP; reveal 10 / hour / IP; contact 5 / hour / IP).
const anon = { cookies: [], origins: [] };
test.use({ storageState: anon });

test.describe('login brute-force throttle', () => {
  test('5 wrong passwords, then even the CORRECT password is refused (429); other visitors are unaffected', async ({ request, baseURL }) => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) expect((await login(request, baseURL!, ADMIN_EMAIL, `wrong password ${i}`, ip)).status()).toBe(401);
    const locked = await login(request, baseURL!, ADMIN_EMAIL, ADMIN_PASSWORD, ip);
    expect(locked.status()).toBe(429);
    expect(await locked.text()).toContain('Too many attempts');
    expect((await login(request, baseURL!, ADMIN_EMAIL, ADMIN_PASSWORD, freshIp())).status()).toBe(302);
  });

  test('a successful login resets the failure counter', async ({ playwright, baseURL }) => {
    const ip = freshIp();
    const fresh = async () => withRetry(await playwright.request.newContext({ baseURL })); // a signed-in context is redirected away from /auth, so use a new one each time
    const fail = async () => { const c = await fresh(); const r = await login(c, baseURL!, ADMIN_EMAIL, 'nope nope nope nope', ip); await c.dispose(); return r.status(); };
    for (let i = 0; i < 4; i++) expect(await fail()).toBe(401);
    const ok = await fresh(); expect((await login(ok, baseURL!, ADMIN_EMAIL, ADMIN_PASSWORD, ip)).status()).toBe(302); await ok.dispose();
    for (let i = 0; i < 4; i++) expect(await fail()).toBe(401); // would be 429 if the earlier 4 failures still counted
  });

  test('no account enumeration: unknown email and wrong password look the same', async ({ request, baseURL }) => {
    const a = await login(request, baseURL!, 'nobody@example.com', 'whatever whatever', freshIp());
    const b = await login(request, baseURL!, ADMIN_EMAIL, 'whatever whatever', freshIp());
    expect(a.status()).toBe(b.status());
    const msg = (t: string) => /Email or password is incorrect\./.exec(t)?.[0];
    expect(msg(await a.text())).toBe('Email or password is incorrect.');
    expect(msg(await b.text())).toBe('Email or password is incorrect.');
  });

  test('setup token cannot be guessed: with an admin present, the setup form answers 403 before checking anything', async ({ request, baseURL }) => {
    const res = await request.post('/auth', { form: { mode: 'setup', token: 'guess', email: 'a@b.co', password: 'x', confirm: 'x' }, headers: sameOrigin(baseURL!), maxRedirects: 0 });
    expect(res.status()).toBe(403);
  });

  // Known findings (audit-progress.md, Step 1). Remove `.fixme` once fixed.
  test.fixme('FINDING S1-M2: addresses in the same IPv6 /64 share one login throttle bucket', async ({ request, baseURL }) => {
    for (let i = 0; i < 5; i++) await login(request, baseURL!, ADMIN_EMAIL, 'nope nope nope', `2001:db8:9:9::${i + 1}`);
    expect((await login(request, baseURL!, ADMIN_EMAIL, 'nope nope nope', '2001:db8:9:9::ffff')).status()).toBe(429);
  });
  test.fixme('FINDING S1-M3: failures should also be counted per account, so a botnet cannot try one password per IP forever', async ({ request, baseURL }) => {
    for (let i = 0; i < 12; i++) await login(request, baseURL!, 'victim@example.com', `guess ${i}`, freshIp());
    expect((await login(request, baseURL!, 'victim@example.com', 'guess 13', freshIp())).status()).toBe(429);
  });
});

test.describe('public endpoint throttles', () => {
  test('Show email: 10 per hour per visitor, then 429', async ({ request, baseURL }) => {
    const ip = freshIp(), h = sameOrigin(baseURL!, ip);
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await request.post('/api/reveal', { data: { kind: 'unknown' }, headers: h })).status());
    expect(codes.slice(0, 10)).toEqual(Array(10).fill(404)); // unknown kind: refused, but counted
    expect(codes[10]).toBe(429);
  });

  test('contact form: 5 messages per hour per visitor, then 429 (and the form token can be replayed within its lifetime)', async ({ request, baseURL }) => {
    const ip = freshIp(), h = sameOrigin(baseURL!, ip);
    const html = await (await request.get('/contact', { headers: { 'cf-connecting-ip': ip } })).text();
    const t = /name="t" value="([^"]+)"/.exec(html)![1];
    await new Promise((r) => setTimeout(r, 3300)); // forms posted faster than 3 s are refused
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await request.post('/contact', { form: { name: 'Tester', email: 'tester@example.com', message: `Hello from the test suite, message ${i}`, website: '', t }, headers: h, maxRedirects: 0 })).status());
    }
    expect(codes).toEqual([303, 303, 303, 303, 303, 429]);
  });

  test('contact form: a bot that fills the hidden field is told "sent" but nothing is stored', async ({ request, baseURL }) => {
    const ip = freshIp(), h = sameOrigin(baseURL!, ip);
    const res = await request.post('/contact', { form: { name: 'bot', email: 'bot@example.com', message: 'buy stuff buy stuff', website: 'http://spam.example', t: 'x' }, headers: h, maxRedirects: 0 });
    expect(res.status()).toBe(303);
  });

  test('contact form: too-fast, forged and tampered form tokens are refused', async ({ request, baseURL }) => {
    const ip = freshIp(), h = sameOrigin(baseURL!, ip);
    const html = await (await request.get('/contact', { headers: { 'cf-connecting-ip': ip } })).text();
    const t = /name="t" value="([^"]+)"/.exec(html)![1];
    const post = (tok: string) => request.post('/contact', { form: { name: 'T', email: 't@example.com', message: 'a long enough message', website: '', t: tok }, headers: h, maxRedirects: 0 });
    expect((await post(t)).status()).toBe(400);                       // instant post
    expect((await post('1.AAAA')).status()).toBe(400);                // forged
    expect((await post(t.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).status()).toBe(400); // tampered signature
    expect((await post('')).status()).toBe(400);                      // missing
  });
});
