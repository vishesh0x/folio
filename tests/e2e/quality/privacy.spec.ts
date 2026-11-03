import { test, expect, withRetry } from '../fixtures';
import { AUTH_FILE, sameOrigin } from '../helpers';
import { d1 } from '../d1';

// What the privacy notice says must be TRUE. Each claim in src/lib/privacy.ts is checked against what
// the site really does, so the notice cannot quietly become wrong. Server A.
const PUBLIC = ['/', '/projects', '/projects/wanderhost-booking', '/now', '/resume', '/contact', '/privacy', '/no-such-page', '/sitemap.xml', '/robots.txt', '/auth'];

test.describe('the notice exists and is reachable', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('/privacy is a normal indexable page with one heading, in the sitemap, linked from every page footer and from the contact form', async ({ page, request }) => {
    const r = await page.goto('/privacy'); expect(r!.status()).toBe(200);
    expect(await page.locator('h1').count()).toBe(1); expect(await page.title()).toContain('Privacy notice');
    expect(await page.locator('meta[name=robots]').count()).toBe(0);
    expect(await request.get('/sitemap.xml').then((x) => x.text())).toMatch(/<loc>https:\/\/[^<]+\/privacy<\/loc>/);
    for (const p of ['/', '/projects', '/now', '/resume', '/contact', '/projects/wanderhost-booking']) {
      await page.goto(p); await expect(page.locator('footer a[href="/privacy"]'), p).toHaveCount(1);
    }
    await page.goto('/contact'); await expect(page.locator('form a[href="/privacy"]')).toHaveCount(1);
  });
  test('it names what is collected and who processes it', async ({ request }) => {
    const t = (await (await request.get('/privacy')).text()).replace(/<[^>]+>/g, ' ');
    for (const must of ['contact form', 'name, email address', 'Cloudflare', 'Turnstile', 'Web Analytics', 'cookie', 'local storage', 'delete', 'GDPR', 'Digital Personal Data Protection']) expect(t, must).toContain(must);
  });
});

