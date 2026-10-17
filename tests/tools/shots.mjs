// Dev tool: screenshots + layout measurements of every page at phone/tablet/desktop widths.
//   BASE=http://localhost:8790 OUT=/tmp/shots node tests/tools/shots.mjs [public|dashboard|all] [widths comma list]
// Needs a running site with the demo seed (tests/seed/demo.sql). Creates the admin through the setup form if there is none.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:8790', OUT = process.env.OUT ?? '/tmp/shots';
const WHICH = process.argv[2] ?? 'all', WIDTHS = (process.argv[3] ?? '320,375,414,768').split(',').map(Number);
const TOKEN = process.env.SETUP_TOKEN ?? 'e2e-setup-token-0123456789abcdef', EMAIL = 'admin@example.com', PW = 'correct horse battery staple 42';
const PUBLIC = [['home', '/'], ['projects', '/projects'], ['project', '/projects/wanderhost-booking'], ['project-long', '/projects/an-extremely-long-project-title-with-Antidisestablishmentarianism-inside'], ['now', '/now'], ['resume', '/resume'], ['contact', '/contact'], ['notfound', '/nope-nope'], ['forbidden', '/error/403'], ['auth', '/auth']];
const DASH = [['d-home', '/dashboard'], ['d-projects', '/dashboard/projects'], ['d-project', '/dashboard/projects/1'], ['d-now', '/dashboard/now'], ['d-resume', '/dashboard/resume'], ['d-inbox', '/dashboard/inbox'], ['d-message', '/dashboard/inbox/1'], ['d-seo', '/dashboard/seo'], ['d-settings', '/dashboard/settings'], ['d-assets', '/dashboard/assets']];

const measure = () => {
  const vw = document.documentElement.clientWidth, bad = [], small = [];
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (!r.width || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.closest('.hp, .visually-hidden, .skip, [hidden]')) continue;
    if (r.right > vw + 1 || r.left < -1) {
      let p = el.parentElement, clipped = false;
      while (p && p !== document.body) { if (getComputedStyle(p).overflowX !== 'visible') { clipped = true; break; } p = p.parentElement; }
      if (!clipped) bad.push(`${name(el)} ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    if (el.matches('a[href], button, summary, select, input:not([type=hidden]), textarea, [role=button]') && (r.height < 44 || r.width < 44)) {
      // links inside running text are exempt (WCAG 2.2 inline exception); report the rest
      if (el.matches('a') && el.closest('p, li, .md, .prose, h1, h2, h3') && !el.closest('nav, .nav, .footer-links, .chips, .menu')) continue;
      small.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent || el.getAttribute('aria-label') || el.value || '').trim().slice(0, 18)}"`);
    }
  }
  return { sw: document.documentElement.scrollWidth, vw, bad: [...new Set(bad)].slice(0, 6), small: [...new Set(small)].slice(0, 8) };
};

const browser = await chromium.launch();
const mk = (w) => browser.newContext({ viewport: { width: w, height: w >= 1024 ? 800 : 740 }, isMobile: w < 1024, hasTouch: w < 1024, deviceScaleFactor: 1, extraHTTPHeaders: { 'cf-connecting-ip': '10.9.9.9' } });
const out = (...a) => console.log(...a);

// sign in once (create the admin if needed) and keep the cookies
const boot = await mk(1280), bp = await boot.newPage();
await bp.goto(BASE + '/auth');
if (await bp.getByRole('heading', { name: 'Set up your site' }).isVisible()) {
  await bp.getByLabel('Setup token').fill(TOKEN); await bp.getByLabel('Email').fill(EMAIL);
  await bp.locator('#s-pw').fill(PW); await bp.locator('#s-pw2').fill(PW); await bp.getByRole('button', { name: 'Create admin account' }).click();
} else { await bp.getByLabel('Email').fill(EMAIL); await bp.locator('#pw').fill(PW); await bp.getByRole('button', { name: 'Sign in' }).click(); }
await bp.waitForURL(/dashboard/); const state = await boot.storageState(); await boot.close();

for (const w of WIDTHS) {
  mkdirSync(`${OUT}/${w}`, { recursive: true });
  const list = [...(WHICH !== 'dashboard' ? PUBLIC : []), ...(WHICH !== 'public' ? DASH : [])];
  for (const [name, path] of list) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 740 }, isMobile: w < 1024, hasTouch: w < 1024, storageState: name.startsWith('d-') ? state : undefined, extraHTTPHeaders: { 'cf-connecting-ip': '10.9.9.9' } });
    const page = await ctx.newPage(); await page.goto(BASE + path, { waitUntil: 'networkidle' });
    const m = await page.evaluate(measure);
    await page.screenshot({ path: `${OUT}/${w}/${name}.png`, fullPage: true });
    const flag = m.sw > m.vw + 1 || m.bad.length ? 'OVERFLOW' : 'ok';
    out(`${String(w).padEnd(4)} ${name.padEnd(13)} ${flag.padEnd(9)} sw=${m.sw}/${m.vw}${m.bad.length ? '  BAD: ' + m.bad.join(' | ') : ''}${m.small.length && process.env.SMALL ? '\n        small: ' + m.small.join(' | ') : ''}`);
    await ctx.close();
  }
}
await browser.close();
