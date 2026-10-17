import type { APIRoute } from 'astro';
import { saveUpload, assetView, deleteAsset } from '../../../../lib/assets';

// Used by the upload boxes inside the editors (project cover, portrait, resume PDF, Markdown images…).
// Same rules as the Assets page (file type is checked from the bytes, SVGs are cleaned, size limits, alt text required for
// images), but it answers with JSON instead of redirecting, so the editor you are in never reloads.
// `expect` is optional: "image" or "pdf" makes a field refuse the wrong kind of file instead of accepting then ignoring it.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request, url }) => {
  let form: FormData;
  try { form = await request.formData(); } catch { return json({ ok: false, error: 'The upload could not be read. Try again.' }, 400); }
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return json({ ok: false, error: 'Choose a file first.' }, 400);
  const expect = String(form.get('expect') ?? '');
  const r = await saveUpload(file, String(form.get('alt') ?? '').trim(), form.get('decorative') === 'on' || form.get('decorative') === 'true');
  if (!r.ok) return json({ ok: false, error: r.error }, 400);
  const kind = assetView(r.asset).kind;
  if ((expect === 'pdf' && kind !== 'pdf') || (expect === 'image' && kind !== 'image')) {
    await deleteAsset(r.asset.id, url.origin); // do not leave a file behind that this field refused
    return json({ ok: false, error: expect === 'pdf' ? 'That field needs a PDF.' : 'That field needs an image (PNG, JPEG, WebP, AVIF, GIF or SVG).' }, 400);
  }
  return json({ ok: true, asset: assetView(r.asset) });
};
