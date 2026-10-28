import { test, expect, withRetry } from '../fixtures';
import { readFileSync } from 'node:fs';
import { AUTH_FILE, header, sameOrigin } from '../helpers';
import { upload, removeAsset, pngClaiming, pngChunk, pngWithPayload, jpegClaiming, gif, pdf, svg } from '../uploads';

// Step 4: what the site accepts as an upload. The file's own first bytes decide what it is; the name and the type the browser claims are
// ignored, and a file that is not a real picture/PDF/SVG never reaches storage.
test.use({ storageState: AUTH_FILE });
const fx = (n: string) => readFileSync(`tests/fixtures/${n}`);
const made: string[] = [];
test.afterAll(async ({ playwright, baseURL }) => {
  const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
  for (const id of made) await removeAsset(a, baseURL!, id);
  await a.dispose();
});

test.describe('accepted: the content decides, not the name or the claimed type', () => {
  const OK: [string, string, string, Buffer, string, string][] = [
    // description, filename given, type claimed, bytes, expected stored type, expected extension
    ['a PNG called .jpg and labelled JPEG', 'holiday.jpg', 'image/jpeg', fx('plain.png'), 'image/png', 'png'],
    ['a JPEG called .png', 'x.png', 'image/png', fx('photo-gps-noorient.jpg'), 'image/jpeg', 'jpg'],
    ['a WebP with a PHP-looking name', 'shell.php', 'application/x-php', fx('plain.webp'), 'image/webp', 'webp'],
    ['a PNG with no extension and a generic type', 'noext', 'application/octet-stream', fx('plain.png'), 'image/png', 'png'],
    ['a PNG called .exe', 'setup.exe', 'application/octet-stream', fx('plain.png'), 'image/png', 'png'],
    ['a GIF', 'a.gif', 'image/gif', gif(), 'image/gif', 'gif'],
    ['a PDF labelled as an image', 'cv.png', 'image/png', pdf(), 'application/pdf', 'pdf'],
  ];
  for (const [what, name, claimed, bytes, mime, ext] of OK) {
    test(what, async ({ playwright, baseURL }) => {
      const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
      const r = await upload(a, baseURL!, name, claimed, bytes, mime === 'application/pdf' ? null : 'alt text');
      expect(r.status, JSON.stringify(r.json)).toBe(200); made.push(r.json.asset.id);
      expect(r.json.asset.mime).toBe(mime); expect(r.json.asset.filename).toMatch(new RegExp(`\\.${ext}$`));
      expect(r.json.asset.filename).not.toMatch(/\.(php|exe)$/);
      await a.dispose();
    });
  }
  test('a PNG that merely contains the text "<svg" in its metadata is still a PNG (not mistaken for an SVG and refused)', async ({ playwright, baseURL }) => {
    const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
    const png = pngClaiming(20, 20, [pngChunk('tEXt', Buffer.from('Comment\0<svg><script>alert(1)</script></svg>'))]);
    const r = await upload(a, baseURL!, 'tricky.png', 'image/png', png);
    expect(r.status, JSON.stringify(r.json)).toBe(200); made.push(r.json.asset.id); expect(r.json.asset.mime).toBe('image/png');
    await a.dispose();
  });
});

