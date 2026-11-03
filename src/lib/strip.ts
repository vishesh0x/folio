/**
 * Remove personal metadata (GPS position, camera serial number, owner name, edit history, comments)
 * from an uploaded image, WITHOUT re-encoding it (so the picture is bit-for-bit the same quality).
 * Phone photos carry the exact location they were taken at, and the site serves the original file to
 * anyone who has its address, so it must not be in there.
 *
 * Kept on purpose: the picture data, colour profiles (the image looks wrong without them), animation
 * data, and the ORIENTATION flag (a portrait phone photo is stored sideways plus a note "rotate me";
 * without the note it would show sideways). Everything else goes. If a file cannot be understood it is
 * returned unchanged rather than damaged (it was already accepted as an image by sniffBinary). GIF:
 * comments and non-animation application blocks (such as XMP) are removed. AVIF: EXIF and XMP items
 * are zeroed in place (cleanAvif); an AVIF that cannot be followed exactly is refused at upload. PDF:
 * document properties are blanked in place (cleanPdf). Same-length edits, so nothing shifts.
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
    if (b[i] !== 0xff) return b;  // Not a marker where one must be: leave the file alone
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }  // Fill byte
    if (m === 0xda) { out.push(b.slice(i)); return concat(out); }  // Start of the picture data: the rest is copied as it is
    if (m === 0xd9) { out.push(b.slice(i)); return concat(out); }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { out.push(b.slice(i, i + 2)); i += 2; continue; }
    const len = u16(b, i + 2, false); if (len < 2 || i + 2 + len > b.length) return b;
    const seg = b.slice(i, i + 2 + len), body = seg.slice(4);
    let keep = true;
    if (m === 0xe1) {  // APP1: EXIF (location, camera, dates...) or XMP
      keep = false;
      if (ascii(body, 0, 6) === 'Exif\0\0') {
        const o = exifOrientation(body.slice(6));
        if (o && o !== 1) { const tiff = orientationTiff(o), payload = concat([new TextEncoder().encode('Exif\0\0'), tiff]); const l = payload.length + 2; out.push(concat([new Uint8Array([0xff, 0xe1, l >> 8, l & 255]), payload])); }
      }
    } else if (m === 0xe2) keep = ascii(body, 0, 12) === 'ICC_PROFILE\0';  // Colour profile: keep; MPF and the like: drop
    else if (m === 0xee) keep = ascii(body, 0, 5) === 'Adobe';  // Adobe colour-transform flag: needed to decode some files
    else if (m === 0xe0) keep = true;  // JFIF header
    else if ((m >= 0xe3 && m <= 0xef) || m === 0xfe) keep = false;  // Other application blocks (Photoshop...) and comments
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
  if (sawVp8x < 0) return b;  // Simple WebP (no extended header): nothing to strip
  let body = concat(out);
  if (orientation && orientation !== 1) { const t = orientationTiff(orientation); body = concat([body, new Uint8Array([0x45, 0x58, 0x49, 0x46, t.length, 0, 0, 0]), t]); }
  body[sawVp8x + 8] = (body[sawVp8x + 8] & ~0x0c) | (orientation && orientation !== 1 ? 0x08 : 0);  // Flags: clear "has XMP" and "has EXIF" (set EXIF again only if kept)
  const riff = new Uint8Array(12); riff.set(b.slice(0, 12));
  const size = 4 + body.length; riff[4] = size & 255; riff[5] = (size >> 8) & 255; riff[6] = (size >> 16) & 255; riff[7] = (size >>> 24) & 255;
  return concat([riff, body]);
}

const KEEP_APPS = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0']);  // Animation loop count: needed
function stripGif(b: Uint8Array): Uint8Array {
  if (b.length < 14) return b;
  const flags = b[10]; let i = 13;
  if (flags & 0x80) i += 3 * (2 << (flags & 7));
  if (i >= b.length) return b;
  const out: Uint8Array[] = [b.slice(0, i)];
  const skip = (j: number) => { while (j < b.length) { const n = b[j]; j += 1 + n; if (n === 0) return j; } return -1; };  // Sub-blocks up to the 0 terminator
  while (i < b.length) {
    const t = b[i];
    if (t === 0x3b) { out.push(b.slice(i)); return concat(out); }
    if (t === 0x21) {
      const label = b[i + 1], end = skip(i + 2);
      if (end < 0 || end > b.length) return b;
      const keep = label === 0xf9 || label === 0x01 || (label === 0xff && b[i + 2] === 11 && KEEP_APPS.has(ascii(b, i + 3, 11)));  // Graphic control, plain text, animation
      if (keep) out.push(b.slice(i, end));
      i = end; continue;
    }
    if (t === 0x2c) {
      if (i + 10 > b.length) return b;
      const f = b[i + 9]; let j = i + 10;
      if (f & 0x80) j += 3 * (2 << (f & 7));
      const end = skip(j + 1);
      if (end < 0 || end > b.length) return b;
      out.push(b.slice(i, end)); i = end; continue;
    }
    return b;  // Not a block where one must be: leave the file alone
  }
  return b;  // No trailer: leave the file alone
}

// ───── AVIF ───── EXIF and XMP are stored as "items" listed in the meta box (iinf) whose bytes are
// found through iloc. They are removed IN PLACE: the item's bytes are overwritten with zeros and its
// type is renamed to one no reader knows, so every offset and size in the file stays valid and the
// picture is untouched. A file whose boxes cannot be followed exactly returns null (the upload is then
// refused, never stored half-cleaned).
type Box = { type: string; start: number; hdr: number; end: number };
function boxList(b: Uint8Array, from: number, to: number): Box[] | null {
  const list: Box[] = []; let i = from;
  while (i + 8 <= to) {
    let size = u32(b, i, false), hdr = 8;
    const type = ascii(b, i + 4, 4);
    if (size === 1) { if (i + 16 > to || u32(b, i + 8, false) !== 0) return null; size = u32(b, i + 12, false); hdr = 16; }
    else if (size === 0) size = to - i;
    if (size < hdr || i + size > to) return null;
    list.push({ type, start: i, hdr, end: i + size }); i += size;
  }
  return i === to ? list : null;
}
const uint = (b: Uint8Array, p: number, n: number) => { let v = 0; for (let k = 0; k < n; k++) v = v * 256 + (b[p + k] ?? 0); return v; };
const XMP_UUID = [0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac];
const zero = (b: Uint8Array, from: number, to: number, v = 0) => b.fill(v, from, to);
const put4 = (b: Uint8Array, p: number, t: string) => { for (let k = 0; k < 4; k++) b[p + k] = t.charCodeAt(k); };

/**
 * Zeroes the EXIF and XMP items of an AVIF in place. Returns the file unchanged when it has none,
 * or null when its structure cannot be followed exactly.
 */
