import type { APIRoute } from 'astro';
import { assetInUse, deleteAsset, getAsset } from '../../../../lib/assets';

export const POST: APIRoute = async ({ request, url }) => {
  const id = String((await request.formData()).get('id') ?? '');
  const to = (k: string, m: string) => new Response(null, { status: 303, headers: { Location: `/dashboard/assets?${k}=${encodeURIComponent(m)}` } });
  const a = await getAsset(id);                       // loaded once and handed on (it used to be loaded twice)
  if (!a) return to('ok', 'Deleted.');
  const why = await assetInUse(id, a);
  if (why) return to('error', `Can't delete: ${why}. Change it in Site settings first.`);
  await deleteAsset(id, url.origin, a);
  return to('ok', 'Deleted.');
};
