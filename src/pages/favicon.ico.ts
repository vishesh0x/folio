import type { APIRoute } from 'astro';
import { getSettings } from '../lib/settings';
import { loadAsset } from '../lib/media';

// Browsers (and many crawlers) request /favicon.ico no matter what <link> tags say, so answer it properly.
export const GET: APIRoute = async ({ redirect }) => {
  const s = await getSettings();
  const a = await loadAsset(s.favicon_asset ?? undefined);
  const v = a?.id ?? 'default';
  const target = a && a.mime !== 'image/svg+xml' ? `/icons/48.png?v=${v}` : `/icons/favicon.svg?v=${v}`;
  return redirect(target, 302);
};
