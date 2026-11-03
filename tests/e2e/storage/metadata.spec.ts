import { test, expect, withRetry } from '../fixtures';
import { readFileSync } from 'node:fs';
import { AUTH_FILE, header } from '../helpers';
import { upload, removeAsset } from '../uploads';
import { exifOrientation, stripMetadata, hasAvifMetadata, cleanAvif, cleanPdf } from '../../../src/lib/strip';

// A phone photo carries the exact place it was taken, the camera's serial number and more, and the
// site serves the ORIGINAL file to anyone who has its address (it is visible in the page source). That
// personal data must not be in the stored file.
test.use({ storageState: AUTH_FILE });
const SECRETS = ['SecretCamera', 'SERIAL-1234', 'SecretEditing', 'SECRET-COMMENT', 'SECRET-XMP', 'SECRET-PERSON', 'SECRET-ITXT', '2024:06:01', 'xmpmeta'];
const CASES: [string, string, string][] = [['photo-gps.jpg', 'image/jpeg', 'jpg'], ['photo-gps-noorient.jpg', 'image/jpeg', 'jpg'], ['photo-meta.png', 'image/png', 'png'], ['photo-meta.webp', 'image/webp', 'webp']];

for (const [file, mime, ext] of CASES) {
  test(`${file}: the stored and served original has no location, camera or comments`, async ({ playwright, baseURL }) => {
    const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE })), visitor = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
    const original = readFileSync(`tests/fixtures/${file}`);
    const marks = file.includes('noorient') ? ['Exif'] : SECRETS;  // The GPS-only photo has numbers, not text: the EXIF block itself is the marker
    expect(marks.filter((s) => original.toString('latin1').includes(s)).length, 'the fixture should contain personal data').toBeGreaterThan(0);
    const up = await upload(a, baseURL!, file, mime, original, 'A photo');
    expect(up.status, JSON.stringify(up.json)).toBe(200);
    const asset = up.json.asset;
    const served = await visitor.get(asset.url);  // Exactly what anyone who knows the address receives
    expect(served.status()).toBe(200); expect(header(served, 'content-type')).toBe(mime);
    const body = await served.body();
    expect(marks.filter((s) => body.toString('latin1').includes(s)), 'personal data still present in the served file').toEqual([]);
    expect(body.length, 'the recorded size is the size of what is stored').toBe(asset.size);
    expect(body.length).toBeLessThan(original.length);
    // Still a working picture: the resizer can read it, and its recorded dimensions are right.
    const small = await visitor.get(`${asset.url}?w=160&f=webp`);
    expect(small.status()).toBe(200); expect(header(small, 'content-type')).toBe('image/webp');
    expect([asset.width, asset.height]).toEqual(file.includes('gps') ? [64, 48] : file.endsWith('.png') ? [40, 40] : [48, 48]);
    await removeAsset(a, baseURL!, asset.id); await a.dispose(); await visitor.dispose();
  });
}

test('a portrait phone photo still says "rotate me" after the clean-up (otherwise it would show sideways), and says nothing else', async ({ playwright, baseURL }) => {
  const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE })), visitor = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
  const up = await upload(a, baseURL!, 'portrait.jpg', 'image/jpeg', readFileSync('tests/fixtures/photo-gps.jpg'), 'A portrait');
  const body = await (await visitor.get(up.json.asset.url)).body(), s = body.toString('latin1'), at = s.indexOf('Exif\0\0');
  expect(at).toBeGreaterThan(0);
  expect(exifOrientation(new Uint8Array(Buffer.from(s.slice(at + 6), 'latin1')))).toBe(6);
  expect(s).not.toMatch(/GPS|Secret|SERIAL/);
  await removeAsset(a, baseURL!, up.json.asset.id); await a.dispose(); await visitor.dispose();
});

test('a file with no personal data is stored exactly as uploaded', async ({ playwright, baseURL }) => {
  const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE })), visitor = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
  const original = readFileSync('tests/fixtures/plain.png');
  const up = await upload(a, baseURL!, 'plain.png', 'image/png', original, 'Plain');
  expect(Buffer.from(await (await visitor.get(up.json.asset.url)).body()).equals(original)).toBe(true);
  await removeAsset(a, baseURL!, up.json.asset.id); await a.dispose(); await visitor.dispose();
});

