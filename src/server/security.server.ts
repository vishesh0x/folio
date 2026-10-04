/**
 * Security headers applied to every response by the Worker entry.
 *
 * CSP uses a per-request nonce for scripts (no `unsafe-inline`), which is the
 * main XSS backstop. In `vite dev` the CSP is skipped because the dev server
 * injects inline HMR scripts without a nonce.
 */
export function buildCsp(nonce: string, turnstile: boolean): string {
  const challenge = turnstile ? " https://challenges.cloudflare.com" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${challenge}`,
    // Tailwind/Radix/Sonner set inline style attributes; styles can't run script.
    "style-src 'self' 'unsafe-inline'",
    // Admin may paste external https image URLs; uploaded assets are same-origin.
    "img-src 'self' data: https:",
    "font-src 'self'",
    `connect-src 'self'${challenge}`,
    turnstile ? "frame-src https://challenges.cloudflare.com" : "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

const STATIC_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

const PRIVATE_PREFIXES = ["/dashboard", "/auth", "/_serverFn", "/api/"];

export function applySecurityHeaders(
  response: Response,
  opts: { request: Request; nonce?: string; turnstile?: boolean; prod: boolean },
): Response {
  // Responses from fetch()/R2 can be immutable; copy so we can set headers.
  const res = new Response(response.body, response);
  const h = res.headers;
  const url = new URL(opts.request.url);

  for (const [k, v] of Object.entries(STATIC_HEADERS)) if (!h.has(k)) h.set(k, v);
  if (url.protocol === "https:") {
    h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  const isHtml = (h.get("content-type") ?? "").includes("text/html");
  if (isHtml && opts.prod && opts.nonce) {
    h.set("Content-Security-Policy", buildCsp(opts.nonce, !!opts.turnstile));
  }
  if (PRIVATE_PREFIXES.some((p) => url.pathname.startsWith(p)) && !h.has("Cache-Control")) {
    h.set("Cache-Control", "private, no-store");
  }
  return res;
}

export function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
