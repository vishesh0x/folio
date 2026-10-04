import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Check, ExternalLink } from "lucide-react";
import { Img } from "@/components/Img";
import { SafeLink } from "@/components/SafeLink";
import { formatDate } from "@/lib/dates";
import { nowQuery, pageSeo, seoMeta, siteQuery } from "@/lib/queries";

export const Route = createFileRoute("/_site/now")({
  loader: async ({ context }) => {
    const [site] = await Promise.all([
      context.queryClient.ensureQueryData(siteQuery),
      context.queryClient.ensureQueryData(nowQuery),
    ]);
    return { seo: site.seo.now, origin: site.origin, name: site.config?.name };
  },
  head: ({ loaderData }) =>
    seoMeta({
      seo: pageSeo(loaderData?.seo),
      fallback: { title: "Now", description: "What I'm focused on at the moment." },
      origin: loaderData?.origin ?? "",
      path: "/now",
      siteName: loaderData?.name,
    }),
  component: NowPage,
});

function NowPage() {
  const { data } = useSuspenseQuery(nowQuery);
  const last = data.items.reduce<string | null>(
    (m, i) => (!m || i.updatedAt > m ? i.updatedAt : m),
    null,
  );
  const lastLabel = formatDate(last, "MMMM d, yyyy");

  return (
    <div className="mx-auto max-w-5xl px-5 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">/now</p>
      <h1 className="mt-3 font-display text-5xl font-light md:text-7xl">
        What I'm <em className="text-primary">up to</em>
      </h1>
      <p className="mt-4 max-w-xl text-muted-foreground">
        A snapshot of what's on my desk, my nightstand and my sketchbook.
        {lastLabel && (
          <>
            {" "}
            Last updated <time dateTime={last ?? undefined}>{lastLabel}</time>.
          </>
        )}
      </p>

      <div className="mt-14 space-y-14">
        {data.categories.map((c) => {
          const items = data.items.filter((i) => i.categoryId === c.id);
          const doing = items.filter((i) => i.status !== "done");
          const done = items.filter((i) => i.status === "done");
          return (
            <section
              key={c.id}
              className="grid gap-6 md:grid-cols-[200px_1fr]"
              aria-labelledby={`cat-${c.id}`}
            >
              <h2 id={`cat-${c.id}`} className="font-display text-2xl">
                <span aria-hidden className="mr-2">
                  {c.emoji}
                </span>
                {c.name}
              </h2>
              <ul className="space-y-3">
                {items.length === 0 && (
                  <li className="text-sm text-muted-foreground">Nothing here yet.</li>
                )}
                {[...doing, ...done].map((i) => (
                  <li
                    key={i.id}
                    className={`flex gap-4 rounded-xl border border-border bg-card p-4 ${i.status === "done" ? "opacity-80" : ""}`}
                  >
                    {i.imageUrl && (
                      <Img
                        src={i.imageUrl}
                        alt={i.imageAlt || i.title}
                        width={64}
                        height={80}
                        maxWidth={160}
                        sizes="64px"
                        className="h-20 w-16 shrink-0 rounded-md object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium">{i.title}</h3>
                        {i.status === "done" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                            <Check aria-hidden className="h-3 w-3" /> Done
                          </span>
                        ) : (
                          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                            In progress
                          </span>
                        )}
                      </div>
                      {i.description && (
                        <p className="mt-1 text-sm text-muted-foreground">{i.description}</p>
                      )}
                      {i.link && (
                        <SafeLink
                          href={i.link}
                          className="mt-2 inline-flex items-center gap-1 py-1 text-xs text-primary hover:underline"
                        >
                          Link <ExternalLink aria-hidden className="h-3 w-3" />
                        </SafeLink>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
