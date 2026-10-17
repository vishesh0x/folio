import { env } from 'cloudflare:workers';

export type Category = { id: number; name: string; icon: string | null; sort_order: number };
export type Item = { id: number; category_id: number; title: string; note: string; link: string | null; status: 'current' | 'done'; started_at: number | null; finished_at: number | null; progress: number | null; sort_order: number; updated_at: number };
export const MAX_CATEGORIES = 20, MAX_ITEMS = 50;

export async function loadBoard() {
  const cats = (await env.DB.prepare('SELECT * FROM now_categories ORDER BY sort_order, id').all<Category>()).results;
  const items = (await env.DB.prepare('SELECT * FROM now_items ORDER BY sort_order, id').all<Item>()).results;
  return cats.map((c) => ({ ...c, items: items.filter((i) => i.category_id === c.id) }));
}

/* ── text and date helpers ── */
const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export const parseName = (s: unknown) => clean(s, 40);
export const parseIcon = (s: unknown) => clean(s, 12) || null;
export const parseTitle = (s: unknown) => clean(s, 120);
export const parseNote = (s: unknown) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 400);
export function parseLink(s: unknown): string | null | 'bad' {
  const v = clean(s, 500);
  if (!v) return null;
  try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : 'bad'; } catch { return 'bad'; }
}
/** "2026-03" -> unix seconds for noon UTC on the 1st (noon, so no time zone can push it into another month). */
export function parseMonth(s: unknown): number | null | 'bad' {
  const v = String(s ?? '').trim();
  if (!v) return null;
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(v);
  if (!m) return 'bad';
  const t = Date.UTC(+m[1], +m[2] - 1, 1, 12) / 1000;
  const now = new Date(); const endOfThisMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 12) / 1000;
  return +m[1] < 1990 || t >= endOfThisMonth ? 'bad' : t;
}
export const monthValue = (t: number | null) => (t ? new Date(t * 1000).toISOString().slice(0, 7) : '');
export const currentMonthStamp = () => { const n = new Date(); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1, 12) / 1000; };

/* ── categories ── */
export async function addCategory(name: string, icon: string | null): Promise<string | null> {
  if (!name) return 'Give the category a name.';
  const cats = await env.DB.prepare('SELECT name FROM now_categories').all<{ name: string }>();
  if (cats.results.length >= MAX_CATEGORIES) return `You can have at most ${MAX_CATEGORIES} categories.`;
  if (cats.results.some((c) => c.name.toLowerCase() === name.toLowerCase())) return 'You already have a category with that name.';
  const max = (await env.DB.prepare('SELECT coalesce(max(sort_order), -1) AS m FROM now_categories').first<{ m: number }>())!.m;
  await env.DB.prepare('INSERT INTO now_categories (name, icon, sort_order) VALUES (?, ?, ?)').bind(name, icon, max + 1).run();
  return null;
}
export async function renameCategory(id: number, name: string, icon: string | null): Promise<string | null> {
  if (!name) return 'Give the category a name.';
  const dup = await env.DB.prepare('SELECT 1 AS x FROM now_categories WHERE lower(name) = lower(?) AND id <> ?').bind(name, id).first();
  if (dup) return 'You already have a category with that name.';
  await env.DB.prepare('UPDATE now_categories SET name = ?, icon = ? WHERE id = ?').bind(name, icon, id).run();
  return null;
}
export const deleteCategory = async (id: number) => (await env.DB.prepare('DELETE FROM now_categories WHERE id = ?').bind(id).run()).meta.changes > 0; // items go with it (ON DELETE CASCADE)

