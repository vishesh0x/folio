import type { APIRequestContext } from '@playwright/test';
import { sameOrigin } from '../helpers';
import { SETUP_TOKEN } from '../../../playwright.config';

export const OWNER = { email: 'limits@example.com', password: 'correct horse battery staple 42' };
export type Counts = { d1: number; r2: number; cache: number; fetch: number; images: number; total: number; calls: string[]; refused: number };

/** Create (or sign in as) the owner on server E, so the dashboard can be asked for. */
export async function signIn(ctx: APIRequestContext, baseURL: string) {
  let r = await ctx.post('/auth', { form: { mode: 'setup', token: SETUP_TOKEN, email: OWNER.email, password: OWNER.password, confirm: OWNER.password }, headers: sameOrigin(baseURL), maxRedirects: 0 });
  if (r.status() !== 302) r = await ctx.post('/auth', { form: { mode: 'login', email: OWNER.email, password: OWNER.password }, headers: sameOrigin(baseURL), maxRedirects: 0 });
  if (r.status() !== 302) throw new Error(`could not sign in on the counting server (${r.status()})`);
}

let n = 0;
/**
 * Make one request through the counting wrapper (tests/tools/counting/entry.mjs) and report how many calls the Worker made to Cloudflare
 * services while answering it: database queries (d1), file storage (r2), the page cache (cache), image processing (images), outgoing fetches (fetch).
 * The free Workers plan allows 50 such calls per request.
 */
export async function counted(ctx: APIRequestContext, baseURL: string, method: 'GET' | 'POST', path: string, opts: { form?: Record<string, string>; multipart?: any; limit?: number; limitCache?: number } = {}) {
  const id = `t${Date.now().toString(36)}-${++n}`;
  const res = await ctx.fetch(path, { method, headers: { ...(method === 'POST' ? sameOrigin(baseURL) : {}), 'x-count-id': id, ...(opts.limit ? { 'x-count-limit': String(opts.limit) } : {}), ...(opts.limitCache ? { 'x-count-limit-cache': String(opts.limitCache) } : {}) }, form: opts.form, multipart: opts.multipart, maxRedirects: 0 });
  await res.body();                                   // read to the end: a streamed page keeps making calls until the last byte
  const counts = (await (await ctx.get(`/__counts?id=${id}`)).json()) as Counts;
  return { res, counts };
}
