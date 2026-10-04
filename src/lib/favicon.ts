import { iconUrl, mediaUrl } from "./images";
import { mediaKeyFromUrl, safeImageSrc } from "./url";

/**
 * Favicon / app-icon links.
 *
 * Why this exists: the old code emitted the uploaded file as a bare `<link rel="icon">` **and**
 * still emitted the built-in `/favicon.ico`, so browsers could pick either one. It also served
 * the original upload, which may be several MB. Now:
 *  - an uploaded raster icon is served as small PNGs (32 / 192 px) + a 180 px apple-touch-icon,
 *  - the built-in icons are only used when nothing has been uploaded,
 *  - every link carries a truthful `type`.
 */
export type IconLink = {
  rel: "icon" | "apple-touch-icon";
  href: string;
  type?: string;
  sizes?: string;
};
export type ManifestIcon = { src: string; sizes: string; type: string };

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};
/** Formats the Images binding can resize (see `transformable` in media-core). */
const RESIZABLE = new Set(["png", "jpg", "jpeg", "webp", "avif"]);

export const DEFAULT_ICON_LINKS: IconLink[] = [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
];
export const DEFAULT_MANIFEST_ICONS: ManifestIcon[] = [
  { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
  { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
  { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
];

const extOf = (s: string) => (s.split(/[?#]/)[0] ?? "").split(".").pop()?.toLowerCase() ?? "";

function resizableKey(favicon: string | null | undefined): string | undefined {
  const src = safeImageSrc(favicon);
  const key = mediaKeyFromUrl(src);
  return key && RESIZABLE.has(extOf(key)) ? key : undefined;
}

export function iconLinks(favicon: string | null | undefined): IconLink[] {
  const src = safeImageSrc(favicon);
  if (!src) return DEFAULT_ICON_LINKS;
  const key = resizableKey(src);
  const svgKey = mediaKeyFromUrl(src);
  if (svgKey && extOf(svgKey) === "svg") {
    // Vector icon: every current browser accepts it. (iOS home-screen icons must be PNG, so no
    // apple-touch-icon is emitted rather than showing a stale, wrong default.)
    return [{ rel: "icon", href: mediaUrl(svgKey), type: "image/svg+xml", sizes: "any" }];
  }
  if (key) {
    return [
      { rel: "icon", href: iconUrl(key, 32), type: "image/png", sizes: "32x32" },
      { rel: "icon", href: iconUrl(key, 192), type: "image/png", sizes: "192x192" },
      { rel: "apple-touch-icon", href: iconUrl(key, 180), sizes: "180x180" },
    ];
  }
  // .ico / .gif uploads and external https URLs are used as-is.
  const type = MIME[extOf(src)];
  return [{ rel: "icon", href: src, ...(type ? { type } : {}) }];
}

export function manifestIcons(favicon: string | null | undefined): ManifestIcon[] {
  const svgKey = mediaKeyFromUrl(safeImageSrc(favicon));
  if (svgKey && extOf(svgKey) === "svg") {
    return [{ src: mediaUrl(svgKey), sizes: "any", type: "image/svg+xml" }];
  }
  const key = resizableKey(favicon);
  if (!key) return DEFAULT_MANIFEST_ICONS;
  return [
    { src: iconUrl(key, 192), sizes: "192x192", type: "image/png" },
    { src: iconUrl(key, 512), sizes: "512x512", type: "image/png" },
  ];
}
