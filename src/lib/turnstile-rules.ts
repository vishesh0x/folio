// The decision rules for Turnstile, kept free of any Cloudflare runtime so they can be tested directly (see src/lib/turnstile.ts).

/** Only a request that arrives at localhost (local development and the test suite) may use the test-only verifier override. */
export const isLocalHost = (hostname: string) => /^(localhost|127\.0\.0\.1|\[?::1\]?)$/i.test(hostname);

/** Cloudflare's published dummy secrets (1x000…AA always passes, 2x… always fails, 3x… "already spent"). Their answers name a made-up site. */
export const isCloudflareTestSecret = (secret: string) => /^[123]x0{20,}/.test(secret);

const bare = (h: string) => h.trim().toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
export const hostMatches = (a: string, b: string) => bare(a) === bare(b);

/**
 * Where to send the check. `override` (the TURNSTILE_VERIFY_URL variable) exists for tests only. It is honoured ONLY for requests that
 * arrive at localhost, so setting it on the real Worker by mistake changes nothing: the real address is used and the override is ignored.
 */
export const verifierUrl = (requestHostname: string, override: string | undefined, official: string) =>
  override && isLocalHost(requestHostname) ? override : official;

export type SiteverifyAnswer = { success?: boolean; hostname?: string; action?: string };
/**
 * Is Cloudflare's answer acceptable? It must say success, and (outside Cloudflare's dummy secrets, which answer with a made-up site) the
 * token must have been earned on THIS site and by the widget this endpoint expects. That stops a token earned on another site that uses
 * the same site key, or on a different widget, from being replayed here.
 */
export function acceptAnswer(a: SiteverifyAnswer, expect: { hostname: string; action: string }, secret: string): boolean {
  if (a.success !== true) return false;
  if (isCloudflareTestSecret(secret)) return true;
  if (a.hostname && !hostMatches(a.hostname, expect.hostname)) return false;
  if (a.action && a.action !== expect.action) return false;
  return true;
}
