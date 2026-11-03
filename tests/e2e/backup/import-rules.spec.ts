import { test, expect, withRetry } from '../fixtures';
import { readFileSync } from 'node:fs';
import { signIn } from '../limits/counting';
import { sameOrigin } from '../helpers';
import { d1 } from '../d1';
import { upload } from '../uploads';

// An import is the dashboard's own trust level (owner only), but a backup file can be old, edited by
// hand or tampered with. Everything in it is checked with the same rules as the forms: bad items are
// skipped or cleaned and reported, never saved as they are, and a "check only" run writes nothing.
test.describe.configure({ mode: 'serial' });
let owner: any, anon: any, base: string;
test.beforeAll(async ({ playwright, baseURL }) => {
  base = baseURL!;
  anon = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
  owner = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } })); await signIn(owner, baseURL!);
});
test.afterAll(async () => { d1('e2e-f', "DELETE FROM projects WHERE slug LIKE 'imp-%'; DELETE FROM messages WHERE email LIKE '%@import.test'; DELETE FROM assets WHERE id LIKE 'impfile%'"); await anon?.dispose(); await owner?.dispose(); });
const post = async (body: unknown) => { const r = await owner.post('/api/admin/backup', { data: body, headers: sameOrigin(base) }); return { status: r.status(), json: await r.json() }; };
const count = (sql: string) => (d1('e2e-f', sql) as any[])[0].n as number;

