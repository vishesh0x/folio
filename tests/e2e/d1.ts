import { execFileSync } from 'node:child_process';

/** Run SQL against one of the throwaway test databases (the same files the running test server uses). Returns the rows of the LAST statement. */
export function d1(dir: 'e2e-a' | 'e2e-d', sql: string): any[] {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'folio-db', '--local', '--persist-to', `.wrangler/${dir}`, '--json', '--command', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
  const parsed = JSON.parse(out.slice(out.indexOf('[')));
  const last = parsed[parsed.length - 1];
  if (last && last.success === false) throw new Error(last.error ?? 'SQL failed');
  return last?.results ?? [];
}
/** Like d1(), but returns the error text instead of throwing (for statements that SHOULD be refused). */
export function d1Error(dir: 'e2e-a' | 'e2e-d', sql: string): string | null {
  try { d1(dir, sql); return null; } catch (e: any) { return [e.stdout, e.stderr, e.message].filter(Boolean).join(' '); }   // wrangler prints SQL errors on stdout
}

const TABLES = ['users', 'sessions', 'settings', 'assets', 'projects', 'seo_pages', 'now_categories', 'now_items', 'resume_sections', 'resume_entries', 'messages', 'login_attempts'];
/** Simulate a database outage: every table disappears (renamed), so every query fails exactly like a real outage. Always pair with restoreDb(). */
export const breakDb = (dir: 'e2e-d', tables = TABLES) => d1(dir, 'PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; ' + tables.map((t) => `ALTER TABLE ${t} RENAME TO ${t}_off;`).join(' '));
export const restoreDb = (dir: 'e2e-d', tables = TABLES) => {
  const have = new Set(d1(dir, "SELECT name FROM sqlite_master WHERE type='table'").map((r: any) => r.name));
  const broken = tables.filter((t) => have.has(`${t}_off`));
  if (broken.length) d1(dir, 'PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; ' + broken.map((t) => `ALTER TABLE ${t}_off RENAME TO ${t};`).join(' '));
};

/** Run several statements in one call and get every statement's rows back (one wrangler start-up instead of many). */
export function d1All(dir: 'e2e-a' | 'e2e-d', sql: string): any[][] {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'folio-db', '--local', '--persist-to', `.wrangler/${dir}`, '--json', '--command', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
  return JSON.parse(out.slice(out.indexOf('['))).map((r: any) => r.results ?? []);
}
/** EXPLAIN QUERY PLAN as one readable line per step. */
export const plan = (dir: 'e2e-a' | 'e2e-d', sql: string): string[] => d1(dir, `EXPLAIN QUERY PLAN ${sql}`).map((r: any) => r.detail);

// ── R2 (the file bucket) of the throwaway test servers
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const r2 = (dir: string, args: string[]) => execFileSync('npx', ['wrangler', 'r2', 'object', ...args, '--local', '--persist-to', `.wrangler/${dir}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
/** Put a file straight into the bucket, bypassing the site (to create a "stray" file). */
export function r2Put(dir: 'e2e-a' | 'e2e-d', key: string, bytes: Buffer) {
  const t = mkdtempSync(join(tmpdir(), 'r2-')); const f = join(t, 'obj'); writeFileSync(f, bytes);
  try { r2(dir, ['put', `folio-assets/${key}`, '--file', f, '--content-type', 'application/octet-stream']); } finally { rmSync(t, { recursive: true, force: true }); }
}
/** Is this object in the bucket? */
export function r2Has(dir: 'e2e-a' | 'e2e-d', key: string): boolean {
  const t = mkdtempSync(join(tmpdir(), 'r2-')); const f = join(t, 'obj');
  try { r2(dir, ['get', `folio-assets/${key}`, '--file', f]); return true; } catch { return false; } finally { rmSync(t, { recursive: true, force: true }); }
}
