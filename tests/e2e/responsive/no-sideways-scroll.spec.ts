import { test, expect } from '@playwright/test';
import { AUTH_FILE, WIDTHS, layoutProblems, openPage } from '../helpers';

// The page must never be wider than the screen: no sideways scrolling, nothing poking out past the edge.
// Run against demo content that includes the nasty cases (a 70-character unbroken word, a very long URL, a wide table, a very
// long project title and tag), because short, tidy sample text hides exactly these bugs.
const PUBLIC: Array<[string, string]> = [
  ['home', '/'], ['projects', '/projects'], ['project with table, code and a long URL', '/projects/wanderhost-booking'],
  ['project with a very long title', '/projects/an-extremely-long-project-title-with-Antidisestablishmentarianism-inside'],
  ['now (long unbroken word)', '/now'], ['resume', '/resume'], ['contact', '/contact'], ['404', '/no-such-page'], ['403', '/error/403'], ['sign in', '/auth'],
];
const DASH: Array<[string, string]> = [
  ['overview', '/dashboard'], ['projects', '/dashboard/projects'], ['project editor', '/dashboard/projects/1'], ['now board', '/dashboard/now'],
  ['resume builder', '/dashboard/resume'], ['inbox', '/dashboard/inbox'], ['message', '/dashboard/inbox/1'], ['search & sharing', '/dashboard/seo'],
  ['settings', '/dashboard/settings'], ['files', '/dashboard/assets'],
];

for (const w of WIDTHS) {
  test.describe(`public site at ${w}px`, () => {
    test.use({ viewport: { width: w, height: 740 }, isMobile: true, hasTouch: true, storageState: { cookies: [], origins: [] } });
    for (const [name, path] of PUBLIC) {
      test(name, async ({ page }) => {
        await openPage(page, path);
        const r = await layoutProblems(page);
        expect(r.offenders, 'elements past the screen edge').toEqual([]);
        expect(r.scrollWidth, 'page is wider than the screen').toBeLessThanOrEqual(r.clientWidth);
      });
    }
  });
  test.describe(`dashboard at ${w}px`, () => {
    test.use({ viewport: { width: w, height: 740 }, isMobile: true, hasTouch: true, storageState: AUTH_FILE });
    for (const [name, path] of DASH) {
      test(name, async ({ page }) => {
        await openPage(page, path);
        const r = await layoutProblems(page);
        expect(r.offenders, 'elements past the screen edge').toEqual([]);
        expect(r.scrollWidth, 'page is wider than the screen').toBeLessThanOrEqual(r.clientWidth);
      });
    }
  });
}
