#!/usr/bin/env node
// Turnstile checks for the contact form and the "Show email / phone" buttons, against the production build running locally.
//
//   MODE=on   node scripts/e2e-turnstile.mjs   site started with BOTH keys + TURNSTILE_VERIFY_URL (see below)
//   MODE=off  node scripts/e2e-turnstile.mjs   site started with NO keys, or with only ONE of the two
//
// .dev.vars for MODE=on (then `npm run build && npm run preview`):
//   ADMIN_SETUP_TOKEN=test-setup-token-0123456789abcdef
//   TURNSTILE_SITE_KEY=1x00000000000000000000AA
//   TURNSTILE_SECRET_KEY=test-secret
//   TURNSTILE_VERIFY_URL=http://127.0.0.1:9911/verify
//
// This script runs a FAKE Cloudflare verifier on 127.0.0.1:9911 (the sandbox/CI has no route to the real one). It copies the
// real response shape, including the fact that Cloudflare's test keys always answer "action": "test".
// WARNING: wipes login_attempts and the resume, and overwrites the 'site' and 'resume_opts' settings, in the LOCAL database.
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const MODE = process.env.MODE === 'off' ? 'off' : 'on';
const BASE = new URL(process.env.BASE ?? 'http://localhost:8787');
if (!['localhost', '127.0.0.1'].includes(BASE.hostname)) { console.error('Refusing to run against a non-local host.'); process.exit(2); }
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = BASE.origin, SAME = { 'sec-fetch-site': 'same-origin', origin: ORIGIN };
const EMAIL = 'hello@example.com', PHONE = '+1 555 0100';
let ipN = 50; const freshIp = () => `198.51.100.${++ipN}`;

/* ───── fake Cloudflare siteverify ───── */
const calls = []; const used = new Set();
const verifier = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    const p = new URLSearchParams(raw); const token = p.get('response') ?? '', secret = p.get('secret');
    calls.push({ token, secret, remoteip: p.get('remoteip') });
    const reply = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (token.startsWith('drop-')) return req.socket.destroy();               // connection dies
    if (token.startsWith('garbage-')) return res.end('<html>not json</html>'); // unreadable answer
    if (token.startsWith('slow-')) await new Promise((r) => setTimeout(r, 7000)); // slower than the Worker's 5 s limit
    const ok = secret === 'test-secret' && /^(good|slow)-/.test(token) && !used.has(token);
    if (ok) used.add(token);
    reply(ok ? { success: true, hostname: 'localhost', action: 'test' } : { success: false, 'error-codes': [used.has(token) ? 'timeout-or-duplicate' : 'invalid-input-response'] });
  });
});
await new Promise((ok) => verifier.listen(9911, '127.0.0.1', ok));

/* ───── helpers ───── */
function request({ method = 'GET', path, headers = {}, form, json, rawBody }) {
  return new Promise((ok, fail) => {
    const h = { host: BASE.host, connection: 'close', ...headers }; let body = null;
    if (form) { body = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
    if (json !== undefined) { body = JSON.stringify(json); h['content-type'] = 'application/json'; }
    if (rawBody !== undefined) { body = rawBody; h['content-type'] = 'application/json'; }
    if (body !== null) h['content-length'] = Buffer.byteLength(body);
    const req = http.request({ host: BASE.hostname, port: BASE.port, method, path, headers: h }, (res) => {
      const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: Buffer.concat(c).toString('utf8') }));
    });
    req.on('error', fail); if (body !== null) req.write(body); req.end();
  });
}
const sql = (q) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'folio-db', '--local', '--json', '--command', q], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const reveal = (body, { ip = freshIp(), headers = SAME, raw } = {}) => request({ method: 'POST', path: '/api/reveal', json: raw === undefined ? body : undefined, rawBody: raw, headers: { ...headers, 'cf-connecting-ip': ip } });
const since = (n) => calls.length - n;

