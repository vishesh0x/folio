import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db.server";
import { getEnv } from "@/server/env.server";
import { siteOrigin } from "@/server/site.server";

export type {
  ContactMessage,
  NowCategory,
  NowItem,
  PageSeo,
  Project,
  ResumeEntry,
  ResumeProfile,
  ResumeSection,
  SiteConfig,
  Social,
} from "@/db/schema";
import type { PageSeo, Project } from "@/db/schema";

export type ProjectListItem = Pick<
  Project,
  | "id"
  | "slug"
  | "title"
  | "summary"
  | "coverUrl"
  | "coverAlt"
  | "tags"
  | "tech"
  | "featured"
  | "status"
  | "startDate"
  | "updatedAt"
>;

export const getSiteData = createServerFn({ method: "GET" }).handler(async () => {
  const db = getDb();
  const [config, seo] = await Promise.all([
    db.select().from(schema.siteConfig).where(eq(schema.siteConfig.id, 1)).get(),
    db.select().from(schema.pageSeo),
  ]);
  const seoMap: Record<string, PageSeo> = {};
  for (const s of seo) seoMap[s.page] = s;
  return {
    config: config ?? null,
    seo: seoMap,
    origin: siteOrigin(getRequest()),
    turnstileSiteKey: getEnv().TURNSTILE_SITE_KEY || null,
  };
});

export const getProjects = createServerFn({ method: "GET" }).handler(async () => {
  // List views deliberately exclude the (large) markdown `content`.
  return getDb()
    .select({
      id: schema.projects.id,
      slug: schema.projects.slug,
      title: schema.projects.title,
      summary: schema.projects.summary,
      coverUrl: schema.projects.coverUrl,
      coverAlt: schema.projects.coverAlt,
      tags: schema.projects.tags,
      tech: schema.projects.tech,
      featured: schema.projects.featured,
      status: schema.projects.status,
      startDate: schema.projects.startDate,
      updatedAt: schema.projects.updatedAt,
    })
    .from(schema.projects)
    .where(eq(schema.projects.published, true))
    .orderBy(asc(schema.projects.sortOrder), desc(schema.projects.createdAt));
});

export const getProject = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ slug: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const row = await getDb()
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.slug, data.slug), eq(schema.projects.published, true)))
      .get();
    return row ?? null;
  });

export const getNow = createServerFn({ method: "GET" }).handler(async () => {
  const db = getDb();
  const [categories, items] = await Promise.all([
    db.select().from(schema.nowCategories).orderBy(asc(schema.nowCategories.sortOrder)),
    db.select().from(schema.nowItems).orderBy(asc(schema.nowItems.sortOrder)),
  ]);
  return { categories, items };
});

export const getResume = createServerFn({ method: "GET" }).handler(async () => {
  const db = getDb();
  const [profile, sections, entries] = await Promise.all([
    db.select().from(schema.resumeProfile).where(eq(schema.resumeProfile.id, 1)).get(),
    db
      .select()
      .from(schema.resumeSections)
      .where(eq(schema.resumeSections.visible, true))
      .orderBy(asc(schema.resumeSections.sortOrder)),
    db.select().from(schema.resumeEntries).orderBy(asc(schema.resumeEntries.sortOrder)),
  ]);
  return { profile: profile ?? null, sections, entries };
});
