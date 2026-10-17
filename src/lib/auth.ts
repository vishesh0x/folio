import { env } from 'cloudflare:workers';
import type { AstroCookies } from 'astro';
import { hashPassword, verifyPassword, needsRehash, dummyVerify, randomToken, sha256Hex, safeEqual } from './crypto';

export const MIN_PASSWORD = 12;
const SESSION_DAYS = 14;
const COOKIE = import.meta.env.PROD ? '__Host-session' : 'session';
const MAX_FAILS = 5;
const WINDOW_SECS = 15 * 60;
const now = () => Math.floor(Date.now() / 1000);

export type User = { id: number; email: string };

/* ───── validation ───── */
export function validateEmail(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254 ? null : 'Enter a valid email address.';
}
export function validatePassword(pw: string, email = ''): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 200) return 'Use 200 characters or fewer.';
  if (email && pw.toLowerCase() === email.toLowerCase()) return 'Your password cannot be your email address.';
  return null;
}

/* ───── brute-force throttle (D1) ───── */
export async function isLimited(key: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT count, window_start FROM login_attempts WHERE key = ?').bind(key).first<{ count: number; window_start: number }>();
  return !!row && row.window_start > now() - WINDOW_SECS && row.count >= MAX_FAILS;
}
export async function recordFailure(key: string) {
  const t = now();
  await env.DB.prepare(
    `INSERT INTO login_attempts (key, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count        = CASE WHEN window_start < ?2 - ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start < ?2 - ?3 THEN ?2 ELSE window_start END`
  ).bind(key, t, WINDOW_SECS).run();
}
export async function clearFailures(key: string) {
  await env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key).run();
}

/* ───── sessions ───── */
export async function createSession(userId: number, cookies: AstroCookies) {
  const token = randomToken();
  const id = await sha256Hex(token); // only the hash is stored
  const expires = now() + SESSION_DAYS * 86400;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()),
    env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(id, userId, expires),
  ]);
  cookies.set(COOKIE, token, { httpOnly: true, secure: import.meta.env.PROD, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86400 });
}

export async function getUser(cookies: AstroCookies): Promise<User | null> {
  const token = cookies.get(COOKIE)?.value;
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`
  ).bind(await sha256Hex(token), now()).first<User>();
}

export async function destroySession(cookies: AstroCookies) {
  const token = cookies.get(COOKIE)?.value;
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256Hex(token)).run();
  cookies.delete(COOKIE, { path: '/' });
}

/* ───── first-admin setup ───── */
export const setupEnabled = () => !!env.ADMIN_SETUP_TOKEN && env.ADMIN_SETUP_TOKEN.length >= 16;
export const hasAnyUser = async () => !!(await env.DB.prepare('SELECT 1 AS x FROM users LIMIT 1').first());

export function checkSetupToken(given: string): boolean {
  // Fails closed: no secret configured (or too short) means nobody can register.
  if (!setupEnabled()) return false;
  return safeEqual(given, env.ADMIN_SETUP_TOKEN!);
}

/**
 * Creates the first admin. The INSERT ... WHERE NOT EXISTS is one SQL statement,
 * so if two requests arrive together, SQLite lets exactly one of them insert.
 * Returns the new user id, or null if an admin already exists.
 */
export async function createFirstAdmin(email: string, password: string): Promise<number | null> {
  if (await hasAnyUser()) return null; // cheap early exit; the INSERT below is the real guard
  const hash = await hashPassword(password);
  const res = await env.DB.prepare(
    `INSERT INTO users (email, password_hash) SELECT ?1, ?2 WHERE NOT EXISTS (SELECT 1 FROM users)`
  ).bind(email.toLowerCase(), hash).run();
  return res.meta.changes === 1 ? Number(res.meta.last_row_id) : null;
}

/* ───── login ───── */
export async function login(email: string, password: string): Promise<number | null> {
  const user = await env.DB.prepare('SELECT id, password_hash FROM users WHERE email = ?').bind(email).first<{ id: number; password_hash: string }>();
  if (!user) { await dummyVerify(password); return null; } // same cost whether or not the email exists
  if (!(await verifyPassword(password, user.password_hash))) return null;
  if (needsRehash(user.password_hash)) {
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), user.id).run();
  }
  return user.id;
}

export const clientKey = (action: string, request: Request) =>
  `${action}:${request.headers.get('cf-connecting-ip') ?? 'local'}`;
