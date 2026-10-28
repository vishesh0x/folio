import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// Step 5: the deployment configuration (wrangler.jsonc). These read files only; no server is involved.
const { parse } = createRequire(import.meta.url)('jsonc-parser') as { parse: (s: string) => any };   // wrangler's own comment-tolerant JSON reader
const cfg = parse(readFileSync('wrangler.jsonc', 'utf8'));
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|astro|mjs)$/.test(f) ? [p] : []; });
const BINDINGS = ['d1_databases', 'r2_buckets', 'images'] as const;
const names = (c: any) => ({ d1: (c.d1_databases ?? []).map((x: any) => x.binding), r2: (c.r2_buckets ?? []).map((x: any) => x.binding), images: c.images ? [c.images.binding] : [] });

test('the Worker is reachable only on the site\'s own domain: no workers.dev address, no per-version preview addresses', () => {
  // Those addresses would skip the zone's firewall and rate-limit rules and serve a duplicate copy of the site.
  expect(cfg.workers_dev).toBe(false);
  expect(cfg.preview_urls).toBe(false);
});

test('every environment variable the code reads is declared in src/env.d.ts, and every binding it uses exists in wrangler.jsonc', () => {
  const declared = new Set([...readFileSync('src/env.d.ts', 'utf8').split('interface Env {')[1].split('}')[0].matchAll(/^\s*([A-Z_]+)\??:/gm)].map((m) => m[1]));
  const used = new Set<string>();
  for (const f of files('src')) for (const m of readFileSync(f, 'utf8').matchAll(/\benv\.([A-Z][A-Z_]+)\b/g)) if (m[1] !== 'PROD') used.add(m[1]);   // env.PROD is Vite's own flag
  expect([...used].filter((n) => !declared.has(n)), 'read in code but not declared in src/env.d.ts').toEqual([]);
  const bound = new Set([...names(cfg).d1, ...names(cfg).r2, ...names(cfg).images, ...Object.keys(cfg.vars ?? {})]);
  for (const b of ['DB', 'ASSETS_BUCKET', 'IMAGES']) expect(bound.has(b), `${b} must be bound in wrangler.jsonc`).toBe(true);
});

test('no secret is written in wrangler.jsonc: only the public Turnstile site key may sit in "vars"', () => {
  const allVars = [cfg.vars, ...Object.values<any>(cfg.env ?? {}).map((e) => e.vars)].flatMap((v) => Object.keys(v ?? {}));
  for (const k of allVars) expect(['TURNSTILE_SITE_KEY'], `"${k}" looks like a secret and must be set with wrangler secret put`).toContain(k);
  for (const k of ['ADMIN_SETUP_TOKEN', 'RATE_LIMIT_SALT', 'TURNSTILE_SECRET_KEY']) expect(readFileSync('wrangler.jsonc', 'utf8').replace(/\/\/.*$/gm, '')).not.toContain(k);
});

test('there is no staging environment, and any environment added later must repeat every binding and share NO resource with production', () => {
  // Bindings are not inherited: a missing one fails at run time; a copied one would let a rehearsal write to the live database.
  const envs = Object.entries<any>(cfg.env ?? {});
  // Deliberately none today. If one is added, delete the next line; the loop below then checks it.
  expect(envs.map(([n]) => n)).toEqual([]);
  for (const [name, e] of envs) {
    for (const k of ['d1', 'r2', 'images'] as const) expect(names(e)[k], `${name}: ${k} bindings`).toEqual(names(cfg)[k]);
    expect(e.name, `${name}: its own Worker name`).not.toBe(cfg.name);
    for (const d of e.d1_databases) { expect(cfg.d1_databases.map((x: any) => x.database_id)).not.toContain(d.database_id); expect(cfg.d1_databases.map((x: any) => x.database_name)).not.toContain(d.database_name); }
    for (const r of e.r2_buckets) expect(cfg.r2_buckets.map((x: any) => x.bucket_name)).not.toContain(r.bucket_name);
  }
});

test('the build picks the environment named by CLOUDFLARE_ENV, so a normal build is always production', () => {
  // dist/server/wrangler.json is what `wrangler deploy` reads after `astro build`. `--env` on deploy does not change it.
  const built = JSON.parse(readFileSync('dist/server/wrangler.json', 'utf8'));
  test.skip(built.name !== cfg.name, 'dist was built for another environment');
  expect(built.d1_databases[0].database_id).toBe(cfg.d1_databases[0].database_id);
  expect(built.workers_dev).toBe(false);
  expect(built.preview_urls).toBe(false);
});

test('what the server writes to its logs (Cloudflare keeps them) never includes secrets, cookies, addresses, emails or message text', () => {
  const bad = /password|secret|token|cookie|authorization|formData|\bemail\b|\bip\b|\.headers|body_md|\bmessage\.(body|text)/i;
  const lines = files('src').filter((f) => !f.startsWith('src/scripts')).flatMap((f) => readFileSync(f, 'utf8').split('\n').map((l, i) => ({ f, i: i + 1, l }))).filter((x) => /console\.(log|error|warn|info|debug)\(/.test(x.l));
  expect(lines.length, 'there are log statements to check').toBeGreaterThan(0);
  expect(lines.filter((x) => bad.test(x.l)).map((x) => `${x.f}:${x.i}`)).toEqual([]);
});
