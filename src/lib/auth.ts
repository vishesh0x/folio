/**
 * Authentication: password rules, sign-in throttling, first-admin setup, sessions and recognition
 * of known browsers.
 */

import { env } from 'cloudflare:workers';
import type { AstroCookies } from 'astro';
import { hashPassword, verifyPassword, needsRehash, dummyVerify, randomToken, sha256Hex, safeEqual } from './crypto';
import { rateKey, accountKey } from './throttle';

/** Minimum password length. */
export const MIN_PASSWORD = 12;
const SESSION_DAYS = 14;
const COOKIE = import.meta.env.PROD ? '__Host-session' : 'session';
const DEVICE_COOKIE = import.meta.env.PROD ? '__Host-device' : 'device';
const DEVICE_DAYS = 180, MAX_DEVICES = 10;
const MAX_FAILS = 5;  // Wrong passwords allowed per visitor (network) ...
const WINDOW_SECS = 15 * 60;  // ... per 15 minutes
/**
 * A second, separate limit per ACCOUNT, counting wrong passwords from ALL visitors together. The
 * per-visitor limit alone lets many addresses (a botnet, or one IPv6 range) each try a few guesses
 * forever. Twenty an hour is far more than the owner ever mistypes, far too few to guess with.
 */
export const ACCOUNT_MAX_FAILS = 20;
/** Length of the per-account failure window, in seconds. */
export const ACCOUNT_WINDOW_SECS = 3600;
const now = () => Math.floor(Date.now() / 1000);

/** The signed-in owner. */
export type User = { id: number; email: string };

// ── Validation ──
export function validateEmail(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254 ? null : 'Enter a valid email address.';
}
/**
 * Returns a message when the password is unacceptable (too short, or equal to the email address),
 * otherwise null.
 */
export function validatePassword(pw: string, email = ''): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 200) return 'Use 200 characters or fewer.';
  if (email && pw.toLowerCase() === email.toLowerCase()) return 'Your password cannot be your email address.';
  return null;
}

// ── Brute-force throttle (D1) ──
export async function isLimited(key: string, max = MAX_FAILS, window = WINDOW_SECS): Promise<boolean> {
  const row = await env.DB.prepare('SELECT count, window_start FROM login_attempts WHERE key = ?').bind(key).first<{ count: number; window_start: number }>();
  return !!row && row.window_start > now() - window && row.count >= max;
}
/**
 * Counts one failed attempt against a throttle key, starting a new window when the previous one
 * has ended.
 */
export async function recordFailure(key: string, window = WINDOW_SECS) {
  const t = now();
  await env.DB.prepare(
    `INSERT INTO login_attempts (key, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count        = CASE WHEN window_start < ?2 - ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start < ?2 - ?3 THEN ?2 ELSE window_start END`
  ).bind(key, t, window).run();
}
/** Forgets the failed attempts counted under a throttle key. */
export async function clearFailures(key: string) {
  await env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key).run();
}

// ── Known devices ──
/**
 * When many wrong passwords have been sent for the account (by anyone), sign-in is locked for
 * everybody, which would let a stranger who knows the owner's email keep the owner out. A browser the
 * owner has signed in from before carries a random token (stored here only as a hash); it lets that
 * browser keep trying. It is not a credential: the password is still required, and the per-network
 * limit still applies.
 */
export async function isKnownDevice(cookies: AstroCookies, email: string): Promise<boolean> {
  const token = cookies.get(DEVICE_COOKIE)?.value;
  if (!token || token.length > 100) return false;
  const row = await env.DB.prepare('SELECT 1 AS ok FROM trusted_devices t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND u.email = ? AND t.expires_at > ?')
    .bind(await sha256Hex(token), email, now()).first();
  return !!row;
}
/**
 * Marks this browser as known for the account: stores a hashed token and sets the recognition
 * cookie. Does nothing when the browser is already known.
 */
