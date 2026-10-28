import { test, expect, withRetry } from '../fixtures';
import { readFileSync } from 'node:fs';
import { AUTH_FILE, header } from '../helpers';
import { upload, removeAsset } from '../uploads';
import { exifOrientation } from '../../../src/lib/strip';

// Step 4: a phone photo carries the exact place it was taken, the camera's serial number and more, and the site serves the ORIGINAL file to
// anyone who has its address (it is visible in the page source). That personal data must not be in the stored file.
test.use({ storageState: AUTH_FILE });
const SECRETS = ['SecretCamera', 'SERIAL-1234', 'SecretEditing', 'SECRET-COMMENT', 'SECRET-XMP', 'SECRET-PERSON', 'SECRET-ITXT', '2024:06:01', 'xmpmeta'];
const CASES: [string, string, string][] = [['photo-gps.jpg', 'image/jpeg', 'jpg'], ['photo-gps-noorient.jpg', 'image/jpeg', 'jpg'], ['photo-meta.png', 'image/png', 'png'], ['photo-meta.webp', 'image/webp', 'webp']];

for (const [file, mime, ext] of CASES) {
  test(`${file}: the stored and served original has no location, camera or comments`, async ({ playwright, baseURL }) => {
    const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE })), visitor = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
    const original = readFileSync(`tests/fixtures/${file}`);
    const marks = file.includes('noorient') ? ['Exif'] : SECRETS;          // the GPS-only photo has numbers, not text: the EXIF block itself is the marker
    expect(marks.filter((s) => original.toString('latin1').includes(s)).length, 'the fixture should contain personal data').toBeGreaterThan(0);
    const up = await upload(a, baseURL!, file, mime, original, 'A photo');
    expect(up.status, JSON.stringify(up.json)).toBe(200);
    const asset = up.json.asset;
    const served = await visitor.get(asset.url);                        // exactly what anyone who knows the address receives
    expect(served.status()).toBe(200); expect(header(served, 'content-type')).toBe(mime);
    const body = await served.body();
    expect(marks.filter((s) => body.toString('latin1').includes(s)), 'personal data still present in the served file').toEqual([]);
    expect(body.length, 'the recorded size is the size of what is stored').toBe(asset.size);
    expect(body.length).toBeLessThan(original.length);
    // still a working picture: the resizer can read it, and its recorded dimensions are right
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
