import { test, expect, withRetry } from '../fixtures';
import { counted, signIn } from './counting';

// Step 7: a public page build used to read the settings row twice (the layout and the page both asked). Public pages now remember the settings per
// content version; the owner's dashboard still reads fresh, and a dashboard save shows on the public site at once.
test.describe.configure({ mode: 'serial' });
let owner: any, base: string;
test.beforeAll(async ({ playwright, baseURL }) => {
  base = baseURL!; owner = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } })); await signIn(owner, baseURL!);
});
test.afterAll(async () => { await owner?.dispose(); });
const settingsReads = (calls: string[]) => calls.filter((c) => /FROM settings WHERE key = 'site'/.test(c)).length;

test('a public page build reads the settings row at most once, and a second build not at all', async () => {
  await counted(owner, base, 'GET', '/?m=warm');
  const second = await counted(owner, base, 'GET', '/?m=second');
  expect(second.res.status()).toBe(200);
  expect(settingsReads(second.counts.calls), second.counts.calls.join('\n')).toBe(0);
  const third = await counted(owner, base, 'GET', '/projects?m=third');
  expect(settingsReads(third.counts.calls), 'other pages too').toBe(0);
  const notFound = await counted(owner, base, 'GET', '/no-such-page-at-all');
  expect(notFound.res.status()).toBe(404);
  expect(settingsReads(notFound.counts.calls), 'even a 404 (what bots scanning for /wp-admin cost)').toBe(0);
});

test('a save in the dashboard shows on the public site immediately, and the dashboard itself always reads fresh', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: base });
  await ctx.addCookies((await owner.storageState()).cookies);
  const page = await ctx.newPage();
  await page.goto('/dashboard/settings', { waitUntil: 'networkidle' });
  const tagline = `Tagline ${Date.now().toString(36)}`;
  await page.locator('#tagline').fill(tagline);
  await page.getByRole('button', { name: /^save/i }).first().click();
  await page.waitForLoadState('networkidle');
  const home = await (await owner.get(`/?after=${Date.now()}`)).text();
  expect(home, 'the new tagline is on the public page straight away').toContain(tagline);
  const dash = await counted(owner, base, 'GET', '/dashboard/settings');
  expect(settingsReads(dash.counts.calls), 'the dashboard page reads the row itself').toBeGreaterThanOrEqual(1);
  await ctx.close();
});
