import { env } from 'cloudflare:workers';
import type { ImgAsset } from './imghtml';

export type Project = {
  id: number; slug: string; title: string; summary: string; body_md: string; tags: string[];
  live_url: string | null; source_url: string | null; status: 'draft' | 'published'; featured: number;
  seo_title: string | null; seo_desc: string | null; seo_image: string | null; created_at: number; updated_at: number;
  cover: ImgAsset | null;
};

const SELECT = `SELECT p.*, a.id AS c_id, a.filename AS c_filename, a.mime AS c_mime, a.width AS c_width, a.height AS c_height,
  a.alt AS c_alt, a.decorative AS c_decorative FROM projects p LEFT JOIN assets a ON a.id = p.cover_asset`;

function hydrate(r: any): Project {
  let tags: string[] = [];
  try { const t = JSON.parse(r.tags); if (Array.isArray(t)) tags = t.filter((x) => typeof x === 'string'); } catch {}
  const cover: ImgAsset | null = r.c_id ? {
    id: r.c_id, filename: r.c_filename, mime: r.c_mime, width: r.c_width, height: r.c_height,
    alt: (r.cover_alt || r.c_alt || '').trim(), decorative: r.c_decorative,
  } : null;
  const { c_id, c_filename, c_mime, c_width, c_height, c_alt, c_decorative, ...p } = r;
  return { ...p, tags, cover };
}
const httpOnly = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);

export async function listPublished(opts: { tag?: string; featured?: boolean; limit?: number } = {}): Promise<Project[]> {
  const rows = (await env.DB.prepare(`${SELECT} WHERE p.status = 'published' ${opts.featured ? 'AND p.featured = 1' : ''} ORDER BY p.sort_order ASC, p.created_at DESC LIMIT ?`)
    .bind(opts.limit ?? 100).all()).results.map(hydrate);
  return opts.tag ? rows.filter((p) => p.tags.includes(opts.tag!)) : rows;
}

export async function getPublished(slug: string): Promise<Project | null> {
  const r = await env.DB.prepare(`${SELECT} WHERE p.slug = ? AND p.status = 'published'`).bind(slug).first();
  if (!r) return null;
  const p = hydrate(r); p.live_url = httpOnly(p.live_url); p.source_url = httpOnly(p.source_url);
  return p;
}

export async function neighbours(p: Project): Promise<{ prev: Pick<Project, 'slug' | 'title'> | null; next: Pick<Project, 'slug' | 'title'> | null }> {
  const all = (await env.DB.prepare("SELECT slug, title FROM projects WHERE status = 'published' ORDER BY sort_order ASC, created_at DESC").all<{ slug: string; title: string }>()).results;
  const i = all.findIndex((x) => x.slug === p.slug);
  return { prev: i > 0 ? all[i - 1] : null, next: i >= 0 && i < all.length - 1 ? all[i + 1] : null };
}

export const allTags = (ps: Project[]) => [...new Set(ps.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b));
