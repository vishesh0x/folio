import { defineConfig, devices } from '@playwright/test';

/**
 * Folio end-to-end tests. They run against the PRODUCTION BUILD served by `wrangler dev` (so the strict CSP, HSTS and
 * __Host- cookie are all active), never against `astro dev`. Run with:  npm run test:e2e   (it builds first)
 *
 * Two isolated Worker instances, each with its own throwaway local D1/R2 under .wrangler/e2e-*  (wiped on every start):
 *   A  :8787  Turnstile OFF   (default site, seeded with demo content: headers, auth, CSRF/CORS, throttles, responsive layout)
 *   B  :8788  Turnstile ON    (site key + secret + a FAKE Cloudflare verifier on :9911, see tests/e2e/fake-turnstile.mjs)
 * Nothing here talks to real Cloudflare services or your real database.
 */
export const PORT_A = 8787, PORT_B = 8788, VERIFIER = 9911;
export const SETUP_TOKEN = 'e2e-setup-token-0123456789abcdef';

const worker = (port: number, inspector: number, dir: string, vars: Record<string, string>, seed = false) => ({
  command: [
    `rm -rf .wrangler/${dir}`,
    `npx wrangler d1 migrations apply folio-db --local --persist-to .wrangler/${dir}`,
    ...(seed ? [`npx wrangler d1 execute folio-db --local --persist-to .wrangler/${dir} --file tests/seed/demo.sql`] : []),
    `npx wrangler dev --port ${port} --inspector-port ${inspector} --persist-to .wrangler/${dir} ` +
      Object.entries(vars).map(([k, v]) => `--var ${k}:${v}`).join(' '),
  ].join(' && '),
  url: `http://localhost:${port}/robots.txt`,
  reuseExistingServer: !process.env.CI,
  timeout: 180_000,
});

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1, // the sites keep rate-limit counters in their database; one worker keeps runs predictable
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    // wrangler dev's local proxy sometimes drops a keep-alive connection when the Worker answers (e.g. 401/403) without reading
    // the request body ("Network connection lost"). One connection per request avoids that harness flake; it is not a site bug.
    extraHTTPHeaders: { connection: 'close' },
  },
  webServer: [
    { command: 'node tests/e2e/fake-turnstile.mjs', url: `http://127.0.0.1:${VERIFIER}/health`, reuseExistingServer: !process.env.CI },
    worker(PORT_A, 9330, 'e2e-a', { ADMIN_SETUP_TOKEN: SETUP_TOKEN }, true), // seeded with demo content (tests/seed/demo.sql) so layouts are tested with real-looking data
    worker(PORT_B, 9331, 'e2e-b', {
      ADMIN_SETUP_TOKEN: SETUP_TOKEN,
      TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
      TURNSTILE_SECRET_KEY: 'test-secret',
      TURNSTILE_VERIFY_URL: `http://127.0.0.1:${VERIFIER}/verify`,
    }),
  ],
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { baseURL: `http://localhost:${PORT_A}` } },
    {
      name: 'security', testMatch: /security\/.*\.spec\.ts/, dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PORT_A}` },
    },
    {
      // layout on real phone sizes; each spec sets its own viewport / touch emulation
      name: 'responsive', testMatch: /responsive\/.*\.spec\.ts/, dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PORT_A}` },
    },
    {
      name: 'turnstile', testMatch: /turnstile\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PORT_B}` },
    },
  ],
});
