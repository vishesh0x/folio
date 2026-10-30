import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getPublicSettings } from '../lib/settings';
import { versionedCache } from '../lib/content-version';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

// Lists the pages worth indexing. Anything you marked "hide from search engines" in Dashboard → SEO is left out,
// and so are draft projects.
export const GET: APIRoute = ({ url }) => versionedCache(url.origin, 'sitemap.xml', 3600, async () => {
  const s = await getPublicSettings();
  const origin = (s.site_url || url.origin).replace(/\/$/, '');
  const hidden = new Set((await env.DB.prepare('SELECT page FROM seo_pages WHERE noindex = 1').all<{ page: string }>()).results.map((r) => r.page));
  const projects = (await env.DB.prepare("SELECT slug, updated_at FROM projects WHERE status = 'published' ORDER BY sort_order, created_at DESC").all<{ slug: string; updated_at: number }>()).results;
  const nowUpdated = (await env.DB.prepare('SELECT max(updated_at) AS t FROM now_items').first<{ t: number | null }>())?.t ?? 0;
  const newest = Math.max(0, ...projects.map((p) => p.updated_at));

  const pages: { key: string; path: string; lastmod?: number }[] = [
    { key: 'home', path: '/', lastmod: newest || undefined },
    { key: 'projects', path: '/projects', lastmod: newest || undefined },
    { key: 'now', path: '/now', lastmod: nowUpdated || undefined },
    { key: 'resume', path: '/resume' },
    { key: 'contact', path: '/contact' },
  ];
  const entries = [
    ...pages.filter((p) => !hidden.has(p.key)).map((p) => ({ loc: p.path, lastmod: p.lastmod })),
    ...projects.map((p) => ({ loc: `/projects/${p.slug}`, lastmod: p.updated_at })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries.map((e) => `  <url><loc>${esc(origin + e.loc)}</loc>${e.lastmod ? `<lastmod>${day(e.lastmod)}</lastmod>` : ''}</url>`).join('\n') + `\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}); // built from 4 database queries; kept at the edge until the next dashboard save
