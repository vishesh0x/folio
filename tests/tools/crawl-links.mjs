// Finds broken links. Starts at the home page and the sitemap, follows every internal link, and checks that every link, picture, script, style sheet and
// #anchor on every page leads somewhere that exists. With --external it also checks links to other websites (needs the internet).
//   node tests/tools/crawl-links.mjs https://visheshraghuvanshi.in --external        (against your real site; run it from your own computer)
//   node tests/tools/crawl-links.mjs http://localhost:8787                          (against a local test server)
// Exit code 1 if anything internal is broken.  An external site that answers 403/429/999 is reported as "could not check", not as broken (many sites refuse bots).
const ATTR = /\b(href|src|srcset|poster|action)\s*=\s*"([^"]*)"/gi;
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#38;/g, '&').replace(/&quot;/g, '"');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { method = 'GET', timeout = 12000, redirects = 'manual' } = {}) {
  for (let attempt = 0; ; attempt++) {                       // the local test proxy sometimes drops a connection: try again
    try { return await fetch(url, { method, redirect: redirects, headers: { 'user-agent': 'folio-link-check/1 (+owner)', connection: 'close' }, signal: AbortSignal.timeout(timeout) }); }
    catch (e) { if (attempt >= 2) throw e; await sleep(300); }
  }
}

