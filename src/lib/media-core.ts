/**
 * Pure helpers for the media pipeline (no Workers APIs → unit-testable).
 */

export type AllowedType = {
  mime: string;
  ext: string;
  /** Raster formats the Cloudflare Images binding can resize/convert. */
  transformable: boolean;
};

const T = {
  png: { mime: "image/png", ext: "png", transformable: true },
  jpeg: { mime: "image/jpeg", ext: "jpg", transformable: true },
  webp: { mime: "image/webp", ext: "webp", transformable: true },
  avif: { mime: "image/avif", ext: "avif", transformable: true },
  gif: { mime: "image/gif", ext: "gif", transformable: false },
  ico: { mime: "image/x-icon", ext: "ico", transformable: false },
  pdf: { mime: "application/pdf", ext: "pdf", transformable: false },
  /** Text format: detected + validated by `lib/svg-safety.ts`, never by magic bytes. */
  svg: { mime: "image/svg+xml", ext: "svg", transformable: false },
} satisfies Record<string, AllowedType>;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const SVG_TYPE: AllowedType = T.svg;

const ascii = (b: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...b.slice(start, start + len));

/**
 * Identify a file from its magic bytes. The client-supplied Content-Type and
 * file extension are never trusted. SVG is text, so it is NOT detected here:
 * the upload handler runs `looksLikeSvg` + the strict allowlist in `svg-safety.ts`
 * and then uses `SVG_TYPE`.
 */
export function sniffFileType(b: Uint8Array): AllowedType | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return T.png;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return T.jpeg;
  if (ascii(b, 0, 4) === "GIF8") return T.gif;
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return T.webp;
  if (ascii(b, 4, 4) === "ftyp" && ["avif", "avis"].includes(ascii(b, 8, 4))) return T.avif;
  if (ascii(b, 0, 5) === "%PDF-") return T.pdf;
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return T.ico;
  return null;
}

/** Output formats for responsive variants, best first. */
export type OutputFormat = "image/avif" | "image/webp" | "image/jpeg" | "image/png";

/**
 * Content negotiation: AVIF → WebP → original (JPEG/PNG).
 * PNGs with transparency stay lossless-capable because WebP/AVIF support alpha.
 */
export function pickOutputFormat(accept: string | null, sourceMime: string): OutputFormat {
  const a = (accept ?? "").toLowerCase();
  if (a.includes("image/avif")) return "image/avif";
  if (a.includes("image/webp")) return "image/webp";
  return sourceMime === "image/png" ? "image/png" : "image/jpeg";
}

/** R2 keys we generate only ever contain these characters. */
export const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,199}$/;
export const isValidKey = (key: string) => KEY_PATTERN.test(key) && !key.includes("..");

export function sanitizeBaseName(name: string): string {
  const base = name.replace(/\.[a-z0-9]{1,5}$/i, "");
  const slug = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "file";
}

/** `<time36>-<random>-<name>.<ext>` — unique, so objects are immutable and cacheable forever. */
export function buildKey(originalName: string, ext: string, random: string): string {
  return `${Date.now().toString(36)}-${random.toLowerCase().replace(/[^a-z0-9]/g, "")}-${sanitizeBaseName(originalName)}.${ext}`;
}
