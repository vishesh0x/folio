#!/usr/bin/env node
// End-to-end check of first-admin sign-up and the cross-site (CSRF) refusal table.
// Needs the production build running locally:   npm run build && npm run preview   (http://localhost:8787)
// Run:   node scripts/e2e-auth-csrf.mjs            (BASE=http://localhost:8787 by default)
//
// WARNING: this wipes users, sessions, login_attempts and projects in the LOCAL database. Never point it at production.
//
// Why raw node:http: no client adds Origin / Sec-Fetch-* headers behind our back, and no cookie library silently
// drops the `Secure` + `__Host-` session cookie (it is Set over plain http://localhost). Cookies are handled by hand.
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const BASE = new URL(process.env.BASE ?? 'http://localhost:8787');
if (!['localhost', '127.0.0.1'].includes(BASE.hostname)) { console.error('Refusing to run against a non-local host.'); process.exit(2); }
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.ADMIN_SETUP_TOKEN ?? 'test-setup-token-0123456789abcdef'; // must match .dev.vars
const ORIGIN = BASE.origin;
const PW = 'correct horse battery';

/* ───── helpers ───── */
let ipCounter = 10;
const freshIp = () => `203.0.113.${++ipCounter}`; // each case gets its own rate-limit bucket (the site keys limits on cf-connecting-ip)

// `wrangler dev` sometimes drops the connection of the first requests that follow a `wrangler d1 execute --local` run from
// ANOTHER process (this script resets the database that way). Reproduced on the untouched original project too, and the dropped
// requests never reach the app (they are absent from the server log), so one retry is safe. Retries are counted and reported.
let transportRetries = 0;
async function request(opts) {
  try { return await requestOnce(opts); }
  catch (e) {
    if (!/socket hang up|ECONNRESET/.test(e.message)) throw e;
    transportRetries++; await new Promise((r) => setTimeout(r, 300));
    return requestOnce(opts);
  }
}
function requestOnce({ method = 'GET', path, headers = {}, form, json, cookie, multipart }) {
  return new Promise((ok, fail) => {
    const h = { host: BASE.host, connection: 'close', ...headers };
    let body = null;
    if (form) { body = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
    if (json !== undefined) { body = JSON.stringify(json); h['content-type'] = 'application/json'; }
    if (multipart) {
      const edge = '----e2e' + Math.random().toString(16).slice(2);
      body = `--${edge}\r\nContent-Disposition: form-data; name="alt"\r\n\r\ntest\r\n--${edge}\r\nContent-Disposition: form-data; name="file"; filename="t.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${edge}--\r\n`;
      h['content-type'] = `multipart/form-data; boundary=${edge}`;
    }
    if (body !== null) h['content-length'] = Buffer.byteLength(body);
    if (cookie) h.cookie = cookie;
    const req = http.request({ host: BASE.hostname, port: BASE.port, method, path, headers: h }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, setCookie: res.headers['set-cookie'] ?? [], text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', (e) => fail(new Error(`${method} ${path}: ${e.message}`))); if (body !== null) req.write(body); req.end();
  });
}
const cookieFrom = (res) => { const c = res.setCookie.find((x) => /^(__Host-)?session=/.test(x)); return c ? c.split(';')[0] : null; };

function sql(q) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'folio-db', '--local', '--json', '--command', q], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.slice(out.indexOf('[')));
}
const counts = () => sql('SELECT (SELECT count(*) FROM users) users, (SELECT count(*) FROM sessions) sessions, (SELECT count(*) FROM projects) projects').at(-1).results[0];
const reset = () => sql('DELETE FROM sessions; DELETE FROM users; DELETE FROM login_attempts; DELETE FROM projects;');