export function cleanAvif(b: Uint8Array): Uint8Array | null {
  const top = boxList(b, 0, b.length);
  if (!top) return null;
  const out = new Uint8Array(b); let changed = false;
  for (const bx of top) {
    if (bx.type === 'uuid' && bx.end - bx.start >= bx.hdr + 16 && XMP_UUID.every((v, k) => b[bx.start + bx.hdr + k] === v)) {
      zero(out, bx.start + bx.hdr, bx.end); put4(out, bx.start + 4, 'free'); changed = true;
    }
    if (bx.type !== 'meta') continue;
    const kids = boxList(b, bx.start + bx.hdr + 4, bx.end);  // Meta is a "full box": 4 bytes of version and flags come first
    if (!kids) return null;
    const iinf = kids.find((k) => k.type === 'iinf'), iloc = kids.find((k) => k.type === 'iloc');
    if (!iinf) continue;
    const targets = new Map<number, { typeAt: number; nameAt: number; nameLen: number; ctAt: number; ctLen: number }>();
    { const v = b[iinf.start + iinf.hdr]; const first = iinf.start + iinf.hdr + 4 + (v === 0 ? 2 : 4);
      const infes = boxList(b, first, iinf.end); if (!infes) return null;
      for (const e of infes) {
        if (e.type !== 'infe') continue;
        const ver = b[e.start + e.hdr]; if (ver < 2) continue;  // Versions 0 and 1 carry no item type, so cannot be EXIF or XMP
        let q = e.start + e.hdr + 4; const id = uint(b, q, ver === 2 ? 2 : 4); q += (ver === 2 ? 2 : 4) + 2;
        if (q + 4 > e.end) return null;
        const type = ascii(b, q, 4), typeAt = q; q += 4;
        const nameAt = q; while (q < e.end && b[q] !== 0) q++;
        const nameLen = q - nameAt; q++;  // Item name (often "Exif" or "XMP")
        if (type === 'Exif') targets.set(id, { typeAt, nameAt, nameLen, ctAt: 0, ctLen: 0 });
        else if (type === 'mime') {
          let r = q; while (r < e.end && b[r] !== 0) r++;
          const ct = ascii(b, q, Math.max(0, r - q)).toLowerCase();
          if (ct.includes('rdf+xml') || ct.includes('xmp')) targets.set(id, { typeAt, nameAt, nameLen, ctAt: q, ctLen: r - q });
        }
      } }
    if (!targets.size) continue;
    if (!iloc) return null;
    { const v = b[iloc.start + iloc.hdr]; if (v > 2) return null;
      let p = iloc.start + iloc.hdr + 4;
      const offSize = b[p] >> 4, lenSize = b[p] & 15, baseSize = b[p + 1] >> 4, idxSize = v === 0 ? 0 : b[p + 1] & 15; p += 2;
      if (![0, 4, 8].includes(offSize) || ![0, 4, 8].includes(lenSize) || ![0, 4, 8].includes(baseSize) || ![0, 4, 8].includes(idxSize)) return null;
      const count = uint(b, p, v < 2 ? 2 : 4); p += v < 2 ? 2 : 4;
      for (let n = 0; n < count; n++) {
        if (p + 6 > iloc.end) return null;
        const id = uint(b, p, v < 2 ? 2 : 4); p += v < 2 ? 2 : 4;
        let method = 0; if (v !== 0) { method = uint(b, p, 2) & 15; p += 2; }
        const dref = uint(b, p, 2); p += 2;
        const base = uint(b, p, baseSize); p += baseSize;
        const ext = uint(b, p, 2); p += 2;
        const t = targets.get(id);
        for (let x = 0; x < ext; x++) {
          p += idxSize;
          const off = uint(b, p, offSize); p += offSize;
          const len = uint(b, p, lenSize); p += lenSize;
          if (p > iloc.end) return null;
          if (!t) continue;
          if (method !== 0 || dref !== 0 || len === 0 || base + off + len > b.length) return null;  // Stored somewhere this cleaner does not follow: refuse
          zero(out, base + off, base + off + len);
        }
        if (t) { (t as any).done = true; }
      }
      for (const t of targets.values()) if (!(t as any).done) return null; }
    for (const t of targets.values()) { put4(out, t.typeAt, 'zzzz'); zero(out, t.nameAt, t.nameAt + t.nameLen, 0x78); if (t.ctLen) zero(out, t.ctAt, t.ctAt + t.ctLen, 0x78); changed = true; }
  }
  if (!changed) return b;
  return hasAvifMetadata(out) ? null : out;  // Last check: whatever remains must read as clean
}

