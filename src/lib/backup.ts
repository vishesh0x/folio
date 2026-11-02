// Backup and restore of the site's content: what the dashboard's "Backup & restore" page uses (the page builds and reads the zip file in the
// browser; the server only ever handles small JSON pieces, so no request comes near the Worker's CPU, memory or 50-call limits).
//
// What is NEVER exported or imported: the sign-in account (password hash), sessions, rate-limit counters, internal keys (content version, form secret).
// Importing is the same trust level as the dashboard (owner only), but a backup file may be old, edited or tampered with, so every value is checked
// with the SAME rules as the forms (limits, http(s)-only addresses, known sections and kinds); an item that fails is skipped and reported, never half-saved.
import { env } from 'cloudflare:workers';
import { getSettings, saveSettings, cleanUrl, MAX_SOCIALS, SETTINGS_DEFAULTS, type SiteSettings } from './settings';
import { LIMITS as PL, slugify } from './projects-admin';
import { validateEmail } from './auth';
import { KINDS, cleanEntryData, type Kind } from './resume';
import { MAX_SECTIONS, MAX_ENTRIES } from './resume-admin';
import { parseName, parseIcon, parseTitle, parseNote, MAX_CATEGORIES, MAX_ITEMS } from './now-admin';

export const FORMAT = 'folio-backup';
export const VERSION = 1;
export const PAGES = ['home', 'projects', 'now', 'resume', 'contact'] as const;
const PAGE = { projects: 10, assets: 200, messages: 200 };

type Row = Record<string, any>;
export type Report = { ok: true; added: number; updated: number; skipped: number; problems: string[] };
const report = (): Report => ({ ok: true, added: 0, updated: 0, skipped: 0, problems: [] });
const isObj = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const line = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const block = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '');
/** Long text exactly as the form keeps it: line endings normalised, control characters dropped, NOT trimmed (a text may end with a newline). */
const longText = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max) : '');
/** An address kept exactly as written when it is an acceptable http(s) address (cleanUrl alone would rewrite "https://x.com" as "https://x.com/"). */
const keepUrl = (v: string, allowMail = false) => (v && cleanUrl(v, allowMail) ? v : cleanUrl(v, allowMail));
const int = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 4_102_444_800 ? (v as number) : null);
const flag = (v: unknown) => (v === 1 || v === true ? 1 : 0);

/* ───────────────────────── export ───────────────────────── */

export async function summary() {
  const [p, a, m, rs, re, nc, ni] = await env.DB.batch<{ n: number }>([
    env.DB.prepare('SELECT count(*) AS n FROM projects'), env.DB.prepare('SELECT count(*) AS n FROM assets'), env.DB.prepare('SELECT count(*) AS n FROM messages'),
    env.DB.prepare('SELECT count(*) AS n FROM resume_sections'), env.DB.prepare('SELECT count(*) AS n FROM resume_entries'), env.DB.prepare('SELECT count(*) AS n FROM now_categories'), env.DB.prepare('SELECT count(*) AS n FROM now_items'),
  ]);
  return { projects: p.results[0].n, assets: a.results[0].n, messages: m.results[0].n, resume_sections: rs.results[0].n, resume_entries: re.results[0].n, now_categories: nc.results[0].n, now_items: ni.results[0].n };
}

