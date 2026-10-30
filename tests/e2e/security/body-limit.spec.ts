import { test, expect, withRetry } from '../fixtures';
import { AUTH_FILE, sameOrigin } from '../helpers';
import { pdf } from '../uploads';
import { requestTooLarge, requestLimit, MAX_UPLOAD_REQUEST, MAX_FORM_REQUEST } from '../../../src/lib/body-limit';

// Step 5: the site refuses an oversized request from its declared size, before reading any of it. (A Worker has 128 MB of memory; reading a form
// holds all of it at once, and Cloudflare lets bodies of up to 100 MB through.) The file-size rules inside the upload code stay as the second layer.
const MB = 1024 * 1024;

// A server that refuses a big body WITHOUT reading it may close the connection while the client is still sending; the client then reports a reset
// instead of the 413 it was sent (the call log shows the 413 arriving first). That race is in the test client, not the site, so try again.
type Ctx = { post: (url: string, o?: any) => Promise<any> };
async function big(ctx: Ctx, url: string, o: any) {
  for (let i = 0; i < 4; i++) { try { return await ctx.post(url, o); } catch (e) { if (!/ECONNRESET|EPIPE|socket hang up/i.test(String(e))) throw e; } }
  throw new Error('the connection was reset on 4 attempts in a row');
}

test.describe('the size rule itself', () => {
  test('uploads get room for a 15 MiB PDF plus fields; every other form gets a few MB; a missing or odd length is not judged', () => {
    expect(requestLimit('/api/admin/assets/upload')).toBe(MAX_UPLOAD_REQUEST);
    expect(requestLimit('/api/admin/assets')).toBe(MAX_UPLOAD_REQUEST);
    expect(requestLimit('/contact')).toBe(MAX_FORM_REQUEST);
    expect(MAX_UPLOAD_REQUEST).toBeGreaterThan(15 * MB);                    // a legal 15 MiB PDF must fit with its form fields
    expect(requestTooLarge('/contact', String(MAX_FORM_REQUEST))).toBeNull();
    expect(requestTooLarge('/contact', String(MAX_FORM_REQUEST + 1))).toBe(MAX_FORM_REQUEST);
    expect(requestTooLarge('/contact', null)).toBeNull();
    expect(requestTooLarge('/contact', 'abc')).toBeNull();
    expect(requestTooLarge('/contact', '-5')).toBeNull();
  });
});

test.describe('visitors', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const path of ['/contact', '/auth']) {
    test(`a ${path} POST just over the 4 MiB limit is refused with 413 and a plain message, without being read`, async ({ playwright, baseURL }) => {
      const v = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
      const r = await big(v, path, { data: 'x='.padEnd(MAX_FORM_REQUEST + 1024, 'a'), headers: { ...sameOrigin(baseURL!), 'content-type': 'application/x-www-form-urlencoded' }, maxRedirects: 0 });
      expect(r.status()).toBe(413);
      expect(r.headers()['cache-control']).toContain('no-store');
      expect(await r.text()).toBe('That request is too large.');
      await v.dispose();
    });
  }
  test('an ordinary form (2 MB, well inside the limit) is still read normally', async ({ playwright, baseURL }) => {
    const v = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
    const r = await big(v, '/contact', { data: 'name=A&message=' + 'a'.repeat(2 * MB), headers: { ...sameOrigin(baseURL!), 'content-type': 'application/x-www-form-urlencoded' }, maxRedirects: 0 });
    expect(r.status(), 'refused by the form\'s own rules, not by the size gate').not.toBe(413);
    await v.dispose();
  });
  test('a cross-site oversized POST is still told 403 first (the forgery check comes before everything)', async ({ playwright, baseURL }) => {
    const v = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
    const r = await big(v, '/contact', { data: 'x='.padEnd(5 * MB, 'a'), headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, maxRedirects: 0 });
    expect(r.status()).toBe(403);
    await v.dispose();
  });
  test('an oversized upload from someone who is not signed in is told 401, not 413', async ({ playwright, baseURL }) => {
    const v = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
    const r = await big(v, '/api/admin/assets/upload', { multipart: { file: { name: 'a.pdf', mimeType: 'application/pdf', buffer: pdf(20 * MB) } }, headers: sameOrigin(baseURL!), maxRedirects: 0 });
    expect(r.status()).toBe(401);
    await v.dispose();
  });
});

test.describe('the owner', () => {
  test.use({ storageState: AUTH_FILE });
  test('the upload boxes in the editors get a JSON "too large" for a 20 MB file, and nothing is stored', async ({ playwright, baseURL }) => {
    const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
    const before = await (await a.get('/dashboard/assets')).text();
    const r = await big(a, '/api/admin/assets/upload', { multipart: { file: { name: 'huge-limit-test.pdf', mimeType: 'application/pdf', buffer: pdf(20 * MB) } }, headers: sameOrigin(baseURL!), maxRedirects: 0 });
    expect(r.status()).toBe(413);
    expect(await r.json()).toEqual({ ok: false, error: 'That file is too large (limit 10 MB for images, 15 MB for PDFs).' });
    expect(await (await a.get('/dashboard/assets')).text()).not.toContain('huge-limit-test');
    expect(before).not.toContain('huge-limit-test');
    await a.dispose();
  });
  test('the Files page upload form gets its usual red message for a 20 MB file', async ({ playwright, baseURL }) => {
    const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
    const r = await big(a, '/api/admin/assets', { multipart: { file: { name: 'huge-limit-test2.pdf', mimeType: 'application/pdf', buffer: pdf(20 * MB) }, alt: '' }, headers: sameOrigin(baseURL!), maxRedirects: 0 });
    expect(r.status()).toBe(303);
    expect(decodeURIComponent(r.headers()['location'])).toBe('/dashboard/assets?error=That file is too large (limit 10 MB for images, 15 MB for PDFs).');
    await a.dispose();
  });
  test('a PDF just over 15 MB but inside the request allowance still gets the upload code\'s own message', async ({ playwright, baseURL }) => {
    const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
    const r = await big(a, '/api/admin/assets/upload', { multipart: { file: { name: 'just-over.pdf', mimeType: 'application/pdf', buffer: pdf(15 * MB + 10) } }, headers: sameOrigin(baseURL!), maxRedirects: 0 });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toMatch(/too large/);
    await a.dispose();
  });
  test('a PDF just under 15 MB (the largest allowed) is still accepted, form fields and all', async ({ playwright, baseURL }) => {
    const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
    const r = await big(a, '/api/admin/assets/upload', { multipart: { file: { name: 'largest-ok.pdf', mimeType: 'application/pdf', buffer: pdf(15 * MB - 200) }, expect: 'pdf' }, headers: sameOrigin(baseURL!), maxRedirects: 0 });
    expect(r.status()).toBe(200);
    const id = (await r.json()).asset.id;
    await big(a, '/api/admin/assets/delete', { form: { id }, headers: sameOrigin(baseURL!), maxRedirects: 0 });
    await a.dispose();
  });
});
