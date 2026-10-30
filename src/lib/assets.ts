import { env } from 'cloudflare:workers';
import { randomToken } from './crypto';
import { sniffBinary } from './sniff';
import { sanitizeSvg, svgSize } from './svg';
import { getSettings } from './settings';
import { stripMetadata } from './strip';
import { assetRefs } from './asset-refs';

export type Asset = {
  id: string; r2_key: string; filename: string; mime: string; size: number;
  width: number | null; height: number | null; alt: string; decorative: number; created_at: number;
};
export const MAX_IMAGE = 10 * 1024 * 1024;
export const MAX_PDF = 15 * 1024 * 1024;
// Largest picture accepted (Cloudflare's image resizing handles up to 12,000 px a side and about 100 megapixels). A small file can claim
// a gigantic size in its header and make a resize run out of memory, so the claim is checked before anything is stored.
export const MAX_SIDE = 12000, MAX_PIXELS = 100_000_000;
export const isImage = (mime: string) => mime.startsWith('image/');

export const getAsset = (id: string) =>
  env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(id).first<Asset>();
export const listAssets = async () =>
  (await env.DB.prepare('SELECT * FROM assets ORDER BY created_at DESC, rowid DESC').all<Asset>()).results;

/** How many files the Files page draws at once. Each card costs the Worker CPU (about 12 microseconds) and the browser about 2.3 KB. */
export const FILES_PER_PAGE = 48;
export type FileKind = 'all' | 'image' | 'pdf';
export type FileQuery = { kind: FileKind; q: string; page: number };

/** Reads ?type=, ?q= and ?page= from the Files page address; anything odd falls back to "all files, page 1". */
export function parseFileQuery(params: URLSearchParams): FileQuery {
  const t = params.get('type');
  const page = Number.parseInt(params.get('page') ?? '1', 10);
  return { kind: t === 'image' || t === 'pdf' ? t : 'all', q: (params.get('q') ?? '').trim().slice(0, 80), page: Number.isFinite(page) && page > 0 ? Math.min(page, 100000) : 1 };
}

/**
 * One page of files, newest first, filtered by kind and by a search of the file name and description, plus the totals for the filter buttons.
 * A picture is anything whose type starts with image/; everything else (the PDFs) is "PDF", the same split the cards use.
 * The search uses instr() rather than LIKE because D1 limits a LIKE pattern to 50 bytes.
 */
export async function listAssetsPage(fq: FileQuery) {
  const where: string[] = [], binds: unknown[] = [];
  if (fq.kind === 'image') where.push("mime LIKE 'image/%'");
  if (fq.kind === 'pdf') where.push("mime NOT LIKE 'image/%'");
  if (fq.q) { where.push("instr(lower(filename || ' ' || coalesce(alt, '')), ?) > 0"); binds.push(fq.q.toLowerCase()); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [totals, filtered] = await env.DB.batch<{ n: number; images: number }>([
    env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(mime LIKE 'image/%'), 0) AS images FROM assets"),
    env.DB.prepare(`SELECT COUNT(*) AS n, 0 AS images FROM assets ${w}`).bind(...binds),
  ]);
  const all = totals.results[0]?.n ?? 0, images = totals.results[0]?.images ?? 0, total = filtered.results[0]?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / FILES_PER_PAGE)), page = Math.min(fq.page, pages);   // a page past the end shows the last one
  const items = total === 0 ? [] : (await env.DB.prepare(`SELECT * FROM assets ${w} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`).bind(...binds, FILES_PER_PAGE, (page - 1) * FILES_PER_PAGE).all<Asset>()).results;
  return { items, total, page, pages, counts: { all, image: images, pdf: all - images } };
}

const safeName = (n: string, ext: string) => {
  const base = n.replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  return `${base}.${ext}`;
};

