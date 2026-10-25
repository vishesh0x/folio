import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { d1, d1All, d1Error, plan } from '../d1';

// Step 3: migrations, indexes, constraints and integrity, checked against the real (local) D1 engine the test server uses.
const FILES = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();

test.describe('migrations', () => {
  test('numbered 0001, 0002, ... with no gaps, repeats or odd names', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(6);
    FILES.forEach((f, i) => { expect(f).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/); expect(Number(f.slice(0, 4)), f).toBe(i + 1); });
  });
  test('every migration has been recorded as applied, in order (D1 tracks them in d1_migrations)', () => {
    expect(d1('e2e-a', 'SELECT name FROM d1_migrations ORDER BY id').map((r: any) => r.name)).toEqual(FILES);
  });
  test('they build a database from nothing, and running them again changes nothing', () => {
    const dir = '.wrangler/e2e-migrate-check'; rmSync(dir, { recursive: true, force: true });
    const run = () => execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'folio-db', '--local', '--persist-to', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    try { expect(run()).toContain(FILES[FILES.length - 1]); expect(run()).toContain('No migrations to apply'); } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test('from 0006 on, every statement that creates an index is safe to repeat (IF NOT EXISTS). Older, already-applied migrations are never edited', () => {
    const idx = FILES.filter((f) => f >= '0006').flatMap((f) => readFileSync(`migrations/${f}`, 'utf8').split('\n').filter((l) => /^\s*CREATE\s+(UNIQUE\s+)?INDEX/i.test(l)).map((l) => `${f}: ${l.trim()}`));
    expect(idx.filter((l) => !/IF NOT EXISTS/i.test(l))).toEqual([]);
  });
});

test.describe('indexes', () => {
  test('every foreign key column is the first column of some index (cascades and child lookups never scan)', () => {
    const tables = d1('e2e-a', "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name <> 'd1_migrations'").map((r: any) => r.name as string);
    const [...rows] = d1All('e2e-a', tables.map((t) => `PRAGMA foreign_key_list(${t}); PRAGMA index_list(${t});`).join(' '));
    const fks: { t: string; col: string }[] = [], idxNames: { t: string; name: string }[] = [];
    tables.forEach((t, i) => { rows[i * 2].forEach((f: any) => fks.push({ t, col: f.from })); rows[i * 2 + 1].forEach((x: any) => idxNames.push({ t, name: x.name })); });
    const info = d1All('e2e-a', idxNames.map((x) => `PRAGMA index_info(${x.name});`).join(' '));
    const first = new Set<string>(); idxNames.forEach((x, i) => { const c = [...info[i]].sort((a: any, b: any) => a.seqno - b.seqno)[0]; if (c) first.add(`${x.t}.${c.name}`); });
    expect(fks.length).toBeGreaterThanOrEqual(7);
    expect(fks.filter((f) => !first.has(`${f.t}.${f.col}`)).map((f) => `${f.t}.${f.col}`), 'foreign keys without an index').toEqual([]);
  });

  // The statements the site really runs often, and what the plan must (not) contain. "TEMP B-TREE" = an extra sort of every row.
  const CASES: [string, string, RegExp, RegExp?][] = [
    ['inbox, newest first', 'SELECT * FROM messages ORDER BY created_at DESC, id DESC LIMIT 25 OFFSET 0', /idx_messages_recent/, /TEMP B-TREE/],
    ['inbox, unread only', 'SELECT * FROM messages WHERE is_read = 0 ORDER BY created_at DESC, id DESC LIMIT 25', /idx_messages_inbox/, /TEMP B-TREE/],
    ['dashboard: latest five messages', 'SELECT id, name, subject FROM messages ORDER BY created_at DESC, id DESC LIMIT 5', /idx_messages_recent/, /TEMP B-TREE/],
    ['Files page, newest first', 'SELECT * FROM assets ORDER BY created_at DESC, rowid DESC', /idx_assets_created/, /TEMP B-TREE/],
    ['picture by file name (![[name.png]])', "SELECT id FROM assets WHERE lower(filename) IN ('a.png','b.png') ORDER BY created_at ASC, rowid ASC", /idx_assets_filename/],
    ['public resume', 'SELECT s.id, e.id FROM resume_sections s LEFT JOIN resume_entries e ON e.section_id = s.id AND e.visible = 1 WHERE s.visible = 1 ORDER BY s.sort_order, s.id, e.sort_order, e.id', /idx_resume_entries_section/, /AUTOMATIC/],
    ['Now board items of a category', 'SELECT id FROM now_items WHERE category_id = 1 ORDER BY sort_order, id', /idx_now_items_category/],
    ['project deleted: its resume entries', 'DELETE FROM resume_entries WHERE project_id = 1', /idx_resume_entries_project/],
    ['asset deleted: projects using it as cover', "UPDATE projects SET cover_asset = NULL WHERE cover_asset = 'x'", /idx_projects_cover/],
    ['asset deleted: projects using it for sharing', "UPDATE projects SET seo_image = NULL WHERE seo_image = 'x'", /idx_projects_seo_image/],
    ['asset deleted: pages using it for sharing', "UPDATE seo_pages SET og_asset = NULL WHERE og_asset = 'x'", /idx_seo_pages_og/],
    ['public project page by address', "SELECT id FROM projects WHERE slug = 'x' AND status = 'published'", /SEARCH projects USING (COVERING )?INDEX/],
    ['public project list', "SELECT id FROM projects WHERE status = 'published' ORDER BY sort_order", /idx_projects_list/],
    ['rate-limit counter', "SELECT count FROM login_attempts WHERE key = 'x'", /SEARCH login_attempts USING (COVERING )?INDEX/],
    ['rate-limit clean-up', 'DELETE FROM login_attempts WHERE window_start < 1', /idx_attempts_window/],
    ['session lookup', "SELECT user_id FROM sessions WHERE id = 'x'", /SEARCH sessions USING (COVERING )?INDEX/],
    ['sessions of a user', 'SELECT id FROM sessions WHERE user_id = 1', /idx_sessions_user/],
  ];
  for (const [name, sql, want, forbid] of CASES) {
    test(`plan: ${name}`, () => {
      const p = plan('e2e-a', sql).join(' | ');
      expect(p).toMatch(want);
      if (forbid) expect(p).not.toMatch(forbid);
    });
  }
});

