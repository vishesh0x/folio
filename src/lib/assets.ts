import { env } from 'cloudflare:workers';
import { randomToken } from './crypto';
import { sniffBinary } from './sniff';
import { sanitizeSvg, svgSize } from './svg';
import { getSettings } from './settings';

export type Asset = {
  id: string; r2_key: string; filename: string; mime: string; size: number;
  width: number | null; height: number | null; alt: string; decorative: number; created_at: number;
};
export const MAX_IMAGE = 10 * 1024 * 1024;
export const MAX_PDF = 15 * 1024 * 1024;
export const isImage = (mime: string) => mime.startsWith('image/');

export const getAsset = (id: string) =>
  env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(id).first<Asset>();
export const listAssets = async () =>
  (await env.DB.prepare('SELECT * FROM assets ORDER BY created_at DESC, rowid DESC').all<Asset>()).results;

const safeName = (n: string, ext: string) => {
  const base = n.replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  return `${base}.${ext}`;
};

export async function saveUpload(file: File, alt: string, decorative: boolean): Promise<{ ok: true; asset: Asset } | { ok: false; error: string }> {
  if (file.size > MAX_PDF) return { ok: false, error: 'That file is too large (limit 10 MB for images, 15 MB for PDFs).' };
  let bytes = new Uint8Array(await file.arrayBuffer());
  let mime: string, ext: string, width: number | null, height: number | null;

  const head = new TextDecoder().decode(bytes.slice(0, 2000)).toLowerCase();
  if (head.includes('<svg')) {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return { ok: false, error: 'That SVG is not valid UTF-8 text.' }; }
    const clean = await sanitizeSvg(text);
    if (!clean) return { ok: false, error: 'That SVG could not be made safe (it may use scripts, entities or external references). Re-export it as a plain SVG, or use PNG.' };
    bytes = new TextEncoder().encode(clean);
    ({ width, height } = svgSize(clean));
    mime = 'image/svg+xml'; ext = 'svg';
  } else {
    const s = sniffBinary(bytes);
    if (!s) return { ok: false, error: 'Unsupported file. Use PNG, JPEG, WebP, AVIF, GIF, ICO, SVG or PDF.' };
    ({ mime, ext, width, height } = s);
  }
  if (mime === 'application/pdf' ? bytes.length > MAX_PDF : bytes.length > MAX_IMAGE) return { ok: false, error: 'That file is too large (limit 10 MB for images, 15 MB for PDFs).' };
  if (isImage(mime) && !alt && !decorative) return { ok: false, error: 'Add alt text describing the image, or tick “decorative” if it carries no meaning.' };

  const id = randomToken(9);
  const filename = safeName(file.name, ext);
  const r2_key = `assets/${id}/${filename}`;
  await env.ASSETS_BUCKET.put(r2_key, bytes, { httpMetadata: { contentType: mime } });
  try {
    await env.DB.prepare('INSERT INTO assets (id, r2_key, filename, mime, size, width, height, alt, decorative) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, r2_key, filename, mime, bytes.length, width, height, isImage(mime) ? alt.slice(0, 300) : '', decorative ? 1 : 0).run();
  } catch (e) { await env.ASSETS_BUCKET.delete(r2_key); throw e; }
  return { ok: true, asset: (await getAsset(id))! };
}

/** A trimmed copy of an asset for the dashboard's browser code (media pickers). Never includes the storage key. */
export type AssetView = { id: string; filename: string; mime: string; size: number; width: number | null; height: number | null; alt: string; decorative: boolean; kind: 'image' | 'pdf' | 'other'; url: string; thumb: string };
const RASTER = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];
export function assetView(a: Asset): AssetView {
  const url = `/media/${a.id}/${encodeURIComponent(a.filename)}`;
  return {
    id: a.id, filename: a.filename, mime: a.mime, size: a.size, width: a.width, height: a.height, alt: a.alt, decorative: !!a.decorative,
    kind: isImage(a.mime) ? 'image' : a.mime === 'application/pdf' ? 'pdf' : 'other',
    url, thumb: RASTER.includes(a.mime) ? `${url}?w=320&f=webp` : url, // SVG, GIF and ICO are served as they are
  };
}
export const RASTER_MIMES = RASTER;

/**
 * Where each of the given files is used, as short human phrases ("your portrait", "the cover of Atlas").
 * One set of queries for all of them, so the Files page does not ask the database once per file.
 */
export async function usageMap(assets: Asset[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(assets.map((a) => [a.id, []]));
  const add = (id: string | null | undefined, text: string) => { if (id && out.has(id)) out.get(id)!.push(text); };
  const s = await getSettings();
  add(s.portrait_asset, 'your portrait'); add(s.favicon_asset, 'your favicon'); add(s.og_asset, 'the default share image'); add(s.resume_asset, 'your resume PDF');
  const projects = (await env.DB.prepare('SELECT title, slug, cover_asset, seo_image, body_md FROM projects').all<{ title: string; slug: string; cover_asset: string | null; seo_image: string | null; body_md: string }>()).results;
  for (const p of projects) {
    const t = p.title || p.slug;
    add(p.cover_asset, `the cover of ${t}`); add(p.seo_image, `the share image of ${t}`);
    for (const a of assets) if (p.body_md.includes(`/media/${a.id}/`) || p.body_md.includes(`[[${a.filename}`)) add(a.id, `the text of ${t}`);
  }
  const pages = (await env.DB.prepare('SELECT page, og_asset FROM seo_pages WHERE og_asset IS NOT NULL').all<{ page: string; og_asset: string }>()).results;
  for (const r of pages) add(r.og_asset, `the share image of the ${r.page} page`);
  return out;
}
export async function assetUsage(id: string): Promise<string[]> {
  const a = await getAsset(id);
  return a ? (await usageMap([a])).get(id) ?? [] : [];
}
/** First reason an asset must not be deleted, or null. */
export async function assetInUse(id: string): Promise<string | null> {
  const u = await assetUsage(id);
  return u.length ? `it is used as ${u[0]}${u.length > 1 ? ` and ${u.length - 1} other place${u.length > 2 ? 's' : ''}` : ''}` : null;
}
export async function deleteAsset(id: string, origin: string) {
  const a = await getAsset(id);
  if (!a) return;
  await env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(id).run();
  await env.ASSETS_BUCKET.delete(a.r2_key);
  const { purgeAssetCache } = await import('./media');
  await purgeAssetCache(a, origin);
}
