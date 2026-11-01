import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Step 9: what you install is what you run. These read package.json and package-lock.json (no network).
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')), pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const entries = Object.entries<any>(lock.packages).filter(([k]) => k !== '');

test('every installed package comes from the npm registry, with an integrity hash; none from a git address or a local path', () => {
  const odd = entries.filter(([, v]) => !v.link && (!v.resolved || !/^https:\/\/registry\.npmjs\.org\//.test(v.resolved) || !/^sha(256|384|512)-/.test(v.integrity ?? ''))).map(([k]) => k);
  expect(odd).toEqual([]);
});

test('the only packages that run a program when installed are the ones that must (build tools and the local Worker runtime)', () => {
  const allowed = new Set(['esbuild', 'fsevents', 'workerd', 'sharp']);
  const found = entries.filter(([, v]) => v.hasInstallScript).map(([k]) => k.split('node_modules/').pop()!);
  expect(found.filter((n) => !allowed.has(n)), 'a new package that runs an install script: read it before allowing it').toEqual([]);
});

test('what is deployed has few direct dependencies, and tools used only in tests stay out of "dependencies"', () => {
  expect(Object.keys(pkg.dependencies).sort()).toEqual(['@astrojs/cloudflare', '@fontsource-variable/jetbrains-mono', 'astro', 'highlight.js', 'marked', 'mermaid', 'wrangler']);
  expect(Object.keys(pkg.devDependencies).sort()).toEqual(['@axe-core/playwright', '@playwright/test']);
});

test('packages that can change what a visitor sees or runs in the browser are pinned to one exact version', () => {
  for (const name of ['mermaid']) expect(pkg.dependencies[name], name).toMatch(/^\d+\.\d+\.\d+$/);
  for (const name of ['@axe-core/playwright']) expect(pkg.devDependencies[name], name).toMatch(/^\d+\.\d+\.\d+$/);
});

test('the lockfile and package.json agree (nothing was installed without being recorded)', () => {
  const root = lock.packages[''];
  expect(root.dependencies).toEqual(pkg.dependencies); expect(root.devDependencies).toEqual(pkg.devDependencies);
});
