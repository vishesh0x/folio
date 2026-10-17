import type { APIRoute } from 'astro';
import { cached, canResize, snapWidth, originalResponse, resizedResponse, loadAsset, FORMATS, type Fmt } from '../../../lib/media';

// /media/<id>/<filename>              original file
// /media/<id>/<filename>?w=800&f=webp  resized (width snapped to a fixed list, never upscaled, never cropped)
export const GET: APIRoute = async ({ request, params, url }) => {
  return cached(request, async () => {
    const a = await loadAsset(params.id);
    if (!a) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const w = Number(url.searchParams.get('w'));
    const f = url.searchParams.get('f') as Fmt | null;
    if (w > 0 && f && f in FORMATS && canResize(a)) {
      const res = await resizedResponse(a, { width: snapWidth(w), fit: 'scale-down', fmt: f });
      if (res) return res;
    }
    return originalResponse(a, request);
  });
};
