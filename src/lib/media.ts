import { env } from 'cloudflare:workers';
import { getAsset, type Asset } from './assets';

export const WIDTHS = [160, 320, 480, 640, 800, 1024, 1280, 1600, 2000];
export const FORMATS = { avif: 'image/avif', webp: 'image/webp', jpeg: 'image/jpeg', png: 'image/png' } as const;
export type Fmt = keyof typeof FORMATS;
const RESIZABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
// 7 days, not "forever": a deleted file stops being served everywhere within a week.
const FOREVER = 'public, max-age=604800';

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
  if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': FOREVER } });
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

/** Edge cache wrapper. Keyed by full URL, so each width/format is cached separately. */
export async function cached(request: Request, make: () => Promise<Response>): Promise<Response> {
  const cache = caches.default;
  const key = new Request(request.url, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await make();
  if (res.status === 200) await cache.put(key, res.clone());
  return res;
}

/** Remove every cached variant of an asset in this data center (other locations expire within 7 days). */
export async function purgeAssetCache(a: Pick<Asset, 'id' | 'filename'>, origin: string) {
  const base = `${origin}/media/${a.id}/${encodeURIComponent(a.filename)}`;
  const urls = [base];
  for (const w of WIDTHS) for (const f of Object.keys(FORMATS)) urls.push(`${base}?w=${w}&f=${f}`);
  await Promise.all(urls.map((u) => caches.default.delete(new Request(u))));
}

export const loadAsset = (id: string | undefined) => (id ? getAsset(id) : Promise.resolve(null));
