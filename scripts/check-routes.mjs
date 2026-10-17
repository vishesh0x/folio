// Fails if src/pages contains a route that is not on the list below.
// Catches leftover test pages and debug endpoints before they get deployed.  Run: npm run check:routes
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const EXPECTED = new Set([
  '404.astro', '500.astro', 'contact.astro', 'favicon.ico.ts', 'index.astro', 'manifest.webmanifest.ts', 'now.astro', 'robots.txt.ts', 'sitemap.xml.ts',
  'api/reveal.ts', 'auth/index.astro', 'auth/logout.ts', 'error/403.astro', 'icons/[file].ts', 'media/[id]/[...name].ts',
  'projects/index.astro', 'projects/[slug].astro', 'resume/index.astro', 'resume/download.ts',
  'api/admin/assets/delete.ts', 'api/admin/assets/index.ts', 'api/admin/assets/update.ts', 'api/admin/assets/upload.ts', 'api/admin/inbox.ts', 'api/admin/now.ts',
  'api/admin/preview.ts', 'api/admin/projects.ts', 'api/admin/projects/[id]/export.ts',
  'dashboard/assets.astro', 'dashboard/index.astro', 'dashboard/now.astro', 'dashboard/resume.astro', 'dashboard/seo.astro', 'dashboard/settings.astro',
  'dashboard/inbox/[id].astro', 'dashboard/inbox/index.astro', 'dashboard/projects/[id].astro', 'dashboard/projects/index.astro',
]);
const root = 'src/pages';
const found = [];
(function walk(dir) { for (const f of readdirSync(dir)) { const p = join(dir, f); statSync(p).isDirectory() ? walk(p) : found.push(relative(root, p).replaceAll('\\', '/')); } })(root);
const extra = found.filter((f) => !EXPECTED.has(f)), missing = [...EXPECTED].filter((f) => !found.includes(f));
if (extra.length) console.error('Unexpected pages (delete them, or add them to scripts/check-routes.mjs on purpose):\n  ' + extra.join('\n  '));
if (missing.length) console.error('Expected pages are missing:\n  ' + missing.join('\n  '));
if (extra.length || missing.length) process.exit(1);
console.log(`OK: ${found.length} routes, all expected.`);
