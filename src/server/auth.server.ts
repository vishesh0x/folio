import { deleteCookie, getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import { and, eq, gt, lt } from "drizzle-orm";
import { randomToken, sha256Hex } from "./crypto.server";
import { getDb, schema } from "./db.server";

/**
 * Cookie sessions.
 *  - The cookie holds a random 256-bit token; D1 stores only its SHA-256, so a
 *    database leak can't be replayed as a login.
 *  - HttpOnly + SameSite=Lax + Secure (with the `__Host-` prefix on https), so
 *    JavaScript (and therefore XSS) can't read it.
 */
const SESSION_DAYS = 14;

function isSecure(request: Request) {
  return new URL(request.url).protocol === "https:";
}
const cookieName = (secure: boolean) => (secure ? "__Host-folio_session" : "folio_session");

export type AdminUser = { id: string; email: string };

export async function createSession(userId: string): Promise<void> {
  const request = getRequest();
  const secure = isSecure(request);
  const db = getDb();
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(schema.sessions).values({
    id: await sha256Hex(token),
    userId,
    expiresAt: expires.toISOString(),
  });
  setCookie(cookieName(secure), token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires,
  });
  // Opportunistic cleanup of expired sessions.
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date().toISOString()));
}

export async function destroySession(): Promise<void> {
  const secure = isSecure(getRequest());
  const name = cookieName(secure);
  const token = getCookie(name);
  if (token) {
    await getDb()
      .delete(schema.sessions)
      .where(eq(schema.sessions.id, await sha256Hex(token)));
  }
  deleteCookie(name, { path: "/", secure, httpOnly: true, sameSite: "lax" });
}

/** The signed-in admin for the current request, or `null`. */
export async function getAdmin(): Promise<AdminUser | null> {
  const secure = isSecure(getRequest());
  const token = getCookie(cookieName(secure));
  if (!token || token.length > 128) return null;
  const rows = await getDb()
    .select({ id: schema.adminUsers.id, email: schema.adminUsers.email })
    .from(schema.sessions)
    .innerJoin(schema.adminUsers, eq(schema.sessions.userId, schema.adminUsers.id))
    .where(
      and(
        eq(schema.sessions.id, await sha256Hex(token)),
        gt(schema.sessions.expiresAt, new Date().toISOString()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
