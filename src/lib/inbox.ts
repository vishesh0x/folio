/**
 * Contact-form messages: queries, state changes and CSV export for the owner's inbox.
 */

import { env } from 'cloudflare:workers';

/** A contact-form message. */
export type Message = { id: number; name: string; email: string; subject: string | null; body: string; is_read: number; created_at: number };
/** Messages shown per inbox page. */
export const PAGE_SIZE = 25;

/** Number of unread messages. */
export async function unreadCount(): Promise<number> {
  try { return (await env.DB.prepare('SELECT count(*) AS n FROM messages WHERE is_read = 0').first<{ n: number }>())?.n ?? 0; } catch { return 0; }
}

/** One page of messages, newest first, optionally only the unread ones. */
export async function listMessages(filter: 'all' | 'unread', page: number) {
  const where = filter === 'unread' ? 'WHERE is_read = 0' : '';
  const total = (await env.DB.prepare(`SELECT count(*) AS n FROM messages ${where}`).first<{ n: number }>())?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = Math.min(Math.max(1, page), pages);
  const rows = (await env.DB.prepare(`SELECT * FROM messages ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).bind(PAGE_SIZE, (p - 1) * PAGE_SIZE).all<Message>()).results;
  return { rows, total, pages, page: p };
}

/** Loads one message by id. */
export const getMessage = (id: number) => env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first<Message>();
/** Marks a message read or unread. */
export const setRead = (id: number, read: boolean) => env.DB.prepare('UPDATE messages SET is_read = ? WHERE id = ?').bind(read ? 1 : 0, id).run();
/** Deletes one message. */
export const removeMessage = (id: number) => env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
/** Marks every message as read. */
export const markAllRead = () => env.DB.prepare('UPDATE messages SET is_read = 1 WHERE is_read = 0').run();

// ── The owner's tools for people's data: download everything, delete one person's messages, delete old ones ──
const csvCell = (v: unknown) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;  // A spreadsheet would run a cell that starts like a formula; a visitor wrote these texts
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Every message as CSV (opens in any spreadsheet). */
export async function messagesCsv(): Promise<string> {
  const rows = (await env.DB.prepare('SELECT id, created_at, name, email, subject, body, is_read FROM messages ORDER BY id').all<Message>()).results;
  const lines = ['id,received_at,name,email,subject,message,read'];
  for (const m of rows) lines.push([m.id, new Date(m.created_at * 1000).toISOString(), m.name, m.email, m.subject, m.body, m.is_read ? 'yes' : 'no'].map(csvCell).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';  // The byte-order mark makes spreadsheets read accents correctly
}
/** Deletes every message from an email address (case-insensitive). Returns how many. */
export async function deleteByEmail(email: string): Promise<number> {
  const r = await env.DB.prepare('DELETE FROM messages WHERE lower(email) = lower(?)').bind(email.trim()).run();
  return r.meta.changes ?? 0;
}
/** Deletes messages received more than `days` days ago. Returns how many. */
export async function deleteOlderThan(days: number): Promise<number> {
  const r = await env.DB.prepare("DELETE FROM messages WHERE created_at < unixepoch() - ?").bind(Math.round(days) * 86400).run();
  return r.meta.changes ?? 0;
}
