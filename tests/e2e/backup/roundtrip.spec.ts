import { test, expect, withRetry } from '../fixtures';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signIn } from '../limits/counting';
import { sameOrigin } from '../helpers';
import { d1 } from '../d1';
import { upload } from '../uploads';

// The whole promise, through the real page: download a backup, damage the site, restore, and the site
// is as it was.
test.describe.configure({ mode: 'serial' });
const png = readFileSync('tests/fixtures/plain.png');
let owner: any, anon: any, base: string, zipPath = '';
const get = async (part: string) => (await owner.get(`/api/admin/backup?part=${part}`)).json();
// The importer renumbers sort_order 0, 1, 2... (the seed has ties); what must be kept is the ORDER,
// which the export gives sorted.
const order = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'sort_order' ? undefined : v)));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const snapshot = async () => {
  const [site, projects, resume, now, assets] = await Promise.all(['site', 'projects', 'resume', 'now', 'assets'].map(get));
  const files: Record<string, string> = {};
  for (const a of assets.items) files[a.id] = sha(Buffer.from(await (await anon.get(`/media/${a.id}/${a.filename}`)).body()));
  return { site: JSON.parse(JSON.stringify(site)), projects: projects.items, resume: resume.sections, now: now.categories, assets: assets.items, files };
};
let before: Awaited<ReturnType<typeof snapshot>>, restored: Awaited<ReturnType<typeof snapshot>>, extraId = '';
const limited2 = (ps: any[]) => ps.map((p) => ({ ...p, tags: p.tags.map((t: string) => t.slice(0, 30)) }));

test.beforeAll(async ({ playwright, baseURL }) => {
  base = baseURL!;
  anon = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
  owner = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } })); await signIn(owner, baseURL!);
  extraId = (await upload(owner, base, `roundtrip-${Date.now().toString(36)}.png`, 'image/png', png, 'A picture that is not used anywhere')).json.asset.id;
  d1('e2e-f', "INSERT INTO messages (name,email,subject,body,is_read,created_at) VALUES ('Rita','rita@roundtrip.test','Hello','A message for the round trip',0,1700000000)");
  before = await snapshot();
});
test.afterAll(async () => { d1('e2e-f', "DELETE FROM messages WHERE email LIKE '%@roundtrip.test'"); await anon?.dispose(); await owner?.dispose(); });

async function openPage(browser: any) {
  const ctx = await browser.newContext({ baseURL: base, acceptDownloads: true });
  await ctx.addCookies((await owner.storageState()).cookies);
  const page = await ctx.newPage(); await page.goto('/dashboard/backup', { waitUntil: 'networkidle' });
  return { ctx, page };
}

