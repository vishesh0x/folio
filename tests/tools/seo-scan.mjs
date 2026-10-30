// Prints the search and sharing metadata, heading outline and robots signals of each page of the running server (default: server E, port 8791).
import { chromium } from '/home/claude/folio/node_modules/playwright/index.mjs';
const BASE = process.argv[2] ?? 'http://localhost:8791';
const paths = process.argv.slice(3).length ? process.argv.slice(3) : ['/', '/projects', '/projects/wanderhost-booking', '/now', '/resume', '/contact', '/auth', '/no-such-page', '/projects/secret-draft', '/dashboard'];
const b = await chromium.launch(); const p = await b.newPage();
for (const path of paths) {
  const res = await p.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  const d = await p.evaluate(() => {
    const m = (sel, attr = 'content') => [...document.querySelectorAll(sel)].map((e) => e.getAttribute(attr));
    return { title: document.title, lang: document.documentElement.lang, desc: m('meta[name=description]'), canon: m('link[rel=canonical]', 'href'), robots: m('meta[name=robots]'),
      og: Object.fromEntries([...document.querySelectorAll('meta[property^="og:"]')].map((e) => [e.getAttribute('property'), (e.content || '').slice(0, 70)])),
      tw: Object.fromEntries([...document.querySelectorAll('meta[name^="twitter:"]')].map((e) => [e.getAttribute('name'), (e.content || '').slice(0, 50)])),
      ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { const j = JSON.parse(s.textContent); return (Array.isArray(j) ? j : [j]).map((x) => x['@type']).join('+'); } catch { return 'INVALID JSON'; } }),
      headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => `${h.tagName}:${h.textContent.trim().slice(0, 28)}`), alt: [...document.querySelectorAll('link[rel=alternate]')].map((l) => l.getAttribute('type') || l.getAttribute('hreflang')) };
  });
  console.log(`\n=== ${path}  -> ${res.status()}  X-Robots-Tag: ${res.headers()['x-robots-tag'] ?? '-'}`);
  console.log(' title:', d.title, '| lang:', d.lang, '| robots:', d.robots.join(',') || '-'); console.log(' desc :', (d.desc[0] ?? 'MISSING').slice(0, 90)); console.log(' canon:', d.canon.join(',') || 'MISSING');
  console.log(' og   :', JSON.stringify(d.og)); console.log(' tw   :', JSON.stringify(d.tw)); console.log(' ld   :', d.ld.join(' | ') || 'none', '| alternates:', d.alt.join(',') || '-');
  console.log(' h    :', d.headings.join('  ') || 'NO HEADINGS');
}
await b.close();
