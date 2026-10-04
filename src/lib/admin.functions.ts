import { createServerFn } from "@tanstack/react-start";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  assetDeleteSchema,
  assetPatchSchema,
  categorySchema,
  entrySchema,
  idSchema,
  messagePatchSchema,
  nowItemSchema,
  pageSeoSchema,
  projectSchema,
  reorderSchema,
  resumeProfileSchema,
  sectionSchema,
  siteConfigSchema,
} from "./validators";
import { requireAdmin } from "./admin-middleware";
import { getDb, schema } from "@/server/db.server";
import { applyOrder, findUsages } from "@/server/admin-helpers.server";
import { getEnv } from "@/server/env.server";

/**
 * Every function here sits behind `requireAdmin` (cookie session) and the
 * global CSRF middleware, and validates its input with zod. Nothing in the
 * browser talks to the database directly.
 */

const ts = () => new Date().toISOString();
const withId = <T extends z.ZodRawShape>(shape: z.ZodObject<T>) =>
  z.object({ id: z.string().uuid().nullish(), data: shape });

function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e, i = 0; cur && i < 5; i++) {
    if (cur instanceof Error && /UNIQUE constraint failed/i.test(cur.message)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

// ── overview ─────────────────────────────────────────────────────────────────
export const adminOverview = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const db = getDb();
    const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
    const [projects, published, nowDoing, assets, unread, entries, recent, cfg] = await Promise.all(
      [
        n(db.select({ n: count() }).from(schema.projects)),
        n(
          db
            .select({ n: count() })
            .from(schema.projects)
            .where(eq(schema.projects.published, true)),
        ),
        n(
          db
            .select({ n: count() })
            .from(schema.nowItems)
            .where(eq(schema.nowItems.status, "doing")),
        ),
        n(db.select({ n: count() }).from(schema.assets)),
        n(
          db
            .select({ n: count() })
            .from(schema.contactMessages)
            .where(
              and(
                eq(schema.contactMessages.read, false),
                eq(schema.contactMessages.archived, false),
              ),
            ),
        ),
        n(db.select({ n: count() }).from(schema.resumeEntries)),
        db
          .select()
          .from(schema.contactMessages)
          .where(eq(schema.contactMessages.archived, false))
          .orderBy(desc(schema.contactMessages.createdAt))
          .limit(5),
        db.select({ name: schema.siteConfig.name }).from(schema.siteConfig).get(),
        // Missing-alt audit for the dashboard.
      ],
    );
    const missingAlt = await n(
      db
        .select({ n: count() })
        .from(schema.assets)
        .where(and(eq(schema.assets.alt, ""), sql`${schema.assets.mime} like 'image/%'`)),
    );
    return {
      projects,
      published,
      nowDoing,
      assets,
      unread,
      entries,
      recent,
      name: cfg?.name ?? "",
      missingAlt,
      setupWarnings: {
        noSiteUrl: !getEnv().SITE_URL,
        noTurnstile: !getEnv().TURNSTILE_SECRET_KEY,
      },
    };
  });

// ── site config + seo ────────────────────────────────────────────────────────
export const adminGetSite = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(
    async () =>
      (await getDb().select().from(schema.siteConfig).where(eq(schema.siteConfig.id, 1)).get()) ??
      null,
  );

export const adminSaveSite = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => siteConfigSchema.parse(d))
  .handler(async ({ data }) => {
    await getDb()
      .insert(schema.siteConfig)
      .values({ id: 1, ...data })
      .onConflictDoUpdate({ target: schema.siteConfig.id, set: { ...data, updatedAt: ts() } });
    return { ok: true as const };
  });

export const adminGetSeo = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => getDb().select().from(schema.pageSeo));

export const adminSaveSeo = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => pageSeoSchema.parse(d))
  .handler(async ({ data }) => {
    await getDb()
      .insert(schema.pageSeo)
      .values(data)
      .onConflictDoUpdate({ target: schema.pageSeo.page, set: { ...data, updatedAt: ts() } });
    return { ok: true as const };
  });

// ── projects ─────────────────────────────────────────────────────────────────
export const adminListProjects = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () =>
    getDb()
      .select({
        id: schema.projects.id,
        slug: schema.projects.slug,
        title: schema.projects.title,
        coverUrl: schema.projects.coverUrl,
        coverAlt: schema.projects.coverAlt,
        tags: schema.projects.tags,
        featured: schema.projects.featured,
        published: schema.projects.published,
      })
      .from(schema.projects)
      .orderBy(asc(schema.projects.sortOrder), desc(schema.projects.createdAt)),
  );