test.describe('who may use it', () => {
  test('a visitor can neither read nor write: 401 for every part', async () => {
    for (const part of ['summary', 'site', 'projects', 'resume', 'now', 'assets', 'messages']) expect((await anon.get(`/api/admin/backup?part=${part}`)).status(), part).toBe(401);
    expect((await anon.post('/api/admin/backup', { data: { part: 'projects', items: [] }, headers: sameOrigin(base) })).status()).toBe(401);
    expect((await anon.post('/api/admin/backup-file', { multipart: { id: 'abcdefghijkl', file: { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from('x') } }, headers: sameOrigin(base) })).status()).toBe(401);
  });
  test('a request from another site is refused (same-origin check), even with the owner\'s cookie', async () => {
    const r = await owner.post('/api/admin/backup', { data: { part: 'projects', items: [] }, headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' } });
    expect(r.status()).toBe(403);
  });
  test('an unknown part, bad JSON and an oversized body are refused', async () => {
    expect((await owner.get('/api/admin/backup?part=users')).status()).toBe(400);
    expect((await post({ part: 'users' })).status).toBe(400);
    const bad = await owner.post('/api/admin/backup', { data: '{not json', headers: { ...sameOrigin(base), 'content-type': 'application/json' } }); expect(bad.status()).toBe(400);
    // (the server answers 413 without reading the rest, which now and then makes the test client see a
    // reset instead: try again).
    let status = 0;
    for (let i = 0; i < 5 && status !== 413; i++) { try { status = (await owner.post('/api/admin/backup', { data: JSON.stringify({ part: 'projects', items: [{ title: 'x'.repeat(4 * 1024 * 1024 + 2048) }] }), headers: { ...sameOrigin(base), 'content-type': 'application/json' } })).status(); } catch (e) { if (!/ECONNRESET|EPIPE|socket hang up/i.test(String(e))) throw e; } }
    expect(status).toBe(413);
  });
});

test.describe('what an export never contains', () => {
  test('no account, password hash, session or internal key appears in any part', async () => {
    let all = '';
    for (const part of ['summary', 'site', 'projects', 'resume', 'now', 'assets', 'messages']) all += await (await owner.get(`/api/admin/backup?part=${part}`)).text();
    for (const secret of ['pbkdf2', 'password_hash', 'form_secret', 'content_version', 'login_attempts', 'sessions', 'r2_key']) expect(all, secret).not.toContain(secret);
    expect(all).not.toContain('limits@example.com');  // The owner's sign-in email is the account, not content
  });
});

test.describe('projects', () => {
  const good = { slug: 'imp-ok', title: 'Imported project', summary: 'S', body_md: '# Hello', tags: ['a', 'b'], status: 'published', featured: 0, sort_order: 5, created_at: 1700000000, updated_at: 1700000100 };
  test('a good project is added with its original dates; "check only" writes nothing', async () => {
    const dry = await post({ part: 'projects', mode: 'add', dryRun: true, items: [good] });
    expect(dry.json).toMatchObject({ ok: true, added: 1 }); expect(count("SELECT count(*) AS n FROM projects WHERE slug='imp-ok'")).toBe(0);
    const real = await post({ part: 'projects', mode: 'add', items: [good] });
    expect(real.json.added).toBe(1);
    const row = (d1('e2e-f', "SELECT title, status, created_at, updated_at, tags FROM projects WHERE slug='imp-ok'") as any[])[0];
    expect(row).toMatchObject({ title: 'Imported project', status: 'published', created_at: 1700000000, updated_at: 1700000100 }); expect(JSON.parse(row.tags)).toEqual(['a', 'b']);
  });
  test('"add" never changes a project whose address already exists', async () => {
    const r = await post({ part: 'projects', mode: 'add', items: [{ ...good, title: 'Changed!', body_md: 'new' }] });
    expect(r.json).toMatchObject({ added: 0, skipped: 1 });
    expect((d1('e2e-f', "SELECT title FROM projects WHERE slug='imp-ok'") as any[])[0].title).toBe('Imported project');
  });
  test('hostile or broken values are cleaned or skipped and reported, with the same limits as the form', async () => {
    const r = await post({ part: 'projects', mode: 'add', items: [
      { slug: 'imp-evil', title: 'Evil <b>title</b>' + 'x'.repeat(500), summary: 's'.repeat(900), body_md: 'b', live_url: 'javascript:alert(1)', source_url: 'data:text/html,<script>', status: 'weird', featured: 'yes', tags: Array.from({ length: 30 }, (_, i) => `tag${i}`), cover_asset: 'doesnotexist1', seo_image: '../../x', created_at: -5 },
      { slug: 'imp-notitle', title: '   ', body_md: 'x' }, 'not an object', null, { slug: 'imp-dup', title: 'One' }, { slug: 'imp-dup', title: 'Two' },
    ] });
    expect(r.json.added).toBe(2); expect(r.json.skipped).toBe(4);
    expect(r.json.problems.join('\n')).toMatch(/live url.*not an http/i); expect(r.json.problems.join('\n')).toMatch(/source url/i); expect(r.json.problems.join('\n')).toMatch(/cover picture/i);
    const e = (d1('e2e-f', "SELECT title, summary, live_url, source_url, status, featured, tags, cover_asset, seo_image, created_at FROM projects WHERE slug='imp-evil'") as any[])[0];
    expect(e.title.length).toBeLessThanOrEqual(120); expect(e.summary.length).toBeLessThanOrEqual(300);
    expect([e.live_url, e.source_url, e.cover_asset, e.seo_image]).toEqual([null, null, null, null]);
    expect(e.status).toBe('draft'); expect(e.featured).toBe(0); expect(JSON.parse(e.tags)).toHaveLength(12); expect(e.created_at).toBeGreaterThan(1_600_000_000);
    expect(count("SELECT count(*) AS n FROM projects WHERE slug='imp-dup'")).toBe(1);
  });
  test('a body is capped at 200,000 characters and control characters are removed', async () => {
    await post({ part: 'projects', mode: 'add', items: [{ slug: 'imp-long', title: 'Long', body_md: 'a\u0000b'.repeat(120_000) }] });
    const body = (d1('e2e-f', "SELECT body_md FROM projects WHERE slug='imp-long'") as any[])[0].body_md as string;
    expect(body.length).toBeLessThanOrEqual(200_000); expect(body).not.toContain('\u0000');
  });
});

test.describe('site settings', () => {
  test('addresses must be http(s), social links need a name and a safe address, email and phone must look right; nothing is half-saved', async () => {
    const before = (d1('e2e-f', "SELECT value FROM settings WHERE key='site'") as any[])[0].value;
    const dry = await post({ part: 'site', dryRun: true, settings: { name: 'Dry', site_url: 'javascript:alert(1)' }, seo_pages: [] });
    expect(dry.json.ok).toBe(true); expect((d1('e2e-f', "SELECT value FROM settings WHERE key='site'") as any[])[0].value, 'check only wrote nothing').toBe(before);
    const r = await post({ part: 'site', settings: { name: 'N'.repeat(200), tagline: 't', email: 'not an email', phone: 'call me!', site_url: 'javascript:alert(1)',
      socials: [{ label: 'Good', url: 'https://example.com/me' }, { label: 'Mail', url: 'mailto:a@b.co' }, { label: 'Bad', url: 'javascript:alert(1)' }, { label: '', url: 'https://x.y' }, 'junk'],
      highlights: [{ value: '10', label: 'years' }, { value: '', label: 'broken' }], portrait_asset: 'nope', og_asset: 'nope' }, seo_pages: [{ page: 'home', title: 'T', noindex: 1 }, { page: 'dashboard', title: 'x' }, { page: 'contact', noindex: 'yes' }] });
    expect(r.json.ok).toBe(true);
    const s = JSON.parse((d1('e2e-f', "SELECT value FROM settings WHERE key='site'") as any[])[0].value);
    expect(s.name.length).toBe(80); expect([s.email, s.phone, s.site_url, s.portrait_asset, s.og_asset]).toEqual(['', '', '', null, null]);
    expect(s.socials).toEqual([{ label: 'Good', url: 'https://example.com/me' }, { label: 'Mail', url: 'mailto:a@b.co' }]); expect(s.highlights).toEqual([{ value: '10', label: 'years' }]);
    expect(r.json.problems.length).toBeGreaterThanOrEqual(6);
    const seo = d1('e2e-f', 'SELECT page, noindex FROM seo_pages ORDER BY page') as any[]; expect(seo.map((x) => x.page)).toEqual(['contact', 'home']); expect(seo.find((x) => x.page === 'home').noindex).toBe(1); expect(seo.find((x) => x.page === 'contact').noindex).toBe(0);
  });
});

test.describe('resume, Now board and messages', () => {
  test('unknown kinds and entries for missing projects are skipped; entry data is cleaned by the resume\'s own rules', async () => {
    const bad = await post({ part: 'resume-section', first: true, section: { kind: 'hacking', title: 'x', entries: [] } });
    expect(bad.json.skipped).toBe(1); expect(count('SELECT count(*) AS n FROM resume_sections')).toBeGreaterThan(0);  // Nothing was cleared by a rejected first section
    const r = await post({ part: 'resume-section', first: true, section: { kind: 'experience', title: 'Work', visible: 1, entries: [{ data: { role: 'Dev<script>', company: 'ACME', description: 'x'.repeat(5000), url: 'javascript:alert(1)' }, visible: 1 }, { data: 'junk' }] } });
    expect(r.json.added).toBe(2); expect(r.json.skipped).toBe(1);
    const e = JSON.parse((d1('e2e-f', 'SELECT data FROM resume_entries ORDER BY id LIMIT 1') as any[])[0].data);
    expect(e.role).toBe('Dev<script>'); expect(String(e.description).length).toBeLessThanOrEqual(1200); expect(JSON.stringify(e)).not.toContain('javascript:');
    const p = await post({ part: 'resume-section', first: false, section: { kind: 'projects', title: 'Projects', entries: [{ data: {}, project_slug: 'no-such-project' }] } });
    expect(p.json.skipped).toBe(1); expect(p.json.problems.join()).toMatch(/not on this site/);
  });
  test('Now items: links must be http(s), progress 0 to 100, dates real; a category without a name is skipped', async () => {
    const r = await post({ part: 'now-category', first: true, category: { name: 'Reading', icon: '📚', items: [{ title: 'Book', note: 'n', link: 'javascript:alert(1)', status: 'current', progress: 150 }, { title: '', note: 'x' }, { title: 'Done', status: 'done', finished_at: 1700000000, progress: 50 }] } });
    expect(r.json.added).toBe(3); expect(r.json.skipped).toBe(1);
    const items = d1('e2e-f', 'SELECT title, link, progress, status FROM now_items ORDER BY id') as any[];
    expect(items.find((i) => i.title === 'Book')).toMatchObject({ link: null, progress: null }); expect(items.find((i) => i.title === 'Done')).toMatchObject({ status: 'done', progress: null });
    expect((await post({ part: 'now-category', first: false, category: { name: '   ', items: [] } })).json.skipped).toBe(1);
  });
  test('messages: incomplete ones are skipped and an identical message is never added twice', async () => {
    const m = { name: 'Ann', email: 'ann@import.test', subject: 'Hi', body: 'Hello there', is_read: 1, created_at: 1700000000 };
    expect((await post({ part: 'messages', items: [m, { ...m, email: 'bad' }, { name: '', email: 'x@import.test', body: 'x' }] })).json).toMatchObject({ added: 1, skipped: 2 });
    expect((await post({ part: 'messages', items: [m] })).json).toMatchObject({ added: 0, skipped: 1 });
    expect(count("SELECT count(*) AS n FROM messages WHERE email='ann@import.test'")).toBe(1);
  });
});

test.describe('files', () => {
  const png = readFileSync('tests/fixtures/plain.png');
  const send = (fields: Record<string, string>, file: { name: string; mimeType: string; buffer: Buffer }) => owner.post('/api/admin/backup-file', { multipart: { ...fields, file }, headers: sameOrigin(base) });
  test('a file comes back under its id and date; sending it again leaves it alone', async () => {
    const r = await send({ id: 'impfile00001', alt: 'Alt', decorative: '0', created_at: '1700000000' }, { name: 'plain.png', mimeType: 'image/png', buffer: png });
    expect(await r.json()).toEqual({ ok: true, added: true });
    expect((d1('e2e-f', "SELECT created_at, alt FROM assets WHERE id='impfile00001'") as any[])[0]).toEqual({ created_at: 1700000000, alt: 'Alt' });
    expect((await anon.get('/media/impfile00001/plain.png')).status()).toBe(200);
    expect(await (await send({ id: 'impfile00001', alt: 'Other', decorative: '0' }, { name: 'plain.png', mimeType: 'image/png', buffer: png })).json()).toEqual({ ok: true, skipped: true });
    expect((d1('e2e-f', "SELECT alt FROM assets WHERE id='impfile00001'") as any[])[0].alt).toBe('Alt');
  });
  test('a file asked for a moment before it is restored shows up at once (the "no such file" answer is forgotten)', async () => {
    expect((await anon.get('/media/impfile00005/plain.png')).status()).toBe(404);  // Remembered as missing for a minute
    expect(await (await send({ id: 'impfile00005', alt: 'Back again' }, { name: 'plain.png', mimeType: 'image/png', buffer: png })).json()).toEqual({ ok: true, added: true });
    expect((await anon.get('/media/impfile00005/plain.png')).status()).toBe(200);
  });
  test('a file is judged by what it really is, not by what the backup says: program files, scripted SVGs and bad ids are refused or cleaned', async () => {
    expect((await send({ id: 'impfile00002', alt: 'x' }, { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from('MZ\x90\x00 this is an executable') })).status()).toBe(400);
    expect((await send({ id: '../../etc/passwd', alt: 'x' }, { name: 'a.png', mimeType: 'image/png', buffer: png })).status()).toBe(400);
    expect((await send({ id: 'short', alt: 'x' }, { name: 'a.png', mimeType: 'image/png', buffer: png })).status()).toBe(400);
    const svg = await send({ id: 'impfile00003', alt: 'x' }, { name: 'a.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="5" height="5" onload="alert(1)"/></svg>') });
    if (svg.status() === 200) { const text = await (await anon.get('/media/impfile00003/a.svg')).text(); expect(text).not.toMatch(/<script|onload/i); }
    expect([200, 400]).toContain(svg.status());
    expect((await send({ id: 'impfile00004' }, { name: 'a.png', mimeType: 'image/png', buffer: png })).status(), 'a picture needs alt text, as with any upload').toBe(400);
    void upload;
  });
});
