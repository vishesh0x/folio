import { eq } from "drizzle-orm";
import { MAX_UPLOAD_BYTES, buildKey, sniffFileType } from "@/lib/media-core";
import { altText } from "@/lib/validators";
import { getAdmin } from "./auth.server";
import { randomToken } from "./crypto.server";
import { getDb, schema } from "./db.server";
import type { AppEnv } from "./env.server";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Same-origin check for state-changing requests that don't go through server functions. */
function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

/** POST /api/admin/upload (multipart: file, alt?) → { asset } */
export async function handleUpload(request: Request, env: AppEnv): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Cross-site request blocked" }, 403);
  if (!(await getAdmin())) return json({ error: "Unauthorized" }, 401);

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024)
    return json({ error: "File too large (max 10 MB)" }, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Invalid upload" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "No file provided" }, 400);
  if (file.size === 0) return json({ error: "File is empty" }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return json({ error: "File too large (max 10 MB)" }, 413);

  // Identify by content, not by the browser-supplied type or extension.
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const type = sniffFileType(head);
  if (!type) {
    return json(
      { error: "Unsupported file type. Use PNG, JPEG, WebP, AVIF, GIF, ICO or PDF." },
      415,
    );
  }

  let width: number | null = null;
  let height: number | null = null;
  if (type.mime.startsWith("image/") && type.mime !== "image/x-icon") {
    try {
      const info = await env.IMAGES.info(file.stream());
      if ("width" in info) {
        width = info.width;
        height = info.height;
      }
    } catch {
      return json({ error: "That image looks corrupted or isn't a valid image." }, 415);
    }
  }

  const alt = altText.safeParse(form.get("alt") ?? "");
  const key = buildKey(file.name, type.ext, randomToken(6));
  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: type.mime, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { originalName: file.name.slice(0, 200) },
  });

  const db = getDb();
  const id = crypto.randomUUID();
  try {
    await db.insert(schema.assets).values({
      id,
      key,
      name: file.name.slice(0, 200),
      mime: type.mime,
      size: file.size,
      width,
      height,
      alt: alt.success ? alt.data : "",
    });
  } catch (err) {
    await env.MEDIA.delete(key); // don't orphan the object
    throw err;
  }
  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, id));
  return json({ asset }, 201);
}
