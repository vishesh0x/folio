import { env } from 'cloudflare:workers';
import { networkOf } from './ip';

/** Counts a hit for `key` and says whether it is still within `max` hits per `windowSecs`. One atomic statement. */
export async function allow(key: string, max: number, windowSecs: number): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `INSERT INTO login_attempts (key, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count        = CASE WHEN window_start < ?2 - ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start < ?2 - ?3 THEN ?2 ELSE window_start END
     RETURNING count`
  ).bind(key, now, windowSecs).first<{ count: number }>();
  // Retention: rows hold visitor IP addresses and the longest window is 1 hour, so anything older than 2 hours is useless. Pruned on about
  // 1 in 20 calls, which keeps the table tiny without a scheduled job (idx_attempts_window makes it cheap).
  if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM login_attempts WHERE window_start < ?').bind(now - 7200).run();
  return (row?.count ?? 1) <= max;
}
export const ipOf = (request: Request) => request.headers.get('cf-connecting-ip') ?? 'local';

/**
 * What a rate-limit counter is stored under. Two privacy/fairness rules:
 *  - a visitor is their NETWORK (an IPv6 /64, see ip.ts), not one address of billions they could rotate through;
 *  - the stored key is a keyed hash (HMAC) when a secret is configured (RATE_LIMIT_SALT, or failing that ADMIN_SETUP_TOKEN), so the
 *    database holds no visitor IP addresses; without any secret (local development) the plain network is kept so it is easy to read.
 * Unrelated visitors still get different keys, and the same visitor always gets the same one.
 */
async function keyed(value: string, fallbackToHash = false): Promise<string> {
  const pepper = env.RATE_LIMIT_SALT || env.ADMIN_SETUP_TOKEN;
  if (!pepper && !fallbackToHash) return value;
  const enc = new TextEncoder();
  const data = enc.encode(value);
  let digest: ArrayBuffer;
  if (pepper) {
    const k = await crypto.subtle.importKey('raw', enc.encode('rate-limit-v1:' + pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    digest = await crypto.subtle.sign('HMAC', k, data);
  } else digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** Counter key for "this visitor, doing this" (e.g. `rateKey('reveal', request)`). */
export const rateKey = async (kind: string, request: Request) => `${kind}:${await keyed(networkOf(ipOf(request)))}`;
/** Counter key for "this account" (an email address is never stored: it is always hashed). */
export const accountKey = async (email: string) => `acct:${await keyed(email.trim().toLowerCase().slice(0, 254), true)}`;
