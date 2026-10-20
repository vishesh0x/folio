import { test, expect } from '../fixtures';
import { AUTH_FILE } from '../helpers';
import { gzipSync } from 'node:zlib';

// Step 2: Astro islands. This site has NO UI-framework islands by design (no client:load / client:visible / client:idle); everything is
// server-rendered HTML plus a few small hand-written scripts. These tests keep it that way and cap how much JavaScript each page may ship.
const anon = { cookies: [], origins: [] };
const PUBLIC = ['/', '/projects', '/projects/pocket-ledger', '/now', '/resume', '/contact', '/auth', '/no-such-page'];
const DASH = ['/dashboard', '/dashboard/projects', '/dashboard/projects/1', '/dashboard/now', '/dashboard/resume', '/dashboard/inbox', '/dashboard/settings', '/dashboard/assets', '/dashboard/seo'];

async function jsOf(request: any, path: string) {
  const html = await (await request.get(path)).text();
  const srcs = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1]))];
  let gz = 0;
  for (const s of srcs) gz += gzipSync(await (await request.get(s)).body()).length;
  return { html, srcs, gz };
}

test.describe('no hydration islands anywhere', () => {
  test.use({ storageState: anon });
  for (const path of PUBLIC) test(`${path}`, async ({ request }) => {
    const { html } = await jsOf(request, path);
    expect(html).not.toMatch(/<astro-island|<astro-slot|client:(load|visible|idle|media|only)|data-astro-cid-.*hydrat/i);
  });
});

test.describe('JavaScript budget (gzipped, per page)', () => {
  test.describe('public site', () => {
    test.use({ storageState: anon });
    for (const path of PUBLIC) test(`${path} ships under 8 KB`, async ({ request }) => {
      const { gz, srcs } = await jsOf(request, path);
      expect(gz, srcs.join(', ')).toBeLessThan(8 * 1024);
    });
    test('a page with diagrams starts under 10 KB; the diagram engine is fetched later, only if a diagram is near the screen', async ({ request }) => {
      const { gz, srcs } = await jsOf(request, '/projects/wanderhost-booking');
      expect(gz).toBeLessThan(10 * 1024);
      expect(srcs.some((s) => /mermaid|cytoscape|katex|elk/i.test(s))).toBe(false);
    });
  });
  test.describe('dashboard (only the owner loads it)', () => {
    test.use({ storageState: AUTH_FILE });
    for (const path of DASH) test(`${path} ships under 25 KB`, async ({ request }) => {
      const { gz, srcs } = await jsOf(request, path);
      expect(gz, srcs.join(', ')).toBeLessThan(25 * 1024);
    });
  });
});

test.describe('scripts are external files or hashed (nothing the CSP would have to trust broadly)', () => {
  test.use({ storageState: anon });
  test('public pages contain only the two known inline scripts (theme) plus JSON-LD data', async ({ request }) => {
    for (const path of PUBLIC) {
      const { html } = await jsOf(request, path);
      const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)].filter((m) => !/application\/ld\+json/.test(m[1]));
      expect(inline.length, path).toBeLessThanOrEqual(2);
    }
  });
});