/**
 * ───── PDF ───── Document properties (title, author, producer, dates) live in the /Info dictionary
 * and, often, in an XMP packet. Both are blanked IN PLACE with spaces, so no byte offset in the file
 * moves and it stays a valid PDF. Not handled (left as uploaded): encrypted files, and properties kept
 * inside compressed object streams.
 */
function blankStrings(text: string, out: Uint8Array, from: number, to: number) {
  let i = from;
  while (i < to) {
    const c = text[i];
    if (c === '(') {
      let depth = 1, j = i + 1;
      while (j < to && depth > 0) { if (text[j] === '\\') j += 2; else { if (text[j] === '(') depth++; else if (text[j] === ')') depth--; j++; } }
      zero(out, i + 1, Math.max(i + 1, j - 1), 0x20); i = j;
    } else if (c === '<' && text[i + 1] !== '<') {
      const j = text.indexOf('>', i); if (j < 0 || j > to) return;
      zero(out, i + 1, j, 0x20); i = j + 1;
    } else if (c === '<') i += 2;
    else if (c === '%') { while (i < to && text[i] !== '\n' && text[i] !== '\r') i++; }
    else i++;
  }
}
/**
 * Blanks the document properties and XMP packets of a PDF in place. Encrypted files are returned
 * unchanged.
 */
