import { createFileRoute } from "@tanstack/react-router";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db.server";
import { siteOrigin } from "@/server/site.server";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = siteOrigin(request);
        const projects = await getDb()
          .select({ slug: schema.projects.slug, updatedAt: schema.projects.updatedAt })
          .from(schema.projects)
          .where(eq(schema.projects.published, true))
          .orderBy(asc(schema.projects.sortOrder));
        const pages = ["", "/projects", "/now", "/resume", "/contact"].map((p) => ({
          loc: p,
          lastmod: undefined as string | undefined,
        }));
        const urls = [
          ...pages,
          ...projects.map((p) => ({
            loc: `/projects/${encodeURIComponent(p.slug)}`,
            lastmod: p.updatedAt,
          })),
        ];
        const xml =
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          urls
            .map(
              (u) =>
                `  <url><loc>${esc(origin + u.loc)}</loc>${u.lastmod ? `<lastmod>${esc(u.lastmod)}</lastmod>` : ""}</url>`,
            )
            .join("\n") +
          `\n</urlset>\n`;
        return new Response(xml, {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
