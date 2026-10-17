import { test, expect } from '../fixtures';
import { AUTH_FILE, sameOrigin, crossSite, freshIp, header } from '../helpers';

// Audit 1.3 (CORS) and cross-site request forgery. The site refuses every unsafe request that cannot be proven same-origin.
const ENDPOINTS: Array<[string, any]> = [
  ['/contact', { form: { name: 'a', email: 'a@b.co', message: 'hello hello hello' } }],
  ['/auth', { form: { mode: 'login', email: 'x@y.zz', password: 'x' } }],
  ['/auth/logout', {}],
  ['/api/reveal', { data: { kind: 'email' } }],
];
const ADMIN: Array<[string, any]> = [
  ['/api/admin/inbox', { form: { action: 'mark-all-read' } }],
  ['/api/admin/projects', { form: { action: 'create' } }],
  ['/api/admin/preview', { data: { md: '# hi' } }],
  ['/api/admin/assets/delete', { form: { id: 'nope' } }],
];

test.describe('cross-site requests are refused (403)', () => {
  for (const [path, body] of ENDPOINTS) {
    for (const [label, headers] of [
      ['cross-site', crossSite()],
      ['same-site (sibling subdomain)', { 'sec-fetch-site': 'same-site', 'cf-connecting-ip': freshIp() }],
      ['Origin from another site, no Sec-Fetch-Site', { origin: 'https://evil.example', 'cf-connecting-ip': freshIp() }],
      ['no provenance headers at all', { 'cf-connecting-ip': freshIp() }],
      ['Referer from another site only', { referer: 'https://evil.example/page', 'cf-connecting-ip': freshIp() }],
    ] as const) {
      test(`POST ${path}: ${label}`, async ({ request }) => {
        const res = await request.post(path, { ...body, headers: headers as any, maxRedirects: 0 });
        expect(res.status()).toBe(403);
      });
    }
  }

  test.describe('even with a valid admin session', () => {
    test.use({ storageState: AUTH_FILE });
    for (const [path, body] of ADMIN) {
      test(`POST ${path} from another site`, async ({ request }) => {
        expect((await request.post(path, { ...body, headers: crossSite(), maxRedirects: 0 })).status()).toBe(403);
      });
    }
    test('control: the same request from the site itself is accepted (proves the tests above are meaningful)', async ({ request, baseURL }) => {
      const res = await request.post('/api/admin/preview', { data: { md: '# hi' }, headers: sameOrigin(baseURL!) });
      expect(res.status()).toBe(200);
      expect((await res.json()).html).toContain('hi');
    });
    test('fallbacks for older clients: same-origin Origin, or same-origin Referer, are accepted', async ({ request, baseURL }) => {
      const o = new URL(baseURL!).origin;
      expect((await request.post('/api/admin/preview', { data: { md: 'x' }, headers: { origin: o } })).status()).toBe(200);
      expect((await request.post('/api/admin/preview', { data: { md: 'x' }, headers: { referer: `${o}/dashboard` } })).status()).toBe(200);
    });
    test('the inbox "redirect" field cannot send you to another site (no open redirect)', async ({ request, baseURL }) => {
      for (const evil of ['https://evil.example', '//evil.example', '/dashboard/inbox/../../../evil', 'javascript:alert(1)']) {
        const res = await request.post('/api/admin/inbox', { form: { action: 'mark-all-read', redirect: evil }, headers: sameOrigin(baseURL!), maxRedirects: 0 });
        expect(res.status()).toBe(303);
        expect(header(res, 'location')).toBe('/dashboard/inbox');
      }
    });
  });

  test('real browser: a form on another site cannot post to the contact form', async ({ page, baseURL }) => {
    await page.route('http://evil.test/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<form id=f method=post action="${baseURL}/contact"><input name=name value=a><input name=email value=a@b.co><input name=message value="spam spam spam spam"></form><script>f.submit()</script>`,
    }));
    const nav = page.waitForResponse((r) => r.url() === `${baseURL}/contact` && r.request().method() === 'POST');
    await page.goto('http://evil.test/');
    expect((await nav).status()).toBe(403);
  });
});

test.describe('CORS', () => {
  test('no endpoint grants cross-origin access (no Access-Control-* headers, preflight not answered)', async ({ request }) => {
    for (const path of ['/api/reveal', '/api/admin/preview', '/contact', '/auth', '/media/x/y.png', '/robots.txt']) {
      const pre = await request.fetch(path, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
      const get = await request.get(path, { headers: { origin: 'https://evil.example' } });
      for (const r of [pre, get]) {
        expect(Object.keys(r.headers()).filter((h) => h.startsWith('access-control-')), `${path}`).toEqual([]);
      }
      expect(pre.status()).not.toBe(204);
    }
  });

  test('real browser: JavaScript on another site cannot read /api/reveal', async ({ page, baseURL }) => {
    await page.route('http://evil.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>x</p>' }));
    await page.goto('http://evil.test/');
    const outcome = await page.evaluate(async (url) => {
      try { const r = await fetch(url + '/api/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"kind":"email"}' }); return 'readable:' + r.status; }
      catch (e) { return 'blocked'; }
    }, baseURL!);
    expect(outcome).toBe('blocked');
  });
});
