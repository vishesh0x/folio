import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// S1-M4: secrets must never reach the repository. These checks read the project's files (never print a secret, only where it is).
/** Remove // and /* *\/ comments and trailing commas from JSONC, leaving anything inside a string untouched. */
function stripJsonc(src: string): string {
  let out = '', i = 0, str = false;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (str) { out += c; if (c === '\\') { out += n ?? ''; i += 2; continue; } if (c === '"') str = false; i++; continue; }
    if (c === '"') { str = true; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}
const SKIP = new Set(['node_modules', 'dist', '.wrangler', '.astro', '.git', 'test-results', 'playwright-report']);
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  if (SKIP.has(f)) return [];
  const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p];
});
const ALL = walk('.');
const ignored = (file: string): boolean | null => { try { execFileSync('git', ['check-ignore', '-q', file], { stdio: 'ignore' }); return true; } catch (e: any) { return e.status === 1 ? false : null; } };

test.describe('.gitignore', () => {
  const gi = existsSync('.gitignore') ? readFileSync('.gitignore', 'utf8').split('\n').map((l) => l.trim()) : [];
  test('exists, and lists everything that must stay out of the repository', () => {
    expect(existsSync('.gitignore'), 'there is no .gitignore: .dev.vars (secrets) could be committed by "git add ."').toBe(true);
    for (const must of ['.dev.vars', 'node_modules', 'dist', '.wrangler', '.env', '*.pem', '*.key', 'test-results', 'tests/.auth']) expect(gi, `.gitignore should list ${must}`).toContain(must);
    expect(gi).toContain('!.dev.vars.example');
  });
  test('the example env file is committed and holds no real values', () => {
    expect(existsSync('.dev.vars.example')).toBe(true);
    for (const line of readFileSync('.dev.vars.example', 'utf8').split('\n')) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (!m) continue;                      // commented-out lines are documentation
      expect(m[2], `${m[1]} in .dev.vars.example must be a placeholder`).toMatch(/^(change-me[\w-]*|)$/);
    }
    expect(readFileSync('.dev.vars.example', 'utf8')).toContain('RATE_LIMIT_SALT');
  });
});

test.describe('secret-looking files', () => {
  test('any that exist locally are ignored by git (so "git add ." cannot take them)', () => {
    const risky = ALL.filter((f) => /(^|\/)(\.dev\.vars(\.[\w-]+)?|\.env(\.[\w-]+)?|id_rsa[\w.]*|[^/]+\.(pem|key|p12))$/.test(f) && !/\.example$/.test(f));
    const exposed = risky.filter((f) => ignored(f) === false);
    expect(exposed, 'these files are NOT ignored by git').toEqual([]);
  });
  test('git tracks no secret file (when this is a git checkout with history)', () => {
    let tracked: string[] = [];
    try { tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean); } catch { test.skip(true, 'not a git checkout'); }
    expect(tracked.filter((f) => /(^|\/)(\.dev\.vars|\.env(\.[\w-]+)?|[^/]+\.(pem|key|p12))$/.test(f) && !/\.example$/.test(f))).toEqual([]);
  });
});

test.describe('no secrets inside the code', () => {
  // Real code and configuration. (The older scripts/ folder contains deliberately WRONG tokens that its checks assert are refused, so it is
  // covered by the exact-format patterns only, not by the generic "looks like a credential" one.)
  const CODE = ALL.filter((f) => /^(\.\/)?(src|migrations|scripts)\//.test(f) || /(^|\/)(wrangler\.jsonc|astro\.config\.mjs|package\.json|README\.md|\.dev\.vars\.example)$/.test(f));
  const PATTERNS: [string, RegExp][] = [
    ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/], ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/], ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
    ['Stripe live key', /\b[sr]k_live_[A-Za-z0-9]{10,}\b/], ['Cloudflare Turnstile secret', /\b0x4[A-Za-z0-9_-]{30,}\b/],
    ['Cloudflare API token', /\b[A-Za-z0-9_-]{40}\b(?=.{0,30}(?:cloudflare|CF_API))/i],
    ['hard-coded credential', /\b(?:secret|token|password|passwd|api[_-]?key|salt)\w*['"]?\s*[:=]\s*['"][A-Za-z0-9+/_\-=]{20,}['"]/i],
  ];
  test('scanned a sensible number of files', () => expect(CODE.length).toBeGreaterThan(60));
  for (const [name, re] of PATTERNS) {
    test(`none contains a ${name}`, () => {
      const generic = name === 'hard-coded credential';
      const hits = CODE.filter((f) => !/package-lock\.json$/.test(f) && !(generic && /^(\.\/)?scripts\//.test(f))).flatMap((f) => readFileSync(f, 'utf8').split('\n').flatMap((l, i) => (re.test(l) ? [`${f}:${i + 1}`] : [])));
      expect(hits).toEqual([]);
    });
  }
  test('wrangler.jsonc keeps no secret in its plain-text vars (secrets belong in `wrangler secret put`)', () => {
    const cfg = JSON.parse(stripJsonc(readFileSync('wrangler.jsonc', 'utf8')));
    const vars = Object.keys(cfg.vars ?? {}).concat(Object.keys(cfg.env?.production?.vars ?? {}));
    const secretish = vars.filter((k) => /SECRET|TOKEN|PASSWORD|SALT|PRIVATE/i.test(k) || (/KEY/i.test(k) && k !== 'TURNSTILE_SITE_KEY'));
    expect(secretish, 'secret-looking names found among plain-text vars').toEqual([]);
  });
  test('the committed database_id is an identifier, not a credential (informational: it cannot be used without an account login)', () => {
    expect(readFileSync('wrangler.jsonc', 'utf8')).toMatch(/database_id/);
  });
});