test.describe('integrity rules are enforced by the database itself', () => {
  test('the database is healthy and has no orphaned rows', () => {
    expect(d1('e2e-a', 'PRAGMA foreign_key_check')).toEqual([]);
    // (D1 does not allow PRAGMA integrity_check; foreign_key_check is the one it offers, and it covers the relationships)
  });
  test('foreign keys are really enforced (a row pointing at nothing is refused)', () => {
    expect(d1Error('e2e-a', "INSERT INTO resume_entries (section_id, data) VALUES (999999, '{}')")).toMatch(/FOREIGN KEY constraint failed/i);
    expect(d1Error('e2e-a', "INSERT INTO sessions (id, user_id, expires_at) VALUES ('zz', 999999, 9999999999)")).toMatch(/FOREIGN KEY constraint failed/i);
  });
  test('CHECK and UNIQUE rules refuse bad data', () => {
    expect(d1Error('e2e-a', "INSERT INTO projects (slug, title, status) VALUES ('tmp-bad-status', 't', 'bogus')")).toMatch(/CHECK constraint failed/i);
    expect(d1Error('e2e-a', "INSERT INTO projects (slug, title) VALUES ('wanderhost-booking', 'dup')")).toMatch(/UNIQUE constraint failed/i);
  });
  test('deleting a parent cleans up exactly what it should', () => {
    // category -> its items
    d1('e2e-a', "DELETE FROM now_categories WHERE name = 'tmp-cascade'");
    const [, , , a] = d1All('e2e-a', "INSERT INTO now_categories (name) VALUES ('tmp-cascade'); INSERT INTO now_items (category_id, title) SELECT id, 'tmp-cascade-item' FROM now_categories WHERE name = 'tmp-cascade'; DELETE FROM now_categories WHERE name = 'tmp-cascade'; SELECT count(*) n FROM now_items WHERE title = 'tmp-cascade-item';");
    expect(a[0].n, 'items must go with their category').toBe(0);
    // project -> its place on the resume
    const before = d1('e2e-a', 'SELECT count(*) n FROM resume_entries')[0].n;
    const [, , b, , c] = d1All('e2e-a', "INSERT INTO projects (slug, title) VALUES ('tmp-cascade-p', 't'); INSERT INTO resume_entries (section_id, project_id, data) SELECT (SELECT id FROM resume_sections WHERE kind = 'projects'), id, '{}' FROM projects WHERE slug = 'tmp-cascade-p'; SELECT count(*) n FROM resume_entries; DELETE FROM projects WHERE slug = 'tmp-cascade-p'; SELECT count(*) n FROM resume_entries;");
    expect(b[0].n).toBe(before + 1); expect(c[0].n, 'the resume entry must go with its project').toBe(before);
    // asset -> projects keep existing, just lose the picture
    const [, , , d] = d1All('e2e-a', "INSERT INTO assets (id, r2_key, filename, mime, size) VALUES ('tmpAsset0001', 'k', 'tmp.png', 'image/png', 1); INSERT INTO projects (slug, title, cover_asset) VALUES ('tmp-cascade-a', 't', 'tmpAsset0001'); DELETE FROM assets WHERE id = 'tmpAsset0001'; SELECT count(*) n, max(cover_asset) c FROM projects WHERE slug = 'tmp-cascade-a';");
    expect(d[0].n, 'the project must survive').toBe(1); expect(d[0].c, 'its cover must be cleared').toBeNull();
    d1('e2e-a', "DELETE FROM projects WHERE slug = 'tmp-cascade-a'");
    expect(d1('e2e-a', 'PRAGMA foreign_key_check')).toEqual([]);
  });
});
