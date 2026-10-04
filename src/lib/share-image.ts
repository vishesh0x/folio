import { mediaUrl } from "./images";
import { absoluteUrl, isSvgUrl, mediaKeyFromUrl } from "./url";

/** Social crawlers need an absolute URL, and prefer JPEG/PNG (our /media negotiates by Accept). */
export function shareImage(url: string | null | undefined, origin: string): string | undefined {
  // Facebook/X/LinkedIn/Slack don't render SVG previews → fall through to the next candidate.
  if (isSvgUrl(url)) return undefined;
  const key = mediaKeyFromUrl(url);
  return absoluteUrl(key ? mediaUrl(key, { w: 1280 }) : url, origin);
}