let pass = 0, fail = 0; const failures = [];
function check(group, name, got, want, note = '') {
  const ok = typeof want === 'function' ? want(got) : got === want;
  ok ? pass++ : (fail++, failures.push(`${group} / ${name}: got ${JSON.stringify(got)}`));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${group.padEnd(8)} ${name.padEnd(62)} ${String(typeof got === 'object' ? JSON.stringify(got) : got).padEnd(8)}${note ? '  ' + note : ''}`);
}
const sameOrigin = { 'sec-fetch-site': 'same-origin', origin: ORIGIN };
const setupForm = (over = {}) => ({ mode: 'setup', token: TOKEN, email: 'me@example.com', password: PW, confirm: PW, ...over });

/* ───── 1. sign-up ───── */
async function signUpSuite() {
  console.log('\n== SIGN-UP ==');
  reset();
  const g = 'signup';
  const page = await request({ path: '/auth', headers: { 'cf-connecting-ip': freshIp() } });
  check(g, 'GET /auth shows the setup form on an empty site', /Set up your site/.test(page.text), true);

  const post = (form, extra = {}) => request({ method: 'POST', path: '/auth', form, headers: { ...sameOrigin, 'cf-connecting-ip': freshIp(), ...extra } });
  check(g, 'wrong setup token -> 403', (await post(setupForm({ token: 'nope-nope-nope-nope-nope' }))).status, 403);
  check(g, '11-character password -> 400', (await post(setupForm({ password: 'elevenchars', confirm: 'elevenchars' }))).status, 400);
  check(g, 'confirmation mismatch -> 400', (await post(setupForm({ confirm: PW + 'x' }))).status, 400);
  check(g, 'password equal to email -> 400', (await post(setupForm({ email: 'same-as-pw@example.com', password: 'same-as-pw@example.com', confirm: 'same-as-pw@example.com' }))).status, 400);
  check(g, 'bad email -> 400', (await post(setupForm({ email: 'not-an-email' }))).status, 400);
  check(g, 'no admin created by any refused attempt', counts().users, 0);

  const ok = await post(setupForm());
  check(g, 'correct token + valid details -> 302', ok.status, 302);
  check(g, 'redirects to /dashboard', ok.headers.location, '/dashboard');
  const raw = ok.setCookie.find((c) => /session=/.test(c)) ?? '';
  check(g, 'cookie name is __Host-session', /^__Host-session=/.test(raw), true);
  check(g, 'cookie is HttpOnly', /;\s*HttpOnly/i.test(raw), true);
  check(g, 'cookie is Secure', /;\s*Secure/i.test(raw), true);
  check(g, 'cookie is SameSite=Lax', /;\s*SameSite=Lax/i.test(raw), true);
  check(g, 'cookie has Path=/ and no Domain (required by __Host-)', /Path=\//.test(raw) && !/Domain=/i.test(raw), true);
  const cookie = cookieFrom(ok);

  check(g, 'dashboard with the session -> 200', (await request({ path: '/dashboard', cookie })).status, 200);
  const anon = await request({ path: '/dashboard' });
  check(g, 'dashboard without a session -> 302 to /auth', `${anon.status} ${anon.headers.location}`, '302 /auth');
  const row = sql('SELECT id FROM sessions').at(-1).results[0];
  check(g, 'stored session id is a 64-hex hash, not the cookie token', !!row && /^[0-9a-f]{64}$/.test(row.id) && !cookie.includes(row.id), true);

  check(g, 'registering again -> 403', (await post(setupForm({ email: 'second@example.com' }))).status, 403);
  check(g, 'still exactly one admin', counts().users, 1);
  const signedIn = await request({ path: '/auth', cookie });
  check(g, 'GET /auth while signed in -> redirect to /dashboard', `${signedIn.status} ${signedIn.headers.location}`, '302 /dashboard');

  // login / logout
  const bad = await post({ mode: 'login', email: 'me@example.com', password: 'wrong wrong wrong' });
  check(g, 'login with wrong password -> 401', bad.status, 401);
  const good = await post({ mode: 'login', email: 'me@example.com', password: PW });
  check(g, 'login with right password -> 302 and a new session', `${good.status} ${!!cookieFrom(good)}`, '302 true');
  const out = await request({ method: 'POST', path: '/auth/logout', headers: sameOrigin, cookie: cookieFrom(good) });
  check(g, 'same-origin logout -> 303 /auth', `${out.status} ${out.headers.location}`, '303 /auth');
  check(g, 'logged-out cookie no longer opens the dashboard', (await request({ path: '/dashboard', cookie: cookieFrom(good) })).status, 302);

  // rate limit
  console.log('-- rate limits');
  reset();
  const ip = freshIp();
  const lim = (form) => request({ method: 'POST', path: '/auth', form, headers: { ...sameOrigin, 'cf-connecting-ip': ip } });
  const first5 = []; for (let i = 0; i < 5; i++) first5.push((await lim(setupForm({ token: 'wrong-wrong-wrong-wrong' }))).status);
  check(g, '5 wrong tokens from one IP -> 403 each', first5.join(','), '403,403,403,403,403');
  check(g, '6th attempt with the CORRECT token is still 429', (await lim(setupForm())).status, 429);
  check(g, 'a different IP with the correct token succeeds', (await post(setupForm())).status, 302);

  // atomic first admin, 3 trials of 3 simultaneous requests
  console.log('-- simultaneous registration');
  for (let t = 1; t <= 3; t++) {
    reset();
    const rs = await Promise.all([1, 2, 3].map((n) => post(setupForm({ email: `racer${n}@example.com` }))));
    check(g, `trial ${t}: 3 simultaneous sign-ups -> exactly 1 admin`, counts().users, 1, `statuses ${rs.map((r) => r.status).join(',')}`);
  }

  // informational: the shared "local" bucket (only exists when cf-connecting-ip is missing, i.e. local testing)
  console.log('-- local-testing artefact');
  reset();
  const noIp = (form) => request({ method: 'POST', path: '/auth', form, headers: sameOrigin });
  for (let i = 0; i < 5; i++) await noIp(setupForm({ token: 'wrong-wrong-wrong-wrong' }));
  check(g, 'requests with NO cf-connecting-ip share one bucket ("local"): correct token now 429', (await noIp(setupForm())).status, 429,
    '<- a test run that sends no IP header and has earlier failures will hit this');
}


/* ───── 1b. the check itself, called directly (covers what the local proxy hides) ───── */
async function unitSuite() {
  console.log('\n== isSameOrigin() DIRECT ==');
  let isSameOrigin;
  try { ({ isSameOrigin } = await import(new URL('../src/lib/csrf.ts', import.meta.url))); }
  catch (e) { console.log(`SKIP  needs Node 22.18+ (TypeScript stripping): ${e.code ?? e.message}`); return; }
  const g = 'unit';
  const R = (h) => new Request('https://example.com/x', { method: 'POST', headers: h });
  const U = (site) => new URL(site + '/x');
  const cases = [
    ['https site, Origin http (scheme mismatch)', 'https://example.com', { origin: 'http://example.com' }, false],
    ['http site, Origin https (scheme mismatch)', 'http://localhost:8787', { origin: 'https://localhost:8787' }, false],
    ['https site, Referer http (scheme mismatch)', 'https://example.com', { referer: 'http://example.com/a' }, false],
    ['https site, Origin other port', 'https://example.com', { origin: 'https://example.com:8443' }, false],
    ['https site, Origin look-alike host', 'https://example.com', { origin: 'https://example.com.evil.example' }, false],
    ['https site, Origin sibling subdomain', 'https://example.com', { origin: 'https://blog.example.com' }, false],
    ['https site, Origin same', 'https://example.com', { origin: 'https://example.com' }, true],
    ['https site, Referer same (with path and query)', 'https://example.com', { referer: 'https://example.com/a?b=1' }, true],
  ];
  for (const [name, site, h, want] of cases) check(g, name, isSameOrigin(R(h), U(site)), want);
}

/* ───── 2. CSRF table ───── */
const VARIANTS = [
  // [label, headers, allowed?]
  ['A  Sec-Fetch-Site: same-origin (+Origin same)',          { 'sec-fetch-site': 'same-origin', origin: ORIGIN }, true],
  ['B  Sec-Fetch-Site: cross-site (+Origin evil)',           { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }, false],
  ['C  Sec-Fetch-Site: same-site (sibling subdomain)',       { 'sec-fetch-site': 'same-site', origin: 'https://blog.localhost' }, false],
  ['D  Sec-Fetch-Site: none',                                { 'sec-fetch-site': 'none' }, false],
  ['E  no Sec-Fetch-Site, Origin = this site',               { origin: ORIGIN }, true],
  ['F  no Sec-Fetch-Site, Origin = evil',                    { origin: 'https://evil.example' }, false],
  ['G  no Sec-Fetch-Site, Origin: null (sandboxed iframe)',  { origin: 'null' }, false],
  ['H  no Sec-Fetch-Site, Origin = other port',              { origin: `${BASE.protocol}//${BASE.hostname}:9999` }, false],
  // (scheme mismatch, http vs https, cannot be tested over HTTP here: `wrangler dev`'s local proxy rewrites Origin/Referer to its own
  //  address before the Worker sees them. It is checked directly against isSameOrigin() in unitSuite() below.)
  ['J  no Sec-Fetch-*, no Origin, no Referer',               {}, false],
  ['K  no Sec-Fetch-*, no Origin, Referer = this site',      { referer: `${ORIGIN}/dashboard` }, true],
  ['L  no Sec-Fetch-*, no Origin, Referer = evil',           { referer: 'https://evil.example/page' }, false],
  ['M  no Sec-Fetch-*, no Origin, Referer = garbage',        { referer: 'not a url' }, false],
  ['N  Sec-Fetch-Site: cross-site BUT Origin = this site',   { 'sec-fetch-site': 'cross-site', origin: ORIGIN }, false],
  ['O  Sec-Fetch-Site: same-origin BUT Origin = evil',       { 'sec-fetch-site': 'same-origin', origin: 'https://evil.example' }, true], // informational: Sec-Fetch-Site wins; browsers never produce this
];