export const adminGetProject = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(
    async ({ data }) =>
      (await getDb().select().from(schema.projects).where(eq(schema.projects.id, data.id)).get()) ??
      null,
  );

export const adminSaveProject = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => withId(projectSchema).parse(d))
  .handler(async ({ data: { id, data } }) => {
    const db = getDb();
    try {
      if (id) {
        await db
          .update(schema.projects)
          .set({ ...data, updatedAt: ts() })
          .where(eq(schema.projects.id, id));
        return { id };
      }
      const [{ n }] = await db.select({ n: count() }).from(schema.projects);
      const newId = crypto.randomUUID();
      await db.insert(schema.projects).values({ id: newId, ...data, sortOrder: n });
      return { id: newId };
    } catch (e) {
      if (isUniqueViolation(e)) throw new Error("That slug is already used");
      throw e;
    }
  });

export const adminPatchProject = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        featured: z.boolean().optional(),
        published: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data: { id, ...patch } }) => {
    await getDb()
      .update(schema.projects)
      .set({ ...patch, updatedAt: ts() })
      .where(eq(schema.projects.id, id));
    return { ok: true as const };
  });

export const adminDeleteProject = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    await getDb().delete(schema.projects).where(eq(schema.projects.id, data.id));
    return { ok: true as const };
  });

export const adminReorderProjects = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => reorderSchema.parse(d))
  .handler(async ({ data }) => {
    await applyOrder(getDb(), schema.projects, data.ids);
    return { ok: true as const };
  });

// ── now board ────────────────────────────────────────────────────────────────
export const adminGetNow = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const db = getDb();
    const [categories, items] = await Promise.all([
      db.select().from(schema.nowCategories).orderBy(asc(schema.nowCategories.sortOrder)),
      db.select().from(schema.nowItems).orderBy(asc(schema.nowItems.sortOrder)),
    ]);
    return { categories, items };
  });

export const adminSaveCategory = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => withId(categorySchema).parse(d))
  .handler(async ({ data: { id, data } }) => {
    const db = getDb();
    if (id) {
      await db.update(schema.nowCategories).set(data).where(eq(schema.nowCategories.id, id));
      return { id };
    }
    const [{ n }] = await db.select({ n: count() }).from(schema.nowCategories);
    const newId = crypto.randomUUID();
    await db.insert(schema.nowCategories).values({ id: newId, ...data, sortOrder: n });
    return { id: newId };
  });

export const adminDeleteCategory = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    await getDb().delete(schema.nowCategories).where(eq(schema.nowCategories.id, data.id));
    return { ok: true as const };
  });

export const adminReorderCategories = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => reorderSchema.parse(d))
  .handler(async ({ data }) => {
    await applyOrder(getDb(), schema.nowCategories, data.ids);
    return { ok: true as const };
  });

export const adminSaveNowItem = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => withId(nowItemSchema).parse(d))
  .handler(async ({ data: { id, data } }) => {
    const db = getDb();
    if (id) {
      await db
        .update(schema.nowItems)
        .set({ ...data, updatedAt: ts() })
        .where(eq(schema.nowItems.id, id));
      return { id };
    }
    const [{ n }] = await db
      .select({ n: count() })
      .from(schema.nowItems)
      .where(eq(schema.nowItems.categoryId, data.categoryId));
    const newId = crypto.randomUUID();
    await db.insert(schema.nowItems).values({ id: newId, ...data, sortOrder: n });
    return { id: newId };
  });

export const adminSetNowItemStatus = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["doing", "done"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    await getDb()
      .update(schema.nowItems)
      .set({ status: data.status, updatedAt: ts() })
      .where(eq(schema.nowItems.id, data.id));
    return { ok: true as const };
  });

export const adminDeleteNowItem = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    await getDb().delete(schema.nowItems).where(eq(schema.nowItems.id, data.id));
    return { ok: true as const };
  });

// ── resume ───────────────────────────────────────────────────────────────────
export const adminGetResume = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const db = getDb();
    const [profile, sections, entries] = await Promise.all([
      db.select().from(schema.resumeProfile).where(eq(schema.resumeProfile.id, 1)).get(),
      db.select().from(schema.resumeSections).orderBy(asc(schema.resumeSections.sortOrder)),
      db.select().from(schema.resumeEntries).orderBy(asc(schema.resumeEntries.sortOrder)),
    ]);
    return { profile: profile ?? null, sections, entries };
  });

