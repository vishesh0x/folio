// Identify uploads by their first bytes, never by the browser-supplied type.
export type Sniffed = { mime: string; ext: string; width: number | null; height: number | null };
const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));

export function sniffBinary(b: Uint8Array): Sniffed | null {
  if (b.length < 16) return null;
  if (u32be(b, 0) === 0x89504e47 && u32be(b, 4) === 0x0d0a1a0a && ascii(b, 12, 4) === 'IHDR') return { mime: 'image/png', ext: 'png', width: u32be(b, 16), height: u32be(b, 20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { mime: 'image/jpeg', ext: 'jpg', height: u16be(b, i + 5), width: u16be(b, i + 7) };
      i += 2 + u16be(b, i + 2);
    }
    return { mime: 'image/jpeg', ext: 'jpg', width: null, height: null };
  }
  if (/^GIF8[79]a$/.test(ascii(b, 0, 6))) return { mime: 'image/gif', ext: 'gif', width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const k = ascii(b, 12, 4);
    if (k === 'VP8 ') return { mime: 'image/webp', ext: 'webp', width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
    if (k === 'VP8L') return { mime: 'image/webp', ext: 'webp', width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0xf) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
    if (k === 'VP8X') return { mime: 'image/webp', ext: 'webp', width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    return { mime: 'image/webp', ext: 'webp', width: null, height: null };
  }
  if (ascii(b, 4, 4) === 'ftyp' && /avif|avis/.test(ascii(b, 8, 8))) {
    const s = ascii(b, 0, Math.min(b.length, 4096)); const at = s.indexOf('ispe');
    return { mime: 'image/avif', ext: 'avif', width: at > 0 ? u32be(b, at + 8) : null, height: at > 0 ? u32be(b, at + 12) : null };
  }
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return { mime: 'image/x-icon', ext: 'ico', width: b[6] || 256, height: b[7] || 256 };
  if (ascii(b, 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf', width: null, height: null };
  return null;
}
