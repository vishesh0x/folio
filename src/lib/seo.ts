import { env } from 'cloudflare:workers';

export type PageSeo = { title?: string; description?: string; noindex: boolean; ogImage?: string };

/** Per-page overrides saved from Dashboard → SEO (Step 7). Any missing value falls back to the page's own default. */
export async function pageSeo(page: 'home' | 'projects' | 'now' | 'resume' | 'contact'): Promise<PageSeo> {
  try {
    const r = await env.DB.prepare(
      `SELECT s.title, s.description, s.noindex, a.id AS aid, a.filename, a.mime FROM seo_pages s LEFT JOIN assets a ON a.id = s.og_asset WHERE s.page = ?`
    ).bind(page).first<{ title: string | null; description: string | null; noindex: number; aid: string | null; filename: string; mime: string }>();
    if (!r) return { noindex: false };
    return {
      title: r.title || undefined, description: r.description || undefined, noindex: !!r.noindex,
      ogImage: r.aid && r.mime !== 'image/svg+xml' ? `/media/${r.aid}/${encodeURIComponent(r.filename)}?w=1280&f=jpeg` : undefined,
    };
  } catch { return { noindex: false }; }
}
