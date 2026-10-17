// Password hashing and token helpers. Web Crypto only, so it runs on Workers.
//
// Cloudflare Workers caps PBKDF2 at 100,000 iterations, so that is what we use.
// The stored format records the iteration count, so it can be raised later and
// old hashes will be upgraded the next time that person logs in.

export const PBKDF2_ITERATIONS = 100_000;
const enc = new TextEncoder();

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(input: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(input)));
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a), bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

/**
 * Accepts the current PBKDF2 format plus two older SHA-256 formats, so hashes
 * from an earlier version of the site can still log in and get upgraded:
 *   "sha256$<salt>$<hex>"  = sha256(salt + password)
 *   "<64 hex chars>"       = sha256(password)
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts[0] === 'pbkdf2-sha256' && parts.length === 4) {
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100_000) return false;
    const got = b64(await pbkdf2(password, unb64(parts[2]), iterations));
    return safeEqual(got, parts[3]);
  }
  if (parts[0] === 'sha256' && parts.length === 3) {
    return safeEqual(await sha256Hex(parts[1] + password), parts[2]);
  }
  if (/^[0-9a-f]{64}$/.test(stored)) return safeEqual(await sha256Hex(password), stored);
  return false;
}

export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts[0] !== 'pbkdf2-sha256' || parts.length !== 4) return true;
  return Number(parts[1]) < PBKDF2_ITERATIONS;
}

/** A verify that always costs about the same, used when the email does not exist. */
export async function dummyVerify(password: string) {
  await pbkdf2(password, new Uint8Array(16), PBKDF2_ITERATIONS);
}

export function randomToken(bytes = 32): string {
  return b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
