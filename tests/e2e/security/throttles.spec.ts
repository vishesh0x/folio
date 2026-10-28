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
    const fail = async () => { const c = await fresh(); const r = await login(c, baseURL!, `ghost-reset@example.com`, 'nope nope nope nope', ip); await c.dispose(); return r.status(); };
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

  test('S1-M2 (fixed): addresses in the same IPv6 /64 share one login bucket; another /64 is unaffected', async ({ request, baseURL }) => {
    for (let i = 1; i <= 5; i++) expect((await login(request, baseURL!, 'ghost-v6@example.com', 'nope nope nope', `2001:db8:9:9::${i}`)).status()).toBe(401);
    const sameNetwork = await login(request, baseURL!, 'ghost-v6@example.com', 'nope nope nope', '2001:db8:9:9:abcd:ef01:2345:6789');
    expect(sameNetwork.status(), 'a new address in the same /64 must not get a fresh allowance').toBe(429);
    expect((await login(request, baseURL!, 'ghost-v6@example.com', 'nope nope nope', '2001:db8:9:a::1')).status(), 'a different /64 is a different visitor').toBe(401);
  });
  test('S1-M2 (fixed): ::ffff:1.2.3.4 is the same visitor as 1.2.3.4', async ({ request, baseURL }) => {
    const v4 = `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.77`;
    for (let i = 0; i < 5; i++) await login(request, baseURL!, 'ghost-map@example.com', 'nope nope nope', v4);
    expect((await login(request, baseURL!, 'ghost-map@example.com', 'nope nope nope', `::ffff:${v4}`)).status()).toBe(429);
  });
  test('S1-M3 (fixed): 20 wrong passwords for one account, from 20 different visitors, stop further guessing for everyone', async ({ request, baseURL }) => {
    const email = `victim-${Date.now()}@example.com`;                       // an account that does not exist: the limit must apply all the same (no way to tell)
    for (let i = 0; i < 20; i++) expect((await login(request, baseURL!, email, `guess ${i}`, freshIp())).status(), `attempt ${i + 1}`).toBe(401);
    const blocked = await login(request, baseURL!, email, 'guess 21', freshIp());
    expect(blocked.status()).toBe(429); expect(await blocked.text()).toContain('wrong passwords for this account');
    expect((await login(request, baseURL!, `other-${Date.now()}@example.com`, 'guess', freshIp())).status(), 'other accounts are not affected').toBe(401);
  });
  test('S1-M3: the account limit and the per-visitor limit are independent (one visitor is still stopped at 5)', async ({ request, baseURL }) => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) await login(request, baseURL!, `solo-${i}@example.com`, 'nope nope nope', ip);
    expect((await login(request, baseURL!, 'solo-x@example.com', 'nope nope nope', ip)).status()).toBe(429);
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