export const adminSaveResumeProfile = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => resumeProfileSchema.parse(d))
  .handler(async ({ data }) => {
    await getDb()
      .insert(schema.resumeProfile)
      .values({ id: 1, ...data })
      .onConflictDoUpdate({ target: schema.resumeProfile.id, set: { ...data, updatedAt: ts() } });
    return { ok: true as const };
  });

export const adminSaveSection = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => withId(sectionSchema).parse(d))
  .handler(async ({ data: { id, data } }) => {
    const db = getDb();
    if (id) {
      await db.update(schema.resumeSections).set(data).where(eq(schema.resumeSections.id, id));
      return { id };
    }
    const [{ n }] = await db.select({ n: count() }).from(schema.resumeSections);
    const newId = crypto.randomUUID();
    await db.insert(schema.resumeSections).values({ id: newId, ...data, sortOrder: n });
    return { id: newId };
  });

export const adminSetSectionVisible = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), visible: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    await getDb()
      .update(schema.resumeSections)
      .set({ visible: data.visible })
      .where(eq(schema.resumeSections.id, data.id));
    return { ok: true as const };
  });

export const adminDeleteSection = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    await getDb().delete(schema.resumeSections).where(eq(schema.resumeSections.id, data.id));
    return { ok: true as const };
  });

export const adminReorderSections = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => reorderSchema.parse(d))
  .handler(async ({ data }) => {
    await applyOrder(getDb(), schema.resumeSections, data.ids);
    return { ok: true as const };
  });

export const adminSaveEntry = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => withId(entrySchema).parse(d))
  .handler(async ({ data: { id, data } }) => {
    const db = getDb();
    if (id) {
      await db.update(schema.resumeEntries).set(data).where(eq(schema.resumeEntries.id, id));
      return { id };
    }
    const [{ n }] = await db
      .select({ n: count() })
      .from(schema.resumeEntries)
      .where(eq(schema.resumeEntries.sectionId, data.sectionId));
    const newId = crypto.randomUUID();
    await db.insert(schema.resumeEntries).values({ id: newId, ...data, sortOrder: n });
    return { id: newId };
  });

export const adminDeleteEntry = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    await getDb().delete(schema.resumeEntries).where(eq(schema.resumeEntries.id, data.id));
    return { ok: true as const };
  });

export const adminReorderEntries = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => reorderSchema.parse(d))
  .handler(async ({ data }) => {
    await applyOrder(getDb(), schema.resumeEntries, data.ids);
    return { ok: true as const };
  });

// ── inbox ────────────────────────────────────────────────────────────────────
export const adminListMessages = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () =>
    getDb()
      .select()
      .from(schema.contactMessages)
      .orderBy(desc(schema.contactMessages.createdAt))
      .limit(500),
  );

export const adminPatchMessage = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => messagePatchSchema.parse(d))
  .handler(async ({ data: { id, ...patch } }) => {
    if (Object.keys(patch).length) {
      await getDb()
        .update(schema.contactMessages)
        .set(patch)
        .where(eq(schema.contactMessages.id, id));
    }
    return { ok: true as const };
  });

export const adminDeleteMessage = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    await getDb().delete(schema.contactMessages).where(eq(schema.contactMessages.id, data.id));
    return { ok: true as const };
  });

// ── assets ───────────────────────────────────────────────────────────────────
export const adminListAssets = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => getDb().select().from(schema.assets).orderBy(desc(schema.assets.createdAt)));

export const adminPatchAsset = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => assetPatchSchema.parse(d))
  .handler(async ({ data }) => {
    await getDb().update(schema.assets).set({ alt: data.alt }).where(eq(schema.assets.id, data.id));
    return { ok: true as const };
  });

export const adminDeleteAsset = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => assetDeleteSchema.parse(d))
  .handler(async ({ data }) => {
    const db = getDb();
    const asset = await db.select().from(schema.assets).where(eq(schema.assets.id, data.id)).get();
    if (!asset) return { deleted: true as const, usedIn: [] as string[] };
    const usedIn = await findUsages(db, asset.key);
    if (usedIn.length && !data.force) return { deleted: false as const, usedIn };
    await getEnv().MEDIA.delete(asset.key);
    await db.delete(schema.assets).where(eq(schema.assets.id, asset.id));
    return { deleted: true as const, usedIn };
  });
