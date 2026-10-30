// TEST-ONLY wrapper around the built site (dist/server/entry.mjs). It changes nothing about how the site behaves; it only COUNTS, per request,
// every call the Worker makes to a Cloudflare service, because a Worker on the free plan may make only a limited number of them per request
// (50 subrequests, which include D1 queries, R2 operations, Cache API calls and outgoing fetches).
//
//   send a request with an  x-count-id: <anything>  header, read the body to the end, then GET  /__counts?id=<same>  for the totals.
//
// It is never part of a deploy: wrangler.jsonc points at dist/server, and this file is only started by the test configuration (server E).
import app from '../../../dist/server/entry.mjs';
import { env } from 'cloudflare:workers';
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();
const seen = new Map();
const bump = (kind, what) => {
  const s = als.getStore(); if (!s) return;
  s[kind]++; s.calls.push(`${kind}: ${what}`);
  if (kind === 'images' && s.failImages) throw new Error('simulated: the transformation allowance is used up');
  // like Cloudflare does when a request has used up its allowance: x-count-limit: 50 makes the 51st call fail; x-count-limit-cache: 20 cuts off only the Cache API after 20 calls
  if ((s.limit && s.d1 + s.r2 + s.cache + s.fetch + s.images > s.limit) || (s.limitCache && kind === 'cache' && s.cache > s.limitCache)) { s.refused++; throw new Error('Too many subrequests by single Worker invocation.'); }
};

// D1 reports, for every query, how many rows it read and wrote (result.meta); those are what the free plan limits per DAY (5 million read, 100,000 written).
const meter = (res) => { const s = als.getStore(); const metas = Array.isArray(res) ? res.map((r) => r?.meta) : [res?.meta]; for (const m of metas) if (s && m) { s.rowsRead += m.rows_read ?? 0; s.rowsWritten += m.rows_written ?? 0; } return res; };
const real = new WeakMap(); // proxy -> the real object (D1 batch() needs the real statements back)
const unwrap = (x) => real.get(x) ?? x;

function wrapStmt(st, sql) {
  const p = new Proxy(st, { get(t, k) {
    const v = t[k]; if (typeof v !== 'function') return v;
    if (k === 'bind') return (...a) => wrapStmt(t.bind(...a), sql);
    if (['run', 'all'].includes(k)) return async (...a) => { bump('d1', sql.replace(/\s+/g, ' ').slice(0, 90)); return meter(await v.apply(t, a)); };
    if (k === 'first') return async (col) => { bump('d1', sql.replace(/\s+/g, ' ').slice(0, 90)); const r = meter(await t.all()); const row = r.results[0] ?? null; return col ? (row ? row[col] ?? null : null) : row; };   // same answer as first(), but we can read its meta
    if (k === 'raw') return async (...a) => { bump('d1', sql.replace(/\s+/g, ' ').slice(0, 90)); return v.apply(t, a); };
    return v.bind(t);
  } });
  real.set(p, st); return p;
}
function wrapDb(db) {
  return new Proxy(db, { get(t, k) {
    const v = t[k]; if (typeof v !== 'function') return v;
    if (k === 'prepare') return (sql) => wrapStmt(t.prepare(sql), sql);
    if (k === 'batch') return async (list) => { bump('d1', `batch of ${list.length}`); return meter(await t.batch(list.map(unwrap))); };
    if (k === 'exec' || k === 'dump') return (...a) => { bump('d1', k); return v.apply(t, a); };
    return v.bind(t);
  } });
}
const wrapCounted = (obj, kind, counted, chain = []) => new Proxy(obj, { get(t, k) {
  const v = t[k]; if (typeof v !== 'function') return v;
  if (counted.includes(k)) return (...a) => { bump(kind, `${String(k)} ${typeof a[0] === 'string' ? a[0].slice(0, 60) : ''}`); return v.apply(t, a); };
  if (chain.includes(k)) return (...a) => wrapCounted(v.apply(t, a), kind, counted, chain);
  return v.bind(t);
} });

try {
  env.DB = wrapDb(env.DB);
  env.ASSETS_BUCKET = wrapCounted(env.ASSETS_BUCKET, 'r2', ['get', 'put', 'delete', 'list', 'head']);
  env.IMAGES = wrapCounted(env.IMAGES, 'images', ['output'], ['input', 'transform', 'draw']);
} catch (e) { console.error('[counting] could not wrap the bindings', e); }

const C = Object.getPrototypeOf(caches.default);
for (const m of ['match', 'put', 'delete']) { const orig = C[m]; C[m] = function (...a) {
  bump('cache', `${m} ${a[0]?.url ?? a[0]}`.slice(0, 90));
  if (m === 'match' && als.getStore()?.otherColo) return Promise.resolve(undefined);   // x-count-other-colo: behave like a data center that has never seen this picture
  return orig.apply(this, a); }; }
const origFetch = globalThis.fetch;
globalThis.fetch = (input, init) => { bump('fetch', String(input?.url ?? input).slice(0, 60)); return origFetch(input, init); };

export default {
  async fetch(request, e, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/__counts') {
      const s = seen.get(url.searchParams.get('id') ?? '');
      return Response.json(s ? { ...s, total: s.d1 + s.r2 + s.cache + s.fetch + s.images } : null);
    }
    const id = request.headers.get('x-count-id');
    if (!id) return app.fetch(request, e, ctx);
    const store = { d1: 0, r2: 0, cache: 0, fetch: 0, images: 0, rowsRead: 0, rowsWritten: 0, calls: [], refused: 0, limit: Number(request.headers.get('x-count-limit') ?? 0), limitCache: Number(request.headers.get('x-count-limit-cache') ?? 0), otherColo: request.headers.has('x-count-other-colo'), failImages: request.headers.has('x-count-fail-images') };
    seen.set(id, store); if (seen.size > 400) seen.delete(seen.keys().next().value);
    return als.run(store, () => app.fetch(request, e, ctx));
  },
};
