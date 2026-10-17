import type { APIRequestContext } from '@playwright/test';

export const ADMIN_EMAIL = 'admin@example.com';
export const ADMIN_PASSWORD = 'correct horse battery staple 42';
export const AUTH_FILE = 'tests/.auth/admin.json';

const r = () => Math.floor(Math.random() * 250) + 1;
/** A random IPv4 address, sent as cf-connecting-ip so every test gets its own rate-limit bucket (Cloudflare sets this in production). */
export const freshIp = () => `10.${r()}.${r()}.${r()}`;

/** Headers a browser sends for a request made by one of the site's own pages. */
export const sameOrigin = (baseURL: string, ip = freshIp()) => ({ 'sec-fetch-site': 'same-origin', origin: new URL(baseURL).origin, 'cf-connecting-ip': ip });
export const crossSite = (ip = freshIp()) => ({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example', 'cf-connecting-ip': ip });

export const login = (request: APIRequestContext, baseURL: string, email: string, password: string, ip: string) =>
  request.post('/auth', { form: { mode: 'login', email, password }, headers: sameOrigin(baseURL, ip), maxRedirects: 0 });

export const header = (res: { headers(): Record<string, string> }, name: string) => res.headers()[name.toLowerCase()] ?? '';
/** Parse one CSP directive: cspDirective(csp, 'script-src') → ["'self'", "'sha256-…'", …] */
export const cspDirective = (csp: string, name: string): string[] | null => {
  const d = csp.split(';').map((s) => s.trim()).find((s) => s === name || s.startsWith(name + ' '));
  return d ? d.split(/\s+/).slice(1) : null;
};

/** The widths the layout must hold at: small phone, common phone, large phone, tablet. */
export const WIDTHS = [320, 375, 414, 768] as const;

/**
 * Runs in the browser. Returns what sticks out past the screen edge (ignoring anything clipped by a scrolling/hidden
 * ancestor, such as a wide table inside its own scroll box, and the intentionally off-screen honeypot/skip-link).
 */
export const layoutProblems = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth, out: string[] = [];
  const name = (el: Element) => el.tagName.toLowerCase() + (typeof (el as HTMLElement).className === 'string' && (el as HTMLElement).className ? '.' + (el as HTMLElement).className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (!r.width || cs.visibility === 'hidden' || cs.display === 'none' || el.closest('.hp, .visually-hidden, .skip, [hidden]')) continue;
    if (r.right > vw + 1 || r.left < -1) {
      let p = el.parentElement, clipped = false;
      while (p && p !== document.body) { if (getComputedStyle(p).overflowX !== 'visible') { clipped = true; break; } p = p.parentElement; }
      if (!clipped) out.push(`${name(el)} spans ${Math.round(r.left)}..${Math.round(r.right)} on a ${vw}px screen`);
    }
  }
  return { scrollWidth: document.documentElement.scrollWidth, clientWidth: vw, offenders: Array.from(new Set(out)).slice(0, 5) };
});

/** page.goto that survives wrangler dev's local-proxy flake (see fixtures.ts): retries a 500 that is not the site's own error page. */
export async function openPage(page: import('@playwright/test').Page, url: string) {
  let res = await page.goto(url, { waitUntil: 'load' });
  for (let i = 0; i < 3 && res && res.status() === 500 && !(await res.text()).includes('Something broke'); i++) res = await page.goto(url, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle');
  return res!;
}
