import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Img } from "@/components/Img";
import type { ProjectListItem } from "@/lib/public.functions";

export function ProjectCard({
  project,
  index,
  priority,
}: {
  project: ProjectListItem;
  index?: number;
  priority?: boolean;
}) {
  return (
    <Link
      to="/projects/$slug"
      params={{ slug: project.slug }}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_20px_40px_-20px_color-mix(in_oklab,var(--primary)_35%,transparent)] motion-reduce:hover:translate-y-0"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-muted">
        {project.coverUrl ? (
          <Img
            src={project.coverUrl}
            alt={project.coverAlt || `Cover image for ${project.title}`}
            maxWidth={640}
            sizes="(min-width: 1024px) 320px, (min-width: 640px) 45vw, 100vw"
            priority={priority}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:group-hover:scale-100"
          />
        ) : (
          <div aria-hidden className="flex h-full w-full items-end justify-between p-5">
            <span className="font-display text-7xl font-light italic text-primary/80">
              {project.title.charAt(0)}
            </span>
            {index !== undefined && (
              <span className="font-mono text-xs text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-xl font-medium leading-tight">{project.title}</h3>
          <ArrowUpRight
            aria-hidden
            className="h-5 w-5 shrink-0 text-muted-foreground transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
          />
        </div>
        <p className="line-clamp-2 text-sm text-muted-foreground">{project.summary}</p>
        {project.tags.length > 0 && (
          <ul aria-label="Tags" className="mt-auto flex flex-wrap gap-1.5 pt-2">
            {project.tags.map((t) => (
              <li
                key={t}
                className="rounded-full bg-muted px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground"
              >
                #{t}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Link>
  );
}
