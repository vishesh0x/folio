import type { APIRoute } from 'astro';
import { getPublicSettings } from '../lib/settings';
import { loadAsset } from '../lib/media';
import { versionedCache } from '../lib/content-version';

export const GET: APIRoute = ({ url }) => versionedCache(url.origin, 'manifest', 3600, async () => {
  const s = await getPublicSettings();
  const a = await loadAsset(s.favicon_asset ?? undefined);
  const raster = a && a.mime !== 'image/svg+xml' && a.mime !== 'image/x-icon';
  const v = a?.id ?? 'default';
  const icons = raster
    ? [192, 512].map((n) => ({ src: `/icons/${n}.png?v=${v}`, sizes: `${n}x${n}`, type: 'image/png', purpose: 'any' }))
    : [{ src: `/icons/favicon.svg?v=${v}`, sizes: 'any', type: 'image/svg+xml' }];
  return new Response(JSON.stringify({ name: s.name, short_name: s.name.slice(0, 12), start_url: '/', display: 'standalone', background_color: '#f7f7f4', theme_color: '#e43d12', icons }), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' },
  });
});
