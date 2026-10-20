import { env } from 'cloudflare:workers';
import { getAsset, type Asset } from './assets';
import { etagMatches } from './http-cache';

export const WIDTHS = [160, 320, 480, 640, 800, 1024, 1280, 1600, 2000];
export const FORMATS = { avif: 'image/avif', webp: 'image/webp', jpeg: 'image/jpeg', png: 'image/png' } as const;
export type Fmt = keyof typeof FORMATS;
const RESIZABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
// 7 days, not "forever": a deleted file stops being served everywhere within a week. `immutable`: the bytes behind an id never change,
// so browsers need not re-check on reload.
const FOREVER = 'public, max-age=604800, immutable';

export const snapWidth = (w: number) => WIDTHS.find((x) => x >= w) ?? WIDTHS[WIDTHS.length - 1];
export const canResize = (a: Asset) => RESIZABLE.has(a.mime);

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
    const h = new Headers(hit.headers); h.set('X-Cache', 'HIT'); h.set('ETag', etag);
    return new Response(hit.body, { status: 200, headers: h });
  }
  const gone = await cache.match(new Request(missingKey(origin, id)));
  if (gone) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Cache': 'HIT' } });
  const res = await make();
  if (res.status === 200) {
    const out = new Response(res.body, { status: 200, headers: new Headers(res.headers) });
    out.headers.set('ETag', etag);
    await cache.put(key, out.clone());
    out.headers.set('X-Cache', 'MISS');
    return out;
  }
  if (res.status === 404) await cache.put(new Request(missingKey(origin, id)), new Response('', { status: 200, headers: { 'Cache-Control': 'public, max-age=60' } }));
  return res;
}

/** Remove every cached variant of an asset in this data center (other locations expire within 7 days). */
export async function purgeAssetCache(a: Pick<Asset, 'id'>, origin: string) {
  const urls = [mediaKey(origin, a.id, null), missingKey(origin, a.id)];
  for (const w of WIDTHS) for (const f of Object.keys(FORMATS) as Fmt[]) urls.push(mediaKey(origin, a.id, { w, f }));
  await Promise.all(urls.map((u) => caches.default.delete(new Request(u))));
}

export const loadAsset = (id: string | undefined) => (id ? getAsset(id) : Promise.resolve(null));
