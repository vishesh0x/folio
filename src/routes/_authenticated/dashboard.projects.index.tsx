import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ExternalLink, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Img } from "@/components/Img";
import { reorderIds, run } from "@/components/dash/api";
import { ConfirmButton } from "@/components/dash/ConfirmButton";
import { IconButton, PageHeader } from "@/components/dash/ui";
import {
  adminDeleteProject,
  adminListProjects,
  adminPatchProject,
  adminReorderProjects,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/dashboard/projects/")({
  component: ProjectsAdmin,
});

function ProjectsAdmin() {
  const qc = useQueryClient();
  const { data: projects = [] } = useQuery({
    queryKey: ["dash", "projects"],
    queryFn: () => adminListProjects(),
  });
  const refresh = () => qc.invalidateQueries();

  const patch = async (id: string, p: { featured?: boolean; published?: boolean }) => {
    await run(() => adminPatchProject({ data: { id, ...p } }));
    refresh();
  };
  const move = async (i: number, dir: -1 | 1) => {
    const ids = reorderIds(projects, i, dir);
    if (!ids) return;
    await run(() => adminReorderProjects({ data: { ids } }));
    refresh();
  };
  const remove = async (id: string) => {
    await run(() => adminDeleteProject({ data: { id } }), "Project deleted");
    refresh();
  };

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Create, edit and order the projects shown on your site."
        actions={
          <Link to="/dashboard/projects/$id" params={{ id: "new" }} className="btn-primary">
            <Plus aria-hidden className="h-4 w-4" /> New project
          </Link>
        }
      />
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {projects.length === 0 && (
          <p className="p-10 text-center text-sm text-muted-foreground">
            No projects yet. Create your first one!
          </p>
        )}
        <ul className="divide-y divide-border">
          {projects.map((p, i) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="flex flex-col">
                <IconButton
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={`Move ${p.title} up`}
                >
                  <ArrowUp aria-hidden className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton
                  disabled={i === projects.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={`Move ${p.title} down`}
                >
                  <ArrowDown aria-hidden className="h-3.5 w-3.5" />
                </IconButton>
              </div>
              <div className="h-12 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                {p.coverUrl ? (
                  <Img
                    src={p.coverUrl}
                    alt={p.coverAlt || `Cover for ${p.title}`}
                    maxWidth={160}
                    width={64}
                    height={48}
                    sizes="64px"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="flex h-full items-center justify-center font-display text-xl italic text-primary"
                  >
                    {p.title[0]}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1 basis-40">
                <Link
                  to="/dashboard/projects/$id"
                  params={{ id: p.id }}
                  className="font-medium hover:text-primary"
                >
                  {p.title}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  /{p.slug} · {p.tags.join(", ")}
                </p>
              </div>
              <button
                type="button"
                aria-pressed={p.published}
                onClick={() => patch(p.id, { published: !p.published })}
                className={`rounded-full px-3 py-1.5 text-xs ${p.published ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}
              >
                {p.published ? "Published" : "Draft"}
              </button>
              <IconButton
                onClick={() => patch(p.id, { featured: !p.featured })}
                aria-pressed={p.featured}
                aria-label={`Feature ${p.title} on the home page`}
              >
                <Star
                  aria-hidden
                  className={`h-4 w-4 ${p.featured ? "fill-primary text-primary" : ""}`}
                />
              </IconButton>
              {p.published && (
                <a
                  href={`/projects/${p.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View ${p.title} (opens in a new tab)`}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                >
                  <ExternalLink aria-hidden className="h-4 w-4" />
                </a>
              )}
              <Link
                to="/dashboard/projects/$id"
                params={{ id: p.id }}
                aria-label={`Edit ${p.title}`}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              >
                <Pencil aria-hidden className="h-4 w-4" />
              </Link>
              <ConfirmButton title={`Delete “${p.title}”?`} onConfirm={() => remove(p.id)}>
                <IconButton aria-label={`Delete ${p.title}`}>
                  <Trash2 aria-hidden className="h-4 w-4" />
                </IconButton>
              </ConfirmButton>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
