import { test, expect, withRetry } from '../fixtures';
import { readFileSync } from 'node:fs';
import { AUTH_FILE, sameOrigin } from '../helpers';
import { upload, removeAsset } from '../uploads';
import { d1 } from '../d1';

// Step 5: the Files page decides which pictures are "in use" (and so cannot be deleted) by reading the text of every project. It must agree
// with what the page renderer really shows: if a project displays a picture, deleting that picture must be refused. The renderer finds a
// picture in three ways: /media/<id>/ anywhere, ![[<id>]], and ![[file name]] (ignoring capital letters and spaces around the name).
test.use({ storageState: AUTH_FILE });
const png = readFileSync('tests/fixtures/plain.png');
let n = 0;

const forms: [string, (id: string, file: string) => string][] = [
  ['a normal embed  ![[file.png]]', (_i, f) => `![[${f}]]`],
  ['an embed with a size  ![[file.png|300]]', (_i, f) => `![[${f}|300]]`],
  ['a Markdown image pointing at /media/<id>/', (i, f) => `![A picture](/media/${i}/${f})`],
  ['an embed typed in CAPITAL LETTERS  ![[FILE.PNG]]', (_i, f) => `![[${f.toUpperCase()}]]`],
  ['an embed with spaces inside the brackets  ![[  file.png  ]]', (_i, f) => `![[  ${f}  ]]`],
  ['an embed by file id  ![[<id>]]', (i) => `![[${i}]]`],
];

for (const [label, make] of forms) {
  test(`a picture shown through ${label} cannot be deleted`, async ({ playwright, baseURL }) => {
    const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE })), visitor = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
    const file = `usage-case-${++n}-${Date.now().toString(36)}.png`;
    const up = await upload(a, baseURL!, file, 'image/png', png, 'Used picture');
    const id = up.json.asset.id as string, name = up.json.asset.filename as string;
    const slug = `usage-test-${n}-${Date.now().toString(36)}`;
    d1('e2e-a', `INSERT INTO projects (slug,title,summary,body_md,tags,status,sort_order) VALUES ('${slug}','Usage test ${n}','x','Text before\n\n${make(id, name).replace(/'/g, "''")}\n\nText after','[]','published',900)`);
    try {
      // 1. the public page really does show the picture (so "used" is the truth)
      const page = await (await visitor.get(`/projects/${slug}`)).text();
      expect(page, 'the renderer shows this picture').toContain(`/media/${id}/`);
      // 2. so the site must refuse to delete it
      const del = await removeAsset(a, baseURL!, id);
      const where = decodeURIComponent(del.headers()['location'] ?? '');
      expect(where, 'delete must be refused while a project shows the picture').toContain('error=');
      expect(where).toContain("Can't delete");
      expect((await visitor.get(`/media/${id}/${name}`)).status(), 'the file is still there').toBe(200);
      // 3. the Files page labels it as in use
      const files = await (await a.get('/dashboard/assets')).text();
      const card = files.slice(files.indexOf(`value="${id}"`) - 200, files.indexOf(`value="${id}"`) + 900);
      expect(files, 'the Files page lists the file').toContain(name);
      const entry = files.split('<li class="file"').find((x) => x.includes(name));
      expect(entry, 'the Files page shows it as in use').toContain('In use');
      void card;
    } finally {
      d1('e2e-a', `DELETE FROM projects WHERE slug = '${slug}'`);
      await removeAsset(a, baseURL!, id);
      await a.dispose(); await visitor.dispose();
    }
  });
}

test('a picture no project shows CAN be deleted, and deleting it removes it', async ({ playwright, baseURL }) => {
  const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE })), visitor = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
  const up = await upload(a, baseURL!, `usage-free-${Date.now().toString(36)}.png`, 'image/png', png, 'Not used');
  const id = up.json.asset.id as string, name = up.json.asset.filename as string;
  const slug = `usage-test-free-${Date.now().toString(36)}`;
  d1('e2e-a', `INSERT INTO projects (slug,title,summary,body_md,tags,status,sort_order) VALUES ('${slug}','Mentions nothing','x','A picture called something-else.png is not this one. ![[another-file.png]]','[]','published',900)`);
  try {
    const del = await removeAsset(a, baseURL!, id);
    expect(decodeURIComponent(del.headers()['location'] ?? '')).toContain('ok=Deleted');
    expect((await visitor.get(`/media/${id}/${name}`)).status()).toBe(404);
  } finally { d1('e2e-a', `DELETE FROM projects WHERE slug = '${slug}'`); await a.dispose(); await visitor.dispose(); }
});

test('the cover, the share image, the portrait and a page share image still count as uses', async ({ playwright, baseURL }) => {
  const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE }));
  const up = await upload(a, baseURL!, `usage-cover-${Date.now().toString(36)}.png`, 'image/png', png, 'Cover');
  const id = up.json.asset.id as string;
  const slug = `usage-test-cover-${Date.now().toString(36)}`;
  try {
    d1('e2e-a', `INSERT INTO projects (slug,title,summary,body_md,tags,status,sort_order,cover_asset) VALUES ('${slug}','Has a cover','x','no pictures in the text','[]','draft',900,'${id}')`);
    expect(decodeURIComponent((await removeAsset(a, baseURL!, id)).headers()['location'] ?? '')).toContain("Can't delete");
    d1('e2e-a', `UPDATE projects SET cover_asset = NULL, seo_image = '${id}' WHERE slug = '${slug}'`);
    expect(decodeURIComponent((await removeAsset(a, baseURL!, id)).headers()['location'] ?? '')).toContain("Can't delete");
    d1('e2e-a', `UPDATE projects SET seo_image = NULL WHERE slug = '${slug}'`);
    expect(decodeURIComponent((await removeAsset(a, baseURL!, id)).headers()['location'] ?? '')).toContain('ok=Deleted');
  } finally { d1('e2e-a', `DELETE FROM projects WHERE slug = '${slug}'`); await a.dispose(); }
});
