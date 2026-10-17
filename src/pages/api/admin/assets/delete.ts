import type { APIRoute } from 'astro';
import { assetInUse, deleteAsset } from '../../../../lib/assets';

export const POST: APIRoute = async ({ request, url }) => {
  const id = String((await request.formData()).get('id') ?? '');
  const to = (k: string, m: string) => new Response(null, { status: 303, headers: { Location: `/dashboard/assets?${k}=${encodeURIComponent(m)}` } });
  const why = await assetInUse(id);
  if (why) return to('error', `Can't delete: ${why}. Change it in Site settings first.`);
  await deleteAsset(id, url.origin);
  return to('ok', 'Deleted.');
};
