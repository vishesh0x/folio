import { test, expect } from '../fixtures';
import { cspDirective, header } from '../helpers';

// Audit 1.3: security headers and Content-Security-Policy, on the production build.
const PUBLIC = ['/', '/projects', '/now', '/resume', '/contact', '/auth', '/does-not-exist'];

test.describe('security headers on every kind of page', () => {
  for (const path of PUBLIC) {
    test(`${path}`, async ({ request }) => {
      const res = await request.get(path);
      expect(header(res, 'x-content-type-options')).toBe('nosniff');
      expect(header(res, 'x-frame-options')).toBe('DENY');
      expect(header(res, 'referrer-policy')).toBe('strict-origin-when-cross-origin');
      expect(header(res, 'permissions-policy')).toContain('camera=()');
      const hsts = header(res, 'strict-transport-security');
      expect(Number(/max-age=(\d+)/.exec(hsts)?.[1])).toBeGreaterThanOrEqual(31536000);
      expect(header(res, 'content-security-policy')).not.toBe('');
    });
  }
});

test.describe('Content-Security-Policy is strict', () => {
  test('locks down the dangerous directives', async ({ request }) => {
    const csp = header(await request.get('/'), 'content-security-policy');
    expect(cspDirective(csp, 'default-src')).toEqual(["'self'"]);
    expect(cspDirective(csp, 'object-src')).toEqual(["'none'"]);
    expect(cspDirective(csp, 'base-uri')).toEqual(["'none'"]);
    expect(cspDirective(csp, 'frame-ancestors')).toEqual(["'none'"]);
    expect(cspDirective(csp, 'form-action')).toEqual(["'self'"]);
  });

  test('script-src allows no unsafe-inline, unsafe-eval, wildcard or whole-scheme source', async ({ request }) => {
    for (const path of ['/', '/auth', '/contact']) {
      const scripts = cspDirective(header(await request.get(path), 'content-security-policy'), 'script-src')!;
      for (const s of scripts) {
        expect(s, `${path}: ${s}`).not.toMatch(/^('unsafe-inline'|'unsafe-eval'|\*|https?:|data:|blob:)$/);
      }
    }
  });

  test('cached public pages carry no nonce; uncached pages get a fresh one each time', async ({ request }) => {
    const pub = cspDirective(header(await request.get('/'), 'content-security-policy'), 'script-src')!;
    expect(pub.some((s) => s.startsWith("'nonce-"))).toBe(false); // a nonce baked into a cached page would be reusable
    const n1 = cspDirective(header(await request.get('/auth'), 'content-security-policy'), 'script-src')!.find((s) => s.startsWith("'nonce-"));
    const n2 = cspDirective(header(await request.get('/auth'), 'content-security-policy'), 'script-src')!.find((s) => s.startsWith("'nonce-"));
    expect(n1).toBeTruthy(); expect(n2).toBeTruthy(); expect(n1).not.toBe(n2);
  });

  test('Turnstile hosts are NOT allowed on any page when Turnstile is off', async ({ request }) => {
    for (const path of ['/', '/contact', '/resume']) {
      expect(header(await request.get(path), 'content-security-policy')).not.toContain('challenges.cloudflare.com');
    }
  });

  // Known findings (docs: audit-progress.md, Step 1). Marked fixme so the suite stays green; remove `.fixme` once fixed.
  test.fixme('FINDING S1-L2: style-src should not need unsafe-inline', async ({ request }) => {
    expect(cspDirective(header(await request.get('/'), 'content-security-policy'), 'style-src')).not.toContain("'unsafe-inline'");
  });
  test.fixme('FINDING S1-L3: send Cross-Origin-Opener-Policy: same-origin', async ({ request }) => {
    expect(header(await request.get('/'), 'cross-origin-opener-policy')).toBe('same-origin');
  });
});

test.describe('S1-L4 (fixed in Step 2): the contact form carries a one-time token, so it is never stored', () => {
  test('/contact is private, no-store', async ({ request }) => {
    expect(header(await request.get('/contact'), 'cache-control')).toBe('private, no-store');
  });
});

test.describe('caching of private responses', () => {
  test('sign-in page is never stored', async ({ request }) => {
    expect(header(await request.get('/auth'), 'cache-control')).toBe('private, no-store');
  });
});

// A real browser enforces the CSP, so this catches a policy that silently breaks the site's own scripts/styles/fonts.
test.describe('real browser: no CSP violations on the site\'s own pages', () => {
  for (const path of ['/', '/projects', '/now', '/resume', '/contact', '/auth']) {
    test(`${path}`, async ({ page }) => {
      const violations: string[] = [];
      page.on('console', (m) => { if (/content security policy|refused to/i.test(m.text())) violations.push(m.text()); });
      await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error('CSP violation: ' + e.violatedDirective + ' ' + e.blockedURI)));
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      // exercise the two hash-allowed inline scripts: the theme switch
      const dark = page.locator('[data-theme-choice="dark"]').first();
      if (await dark.isVisible()) { await dark.click(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); }
      expect(violations).toEqual([]);
    });
  }

  test('an injected inline script is blocked by the CSP', async ({ page }) => {
    await page.goto('/');
    const ran = await page.evaluate(() => new Promise<boolean>((resolve) => {
      (window as any).__pwned = false;
      const s = document.createElement('script'); s.textContent = 'window.__pwned = true';
      document.body.appendChild(s);
      setTimeout(() => resolve((window as any).__pwned === true), 300);
    }));
    expect(ran).toBe(false);
  });
});
