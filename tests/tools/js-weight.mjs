// Dev tool: how much JavaScript each page really downloads (raw and gzipped), and how many inline scripts it contains.
//   BASE=http://localhost:8790 node tests/tools/js-weight.mjs
import { chromium } from '@playwright/test';
import { gzipSync } from 'node:zlib';
const BASE = process.env.BASE ?? 'http://localhost:8790';
const PUBLIC = ['/', '/projects', '/projects/pocket-ledger', '/projects/wanderhost-booking', '/now', '/resume', '/contact', '/auth', '/nope'];
const DASH = ['/dashboard', '/dashboard/projects', '/dashboard/projects/1', '/dashboard/now', '/dashboard/resume', '/dashboard/inbox', '/dashboard/settings', '/dashboard/assets', '/dashboard/seo'];
const b = await chromium.launch();
const boot = await b.newContext({ extraHTTPHeaders: { 'cf-connecting-ip': '10.1.2.3' } }), bp = await boot.newPage();
await bp.goto(BASE + '/auth'); await bp.getByLabel('Email').fill('admin@example.com'); await bp.locator('#pw').fill('correct horse battery staple 42'); await bp.getByRole('button', { name: 'Sign in' }).click(); await bp.waitForURL(/dashboard/);
const state = await boot.storageState();
for (const [group, pages] of [['PUBLIC', PUBLIC], ['DASHBOARD', DASH]]) {
  console.log(`\n${group}\n${'page'.padEnd(34)} ${'JS files'.padStart(8)} ${'raw KB'.padStart(8)} ${'gzip KB'.padStart(8)} ${'inline'.padStart(7)} ${'CSS in HTML KB'.padStart(15)}  largest file`);
  for (const path of pages) {
    const ctx = await b.newContext({ storageState: group === 'DASHBOARD' ? state : undefined, viewport: { width: 412, height: 823 }, extraHTTPHeaders: { 'cf-connecting-ip': '10.1.2.3' } });
    const p = await ctx.newPage(); const files = [];
    p.on('response', async (r) => { if (/\.js(\?|$)/.test(r.url())) { const body = await r.body().catch(() => Buffer.alloc(0)); files.push({ n: r.url().split('/').pop(), raw: body.length, gz: gzipSync(body).length }); } });
    const res = await p.goto(BASE + path, { waitUntil: 'networkidle' });
    const html = await res.text();
    const inline = (html.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || []).filter((s) => !/application\/ld\+json/.test(s)).length;
    const css = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/g) || []).reduce((n, s) => n + s.length, 0);
    const raw = files.reduce((n, f) => n + f.raw, 0), gz = files.reduce((n, f) => n + f.gz, 0), big = files.sort((a, b) => b.raw - a.raw)[0];
    console.log(`${path.padEnd(34)} ${String(files.length).padStart(8)} ${(raw / 1024).toFixed(1).padStart(8)} ${(gz / 1024).toFixed(1).padStart(8)} ${String(inline).padStart(7)} ${(css / 1024).toFixed(1).padStart(15)}  ${big ? big.n.slice(0, 38) : '-'}`);
    await ctx.close();
  }
}
await b.close();
