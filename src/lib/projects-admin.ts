import { env } from 'cloudflare:workers';

export type AdminProject = {
  id: number; slug: string; title: string; summary: string; body_md: string; tags: string[];
  cover_asset: string | null; cover_alt: string; live_url: string; source_url: string;
  status: 'draft' | 'published'; featured: number; sort_order: number;
  seo_title: string; seo_desc: string; seo_image: string | null; created_at: number; updated_at: number;
};
export type ProjectInput = Omit<AdminProject, 'id' | 'sort_order' | 'created_at' | 'updated_at'>;
export const LIMITS = { title: 120, summary: 300, body: 200_000, tag: 30, tags: 12, seoTitle: 120, seoDesc: 300, url: 500 };

export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

function hydrate(r: any): AdminProject {
  let tags: string[] = []; try { const t = JSON.parse(r.tags); if (Array.isArray(t)) tags = t.filter((x) => typeof x === 'string'); } catch {}
  return { ...r, tags, cover_alt: r.cover_alt ?? '', live_url: r.live_url ?? '', source_url: r.source_url ?? '', seo_title: r.seo_title ?? '', seo_desc: r.seo_desc ?? '' };
}

export async function listAll(filter: 'all' | 'published' | 'draft' = 'all'): Promise<AdminProject[]> {
  // `filter` is bound as a parameter (never spliced into the SQL), so no value of it can change the statement
  const rows = (await env.DB.prepare(`SELECT * FROM projects WHERE (?1 = 'all' OR status = ?1) ORDER BY sort_order ASC, created_at DESC, id DESC`).bind(filter).all()).results;
  return rows.map(hydrate);
}
export async function getById(id: number): Promise<AdminProject | null> {
  const r = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  return r ? hydrate(r) : null;
}

/** Turns a posted form into a clean ProjectInput, or says what is wrong with it. */
export function parseForm(f: FormData, validImages: Set<string>, validOg: Set<string>, intent: string, current?: AdminProject) {
  const t = (k: string, max: number) => String(f.get(k) ?? '').replace(/\r\n?/g, '\n').slice(0, max);
  const line = (k: string, max: number) => t(k, max).replace(/\s+/g, ' ').trim();
  const errors: Record<string, string> = {};

  const title = line('title', LIMITS.title);
  if (!title) errors.title = 'Give the project a title.';
  let slug = slugify(String(f.get('slug') ?? '') || title);
  if (!slug) errors.slug = 'Use letters or numbers in the address.';

  const tags: string[] = [];
  for (const raw of String(f.get('tags') ?? '').split(/[,\n]/)) {
    const tag = raw.trim().replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.tag);
    if (tag && !tags.some((x) => x.toLowerCase() === tag.toLowerCase())) tags.push(tag);
  }
  if (tags.length > LIMITS.tags) errors.tags = `Use at most ${LIMITS.tags} tags.`;

  const url = (k: string) => {
    const v = line(k, LIMITS.url);
    if (!v) return '';
    try { const u = new URL(v); if (u.protocol === 'https:' || u.protocol === 'http:') return u.href; } catch {}
    errors[k] = 'Use a full address starting with https://';
    return '';
  };
  const live_url = url('live_url'), source_url = url('source_url');

  const cover = String(f.get('cover') ?? '');
  const cover_asset = validImages.has(cover) ? cover : null;
  const og = String(f.get('seo_image') ?? '');

  let status: 'draft' | 'published' = current?.status ?? 'draft';
  if (intent === 'publish') status = 'published'; else if (intent === 'unpublish') status = 'draft';

  const input: ProjectInput = {
    slug, title, summary: line('summary', LIMITS.summary), body_md: t('body', LIMITS.body), tags,
    cover_asset, cover_alt: line('cover_alt', 300), live_url, source_url, status,
    featured: f.get('featured') === 'on' ? 1 : 0,
    seo_title: line('seo_title', LIMITS.seoTitle), seo_desc: line('seo_desc', LIMITS.seoDesc), seo_image: validOg.has(og) ? og : null,
  };
  return { input, errors };
}

