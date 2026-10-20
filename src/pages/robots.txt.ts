import type { APIRoute } from 'astro';
import { getSettings } from '../lib/settings';
import { versionedCache } from '../lib/content-version';

export const GET: APIRoute = ({ url }) => versionedCache(url.origin, 'robots.txt', 3600, async () => {
  const s = await getSettings();
  const origin = (s.site_url || url.origin).replace(/\/$/, '');
  const body = [
    'User-agent: *',
    'Disallow: /dashboard',
    'Disallow: /auth',
    'Disallow: /api/',
    'Disallow: /error/',
    'Disallow: /resume/download',
    'Disallow: /*.pdf$',
    'Allow: /',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
});