async function renumber(table: 'now_categories' | 'now_items', ids: number[]) {
  await env.DB.batch(ids.map((id, n) => env.DB.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`).bind(n, id)));
}
export async function moveCategory(id: number, dir: 'up' | 'down'): Promise<boolean> {
  const ids = (await env.DB.prepare('SELECT id FROM now_categories ORDER BY sort_order, id').all<{ id: number }>()).results.map((r) => r.id);
  const i = ids.indexOf(id), j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0) return false;                       // category no longer exists
  if (j < 0 || j >= ids.length) return true;     // already at the end: nothing to do, not an error
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await renumber('now_categories', ids);
  return true;
}

/* ── items ── */
export type ItemInput = { title: string; note: string; link: string | null; started_at: number | null; finished_at: number | null; progress: number | null };
/** "" -> no bar; whole number 0 to 100 -> bar; anything else -> 'bad'. */
export function parseProgress(s: unknown): number | null | 'bad' {
  const v = String(s ?? '').trim().replace(/%$/, '');
  if (!v) return null;
  return /^\d{1,3}$/.test(v) && +v <= 100 ? +v : 'bad';
}
export function checkDates(started: number | null, finished: number | null, status: 'current' | 'done'): string | null {
  if (started && finished && finished < started) return 'It cannot finish before it started.';
  if (status === 'current' && finished) return null;
  return null;
}
export async function addItem(categoryId: number, status: 'current' | 'done', i: ItemInput): Promise<string | null> {
  const cat = await env.DB.prepare('SELECT 1 AS x FROM now_categories WHERE id = ?').bind(categoryId).first();
  if (!cat) return 'That category no longer exists.';
  const info = (await env.DB.prepare('SELECT count(*) AS n, coalesce(max(sort_order), -1) AS m FROM now_items WHERE category_id = ?').bind(categoryId).first<{ n: number; m: number }>())!;
  if (info.n >= MAX_ITEMS) return `A category can hold at most ${MAX_ITEMS} items. Remove some old ones first.`;
  const finished = status === 'done' ? (i.finished_at ?? currentMonthStamp()) : null;
  await env.DB.prepare(`INSERT INTO now_items (category_id, title, note, link, status, started_at, finished_at, progress, sort_order, updated_at) VALUES (?,?,?,?,?,?,?,?,?, unixepoch())`)
    .bind(categoryId, i.title, i.note, i.link, status, i.started_at, finished, status === 'done' ? null : i.progress, info.m + 1).run();
  return null;
}
export async function updateItem(id: number, categoryId: number, i: ItemInput): Promise<string | null> {
  const cur = await env.DB.prepare('SELECT category_id, status FROM now_items WHERE id = ?').bind(id).first<{ category_id: number; status: string }>();
  if (!cur) return 'That item no longer exists.';
  let sort: number | null = null;
  if (categoryId !== cur.category_id) { // moving to another category: put it at the end there
    const cat = await env.DB.prepare('SELECT 1 AS x FROM now_categories WHERE id = ?').bind(categoryId).first();
    if (!cat) return 'That category no longer exists.';
    const info = (await env.DB.prepare('SELECT count(*) AS n, coalesce(max(sort_order), -1) AS m FROM now_items WHERE category_id = ?').bind(categoryId).first<{ n: number; m: number }>())!;
    if (info.n >= MAX_ITEMS) return `That category is full (${MAX_ITEMS} items).`;
    sort = info.m + 1;
  }
  const finished = cur.status === 'done' ? (i.finished_at ?? currentMonthStamp()) : null;
  await env.DB.prepare(`UPDATE now_items SET category_id = ?, title = ?, note = ?, link = ?, started_at = ?, finished_at = ?, progress = ?, sort_order = coalesce(?, sort_order), updated_at = unixepoch() WHERE id = ?`)
    .bind(categoryId, i.title, i.note, i.link, i.started_at, finished, cur.status === 'done' ? null : i.progress, sort, id).run();
  return null;
}
export const markDone = async (id: number) => (await env.DB.prepare(`UPDATE now_items SET status = 'done', progress = NULL, finished_at = coalesce(finished_at, ?), updated_at = unixepoch() WHERE id = ?`).bind(currentMonthStamp(), id).run()).meta.changes > 0;
export const reopen = async (id: number) => (await env.DB.prepare(`UPDATE now_items SET status = 'current', finished_at = NULL, updated_at = unixepoch() WHERE id = ?`).bind(id).run()).meta.changes > 0;
export const deleteItem = async (id: number) => (await env.DB.prepare('DELETE FROM now_items WHERE id = ?').bind(id).run()).meta.changes > 0;

/** Swap with the neighbour of the same kind (current/finished) in the same category, then renumber the category. */
export async function moveItem(id: number, dir: 'up' | 'down'): Promise<boolean> {
  const me = await env.DB.prepare('SELECT category_id, status FROM now_items WHERE id = ?').bind(id).first<{ category_id: number; status: string }>();
  if (!me) return false;
  const all = (await env.DB.prepare('SELECT id, status FROM now_items WHERE category_id = ? ORDER BY sort_order, id').bind(me.category_id).all<{ id: number; status: string }>()).results;
  const same = all.map((r, idx) => ({ ...r, idx })).filter((r) => r.status === me.status);
  const pos = same.findIndex((r) => r.id === id), other = dir === 'up' ? pos - 1 : pos + 1;
  if (pos < 0) return false;
  if (other < 0 || other >= same.length) return true; // already first/last of its kind: nothing to do
  const a = same[pos].idx, b = same[other].idx;
  [all[a], all[b]] = [all[b], all[a]];
  await renumber('now_items', all.map((r) => r.id));
  return true;
}