test.describe('what the notice claims about the visitor is what the site does', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('no page, picture or file sets a cookie for a visitor', async ({ request }) => {
    for (const p of [...PUBLIC, '/media/demoCover0001/x.png', '/media/demoCover0001/x.png?w=640&f=webp', '/_astro/', '/favicon.ico', '/manifest.webmanifest']) {
      const r = await request.get(p, { maxRedirects: 0 }); expect(r.headers()['set-cookie'], p).toBeUndefined();
    }
  });
  test('a failed sign-in and a contact form attempt set no cookie either', async ({ request, baseURL }) => {
    const bad = await request.post('/auth', { form: { mode: 'login', email: 'no@example.com', password: 'nope nope nope' }, headers: sameOrigin(baseURL!), maxRedirects: 0 }); expect(bad.headers()['set-cookie']).toBeUndefined();
    const c = await request.post('/contact', { form: { name: 'A', email: 'a@example.com', message: 'hello there' }, headers: sameOrigin(baseURL!), maxRedirects: 0 }); expect(c.headers()['set-cookie']).toBeUndefined();
  });
  test('in a real browser: no cookies, no session storage, and only the theme choice in local storage; every request goes to the site itself', async ({ page, baseURL }) => {
    const hosts = new Set<string>(); page.on('request', (r) => { const u = new URL(r.url()); if (u.protocol.startsWith('http')) hosts.add(u.host); });
    for (const p of PUBLIC.filter((x) => !/xml|txt/.test(x))) { await page.goto(p, { waitUntil: 'networkidle' }); }
    await page.goto('/'); await page.getByRole('button', { name: /theme|dark|light/i }).first().click().catch(() => {});
    const stored = await page.evaluate(() => ({ cookie: document.cookie, local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
    expect(stored.cookie).toBe(''); expect(stored.session).toEqual([]); expect(stored.local.filter((k) => k !== 'theme')).toEqual([]);
    expect([...hosts], 'only the site itself was contacted (no third-party scripts, fonts, trackers)').toEqual([new URL(baseURL!).host]);
  });
  test('the page source loads nothing from any other host (scripts, styles, images, fonts, frames, forms)', async ({ request }) => {
    for (const p of ['/', '/projects', '/projects/wanderhost-booking', '/contact', '/privacy']) {
      const html = await (await request.get(p)).text();
      const loads = [...html.matchAll(/\b(?:src|srcset|action|data)=["']([^"']+)["']|<link[^>]+href=["']([^"']+)["']/g)].flatMap((m) => (m[1] ?? m[2] ?? '').split(',').map((x) => x.trim().split(/\s+/)[0]));
      expect(loads.filter((u) => /^(https?:)?\/\//.test(u) && !u.includes('localhost') && !/\/\/(www\.)?visheshraghuvanshi\.in/.test(u)), p).toEqual([]);
    }
  });
});

test.describe('the owner has exactly two cookies (session and known browser), and both are private', () => {
  test('signing in sets two cookies: HttpOnly, Secure, SameSite=Lax, host-only (__Host- prefix)', async ({ playwright, baseURL }) => {
    const v = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const r = await v.post('/auth', { form: { mode: 'login', email: 'e2e-owner@example.com', password: 'correct horse battery staple 42' }, headers: sameOrigin(baseURL!), maxRedirects: 0 });
    const cookies = r.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value);
    if (r.status() === 302) { expect(cookies).toHaveLength(2); expect(cookies.map((c) => c.split('=')[0]).sort()).toEqual(['__Host-device', '__Host-session']); for (const c of cookies) { for (const a of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) expect(c).toContain(a); expect(c).not.toMatch(/Domain=/i); } }
    await v.dispose();
  });
});

test.describe('a notice the owner wrote replaces the standard one, safely', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: AUTH_FILE });
  test('an own notice is shown instead, text from it cannot run as a page script, and clearing it brings the standard text back', async ({ playwright, baseURL }) => {
    const owner = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
    const site = await (await owner.get('/api/admin/backup?part=site')).json();
    const put = (privacy_md: string) => owner.post('/api/admin/backup', { data: { part: 'site', settings: { ...site.settings, privacy_md }, seo_pages: site.seo_pages }, headers: sameOrigin(baseURL!) });
    try {
      expect((await put('# My own notice\n\nOnly the contact form. <script>window.__x=1</script>')).status()).toBe(200);
      const html = await (await owner.get(`/privacy?v=${Date.now()}`)).text();
      expect(html).toContain('My own notice'); expect(html).not.toContain('<script>window.__x=1</script>'); expect(html).not.toContain('Cloudflare Turnstile');
    } finally {
      await put('');
      const back = await (await owner.get(`/privacy?v=${Date.now()}`)).text(); expect(back).toContain('Cloudflare Turnstile'); expect(back).not.toContain('My own notice');
      await owner.dispose();
    }
  });
});

