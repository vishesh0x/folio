import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, cpSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
// @ts-ignore (a plain script, also run by hand: node scripts/d1-restore-drill.mjs)
import { drill } from '../../../scripts/d1-restore-drill.mjs';

// Step 9: a backup you have never restored is only a hope. The drill exports a database, loads the export into a NEW empty database and compares every
// table row for row. Here it is run on a copy of the test database; on your real one: node scripts/d1-restore-drill.mjs --remote
test.describe.configure({ mode: 'serial' });
const DB = 'folio-db';
let dir = '';
test.beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'drill-test-')); });
test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

const run = (name: string, afterExport?: (file: string) => void) => {
  const to = join(dir, `restored-${name}`), from = '.wrangler/e2e-a';
  const exportTo = (out: string) => { const w = join(dir, `work-${name}`); mkdirSync(join(w, '.wrangler'), { recursive: true }); cpSync(from, join(w, '.wrangler', 'state'), { recursive: true }); copyFileSync('wrangler.jsonc', join(w, 'wrangler.jsonc')); execFileSync('npx', ['wrangler', 'd1', 'export', DB, '--local', '--cwd', w, '--output', out], { stdio: 'pipe' }); };
  return drill({ name: DB, flags: ['--local', '--persist-to', from], exportTo }, { name: DB, flags: ['--local', '--persist-to', to] }, join(dir, `export-${name}.sql`), afterExport);
};

test('an export loaded into a new empty database gives back every table, row for row', async () => {
  test.setTimeout(240_000);
  const r = run('ok');
  expect(r.tables, 'the real tables').toEqual(expect.arrayContaining(['assets', 'messages', 'now_items', 'projects', 'resume_entries', 'resume_sections', 'settings', 'users', 'sessions']));
  expect(r.mismatched).toEqual([]);
  expect(r.rows.projects, 'with real data in it').toBeGreaterThan(2);
});

test('and the drill can fail: if the export lost rows, it says which table did not come back (the messages)', async () => {
  test.setTimeout(240_000);
  const r = run('damaged', (file) => writeFileSync(file, readFileSync(file, 'utf8').split('\n').filter((l) => !/INSERT INTO "?messages"?/i.test(l)).join('\n')));
  expect(r.mismatched).toContain("messages");
});
