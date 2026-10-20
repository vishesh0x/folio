import { env } from 'cloudflare:workers';

// A number that changes whenever you save anything in the dashboard. Cached public pages are stored under it,
// so a save instantly makes the next visitor get a fresh page. It is remembered for 5 seconds per server
// instance so that cache hits do not need a database round trip.
let memo = { v: '0', t: 0 };

export async function contentVersion(): Promise<string> {
  const now = Date.now();
  if (now - memo.t < 5000) return memo.v;
  try {
    const r = await env.DB.prepare("SELECT value FROM settings WHERE key = 'content_version'").first<{ value: string }>();
    memo = { v: r?.value ?? '0', t: now };
  } catch { memo = { ...memo, t: now }; }
  return memo.v;
}
export async function bumpContentVersion() {
  const v = String(Date.now());
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('content_version', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1").bind(v).run();
  memo = { v, t: Date.now() };
}

/**
 * Keep a response in this data center's edge cache under the current content version. The version changes on every dashboard save,
 * so the next visitor gets fresh content at once, and nothing needs purging. `name` must come from a SMALL fixed set (never from
 * the visitor's URL), otherwise someone could fill the cache with junk.
 */
export async function versionedCache(origin: string, name: string, ttl: number, make: () => Promise<Response>): Promise<Response> {
  const key = new Request(`${origin}/__v/${__BUILD_ID__}/${await contentVersion()}/${name}`);
  const hit = await caches.default.match(key);
  if (hit) { const h = new Headers(hit.headers); h.set('X-Cache', 'HIT'); return new Response(hit.body, { status: hit.status, headers: h }); }
  const res = await make();
  if (res.status !== 200) return res;
  const body = await res.arrayBuffer();
  const stored = new Headers(res.headers); stored.set('Cache-Control', `public, max-age=${ttl}`);
  await caches.default.put(key, new Response(body, { status: 200, headers: stored }));
  const out = new Headers(res.headers); out.set('X-Cache', 'MISS');
  return new Response(body, { status: 200, headers: out });
}
