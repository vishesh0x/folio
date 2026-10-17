import { env } from 'cloudflare:workers';

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
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'site'").first<{ value: string }>();
    return { ...SETTINGS_DEFAULTS, ...(row ? JSON.parse(row.value) : {}) };
  } catch { return SETTINGS_DEFAULTS; }
}
export async function saveSettings(s: SiteSettings) {
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('site', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1").bind(JSON.stringify(s)).run();
}
