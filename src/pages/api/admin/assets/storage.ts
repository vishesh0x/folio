import type { APIRoute } from 'astro';
import { storageReport, removeStrays, scrubMetadata } from '../../../../lib/storage-check';

// Owner-only (the middleware requires a session and a same-origin request for everything under /api/admin).
//   POST action=check                    report: how many files, how big, which are stray, which entries are broken
//   POST action=clean                    delete the stray files (never anything the database knows about)
//   POST action=scrub [offset]           remove location/camera data from pictures uploaded before uploads were cleaned automatically (in batches: repeat with `next`)
// `min_age` (seconds, default 3600) is how old a stray file must be before it counts, so an upload in progress is never touched.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request, url }) => {
  let form: FormData;
  try { form = await request.formData(); } catch { return json({ ok: false, error: 'Unreadable request.' }, 400); }
  const action = String(form.get('action') ?? 'check');
  const raw = Number(form.get('min_age') ?? 3600);
  const minAge = Number.isFinite(raw) ? Math.min(86400, Math.max(0, Math.floor(raw))) : 3600;
  if (action === 'check') return json({ ok: true, ...(await storageReport(minAge)) });
  if (action === 'clean') return json({ ok: true, ...(await removeStrays(minAge)) });
  if (action === 'scrub') { const o = Number(form.get('offset') ?? 0); return json({ ok: true, ...(await scrubMetadata(url.origin, Number.isFinite(o) && o >= 0 ? Math.floor(o) : 0)) }); }
  return json({ ok: false, error: 'Unknown action.' }, 400);
};
