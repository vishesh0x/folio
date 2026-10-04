import { queryOptions } from "@tanstack/react-query";
import { mediaUrl } from "./images";
import { getNow, getProject, getProjects, getResume, getSiteData } from "./public.functions";
import type { PageSeo } from "./public.functions";
import { absoluteUrl, mediaKeyFromUrl } from "./url";

export const siteQuery = queryOptions({ queryKey: ["site"], queryFn: () => getSiteData() });
export const projectsQuery = queryOptions({ queryKey: ["projects"], queryFn: () => getProjects() });
export const projectQuery = (slug: string) =>
  queryOptions({ queryKey: ["project", slug], queryFn: () => getProject({ data: { slug } }) });
export const nowQuery = queryOptions({ queryKey: ["now"], queryFn: () => getNow() });
export const resumeQuery = queryOptions({ queryKey: ["resume"], queryFn: () => getResume() });

type SeoInput = { title?: string | null; description?: string | null; image?: string | null };

/** Social crawlers need an absolute URL, and prefer JPEG/PNG (our /media negotiates by Accept). */
export function shareImage(url: string | null | undefined, origin: string): string | undefined {
  const key = mediaKeyFromUrl(url);
  return absoluteUrl(key ? mediaUrl(key, { w: 1280 }) : url, origin);
}

/** JSON-LD must not be able to close its own <script> tag. */
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

export function seoMeta(opts: {
  seo?: SeoInput;
  fallback: { title: string; description: string };
  origin: string;
  path: string;
  siteName?: string;
  /** Used when the page has no image of its own. */
  defaultImage?: string | null;
  imageAlt?: string;
  type?: "website" | "article";
  noindex?: boolean;
}) {
  const { seo, fallback, origin, path, type = "website" } = opts;
  const title = seo?.title || fallback.title;
  const description = seo?.description || fallback.description;
  const url = origin + path;
  const image =
    shareImage(seo?.image, origin) ??
    shareImage(opts.defaultImage, origin) ??
    `${origin}/og-default.png`;

  const meta: Record<string, string>[] = [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: type },
    { property: "og:url", content: url },
    { property: "og:image", content: image },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
  ];
  if (opts.siteName) meta.push({ property: "og:site_name", content: opts.siteName });
  if (opts.imageAlt) {
    meta.push(
      { property: "og:image:alt", content: opts.imageAlt },
      { name: "twitter:image:alt", content: opts.imageAlt },
    );
  }
  if (opts.noindex) meta.push({ name: "robots", content: "noindex, nofollow" });
  return { meta, links: [{ rel: "canonical", href: url }] };
}

export const pageSeo = (s?: PageSeo): SeoInput | undefined =>
  s ? { title: s.title, description: s.description, image: s.ogImage } : undefined;
