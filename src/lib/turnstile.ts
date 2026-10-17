// Cloudflare Turnstile (the free "are you a person?" check), used by the contact form and the "Show email / phone" buttons.
//
// It is ON only when BOTH keys are set: TURNSTILE_SITE_KEY (public, in wrangler.jsonc "vars") and TURNSTILE_SECRET_KEY
// (a secret). With only one of them, the check stays off everywhere. That way a half-finished setup can never lock
// visitors out of the contact form or hide your email from everyone.
import { env } from 'cloudflare:workers';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export const turnstileOn = (): boolean => !!env.TURNSTILE_SITE_KEY && !!env.TURNSTILE_SECRET_KEY;
/** The public site key to put on a page, or undefined when the check is off. */
export const turnstileSiteKey = (): string | undefined => (turnstileOn() ? env.TURNSTILE_SITE_KEY : undefined);
/** True when exactly one of the two keys is set (shown as a warning in the dashboard). */
export const turnstileHalfSet = (): boolean => !!env.TURNSTILE_SITE_KEY !== !!env.TURNSTILE_SECRET_KEY;

const looksLikeIp = (s: string) => /^[0-9a-f.:]{3,45}$/i.test(s);

/**
 * Asks Cloudflare whether a token is genuine. A token works once only (Cloudflare enforces that).
 * Fails closed: no token, an over-long token, no answer within 5 seconds, or an unreadable answer all count as "no".
 *
 * Note: the `action` Cloudflare echoes back is NOT checked. Cloudflare's own test keys always answer "test", so a strict
 * match would break local testing. The widgets still set an action ("contact", "reveal") for Cloudflare's analytics.
 */
export async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  if (!turnstileOn() || !token || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token });
    if (looksLikeIp(ip)) body.set('remoteip', ip); // "local" (no Cloudflare in front, i.e. local testing) is not an address
    // TURNSTILE_VERIFY_URL exists only so the test suite can point this at a fake verifier. Leave it unset in real use.
    const r = await fetch(env.TURNSTILE_VERIFY_URL || VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    return ((await r.json()) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}
