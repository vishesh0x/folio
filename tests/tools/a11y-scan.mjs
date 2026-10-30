// Runs axe-core (an accessibility checker) over every page of the running counting server (server E, port 8791) in light and dark, at desktop and phone size,
// and prints what it finds, grouped by problem. Usage: node tests/tools/a11y-scan.mjs [baseUrl]
import { chromium } from '/home/claude/folio/node_modules/playwright/index.mjs';
import AxeBuilder from '/home/claude/folio/node_modules/@axe-core/playwright/dist/index.mjs';
import { send, BASE as DEFAULT } from './subrequests.mjs';
const BASE = process.argv[2] ?? DEFAULT;
let r = await send('POST', '/auth', { form: { mode: 'setup', token: 'e2e-setup-token-0123456789abcdef', email: 'tool@example.com', password: 'correct horse battery staple 42', confirm: 'correct horse battery staple 42' } });
if (r.status !== 302) r = await send('POST', '/auth', { form: { mode: 'login', email: 'tool@example.com', password: 'correct horse battery staple 42' } });
const session = r.res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.includes('='));
const [cname, cval] = [session.split('=')[0], session.split('=').slice(1).join('=')];
const PUBLIC = ['/', '/projects', '/projects/wanderhost-booking', '/projects/pocket-ledger', '/now', '/resume', '/contact', '/auth', '/no-such-page'];
const DASH = ['/dashboard', '/dashboard/projects', '/dashboard/projects/1', '/dashboard/assets', '/dashboard/settings', '/dashboard/seo', '/dashboard/inbox', '/dashboard/now', '/dashboard/resume'];
const browser = await chromium.launch(); const found = new Map();
for (const scheme of ['light', 'dark']) for (const [w, h, label] of [[1280, 900, 'desktop'], [390, 844, 'phone']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, reducedMotion: 'reduce' });
  await ctx.addCookies([{ name: cname, value: cval, domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 86400 }]);
  const page = await ctx.newPage();
  for (const path of [...PUBLIC, ...DASH]) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(250);
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
    for (const v of res.violations) for (const n of v.nodes) {
      const key = `${v.id}|${n.target.join(' ')}`; const e = found.get(key) ?? { id: v.id, impact: v.impact, help: v.help, target: n.target.join(' '), html: n.html.slice(0, 110), where: new Set(), why: (n.any[0]?.message ?? n.failureSummary ?? '').slice(0, 160) };
      e.where.add(`${path} [${scheme}/${label}]`); found.set(key, e);
    }
  }
  await ctx.close();
}
await browser.close();
const by = new Map(); for (const e of found.values()) by.set(e.id, [...(by.get(e.id) ?? []), e]);
for (const [id, list] of [...by].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n### ${id} (${list[0].impact}): ${list[0].help}  -- ${list.length} element(s)`);
  for (const e of list.slice(0, 6)) console.log(`  ${e.target}\n    ${e.html}\n    ${e.why}\n    seen on: ${[...e.where].slice(0, 4).join('; ')}${e.where.size > 4 ? ` (+${e.where.size - 4} more)` : ''}`);
}
console.log(`\nTOTAL distinct findings: ${found.size}`);