export async function crawl(base, { external = false, max = 400, log = () => {} } = {}) {
  const origin = new URL(base).origin, seen = new Map(), queue = ['/'], pages = new Map(), problems = [], extChecked = new Map();
  const add = (path) => { if (!seen.has(path)) { seen.set(path, true); queue.push(path); } };
  seen.set('/', true);
  try { const sm = await (await get(origin + '/sitemap.xml')).text(); for (const m of sm.matchAll(/<loc>([^<]+)<\/loc>/g)) { const u = new URL(m[1], origin); add(u.pathname + u.search); } } catch { problems.push({ kind: 'internal', where: '/sitemap.xml', url: '/sitemap.xml', why: 'could not be read' }); }
  const resources = []; // [pageUrl, resourceUrl, kind]
  while (queue.length && pages.size < max) {
    const path = queue.shift(); let res;
    try { res = await get(origin + path); } catch (e) { problems.push({ kind: 'internal', where: 'crawl', url: path, why: String(e.cause?.code ?? e.message) }); continue; }
    if (res.status >= 300 && res.status < 400) { const to = new URL(res.headers.get('location') ?? '/', origin + path); if (to.origin === origin) add(to.pathname + to.search); pages.set(path, { status: res.status, ids: new Set() }); continue; }
    if (res.status !== 200) { problems.push({ kind: 'internal', where: 'a page of the site', url: path, why: `answers ${res.status}` }); continue; }
    if (!/html/.test(res.headers.get('content-type') ?? '')) { pages.set(path, { status: 200, ids: new Set() }); continue; }
    const html = await res.text(); log(`page ${path}`);
    const ids = new Set([...html.matchAll(/\b(?:id|name)\s*=\s*"([^"]+)"/g)].map((m) => m[1]));
    pages.set(path, { status: 200, ids });
    for (const m of html.matchAll(ATTR)) {
      const attr = m[1].toLowerCase(); const values = attr === 'srcset' ? decode(m[2]).split(',').map((x) => x.trim().split(/\s+/)[0]).filter(Boolean) : [decode(m[2])];
      for (const raw of values) {
        if (!raw || /^(mailto:|tel:|data:|blob:)/i.test(raw)) { if (/^mailto:/i.test(raw) && !/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+/.test(raw)) problems.push({ kind: 'internal', where: path, url: raw, why: 'not a valid mailto address' }); continue; }
        if (/^javascript:/i.test(raw)) { problems.push({ kind: 'internal', where: path, url: raw, why: 'a javascript: link' }); continue; }
        let u; try { u = new URL(raw, origin + path); } catch { problems.push({ kind: 'internal', where: path, url: raw, why: 'not a valid address' }); continue; }
        if (u.origin === origin || (u.hostname === new URL(origin).hostname)) {
          if (raw.startsWith('#') || (u.pathname === path && u.hash)) { const id = decodeURIComponent(u.hash.slice(1)); if (id && !ids.has(id)) problems.push({ kind: 'internal', where: path, url: raw, why: `no element with id "${id}" on this page` }); continue; }
          const p = u.pathname + u.search; resources.push([path, p, attr]); if (attr === 'href' && !/\.(pdf|xml|txt|ico|png|jpe?g|webp|avif|svg|css|js|woff2?)$/i.test(u.pathname) && !u.pathname.startsWith('/media/') && !u.pathname.startsWith('/_astro/')) add(p);
        } else if (u.protocol === 'http:' || u.protocol === 'https:') { resources.push([path, u.href, 'external']); }
      }
    }
  }
  // every internal resource answers (pages were fetched above; the rest are fetched once)
  const checked = new Map();
  for (const [from, url, attr] of resources) {
    if (attr === 'external') continue;
    if (!checked.has(url)) { const known = pages.get(url); if (known) checked.set(url, known.status); else { try { const r = await get(origin + url, { method: 'GET' }); checked.set(url, r.status); await r.body?.cancel(); } catch (e) { checked.set(url, String(e.cause?.code ?? e.message)); } } }
    const st = checked.get(url); if (st !== 200 && !(typeof st === 'number' && st >= 300 && st < 400)) problems.push({ kind: 'internal', where: from, url, why: `${attr} answers ${st}` });
  }
  // other websites
  const exts = [...new Set(resources.filter((r) => r[2] === 'external').map((r) => r[1]))];
  const externals = [];
  if (external) for (const url of exts) {
    let st, note = '';
    try { let r = await get(url, { method: 'HEAD', redirects: 'follow' }); if (r.status === 405 || r.status === 403 || r.status === 501) r = await get(url, { redirects: 'follow' }); st = r.status; if (r.redirected && new URL(r.url).href !== new URL(url).href) note = `redirects to ${r.url}`; }
    catch (e) { st = 0; note = String(e.cause?.code ?? e.message); }
    externals.push({ url, status: st, note, pages: [...new Set(resources.filter((r) => r[1] === url).map((r) => r[0]))] });
    if (st === 404 || st === 410 || st >= 500 || st === 0) problems.push({ kind: 'external', where: externals.at(-1).pages.join(', '), url, why: st ? `answers ${st}` : `could not connect (${note})` });
  }
  return { pages: [...pages.keys()], resources: resources.length, externalLinks: exts, externals, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2] ?? 'http://localhost:8787', external = process.argv.includes('--external');
  const r = await crawl(base, { external, log: (m) => process.stderr.write(`\r${m.padEnd(70)}`) });
  console.log(`\nChecked ${r.pages.length} pages, ${r.resources} links/pictures/scripts/styles inside the site, ${r.externalLinks.length} links to other sites${external ? '' : ' (not checked: add --external)'}.`);
  const bad = r.problems.filter((p) => p.kind === 'internal'), ext = r.problems.filter((p) => p.kind === 'external');
  if (!bad.length && !ext.length) console.log('No broken links found.');
  for (const p of bad) console.log(`BROKEN (inside the site)  ${p.url}\n    ${p.why}; on ${p.where}`);
  for (const p of ext) console.log(`BROKEN (other site)       ${p.url}\n    ${p.why}; on ${p.where}`);
  for (const e of r.externals.filter((x) => x.note.startsWith('redirects'))) console.log(`moved                     ${e.url}\n    ${e.note}`);
  for (const e of r.externals.filter((x) => [401, 403, 429, 999].includes(x.status))) console.log(`could not check           ${e.url} (${e.status}: the site refuses automated checks)`);
  process.exit(bad.length ? 1 : 0);
}