export async function exportPart(part: string, after: number): Promise<Row | null> {
  switch (part) {
    case 'summary': return summary();
    case 'site': return { settings: await getSettings(), seo_pages: (await env.DB.prepare('SELECT page, title, description, og_asset, noindex FROM seo_pages ORDER BY page').all()).results };
    case 'projects': {
      const rows = (await env.DB.prepare('SELECT id, slug, title, summary, body_md, tags, cover_asset, cover_alt, live_url, source_url, status, featured, sort_order, seo_title, seo_desc, seo_image, created_at, updated_at FROM projects WHERE id > ? ORDER BY id LIMIT ?').bind(after, PAGE.projects + 1).all<Row>()).results;
      const more = rows.length > PAGE.projects; const items = rows.slice(0, PAGE.projects);
      return { items: items.map((r) => ({ ...r, id: undefined, tags: safeJson(r.tags, []) })), next: more ? items[items.length - 1].id : null };
    }
    case 'resume': {
      const sections = (await env.DB.prepare('SELECT id, kind, title, visible, sort_order FROM resume_sections ORDER BY sort_order, id').all<Row>()).results;
      const entries = (await env.DB.prepare('SELECT e.section_id, e.data, e.visible, e.sort_order, p.slug AS project_slug FROM resume_entries e LEFT JOIN projects p ON p.id = e.project_id ORDER BY e.sort_order, e.id').all<Row>()).results;
      return { sections: sections.map((s) => ({ kind: s.kind, title: s.title, visible: s.visible, sort_order: s.sort_order, entries: entries.filter((e) => e.section_id === s.id).map((e) => ({ data: safeJson(e.data, {}), visible: e.visible, sort_order: e.sort_order, project_slug: e.project_slug })) })) };
    }
    case 'now': {
      const cats = (await env.DB.prepare('SELECT id, name, icon, sort_order FROM now_categories ORDER BY sort_order, id').all<Row>()).results;
      const items = (await env.DB.prepare('SELECT category_id, title, note, link, status, started_at, finished_at, sort_order, updated_at, progress FROM now_items ORDER BY sort_order, id').all<Row>()).results;
      return { categories: cats.map((c) => ({ name: c.name, icon: c.icon, sort_order: c.sort_order, items: items.filter((i) => i.category_id === c.id).map(({ category_id, ...i }) => i) })) };
    }
    case 'assets': {
      const rows = (await env.DB.prepare('SELECT rowid AS cur, id, filename, mime, size, width, height, alt, decorative, created_at FROM assets WHERE rowid > ? ORDER BY rowid LIMIT ?').bind(after, PAGE.assets + 1).all<Row>()).results;
      const more = rows.length > PAGE.assets; const items = rows.slice(0, PAGE.assets);
      return { items: items.map(({ cur, ...a }) => a), next: more ? items[items.length - 1].cur : null };
    }
    case 'messages': {
      const rows = (await env.DB.prepare('SELECT id, name, email, subject, body, is_read, created_at FROM messages WHERE id > ? ORDER BY id LIMIT ?').bind(after, PAGE.messages + 1).all<Row>()).results;
      const more = rows.length > PAGE.messages; const items = rows.slice(0, PAGE.messages);
      return { items: items.map(({ id, ...m }) => m), next: more ? items[items.length - 1].id : null };
    }
  }
  return null;
}
function safeJson(s: unknown, fallback: unknown) { try { return JSON.parse(String(s)); } catch { return fallback; } }

/* ───────────────────────── import ───────────────────────── */

const assetIds = async () => new Map((await env.DB.prepare('SELECT id, mime FROM assets').all<{ id: string; mime: string }>()).results.map((a) => [a.id, a.mime]));

