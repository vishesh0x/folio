import { test, expect } from '@playwright/test';
import { crawl } from '../../tools/crawl-links.mjs';

// No broken links inside the site. Starts at the home page and the sitemap and follows everything, so
// a link to a deleted project, a missing picture, a stale #anchor or a mistyped page is found. Links
// to other websites are checked by tests/tools/crawl-links.mjs --external on the owner's own computer.
test.use({ storageState: { cookies: [], origins: [] } });
test('every link, picture, script, style sheet and #anchor inside the public site leads somewhere that exists', async ({ baseURL }) => {
  test.setTimeout(240_000);
  const r = await crawl(baseURL!);
  expect(r.pages.length, 'found a real set of pages').toBeGreaterThan(8);
  expect(r.resources, 'and a real number of links').toBeGreaterThan(60);
  expect(r.problems.map((p) => `${p.url}: ${p.why} (on ${p.where})`)).toEqual([]);
  for (const must of ['/', '/projects', '/privacy', '/contact', '/resume', '/now']) expect(r.pages, must).toContain(must);
});

test('links to other websites say "noopener" when they open a new tab, and none are plain http', async ({ page }) => {
  for (const path of ['/', '/projects/wanderhost-booking', '/resume', '/contact', '/privacy']) {
    await page.goto(path);
    const bad = await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('a[href^="http"]')].filter((a) => a.host !== location.host).flatMap((a) => [
      a.target === '_blank' && !/\bnoopener\b/.test(a.rel) ? `${a.href}: opens a new tab without rel=noopener` : '', a.protocol === 'http:' ? `${a.href}: not https` : ''].filter(Boolean)));
    expect(bad, path).toEqual([]);
  }
});
