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
  return (row?.count ?? 1) <= max;
}
export const ipOf = (request: Request) => request.headers.get('cf-connecting-ip') ?? 'local';