/** The site settings and the per-page search settings (replaces what is there). */
export async function importSite(body: Row, dry: boolean): Promise<Report> {
  const rep = report(); const raw = body.settings, assets = await assetIds();
  if (!isObj(raw)) { rep.ok = true; rep.problems.push('The backup has no site settings.'); rep.skipped++; return rep; }
  const t = (k: string, max: number) => line(raw[k], max);
  const base = SETTINGS_DEFAULTS;
  const next: SiteSettings = { ...base, headline: t('headline', 160), availability: t('availability', 60), name: t('name', 80) || base.name, tagline: t('tagline', 140), bio: block(raw.bio, 1200), location: t('location', 80), email: t('email', 254), phone: t('phone', 30), now_intro: block(raw.now_intro, 400), meta_description: block(raw.meta_description, 300) || base.meta_description, privacy_md: longText(raw.privacy_md, 12000), contact_email: raw.contact_email !== false.trim(), site_url: '', highlights: [], socials: [], og_asset: null, portrait_asset: null, favicon_asset: null, resume_asset: null };
  if (next.email && validateEmail(next.email)) { rep.problems.push('The email address in the backup does not look right; it was left empty.'); next.email = ''; }
  if (next.phone && !/^[+\d\s().-]{5,30}$/.test(next.phone)) { rep.problems.push('The phone number in the backup has odd characters; it was left empty.'); next.phone = ''; }
  const site = keepUrl(t('site_url', 200));
  if (site === null) rep.problems.push('The site address in the backup is not an http(s) address; it was left empty.'); else next.site_url = site.replace(/\/$/, '');
  for (const s of Array.isArray(raw.socials) ? raw.socials.slice(0, MAX_SOCIALS) : []) {
    const label = isObj(s) ? line(s.label, 40) : '', url = isObj(s) ? keepUrl(line(s.url, 300), true) : null;
    if (label && url) next.socials.push({ label, url }); else rep.problems.push('A social link in the backup was not valid and was left out.');
  }
  for (const h of Array.isArray(raw.highlights) ? raw.highlights.slice(0, 4) : []) {
    const value = isObj(h) ? line(h.value, 12) : '', label = isObj(h) ? line(h.label, 40) : '';
    if (value && label) next.highlights.push({ value, label }); else rep.problems.push('A highlight in the backup was not valid and was left out.');
  }
  const pick = (k: keyof SiteSettings, ok: (mime: string) => boolean) => { const v = t(k, 40); if (!v) return null; const m = assets.get(v); if (m && ok(m)) return v; rep.problems.push(`The file chosen for "${k}" is not available here, so that setting was left empty.`); return null; };
  next.favicon_asset = pick('favicon_asset', (m) => m.startsWith('image/')); next.portrait_asset = pick('portrait_asset', (m) => m.startsWith('image/') && m !== 'image/x-icon');
  next.og_asset = pick('og_asset', (m) => m.startsWith('image/') && m !== 'image/svg+xml'); next.resume_asset = pick('resume_asset', (m) => m === 'application/pdf');
  const seo: Row[] = [];
  for (const p of Array.isArray(body.seo_pages) ? body.seo_pages : []) {
    if (!isObj(p) || !(PAGES as readonly string[]).includes(p.page)) { rep.problems.push('A search setting for an unknown page was left out.'); continue; }
    const og = line(p.og_asset, 40); const m = assets.get(og);
    seo.push({ page: p.page, title: line(p.title, PL.seoTitle) || null, description: line(p.description, PL.seoDesc) || null, og_asset: m && m.startsWith('image/') && m !== 'image/svg+xml' ? og : null, noindex: flag(p.noindex) });
  }
  if (!dry) {
    await saveSettings(next);
    await env.DB.batch([env.DB.prepare('DELETE FROM seo_pages'), ...seo.map((s) => env.DB.prepare('INSERT INTO seo_pages (page, title, description, og_asset, noindex) VALUES (?,?,?,?,?)').bind(s.page, s.title, s.description, s.og_asset, s.noindex))]);
  }
  rep.updated = 1; return rep;
}

