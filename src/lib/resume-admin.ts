import { env } from 'cloudflare:workers';
import { KINDS, KIND_TITLE, cleanEntryData, httpUrl, str, type Kind } from './resume';

export const MAX_SECTIONS = 15, MAX_ENTRIES = 40;
export type BEntry = { id: number; project_id: number | null; visible: number; d: Record<string, any> };
export type BSection = { id: number; kind: Kind; title: string; visible: number; entries: BEntry[] };
export type PickProject = { id: number; title: string; slug: string; status: string };

export async function loadBuilder() {
  const rows = (await env.DB.prepare(
    `SELECT s.id AS sid, s.kind, s.title, s.visible AS svis, e.id AS eid, e.project_id, e.data, e.visible AS evis
     FROM resume_sections s LEFT JOIN resume_entries e ON e.section_id = s.id ORDER BY s.sort_order, s.id, e.sort_order, e.id`
  ).all<any>()).results;
  const sections: BSection[] = [];
  for (const r of rows) {
    if (!(KINDS as readonly string[]).includes(r.kind)) continue;
    let sec = sections.find((x) => x.id === r.sid);
    if (!sec) { sec = { id: r.sid, kind: r.kind, title: r.title, visible: r.svis, entries: [] }; sections.push(sec); }
    if (r.eid == null) continue;
    let data: unknown = {}; try { data = JSON.parse(r.data ?? '{}'); } catch {}
    sec.entries.push({ id: r.eid, project_id: r.project_id, visible: r.evis, d: cleanEntryData(r.project_id ? 'projects' : sec.kind, data) });
  }
  const projects = (await env.DB.prepare('SELECT id, title, slug, status FROM projects ORDER BY sort_order, created_at DESC, id DESC').all<PickProject>()).results;
  return { sections, projects };
}

