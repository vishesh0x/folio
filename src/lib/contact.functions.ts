import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { contactSchema } from "./validators";
import { getDb, schema } from "@/server/db.server";
import { getEnv } from "@/server/env.server";
import { clientKey, rateLimit } from "@/server/ratelimit.server";

const MAX_PER_HOUR = 5;

async function verifyTurnstile(secret: string, token: string, request: Request): Promise<boolean> {
  if (!token) return false;
  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) body.set("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    const out = (await res.json()) as { success?: boolean };
    return out.success === true;
  } catch {
    return false;
  }
}

/**
 * Contact form endpoint.
 * Defences: strict validation, honeypot field, per-IP rate limit (D1), and
 * optional Cloudflare Turnstile when TURNSTILE_SECRET_KEY is configured.
 */
export const sendMessage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => contactSchema.parse(d))
  .handler(async ({ data }) => {
    // Honeypot: bots fill every field. Pretend it worked, store nothing.
    if (data.website) return { ok: true as const };

    const request = getRequest();
    const env = getEnv();
    const db = getDb();

    const rl = await rateLimit(db, `contact:${await clientKey(request)}`, MAX_PER_HOUR, 3600);
    if (!rl.allowed) {
      throw new Error("You've sent a few messages already. Please try again a bit later.");
    }

    if (env.TURNSTILE_SECRET_KEY) {
      const ok = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, data.turnstileToken, request);
      if (!ok) throw new Error("Spam check failed. Please reload the page and try again.");
    }

    await db.insert(schema.contactMessages).values({
      id: crypto.randomUUID(),
      name: data.name,
      email: data.email,
      subject: data.subject,
      message: data.message,
    });
    return { ok: true as const };
  });
