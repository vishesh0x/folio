import type { APIRoute } from 'astro';
import { saveUpload } from '../../../../lib/assets';

const back = (kind: 'ok' | 'error', msg: string) => new Response(null, { status: 303, headers: { Location: `/dashboard/assets?${kind}=${encodeURIComponent(msg)}` } });

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return back('error', 'Choose a file first.');
  const r = await saveUpload(file, String(form.get('alt') ?? '').trim(), form.get('decorative') === 'on');
  return r.ok ? back('ok', `Uploaded ${r.asset.filename}`) : back('error', r.error);
};
