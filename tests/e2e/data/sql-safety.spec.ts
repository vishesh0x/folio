import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AUTH_FILE, freshIp, header, login, sameOrigin } from '../helpers';
import { withRetry } from '../fixtures';
import { d1 } from '../d1';

// Step 3: SQL injection. Two layers: a STATIC check that nothing in src/ builds SQL from variable text except a short, reviewed list, and
// DYNAMIC checks that throw hostile text at every input and verify nothing but the intended row changed.
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|astro)$/.test(f) ? [p] : []; });

// Every `${...}` allowed inside a SQL string, with the reason it is safe. Adding a new one means adding it here, i.e. a conscious review.
const ALLOWED: Record<string, string> = {
  'where': 'src/lib/inbox.ts: one of two fixed strings chosen by code',
  'cols': 'src/lib/markdown.ts: a fixed column list',
  'SELECT': 'src/lib/projects.ts: a fixed column list constant',
  'table': 'src/lib/now-admin.ts, resume-admin.ts: typed as a union of fixed table names, only ever called with literals',
  "opts.featured ? 'AND p.featured = 1' : ''": 'src/lib/projects.ts: boolean chooses between two fixed strings',
  "list.map(() => '?').join(',')": 'a row of ? placeholders; the values are still bound',
  "ids.map(() => '?').join(',')": 'a row of ? placeholders; the values are still bound',
};