export async function slugTaken(slug: string, exceptId = 0) {
  return !!(await env.DB.prepare('SELECT 1 AS x FROM projects WHERE slug = ? AND id <> ?').bind(slug, exceptId).first());
}
export async function uniqueSlug(base: string) {
  let s = base || 'project', n = 2;
  while (await slugTaken(s)) s = `${base}-${n++}`;
  return s;
}

const cols = (p: ProjectInput) => [p.slug, p.title, p.summary, p.body_md, JSON.stringify(p.tags), p.cover_asset, p.cover_alt, p.live_url || null, p.source_url || null, p.status, p.featured, p.seo_title || null, p.seo_desc || null, p.seo_image];

export async function createProject(p: ProjectInput): Promise<number> {
  // "Is this slug free?" and "insert it" are two steps, so two requests at the same moment (a double-click on New project) can both
  // pick the same slug. The UNIQUE rule in the database correctly refuses the second; it retries with the next free slug.
  let input = p;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await env.DB.prepare(
        `INSERT INTO projects (slug, title, summary, body_md, tags, cover_asset, cover_alt, live_url, source_url, status, featured, seo_title, seo_desc, seo_image, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 0)`).bind(...cols(input)).run();
      return Number(r.meta.last_row_id);
    } catch (e) {
      if (!String(e).includes('UNIQUE') || attempt >= 8) throw e;
      const base = p.slug.replace(/-\d+$/, '') || 'project';
      // after a few clashes add a random part, so a burst of requests cannot keep colliding
      input = { ...p, slug: attempt < 3 ? await uniqueSlug(base) : `${base}-${crypto.randomUUID().slice(0, 6)}` };
    }
  }
}

/** Saves only if nobody changed the project since the editor loaded it (prevents silent overwrites from a second tab). */
export async function updateProject(id: number, p: ProjectInput, loadedAt: number): Promise<'ok' | 'conflict' | 'slug-taken'> {
  try {
    const r = await env.DB.prepare(
      `UPDATE projects SET slug=?, title=?, summary=?, body_md=?, tags=?, cover_asset=?, cover_alt=?, live_url=?, source_url=?, status=?, featured=?, seo_title=?, seo_desc=?, seo_image=?, updated_at=unixepoch()
       WHERE id = ? AND updated_at = ?`).bind(...cols(p), id, loadedAt).run();
    return r.meta.changes === 1 ? 'ok' : 'conflict';
  } catch (e) {
    if (String(e).includes('UNIQUE')) return 'slug-taken';
    throw e;
  }
}

export const deleteProject = (id: number) => env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
export const setStatus = (id: number, s: 'draft' | 'published') => env.DB.prepare('UPDATE projects SET status = ?, updated_at = unixepoch() WHERE id = ?').bind(s, id).run();
export const setFeatured = (id: number, on: boolean) => env.DB.prepare('UPDATE projects SET featured = ?, updated_at = unixepoch() WHERE id = ?').bind(on ? 1 : 0, id).run();

export async function duplicateProject(id: number): Promise<number | null> {
  const p = await getById(id);
  if (!p) return null;
  const title = `Copy of ${p.title}`.slice(0, LIMITS.title);
  return createProject({ ...p, title, slug: await uniqueSlug(slugify(title)), status: 'draft', featured: 0 });
}

/** Moves a project one place in the public order, then renumbers everything 0..n so order is always unambiguous. */
export async function move(id: number, dir: 'up' | 'down') {
  const all = await listAll('all');
  const i = all.findIndex((p) => p.id === id), j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  await env.DB.batch(all.map((p, n) => env.DB.prepare('UPDATE projects SET sort_order = ? WHERE id = ?').bind(n, p.id)));
}

export function toMarkdownFile(p: AdminProject): string {
  const q = (s: string) => JSON.stringify(s);
  const fm = ['---', `title: ${q(p.title)}`, `summary: ${q(p.summary)}`, `tags: [${p.tags.map(q).join(', ')}]`,
    ...(p.live_url ? [`live: ${q(p.live_url)}`] : []), ...(p.source_url ? [`source: ${q(p.source_url)}`] : []), `status: ${p.status}`, '---', ''];
  return fm.join('\n') + '\n' + p.body_md.replace(/^\n+/, '') + (p.body_md.endsWith('\n') ? '' : '\n');
}
