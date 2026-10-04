import { z } from "zod";
import { safeHref, safeImageSrc } from "./url";

/** Empty string → null, otherwise trimmed. */
const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

/** http(s) / mailto / same-site URL; rejects javascript:, data:, etc. */
export const urlField = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => safeHref(v) !== undefined, "Enter a valid http(s) URL");

export const optionalUrl = z.preprocess(emptyToNull, urlField.nullable()).default(null);

/** Image reference: uploaded asset (`/media/...`) or an https URL. */
export const optionalImage = z
  .preprocess(
    emptyToNull,
    z
      .string()
      .trim()
      .max(2048)
      .refine((v) => safeImageSrc(v) !== undefined, "Images must be uploaded or use https")
      .nullable(),
  )
  .default(null);

export const altText = z.string().trim().max(300).default("");

const text = (max: number) => z.string().trim().max(max);
const stringList = z.array(z.string().trim().min(1).max(60)).max(40).default([]);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Slug is required")
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens");

const socialSchema = z.object({
  label: text(60).min(1, "Label required"),
  url: urlField,
});

const isoDate = z.preprocess(
  emptyToNull,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .nullable(),
);

// ── public ───────────────────────────────────────────────────────────────────
export const contactSchema = z.object({
  name: text(120).min(1, "Please tell me your name"),
  email: text(255).email("That email doesn't look right"),
  subject: text(200).default(""),
  message: text(5000).min(5, "A little more detail please"),
  /** Honeypot — real users never see or fill this. */
  website: z.string().max(200).optional().default(""),
  turnstileToken: z.string().max(4096).optional().default(""),
});
export type ContactInput = z.infer<typeof contactSchema>;

// ── auth ─────────────────────────────────────────────────────────────────────
export const MIN_PASSWORD = 12;
export const loginSchema = z.object({
  email: text(255).email(),
  password: z.string().min(1).max(256),
});
export const setupSchema = z.object({
  email: text(255).email("Enter a valid email"),
  password: z.string().min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters`).max(256),
  setupToken: z.string().min(1, "Setup token is required").max(512),
});

// ── admin: site ──────────────────────────────────────────────────────────────
export const siteConfigSchema = z.object({
  name: text(120).min(1),
  role: text(120),
  tagline: text(300),
  bio: text(4000),
  email: z.union([z.literal(""), text(255).email()]),
  location: text(120),
  avatarUrl: optionalImage,
  avatarAlt: altText,
  faviconUrl: optionalImage,
  resumeUrl: optionalUrl,
  ogImage: optionalImage,
  metaTitle: text(120),
  metaDescription: text(320),
  socials: z.array(socialSchema).max(20),
  available: z.boolean(),
});

export const pageSeoSchema = z.object({
  page: z.enum(["home", "projects", "now", "resume", "contact"]),
  title: text(120),
  description: text(320),
  ogImage: optionalImage,
});

// ── admin: projects ──────────────────────────────────────────────────────────
export const projectSchema = z.object({
  title: text(160).min(1, "Title is required"),
  slug: slugSchema,
  summary: text(400).default(""),
  content: z.string().max(100_000).default(""),
  coverUrl: optionalImage,
  coverAlt: altText,
  tags: stringList,
  tech: stringList,
  repoUrl: optionalUrl,
  liveUrl: optionalUrl,
  status: z.enum(["in-progress", "completed", "archived"]).default("completed"),
  featured: z.boolean().default(false),
  published: z.boolean().default(true),
  startDate: isoDate.default(null),
  endDate: isoDate.default(null),
  seoTitle: z.preprocess(emptyToNull, text(120).nullable()).default(null),
  seoDescription: z.preprocess(emptyToNull, text(320).nullable()).default(null),
  seoImage: optionalImage,
});
export type ProjectInput = z.infer<typeof projectSchema>;

// ── admin: now ───────────────────────────────────────────────────────────────
export const categorySchema = z.object({
  name: text(80).min(1, "Name is required"),
  emoji: text(16).default(""),
});
export const nowItemSchema = z.object({
  categoryId: z.string().uuid(),
  title: text(160).min(1, "Title is required"),
  description: text(1000).default(""),
  status: z.enum(["doing", "done"]).default("doing"),
  link: optionalUrl,
  imageUrl: optionalImage,
  imageAlt: altText,
});

// ── admin: resume ────────────────────────────────────────────────────────────
export const resumeProfileSchema = z.object({
  fullName: text(120),
  headline: text(160),
  email: z.union([z.literal(""), text(255).email()]),
  phone: text(60),
  location: text(120),
  website: z.union([z.literal(""), urlField]),
  summary: text(4000),
  links: z.array(socialSchema).max(20),
});
export const RESUME_KINDS = [
  "experience",
  "education",
  "projects",
  "skills",
  "certifications",
  "awards",
  "languages",
  "volunteering",
  "publications",
  "custom",
] as const;
export const sectionSchema = z.object({
  title: text(80).min(1, "Section title is required"),
  kind: z.enum(RESUME_KINDS).default("custom"),
});
export const entrySchema = z.object({
  sectionId: z.string().uuid(),
  title: text(160).default(""),
  subtitle: text(160).default(""),
  organization: text(160).default(""),
  location: text(120).default(""),
  startDate: text(40).default(""),
  endDate: text(40).default(""),
  description: text(4000).default(""),
  link: optionalUrl,
  tags: stringList,
});

// ── admin: misc ──────────────────────────────────────────────────────────────
export const idSchema = z.object({ id: z.string().uuid() });
export const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });
export const messagePatchSchema = z.object({
  id: z.string().uuid(),
  read: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export const assetPatchSchema = z.object({ id: z.string().uuid(), alt: altText });
export const assetDeleteSchema = z.object({
  id: z.string().uuid(),
  force: z.boolean().default(false),
});
