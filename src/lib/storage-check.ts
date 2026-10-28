import { env } from 'cloudflare:workers';
import { stripMetadata } from './strip';
import { mediaKey } from './media';

/**
 * Compare what is in the R2 bucket with what the database says exists.
 *  - STRAY file: an object with no database row. Left behind by an upload that was interrupted, or a delete where storage failed.
 *    It costs storage and is public to anyone who has its address, but nothing on the site uses it. Safe to remove.
 *  - BROKEN entry: a database row whose file is missing. Pages that use it show a missing picture. Only reported, never changed here.
 * A stray file younger than `minAgeSecs` is ignored: it may be an upload that is happening right now.
 * Reading the list costs one "Class A" operation per 1,000 objects, nothing else.
 */
export type StorageReport = {
  objects: number; bytes: number;
  strays: { key: string; size: number; uploaded: string }[];
  broken: { id: string; filename: string }[];
  truncated: boolean;
};
const PAGE = 1000, MAX_PAGES = 20; // looks at up to 20,000 objects, far more than this site will ever hold

export async function storageReport(minAgeSecs = 3600): Promise<StorageReport> {
  const keys = new Map<string, { size: number; uploaded: Date }>();
  let cursor: string | undefined, truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const l = await env.ASSETS_BUCKET.list({ prefix: 'assets/', limit: PAGE, cursor });
    for (const o of l.objects) keys.set(o.key, { size: o.size, uploaded: o.uploaded });
    if (!l.truncated) break;
    cursor = l.cursor;
    if (page === MAX_PAGES - 1) truncated = true;
  }
  const rows = (await env.DB.prepare('SELECT id, r2_key, filename FROM assets').all<{ id: string; r2_key: string; filename: string }>()).results;
  const known = new Set(rows.map((r) => r.r2_key));
  const cutoff = Date.now() - minAgeSecs * 1000;
  const strays = [...keys].filter(([k, v]) => !known.has(k) && v.uploaded.getTime() <= cutoff).map(([key, v]) => ({ key, size: v.size, uploaded: v.uploaded.toISOString() }));
  const broken = rows.filter((r) => !keys.has(r.r2_key)).map((r) => ({ id: r.id, filename: r.filename }));
  return { objects: keys.size, bytes: [...keys.values()].reduce((n, v) => n + v.size, 0), strays, broken, truncated };
}

/** Delete the stray files a report found (never anything the database knows about). */
export async function removeStrays(minAgeSecs = 3600): Promise<{ removed: number; bytes: number }> {
  const r = await storageReport(minAgeSecs);
  if (r.truncated) return { removed: 0, bytes: 0 };   // an incomplete picture of the bucket is not a safe basis for deleting anything
  for (let i = 0; i < r.strays.length; i += 1000) await env.ASSETS_BUCKET.delete(r.strays.slice(i, i + 1000).map((s) => s.key));
  return { removed: r.strays.length, bytes: r.strays.reduce((n, s) => n + s.size, 0) };
}

/**
 * Remove location, camera and comment data from pictures that were uploaded BEFORE uploads were cleaned automatically.
 * Works in small batches (BATCH pictures per call, each costing a handful of storage operations) because a Worker may make only a limited
 * number of storage/database calls per request; the caller repeats with `next` until it is null. A file is rewritten only if something
 * was actually removed, so running it again changes nothing.
 */
const BATCH = 8;
export async function scrubMetadata(origin: string, offset = 0): Promise<{ checked: number; cleaned: number; bytesSaved: number; failed: number; next: number | null }> {
  const rows = (await env.DB.prepare("SELECT id, r2_key, mime FROM assets WHERE mime IN ('image/jpeg', 'image/png', 'image/webp') ORDER BY created_at, id LIMIT ?1 OFFSET ?2")
    .bind(BATCH, offset).all<{ id: string; r2_key: string; mime: string }>()).results;
  let cleaned = 0, bytesSaved = 0, failed = 0;
  for (const r of rows) {
    try {
      const obj = await env.ASSETS_BUCKET.get(r.r2_key);
      if (!obj) continue;                                              // a broken entry: reported by the storage check, not our business here
      const before = new Uint8Array(await obj.arrayBuffer()), after = stripMetadata(before, r.mime);
      if (after.length >= before.length) continue;                     // nothing to remove
      await env.ASSETS_BUCKET.put(r.r2_key, after, { httpMetadata: obj.httpMetadata, customMetadata: obj.customMetadata });
      await env.DB.prepare('UPDATE assets SET size = ? WHERE id = ?').bind(after.length, r.id).run();
      await caches.default.delete(new Request(mediaKey(origin, r.id, null))); // the cached ORIGINAL would keep serving the old bytes (resized copies never carried it)
      cleaned++; bytesSaved += before.length - after.length;
    } catch (e) { failed++; console.error('[storage] could not clean', r.r2_key, e); }
  }
  return { checked: rows.length, cleaned, bytesSaved, failed, next: rows.length === BATCH ? offset + BATCH : null };
}
