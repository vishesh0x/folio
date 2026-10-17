// Signed "this form was rendered at time T" tokens. Bots that post instantly, or invent a token, fail.
// The signing key is random, created once, and kept in D1, so it needs no extra secret to configure.
import { env } from 'cloudflare:workers';
import { randomToken } from './crypto';

let cached: CryptoKey | null = null;
async function key(): Promise<CryptoKey> {
  if (cached) return cached;
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('form_secret', ?)").bind(randomToken(32)).run();
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'form_secret'").first<{ value: string }>();
  cached = await crypto.subtle.importKey('raw', new TextEncoder().encode(row!.value), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return cached;
}
const mac = async (data: string) => {
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(), new TextEncoder().encode(data)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export async function issueToken(purpose: string): Promise<string> {
  const ts = Math.floor(Date.now() / 1000);
  return `${ts}.${await mac(`${purpose}.${ts}`)}`;
}
export async function checkToken(token: string, purpose: string, minAge = 3, maxAge = 7200): Promise<'ok' | 'too-fast' | 'expired' | 'invalid'> {
  const [tsRaw, sig] = token.split('.');
  const ts = Number(tsRaw);
  if (!Number.isInteger(ts) || !sig) return 'invalid';
  const want = await mac(`${purpose}.${ts}`);
  if (want.length !== sig.length || want.split('').reduce((d, c, i) => d | (c.charCodeAt(0) ^ sig.charCodeAt(i)), 0) !== 0) return 'invalid';
  const age = Math.floor(Date.now() / 1000) - ts;
  return age < minAge ? 'too-fast' : age > maxAge ? 'expired' : 'ok';
}