async function csrfSuite() {
  console.log('\n== CSRF TABLE ==');
  reset();
  const g = 'csrf';
  const signup = await request({ method: 'POST', path: '/auth', form: setupForm(), headers: { ...sameOrigin, 'cf-connecting-ip': freshIp() } });
  const cookie = cookieFrom(signup);
  check(g, 'precondition: signed in', (await request({ path: '/dashboard', cookie })).status, 200);

  // Side-effect probe over HTTP (much faster than shelling out to wrangler): how many new-project marks the dashboard list shows.
  const projectMarks = async (c) => ((await request({ path: '/dashboard/projects', cookie: c })).text.match(/Untitled project/g) ?? []).length;

  // Each target: how to send it, how to tell "reached the handler" from "refused", and a side effect to watch.
  const TARGETS = [
    { name: 'POST /auth  (public form)',            send: (h) => request({ method: 'POST', path: '/auth', form: { mode: 'login', email: 'nobody@example.com', password: 'wrong wrong wrong' }, headers: { ...h, 'cf-connecting-ip': freshIp() } }), reached: (r) => r.status === 401 },
    { name: 'POST /api/reveal  (public JSON)',      send: (h) => request({ method: 'POST', path: '/api/reveal', json: { kind: 'email' }, headers: { ...h, 'cf-connecting-ip': freshIp() } }), reached: (r) => r.status !== 403 },
    { name: 'POST /api/admin/preview  (session)',   send: (h) => request({ method: 'POST', path: '/api/admin/preview', json: { md: '# hi' }, headers: h, cookie }), reached: (r) => r.status === 200 },
    { name: 'POST /api/admin/inbox  (session)',     send: (h) => request({ method: 'POST', path: '/api/admin/inbox', form: { action: 'mark-all-read' }, headers: h, cookie }), reached: (r) => r.status === 303 },
    { name: 'POST /api/admin/projects create (writes a row)', send: (h) => request({ method: 'POST', path: '/api/admin/projects', form: { action: 'create' }, headers: h, cookie }), reached: (r) => r.status === 303 },
    { name: 'POST /api/admin/assets/upload  (file upload)', send: (h) => request({ method: 'POST', path: '/api/admin/assets/upload', multipart: true, headers: h, cookie }), reached: (r) => r.status === 400 }, // allowed: reaches the handler, which rejects the .txt
    { name: 'PUT  /api/admin/projects  (method coverage)',    send: (h) => request({ method: 'PUT', path: '/api/admin/projects', form: { action: 'create' }, headers: h, cookie }), reached: (r) => r.status !== 403 },
  ];

  const matrix = [];
  for (const t of TARGETS) {
    const row = [];
    for (const [label, headers, allowed] of VARIANTS) {
      const before = await projectMarks(cookie);
      const r = await t.send(headers);
      const after = await projectMarks(cookie);
      const reached = t.reached(r);
      const refused = r.status === 403;
      const wrote = after !== before;
      const okStatus = allowed ? reached : refused;
      const okEffect = allowed ? true : !wrote;
      const verdict = okStatus && okEffect;
      verdict ? pass++ : (fail++, failures.push(`csrf / ${t.name} / ${label}: status ${r.status}, wrote=${wrote}`));
      row.push(`${verdict ? 'ok' : 'XX'}:${r.status}`);
    }
    matrix.push([t.name, row]);
  }
  const labels = VARIANTS.map(([l]) => l.slice(0, 1));
  console.log('\n(ok = behaved as designed; the number is the HTTP status; allowed cases are A E K O, everything else must be 403 with no side effect)');
  console.log('target'.padEnd(52) + labels.map((l) => l.padStart(7)).join(''));
  for (const [n, row] of matrix) console.log(n.padEnd(52) + row.map((c) => c.padStart(7)).join(''));
  console.log('\nvariants:'); for (const [l, , a] of VARIANTS) console.log(`  ${l}  -> ${a ? 'allowed' : 'refused'}`);

  // session survives every refused request
  check(g, 'session survived the whole table (dashboard still 200)', (await request({ path: '/dashboard', cookie })).status, 200);
  check(g, 'session row still in the database', counts().sessions, 1);

  // logout, the destructive one: cross-site refused and session survives, same-origin signs out
  console.log('-- logout');
  const xs = await request({ method: 'POST', path: '/auth/logout', headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }, cookie });
  check(g, 'cross-site POST /auth/logout -> 403', xs.status, 403);
  check(g, 'refusal is the designed 403 page (HTML), not a bare error', /text\/html/.test(xs.headers['content-type'] ?? ''), true);
  check(g, 'refusal does not clear the cookie', xs.setCookie.some((c) => /session=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)), false);
  check(g, 'signed-in session survives the cross-site logout attempt', (await request({ path: '/dashboard', cookie })).status, 200);
  const noHdr = await request({ method: 'POST', path: '/auth/logout', cookie });
  check(g, 'POST /auth/logout with no origin headers -> 403', noHdr.status, 403);
  check(g, 'session still alive', (await request({ path: '/dashboard', cookie })).status, 200);
  const same = await request({ method: 'POST', path: '/auth/logout', headers: sameOrigin, cookie });
  check(g, 'same-origin logout -> 303', same.status, 303);
  check(g, 'session is gone afterwards', `${(await request({ path: '/dashboard', cookie })).status}`, '302');

  // safe methods are never blocked by the check
  console.log('-- safe methods');
  check(g, 'GET / with Sec-Fetch-Site: cross-site is served', (await request({ path: '/', headers: { 'sec-fetch-site': 'cross-site' } })).status, 200);
  check(g, 'unauthenticated POST /api/admin/* -> 401 (auth guard runs before CSRF)', (await request({ method: 'POST', path: '/api/admin/inbox', form: { action: 'mark-all-read' }, headers: { 'sec-fetch-site': 'cross-site' } })).status, 401);
}

/* ───── run ───── */
try {
  const probe = await request({ path: '/' });
  if (probe.status !== 200) throw new Error(`Site not answering at ${ORIGIN} (status ${probe.status})`);
  await signUpSuite();
  await unitSuite();
  await csrfSuite();
} catch (e) { console.error('\nSuite aborted:', e.stack ?? e.message); process.exit(2); }
console.log(`\n${pass} passed, ${fail} failed` + (transportRetries ? `   (${transportRetries} request(s) needed one transport retry: see the note on request())` : ''));
if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log('  - ' + f); }
process.exit(fail ? 1 : 0);