export async function saveUpload(file: File, alt: string, decorative: boolean): Promise<{ ok: true; asset: Asset } | { ok: false; error: string }> {
  if (file.size > MAX_PDF) return { ok: false, error: 'That file is too large (limit 10 MB for images, 15 MB for PDFs).' };
  let bytes = new Uint8Array(await file.arrayBuffer());
  let mime: string, ext: string, width: number | null, height: number | null;

  // What a file IS is decided by its first bytes, in this order: real picture/PDF signatures first, SVG (text) only if none matched.
  // (Looking for "<svg" first would misread a PNG whose metadata happens to contain that text, and let an SVG-looking prefix hide a binary.)
  const s = sniffBinary(bytes);
  if (s) {
    ({ mime, ext, width, height } = s);
    if (isImage(mime)) {
      const known = width !== null && height !== null;
      if ((mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/gif') && !(known && width! > 0 && height! > 0)) return { ok: false, error: 'That image looks damaged (it has no readable size).' };
      if (known && (width! > MAX_SIDE || height! > MAX_SIDE || width! * height! > MAX_PIXELS)) return { ok: false, error: `That image is too large in pixels (limit ${MAX_SIDE} px a side and 100 megapixels). Resize it first.` };
    }
    bytes = stripMetadata(bytes, mime); // GPS position, camera serial number, comments: the original is public, so they must not be in it
  } else if (new TextDecoder().decode(bytes.slice(0, 2000)).toLowerCase().includes('<svg')) {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return { ok: false, error: 'That SVG is not valid UTF-8 text.' }; }
    const clean = await sanitizeSvg(text);
    if (!clean) return { ok: false, error: 'That SVG could not be made safe (it may use scripts, entities or external references). Re-export it as a plain SVG, or use PNG.' };
    bytes = new TextEncoder().encode(clean);
    ({ width, height } = svgSize(clean));
    mime = 'image/svg+xml'; ext = 'svg';
  } else return { ok: false, error: 'Unsupported file. Use PNG, JPEG, WebP, AVIF, GIF, ICO, SVG or PDF.' };
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
 *
 * Cost: each project's text is read ONCE for the files it shows (see asset-refs.ts, the same rule the page renderer uses), then looked up in
 * a table of the files, so the work grows with the amount of text. (It used to search every project's text once per file, files x projects,
 * which on the free Workers plan's 10 ms CPU limit would have failed somewhere past a few hundred files.) The database hands over a text only
 * if it contains something that could be a reference; a project with no pictures in its text costs nothing here.
 */
export async function usageMap(assets: Asset[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(assets.map((a) => [a.id, []]));
  const add = (id: string | null | undefined, text: string) => { if (id && out.has(id)) out.get(id)!.push(text); };
  const s = await getSettings();
  add(s.portrait_asset, 'your portrait'); add(s.favicon_asset, 'your favicon'); add(s.og_asset, 'the default share image'); add(s.resume_asset, 'your resume PDF');
  const projects = (await env.DB.prepare(
    "SELECT title, slug, cover_asset, seo_image, CASE WHEN instr(body_md, '/media/') > 0 OR instr(body_md, '[[') > 0 THEN body_md ELSE '' END AS body_md FROM projects",
  ).all<{ title: string; slug: string; cover_asset: string | null; seo_image: string | null; body_md: string }>()).results;
  const byName = new Map<string, string[]>();                       // lower-case file name -> ids (the same name can be uploaded twice)
  for (const a of assets) { const k = a.filename.toLowerCase(); byName.set(k, [...(byName.get(k) ?? []), a.id]); }
  for (const p of projects) {
    const t = p.title || p.slug;
    add(p.cover_asset, `the cover of ${t}`); add(p.seo_image, `the share image of ${t}`);
    if (!p.body_md) continue;
    const { ids, names } = assetRefs(p.body_md);
    const shown = new Set<string>(ids);
    for (const n of names) for (const id of byName.get(n.toLowerCase()) ?? []) shown.add(id);  // every file of that name: the renderer shows one of them, and which can change if another is deleted
    for (const id of shown) add(id, `the text of ${t}`);
  }
  const pages = (await env.DB.prepare('SELECT page, og_asset FROM seo_pages WHERE og_asset IS NOT NULL').all<{ page: string; og_asset: string }>()).results;
  for (const r of pages) add(r.og_asset, `the share image of the ${r.page} page`);
  return out;
}
/** `known` is the file's row when the caller already loaded it (saves a database query). */
export async function assetUsage(id: string, known?: Asset | null): Promise<string[]> {
  const a = known ?? (await getAsset(id));
  return a ? (await usageMap([a])).get(id) ?? [] : [];
}
/** First reason an asset must not be deleted, or null. */
export async function assetInUse(id: string, known?: Asset | null): Promise<string | null> {
  const u = await assetUsage(id, known);
  return u.length ? `it is used as ${u[0]}${u.length > 1 ? ` and ${u.length - 1} other place${u.length > 2 ? 's' : ''}` : ''}` : null;
}
export async function deleteAsset(id: string, origin: string, known?: Asset | null) {
  const a = known ?? (await getAsset(id));
  if (!a) return;
  await env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(id).run();
  // Best effort: if storage hiccups here the file is left behind unused (the Files page's storage check finds and removes it), instead of the
  // owner seeing an error for a delete that already happened.
  try { await env.ASSETS_BUCKET.delete(a.r2_key); } catch (e) { console.error('[storage] could not remove', a.r2_key, e); }
  // Forgetting the cached copies is best effort too: the row and the file are already gone, so a failure here (for instance a request that has used
  // up its allowance of calls) must not turn a finished delete into an error page. Copies in other locations expire on their own within 7 days.
  try { const { purgeAssetCache } = await import('./media'); await purgeAssetCache(a, origin); } catch (e) { console.error('[cache] could not forget cached copies of', id, e); }
}
