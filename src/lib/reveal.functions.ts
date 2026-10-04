import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db.server";
import { getEnv } from "@/server/env.server";
import { clientKey, rateLimit } from "@/server/ratelimit.server";
import { verifyTurnstile } from "@/server/turnstile.server";

export const REVEAL_FIELDS = ["siteEmail", "resumeEmail", "resumePhone"] as const;
export type RevealField = (typeof REVEAL_FIELDS)[number];

const MAX_PER_HOUR = 20;

/**
 * Click-to-reveal for contact details marked "reveal" in the dashboard.
 * The value never appears in the page HTML; it is returned only to a visitor who asks for it,
 * is under the rate limit, and (when Turnstile is configured) passes the challenge.
 * A hand-rolled validator keeps zod out of the public JS bundle.
 */
export const revealContact = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const o = (d ?? {}) as { field?: unknown; turnstileToken?: unknown };
    if (typeof o.field !== "string" || !(REVEAL_FIELDS as readonly string[]).includes(o.field)) {
      throw new Error("Invalid request");
    }
    const token = typeof o.turnstileToken === "string" ? o.turnstileToken.slice(0, 4096) : "";
    return { field: o.field as RevealField, turnstileToken: token };
  })
  .handler(async ({ data }) => {
    const request = getRequest();
    const env = getEnv();
    const db = getDb();

    const rl = await rateLimit(db, `reveal:${await clientKey(request)}`, MAX_PER_HOUR, 3600);
    if (!rl.allowed) throw new Error("Too many requests. Please try again a bit later.");

    if (env.TURNSTILE_SECRET_KEY) {
      const ok = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, data.turnstileToken, request);
      if (!ok) throw new Error("Spam check failed. Please try again.");
    }

    let value = "";
    let mode = "hidden";
    if (data.field === "siteEmail") {
      const row = await db
        .select({ v: schema.siteConfig.email, m: schema.siteConfig.emailPrivacy })
        .from(schema.siteConfig)
        .where(eq(schema.siteConfig.id, 1))
        .get();
      value = row?.v ?? "";
      mode = row?.m ?? "hidden";
    } else {
      const row = await db
        .select({
          email: schema.resumeProfile.email,
          phone: schema.resumeProfile.phone,
          em: schema.resumeProfile.emailPrivacy,
          pm: schema.resumeProfile.phonePrivacy,
        })
        .from(schema.resumeProfile)
        .where(eq(schema.resumeProfile.id, 1))
        .get();
      const email = data.field === "resumeEmail";
      value = (email ? row?.email : row?.phone) ?? "";
      mode = (email ? row?.em : row?.pm) ?? "hidden";
    }
    // Only details the owner explicitly set to "reveal" can be fetched this way.
    if (mode !== "reveal" || !value) throw new Error("This detail isn't available.");
    return { value };
  });
