import { env } from 'cloudflare:workers';
import { getAsset, type Asset } from './assets';
import { etagMatches } from './http-cache';

// Steps of about 12% (a phone at 412 CSS px and 1.75x asks for 721 pixels: 720 serves it, where the old ladder sent 800). Every extra step is one more
// cache entry per format to forget when a picture is deleted, and a delete may make only 50 calls in all, so purgeAssetCache forgets exactly the
// variants this site's own markup can ask for (see there), not every width x every format.
export const WIDTHS = [160, 320, 480, 640, 720, 800, 900, 1024, 1280, 1600, 2000];
/** Share images (og:image: Base.astro, src/lib/seo.ts, the project page) are always JPEG at this one width. */
export const OG_WIDTHS = [1280];
export const FORMATS = { avif: 'image/avif', webp: 'image/webp', jpeg: 'image/jpeg', png: 'image/png' } as const;
export type Fmt = keyof typeof FORMATS;
const RESIZABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
// TWO lifetimes, for two different caches:
//  * the visitor's own BROWSER keeps a picture for a year: the bytes behind an id never change (`immutable`), and a browser only uses its copy for a
//    page that still points at that id (the page itself is checked on every view), so a deleted picture stops appearing at once; what a browser
//    already downloaded it already has.
//  * the shared EDGE cache keeps its copy for 7 days at most (the header stored with it), so even a copy that a purge missed expires within a week.
const FOREVER = 'public, max-age=31536000, immutable';
const EDGE = 'public, max-age=604800, immutable';

/** The format a picture is offered in for browsers without AVIF/WebP: its own. (Anything that is not PNG or WebP is JPEG.) */
export const fallbackFormat = (mime: string): Fmt => (mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpeg');

export const snapWidth = (w: number) => WIDTHS.find((x) => x >= w) ?? WIDTHS[WIDTHS.length - 1];
export const canResize = (a: Pick<Asset, 'mime'>) => RESIZABLE.has(a.mime);

/** Headers that stop an SVG or file from doing anything if someone opens it directly. */
function safeHeaders(a: Asset, contentType: string): Headers {
  const h = new Headers({
    'Content-Type': contentType,
    'Cache-Control': FOREVER,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename="${a.filename.replace(/"/g, '')}"`,
    'Cross-Origin-Resource-Policy': 'cross-origin', // links you copy can be embedded on other sites
  });
  if (a.mime === 'application/pdf') h.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (a.mime === 'image/svg+xml') {
    // No scripts, no network, no forms, no navigation: even if an SVG slipped past the sanitiser, it is inert.
    h.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
  }
  return h;
}

export async function originalResponse(a: Asset, request: Request): Promise<Response> {
  const etag = `"${a.id}"`;
  if (etagMatches(request.headers.get('If-None-Match'), etag)) return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': FOREVER } });
  const obj = await env.ASSETS_BUCKET.get(a.r2_key);
  if (!obj) return new Response('Not found', { status: 404 });
  const h = safeHeaders(a, a.mime);
  h.set('ETag', etag);
  return new Response(obj.body, { headers: h });
}

export async function resizedResponse(a: Asset, opts: { width: number; height?: number; fit: 'scale-down' | 'pad'; fmt: Fmt; background?: string }): Promise<Response | null> {
  const obj = await env.ASSETS_BUCKET.get(a.r2_key);
  if (!obj) return null;
  try {
    const t: Record<string, unknown> = { width: opts.width, fit: opts.fit };
    if (opts.height) t.height = opts.height;
    if (opts.background) t.background = opts.background;
    const out = await env.IMAGES.input(obj.body).transform(t).output({ format: FORMATS[opts.fmt], quality: 82 });
    const res = out.response();
    const h = safeHeaders(a, FORMATS[opts.fmt]);
    return new Response(res.body, { headers: h });
  } catch (e) {
    console.error('image transform failed, serving original', e);
    return null;
  }
}

/** The ids we hand out are random, URL-safe and 8-32 characters. Anything else cannot be an asset, so it never reaches the database. */
export const ASSET_ID = /^[A-Za-z0-9_-]{8,32}$/;
export type Variant = { w: number; f: Fmt } | null;

/** Read ?w= and ?f= into one of the finite set of variants (9 widths x 4 formats), or null for the original file. */
export function variantOf(params: URLSearchParams): Variant {
  const w = Number(params.get('w')), f = params.get('f');
  return w > 0 && f && f in FORMATS ? { w: snapWidth(w), f: f as Fmt } : null;
}

/**
 * The ONE cache key for an image variant. It ignores the file name in the URL, any extra query parameters, and widths that snap to
 * the same size, so no URL trick can make the site rebuild an image it already has: an id has at most 1 + 9 x 4 entries.
 */
export const mediaKey = (origin: string, id: string, v: Variant) => `${origin}/media/${id}` + (v ? `?w=${v.w}&f=${v.f}` : '');
// A separate path, NOT a #fragment: cache keys ignore fragments, so "#missing" would collide with the cached original of the same image.
const missingKey = (origin: string, id: string) => `${origin}/__missing/${id}`;

