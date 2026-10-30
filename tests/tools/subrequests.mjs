// Prints how many calls to Cloudflare services (database, storage, cache, images, outgoing fetch) each route makes per request.
// Needs the counting server: it is "server E" of the Playwright setup (port 8791). Start it with:  npx playwright test --project=limits --list
// (any run of the limits project starts it), or by hand as in tests/tools/counting/entry.mjs.   Usage:  node tests/tools/subrequests.mjs [baseUrl]
// The free Workers plan allows 50 calls per request in total; the "total" column is what to compare.
const BASE = process.argv[2] ?? 'http://localhost:8791';
const TOKEN = 'e2e-setup-token-0123456789abcdef', EMAIL = 'tool@example.com', PW = 'correct horse battery staple 42';
let n = 0, cookie = '';
const ip = () => `10.${(n++ % 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
const same = { 'sec-fetch-site': 'same-origin', origin: BASE };
const send = async (method, path, { form, headers = {} } = {}) => {
  const id = `c${Date.now()}-${n++}`;
  let res, body;
  for (let attempt = 0; ; attempt++) {                  // wrangler dev's local proxy sometimes drops a connection (a test-harness flake, not a site fault): retry
    try {
      res = await fetch(BASE + path, { method, redirect: 'manual', headers: { connection: 'close', 'x-count-id': id, 'cf-connecting-ip': ip(), cookie, ...(method === 'POST' ? same : {}), ...headers }, body: form ? new URLSearchParams(form) : undefined });
      body = await res.arrayBuffer(); break;
    } catch (e) { if (attempt >= 3) throw e; await new Promise((r) => setTimeout(r, 300)); }
  }
  const sc = res.headers.getSetCookie?.() ?? []; for (const c of sc) cookie = c.split(';')[0];
  const counts = await (await fetch(`${BASE}/__counts?id=${id}`)).json();
  return { status: res.status, bytes: body.byteLength, counts, res };
};
export { send, BASE };
if (import.meta.url === `file://${process.argv[1]}`) {
  let r = await send('POST', '/auth', { form: { mode: 'setup', token: TOKEN, email: EMAIL, password: PW, confirm: PW } });
  if (r.status !== 302) r = await send('POST', '/auth', { form: { mode: 'login', email: EMAIL, password: PW } });
  if (r.status !== 302) { console.error('could not sign in', r.status); process.exit(1); }
  const slug = (await (await fetch(BASE + '/sitemap.xml')).text()).match(/\/projects\/([\w-]+)/)?.[1] ?? 'x';
  const rows = [];
  const probe = async (label, method, path, o) => { const r = await send(method, path, o); const c = r.counts ?? {}; rows.push([label, r.status, c.d1, c.r2, c.cache, c.fetch, c.images, c.total, c.rowsRead, c.rowsWritten]); return r; };
  for (const p of ['/', '/projects', `/projects/${slug}`, '/now', '/resume', '/contact', '/sitemap.xml', '/robots.txt', '/no-such-page']) { await probe(`GET ${p} (cold)`, 'GET', p); await probe(`GET ${p} (warm)`, 'GET', p); }
  await probe('GET /media original (cold)', 'GET', '/media/demoCover0001/x.png'); await probe('GET /media 640 webp (cold)', 'GET', '/media/demoCover0001/x.png?w=640&f=webp'); await probe('GET /media 640 webp (warm)', 'GET', '/media/demoCover0001/x.png?w=640&f=webp');
  for (const p of ['/dashboard', '/dashboard/assets', '/dashboard/projects', '/dashboard/settings', '/dashboard/seo', '/dashboard/inbox', '/dashboard/now', '/dashboard/resume']) await probe(`GET ${p}`, 'GET', p);
  await probe('POST storage check', 'POST', '/api/admin/assets/storage', { form: { action: 'check' } });
  await probe('POST storage scrub (batch)', 'POST', '/api/admin/assets/storage', { form: { action: 'scrub', offset: '0' } });
  console.log('route'.padEnd(36), 'status', ' d1', ' r2', 'cache', 'fetch', 'img', 'TOTAL', 'rowsRd', 'rowsWr');
  for (const r of rows) console.log(String(r[0]).padEnd(36), String(r[1]).padEnd(6), ...r.slice(2).map((x) => String(x ?? '?').padStart(4)));
}
