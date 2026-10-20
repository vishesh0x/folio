import type { APIRoute } from 'astro';
import { getSettings } from '../lib/settings';
import { loadAsset } from '../lib/media';

// Browsers (and many crawlers) request /favicon.ico no matter what <link> tags say, so answer it properly.
export const GET: APIRoute = async ({ redirect }) => {
  const s = await getSettings();
  const a = await loadAsset(s.favicon_asset ?? undefined);
  const v = a?.id ?? 'default';
  const target = a && a.mime !== 'image/svg+xml' ? `/icons/48.png?v=${v}` : `/icons/favicon.svg?v=${v}`;
  const res = redirect(target, 302);
  res.headers.set('Cache-Control', 'public, max-age=3600'); // browsers ask for this on their own; do not make every one a fresh lookup
  return res;
};
