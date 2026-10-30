import { env } from 'cloudflare:workers';
import { contentVersion } from './content-version';

export type Social = { label: string; url: string };
export type Highlight = { value: string; label: string };
export type SiteSettings = {
  name: string; tagline: string; bio: string; email: string; phone: string; location: string; now_intro: string;
  site_url: string; meta_description: string;
  og_asset: string | null; portrait_asset: string | null; favicon_asset: string | null; resume_asset: string | null;
  headline: string;        // optional big headline on the home page; *word* is shown in the accent colour
  availability: string;    // e.g. "Open to new work"; empty hides the badge
  highlights: Highlight[]; // up to 4 numbers you choose to show on the home page (real ones only)
  socials: Social[];
};
export const SETTINGS_DEFAULTS: SiteSettings = {
  name: 'Your Name', tagline: 'Designer & developer', bio: '', email: '', phone: '', location: '', now_intro: '',
  site_url: '', meta_description: 'Personal website and portfolio.',
  og_asset: null, portrait_asset: null, favicon_asset: null, resume_asset: null, headline: '', availability: '', highlights: [], socials: [],
};

export async function getSettings(): Promise<SiteSettings> {
  // A database FAILURE must fail the request (the middleware answers 503). It must never be turned into placeholder settings: a public
  // page built from them would be cached as if it were the real page. Only a missing row (fresh install) or unreadable JSON uses defaults.
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'site'").first<{ value: string }>();
  let saved = {}; try { if (row) saved = JSON.parse(row.value); } catch {}
  return { ...SETTINGS_DEFAULTS, ...saved };
}
// For PUBLIC rendering only (the owner's dashboard and the "is this file in use?" check keep reading fresh, so they never see old data).
// Remembered per content version: the version changes on every dashboard save (and is itself looked up at most every 5 seconds per server instance),
// so a save shows on the public site as fast as it did, and a page build no longer re-reads the same row (the layout and the page both asked for it).
// Always real data: if the database is unreachable, contentVersion() keeps the last version and this keeps the last REAL settings; nothing is invented.
let memo: { v: string; s: SiteSettings } | null = null;
export async function getPublicSettings(): Promise<SiteSettings> {
  const v = await contentVersion();
  if (memo && memo.v === v) return { ...memo.s };
  const s = await getSettings();
  memo = { v, s };
  return { ...s };
}
export async function saveSettings(s: SiteSettings) {
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('site', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1").bind(JSON.stringify(s)).run();
}
