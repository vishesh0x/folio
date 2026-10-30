import type { APIRoute } from 'astro';
import { cachedMedia, canResize, originalResponse, variantResponse, loadAsset, variantOf, ASSET_ID } from '../../../lib/media';

// /media/<id>/<filename>              original file
// /media/<id>/<filename>?w=800&f=webp  resized (width snapped to a fixed list, never upscaled, never cropped)
// Only the id and the snapped width/format decide what is served or cached. The file name is for humans (and the download name).
export const GET: APIRoute = async ({ request, params, url }) => {
  const id = params.id ?? '';
  if (!ASSET_ID.test(id)) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } }); // never touches the database
  const v = variantOf(url.searchParams);
  return cachedMedia(request, id, v, async () => {
    const a = await loadAsset(id);
    if (!a) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    if (v && canResize(a)) {
      const res = await variantResponse(a, v);                  // from R2 if it was made before; otherwise made now, and kept
      if (res) return res;
      const stand = await originalResponse(a, request);         // the resized copy could not be made (for instance the transformation allowance is used up)
      if (stand.status === 200) stand.headers.set('X-Degraded', '1');
      return stand;
    }
    return originalResponse(a, request);
  });
};