// GIF comments and XMP are removed; the animation block, timing and picture survive. An AVIF with
// EXIF/XMP is detected (the upload is then refused).
test('GIF: comments and XMP are removed, animation and picture data are kept', () => {
  const ascii = (s: string) => [...Buffer.from(s, 'latin1')];
  const head = [...ascii('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255];
  const comment = [0x21, 0xfe, 5, ...ascii('SECRET'), 0];
  const xmp = [0x21, 0xff, 11, ...ascii('XMP DataXMP'), 3, 1, 2, 3, 0];
  const loop = [0x21, 0xff, 11, ...ascii('NETSCAPE2.0'), 3, 1, 0, 0, 0];
  const gce = [0x21, 0xf9, 4, 0, 0, 0, 0, 0];
  const image = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0];
  const gif = new Uint8Array([...head, ...comment, ...xmp, ...loop, ...gce, ...image, 0x3b]);
  const out = Buffer.from(stripMetadata(gif, 'image/gif'));
  expect(out.toString('latin1')).not.toContain('SECRET');
  expect(out.toString('latin1')).not.toContain('XMP Data');
  expect(out.toString('latin1')).toContain('NETSCAPE2.0');
  expect([...out.subarray(-1)]).toEqual([0x3b]);
  const broken = new Uint8Array([...head, 0x99]);
  expect(stripMetadata(broken, 'image/gif')).toBe(broken);  // Not understood: returned unchanged, never damaged
});

test('AVIF: EXIF and XMP items are detected inside the meta box; a plain one and an unreadable one are told apart', () => {
  const box = (type: string, body: Buffer) => { const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]); };
  const ftyp = box('ftyp', Buffer.from('avif\0\0\0\0avifmif1', 'latin1'));
  const plain = new Uint8Array(Buffer.concat([ftyp, box('meta', Buffer.from('\0\0\0\0hdlrpict', 'latin1')), box('mdat', Buffer.from('Exif in the picture data is not metadata', 'latin1'))]));
  const withExif = new Uint8Array(Buffer.concat([ftyp, box('meta', Buffer.from('\0\0\0\0infe....Exif', 'latin1')), box('mdat', Buffer.alloc(4))]));
  const withXmp = new Uint8Array(Buffer.concat([ftyp, box('meta', Buffer.from('\0\0\0\0infemimeapplication/rdf+xml', 'latin1'))]));
  expect(hasAvifMetadata(plain)).toBe(false);
  expect(hasAvifMetadata(withExif)).toBe(true);
  expect(hasAvifMetadata(withXmp)).toBe(true);
  expect(hasAvifMetadata(new Uint8Array(Buffer.concat([ftyp, Buffer.from([0, 0, 1, 0, 0x6d, 0x65, 0x74, 0x61])])))).toBe(true);  // A box that claims more bytes than exist
});

test('AVIF: EXIF and XMP are zeroed in place (same size, same layout); a clean file is returned untouched', () => {
  const original = new Uint8Array(readFileSync('tests/fixtures/photo-meta.avif'));
  expect(Buffer.from(original).includes('SecretCam')).toBe(true);
  expect(Buffer.from(original).includes('Jane Secret')).toBe(true);
  const out = cleanAvif(original)!;
  expect(out).not.toBeNull();
  expect(out.length).toBe(original.length);
  expect(Buffer.from(out).includes('SecretCam')).toBe(false);
  expect(Buffer.from(out).includes('Jane Secret')).toBe(false);
  expect(Buffer.from(out).includes('Exif')).toBe(false);
  expect(hasAvifMetadata(out)).toBe(false);
  expect(cleanAvif(out)).toBe(out);  // Second run: nothing to do
  expect(stripMetadata(original, 'image/avif')).toEqual(out);
  const damaged = original.slice(0, original.length - 300);  // Boxes no longer add up: refused, never half-cleaned
  expect(cleanAvif(damaged)).toBeNull();
});

test('PDF: document properties are blanked in place; the file keeps its size and header', () => {
  const original = new Uint8Array(readFileSync('tests/fixtures/doc-meta.pdf'));
  const has = (b: Uint8Array, t: string) => Buffer.from(b).includes(t);
  expect(has(original, 'Jane Secret') && has(original, 'Private Title')).toBe(true);
  const out = cleanPdf(original);
  expect(out.length).toBe(original.length);
  expect(has(out, 'Jane Secret') || has(out, 'Private Title')).toBe(false);
  expect(Buffer.from(out.subarray(0, 5)).toString()).toBe('%PDF-');
  expect(cleanPdf(out)).toBeTruthy();
  const encrypted = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Author (x) >>\nendobj\ntrailer << /Info 1 0 R /Encrypt 2 0 R >>');
  expect(cleanPdf(encrypted)).toBe(encrypted);  // Encrypted: left alone
});
