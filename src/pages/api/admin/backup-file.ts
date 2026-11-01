import type { APIRoute } from 'astro';
import { saveUpload, getAsset } from '../../../lib/assets';
import { forgetMissing } from '../../../lib/media';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

// POST /api/admin/backup-file (multipart: file, id, alt, decorative, created_at, dryRun)
// Puts one file of a backup back under the id it had (project texts refer to files by id). It goes through the SAME checks as any upload (what the
// bytes really are, size, metadata removed, SVG made safe). A file whose id already exists is left alone: an import never overwrites or deletes files.
export const POST: APIRoute = async ({ request, url }) => {
  const f = await request.formData();
  const file = f.get('file'), id = String(f.get('id') ?? '');
  if (!(file instanceof File) || !/^[A-Za-z0-9_-]{12}$/.test(id)) return json({ ok: false, error: 'A file and its id are needed.' }, 400);
  if (await getAsset(id)) return json({ ok: true, skipped: true });
  const r = await saveUpload(file, String(f.get('alt') ?? ''), f.get('decorative') === '1', { id, createdAt: Number(f.get('created_at')) || undefined });
  if (!r.ok) return json({ ok: false, error: r.error }, 400);
  try { await forgetMissing(url.origin, id); } catch { /* it expires by itself within a minute */ }
  return json({ ok: true, added: true });
};
