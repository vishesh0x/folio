/**
 * Remove personal metadata (GPS position, camera serial number, owner name, edit history, comments) from an uploaded image, WITHOUT
 * re-encoding it (so the picture is bit-for-bit the same quality). Phone photos carry the exact location they were taken at, and the
 * site serves the original file to anyone who has its address, so it must not be in there.
 *
 * Kept on purpose: the picture data, colour profiles (the image looks wrong without them), animation data, and the ORIENTATION flag
 * (a portrait phone photo is stored sideways plus a note "rotate me"; without the note it would show sideways). Everything else goes.
 * If a file cannot be understood it is returned unchanged rather than damaged (it was already accepted as an image by sniffBinary).
 * Not handled (stored as uploaded): AVIF, GIF comments, PDF document properties.
 */
const u16 = (b: Uint8Array, i: number, le: boolean) => (le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
const u32 = (b: Uint8Array, i: number, le: boolean) => (le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
const concat = (parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

/** Read the Orientation (1..8) from a TIFF structure (the inside of an EXIF block), or null. */
export function exifOrientation(tiff: Uint8Array): number | null {
  if (tiff.length < 14) return null;
  const le = ascii(tiff, 0, 2) === 'II'; if (!le && ascii(tiff, 0, 2) !== 'MM') return null;
  if (u16(tiff, 2, le) !== 42) return null;
  const ifd = u32(tiff, 4, le); if (ifd + 2 > tiff.length) return null;
  const n = u16(tiff, ifd, le);
  for (let k = 0; k < n && ifd + 2 + k * 12 + 12 <= tiff.length; k++) {
    const e = ifd + 2 + k * 12;
    if (u16(tiff, e, le) === 0x0112 && u16(tiff, e + 2, le) === 3 && u32(tiff, e + 4, le) === 1) { const v = u16(tiff, e + 8, le); return v >= 1 && v <= 8 ? v : null; }
  }
  return null;
}
/** A brand-new, minimal TIFF structure holding nothing but the orientation. */
const orientationTiff = (o: number) => new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, o, 0, 0, 0, 0, 0, 0, 0]);

function stripJpeg(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [b.slice(0, 2)]; let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return b;                                   // not a marker where one must be: leave the file alone
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }                             // fill byte
    if (m === 0xda) { out.push(b.slice(i)); return concat(out); }  // start of the picture data: the rest is copied as it is
    if (m === 0xd9) { out.push(b.slice(i)); return concat(out); }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { out.push(b.slice(i, i + 2)); i += 2; continue; }
    const len = u16(b, i + 2, false); if (len < 2 || i + 2 + len > b.length) return b;
    const seg = b.slice(i, i + 2 + len), body = seg.slice(4);
    let keep = true;
    if (m === 0xe1) {                                              // APP1: EXIF (location, camera, dates...) or XMP
      keep = false;
      if (ascii(body, 0, 6) === 'Exif\0\0') {
        const o = exifOrientation(body.slice(6));
        if (o && o !== 1) { const tiff = orientationTiff(o), payload = concat([new TextEncoder().encode('Exif\0\0'), tiff]); const l = payload.length + 2; out.push(concat([new Uint8Array([0xff, 0xe1, l >> 8, l & 255]), payload])); }
      }
    } else if (m === 0xe2) keep = ascii(body, 0, 12) === 'ICC_PROFILE\0'; // colour profile: keep; MPF and the like: drop
    else if (m === 0xee) keep = ascii(body, 0, 5) === 'Adobe';       // Adobe colour-transform flag: needed to decode some files
    else if (m === 0xe0) keep = true;                                // JFIF header
    else if ((m >= 0xe3 && m <= 0xef) || m === 0xfe) keep = false;   // other application blocks (Photoshop...) and comments
    if (keep) out.push(seg);
    i += 2 + len;
  }
  return concat(out);
}

const PNG_DROP = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);
function stripPng(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [b.slice(0, 8)]; let i = 8;
  while (i + 12 <= b.length) {
    const len = u32(b, i, false), type = ascii(b, i + 4, 4), end = i + 12 + len;
    if (end > b.length) return b;
    if (!PNG_DROP.has(type)) out.push(b.slice(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return concat(out);
}

function stripWebp(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = []; let i = 12; let orientation: number | null = null; let sawVp8x = -1; let pos = 0;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4), len = u32(b, i + 4, true), end = i + 8 + len + (len & 1);
    if (end > b.length + 1) return b;
    if (type === 'EXIF') { orientation = exifOrientation(b.slice(i + 8, i + 8 + len)); if (orientation === null && len > 6) orientation = exifOrientation(b.slice(i + 8 + 6, i + 8 + len)); }
    else if (type !== 'XMP ') { if (type === 'VP8X') sawVp8x = pos; const chunk = b.slice(i, Math.min(end, b.length)); out.push(chunk); pos += chunk.length; }
    i = end;
  }
  if (sawVp8x < 0) return b;                                       // simple WebP (no extended header): nothing to strip
  let body = concat(out);
  if (orientation && orientation !== 1) { const t = orientationTiff(orientation); body = concat([body, new Uint8Array([0x45, 0x58, 0x49, 0x46, t.length, 0, 0, 0]), t]); }
  body[sawVp8x + 8] = (body[sawVp8x + 8] & ~0x0c) | (orientation && orientation !== 1 ? 0x08 : 0); // flags: clear "has XMP" and "has EXIF" (set EXIF again only if kept)
  const riff = new Uint8Array(12); riff.set(b.slice(0, 12));
  const size = 4 + body.length; riff[4] = size & 255; riff[5] = (size >> 8) & 255; riff[6] = (size >> 16) & 255; riff[7] = (size >>> 24) & 255;
  return concat([riff, body]);
}

export function stripMetadata(bytes: Uint8Array, mime: string): Uint8Array {
  try {
    if (mime === 'image/jpeg') return stripJpeg(bytes);
    if (mime === 'image/png') return stripPng(bytes);
    if (mime === 'image/webp') return stripWebp(bytes);
  } catch { /* fall through: keep the file as uploaded */ }
  return bytes;
}
