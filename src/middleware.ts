import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { getUser } from './lib/auth';
import { contentVersion, bumpContentVersion } from './lib/content-version';
import { inlineScriptHashes } from './lib/inline-scripts';
import { isSameOrigin } from './lib/csrf';
import { turnstileOn } from './lib/turnstile';
import { etagMatches } from './lib/http-cache';

const PROTECTED = /^\/(dashboard|api\/admin)(\/|$)/;
const PUBLIC_PAGE = /^\/(projects(\/[a-z0-9-]+)?|now|resume)?$/; // pages that look the same to every visitor
const TURNSTILE_PAGE = /^\/(contact|resume)\/?$/; // the pages that can show a Turnstile check (contact form, reveal buttons)
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|ref)$/;
const EDGE_TTL = 300; // seconds an unchanged page may live in the edge cache (a dashboard save replaces it at once)
const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'Cache-Control': 'no-store', ...extra } });

const CF_WEB_ANALYTICS = true;

export const onRequest = defineMiddleware(async (ctx, next) => {
  const nonce = btoa(crypto.randomUUID());
  ctx.locals.nonce = nonce;
  const path = ctx.url.pathname;
  const method = ctx.request.method;

  // One address per page: /projects/ is sent to /projects (a permanent redirect), so the cache and search engines see a single URL.
  // The target is rebuilt from the path segments only, so //evil.example/ can never become a redirect to another site.
  if ((method === 'GET' || method === 'HEAD') && path.length > 1 && path.endsWith('/') && !PROTECTED.test(path) && !path.startsWith('/auth') && !path.startsWith('/api/')) {
    return new Response(null, { status: 301, headers: { Location: '/' + path.replace(/^\/+|\/+$/g, '') + ctx.url.search, 'Cache-Control': 'public, max-age=3600' } });
  }

  // Public pages are served from the edge cache when possible (GET only, no query other than tracking tags).
  const cacheable = method === 'GET' && PUBLIC_PAGE.test(path) && [...ctx.url.searchParams.keys()].every((k) => TRACKING.test(k));
  // Browsers must re-check on every visit (so a dashboard save is never hidden behind an old copy), but the check is
  // cheap: the validator is the content version, and an unchanged page is answered with an empty 304.
  const REVALIDATE = 'public, max-age=0, must-revalidate';
  let cacheKey: Request | null = null, etag = '';
  if (cacheable) {
    const version = await contentVersion();
    etag = `"v${version}-${__BUILD_ID__}"`;
    if (etagMatches(ctx.request.headers.get('if-none-match'), etag, false)) return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': REVALIDATE } });
    cacheKey = new Request(`${ctx.url.origin}/__page/${__BUILD_ID__}/${version}${path}`);
    const hit = await caches.default.match(cacheKey);
    if (hit) {
      const h = new Headers(hit.headers);
      h.set('Cache-Control', REVALIDATE); h.set('X-Cache', 'HIT');
      if (hit.status === 200) h.set('ETag', etag); // a remembered "not found" has no validator, so it is never answered with a 304
      return new Response(hit.body, { status: hit.status, headers: h });
    }
  }

  if (PROTECTED.test(path)) {
    const user = await getUser(ctx.cookies);
    if (!user) return path.startsWith('/api/') ? json({ error: 'Not signed in' }, 401) : ctx.redirect('/auth');
    ctx.locals.user = user;
  }

  // Cross-site request forgery protection (replaces Astro's built-in check, so the refusal can be a designed page).
  // Every POST/PUT/PATCH/DELETE must be provably same-origin (see src/lib/csrf.ts).
  let res: Response;
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (unsafe && !path.startsWith('/error/') && !isSameOrigin(ctx.request, ctx.url)) { // /error/* is exempt so the rewrite below cannot loop
    res = path.startsWith('/api/') ? json({ error: 'Forbidden' }, 403) : await ctx.rewrite('/error/403');
  } else {
    res = await next();
  }

  const h = new Headers(res.headers);
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (import.meta.env.PROD) {
    h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // The dev server injects its own inline scripts, so the strict policy is production-only.
    const ts = turnstileOn() && TURNSTILE_PAGE.test(path) ? ' https://challenges.cloudflare.com' : ''; // optional spam check widget
    // Cloudflare Web Analytics: when it is switched on in the Cloudflare dashboard, Cloudflare adds its beacon script to every HTML page
    // and the beacon reports to cloudflareinsights.com. Allowed on public pages only (never sign-in or the dashboard). To stop using it,
    // turn it off in Cloudflare (Analytics & Logs > Web Analytics) and set this to false.
    const beacon = CF_WEB_ANALYTICS && !PROTECTED.test(path) && !path.startsWith('/auth') && !path.startsWith('/api/');
    // Cached pages must not contain a per-request nonce, so they rely on script hashes only.
    const script = ["'self'", ...(await inlineScriptHashes()), ...(cacheable ? [] : [`'nonce-${nonce}'`])].join(' ');
    if (!h.has('Content-Security-Policy')) h.set('Content-Security-Policy', [
      "default-src 'self'",
      `script-src ${script}${ts}${beacon ? ' https://static.cloudflareinsights.com' : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      `connect-src 'self'${ts}${beacon ? ' https://cloudflareinsights.com' : ''}`,
      ...(ts ? [`frame-src${ts}`] : []),
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '));
  }
  if (PROTECTED.test(path) || path.startsWith('/auth') || path === '/contact') h.set('Cache-Control', 'private, no-store'); // /contact carries a one-time form token

  // Anything saved in the dashboard makes cached pages out of date: move the content version on.
  if (unsafe && PROTECTED.test(path) && res.status < 400) await bumpContentVersion();

  // A page that is not found (e.g. /projects/typo) is remembered for a minute, so repeated requests do not each cost database queries.
  // It is stored under the current content version, so publishing that project makes the real page appear immediately.
  if (cacheKey && res.status === 404 && (h.get('content-type') ?? '').startsWith('text/html')) {
    const body = await res.arrayBuffer();
    h.delete('set-cookie');
    const stored = new Headers(h); stored.set('Cache-Control', 'public, max-age=60');
    await caches.default.put(cacheKey, new Response(body, { status: 404, headers: stored }));
    h.set('Cache-Control', REVALIDATE); h.set('X-Cache', 'MISS');
    return new Response(body, { status: 404, headers: h });
  }
  if (cacheKey && res.status === 200 && (h.get('content-type') ?? '').startsWith('text/html')) {
    const body = await res.arrayBuffer();
    h.delete('set-cookie');
    const stored = new Headers(h); stored.set('Cache-Control', `public, max-age=${EDGE_TTL}`);
    await caches.default.put(cacheKey, new Response(body, { status: 200, headers: stored }));
    h.set('Cache-Control', REVALIDATE); h.set('ETag', etag); h.set('X-Cache', 'MISS');
    return new Response(body, { status: 200, headers: h });
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
});