/* ───── turning a posted form into clean entry data ───── */
const line = (f: FormData, k: string, max: number) => String(f.get(k) ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const text = (f: FormData, k: string, max: number) => String(f.get(k) ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const lines = (f: FormData, k: string) => text(f, k, 6000).split('\n').map((l) => l.replace(/^[\s•*-]+/, '').trim()).filter(Boolean);

export function entryFromForm(kind: Kind, f: FormData): { data?: Record<string, any>; error?: string } {
  let raw: Record<string, unknown>, need: string | null = null;
  switch (kind) {
    case 'summary': raw = { text: text(f, 'text', 3000) }; if (!(raw.text as string)) need = 'Write the summary text.'; break;
    case 'experience': {
      const current = f.get('current') === 'on';
      raw = { role: line(f, 'role', 120), company: line(f, 'company', 120), location: line(f, 'location', 120), start: line(f, 'start', 30), end: current ? '' : line(f, 'end', 30), current, description: text(f, 'description', 1200), bullets: lines(f, 'bullets') };
      if (!raw.role && !raw.company) need = 'Add a role or a company.'; break;
    }
    case 'education': raw = { degree: line(f, 'degree', 160), school: line(f, 'school', 160), location: line(f, 'location', 120), start: line(f, 'start', 30), end: line(f, 'end', 30), details: text(f, 'details', 800) };
      if (!raw.degree && !raw.school) need = 'Add a degree or a school.'; break;
    case 'skills': raw = { group: line(f, 'group', 80), items: line(f, 'items', 600) }; if (!raw.items) need = 'List at least one skill, separated by commas.'; break;
    case 'certifications': {
      const url = line(f, 'url', 500);
      raw = { name: line(f, 'name', 160), issuer: line(f, 'issuer', 120), date: line(f, 'date', 30), url };
      if (!raw.name) need = 'Add the name of the certification.';
      else if (url && !httpUrl(url)) need = 'The link must be a full address starting with https://';
      break;
    }
    case 'projects': raw = { blurb: line(f, 'blurb', 400) }; break;
    default: raw = { heading: line(f, 'heading', 160), subheading: line(f, 'subheading', 160), date: line(f, 'date', 40), text: text(f, 'text', 2000), bullets: lines(f, 'bullets') };
      if (!raw.heading && !raw.text) need = 'Add a heading or some text.';
  }
  return need ? { error: need } : { data: cleanEntryData(kind, raw) };
}

/* ───── sections ───── */
const renumber = (table: 'resume_sections' | 'resume_entries', ids: number[]) =>
  env.DB.batch(ids.map((id, n) => env.DB.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`).bind(n, id)));

export async function addSection(kind: string, title: string): Promise<string | null> {
  if (!(KINDS as readonly string[]).includes(kind)) return 'Choose what kind of section to add.';
  const info = (await env.DB.prepare('SELECT count(*) AS n, coalesce(max(sort_order), -1) AS m FROM resume_sections').first<{ n: number; m: number }>())!;
  if (info.n >= MAX_SECTIONS) return `A resume can have at most ${MAX_SECTIONS} sections.`;
  await env.DB.prepare('INSERT INTO resume_sections (kind, title, visible, sort_order) VALUES (?, ?, 1, ?)').bind(kind, str(title, 80) || KIND_TITLE[kind], info.m + 1).run();
  return null;
}
export async function starterLayout(): Promise<string | null> {
  if ((await env.DB.prepare('SELECT count(*) AS n FROM resume_sections').first<{ n: number }>())!.n > 0) return 'You already have sections.';
  for (const k of ['summary', 'experience', 'education', 'skills', 'projects'] as const) await addSection(k, KIND_TITLE[k]);
  return null;
}
export const renameSection = async (id: number, title: string) => (await env.DB.prepare('UPDATE resume_sections SET title = ? WHERE id = ?').bind(str(title, 80), id).run()).meta.changes > 0;
export const setSectionVisible = async (id: number, v: boolean) => (await env.DB.prepare('UPDATE resume_sections SET visible = ? WHERE id = ?').bind(v ? 1 : 0, id).run()).meta.changes > 0;
export const deleteSection = async (id: number) => (await env.DB.prepare('DELETE FROM resume_sections WHERE id = ?').bind(id).run()).meta.changes > 0; // its entries go with it
export async function moveSection(id: number, dir: 'up' | 'down'): Promise<boolean> {
  const ids = (await env.DB.prepare('SELECT id FROM resume_sections ORDER BY sort_order, id').all<{ id: number }>()).results.map((r) => r.id);
  const i = ids.indexOf(id), j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0) return false;
  if (j < 0 || j >= ids.length) return true;
  [ids[i], ids[j]] = [ids[j], ids[i]]; await renumber('resume_sections', ids); return true;
}

/* ───── entries ───── */
export async function addEntry(sectionId: number, data: Record<string, any>, projectId: number | null): Promise<string | null> {
  const sec = await env.DB.prepare('SELECT kind FROM resume_sections WHERE id = ?').bind(sectionId).first<{ kind: string }>();
  if (!sec) return 'That section no longer exists.';
  if ((sec.kind === 'projects') !== (projectId !== null)) return 'That does not belong in this kind of section.';
  const info = (await env.DB.prepare('SELECT count(*) AS n, coalesce(max(sort_order), -1) AS m FROM resume_entries WHERE section_id = ?').bind(sectionId).first<{ n: number; m: number }>())!;
  if (info.n >= MAX_ENTRIES) return `A section can hold at most ${MAX_ENTRIES} entries.`;
  if (projectId !== null) {
    if (!(await env.DB.prepare('SELECT 1 AS x FROM projects WHERE id = ?').bind(projectId).first())) return 'That project no longer exists.';
    if (await env.DB.prepare('SELECT 1 AS x FROM resume_entries WHERE section_id = ? AND project_id = ?').bind(sectionId, projectId).first()) return 'That project is already in this section.';
  }
  await env.DB.prepare('INSERT INTO resume_entries (section_id, project_id, data, visible, sort_order) VALUES (?, ?, ?, 1, ?)').bind(sectionId, projectId, JSON.stringify(data), info.m + 1).run();
  return null;
}
export const updateEntry = async (id: number, data: Record<string, any>) => (await env.DB.prepare('UPDATE resume_entries SET data = ? WHERE id = ?').bind(JSON.stringify(data), id).run()).meta.changes > 0;
export const setEntryVisible = async (id: number, v: boolean) => (await env.DB.prepare('UPDATE resume_entries SET visible = ? WHERE id = ?').bind(v ? 1 : 0, id).run()).meta.changes > 0;
export const deleteEntry = async (id: number) => (await env.DB.prepare('DELETE FROM resume_entries WHERE id = ?').bind(id).run()).meta.changes > 0;
export const entryKind = async (id: number) => (await env.DB.prepare('SELECT s.kind, e.project_id, e.section_id FROM resume_entries e JOIN resume_sections s ON s.id = e.section_id WHERE e.id = ?').bind(id).first<{ kind: Kind; project_id: number | null; section_id: number }>());
export async function moveEntry(id: number, dir: 'up' | 'down'): Promise<boolean> {
  const me = await env.DB.prepare('SELECT section_id FROM resume_entries WHERE id = ?').bind(id).first<{ section_id: number }>();
  if (!me) return false;
  const ids = (await env.DB.prepare('SELECT id FROM resume_entries WHERE section_id = ? ORDER BY sort_order, id').bind(me.section_id).all<{ id: number }>()).results.map((r) => r.id);
  const i = ids.indexOf(id), j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= ids.length) return true;
  [ids[i], ids[j]] = [ids[j], ids[i]]; await renumber('resume_entries', ids); return true;
}

export const sectionKind = async (id: number) => (await env.DB.prepare('SELECT kind FROM resume_sections WHERE id = ?').bind(id).first<{ kind: Kind }>())?.kind ?? null;