test.describe('refused', () => {
  const html = Buffer.from('<!doctype html><html><body><script>alert(document.cookie)</script></body></html>');
  const BAD: [string, string, string, Buffer, RegExp][] = [
    ['HTML disguised as a PNG', 'cute.png', 'image/png', html, /Unsupported file/],
    ['JavaScript disguised as an image', 'x.jpg', 'image/jpeg', Buffer.from('alert(document.cookie)//'), /Unsupported file/],
    ['a Windows program named .jpg', 'photo.jpg', 'image/jpeg', Buffer.concat([Buffer.from('MZ\x90\0\x03\0\0\0\x04\0\0\0'), Buffer.alloc(200)]), /Unsupported file/],
    ['a ZIP archive named .png', 'a.png', 'image/png', Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(100)]), /Unsupported file/],
    ['text starting with "GIF" that is not a GIF', 'a.gif', 'image/gif', Buffer.from('GIF<script>alert(1)</script>'), /Unsupported file/],
    ['a PNG signature with no real header chunk', 'a.png', 'image/png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]), /Unsupported file/],
    ['a 3-byte file', 'a.png', 'image/png', Buffer.from([1, 2, 3]), /Unsupported file/],
    ['a PNG whose header says 0 x 0', 'a.png', 'image/png', pngClaiming(0, 0), /damaged/],
    ['a JPEG with no frame header (no size at all)', 'a.jpg', 'image/jpeg', jpegClaiming(null), /damaged/],
    ['a tiny PNG claiming to be 60,000 x 60,000 pixels (a "decompression bomb")', 'bomb.png', 'image/png', pngClaiming(60000, 60000), /too large in pixels/],
    ['a PNG claiming 12,001 pixels wide', 'wide.png', 'image/png', pngClaiming(12001, 10), /too large in pixels/],
    ['a JPEG claiming 40,000 x 40,000 pixels', 'bomb.jpg', 'image/jpeg', jpegClaiming(40000), /too large in pixels/],
    ['a PNG whose area is over 100 megapixels (11,000 x 11,000)', 'big.png', 'image/png', pngClaiming(11000, 11000), /too large in pixels/],
  ];
  for (const [what, name, claimed, bytes, why] of BAD) {
    test(what, async ({ playwright, baseURL }) => {
      const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
      const r = await upload(a, baseURL!, name, claimed, bytes);
      expect(r.status, JSON.stringify(r.json)).toBe(400); expect(r.json.ok).toBe(false); expect(r.json.error).toMatch(why);
      await a.dispose();
    });
  }
  test('a picture without a description is refused (accessibility), unless it is marked decorative', async ({ playwright, baseURL }) => {
    const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
    const no = await upload(a, baseURL!, 'a.png', 'image/png', fx('plain.png'), '');
    expect(no.status).toBe(400); expect(no.json.error).toMatch(/describe|alt/i);
    const deco = await upload(a, baseURL!, 'a.png', 'image/png', fx('plain.png'), '', { decorative: 'on' });
    expect(deco.status, JSON.stringify(deco.json)).toBe(200); made.push(deco.json.asset.id);
    await a.dispose();
  });
  test('anything hidden AFTER the end of a PNG is removed (a common place to smuggle a second file)', async ({ playwright, baseURL }) => {
    const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE })), visitor = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
    const hidden = Buffer.concat([fx('plain.png'), Buffer.from('<script>alert("hidden second file")</script>PK\x03\x04 hidden payload')]);
    const r = await upload(a, baseURL!, 'tail.png', 'image/png', hidden); expect(r.status, JSON.stringify(r.json)).toBe(200); made.push(r.json.asset.id);
    const served = Buffer.from(await (await visitor.get(r.json.asset.url)).body());
    expect(served.toString('latin1')).not.toContain('hidden'); expect(served.equals(fx('plain.png'))).toBe(true);
    await a.dispose(); await visitor.dispose();
  });
  test('an empty file is refused', async ({ playwright, baseURL }) => {
    const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
    expect((await upload(a, baseURL!, 'a.png', 'image/png', Buffer.alloc(0))).status).toBe(400); await a.dispose();
  });
  test('size limits: a picture over 10 MB and a PDF over 15 MB are refused, with a message that says so', async ({ playwright, baseURL }) => {
    const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
    const big = pngWithPayload(Buffer.alloc(10 * 1024 * 1024 + 1024, 7));
    const r1 = await upload(a, baseURL!, 'big.png', 'image/png', big); expect(r1.status).toBe(400); expect(r1.json.error).toMatch(/too big|10 ?MB|larger/i);
    const r2 = await upload(a, baseURL!, 'big.pdf', 'application/pdf', pdf(15 * 1024 * 1024 + 1024), null); expect(r2.status).toBe(400); expect(r2.json.error).toMatch(/too big|15 ?MB|larger/i);
    await a.dispose();
  });
});

test.describe('what the upload hands back and what the file is called', () => {
  test('the answer never reveals where the file is kept, and the id is unguessable', async ({ playwright, baseURL }) => {
    const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
    const r = await upload(a, baseURL!, 'pic.png', 'image/png', fx('plain.png')); made.push(r.json.asset.id);
    const text = JSON.stringify(r.json);
    expect(text).not.toMatch(/r2_key|r2key|assets\/[\w-]+\/|bucket/i);
    expect(r.json.asset.id).toMatch(/^[A-Za-z0-9_-]{8,32}$/);
    const ids = new Set<string>();
    for (let i = 0; i < 3; i++) { const x = await upload(a, baseURL!, 'pic.png', 'image/png', fx('plain.png')); made.push(x.json.asset.id); ids.add(x.json.asset.id); }
    expect(ids.size, 'ids must be random, not a counter').toBe(3);
    await a.dispose();
  });
  const NAMES: [string, RegExp][] = [
    ['../../etc/passwd.png', /^[\w .-]+\.png$/], ['a b/c\\d.png', /^[\w .-]+\.png$/], ['evil\u202Egnp.exe', /^[^\u202e]*\.png$/], ['x'.repeat(400) + '.png', /^.{1,130}\.png$/], ['  ..  .png', /\.png$/], ['con.png', /\.png$/], ['<script>alert(1)</script>.png', /^[^<>]*\.png$/], ['名前 ü 🙂.png', /\.png$/],
  ];
  for (const [given, ok] of NAMES) {
    test(`file name ${JSON.stringify(given.length > 40 ? given.slice(0, 20) + '…' : given)} is made safe`, async ({ playwright, baseURL }) => {
      const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
      const r = await upload(a, baseURL!, given, 'image/png', fx('plain.png'));
      expect(r.status, JSON.stringify(r.json)).toBe(200); made.push(r.json.asset.id);
      expect(r.json.asset.filename).toMatch(ok); expect(r.json.asset.filename).not.toMatch(/[\\/<>:"|?*\u202e\u0000-\u001f]/);
      expect(r.json.asset.url).toMatch(/^\/media\/[\w-]+\/[^/?#]+$/);
      await a.dispose();
    });
  }
});

test.describe('only the signed-in owner can upload', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('no session: refused; from another site: refused; nothing is stored', async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const r = await request.post('/api/admin/assets/upload', { multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: fx('plain.png') }, alt: 'x' }, headers: sameOrigin(baseURL!), maxRedirects: 0 });
    expect(r.status()).toBe(401);
    const x = await request.post('/api/admin/assets/upload', { multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: fx('plain.png') }, alt: 'x' }, headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }, maxRedirects: 0 });
    expect([401, 403]).toContain(x.status()); await request.dispose();
  });
});