test('the backup page shows what will be saved, and the menu links to it', async ({ browser }) => {
  const { ctx, page } = await openPage(browser);
  await expect(page.getByRole('heading', { name: 'Backup & restore', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Dashboard' }).getByRole('link', { name: 'Backup & restore' })).toBeVisible();
  await expect(page.locator('#bk-ex-h')).toBeVisible(); await expect(page.locator('#bk-import-panel')).toBeHidden();
  await ctx.close();
});

test('the backup page loads one small script (the zip code is not downloaded by any other page)', async () => {
  const { gzipSync } = await import('node:zlib');
  const html = await (await owner.get('/dashboard/backup')).text();
  const src = [...html.matchAll(/<script[^>]+src="([^"]*backup[^"]*)"/g)].map((m) => m[1]);
  expect(src.length, 'the page loads its script').toBeGreaterThan(0);
  let total = 0; for (const u of src) total += gzipSync(Buffer.from(await (await owner.get(u)).body())).length;
  expect(total / 1024, 'KB of script, compressed').toBeLessThan(12);
  const home = await (await anon.get('/')).text(); expect(home).not.toContain('backup');
});

test('download: one zip with the readable content and every file; no account, password or session inside; messages only when asked', async ({ browser }) => {
  const { ctx, page } = await openPage(browser);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bk-export')]);
  expect(dl.suggestedFilename()).toMatch(/^folio-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  zipPath = join(tmpdir(), `rt-${Date.now()}.zip`); await dl.saveAs(zipPath);
  await expect(page.locator('#bk-export-status')).toContainText('Done:');
  const buf = readFileSync(zipPath);
  expect(buf.subarray(0, 4).toString('hex')).toBe('504b0304');
  for (const name of ['manifest.json', 'site.json', 'projects.json', 'resume.json', 'now.json', 'assets.json', 'README.txt', `files/${extraId}/`]) expect(buf.includes(Buffer.from(name)), name).toBe(true);
  expect(buf.includes(Buffer.from('"includes_messages": false')), 'the manifest says there are no messages').toBe(true);  // (the README mentions the file name, so the name is not a test)
  expect(buf.includes(Buffer.from('rita@roundtrip.test'))).toBe(false);
  for (const secret of ['pbkdf2', 'password_hash', 'form_secret', '__Host-session']) expect(buf.includes(Buffer.from(secret)), secret).toBe(false);
  // With the box ticked the messages come too.
  await page.check('#bk-messages');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#bk-export')]);
  const p2 = join(tmpdir(), `rt2-${Date.now()}.zip`); await dl2.saveAs(p2);
  expect(readFileSync(p2).includes(Buffer.from('rita@roundtrip.test'))).toBe(true);
  await ctx.close();
});

test('damage the site, check the backup without changing anything, then restore: everything is back exactly', async ({ browser }) => {
  // Damage: a project, the tagline, the Now board, the resume, an unused file.
  d1('e2e-f', "DELETE FROM projects WHERE slug = 'pocket-ledger'");
  d1('e2e-f', "UPDATE settings SET value = json_set(value, '$.tagline', 'DAMAGED TAGLINE') WHERE key = 'site'");
  d1('e2e-f', 'DELETE FROM now_categories; DELETE FROM resume_sections');
  expect((await owner.post('/api/admin/assets/delete', { form: { id: extraId }, headers: sameOrigin(base), maxRedirects: 0 })).status()).toBe(303);
  expect((await anon.get(`/media/${extraId}/${before.assets.find((a: any) => a.id === extraId).filename}`)).status(), 'the unused file is gone').toBe(404);
  const damaged = await snapshot(); expect(damaged.projects.length).toBe(before.projects.length - 1);

  const { ctx, page } = await openPage(browser);
  await page.setInputFiles('#bk-file', zipPath);
  await expect(page.locator('#bk-import-panel')).toBeVisible();
  await expect(page.locator('#bk-info')).toContainText(`${before.projects.length} projects`);
  // "check only" changes nothing
  await page.click('#bk-check');
  await expect(page.locator('#bk-result')).toContainText('Nothing was changed');
  expect((await snapshot()).projects.length, 'check only changed nothing').toBe(damaged.projects.length);
  expect(JSON.parse((d1('e2e-f', "SELECT value FROM settings WHERE key='site'") as any[])[0].value).tagline).toBe('DAMAGED TAGLINE');
  // The Import button needs the typed confirmation because parts are replaced.
  await expect(page.locator('#bk-go')).toBeDisabled();
  await page.fill('#bk-confirm', 'replace'); await expect(page.locator('#bk-go'), 'case matters').toBeDisabled();
  await page.fill('#bk-confirm', 'REPLACE'); await expect(page.locator('#bk-go')).toBeEnabled();
  await page.click('#bk-go');
  await expect(page.locator('#bk-result')).toContainText('Import finished', { timeout: 60_000 });
  await expect(page.locator('#bk-result')).toBeFocused();
  await ctx.close();

  const after = await snapshot();
  // The importer enforces the form's limits. The demo data has one tag longer than the form allows (48
  // characters, for an overflow test); it comes back as the form would have kept it.
  const limited = before.projects.map((p: any) => ({ ...p, tags: p.tags.map((t: string) => t.slice(0, 30)) }));
  expect(after.projects, 'projects: every field, including dates, bodies and addresses').toEqual(limited);
  expect(after.site.settings).toEqual(before.site.settings); expect(after.site.seo_pages).toEqual(before.site.seo_pages);
  // The resume's own cleaner fills fields a seeded entry did not have with empty values, so check that
  // everything that was there is preserved; the next test proves a second restore changes nothing more.
  expect(order(after.resume)).toMatchObject(order(before.resume)); expect(order(after.now)).toMatchObject(order(before.now)); restored = after;
  expect(after.assets.map((a: any) => a.id).sort()).toEqual(before.assets.map((a: any) => a.id).sort());
  expect(after.assets.find((a: any) => a.id === extraId), 'the deleted file is back under the same id').toBeTruthy();
  expect(after.files, 'every file is byte for byte the same').toEqual(before.files);
  expect((await anon.get('/projects/pocket-ledger')).status(), 'and the page works for visitors').toBe(200);
});

test('doing it again is safe: restoring the same backup twice gives the same site, and adds no duplicates', async ({ browser }) => {
  const { ctx, page } = await openPage(browser);
  await page.setInputFiles('#bk-file', zipPath); await expect(page.locator('#bk-import-panel')).toBeVisible();
  await page.fill('#bk-confirm', 'REPLACE'); await page.click('#bk-go');
  await expect(page.locator('#bk-result')).toContainText('Import finished', { timeout: 60_000 });
  await ctx.close();
  const again = await snapshot();
  expect(again.projects).toEqual(limited2(before.projects)); expect(again.resume).toEqual(restored.resume); expect(again.now).toEqual(restored.now); expect(again.site).toEqual(restored.site); expect(again.files).toEqual(before.files);
});

test('"add" mode brings back only what is missing and does not touch the rest', async ({ browser }) => {
  d1('e2e-f', "DELETE FROM projects WHERE slug = 'edge-notes'");
  d1('e2e-f', "UPDATE projects SET title = 'My own edit' WHERE slug = 'wanderhost-booking'");
  const { ctx, page } = await openPage(browser);
  await page.setInputFiles('#bk-file', zipPath); await expect(page.locator('#bk-import-panel')).toBeVisible();
  await expect(page.locator('#bk-c-resume')).toBeChecked();
  await page.check('#bk-m-add');
  for (const id of ['bk-c-site', 'bk-c-resume', 'bk-c-now', 'bk-c-files']) await page.uncheck(`#${id}`);
  await expect(page.locator('#bk-confirm-row'), 'adding needs no typed confirmation').toBeHidden(); await expect(page.locator('#bk-go')).toBeEnabled();
  await page.click('#bk-go'); await expect(page.locator('#bk-result')).toContainText('Import finished', { timeout: 60_000 });
  await ctx.close();
  expect((await anon.get('/projects/edge-notes')).status()).toBe(200);
  expect((d1('e2e-f', "SELECT title FROM projects WHERE slug='wanderhost-booking'") as any[])[0].title, 'a project that exists is left as it is').toBe('My own edit');
});

test('a file that is not a backup, or was changed after it was made, is refused with a plain message and changes nothing', async ({ browser }) => {
  const { writeFileSync } = await import('node:fs');
  const text = join(tmpdir(), `notzip-${Date.now()}.zip`); writeFileSync(text, 'just some text');
  const tampered = join(tmpdir(), `tamper-${Date.now()}.zip`); const buf = Buffer.from(readFileSync(zipPath)); const at = buf.indexOf(Buffer.from('"title"')); buf.write('"titlX"', at);  // Alter content inside a stored JSON file
  writeFileSync(tampered, buf);
  const { ctx, page } = await openPage(browser);
  const projectsBefore = (await get('projects')).items.length;
  await page.setInputFiles('#bk-file', text); await expect(page.locator('#bk-import-status')).toContainText(/not a zip/i); await expect(page.locator('#bk-import-panel')).toBeHidden();
  await page.setInputFiles('#bk-file', tampered); await expect(page.locator('#bk-import-status')).toContainText(/damaged|changed after/i); await expect(page.locator('#bk-import-panel')).toBeHidden();
  expect((await get('projects')).items.length).toBe(projectsBefore);
  await ctx.close();
});
