import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "./admin-middleware";
import { createSession, destroySession, getAdmin } from "@/server/auth.server";
import { hashPassword, safeEqualStrings, verifyPassword } from "@/server/crypto.server";
import { getDb, schema } from "@/server/db.server";
import { getEnv } from "@/server/env.server";
import { clientKey, rateLimit, resetRateLimit } from "@/server/ratelimit.server";

// The validators run on the server only, but TanStack keeps `.inputValidator()` callbacks in
// the client stubs. Importing zod lazily keeps ~55 kB (minified) out of the main bundle:
// the dynamic import is never executed in the browser.
const validators = () => import("./validators");

// A precomputed hash lets us spend the same time on unknown emails as on real
// ones, so response timing doesn't reveal which emails exist.
const DUMMY_HASH =
  "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

/** Used by /auth and by the dashboard route guard. */
export const getAuthState = createServerFn({ method: "GET" }).handler(async () => {
  const [admin, row] = await Promise.all([
    getAdmin(),
    getDb()
      .select({ n: sql<number>`count(*)` })
      .from(schema.adminUsers)
      .get(),
  ]);
  const exists = (row?.n ?? 0) > 0;
  return {
    admin,
    needsSetup: !exists,
    // Tells the setup form whether the operator has configured a setup token.
    setupAvailable: !exists && !!getEnv().ADMIN_SETUP_TOKEN,
  };
});

/**
 * One-time bootstrap of the (only) admin account.
 * Requires the ADMIN_SETUP_TOKEN secret, so a stranger who finds a fresh
 * deployment can't claim it. The insert is a single atomic statement that
 * only succeeds while no admin exists.
 */
export const setupAdmin = createServerFn({ method: "POST" })
  .inputValidator(async (d: unknown) => (await validators()).setupSchema.parse(d))
  .handler(async ({ data }) => {
    const db = getDb();
    const request = getRequest();
    const rl = await rateLimit(db, `setup:${await clientKey(request)}`, 10, 900);
    if (!rl.allowed) throw new Error("Too many attempts. Try again later.");

    const expected = getEnv().ADMIN_SETUP_TOKEN;
    if (!expected) throw new Error("Setup is disabled: set the ADMIN_SETUP_TOKEN secret first.");
    if (!(await safeEqualStrings(data.setupToken, expected)))
      throw new Error("Invalid setup token.");

    const id = crypto.randomUUID();
    const hash = await hashPassword(data.password);
    const res = await db.run(sql`
      INSERT INTO admin_users (id, email, password_hash)
      SELECT ${id}, ${data.email.toLowerCase()}, ${hash}
      WHERE NOT EXISTS (SELECT 1 FROM admin_users)`);
    if (!res.meta.changes) throw new Error("An admin account already exists.");
    await createSession(id);
    return { ok: true as const };
  });

export const login = createServerFn({ method: "POST" })
  .inputValidator(async (d: unknown) => (await validators()).loginSchema.parse(d))
  .handler(async ({ data }) => {
    const db = getDb();
    const request = getRequest();
    const key = `login:${await clientKey(request)}`;
    const rl = await rateLimit(db, key, 8, 900);
    if (!rl.allowed) {
      throw new Error(
        `Too many attempts. Try again in ${Math.ceil(rl.retryAfter / 60)} minute(s).`,
      );
    }

    const user = await db
      .select()
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.email, data.email.toLowerCase()))
      .get();
    const ok = await verifyPassword(data.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new Error("Invalid email or password.");

    await resetRateLimit(db, key);
    await createSession(user.id);
    return { ok: true as const };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  await destroySession();
  return { ok: true as const };
});

export const changePassword = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(async (d: unknown) => (await validators()).changePasswordSchema.parse(d))
  .handler(async ({ data, context }) => {
    const db = getDb();
    const rl = await rateLimit(db, `pw:${context.admin.id}`, 5, 900);
    if (!rl.allowed) throw new Error("Too many attempts. Try again later.");

    const user = await db
      .select()
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.id, context.admin.id))
      .get();
    if (!user || !(await verifyPassword(data.current, user.passwordHash))) {
      throw new Error("Current password is incorrect.");
    }
    await db
      .update(schema.adminUsers)
      .set({ passwordHash: await hashPassword(data.next) })
      .where(eq(schema.adminUsers.id, user.id));

    // Sign out every other device; keep (re-issue) this one.
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
    await createSession(user.id);
    return { ok: true as const };
  });