export async function rememberDevice(userId: number, cookies: AstroCookies) {
  const existing = cookies.get(DEVICE_COOKIE)?.value;
  if (existing && existing.length <= 100) {
    const row = await env.DB.prepare('SELECT 1 AS ok FROM trusted_devices WHERE token_hash = ? AND user_id = ? AND expires_at > ?').bind(await sha256Hex(existing), userId, now()).first();
    if (row) return;  // Already known: keep its token
  }
  const token = randomToken(), hash = await sha256Hex(token), expires = now() + DEVICE_DAYS * 86400;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM trusted_devices WHERE expires_at < ?').bind(now()),
    env.DB.prepare('INSERT INTO trusted_devices (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(hash, userId, expires),
    env.DB.prepare('DELETE FROM trusted_devices WHERE user_id = ?1 AND token_hash NOT IN (SELECT token_hash FROM trusted_devices WHERE user_id = ?1 ORDER BY expires_at DESC LIMIT ?2)').bind(userId, MAX_DEVICES),
  ]);
  cookies.set(DEVICE_COOKIE, token, { httpOnly: true, secure: import.meta.env.PROD, sameSite: 'lax', path: '/', maxAge: DEVICE_DAYS * 86400 });
}

// ── Sessions ──
export async function createSession(userId: number, cookies: AstroCookies) {
  const token = randomToken();
  const id = await sha256Hex(token);  // Only the hash is stored
  const expires = now() + SESSION_DAYS * 86400;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()),
    env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(id, userId, expires),
  ]);
  cookies.set(COOKIE, token, { httpOnly: true, secure: import.meta.env.PROD, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86400 });
}

/** Returns the owner for a valid, unexpired session cookie, otherwise null. */
export async function getUser(cookies: AstroCookies): Promise<User | null> {
  const token = cookies.get(COOKIE)?.value;
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`
  ).bind(await sha256Hex(token), now()).first<User>();
}

/** Ends the current session: deletes its row and clears the cookie. */
export async function destroySession(cookies: AstroCookies) {
  const token = cookies.get(COOKIE)?.value;
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256Hex(token)).run();
  cookies.delete(COOKIE, { path: '/' });
}

// ── First-admin setup ──
export const setupEnabled = () => !!env.ADMIN_SETUP_TOKEN && env.ADMIN_SETUP_TOKEN.length >= 16;
/** True once the first admin account exists. */
export const hasAnyUser = async () => !!(await env.DB.prepare('SELECT 1 AS x FROM users LIMIT 1').first());

/**
 * Compares the supplied setup token with ADMIN_SETUP_TOKEN in constant time. Fails closed when the
 * secret is missing or shorter than 16 characters.
 */
export function checkSetupToken(given: string): boolean {
  // Fails closed: no secret configured (or too short) means nobody can register.
  if (!setupEnabled()) return false;
  return safeEqual(given, env.ADMIN_SETUP_TOKEN!);
}

/**
 * Creates the first admin. The INSERT ... WHERE NOT EXISTS is one SQL statement, so if two requests
 * arrive together, SQLite lets exactly one of them insert. Returns the new user id, or null if an
 * admin already exists.
 */
export async function createFirstAdmin(email: string, password: string): Promise<number | null> {
  if (await hasAnyUser()) return null;  // Cheap early exit; the INSERT below is the real guard
  const hash = await hashPassword(password);
  const res = await env.DB.prepare(
    `INSERT INTO users (email, password_hash) SELECT ?1, ?2 WHERE NOT EXISTS (SELECT 1 FROM users)`
  ).bind(email.toLowerCase(), hash).run();
  return res.meta.changes === 1 ? Number(res.meta.last_row_id) : null;
}

// ── Login ──
export async function login(email: string, password: string): Promise<number | null> {
  const user = await env.DB.prepare('SELECT id, password_hash FROM users WHERE email = ?').bind(email).first<{ id: number; password_hash: string }>();
  if (!user) { await dummyVerify(password); return null; }  // Same cost whether or not the email exists
  if (!(await verifyPassword(password, user.password_hash))) return null;
  if (needsRehash(user.password_hash)) {
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), user.id).run();
  }
  return user.id;
}

/**
 * The counter key for this visitor's network (IPv6 grouped by /64, hashed when a secret is
 * configured), see throttle.ts.
 */
export const clientKey = (action: string, request: Request) => rateKey(action, request);
export { accountKey };