export function cleanPdf(b: Uint8Array): Uint8Array {
  const text = new TextDecoder('latin1').decode(b);  // One character per byte, so positions match the bytes
  if (/\/Encrypt\b/.test(text)) return b;
  const out = new Uint8Array(b); let changed = false;
  for (const m of text.matchAll(/<\?xpacket begin[\s\S]*?<\?xpacket end[^>]*\?>/g)) {
    const s = m.index! + m[0].indexOf('?>') + 2, e = m.index! + m[0].lastIndexOf('<?xpacket end');
    if (e > s) { zero(out, s, e, 0x20); changed = true; }
  }
  const refs = new Set<string>();
  for (const m of text.matchAll(/\/Info\s+(\d+)\s+(\d+)\s+R\b/g)) refs.add(`${m[1]} ${m[2]}`);
  for (const r of refs) {
    const [n, g] = r.split(' ');
    for (const m of text.matchAll(new RegExp(`(?:^|[\\r\\n\\s])${n}\\s+${g}\\s+obj\\b`, 'g'))) {
      const s = m.index! + m[0].length, e = text.indexOf('endobj', s);
      if (e < 0 || text.slice(s, e).includes('stream')) continue;
      blankStrings(text, out, s, e); changed = true;
    }
  }
  return changed ? out : b;
}

/**
 * Does this AVIF carry EXIF or XMP (location, camera, owner)? Reads the top-level boxes and looks
 * inside the "meta" box, where the items are named. A file whose boxes cannot be read is treated as
 * "yes" (refused): it cannot be shown to be clean.
 */
export function hasAvifMetadata(b: Uint8Array): boolean {
  const latin1 = new TextDecoder('latin1');  // (not ascii(): spreading a big slice into arguments can overflow the stack)
  let i = 0;
  while (i + 8 <= b.length) {
    let size = u32(b, i, false), head = 8;
    const type = ascii(b, i + 4, 4);
    if (size === 1) { if (i + 16 > b.length || u32(b, i + 8, false) !== 0) return true; size = u32(b, i + 12, false); head = 16; }
    else if (size === 0) size = b.length - i;
    if (size < head || i + size > b.length) return true;
    if (type === 'meta') {
      const body = latin1.decode(b.subarray(i + head, i + size));
      if (body.includes('Exif') || body.includes('application/rdf+xml') || body.includes('<x:xmpmeta')) return true;
    }
    i += size;
  }
  return false;
}

/**
 * Removes location, camera and author data from a file of the given type. Types without metadata,
 * and files that cannot be parsed, are returned unchanged.
 */
export function stripMetadata(bytes: Uint8Array, mime: string): Uint8Array {
  try {
    if (mime === 'image/jpeg') return stripJpeg(bytes);
    if (mime === 'image/png') return stripPng(bytes);
    if (mime === 'image/webp') return stripWebp(bytes);
    if (mime === 'image/gif') return stripGif(bytes);
    if (mime === 'image/avif') return cleanAvif(bytes) ?? bytes;
    if (mime === 'application/pdf') return cleanPdf(bytes);
  } catch { /* Fall through: keep the file as uploaded */ }
  return bytes;
}
