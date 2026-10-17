import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getAsset, isImage } from '../../../../lib/assets';

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const a = await getAsset(String(form.get('id') ?? ''));
  const to = (k: string, m: string) => new Response(null, { status: 303, headers: { Location: `/dashboard/assets?${k}=${encodeURIComponent(m)}` } });
  if (!a) return to('error', 'Asset not found.');
  const alt = String(form.get('alt') ?? '').trim().slice(0, 300);
  const decorative = form.get('decorative') === 'on';
  if (isImage(a.mime) && !alt && !decorative) return to('error', 'Add alt text, or tick “decorative”.');
  await env.DB.prepare('UPDATE assets SET alt = ?, decorative = ? WHERE id = ?').bind(alt, decorative ? 1 : 0, a.id).run();
  return to('ok', 'Alt text saved.');
};