let pass = 0, fail = 0; const failures = [];
function check(group, name, got, want, note = '') {
  const ok = typeof want === 'function' ? want(got) : got === want;
  ok ? pass++ : (fail++, failures.push(`${group} / ${name}: got ${JSON.stringify(got)}`));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${group.padEnd(8)} ${name.padEnd(70)} ${String(got).slice(0, 24).padEnd(24)}${note ? ' ' + note : ''}`);
}
const csp = (r) => r.headers['content-security-policy'] ?? '';
const dir = (r, name) => (csp(r).split(';').map((s) => s.trim()).find((s) => s.startsWith(name + ' ')) ?? '');
const TS = 'https://challenges.cloudflare.com';

/* ───── run ───── */
try {
  // The resume page only shows its contact block (and so the reveal buttons) when it has at least one section.
  sql(`DELETE FROM login_attempts;
       DELETE FROM resume_entries; DELETE FROM resume_sections;
       INSERT INTO resume_sections (id, kind, title, visible, sort_order) VALUES (1, 'summary', 'Summary', 1, 0);
       INSERT INTO resume_entries (section_id, data, visible, sort_order) VALUES (1, '${JSON.stringify({ text: 'A short test summary.' })}', 1, 0);
       INSERT INTO settings (key,value) VALUES ('site','${JSON.stringify({ name: 'Test Person', email: EMAIL, phone: PHONE })}') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
       INSERT INTO settings (key,value) VALUES ('resume_opts','${JSON.stringify({ show_phone: true, show_email: true, contact_mode: 'reveal', print_reveal: true })}') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
       INSERT INTO settings (key,value) VALUES ('content_version', strftime('%s','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value;`);

  await new Promise((ok) => setTimeout(ok, 5500)); // the site remembers its content version for 5 s, and we just changed it behind its back
  const contact = await request({ path: '/contact' });
  const resume = await request({ path: '/resume' });
  const home = await request({ path: '/' });
  const widgetOnContact = /class="cf-turnstile"/.test(contact.text);
  if (MODE === 'on' && !widgetOnContact) throw new Error('MODE=on but /contact shows no Turnstile widget. Start the site with both keys (see the top of this file).');
  if (MODE === 'off' && widgetOnContact) throw new Error('MODE=off but Turnstile is on. Start the site with no keys, or only one.');

  if (MODE === 'on') {
    console.log('\n== MARKUP AND CSP (Turnstile on) ==');
    const g = 'markup';
    check(g, 'contact form widget carries data-action="contact"', /class="cf-turnstile"[^>]*data-action="contact"/.test(contact.text), true);
    check(g, '/contact: reveal button carries the site key', /data-reveal-wrap[^>]*data-sitekey="1x00000000000000000000AA"/.test(contact.text), true);
    check(g, '/resume: email AND phone buttons carry the site key', (resume.text.match(/data-reveal-wrap[^>]*data-sitekey="1x00000000000000000000AA"/g) ?? []).length, 2);
    check(g, '/resume page text does not contain the email or phone', !resume.text.includes(EMAIL) && !resume.text.includes('555 0100'), true);
    check(g, '/contact page text does not contain the email', !contact.text.includes(EMAIL), true);
    check(g, 'home page: no Turnstile script, no site key', !/challenges\.cloudflare\.com|data-sitekey/.test(home.text), true);
    for (const [name, r] of [['/contact', contact], ['/resume', resume]])
      for (const d of ['script-src', 'frame-src', 'connect-src']) check('csp', `${name} ${d} allows ${TS}`, dir(r, d).includes(TS), true);
    const resume2 = await request({ path: '/resume' });
    check('csp', '/resume second load (cache path) still allows Turnstile', dir(resume2, 'script-src').includes(TS) && dir(resume2, 'frame-src').includes(TS), true);
    for (const p of ['/', '/projects', '/now', '/auth']) {
      const r = await request({ path: p });
      check('csp', `${p} does NOT allow Turnstile`, !csp(r).includes('challenges.cloudflare.com'), true);
    }

    console.log('\n== /api/reveal ==');
    const g2 = 'reveal';
    let n = calls.length;
    let r = await reveal({ kind: 'email' });
    check(g2, 'no token -> 400', r.status, 400); check(g2, '...and no email in the answer', r.text.includes(EMAIL), false);
    check(g2, '...and nothing sent to Cloudflare for an empty token', since(n), 0);
    for (const [label, body] of [['number token', { kind: 'email', token: 123 }], ['object token', { kind: 'email', token: { a: 1 } }], ['null token', { kind: 'email', token: null }]]) {
      r = await reveal(body); check(g2, `${label} -> 400`, r.status, 400);
    }
    n = calls.length;
    r = await reveal({ kind: 'email', token: 'x'.repeat(3000) });
    check(g2, '3000-character token -> 400, never sent to Cloudflare', `${r.status} ${since(n)}`, '400 0');
    n = calls.length;
    r = await reveal({ kind: 'email', token: 'bad-1' });
    check(g2, 'rejected token -> 400', r.status, 400); check(g2, '...answer has no email', r.text.includes(EMAIL), false);
    check(g2, '...exactly one verification call', since(n), 1);

    n = calls.length; const ip = freshIp();
    r = await reveal({ kind: 'email', token: 'good-1' }, { ip });
    check(g2, 'valid token -> 200 with the email', `${r.status} ${JSON.parse(r.text).value}`, `200 ${EMAIL}`);
    const c = calls.at(-1);
    check(g2, '...verifier got the secret key', c.secret, 'test-secret'); check(g2, '...verifier got the visitor IP', c.remoteip, ip);
    check(g2, 'cloudflare echoing action "test" does not matter (valid token still works)', r.status, 200);
    r = await reveal({ kind: 'email', token: 'good-1' });
    check(g2, 'same token used twice -> 400 (single use)', r.status, 400);
    r = await reveal({ kind: 'phone', token: 'good-2' });
    check(g2, 'valid token, phone (resume shows phone) -> 200 with the phone', `${r.status} ${JSON.parse(r.text).value}`, `200 ${PHONE}`);

    n = calls.length;
    r = await reveal({ kind: 'fax', token: 'good-3' });
    check(g2, 'unknown kind -> 404 without using the token', `${r.status} ${since(n)}`, '404 0');
    n = calls.length; r = await reveal(null, { raw: '{not json' });
    check(g2, 'invalid JSON -> 400 without calling Cloudflare', `${r.status} ${since(n)}`, '400 0');
    n = calls.length; r = await reveal({ kind: 'email', token: 'good-4' }, { headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' } });
    check(g2, 'cross-site request -> 403 and the token is not consumed', `${r.status} ${since(n)}`, '403 0');
    r = await reveal({ kind: 'email', token: 'good-4' });
    check(g2, '...so the same token still works from the real site', r.status, 200);

    console.log('-- verifier misbehaves (must fail closed)');
    r = await reveal({ kind: 'email', token: 'garbage-1' }); check(g2, 'unreadable answer from Cloudflare -> 400', r.status, 400);
    r = await reveal({ kind: 'email', token: 'drop-1' });    check(g2, 'Cloudflare connection drops -> 400', r.status, 400);
    const t0 = Date.now(); r = await reveal({ kind: 'email', token: 'slow-1' });
    check(g2, 'Cloudflare too slow (7 s) -> 400 after the 5 s limit', `${r.status} ${Date.now() - t0 < 6500}`, '400 true');

    console.log('-- rate limit (10 per IP per hour)');
    const rl = freshIp(); n = calls.length; const st = [];
    for (let i = 0; i < 10; i++) st.push((await reveal({ kind: 'email', token: `bad-rl-${i}` }, { ip: rl })).status);
    check(g2, '10 failed attempts from one IP -> 400 each', st.join(','), Array(10).fill(400).join(','));
    n = calls.length; r = await reveal({ kind: 'email', token: 'good-5' }, { ip: rl });
    check(g2, '11th, even with a valid token -> 429, Cloudflare not asked', `${r.status} ${since(n)}`, '429 0');

    console.log('\n== CONTACT FORM ==');
    const g3 = 'contact';
    const form = async (token) => {
      const page = await request({ path: '/contact' }); const t = /name="t" value="([^"]+)"/.exec(page.text)?.[1];
      await new Promise((ok) => setTimeout(ok, 3300)); // the form refuses posts faster than 3 s
      const f = { name: 'Ada', email: 'ada@example.com', subject: 'Hi', message: 'A perfectly ordinary message.', t, website: '' };
      if (token !== undefined) f['cf-turnstile-response'] = token;
      return request({ method: 'POST', path: '/contact', form: f, headers: { ...SAME, 'cf-connecting-ip': freshIp() } });
    };
    r = await form('good-c1'); check(g3, 'valid token -> 303 to ?sent=1', `${r.status} ${r.headers.location}`, '303 /contact?sent=1');
    r = await form('good-c1'); check(g3, 'reusing that token -> 400, message refused', r.status, 400);
    r = await form(undefined);  check(g3, 'no token -> 400 "spam check did not pass"', `${r.status} ${/spam check did not pass/.test(r.text)}`, '400 true');
    r = await form('bad-c2');   check(g3, 'rejected token -> 400', r.status, 400);
  } else {
    console.log('\n== TURNSTILE OFF (no keys, or only one) ==');
    const g = 'off';
    check(g, '/contact shows no widget and loads no Turnstile script', !/cf-turnstile|challenges\.cloudflare\.com/.test(contact.text), true);
    check(g, '/resume reveal buttons carry no site key', !/data-sitekey/.test(resume.text), true);
    for (const [name, r] of [['/contact', contact], ['/resume', resume]]) check(g, `${name} CSP does not allow Turnstile`, !csp(r).includes('challenges.cloudflare.com'), true);
    const n = calls.length;
    let r = await reveal({ kind: 'email' });
    check(g, 'reveal with no token still works -> 200 with the email', `${r.status} ${JSON.parse(r.text).value}`, `200 ${EMAIL}`);
    r = await reveal({ kind: 'phone' }); check(g, 'reveal phone with no token -> 200', r.status, 200);
    r = await reveal({ kind: 'email', token: 'whatever' }); check(g, 'a stray token is simply ignored -> 200', r.status, 200);
    check(g, 'Cloudflare is never contacted', since(n), 0);
    r = await reveal({ kind: 'fax' }); check(g, 'unknown kind -> 404', r.status, 404);
    const page = await request({ path: '/contact' }); const t = /name="t" value="([^"]+)"/.exec(page.text)?.[1];
    await new Promise((ok) => setTimeout(ok, 3300));
    r = await request({ method: 'POST', path: '/contact', form: { name: 'Ada', email: 'ada@example.com', subject: '', message: 'A perfectly ordinary message.', t, website: '' }, headers: { ...SAME, 'cf-connecting-ip': freshIp() } });
    check(g, 'contact form works without a token -> 303', `${r.status} ${r.headers.location}`, '303 /contact?sent=1');
  }
} catch (e) { console.error('\nSuite aborted:', e.message); verifier.close(); process.exit(2); }
verifier.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log('  - ' + f); }
process.exit(fail ? 1 : 0);
