import type { APIRoute } from 'astro';
import defaultIcon from '../../assets/default-favicon.svg?raw';
import { cached, resizedResponse, originalResponse, loadAsset } from '../../lib/media';
import { getSettings } from '../../lib/settings';

const SIZES: Record<string, number> = { '32.png': 32, '48.png': 48, '180.png': 180, '192.png': 192, '512.png': 512 };
const LONG = 'public, max-age=31536000, immutable'; // safe: URLs carry ?v=<asset id>, so a new favicon is a new URL

export const GET: APIRoute = async ({ request, params }) => {
  const file = params.file!;
  return cached(request, async () => {
    const s = await getSettings();
    const a = await loadAsset(s.favicon_asset ?? undefined);

    if (file === 'favicon.svg') {
      if (a?.mime === 'image/svg+xml') return originalResponse(a, request);
      if (!a) return new Response(defaultIcon, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' } });
      return new Response('Not found', { status: 404 });
    }
    const size = SIZES[file];
    if (!size) return new Response('Not found', { status: 404 });
    // Raster favicons are padded to a square on a transparent background, never cropped.
    if (a && ['image/png', 'image/jpeg', 'image/webp', 'image/avif'].includes(a.mime)) {
      const res = await resizedResponse(a, { width: size, height: size, fit: 'pad', fmt: 'png', background: 'rgba(0,0,0,0)' });
      if (res) { res.headers.set('Cache-Control', LONG); return res; }
    }
    if (a && a.mime === 'image/x-icon') return originalResponse(a, request);
    return new Response('Not found', { status: 404 });
  });
};
