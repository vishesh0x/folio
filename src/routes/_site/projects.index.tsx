import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ProjectCard } from "@/components/site/ProjectCard";
import { pageSeo, projectsQuery, seoMeta, siteQuery } from "@/lib/queries";

// Filters live in the URL so a filtered view can be shared / bookmarked.
const str = (v: unknown, max: number) =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;
const validateSearch = (s: Record<string, unknown>): { q?: string; tag?: string } => ({
  q: str(s.q, 100),
  tag: str(s.tag, 60),
});

export const Route = createFileRoute("/_site/projects/")({
  validateSearch,
  loader: async ({ context }) => {
    const [site] = await Promise.all([
      context.queryClient.ensureQueryData(siteQuery),
      context.queryClient.ensureQueryData(projectsQuery),
    ]);
    return { seo: site.seo.projects, origin: site.origin, name: site.config?.name };
  },
  head: ({ loaderData }) =>
    seoMeta({
      seo: pageSeo(loaderData?.seo),
      fallback: { title: "Projects", description: "Things I have built and shipped." },
      origin: loaderData?.origin ?? "",
      path: "/projects",
      siteName: loaderData?.name,
    }),
  component: ProjectsPage,
});

const chip = (on: boolean) =>
  `rounded-full px-3 py-1.5 font-mono text-xs transition-colors ${on ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`;

function ProjectsPage() {
  const { data: projects } = useSuspenseQuery(projectsQuery);
  const { q: urlQ = "", tag } = Route.useSearch();
  // Keep the text box in local state and sync it to the URL after a short pause. Binding a
  // controlled input straight to router search params can drop characters while typing fast.
  const [q, setQ] = useState(urlQ);
  useEffect(() => setQ(urlQ), [urlQ]);
  const navigate = useNavigate({ from: Route.fullPath });
  const tags = useMemo(() => [...new Set(projects.flatMap((p) => p.tags))].sort(), [projects]);
  const needle = q.trim().toLowerCase();
  const list = projects.filter(
    (p) =>
      (!tag || p.tags.includes(tag)) &&
      (!needle || `${p.title} ${p.summary} ${p.tech.join(" ")}`.toLowerCase().includes(needle)),
  );
  const setSearch = (next: { q?: string; tag?: string }) =>
    navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });
  useEffect(() => {
    if (q === urlQ) return;
    const t = setTimeout(() => setSearch({ q: q || undefined }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="mx-auto max-w-5xl px-5 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Archive</p>
      <h1 className="mt-3 font-display text-5xl font-light md:text-7xl">Projects</h1>
      <p className="mt-4 max-w-xl text-muted-foreground">
        A collection of things I've designed, built, and occasionally broken. {projects.length} and
        counting.
      </p>

      <div className="mt-10 flex flex-col gap-4 md:flex-row md:items-center">
        <div className="relative md:w-72">
          <label htmlFor="project-search" className="sr-only">
            Search projects
          </label>
          <Search
            aria-hidden
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id="project-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects…"
            className="w-full rounded-full border border-input bg-card py-2.5 pl-9 pr-4 text-sm"
          />
        </div>
        <div role="group" aria-label="Filter by tag" className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={!tag}
            onClick={() => setSearch({ tag: undefined })}
            className={chip(!tag)}
          >
            all
          </button>
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tag === t}
              onClick={() => setSearch({ tag: t === tag ? undefined : t })}
              className={chip(tag === t)}
            >
              #{t}
            </button>
          ))}
        </div>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {list.length} {list.length === 1 ? "project" : "projects"} shown
      </p>
      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((p, i) => (
          <ProjectCard key={p.id} project={p} index={i} priority={i < 3} />
        ))}
      </div>
      {list.length === 0 && (
        <p className="mt-16 text-center text-muted-foreground">No projects match that filter.</p>
      )}
    </div>
  );
}