test.describe('the owner\'s tools for visitors\' data', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: AUTH_FILE });
  const msg = (n: string, email: string, body: string, age = 0, subject = 'Hi') => `INSERT INTO messages (name,email,subject,body,is_read,created_at) VALUES ('${n}','${email}','${subject}','${body.replace(/'/g, "''")}',0, unixepoch() - ${age})`;
  test.afterAll(() => { d1('e2e-a', "DELETE FROM messages WHERE email LIKE '%@privacy.test'"); });
  test('the CSV has every message, escapes commas, quotes and line breaks, defuses spreadsheet formulas, and is private', async ({ playwright, baseURL }) => {
    d1('e2e-a', msg('Ann, "the" Tester', 'ann@privacy.test', 'line one\nline two, with "quotes"') + '; ' + msg('Evil', 'evil@privacy.test', '=HYPERLINK("http://evil","x")', 0, '@SUM(1)'));
    const owner = await playwright.request.newContext({ baseURL, storageState: AUTH_FILE });
    const r = await owner.get('/api/admin/messages.csv');
    expect(r.status()).toBe(200); expect(r.headers()['content-type']).toContain('text/csv'); expect(r.headers()['content-disposition']).toMatch(/^attachment; filename="messages-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(r.headers()['cache-control']).toContain('no-store'); expect(r.headers()['x-robots-tag']).toBe('noindex, nofollow');
    const csv = await r.text();
    expect(csv.startsWith('\uFEFFid,received_at,name,email,subject,message,read\r\n')).toBe(true);
    expect(csv).toContain('"Ann, ""the"" Tester",ann@privacy.test'); expect(csv).toContain('"line one\nline two, with ""quotes"""');
    expect(csv, 'a cell that starts like a formula is neutralised').toContain(`'=HYPERLINK`); expect(csv).toContain(`'@SUM(1)`);
    expect(csv).not.toMatch(/,=HYPERLINK|,@SUM/);
    const visitor = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    expect((await visitor.get('/api/admin/messages.csv')).status()).toBe(401);
    await owner.dispose(); await visitor.dispose();
  });
  test('deleting everything from one person needs the confirmation box, matches the address ignoring capitals, and touches nobody else', async ({ playwright, baseURL }) => {
    d1('e2e-a', msg('Bob', 'Bob@privacy.test', 'one') + '; ' + msg('Bob again', 'bob@privacy.test', 'two') + '; ' + msg('Carol', 'carol@privacy.test', 'three'));
    const owner = await playwright.request.newContext({ baseURL, storageState: AUTH_FILE });
    const post = async (form: Record<string, string>) => decodeURIComponent((await owner.post('/api/admin/inbox', { form, headers: sameOrigin(baseURL!), maxRedirects: 0 })).headers()['location']);
    expect(await post({ action: 'delete-email', email: 'bob@privacy.test' }), 'without the box ticked').toBe('/dashboard/inbox?deleted=none');
    expect((d1('e2e-a', "SELECT count(*) AS n FROM messages WHERE lower(email)='bob@privacy.test'") as any[])[0].n).toBe(2);
    expect(await post({ action: 'delete-email', email: 'BOB@privacy.test', confirm: 'yes' })).toBe('/dashboard/inbox?deleted=2');
    expect((d1('e2e-a', "SELECT count(*) AS n FROM messages WHERE lower(email) IN ('bob@privacy.test')") as any[])[0].n).toBe(0);
    expect((d1('e2e-a', "SELECT count(*) AS n FROM messages WHERE email='carol@privacy.test'") as any[])[0].n).toBe(1);
    expect(await post({ action: 'delete-email', email: '', confirm: 'yes' })).toBe('/dashboard/inbox?deleted=none');
    expect(await post({ action: 'delete-email', email: '%@privacy.test', confirm: 'yes' }), 'a wildcard matches nothing, it is not a pattern').toBe('/dashboard/inbox?deleted=0');
    await owner.dispose();
  });
  test('deleting old messages needs the box, a sensible number of days, and keeps newer ones', async ({ playwright, baseURL }) => {
    d1('e2e-a', msg('Old', 'old@privacy.test', 'old', 400 * 86400) + '; ' + msg('Mid', 'mid@privacy.test', 'mid', 100 * 86400) + '; ' + msg('New', 'new@privacy.test', 'new', 60));
    const owner = await playwright.request.newContext({ baseURL, storageState: AUTH_FILE });
    const post = async (form: Record<string, string>) => decodeURIComponent((await owner.post('/api/admin/inbox', { form, headers: sameOrigin(baseURL!), maxRedirects: 0 })).headers()['location']);
    for (const bad of [{ days: '365' }, { days: '0', confirm: 'yes' }, { days: '-5', confirm: 'yes' }, { days: 'abc', confirm: 'yes' }, { days: '99999', confirm: 'yes' }]) expect(await post({ action: 'delete-older', ...bad }), JSON.stringify(bad)).toBe('/dashboard/inbox?deleted=none');
    expect(await post({ action: 'delete-older', days: '365', confirm: 'yes' })).toBe('/dashboard/inbox?deleted=1');
    expect((d1('e2e-a', "SELECT email FROM messages WHERE email LIKE '%@privacy.test' AND email IN ('old@privacy.test','mid@privacy.test','new@privacy.test') ORDER BY email") as any[]).map((r) => r.email)).toEqual(['mid@privacy.test', 'new@privacy.test']);
    await owner.dispose();
  });
  test('the inbox page offers the tools, shows only a count or "nothing" from the address, and never other text', async ({ page }) => {
    await page.goto('/dashboard/inbox?deleted=3'); await expect(page.getByRole('status').filter({ hasText: 'Deleted 3 messages.' })).toBeVisible();
    await page.goto('/dashboard/inbox?deleted=Your%20account%20is%20hacked'); await expect(page.getByText('hacked')).toHaveCount(0);
    await page.goto('/dashboard/inbox'); await page.getByText("Visitors' data").click();
    await expect(page.getByRole('link', { name: /Download all messages/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete their messages' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Delete old messages' })).toBeVisible();
  });
});
