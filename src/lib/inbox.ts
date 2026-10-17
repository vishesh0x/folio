import { env } from 'cloudflare:workers';

export type Message = { id: number; name: string; email: string; subject: string | null; body: string; is_read: number; created_at: number };
export const PAGE_SIZE = 25;

export async function unreadCount(): Promise<number> {
  try { return (await env.DB.prepare('SELECT count(*) AS n FROM messages WHERE is_read = 0').first<{ n: number }>())?.n ?? 0; } catch { return 0; }
}

export async function listMessages(filter: 'all' | 'unread', page: number) {
  const where = filter === 'unread' ? 'WHERE is_read = 0' : '';
  const total = (await env.DB.prepare(`SELECT count(*) AS n FROM messages ${where}`).first<{ n: number }>())?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = Math.min(Math.max(1, page), pages);
  const rows = (await env.DB.prepare(`SELECT * FROM messages ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).bind(PAGE_SIZE, (p - 1) * PAGE_SIZE).all<Message>()).results;
  return { rows, total, pages, page: p };
}

export const getMessage = (id: number) => env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first<Message>();
export const setRead = (id: number, read: boolean) => env.DB.prepare('UPDATE messages SET is_read = ? WHERE id = ?').bind(read ? 1 : 0, id).run();
export const removeMessage = (id: number) => env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
export const markAllRead = () => env.DB.prepare('UPDATE messages SET is_read = 1 WHERE is_read = 0').run();
