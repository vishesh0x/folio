import { sql } from "drizzle-orm";
import { sha256Hex } from "./crypto.server";
import type { Db } from "./db.server";

/** Privacy-friendly client key: hash of the IP, never the raw address. */
export async function clientKey(request: Request): Promise<string> {
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return (await sha256Hex(`folio:${ip}`)).slice(0, 32);
}

export type RateResult = { allowed: boolean; remaining: number; retryAfter: number };

/**
 * Fixed-window counter stored in D1 (atomic upsert). Returns whether this hit
 * is allowed. Cheap enough for a login form and a contact form.
 */
export async function rateLimit(
  db: Db,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateResult> {
  const nowS = Math.floor(Date.now() / 1000);
  const cutoff = nowS - windowSeconds;
  const rows = await db.all<{ count: number; window_start: number }>(sql`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${nowS}, 1)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN window_start <= ${cutoff} THEN 1 ELSE count + 1 END,
      window_start = CASE WHEN window_start <= ${cutoff} THEN ${nowS} ELSE window_start END
    RETURNING count, window_start`);
  const row = rows[0]!;
  const retryAfter = Math.max(1, row.window_start + windowSeconds - nowS);
  return { allowed: row.count <= limit, remaining: Math.max(0, limit - row.count), retryAfter };
}

export async function resetRateLimit(db: Db, key: string) {
  await db.run(sql`DELETE FROM rate_limits WHERE key = ${key}`);
}

/** Housekeeping: drop stale counters (called opportunistically). */
export async function pruneRateLimits(db: Db, olderThanSeconds = 86_400) {
  const cutoff = Math.floor(Date.now() / 1000) - olderThanSeconds;
  await db.run(sql`DELETE FROM rate_limits WHERE window_start < ${cutoff}`);
}
