import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getPublicSettings } from '../../lib/settings';
import { getAsset } from '../../lib/assets';
import { getResumeOpts } from '../../lib/resume';

// The PDF is served from here, so the page never links to its file address, and search engines are told not to index it.
export const GET: APIRoute = async () => {
  const [s, o] = await Promise.all([getPublicSettings(), getResumeOpts()]);
  const a = s.resume_asset ? await getAsset(s.resume_asset) : null;
  const obj = a && a.mime === 'application/pdf' ? await env.ASSETS_BUCKET.get(a.r2_key) : null;
  if (!a || !obj) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const nice = ((o.name || s.name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Resume') + '-Resume.pdf';
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${nice}"`,
      'Content-Length': String(a.size),
      'Cache-Control': 'public, max-age=300',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
