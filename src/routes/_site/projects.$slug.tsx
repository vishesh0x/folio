import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Github } from "lucide-react";
import { Img } from "@/components/Img";
import { Markdown } from "@/components/Markdown";
import { SafeLink } from "@/components/SafeLink";
import { formatDate } from "@/lib/dates";
import { jsonLd, projectQuery, seoMeta, siteQuery } from "@/lib/queries";

export const Route = createFileRoute("/_site/projects/$slug")({
  loader: async ({ context, params }) => {
    const [p, site] = await Promise.all([
      context.queryClient.ensureQueryData(projectQuery(params.slug)),
      context.queryClient.ensureQueryData(siteQuery),
    ]);
    if (!p) throw notFound();
    return { p, origin: site.origin, name: site.config?.name, author: site.config?.name };
  },
  head: ({ loaderData, params }) => {
    const p = loaderData?.p;
    if (!p)
      return { meta: [{ title: "Project not found" }, { name: "robots", content: "noindex" }] };
    const origin = loaderData?.origin ?? "";
    const base = seoMeta({
      seo: { title: p.seoTitle, description: p.seoDescription, image: p.seoImage || p.coverUrl },
      fallback: { title: p.title, description: p.summary || p.title },
      origin,
      path: `/projects/${params.slug}`,
      siteName: loaderData?.name,
      type: "article",
      imageAlt: p.coverAlt || undefined,
    });
    const ld = {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      name: p.title,
      description: p.summary || undefined,
      url: `${origin}/projects/${params.slug}`,
      dateCreated: p.startDate ?? undefined,
      dateModified: p.updatedAt,
      keywords: p.tags.join(", ") || undefined,
      author: loaderData?.author ? { "@type": "Person", name: loaderData.author } : undefined,
    };
    return { ...base, scripts: [{ type: "application/ld+json", children: jsonLd(ld) }] };
  },
  notFoundComponent: () => (
    <div className="mx-auto max-w-xl px-5 py-32 text-center">
      <h1 className="font-display text-4xl">Project not found</h1>
      <p className="mt-3 text-muted-foreground">
        It may have been renamed, unpublished or removed.
      </p>
      <Link to="/projects" className="btn-primary mt-6">
        Back to projects
      </Link>
    </div>
  ),
  component: ProjectPage,
});

function ProjectPage() {
  const { slug } = Route.useParams();
  const { data: p } = useSuspenseQuery(projectQuery(slug));
  if (!p) return null;
  const start = formatDate(p.startDate);
  const end = formatDate(p.endDate) ?? (p.status === "in-progress" ? "Present" : null);
  const dates = [start, end].filter(Boolean).join(" — ");

  return (
    <article className="mx-auto max-w-3xl px-5 py-12">
      <Link
        to="/projects"
        className="inline-flex items-center gap-1.5 py-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="h-4 w-4" /> All projects
      </Link>
      <header className="mt-6">
        <div className="flex flex-wrap items-center gap-3 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          <span className="rounded-full border border-border px-2.5 py-0.5 text-primary">
            {p.status.replace("-", " ")}
          </span>
          {dates && <time dateTime={p.startDate ?? undefined}>{dates}</time>}
        </div>
        <h1 className="mt-4 font-display text-5xl font-light leading-tight md:text-6xl">
          {p.title}
        </h1>
        {p.summary && <p className="mt-4 text-xl text-muted-foreground">{p.summary}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          {p.repoUrl && (
            <SafeLink href={p.repoUrl} className="btn-ghost">
              <Github aria-hidden className="h-4 w-4" /> Source code
            </SafeLink>
          )}
          {p.liveUrl && (
            <SafeLink href={p.liveUrl} className="btn-primary">
              <ExternalLink aria-hidden className="h-4 w-4" /> Live site
            </SafeLink>
          )}
        </div>
        <dl className="mt-8 grid gap-4 border-y border-border py-5 text-sm sm:grid-cols-2">
          {p.tech.length > 0 && (
            <div>
              <dt className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Built with
              </dt>
              <dd className="mt-1.5">{p.tech.join(" · ")}</dd>
            </div>
          )}
          {p.tags.length > 0 && (
            <div>
              <dt className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Tags
              </dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5">
                {p.tags.map((t) => (
                  <span key={t} className="rounded-full bg-muted px-2.5 py-0.5 font-mono text-xs">
                    #{t}
                  </span>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </header>
      {p.coverUrl && (
        <Img
          src={p.coverUrl}
          alt={p.coverAlt || `Cover image for ${p.title}`}
          maxWidth={1280}
          sizes="(min-width: 768px) 768px, 100vw"
          priority
          className="mt-10 aspect-[16/9] w-full rounded-2xl border border-border object-cover"
        />
      )}
      <Markdown className="mt-10" fallbackAlt={`Illustration from ${p.title}`}>
        {p.content}
      </Markdown>
    </article>
  );
}
