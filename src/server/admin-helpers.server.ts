import { count, eq, sql } from "drizzle-orm";
import { schema, type Db } from "./db.server";

/** Persist a new ordering for any table with a `sortOrder` column. */
export async function applyOrder(
  db: Db,
  table:
    | typeof schema.projects
    | typeof schema.nowCategories
    | typeof schema.resumeSections
    | typeof schema.resumeEntries,
  ids: string[],
) {
  const stmts = ids.map((id, i) => db.update(table).set({ sortOrder: i }).where(eq(table.id, id)));
  await db.batch(stmts as unknown as [(typeof stmts)[0], ...(typeof stmts)[0][]]);
}

/** Where is this asset referenced? (`instr` avoids LIKE's `_`/`%` wildcards.) */
export async function findUsages(db: Db, key: string): Promise<string[]> {
  const needle = `/media/${key}`;
  const has = (col: unknown) => sql`instr(${col}, ${needle}) > 0`;
  const [site, seo, projects, now, resume] = await Promise.all([
    db
      .select({ n: count() })
      .from(schema.siteConfig)
      .where(
        sql`${has(schema.siteConfig.avatarUrl)} or ${has(schema.siteConfig.faviconUrl)} or ${has(schema.siteConfig.resumeUrl)} or ${has(schema.siteConfig.ogImage)} or ${has(schema.siteConfig.bio)}`,
      ),
    db.select({ n: count() }).from(schema.pageSeo).where(has(schema.pageSeo.ogImage)),
    db
      .select({ title: schema.projects.title })
      .from(schema.projects)
      .where(
        sql`${has(schema.projects.coverUrl)} or ${has(schema.projects.seoImage)} or ${has(schema.projects.content)}`,
      ),
    db
      .select({ title: schema.nowItems.title })
      .from(schema.nowItems)
      .where(has(schema.nowItems.imageUrl)),
    db
      .select({ n: count() })
      .from(schema.resumeEntries)
      .where(sql`${has(schema.resumeEntries.link)} or ${has(schema.resumeEntries.description)}`),
  ]);
  const out: string[] = [];
  if (site[0]?.n) out.push("Site config");
  if (seo[0]?.n) out.push("Page SEO");
  for (const p of projects) out.push(`Project: ${p.title}`);
  for (const i of now) out.push(`Now: ${i.title}`);
  if (resume[0]?.n) out.push("Resume");
  return out;
}
