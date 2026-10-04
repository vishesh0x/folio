import { DEFAULT_QUALITY, IMAGE_WIDTHS, snapIconSize, snapWidth } from "@/lib/images";
import { isValidKey, pickOutputFormat, type OutputFormat } from "@/lib/media-core";
import type { AppEnv } from "./env.server";

const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * GET /media/<key>[?w=<width>]
 *
 *  - no `w`            → the original object from R2 (supports Range + ETag)
 *  - `w` on a raster   → resized + converted (AVIF/WebP/JPEG/PNG by Accept) by
 *                        the Cloudflare Images binding, cached at the edge.
 *  - `w` + `f=png`     → an icon-sized PNG (favicons / app icons): fixed sizes, and always
 *                        PNG so the `<link rel="icon" type="image/png">` we emit is truthful.
 *
 * Keys are unique per upload and never overwritten, so everything is served
 * `immutable`. Deleting an asset removes the R2 object; stale edge copies
 * simply expire from cache.
 */
export async function handleMedia(
  request: Request,
  env: AppEnv,
  ctx: { waitUntil(p: Promise<unknown>): void },
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const url = new URL(request.url);
  let key: string;
  try {
    key = decodeURIComponent(url.pathname.slice("/media/".length));
  } catch {
    return notFound();
  }
  if (!isValidKey(key)) return notFound();

  const wParam = url.searchParams.get("w");
  const requestedWidth = wParam ? Number.parseInt(wParam, 10) : 0;
  const asIcon = url.searchParams.get("f") === "png";

  if (requestedWidth > 0) {
    const transformed = await serveVariant(request, env, ctx, key, requestedWidth, asIcon);
    if (transformed) return transformed;
    // Not transformable (pdf/gif/ico) or Images unavailable → fall through to original.
  }
  return serveOriginal(request, env, key);
}

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });

async function serveOriginal(request: Request, env: AppEnv, key: string): Promise<Response> {
  const obj = await env.MEDIA.get(key, { onlyIf: request.headers, range: request.headers });
  if (!obj) return notFound();

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  headers.set("Cache-Control", IMMUTABLE);
  headers.set("Accept-Ranges", "bytes");
  applyAssetHeaders(headers, obj.httpMetadata?.contentType, key);

  if (!("body" in obj) || obj.body === undefined) {
    // Conditional request satisfied (If-None-Match) → 304.
    return new Response(null, { status: 304, headers });
  }
  const partial = obj.range && "offset" in obj.range && request.headers.has("range");
  if (partial) {
    const r = obj.range as { offset?: number; length?: number };
    const start = r.offset ?? 0;
    const end = start + (r.length ?? obj.size - start) - 1;
    headers.set("Content-Range", `bytes ${start}-${end}/${obj.size}`);
    headers.set("Content-Length", String(end - start + 1));
  } else {
    headers.set("Content-Length", String(obj.size));
  }
  return new Response(request.method === "HEAD" ? null : obj.body, {
    status: partial ? 206 : 200,
    headers,
  });
}

async function serveVariant(
  request: Request,
  env: AppEnv,
  ctx: { waitUntil(p: Promise<unknown>): void },
  key: string,
  requestedWidth: number,
  asIcon = false,
): Promise<Response | null> {
  const width = asIcon
    ? snapIconSize(requestedWidth)
    : snapWidth(Math.min(requestedWidth, IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]!));

  // Cheap metadata check first so PDFs/GIFs skip the transform path entirely.
  const head = await env.MEDIA.head(key);
  if (!head) return notFound();
  const sourceMime = head.httpMetadata?.contentType ?? "";
  if (!/^image\/(png|jpeg|webp|avif)$/.test(sourceMime)) return null;

  const format: OutputFormat = asIcon
    ? "image/png"
    : pickOutputFormat(request.headers.get("accept"), sourceMime);

  // Cache key is independent of the Accept header string; it varies on the
  // *chosen* format, so one entry per (key, width, format).
  const cacheUrl = new URL(request.url);
  // Quality is part of the key so changing DEFAULT_QUALITY doesn't serve stale variants.
  cacheUrl.search = `?w=${width}&f=${format.split("/")[1]}&q=${DEFAULT_QUALITY}`;
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  const cache = (caches as unknown as { default: Cache }).default;

  const hit = await cache.match(cacheKey);
  if (hit) return withVariantHeaders(hit, asIcon, request.method === "HEAD");

  const obj = await env.MEDIA.get(key);
  if (!obj) return notFound();

  try {
    const out = await env.IMAGES.input(obj.body)
      // scale-down never upscales a small source.
      .transform({ width, fit: "scale-down" })
      .output({ format, quality: DEFAULT_QUALITY });
    const response = out.response();
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", IMMUTABLE);
    headers.set("Content-Type", out.contentType());
    const cacheable = new Response(response.body, { status: 200, headers });
    ctx.waitUntil(cache.put(cacheKey, cacheable.clone()));
    return withVariantHeaders(cacheable, asIcon, request.method === "HEAD");
  } catch (err) {
    // Images binding unavailable / failed → serve the original instead of a broken image.
    console.error("image transform failed", key, err);
    return null;
  }
}

function withVariantHeaders(res: Response, fixedFormat: boolean, head: boolean): Response {
  const headers = new Headers(res.headers);
  // Icon variants are always PNG, so they must not fragment caches by Accept.
  if (fixedFormat) headers.delete("Vary");
  else headers.set("Vary", "Accept");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  return new Response(head ? null : res.body, { status: res.status, headers });
}

function applyAssetHeaders(headers: Headers, contentType: string | undefined, key: string) {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("Content-Disposition", `inline; filename="${key.replace(/[^a-z0-9._-]/g, "")}"`);
  // Defence in depth: even if a hostile file slipped through, it can't run script.
  if (contentType !== "application/pdf") {
    headers.set(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  }
}
