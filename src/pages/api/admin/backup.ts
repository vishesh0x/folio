import type { APIRoute } from 'astro';
import { exportPart, importSite, importProjects, importResumeSection, importNowCategory, importMessages, clearProjects, FORMAT, VERSION } from '../../../lib/backup';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

// Owner only (everything under /api/admin is behind the sign-in check and the same-origin check in the middleware).
// GET  /api/admin/backup?part=summary|site|projects|resume|now|assets|messages&after=<cursor>   one small JSON piece of the site
export const GET: APIRoute = async ({ url }) => {
  const after = Number(url.searchParams.get('after') ?? 0);
  const out = await exportPart(url.searchParams.get('part') ?? '', Number.isFinite(after) && after >= 0 ? after : 0);
  return out ? json({ format: FORMAT, version: VERSION, ...out }) : json({ ok: false, error: 'Unknown part.' }, 400);
};

// POST /api/admin/backup   { part, mode?, dryRun?, first?, ... }   one small piece in. `dryRun` checks everything and writes nothing.
export const POST: APIRoute = async ({ request }) => {
  let b: any; try { b = await request.json(); } catch { return json({ ok: false, error: 'That was not valid JSON.' }, 400); }
  if (!b || typeof b !== 'object') return json({ ok: false, error: 'Nothing to import.' }, 400);
  const dry = b.dryRun === true, mode = b.mode === 'add' ? 'add' : 'replace';
  switch (b.part) {
    case 'site': return json(await importSite(b, dry));
    case 'clear-projects': return json(await clearProjects(dry));
    case 'projects': return json(await importProjects(b, mode, dry));
    case 'resume-section': return json(await importResumeSection(b, b.first === true, dry));
    case 'now-category': return json(await importNowCategory(b, b.first === true, dry));
    case 'messages': return json(await importMessages(b, dry));
  }
  return json({ ok: false, error: 'Unknown part.' }, 400);
};
