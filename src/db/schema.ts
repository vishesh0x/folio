import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Folio schema (Cloudflare D1 / SQLite).
 *
 * Conventions
 *  - ids are random UUIDs generated in the Worker (`crypto.randomUUID()`).
 *  - timestamps are ISO-8601 strings (UTC).
 *  - arrays / objects are JSON text columns (typed with `$type`).
 *  - image columns hold either `/media/<r2-key>` (an uploaded asset) or an
 *    absolute https URL. Every image column has a sibling `*_alt` column.
 */

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
const createdAt = () => text("created_at").notNull().default(now);
const updatedAt = () => text("updated_at").notNull().default(now);

export type Social = { label: string; url: string };

// ── auth ─────────────────────────────────────────────────────────────────────
export const adminUsers = sqliteTable("admin_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  /** `pbkdf2$<iterations>$<salt b64>$<hash b64>` */
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 (hex) of the session token. The raw token only lives in the cookie. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_expires_idx").on(t.expiresAt)],
);

/** Fixed-window counters used for login + contact-form throttling. */
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull().default(0),
});

// ── site ─────────────────────────────────────────────────────────────────────
export const siteConfig = sqliteTable(
  "site_config",
  {
    id: integer("id").primaryKey().default(1),
    name: text("name").notNull().default("Your Name"),
    role: text("role").notNull().default("Developer"),
    tagline: text("tagline").notNull().default(""),
    bio: text("bio").notNull().default(""),
    email: text("email").notNull().default(""),
    location: text("location").notNull().default(""),
    avatarUrl: text("avatar_url"),
    avatarAlt: text("avatar_alt").notNull().default(""),
    faviconUrl: text("favicon_url"),
    resumeUrl: text("resume_url"),
    ogImage: text("og_image"),
    metaTitle: text("meta_title").notNull().default(""),
    metaDescription: text("meta_description").notNull().default(""),
    socials: text("socials", { mode: "json" })
      .$type<Social[]>()
      .notNull()
      .default(sql`'[]'`),
    available: integer("available", { mode: "boolean" }).notNull().default(true),
    updatedAt: updatedAt(),
  },
  (t) => [check("site_config_singleton", sql`${t.id} = 1`)],
);

export const pageSeo = sqliteTable("page_seo", {
  page: text("page").primaryKey(),
  title: text("title").notNull().default(""),
  description: text("description").notNull().default(""),
  ogImage: text("og_image"),
  updatedAt: updatedAt(),
});

// ── projects ─────────────────────────────────────────────────────────────────
export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    content: text("content").notNull().default(""),
    coverUrl: text("cover_url"),
    coverAlt: text("cover_alt").notNull().default(""),
    tags: text("tags", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    tech: text("tech", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    repoUrl: text("repo_url"),
    liveUrl: text("live_url"),
    status: text("status").notNull().default("completed"),
    featured: integer("featured", { mode: "boolean" }).notNull().default(false),
    published: integer("published", { mode: "boolean" }).notNull().default(true),
    startDate: text("start_date"),
    endDate: text("end_date"),
    sortOrder: integer("sort_order").notNull().default(0),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    seoImage: text("seo_image"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("projects_published_sort_idx").on(t.published, t.sortOrder)],
);

// ── now ──────────────────────────────────────────────────────────────────────
export const nowCategories = sqliteTable("now_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  emoji: text("emoji").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
});

export const nowItems = sqliteTable(
  "now_items",
  {
    id: text("id").primaryKey(),
    categoryId: text("category_id")
      .notNull()
      .references(() => nowCategories.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("doing"),
    link: text("link"),
    imageUrl: text("image_url"),
    imageAlt: text("image_alt").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("now_items_category_idx").on(t.categoryId, t.sortOrder)],
);

// ── resume ───────────────────────────────────────────────────────────────────
export const resumeProfile = sqliteTable(
  "resume_profile",
  {
    id: integer("id").primaryKey().default(1),
    fullName: text("full_name").notNull().default(""),
    headline: text("headline").notNull().default(""),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    location: text("location").notNull().default(""),
    website: text("website").notNull().default(""),
    summary: text("summary").notNull().default(""),
    links: text("links", { mode: "json" })
      .$type<Social[]>()
      .notNull()
      .default(sql`'[]'`),
    updatedAt: updatedAt(),
  },
  (t) => [check("resume_profile_singleton", sql`${t.id} = 1`)],
);

export const resumeSections = sqliteTable("resume_sections", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("custom"),
  sortOrder: integer("sort_order").notNull().default(0),
  visible: integer("visible", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
});

export const resumeEntries = sqliteTable(
  "resume_entries",
  {
    id: text("id").primaryKey(),
    sectionId: text("section_id")
      .notNull()
      .references(() => resumeSections.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    subtitle: text("subtitle").notNull().default(""),
    organization: text("organization").notNull().default(""),
    location: text("location").notNull().default(""),
    startDate: text("start_date").notNull().default(""),
    endDate: text("end_date").notNull().default(""),
    description: text("description").notNull().default(""),
    link: text("link"),
    tags: text("tags", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("resume_entries_section_idx").on(t.sectionId, t.sortOrder)],
);

// ── inbox ────────────────────────────────────────────────────────────────────
export const contactMessages = sqliteTable(
  "contact_messages",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    subject: text("subject").notNull().default(""),
    message: text("message").notNull(),
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("contact_messages_created_idx").on(t.createdAt),
    check("contact_name_len", sql`length(${t.name}) between 1 and 120`),
    check("contact_email_len", sql`length(${t.email}) between 3 and 255`),
    check("contact_subject_len", sql`length(${t.subject}) <= 200`),
    check("contact_message_len", sql`length(${t.message}) between 1 and 5000`),
  ],
);

// ── assets (metadata for objects stored in R2) ───────────────────────────────
export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  /** R2 object key. Public URL is `/media/<key>`. */
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  mime: text("mime").notNull().default(""),
  size: integer("size").notNull().default(0),
  width: integer("width"),
  height: integer("height"),
  /** Default alt text; copied into content when the asset is chosen. */
  alt: text("alt").notNull().default(""),
  createdAt: createdAt(),
});

export type SiteConfig = typeof siteConfig.$inferSelect;
export type PageSeo = typeof pageSeo.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type NowCategory = typeof nowCategories.$inferSelect;
export type NowItem = typeof nowItems.$inferSelect;
export type ResumeProfile = typeof resumeProfile.$inferSelect;
export type ResumeSection = typeof resumeSections.$inferSelect;
export type ResumeEntry = typeof resumeEntries.$inferSelect;
export type ContactMessage = typeof contactMessages.$inferSelect;
export type Asset = typeof assets.$inferSelect;