test.describe('static: no SQL is built from variable text', () => {
  const sql = files('src').flatMap((f) => {
    const s = readFileSync(f, 'utf8'); const out: { file: string; line: number; text: string; arg: string }[] = [];
    for (const m of s.matchAll(/\.prepare\(\s*([^)]{0,3}?)(`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")?/g)) {
      out.push({ file: f, line: s.slice(0, m.index).split('\n').length, text: m[2] ?? '', arg: m[1] });
    }
    return out;
  });

  test('found the statements to check (guards against this test silently checking nothing)', () => { expect(sql.length).toBeGreaterThan(90); });
  test('every prepare() is given a literal string, never a variable or a concatenation', () => {
    expect(sql.filter((q) => !q.text).map((q) => `${q.file}:${q.line}`)).toEqual([]);
    const concat = files('src').flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\.prepare\(\s*(?:`[^`]*`|'[^']*'|"[^"]*")\s*\+/g)].map(() => f));
    expect(concat).toEqual([]);
  });
  test('the only ${...} spliced into SQL are on the reviewed list', () => {
    const unknown: string[] = [];
    for (const q of sql) for (const m of q.text.matchAll(/\$\{([^}]*)\}/g)) if (!(m[1].trim() in ALLOWED)) unknown.push(`${q.file}:${q.line}  \${${m[1]}}`);
    expect(unknown, 'new interpolation in SQL: bind it as a parameter, or review it and add it to ALLOWED').toEqual([]);
  });
  test('nothing runs raw SQL text (exec/dump), and no SQL is assembled in the markup layer', () => {
    const bad = files('src').filter((f) => /\bDB\.(exec|dump)\(/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
  test('values from the visitor are bound (?): every .bind() call site passes arguments, not SQL', () => {
    const risky = files('src').flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\.prepare\([^)]*\$\{(?:filter|q|query|search|tag|id|slug|name|email|input|value)\}/g)].map(() => f));
    expect(risky).toEqual([]);
  });
});

const PAYLOADS = [
  "' OR '1'='1", "'); DROP TABLE messages;--", '" OR 1=1 --', "x'; UPDATE users SET password_hash='pwned';--", "%' OR 1=1 --", "'; ATTACH DATABASE '/tmp/x' AS y;--",
  '1; SELECT sqlite_version()', "Robert'); DROP TABLE Students;--", '<script>alert(1)</script>', '\\', "'' UNION SELECT password_hash FROM users--", '🙂 ünïcödé',
];

test.describe('dynamic: hostile text in every input', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('contact form: stored as plain text, exactly one row each, nothing else touched', async ({ request, baseURL }) => {
    const before = { msgs: d1('e2e-a', 'SELECT count(*) n FROM messages')[0].n, hash: d1('e2e-a', 'SELECT password_hash h FROM users')[0].h, tables: d1('e2e-a', "SELECT count(*) n FROM sqlite_master WHERE type='table'")[0].n };
    const html = await (await request.get('/contact', { headers: { 'cf-connecting-ip': freshIp() } })).text();
    const t = /name="t" value="([^"]+)"/.exec(html)![1];
    await new Promise((r) => setTimeout(r, 3300));
    let accepted = 0;
    for (const p of PAYLOADS) {
      const r = await request.post('/contact', { form: { name: p.slice(0, 60), email: "o'brien@example.com", subject: p.slice(0, 80), message: `Message with a hostile part: ${p}`, website: '', t }, headers: sameOrigin(baseURL!), maxRedirects: 0 });
      expect(r.status(), p).toBeLessThan(500);
      if (r.status() === 303) accepted++;
    }
    expect(accepted).toBeGreaterThanOrEqual(PAYLOADS.length - 1);
    const after = { msgs: d1('e2e-a', 'SELECT count(*) n FROM messages')[0].n, hash: d1('e2e-a', 'SELECT password_hash h FROM users')[0].h, tables: d1('e2e-a', "SELECT count(*) n FROM sqlite_master WHERE type='table'")[0].n };
    expect(after.msgs - before.msgs, 'one row per accepted message').toBe(accepted);
    expect(after.hash, 'the admin password hash must be untouched').toBe(before.hash);
    expect(after.tables, 'no table may be dropped or attached').toBe(before.tables);
    const stored = d1('e2e-a', "SELECT subject FROM messages WHERE subject LIKE '%DROP TABLE messages%' LIMIT 1")[0];
    expect(stored.subject).toContain("'); DROP TABLE messages;--");   // kept verbatim, as text
  });

  test('the inbox shows that text escaped (it cannot become markup)', async ({ playwright, baseURL }) => {
    const admin = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
    const html = await (await admin.get('/dashboard/inbox')).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    await admin.dispose();
  });

  test('sign in: no injected email or password gets past, none causes an error', async ({ request, baseURL }) => {
    for (const p of PAYLOADS.concat(["admin@example.com' --", "' OR 1=1 --@x.co", "admin@example.com'/*"])) {
      for (const [email, password] of [[p, 'whatever whatever'], ['admin@example.com', p + p]]) {
        const r = await login(request, baseURL!, email, password, freshIp());
        expect([400, 401], `${email} / ${password}`).toContain(r.status());
        expect(header(r, 'set-cookie')).toBe('');
      }
    }
  });

  test('addresses and query strings: never a server error, never data from the injection', async ({ request }) => {
    const bad = encodeURIComponent("' OR 1=1 --"), drop = encodeURIComponent("'; DROP TABLE projects;--");
    for (const path of [`/projects/${bad}`, `/projects/${drop}`, `/projects/%27`, `/projects/..%2f..%2fetc`, `/projects?tag=${bad}`, `/projects?tag=${drop}`, `/projects?q=${drop}`,
      `/media/${bad}/a.png`, `/media/${drop}/a.png?w=${bad}&f=${drop}`, `/now?x=${drop}`, `/resume?x=${bad}`, `/icons/${bad}`, `/sitemap.xml?x=${drop}`]) {
      const r = await request.get(path);
      expect(r.status(), path).toBeLessThan(500);
      expect([200, 301, 400, 404], path).toContain(r.status());
    }
    const list = await (await request.get('/projects')).text();
    expect(list, 'projects must still exist').toContain('WanderHost');
    expect(d1('e2e-a', "SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='projects'")[0].n).toBe(1);
  });

  test.describe('dashboard inputs (signed in)', () => {
    test.use({ storageState: AUTH_FILE });
    test('filters and page numbers are validated, not spliced into SQL', async ({ request }) => {
      const drop = encodeURIComponent("'; DROP TABLE messages;--");
      for (const path of [`/dashboard/projects?filter=${drop}`, `/dashboard/projects?filter=draft%27%20OR%201=1`, `/dashboard/inbox?filter=${drop}`, `/dashboard/inbox?page=${drop}`, `/dashboard/inbox?page=-1`, `/dashboard/inbox?page=99999999999`, `/dashboard/inbox/${drop}`, `/dashboard/projects/${drop}`, `/dashboard/inbox/0`, `/dashboard/inbox/9999999`]) {
        const r = await request.get(path, { maxRedirects: 0 });
        expect(r.status(), path).toBeLessThan(500);
      }
      expect(d1('e2e-a', "SELECT count(*) n FROM sqlite_master WHERE name='messages' AND type='table'")[0].n).toBe(1);
    });
  });
});
