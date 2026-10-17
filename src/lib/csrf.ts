// Cross-site request forgery protection: is this request really coming from a page on THIS site?
//
// Browsers tell us in `Sec-Fetch-Site`, a header that web pages cannot set or fake. It is the primary check.
// `Origin` is not enough on its own: Chrome omits it on some same-origin requests (a `fetch()` POST, found by
// testing in a real browser), so relying on it would block your own pages. Older clients that send no
// Sec-Fetch-Site fall back to Origin, then Referer. Anything that cannot be shown to be same-origin is refused.
export function isSameOrigin(request: Request, url: URL): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';   // "same-site" (a sibling subdomain) and "cross-site" are both refused
  const origin = request.headers.get('origin');
  if (origin) return origin === url.origin;
  const referer = request.headers.get('referer');
  if (referer) { try { return new URL(referer).origin === url.origin; } catch { return false; } }
  return false;
}
