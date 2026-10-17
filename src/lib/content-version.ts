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
