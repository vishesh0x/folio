import { env } from 'cloudflare:workers';

/** Counts a hit for `key` and says whether it is still within `max` hits per `windowSecs`. One atomic statement. */
export async function allow(key: string, max: number, windowSecs: number): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `INSERT INTO login_attempts (key, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count        = CASE WHEN window_start < ?2 - ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start < ?2 - ?3 THEN ?2 ELSE window_start END
     RETURNING count`
  ).bind(key, now, windowSecs).first<{ count: number }>();
  // Retention: rows hold visitor IP addresses and the longest window is 1 hour, so anything older than 2 hours is useless. Pruned on about
  // 1 in 20 calls, which keeps the table tiny without a scheduled job (idx_attempts_window makes it cheap).
  if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM login_attempts WHERE window_start < ?').bind(now - 7200).run();
  return (row?.count ?? 1) <= max;
}
export const ipOf = (request: Request) => request.headers.get('cf-connecting-ip') ?? 'local';
