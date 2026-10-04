import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { manifestIcons } from "@/lib/favicon";
import { getDb, schema } from "@/server/db.server";

/**
 * Web app manifest generated from Site config, so the name and icons follow what you set in the
 * dashboard (the old static file always said "Folio" and used the built-in icons).
 */
export const Route = createFileRoute("/manifest.webmanifest")({
  server: {
    handlers: {
      GET: async () => {
        const cfg = await getDb()
          .select({
            name: schema.siteConfig.name,
            tagline: schema.siteConfig.tagline,
            metaDescription: schema.siteConfig.metaDescription,
            faviconUrl: schema.siteConfig.faviconUrl,
          })
          .from(schema.siteConfig)
          .where(eq(schema.siteConfig.id, 1))
          .get()
          .catch(() => undefined);
        const name = cfg?.name?.trim() || "Portfolio";
        const body = {
          name,
          short_name: name.split(/\s+/)[0]!.slice(0, 12),
          description: cfg?.metaDescription || cfg?.tagline || "A personal portfolio.",
          start_url: "/",
          display: "browser",
          background_color: "#faf8f4",
          theme_color: "#9a4526",
          icons: manifestIcons(cfg?.faviconUrl),
        };
        return new Response(JSON.stringify(body), {
          headers: {
            "content-type": "application/manifest+json; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
