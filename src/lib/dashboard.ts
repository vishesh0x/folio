import { env } from 'cloudflare:workers';
import { turnstileOn, turnstileHalfSet } from './turnstile';
import { getSettings, SETTINGS_DEFAULTS } from './settings';
import type { Message } from './inbox';

export async function overview() {
  const db = env.DB;
  const [msgs, projects, assets, now, resume, seo, recentMsgs, recentProjects] = await db.batch([
    db.prepare('SELECT count(*) AS total, coalesce(sum(is_read = 0), 0) AS unread FROM messages'),
    db.prepare("SELECT coalesce(sum(status = 'published'), 0) AS pub, coalesce(sum(status = 'draft'), 0) AS draft FROM projects"),
    db.prepare('SELECT count(*) AS n, coalesce(sum(size), 0) AS bytes FROM assets'),
    db.prepare("SELECT coalesce(sum(status = 'current'), 0) AS cur, coalesce(sum(status = 'done'), 0) AS done FROM now_items"),
    db.prepare('SELECT (SELECT count(*) FROM resume_sections WHERE visible = 1) AS sections, (SELECT count(*) FROM resume_entries) AS entries'),
    db.prepare("SELECT page FROM seo_pages WHERE coalesce(title, '') <> '' OR coalesce(description, '') <> ''"),
    db.prepare('SELECT id, name, subject, body, is_read, created_at FROM messages ORDER BY created_at DESC, id DESC LIMIT 5'),
    db.prepare('SELECT p.id, p.slug, p.title, p.status, p.updated_at, p.cover_asset, a.filename AS cover_name, a.mime AS cover_mime FROM projects p LEFT JOIN assets a ON a.id = p.cover_asset ORDER BY p.updated_at DESC, p.id DESC LIMIT 5'),
  ]);
  const s = await getSettings();
  const one = (r: any) => (r.results[0] ?? {}) as Record<string, number>;
  const seoPages = new Set((seo.results as { page: string }[]).map((r) => r.page));

  const checklist = [
    { label: 'Add your name', done: !!s.name && s.name !== SETTINGS_DEFAULTS.name, href: '/dashboard/settings' },
    { label: 'Write a short bio', done: s.bio.trim().length > 0, href: '/dashboard/settings' },
    { label: 'Add a public email address', done: !!s.email, href: '/dashboard/settings' },
    { label: 'Choose a portrait for the home page', done: !!s.portrait_asset, href: '/dashboard/settings' },
    { label: 'Choose a favicon', done: !!s.favicon_asset, href: '/dashboard/settings' },
    { label: 'Choose a share image for link previews', done: !!s.og_asset, href: '/dashboard/settings' },
    { label: 'Add your resume PDF', done: !!s.resume_asset, href: '/dashboard/resume' },
    { label: 'Add a social link', done: s.socials.length > 0, href: '/dashboard/settings' },
    { label: 'Set your site address', done: !!s.site_url, href: '/dashboard/settings' },
    { label: 'Write a search description for the home page', done: seoPages.has('home'), href: '/dashboard/seo' },
    { label: 'Build your online resume', done: (one(resume).sections ?? 0) > 0, href: '/dashboard/resume' as string | null },
    { label: 'Publish a project', done: (one(projects).pub ?? 0) > 0, href: '/dashboard/projects' as string | null },
  ];
  return {
    messages: one(msgs), projects: one(projects), assets: one(assets), now: one(now), resume: one(resume),
    recentMessages: recentMsgs.results as unknown as Pick<Message, 'id' | 'name' | 'subject' | 'body' | 'is_read' | 'created_at'>[],
    recentProjects: recentProjects.results as unknown as { id: number; slug: string; title: string; status: string; updated_at: number; cover_asset: string | null; cover_name: string | null; cover_mime: string | null }[],
    checklist, settings: s, turnstile: turnstileOn(), turnstileHalf: turnstileHalfSet(),
  };
}
