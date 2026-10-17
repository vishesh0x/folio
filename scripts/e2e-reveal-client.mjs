#!/usr/bin/env node
// Runs the REAL built script of the "Show email / phone" button inside a simulated page (jsdom) with a FAKE Turnstile.
// It checks the browser-side logic: when Turnstile is loaded, what the widget is asked for, what is sent to /api/reveal,
// and what the visitor sees when things go wrong. It does NOT talk to the real Turnstile (that needs a deployed site).
//
//   npm run build && npm i --no-save jsdom && node scripts/e2e-reveal-client.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

let JSDOM;
try { ({ JSDOM } = await import('jsdom')); } catch { console.error('jsdom is not installed. Run:  npm i --no-save jsdom'); process.exit(2); }
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/client/_astro');
const file = readdirSync(dir).filter((f) => f.endsWith('.js')).find((f) => readFileSync(join(dir, f), 'utf8').includes('/api/reveal'));
if (!file) { console.error('Built Reveal script not found. Run `npm run build` first.'); process.exit(2); }
const CODE = readFileSync(join(dir, file), 'utf8');
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const API = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

let pass = 0, fail = 0; const failures = [];
const check = (name, got, want) => { const ok = got === want; ok ? pass++ : (fail++, failures.push(`${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(86)} ${String(got)}`); };

/** Builds a page with one reveal button, runs the real script in it. */
function page({ sitekey, kind = 'email', existingScript = false, reply = { ok: true, status: 200, body: { value: 'hello@example.com' } } } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head>${existingScript ? `<script src="${API}"></script>` : ''}</head><body>
    <span class="reveal" data-reveal-wrap ${sitekey ? `data-sitekey="${sitekey}"` : ''}>
      <button type="button" data-reveal="${kind}">Show</button><span class="reveal-msg" role="status"></span></span></body></html>`,
    { runScripts: 'outside-only', url: 'http://localhost:8787/contact' });
  const w = dom.window, d = w.document;
  const fetches = []; w.fetch = async (url, init) => { fetches.push({ url, init, body: JSON.parse(init.body) }); return { ok: reply.ok, status: reply.status, json: async () => { if (reply.badJson) throw new Error('not json'); return reply.body; } }; };
  const widgets = [];
  const fakeTurnstile = (o = {}) => ({ render(el, options) { const id = `w${widgets.length}`; const rec = { id, el, options, removed: false }; widgets.push(rec); if (o.sync) options.callback('good-sync'); return id; }, remove(id) { widgets.find((x) => x.id === id).removed = true; } });
  w.eval(CODE);
  return {
    w, d, fetches, widgets, fakeTurnstile,
    btn: d.querySelector('[data-reveal]'), msg: d.querySelector('.reveal-msg'), wrap: d.querySelector('[data-reveal-wrap]'),
    injected: () => [...d.querySelectorAll('script')].filter((s) => s.src.startsWith(API)),
    close: () => w.close(),
  };
}

console.log(`(testing ${file})\n`);

{ console.log('== Turnstile on: happy path ==');
  const p = page({ sitekey: 'SITEKEY' });
  check('no Turnstile script before anyone clicks', p.injected().length, 0);
  p.btn.click(); await tick();
  check('click injects exactly one Turnstile script', p.injected().length, 1);
  check('...in explicit-render mode', p.injected()[0].src, `${API}?render=explicit`);
  check('button is disabled while checking', p.btn.disabled, true);
  check('visitor is told a check is running', p.msg.textContent, 'Checking that you are a person…');
  check('...in the calm (non-error) style', p.msg.dataset.state, 'busy');
  check('nothing sent to /api/reveal until the check passes', p.fetches.length, 0);
  p.w.turnstile = p.fakeTurnstile(); await tick(80);
  check('widget rendered once', p.widgets.length, 1);
  const o = p.widgets[0].options;
  check('widget gets the site key from the page', o.sitekey, 'SITEKEY');
  check('widget action is "reveal"', o.action, 'reveal');
  check('widget is invisible unless interaction is needed', o.appearance, 'interaction-only');
  o.callback('good-token-1'); await tick();
  check('then /api/reveal is called once', p.fetches.length, 1);
  check('...with the kind and the token', JSON.stringify(p.fetches[0].body), '{"kind":"email","token":"good-token-1"}');
  const a = p.wrap.querySelector('a.revealed');
  check('email appears as a mailto link', a?.getAttribute('href'), 'mailto:hello@example.com');
  check('button is replaced by the link', p.d.querySelector('[data-reveal]'), null);
  check('widget was removed after use (tokens are single-use)', p.widgets[0].removed, true);
  check('widget container left no trace in the page', p.d.querySelector('.reveal-ts'), null);
  check('status message cleared', p.msg.textContent, '');
  p.close(); }

{ console.log('\n== phone link formatting ==');
  const p = page({ sitekey: 'K', kind: 'phone', reply: { ok: true, status: 200, body: { value: '+1 555 0100' } } });
  p.btn.click(); await tick(); p.w.turnstile = p.fakeTurnstile(); await tick(80); p.widgets[0].options.callback('t'); await tick();
  check('phone becomes a tel: link without spaces', p.wrap.querySelector('a.revealed')?.getAttribute('href'), 'tel:+15550100');
  check('...showing the number as written', p.wrap.querySelector('a.revealed')?.textContent, '+1 555 0100');
  p.close(); }

{ console.log('\n== check fails or is unsupported ==');
  for (const cb of ['error-callback', 'timeout-callback', 'unsupported-callback']) {
    const p = page({ sitekey: 'K' }); p.btn.click(); await tick(); p.w.turnstile = p.fakeTurnstile(); await tick(80);
    p.widgets[0].options[cb](); await tick();
    check(`${cb}: nothing is sent to the server`, p.fetches.length, 0);
    check(`${cb}: button is usable again`, p.btn.disabled, false);
    check(`${cb}: visitor sees the "did not pass" message (error style)`, `${p.msg.textContent} | ${p.msg.dataset.state ?? 'error'}`, 'The spam check did not pass. Please try again. | error');
    check(`${cb}: widget removed`, p.widgets[0].removed, true);
    p.close();
  } }

{ console.log('\n== Turnstile script blocked (ad blocker, offline, CSP) ==');
  const p = page({ sitekey: 'K' }); p.btn.click(); await tick();
  p.injected()[0].dispatchEvent(new p.w.Event('error')); await tick();
  check('visitor is told the check could not load', p.msg.textContent.startsWith('The spam check could not load.'), true);
  check('button is usable again', p.btn.disabled, false);
  check('nothing was sent to the server', p.fetches.length, 0);
  p.close(); }

{ console.log('\n== server refuses ==');
  let p = page({ sitekey: 'K', reply: { ok: false, status: 400, body: { error: 'The spam check did not pass. Please try again.' } } });
  p.btn.click(); await tick(); p.w.turnstile = p.fakeTurnstile(); await tick(80); p.widgets[0].options.callback('t'); await tick();
  check('server message is shown as is', p.msg.textContent, 'The spam check did not pass. Please try again.');
  check('button is usable again (a retry runs a fresh check)', p.btn.disabled, false);
  p.close();
  p = page({ sitekey: 'K', reply: { ok: false, status: 429, body: { error: 'Too many requests. Try again later.' } } });
  p.btn.click(); await tick(); p.w.turnstile = p.fakeTurnstile(); await tick(80); p.widgets[0].options.callback('t'); await tick();
  check('rate-limit message is shown', p.msg.textContent, 'Too many requests. Try again later.');
  p.close();
  p = page({ sitekey: 'K', reply: { ok: false, status: 500, badJson: true } });
  p.btn.click(); await tick(); p.w.turnstile = p.fakeTurnstile(); await tick(80); p.widgets[0].options.callback('t'); await tick();
  check('a non-JSON server error gives a plain message, not a parser error', p.msg.textContent, 'Could not load. Try again.');
  p.close(); }

{ console.log('\n== retry after a failure ==');
  const p = page({ sitekey: 'K' }); p.btn.click(); await tick(); p.w.turnstile = p.fakeTurnstile(); await tick(80);
  p.widgets[0].options['error-callback'](); await tick();
  p.btn.click(); await tick(80);
  check('second click renders a second, fresh widget', p.widgets.length, 2);
  check('...without injecting the script again', p.injected().length, 1);
  p.widgets[1].options.callback('good-2'); await tick();
  check('second attempt succeeds', p.wrap.querySelector('a.revealed')?.getAttribute('href'), 'mailto:hello@example.com');
  p.close(); }

{ console.log('\n== contact page: its own Turnstile script is reused ==');
  const p = page({ sitekey: 'K', existingScript: true });
  p.w.turnstile = p.fakeTurnstile(); p.btn.click(); await tick(80);
  check('no second script is added', p.injected().length, 1);
  check('widget renders straight away', p.widgets.length, 1);
  p.close(); }

{ console.log('\n== widget answers before render() returns ==');
  const p = page({ sitekey: 'K' }); p.btn.click(); await tick(); p.w.turnstile = p.fakeTurnstile({ sync: true }); await tick(80);
  check('request still goes out with the token', p.fetches[0]?.body.token, 'good-sync');
  check('widget is still cleaned up', p.widgets[0].removed, true);
  p.close(); }

{ console.log('\n== double click while checking ==');
  const p = page({ sitekey: 'K' }); p.btn.click(); p.btn.click(); await tick(); p.w.turnstile = p.fakeTurnstile(); await tick(80);
  check('only one widget and one script', `${p.widgets.length} ${p.injected().length}`, '1 1');
  p.close(); }

{ console.log('\n== two buttons at once (print-with-contact on the resume) ==');
  const dom = new JSDOM(`<!doctype html><body>
    <span data-reveal-wrap data-sitekey="K"><button data-reveal="email">e</button><span class="reveal-msg"></span></span>
    <span data-reveal-wrap data-sitekey="K"><button data-reveal="phone">p</button><span class="reveal-msg"></span></span></body>`, { runScripts: 'outside-only', url: 'http://localhost:8787/resume' });
  const w = dom.window, fetches = [], widgets = [];
  w.fetch = async (u, i) => { const b = JSON.parse(i.body); fetches.push(b); return { ok: true, status: 200, json: async () => ({ value: b.kind === 'email' ? 'hello@example.com' : '+1 555 0100' }) }; };
  w.eval(CODE);
  w.document.querySelectorAll('[data-reveal]').forEach((b) => b.click()); await tick();
  w.turnstile = { render: (el, o) => { widgets.push(o); return `w${widgets.length}`; }, remove() {} }; await tick(80);
  check('two widgets, one per button', widgets.length, 2);
  widgets[0].callback('tok-a'); widgets[1].callback('tok-b'); await tick();
  check('each button got its own value', w.document.querySelectorAll('a.revealed').length, 2);
  check('each request carried a different token', new Set(fetches.map((f) => f.token)).size, 2);
  check('no reveal buttons remain (what the print wait loop looks for)', w.document.querySelectorAll('[data-reveal]').length, 0);
  w.close(); }

{ console.log('\n== Turnstile off (no site key on the page) ==');
  const p = page({});
  p.btn.click(); await tick();
  check('no Turnstile script is loaded', p.injected().length, 0);
  check('request goes straight out', p.fetches.length, 1);
  check('...with no token', JSON.stringify(p.fetches[0].body), '{"kind":"email"}');
  check('email appears', p.wrap.querySelector('a.revealed')?.getAttribute('href'), 'mailto:hello@example.com');
  p.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log('  - ' + f); }
process.exit(fail ? 1 : 0);
