// A FAKE Cloudflare Turnstile "siteverify" endpoint for tests (the real one is not reachable from CI sandboxes and a real
// verifier cannot be told to fail on demand). It copies the real response shape.
//   token "good-…"     → success (once only; a second use answers timeout-or-duplicate, like Cloudflare)
//   token "drop-…"     → the connection is destroyed (Cloudflare unreachable)
//   token "garbage-…"  → an HTML page instead of JSON
//   token "slow-…"     → answers after 7 s (the Worker gives up after 5 s)
//   token "wronghost-…"  → success, but earned on another site (hostname evil.example)
//   token "wrongaction-…" → success, but by a different widget (action "other")
//   token "act_<name>-…"  → success, earned by the widget with action <name>   (a plain "good-…" names no action, like an unnamed widget)
//   anything else      → success:false
// Extra endpoints for assertions:  GET /health   GET /calls   POST /reset
import http from 'node:http';

let calls = []; const used = new Set();
http.createServer((req, res) => {
  const json = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.url === '/health') return json({ ok: true });
  if (req.url === '/calls') return json(calls);
  if (req.url === '/reset') { calls = []; used.clear(); return json({ ok: true }); }
  let raw = ''; req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    const p = new URLSearchParams(raw), token = p.get('response') ?? '', secret = p.get('secret');
    calls.push({ token, secret, remoteip: p.get('remoteip') });
    if (token.startsWith('drop-')) return req.socket.destroy();
    if (token.startsWith('garbage-')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>not json</html>'); }
    if (token.startsWith('slow-')) await new Promise((r) => setTimeout(r, 7000));
    const ok = secret === 'test-secret' && /^(good|slow|wronghost|wrongaction|act_[a-z]+)-/.test(token) && !used.has(token);
    if (ok) used.add(token);
    const act = /^act_([a-z]+)-/.exec(token)?.[1] ?? (token.startsWith('wrongaction-') ? 'other' : undefined);
    json(ok ? { success: true, hostname: token.startsWith('wronghost-') ? 'evil.example' : 'localhost', ...(act ? { action: act } : {}) } : { success: false, 'error-codes': [used.has(token) ? 'timeout-or-duplicate' : 'invalid-input-response'] });
  });
}).listen(9911, '127.0.0.1', () => console.log('fake turnstile verifier on :9911'));
