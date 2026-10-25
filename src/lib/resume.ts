import { env } from 'cloudflare:workers';

/* ───────── Options (what the visitor sees, and how contact details are protected) ───────── */
export type ContactMode = 'reveal' | 'hidden' | 'plain';
export type ResumeOpts = {
  name: string;                // the name printed at the top of the resume; empty uses the site name (Settings)
  headline: string;            // e.g. "Senior frontend engineer"; falls back to the site tagline
  show_email: boolean; show_phone: boolean; show_location: boolean; show_socials: boolean; show_download: boolean;
  layout: 'two' | 'one';       // two = main column + side column (default), one = a single column
  print_reveal: boolean;       // the "Print this page" button first reveals email/phone, so the printed copy has them
  contact_mode: ContactMode;   // reveal = click to show (default) | hidden = not shown, point to contact form | plain = written into the page (scrapable)
};
export const RESUME_DEFAULTS: ResumeOpts = {
  name: '', headline: '', layout: 'two', print_reveal: false, show_email: true, show_phone: false, show_location: true, show_socials: true, show_download: true, contact_mode: 'reveal',
};
export async function getResumeOpts(): Promise<ResumeOpts> {
  // A database failure fails the request; it must not fall back to default contact-visibility settings on a page that gets cached.
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = 'resume_opts'").first<{ value: string }>();
  let saved = {}; try { if (r) saved = JSON.parse(r.value); } catch {}
  const o = { ...RESUME_DEFAULTS, ...saved };
  if (!['reveal', 'hidden', 'plain'].includes(o.contact_mode)) o.contact_mode = 'reveal';
  if (o.layout !== 'one') o.layout = 'two';
  o.print_reveal = o.print_reveal === true;
  o.name = typeof o.name === 'string' ? o.name.trim().slice(0, 80) : '';
  return o;
}
export async function saveResumeOpts(o: ResumeOpts) {
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('resume_opts', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1").bind(JSON.stringify(o)).run();
}

/* ───────── Content ─────────
   Each section has a `kind`, and each entry keeps its fields as JSON:
   summary        { text }
   experience     { role, company, location, start, end, current, description, bullets[] }
   education      { degree, school, location, start, end, details }
   skills         { group, items }                     items = comma separated
   certifications { name, issuer, date, url }
   projects       (linked to a project in your Projects section; optional { blurb } overrides its summary)
   custom         { heading, subheading, date, text, bullets[] }                                        */
export const KINDS = ['summary', 'experience', 'education', 'skills', 'certifications', 'projects', 'custom'] as const;
export const KIND_LABEL: Record<string, string> = { summary: 'Summary', experience: 'Experience', education: 'Education', skills: 'Skills', certifications: 'Certifications', projects: 'Projects', custom: 'Custom section' };
export const KIND_TITLE: Record<string, string> = { summary: 'Summary', experience: 'Experience', education: 'Education', skills: 'Skills', certifications: 'Certifications', projects: 'Selected projects', custom: 'More' };
export type Kind = (typeof KINDS)[number];

export type LinkedProject = { slug: string; title: string; summary: string; tags: string[]; live_url: string | null; source_url: string | null };
export type Entry = { id: number; d: Record<string, any>; project: LinkedProject | null };
export type Section = { id: number; kind: Kind; title: string; entries: Entry[] };

export const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 400)).filter(Boolean).slice(0, 30) : []);
export const httpUrl = (u: unknown) => { const s = str(u, 500); return /^https?:\/\//i.test(s) ? s : ''; };

export function cleanEntryData(kind: Kind, raw: any): Record<string, any> {
  const r = raw && typeof raw === 'object' ? raw : {};
  switch (kind) {
    case 'summary': return { text: str(r.text, 3000) };
    case 'experience': return { role: str(r.role, 120), company: str(r.company, 120), location: str(r.location, 120), start: str(r.start, 30), end: str(r.end, 30), current: !!r.current, description: str(r.description, 1200), bullets: list(r.bullets) };
    case 'education': return { degree: str(r.degree, 160), school: str(r.school, 160), location: str(r.location, 120), start: str(r.start, 30), end: str(r.end, 30), details: str(r.details, 800) };
    case 'skills': return { group: str(r.group, 80), items: str(r.items, 600) };
    case 'certifications': return { name: str(r.name, 160), issuer: str(r.issuer, 120), date: str(r.date, 30), url: httpUrl(r.url) };
    case 'projects': return { blurb: str(r.blurb, 400) };
    default: return { heading: str(r.heading, 160), subheading: str(r.subheading, 160), date: str(r.date, 40), text: str(r.text, 2000), bullets: list(r.bullets) };
  }
}

export async function loadResume(): Promise<Section[]> {
  const rows = (await env.DB.prepare(
    `SELECT s.id AS sid, s.kind, s.title, e.id AS eid, e.project_id, e.data
     FROM resume_sections s LEFT JOIN resume_entries e ON e.section_id = s.id AND e.visible = 1
     WHERE s.visible = 1 ORDER BY s.sort_order, s.id, e.sort_order, e.id`
  ).all<{ sid: number; kind: string; title: string; eid: number | null; project_id: number | null; data: string | null }>()).results;

  const ids = [...new Set(rows.map((r) => r.project_id).filter((x): x is number => !!x))].slice(0, 90);
  const projects = new Map<number, LinkedProject>();
  if (ids.length) {
    const ps = (await env.DB.prepare(`SELECT id, slug, title, summary, tags, live_url, source_url FROM projects WHERE status = 'published' AND id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<any>()).results;
    for (const p of ps) {
      let tags: string[] = []; try { tags = JSON.parse(p.tags).filter((t: unknown) => typeof t === 'string'); } catch {}
      projects.set(p.id, { slug: p.slug, title: p.title, summary: p.summary, tags, live_url: httpUrl(p.live_url) || null, source_url: httpUrl(p.source_url) || null });
    }
  }

  const out: Section[] = [];
  for (const r of rows) {
    if (!(KINDS as readonly string[]).includes(r.kind)) continue;
    let sec = out.find((s) => s.id === r.sid);
    if (!sec) { sec = { id: r.sid, kind: r.kind as Kind, title: str(r.title, 80) || r.kind, entries: [] }; out.push(sec); }
    if (r.eid == null) continue;
    let data: unknown = {}; try { data = JSON.parse(r.data ?? '{}'); } catch {}
    if (r.project_id) {
      const project = projects.get(r.project_id);
      if (project) sec.entries.push({ id: r.eid, d: cleanEntryData('projects', data), project }); // unpublished or deleted projects quietly drop out
    } else if (sec.kind !== 'projects') {
      sec.entries.push({ id: r.eid, d: cleanEntryData(sec.kind, data), project: null });
    }
  }
  return out.filter((s) => s.entries.length > 0);
}
