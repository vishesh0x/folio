import { test, expect } from '@playwright/test';
import { AUTH_FILE, freshIp, header, sameOrigin } from '../helpers';
import { withRetry } from '../fixtures';
import { editorFields } from '../forms';
import { d1 } from '../d1';

// Step 3: what happens when two things happen at once. D1 runs one write at a time per database, but "check, then write" in two steps can
// still race, and two browser tabs can overwrite each other. Each case here is something that really happens (a double-click, two tabs).
const admin = async (playwright: any, baseURL: string) => withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
const count = (sql: string) => d1('e2e-a', sql)[0].n as number;

test.describe('simultaneous requests', () => {
  test('12 "New project" requests at once (a double-click, and more) all succeed with their own address', async ({ playwright, baseURL }) => {
    const a = await admin(playwright, baseURL!);
    const before = count("SELECT count(*) n FROM projects WHERE title = 'Untitled project'");
    const rs = await Promise.all(Array.from({ length: 12 }, () => a.post('/api/admin/projects', { form: { action: 'create' }, headers: sameOrigin(baseURL!, freshIp()), maxRedirects: 0 })));
    expect(rs.map((r) => r.status())).toEqual(Array(12).fill(303));
    const rows = d1('e2e-a', "SELECT count(*) n, count(DISTINCT slug) d FROM projects WHERE title = 'Untitled project'")[0];
    expect(rows.n - before, 'no request may be lost').toBe(12); expect(rows.d, 'every project has a different address').toBe(rows.n);
    await a.dispose();
  });

  test('8 "Duplicate" requests for the same project at once all succeed', async ({ playwright, baseURL }) => {
    const a = await admin(playwright, baseURL!);
    const before = count('SELECT count(*) n FROM projects');
    const rs = await Promise.all(Array.from({ length: 8 }, () => a.post('/api/admin/projects', { form: { action: 'duplicate', id: '1' }, headers: sameOrigin(baseURL!, freshIp()), maxRedirects: 0 })));
    expect(rs.map((r) => r.status())).toEqual(Array(8).fill(303));
    expect(count('SELECT count(*) n FROM projects') - before).toBe(8);
    await a.dispose();
  });

  test('a rate limit is exact even when requests arrive together: 12 at once with a limit of 10 lets exactly 10 through', async ({ request, baseURL }) => {
    const ip = freshIp();
    const rs = await Promise.all(Array.from({ length: 12 }, () => request.post('/api/reveal', { data: { kind: 'unknown' }, headers: sameOrigin(baseURL!, ip) })));
    const codes = rs.map((r) => r.status()).sort();
    expect(codes.filter((c) => c === 404).length).toBe(10); expect(codes.filter((c) => c === 429).length).toBe(2);
  });
});

test.describe('two tabs editing the same project', () => {
  test('the second tab to save is told, and nothing is silently overwritten', async ({ playwright, baseURL }) => {
    const a = await admin(playwright, baseURL!);
    const created = await a.post('/api/admin/projects', { form: { action: 'create' }, headers: sameOrigin(baseURL!), maxRedirects: 0 });
    const id = /\/dashboard\/projects\/(\d+)/.exec(header(created, 'location'))![1];
    await new Promise((r) => setTimeout(r, 1200));                        // edits are timestamped to the second
    const [tabA, tabB] = [editorFields(await (await a.get(`/dashboard/projects/${id}`)).text()), editorFields(await (await a.get(`/dashboard/projects/${id}`)).text())];
    expect(tabA.v).toBe(tabB.v);
    const save = (f: Record<string, string>, title: string) => a.post(`/dashboard/projects/${id}`, { form: { ...f, title, intent: 'save' }, headers: sameOrigin(baseURL!), maxRedirects: 0 });
    expect((await save(tabA, 'Written in tab A')).status()).toBe(303);
    const lost = await save(tabB, 'Written in tab B');
    expect(lost.status()).toBe(409); expect(await lost.text()).toContain('changed in another tab');
    expect(d1('e2e-a', `SELECT title FROM projects WHERE id = ${id}`)[0].title, 'tab A must not be overwritten').toBe('Written in tab A');
    const fresh = editorFields(await (await a.get(`/dashboard/projects/${id}`)).text());      // reload, as the message says
    expect((await save(fresh, 'Written in tab B, after reloading')).status()).toBe(303);
    await a.dispose();
  });

  test('hostile text in every editor field is stored as plain text and read back unchanged', async ({ playwright, baseURL }) => {
    const a = await admin(playwright, baseURL!);
    const created = await a.post('/api/admin/projects', { form: { action: 'create' }, headers: sameOrigin(baseURL!), maxRedirects: 0 });
    const id = /\/dashboard\/projects\/(\d+)/.exec(header(created, 'location'))![1];
    await new Promise((r) => setTimeout(r, 1200));
    const f = editorFields(await (await a.get(`/dashboard/projects/${id}`)).text());
    const evil = { title: "x'); DROP TABLE projects;--", summary: `" OR 1=1 --`, body: "# t\n\n'); DELETE FROM projects;--\n\n<script>alert(1)</script>", tags: "a', 'b'); --" };
    const r = await a.post(`/dashboard/projects/${id}`, { form: { ...f, ...evil, intent: 'save' }, headers: sameOrigin(baseURL!), maxRedirects: 0 });
    expect(r.status()).toBe(303);
    const row = d1('e2e-a', `SELECT title, summary, body_md FROM projects WHERE id = ${id}`)[0];
    expect(row).toMatchObject({ title: evil.title, summary: evil.summary, body_md: evil.body });
    expect(count("SELECT count(*) n FROM sqlite_master WHERE name = 'projects' AND type = 'table'")).toBe(1);
    expect(count('SELECT count(*) n FROM projects')).toBeGreaterThan(3);
    expect(await (await a.get(`/dashboard/projects/${id}`)).text()).not.toContain('<script>alert(1)</script>');
    await a.dispose();
  });
});

test.describe('retention', () => {
  test('old rate-limit rows (which hold IP addresses) are deleted automatically, recent ones are kept', async ({ request, baseURL }) => {
    d1('e2e-a', "INSERT OR REPLACE INTO login_attempts (key, count, window_start) VALUES ('reveal:old-test-1', 3, 1000), ('contact:old-test-2', 1, 1000), ('login:fresh-test', 1, strftime('%s','now'))");
    for (let i = 0; i < 200 && count("SELECT count(*) n FROM login_attempts WHERE key LIKE '%old-test%'") > 0; i += 20)
      await Promise.all(Array.from({ length: 20 }, () => request.post('/api/reveal', { data: { kind: 'unknown' }, headers: sameOrigin(baseURL!, freshIp()) })));
    expect(count("SELECT count(*) n FROM login_attempts WHERE key LIKE '%old-test%'"), 'rows older than 2 hours should be gone').toBe(0);
    expect(count("SELECT count(*) n FROM login_attempts WHERE key = 'login:fresh-test'"), 'recent rows must stay').toBe(1);
  });
});
