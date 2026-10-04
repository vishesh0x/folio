import { Link, createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowRight, MapPin } from "lucide-react";
import { Img } from "@/components/Img";
import { Markdown } from "@/components/Markdown";
import { RevealContact } from "@/components/RevealContact";
import { SafeLink } from "@/components/SafeLink";
import { ProjectCard } from "@/components/site/ProjectCard";
import { jsonLd, nowQuery, pageSeo, projectsQuery, seoMeta, siteQuery } from "@/lib/queries";
import { safeHref } from "@/lib/url";

export const Route = createFileRoute("/_site/")({
  loader: async ({ context }) => {
    const [site] = await Promise.all([
      context.queryClient.ensureQueryData(siteQuery),
      context.queryClient.ensureQueryData(projectsQuery),
      context.queryClient.ensureQueryData(nowQuery),
    ]);
    return { seo: site.seo.home, cfg: site.config, origin: site.origin };
  },
  head: ({ loaderData }) => {
    const cfg = loaderData?.cfg;
    const origin = loaderData?.origin ?? "";
    const base = seoMeta({
      seo: pageSeo(loaderData?.seo),
      fallback: {
        title: cfg?.metaTitle || (cfg?.name ? `${cfg.name} — Portfolio` : "Portfolio"),
        description:
          cfg?.metaDescription || cfg?.tagline || "Personal portfolio, projects and notes.",
      },
      origin,
      path: "/",
      siteName: cfg?.name,
      defaultImage: cfg?.ogImage ?? cfg?.avatarUrl,
      imageAlt: cfg?.avatarAlt || undefined,
    });
    const person = {
      "@context": "https://schema.org",
      "@type": "Person",
      name: cfg?.name,
      jobTitle: cfg?.role,
      url: origin,
      email: cfg?.email ? `mailto:${cfg.email}` : undefined,
      sameAs: (cfg?.socials ?? []).map((s) => safeHref(s.url)).filter(Boolean),
    };
    return { ...base, scripts: [{ type: "application/ld+json", children: jsonLd(person) }] };
  },
  component: Home,
});

function Home() {
  const { data: site } = useSuspenseQuery(siteQuery);
  const { data: projects } = useSuspenseQuery(projectsQuery);
  const { data: now } = useSuspenseQuery(nowQuery);
  const cfg = site.config;
  const featured = projects.filter((p) => p.featured).slice(0, 4);
  const shown = featured.length ? featured : projects.slice(0, 4);
  const doing = now.items.filter((i) => i.status === "doing").slice(0, 4);
  const catById = Object.fromEntries(now.categories.map((c) => [c.id, c]));
  const socials = cfg?.socials ?? [];
  const [first, ...rest] = (cfg?.name ?? "Hello").split(" ");

  return (
    <div className="mx-auto max-w-5xl px-5">
      <section
        className="grid gap-10 py-16 md:grid-cols-[1fr_auto] md:items-end md:py-24"
        aria-labelledby="intro"
      >
        <div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {cfg?.available && (
              <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1">
                <span aria-hidden className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                </span>
                Open to opportunities
              </span>
            )}
            {cfg?.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin aria-hidden className="h-3.5 w-3.5" /> {cfg.location}
              </span>
            )}
          </div>
          <h1
            id="intro"
            className="mt-6 font-display text-6xl font-light leading-[0.95] tracking-tight md:text-8xl"
          >
            {first} <em className="font-normal text-primary">{rest.join(" ")}</em>
          </h1>
          <p className="mt-4 font-mono text-sm uppercase tracking-[0.2em] text-muted-foreground">
            {cfg?.role}
          </p>
          {cfg?.tagline && (
            <p className="mt-8 max-w-2xl font-display text-2xl leading-snug md:text-3xl">
              {cfg.tagline}
            </p>
          )}
          {cfg?.bio && (
            <Markdown className="mt-6 max-w-2xl text-muted-foreground">{cfg.bio}</Markdown>
          )}
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link to="/projects" className="btn-primary px-5 py-3">
              View my work <ArrowRight aria-hidden className="h-4 w-4" />
            </Link>
            <Link to="/contact" className="btn-ghost px-5 py-3">
              Say hello
            </Link>
          </div>
        </div>
        {cfg?.avatarUrl && (
          <Img
            src={cfg.avatarUrl}
            alt={cfg.avatarAlt || `Portrait of ${cfg.name}`}
            width={224}
            height={224}
            maxWidth={448}
            sizes="(min-width: 768px) 224px, 160px"
            priority
            className="h-40 w-40 rotate-3 rounded-2xl border border-border object-cover shadow-lg md:h-56 md:w-56"
          />
        )}
      </section>

      {shown.length > 0 && (
        <section className="border-t border-border py-16" aria-labelledby="work">
          <div className="mb-8 flex items-end justify-between">
            <h2 id="work" className="font-display text-3xl md:text-4xl">
              Selected <em className="text-primary">work</em>
            </h2>
            <Link
              to="/projects"
              className="link-underline py-1 text-sm text-muted-foreground hover:text-foreground"
            >
              All projects →
            </Link>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            {shown.map((p, i) => (
              <ProjectCard key={p.id} project={p} index={i} priority={i < 2 && !cfg?.avatarUrl} />
            ))}
          </div>
        </section>
      )}

      {doing.length > 0 && (
        <section className="border-t border-border py-16" aria-labelledby="now">
          <div className="mb-8 flex items-end justify-between">
            <h2 id="now" className="font-display text-3xl md:text-4xl">
              Right <em className="text-primary">now</em>
            </h2>
            <Link
              to="/now"
              className="link-underline py-1 text-sm text-muted-foreground hover:text-foreground"
            >
              Full now page →
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {doing.map((i) => (
              <li
                key={i.id}
                className="flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:gap-4"
              >
                <span className="w-32 shrink-0 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  <span aria-hidden>{catById[i.categoryId]?.emoji}</span>{" "}
                  {catById[i.categoryId]?.name}
                </span>
                <div>
                  <p className="font-medium">{i.title}</p>
                  {i.description && (
                    <p className="text-sm text-muted-foreground">{i.description}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="border-t border-border py-16" aria-labelledby="cta">
        <div className="rounded-3xl bg-muted p-8 md:p-12">
          <h2 id="cta" className="font-display text-4xl md:text-5xl">
            Let's make something <em className="text-primary">good</em>.
          </h2>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            {cfg?.email ? (
              <a href={`mailto:${cfg.email}`} className="link-underline py-1 font-medium">
                {cfg.email}
              </a>
            ) : (
              site.emailReveal && (
                <RevealContact field="siteEmail" kind="email" siteKey={site.turnstileSiteKey} />
              )
            )}
            {socials.map((s) => (
              <SafeLink
                key={s.url + s.label}
                href={s.url}
                className="link-underline py-1 text-muted-foreground hover:text-foreground"
              >
                {s.label} <span aria-hidden>↗</span>
              </SafeLink>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