function cleanProject(raw: unknown, assets: Map<string, string>, rep: Report) {
  if (!isObj(raw)) { rep.skipped++; rep.problems.push('A project entry was not readable.'); return null; }
  const title = line(raw.title, PL.title); const given = line(raw.slug, 100); const slug = /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(given) ? given : slugify(given || title);   // a slug that is already valid is kept as it is (changing it would change the page's address)
  if (!title || !slug) { rep.skipped++; rep.problems.push(`A project without a ${title ? 'usable address' : 'title'} was skipped.`); return null; }
  const tags: string[] = [];
  for (const x of Array.isArray(raw.tags) ? raw.tags : []) { const tag = line(x, PL.tag).replace(/^#+\s*/, ''); if (tag && !tags.some((y) => y.toLowerCase() === tag.toLowerCase())) tags.push(tag); }
  const url = (k: string) => { const v = line(raw[k], PL.url); if (!v) return ''; const c = keepUrl(v); if (c) return c; rep.problems.push(`"${title}": the ${k.replace('_', ' ')} was not an http(s) address and was left empty.`); return ''; };
  const img = (v: unknown, noSvg = false) => { const id = line(v, 40), m = assets.get(id); return m && m.startsWith('image/') && !(noSvg && m === 'image/svg+xml') ? id : null; };
  if (raw.cover_asset && !img(raw.cover_asset)) rep.problems.push(`"${title}": its cover picture is not in this site, so it has no cover.`);
  const status = raw.status === 'published' ? 'published' : 'draft';
  return { slug, title, summary: line(raw.summary, PL.summary), body_md: longText(raw.body_md, PL.body), tags: tags.slice(0, PL.tags), cover_asset: img(raw.cover_asset), cover_alt: line(raw.cover_alt, 300), live_url: url('live_url') || null, source_url: url('source_url') || null, status, featured: flag(raw.featured), sort_order: int(raw.sort_order) ?? 0, seo_title: line(raw.seo_title, PL.seoTitle) || null, seo_desc: line(raw.seo_desc, PL.seoDesc) || null, seo_image: img(raw.seo_image, true), created_at: int(raw.created_at), updated_at: int(raw.updated_at) };
}

/** `replace`: the projects of the backup replace those on the site (cleared first by clear('projects')). `add`: only slugs that do not exist yet are added. */
export async function importProjects(body: Row, mode: 'replace' | 'add', dry: boolean): Promise<Report> {
  const rep = report(); const assets = await assetIds();
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, PAGE.projects);
  const clean = items.map((r) => cleanProject(r, assets, rep)).filter(Boolean) as NonNullable<ReturnType<typeof cleanProject>>[];
  const seen = new Set<string>(); const stmts: D1PreparedStatement[] = [];
  for (const p of clean) {
    if (seen.has(p.slug)) { rep.skipped++; rep.problems.push(`Two projects had the address "${p.slug}"; the second was skipped.`); continue; } seen.add(p.slug);
    if (mode === 'add' && (await env.DB.prepare('SELECT 1 AS x FROM projects WHERE slug = ?').bind(p.slug).first())) { rep.skipped++; continue; }
    stmts.push(env.DB.prepare("INSERT INTO projects (slug, title, summary, body_md, tags, cover_asset, cover_alt, live_url, source_url, status, featured, sort_order, seo_title, seo_desc, seo_image, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, coalesce(?, unixepoch()), coalesce(?, unixepoch()))")
      .bind(p.slug, p.title, p.summary, p.body_md, JSON.stringify(p.tags), p.cover_asset, p.cover_alt, p.live_url, p.source_url, p.status, p.featured, p.sort_order, p.seo_title, p.seo_desc, p.seo_image, p.created_at, p.updated_at));
    rep.added++;
  }
  if (!dry && stmts.length) await env.DB.batch(stmts);
  return rep;
}

/** One resume section with its entries (the first call of a replace clears the old resume). */
export async function importResumeSection(body: Row, first: boolean, dry: boolean): Promise<Report> {
  const rep = report(); const s = body.section;
  if (!isObj(s) || !(KINDS as readonly string[]).includes(s.kind)) { rep.skipped++; rep.problems.push('A resume section of an unknown kind was skipped.'); return rep; }
  const kind = s.kind as Kind; const slugs = new Set((await env.DB.prepare('SELECT slug FROM projects').all<{ slug: string }>()).results.map((r) => r.slug));
  const entries: { data: Row; visible: number; slug: string | null }[] = [];
  for (const e of (Array.isArray(s.entries) ? s.entries : []).slice(0, MAX_ENTRIES)) {
    if (!isObj(e) || !isObj(e.data)) { rep.skipped++; rep.problems.push(`An entry in "${line(s.title, 80)}" was not readable.`); continue; }
    const slug = kind === 'projects' ? line(e.project_slug, 120) : null;
    if (kind === 'projects' && (!slug || !slugs.has(slug))) { rep.skipped++; rep.problems.push(`A project in the resume ("${slug || '?'}") is not on this site, so that entry was skipped.`); continue; }
    entries.push({ data: cleanEntryData(kind, e.data), visible: flag(e.visible ?? 1), slug });
  }
  if (!dry) {
    const stmts: D1PreparedStatement[] = [];
    if (first) stmts.push(env.DB.prepare('DELETE FROM resume_sections'));
    const order = first ? 0 : ((await env.DB.prepare('SELECT coalesce(max(sort_order), -1) + 1 AS n, count(*) AS c FROM resume_sections').first<{ n: number; c: number }>())!);
    if (!first && (order as any).c >= MAX_SECTIONS) { rep.skipped++; rep.problems.push('A resume can have at most 15 sections; the rest were skipped.'); return rep; }
    stmts.push(env.DB.prepare('INSERT INTO resume_sections (kind, title, visible, sort_order) VALUES (?,?,?,?)').bind(kind, line(s.title, 80) || kind, flag(s.visible ?? 1), first ? 0 : (order as any).n));
    entries.forEach((e, i) => stmts.push(env.DB.prepare('INSERT INTO resume_entries (section_id, project_id, data, visible, sort_order) VALUES ((SELECT max(id) FROM resume_sections), (SELECT id FROM projects WHERE slug = ?), ?, ?, ?)').bind(e.slug, JSON.stringify(e.data), e.visible, i)));
    await env.DB.batch(stmts);
  }
  rep.added = 1 + entries.length; return rep;
}

/** One "Now" category with its items (the first call of a replace clears the old board). */
export async function importNowCategory(body: Row, first: boolean, dry: boolean): Promise<Report> {
  const rep = report(); const c = body.category;
  const name = isObj(c) ? parseName(c.name) : '';
  if (!name) { rep.skipped++; rep.problems.push('A "Now" category without a name was skipped.'); return rep; }
  const items: Row[] = [];
  for (const i of (Array.isArray(c.items) ? c.items : []).slice(0, MAX_ITEMS)) {
    const title = isObj(i) ? parseTitle(i.title) : '';
    if (!title) { rep.skipped++; rep.problems.push(`An item without a title in "${name}" was skipped.`); continue; }
    const rawLink = line(i.link, 500), link = rawLink ? (cleanUrl(rawLink) ? rawLink : 'bad') : null;   // an acceptable address is kept as written
    if (link === 'bad') rep.problems.push(`"${title}": the link was not an http(s) address and was left out.`);
    const status = i.status === 'done' ? 'done' : 'current'; const progress = Number.isInteger(i.progress) && i.progress >= 0 && i.progress <= 100 && status === 'current' ? i.progress : null;
    items.push({ title, note: parseNote(i.note), link: link === 'bad' ? null : link, status, started_at: int(i.started_at), finished_at: int(i.finished_at), progress, updated_at: int(i.updated_at) });
  }
  if (!dry) {
    const stmts: D1PreparedStatement[] = [];
    if (first) stmts.push(env.DB.prepare('DELETE FROM now_categories'));
    const n = first ? 0 : (await env.DB.prepare('SELECT coalesce(max(sort_order), -1) + 1 AS n, count(*) AS c FROM now_categories').first<{ n: number; c: number }>())!;
    if (!first && (n as any).c >= MAX_CATEGORIES) { rep.skipped++; rep.problems.push('The Now page can have at most 20 categories; the rest were skipped.'); return rep; }
    stmts.push(env.DB.prepare('INSERT INTO now_categories (name, icon, sort_order) VALUES (?,?,?)').bind(name, parseIcon(c.icon), first ? 0 : (n as any).n));
    items.forEach((i, k) => stmts.push(env.DB.prepare("INSERT INTO now_items (category_id, title, note, link, status, started_at, finished_at, sort_order, updated_at, progress) VALUES ((SELECT max(id) FROM now_categories), ?,?,?,?,?,?,?, coalesce(?, unixepoch()), ?)").bind(i.title, i.note, i.link, i.status, i.started_at, i.finished_at, k, i.updated_at, i.progress)));
    await env.DB.batch(stmts);
  }
  rep.added = 1 + items.length; return rep;
}

/** Messages are added (never replaced) and a message already here (same time, sender and text) is not added twice. */
export async function importMessages(body: Row, dry: boolean): Promise<Report> {
  const rep = report();
  for (const m of (Array.isArray(body.items) ? body.items : []).slice(0, PAGE.messages)) {
    const name = isObj(m) ? line(m.name, 100) : '', email = isObj(m) ? line(m.email, 254) : '', text = isObj(m) ? block(m.body, 5000) : '';
    if (!name || !email || !text || validateEmail(email)) { rep.skipped++; rep.problems.push('A message that was not complete was skipped.'); continue; }
    const at = int(m.created_at);
    if (at && await env.DB.prepare('SELECT 1 AS x FROM messages WHERE created_at = ? AND email = ? AND body = ?').bind(at, email, text).first()) { rep.skipped++; continue; }
    if (!dry) await env.DB.prepare('INSERT INTO messages (name, email, subject, body, is_read, created_at) VALUES (?,?,?,?,?, coalesce(?, unixepoch()))').bind(name, email, line(m.subject, 150) || null, text, flag(m.is_read), at).run();
    rep.added++;
  }
  return rep;
}

/** Deletes the projects a "replace" is about to replace. (Resume and Now clear themselves on their first piece; accounts, sessions and files are never touched.) */
export async function clearProjects(dry: boolean): Promise<Report> {
  const rep = report();
  if (!dry) await env.DB.prepare('DELETE FROM projects').run();
  return rep;
}