/**
 * Edge cache wrapper for /media. Answers from cache (with a 304 when the browser already has it), otherwise builds the response once.
 * Unknown ids are remembered for a minute, so scanning random ids cannot hammer the database.
 */
export async function cachedMedia(request: Request, id: string, v: Variant, make: () => Promise<Response>): Promise<Response> {
  const origin = new URL(request.url).origin, cache = caches.default;
  const key = new Request(mediaKey(origin, id, v));
  const etag = `"${id}${v ? `-${v.w}-${v.f}` : ''}"`;
  const hit = await cache.match(key);
  if (hit) {
    if (etagMatches(request.headers.get('If-None-Match'), etag)) return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': FOREVER } });
    const h = new Headers(hit.headers); h.set('X-Cache', 'HIT'); h.set('ETag', etag); h.set('Cache-Control', FOREVER);   // stored with the edge lifetime, sent with the browser one
    return new Response(hit.body, { status: 200, headers: h });
  }
  const gone = await cache.match(new Request(missingKey(origin, id)));
  if (gone) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Cache': 'HIT' } });
  const res = await make();
  if (res.status === 200 && res.headers.get('X-Degraded')) {
    // A stand-in (the full-size original, served because the resized copy could not be made right now): short-lived everywhere, never `immutable`, so the
    // real resized picture replaces it as soon as the problem passes.
    const h = new Headers(res.headers); h.delete('X-Degraded'); h.set('Cache-Control', 'public, max-age=60');
    return new Response(res.body, { status: 200, headers: h });
  }
  if (res.status === 200) {
    const out = new Response(res.body, { status: 200, headers: new Headers(res.headers) });
    out.headers.set('ETag', etag);
    const [live, keep] = out.body ? out.body.tee() : [null, null];
    const stored = new Headers(out.headers); stored.set('Cache-Control', EDGE);            // the shared cache keeps its copy for a week...
    await cache.put(key, new Response(keep, { status: 200, headers: stored }));
    return new Response(live, { status: 200, headers: (() => { const h = new Headers(out.headers); h.set('X-Cache', 'MISS'); return h; })() });   // ...the browser for a year
  }
  if (res.status === 404) await cache.put(new Request(missingKey(origin, id)), new Response('', { status: 200, headers: { 'Cache-Control': 'public, max-age=60' } }));
  return res;
}

/** The variants this site's own pages can ask for: AVIF, WebP and the picture's own format at every width, plus the JPEG used for share images. */
export function knownVariants(a: Pick<Asset, 'mime'>): { w: number; f: Fmt }[] {
  if (!canResize(a)) return [];
  const fb = fallbackFormat(a.mime), out: { w: number; f: Fmt }[] = [];
  for (const w of WIDTHS) for (const f of new Set<Fmt>(['avif', 'webp', fb])) out.push({ w, f });
  if (fb !== 'jpeg') for (const w of OG_WIDTHS) out.push({ w, f: 'jpeg' });
  return out;
}

/** Where a resized picture is kept in R2 after it is first made (see variantResponse). */
export const variantKey = (id: string, v: { w: number; f: Fmt }) => `variants/${id}/${v.w}-${v.f}`;

/**
 * A resized picture, made ONCE and kept in R2.
 * Why: every call to the Images binding is billed as a transformation (the free plan has 5,000 a month), and the page cache is per DATA CENTER with a
 * 7-day life, so without this each data center would transform the same picture again every week. With it, a data center that has no cached copy
 * reads the stored one from R2 (an ordinary read) and only a size nobody has asked for before is transformed, once.
 */
export async function variantResponse(a: Asset, v: { w: number; f: Fmt }): Promise<Response | null> {
  const key = variantKey(a.id, v);
  const kept = await env.ASSETS_BUCKET.get(key);
  if (kept) return new Response(kept.body, { headers: safeHeaders(a, FORMATS[v.f]) });
  const res = await resizedResponse(a, { width: v.w, fit: 'scale-down', fmt: v.f });
  if (!res) return null;
  const bytes = await res.arrayBuffer();
  try { await env.ASSETS_BUCKET.put(key, bytes, { httpMetadata: { contentType: FORMATS[v.f] } }); } catch (e) { console.error('[storage] could not keep resized copy', key, e); }   // still served; just made again next time
  return new Response(bytes, { headers: res.headers });
}

/** Remove every cached variant of an asset in this data center (other locations expire within 7 days). */
export async function purgeAssetCache(a: Pick<Asset, 'id' | 'mime'>, origin: string) {
  const urls = [mediaKey(origin, a.id, null), missingKey(origin, a.id)];
  // Resized copies exist only for pictures that can be resized. A PDF or SVG has just the original (2 cache calls instead of 38; a request on the
  // free Workers plan may make only 50 calls in all).
  // Exactly the variants this site's own pages ask for (knownVariants). A variant only someone typing a URL by hand could have asked for is not
  // forgotten here; it expires within the week. This keeps a delete to about 36 cache calls, inside the 50 a request may make.
  for (const v of knownVariants(a)) urls.push(mediaKey(origin, a.id, v));
  await Promise.all(urls.map((u) => caches.default.delete(new Request(u))));
}

export const loadAsset = (id: string | undefined) => (id ? getAsset(id) : Promise.resolve(null));
