/**
 * Site settings, stored as a single JSON row: types, defaults, loading and saving.
 */

import { env } from 'cloudflare:workers';
import { contentVersion } from './content-version';

/** A social link. */
export type Social = { label: string; url: string };
/** A figure shown on the home page. */
export type Highlight = { value: string; label: string };
/** Everything the owner can set on the Settings page. */
export type SiteSettings = {
  name: string; tagline: string; bio: string; email: string; phone: string; location: string; now_intro: string;
  site_url: string; meta_description: string;
  /**
   * Owner-written privacy notice (Markdown). Empty means the standard text from src/lib/privacy.ts.
   */
  privacy_md: string;
  /** Offer the public email (click to reveal) on the Contact page. The resume has its own setting. */
  contact_email: boolean;
  og_asset: string | null; portrait_asset: string | null; favicon_asset: string | null; resume_asset: string | null;
  headline: string;  // Optional big headline on the home page; *word* is shown in the accent colour
  availability: string;  // e.g. "Open to new work"; empty hides the badge
  highlights: Highlight[];  // Up to 4 numbers the owner chooses to show on the home page (real ones only)
  socials: Social[];
};
/** Maximum number of social links. */
export const MAX_SOCIALS = 8;
/**
 * A web address the site is willing to publish: http(s) only (and mailto: where allowed). Returns ''
 * for empty, null for not acceptable.
 */
export const cleanUrl = (u: string, allowMail = false) => {
  u = u.trim();
  if (!u) return '';
  if (allowMail && u.startsWith('mailto:')) return u.slice(0, 300);
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; }
};
/** Values used until the owner saves settings. */
export const SETTINGS_DEFAULTS: SiteSettings = {
  name: 'Your Name', tagline: 'Designer & developer', bio: '', email: '', phone: '', location: '', now_intro: '',
  site_url: '', meta_description: 'Personal website and portfolio.',
  privacy_md: '', contact_email: true,
  og_asset: null, portrait_asset: null, favicon_asset: null, resume_asset: null, headline: '', availability: '', highlights: [], socials: [],
};

/** Loads the settings fresh from the database, for the dashboard. */
export async function getSettings(): Promise<SiteSettings> {
  // A database FAILURE must fail the request (the middleware answers 503). It must never be turned into
  // placeholder settings: a public page built from them would be cached as if it were the real page.
  // Only a missing row (fresh install) or unreadable JSON uses defaults.
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'site'").first<{ value: string }>();
  let saved = {}; try { if (row) saved = JSON.parse(row.value); } catch {}
  return { ...SETTINGS_DEFAULTS, ...saved };
}
// For PUBLIC rendering only (the owner's dashboard and the "is this file in use?" check keep reading
// fresh, so they never see old data). Remembered per content version: the version changes on every
// dashboard save (and is itself looked up at most every 5 seconds per server instance), so a save
// shows on the public site as fast as it did, and a page build no longer re-reads the same row (the
// layout and the page both asked for it). Always real data: if the database is unreachable,
// contentVersion() keeps the last version and this keeps the last REAL settings; nothing is invented.
let memo: { v: string; s: SiteSettings } | null = null;
/** Loads the settings for public pages, remembered per content version. */
export async function getPublicSettings(): Promise<SiteSettings> {
  const v = await contentVersion();
  if (memo && memo.v === v) return { ...memo.s };
  const s = await getSettings();
  memo = { v, s };
  return { ...s };
}
/** Saves the settings and moves the content version on. */
export async function saveSettings(s: SiteSettings) {
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('site', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1").bind(JSON.stringify(s)).run();
}
