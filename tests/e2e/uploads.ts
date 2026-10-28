import { crc32 } from 'node:zlib';
import type { APIRequestContext } from '@playwright/test';
import { sameOrigin } from './helpers';

/** Upload through the same endpoint the editors use. */
export async function upload(admin: APIRequestContext, baseURL: string, name: string, mime: string, buffer: Buffer, alt: string | null = 'A test picture', extra: Record<string, string> = {}) {
  const r = await admin.post('/api/admin/assets/upload', { multipart: { file: { name, mimeType: mime, buffer }, ...(alt === null ? {} : { alt }), ...extra }, headers: sameOrigin(baseURL), maxRedirects: 0 });
  return { status: r.status(), json: (await r.json()) as any };
}
export const removeAsset = (admin: APIRequestContext, baseURL: string, id: string) => admin.post('/api/admin/assets/delete', { form: { id }, headers: sameOrigin(baseURL), maxRedirects: 0 });

// ── building files byte by byte, to test what the site does with files that are not what they claim to be
export const pngChunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A PNG whose header CLAIMS this size (the pixel data is not real: the site must judge by the claim before anything is decoded). */
export const pngClaiming = (w: number, h: number, extraChunks: Buffer[] = []) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([SIG, pngChunk('IHDR', ihdr), ...extraChunks, pngChunk('IDAT', Buffer.from([0x78, 0x9c, 3, 0, 0, 0, 0, 1])), pngChunk('IEND', Buffer.alloc(0))]);
};
/** A JPEG skeleton: start, optional frame header claiming w x h, end. */
export const jpegClaiming = (w: number | null, h = w) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), ...(w === null ? [] : [Buffer.from([0xff, 0xc0, 0, 11, 8, h! >> 8, h! & 255, w >> 8, w & 255, 1, 1, 0x11, 0])]), Buffer.from([0xff, 0xd9])]);
export const gif = (w = 1, h = 1) => Buffer.from(['GIF89a', String.fromCharCode(w & 255, w >> 8, h & 255, h >> 8), '\x80\x00\x00\x00\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00;'].join(''), 'latin1');
/** A PNG with a real header whose picture-data chunk is `payload` (to make big files that survive the clean-up, which drops anything after the end marker). */
export const pngWithPayload = (payload: Buffer) => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(100, 0); ihdr.writeUInt32BE(100, 4); ihdr[8] = 8; ihdr[9] = 2; return Buffer.concat([SIG, pngChunk('IHDR', ihdr), pngChunk('IDAT', payload), pngChunk('IEND', Buffer.alloc(0))]); };
export const pdf = (pad = 0) => Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'), Buffer.alloc(pad, 0x20)]);
export const svg = (inner: string, attrs = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50"') => Buffer.from(`<svg ${attrs}>${inner}</svg>`);
