import { formatDate } from "./dates";
import type { Project } from "@/db/schema";

/** Resume entry fields derived from a project (kept pure so it can be unit-tested). */
export type EntryFromProject = {
  sectionId: string;
  projectId: string;
  title: string;
  subtitle: string;
  organization: string;
  location: string;
  startDate: string;
  endDate: string;
  description: string;
  link: string | null;
  tags: string[];
};

export function projectToEntry(
  p: Pick<
    Project,
    | "id"
    | "slug"
    | "title"
    | "summary"
    | "tech"
    | "repoUrl"
    | "liveUrl"
    | "startDate"
    | "endDate"
    | "status"
    | "published"
  >,
  sectionId: string,
): EntryFromProject {
  const end = p.endDate
    ? (formatDate(p.endDate) ?? "")
    : p.status === "in-progress"
      ? "Present"
      : "";
  return {
    sectionId,
    projectId: p.id,
    title: p.title,
    subtitle: "",
    organization: "",
    location: "",
    startDate: formatDate(p.startDate) ?? "",
    endDate: end,
    description: p.summary,
    // Live site → source → the case-study page (only if it's actually public).
    link: p.liveUrl || p.repoUrl || (p.published ? `/projects/${p.slug}` : null),
    tags: p.tech.slice(0, 40),
  };
}
