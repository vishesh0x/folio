import { mediaKeyFromUrl } from "./url";

/** Widths the image pipeline is allowed to produce (bounds cache/transform cost). */
export const IMAGE_WIDTHS = [160, 320, 480, 640, 768, 960, 1280, 1600, 2000] as const;
export const DEFAULT_QUALITY = 80;

/** Snap an arbitrary requested width to the nearest allowed width (rounding up). */
export function snapWidth(w: number): number {
  const target = Number.isFinite(w) ? w : 0;
  return IMAGE_WIDTHS.find((x) => x >= target) ?? IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]!;
}

export const mediaUrl = (key: string, params?: { w?: number }) =>
  `/media/${encodeURIComponent(key)}${params?.w ? `?w=${params.w}` : ""}`;

/**
 * Build `src` + `srcset` for an image URL.
 * Uploaded assets (`/media/<key>`) get responsive, auto-format variants served
 * by the Worker through the Cloudflare Images binding. External URLs are
 * passed through untouched.
 */
export function responsiveImage(
  url: string,
  opts: { width?: number; maxWidth?: number } = {},
): { src: string; srcSet?: string } {
  const key = mediaKeyFromUrl(url);
  if (!key) return { src: url };
  const max = opts.maxWidth ?? opts.width ?? 1280;
  const widths = IMAGE_WIDTHS.filter((w) => w <= snapWidth(max));
  const src = mediaUrl(key, { w: snapWidth(opts.width ?? max) });
  const srcSet = widths.map((w) => `${mediaUrl(key, { w })} ${w}w`).join(", ");
  return { src, srcSet };
}
