/**
 * URL helpers shared by server + client.
 *
 * Anything that ends up in an `href`/`src` goes through these so a stored
 * `javascript:` / `data:` URL can never be rendered as a link.
 */

const ABSOLUTE_PROTOCOLS = new Set(["http:", "https:"]);

/** True for `/media/...` style paths (never protocol-relative `//host`). */
export const isLocalPath = (u: string) => u.startsWith("/") && !u.startsWith("//");

/** Returns a safe http(s) / mailto / same-site URL, or `undefined`. */
export function safeHref(input: string | null | undefined): string | undefined {
  const value = (input ?? "").trim();
  if (!value) return undefined;
  if (isLocalPath(value)) return value;
  try {
    const u = new URL(value);
    if (ABSOLUTE_PROTOCOLS.has(u.protocol) || u.protocol === "mailto:") return u.toString();
  } catch {
    /* fallthrough */
  }
  return undefined;
}

/** Like `safeHref` but for images: only https (or same-site) is allowed. */
export function safeImageSrc(input: string | null | undefined): string | undefined {
  const value = (input ?? "").trim();
  if (!value) return undefined;
  if (isLocalPath(value)) return value;
  try {
    const u = new URL(value);
    if (u.protocol === "https:") return u.toString();
  } catch {
    /* fallthrough */
  }
  return undefined;
}

export const isExternal = (href: string) => /^https?:\/\//i.test(href);

/** Resolve a (possibly relative) URL against the site origin. */
export function absoluteUrl(path: string | null | undefined, origin: string): string | undefined {
  const href = safeImageSrc(path) ?? safeHref(path);
  if (!href) return undefined;
  return isLocalPath(href) ? origin.replace(/\/$/, "") + href : href;
}

/** `/media/<key>` → `<key>`, otherwise `undefined`. */
export function mediaKeyFromUrl(url: string | null | undefined): string | undefined {
  const m = /^\/media\/([^?#]+)/.exec(url ?? "");
  return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}
