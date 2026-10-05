import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, ExternalLink, Loader2, Save } from "lucide-react";
import { ImageField, AssetPicker } from "@/components/dash/AssetPicker";
import { run } from "@/components/dash/api";
import {
  Field,
  Panel,
  PrimaryButton,
  SaveBar,
  TagInput,
  slugify,
  useUnsavedWarning,
} from "@/components/dash/ui";
import { Markdown, countImagesMissingAlt } from "@/components/Markdown";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { adminGetProject, adminSaveProject } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/dashboard/projects/$id")({
  component: ProjectEditor,
});

type Draft = {
  title: string;
  slug: string;
  summary: string;
  content: string;
  coverUrl: string | null;
  coverAlt: string;
  tags: string[];
  tech: string[];
  repoUrl: string | null;
  liveUrl: string | null;
  status: "in-progress" | "completed" | "archived";
  featured: boolean;
  published: boolean;
  startDate: string | null;
  endDate: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoImage: string | null;
};
const empty: Draft = {
  title: "",
  slug: "",
  summary: "",
  content: "",
  coverUrl: null,
  coverAlt: "",
  tags: [],
  tech: [],
  repoUrl: null,
  liveUrl: null,
  status: "completed",
  featured: false,
  published: true,
  startDate: null,
  endDate: null,
  seoTitle: null,
  seoDescription: null,
  seoImage: null,
};

const CHEATSHEET = `**bold** *italic* ~~strike~~ \`code\`
# Heading  ## Sub  - list  - [ ] task
> [!note] Callout title   (tip, warning, danger, info, quote…)
[[other-project]]  [[slug|label]]  ![alt text](/media/your-image.webp)
\`\`\`ts  fenced code  \`\`\`   | tables | work |`;

function ProjectEditor() {
  const { id } = Route.useParams();
  const isNew = id === "new";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["dash", "project", id],
    enabled: !isNew,
    queryFn: () => adminGetProject({ data: { id } }),
  });
  const [d, setD] = useState<Draft>(empty);
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [view, setView] = useState<"split" | "write" | "preview">("split");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { markSaved } = useUnsavedWarning(dirty);

  useEffect(() => {
    if (data) {
      const { id: _i, createdAt: _c, updatedAt: _u, sortOrder: _s, ...rest } = data;
      setD(rest as Draft);
      setDirty(false);
    } else if (isNew) setD(empty);
  }, [data, isNew]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((p) => ({ ...p, [k]: v }));
    setDirty(true);
  };
  const missingAlt = countImagesMissingAlt(d.content);

  const save = async () => {
    setSaving(true);
    const res = await run(
      () =>
        adminSaveProject({
          data: { id: isNew ? null : id, data: { ...d, slug: slugify(d.slug) } },
        }),
      "Project saved",
    );
    setSaving(false);
    if (!res) return;
    markSaved();
    setDirty(false);
    qc.invalidateQueries();
    if (isNew) navigate({ to: "/dashboard/projects/$id", params: { id: res.id }, replace: true });
  };

  if (!isNew && !data) return <Loader2 aria-label="Loading" className="h-5 w-5 animate-spin" />;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/dashboard/projects"
          className="inline-flex items-center gap-1.5 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="h-4 w-4" /> Projects
        </Link>
        <div className="flex items-center gap-2">
          {dirty && (
            <span role="status" className="text-xs text-muted-foreground">
              Unsaved changes
            </span>
          )}
          {!isNew && d.published && (
            <a
              href={`/projects/${d.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost"
            >
              <ExternalLink aria-hidden className="h-4 w-4" /> View
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          <PrimaryButton onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            ) : (
              <Save aria-hidden className="h-4 w-4" />
            )}{" "}
            Save
          </PrimaryButton>
        </div>
      </div>

      <label htmlFor="p-title" className="sr-only">
        Project title
      </label>
      <input
        id="p-title"
        value={d.title}
        onChange={(e) => {
          set("title", e.target.value);
          if (!slugTouched) set("slug", slugify(e.target.value));
        }}
        placeholder="Project title"
        maxLength={160}
        className="w-full bg-transparent font-display text-4xl placeholder:text-muted-foreground/60"
      />
      <label htmlFor="p-summary" className="sr-only">
        One-line summary
      </label>
      <input
        id="p-summary"
        value={d.summary}
        onChange={(e) => set("summary", e.target.value)}
        placeholder="One-line summary"
        maxLength={400}
        className="mt-2 w-full bg-transparent text-lg text-muted-foreground placeholder:text-muted-foreground/70"
      />

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div role="group" aria-label="Editor view" className="flex gap-1 text-xs">
              {(["write", "split", "preview"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={`rounded-md px-3 py-1.5 capitalize ${view === v ? "bg-muted font-medium" : "text-muted-foreground"}`}
                >
                  {v}
                </button>
              ))}
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">
              Markdown · Obsidian syntax
            </span>
          </div>
          {missingAlt > 0 && (
            <p
              role="alert"
              className="flex items-center gap-2 border-b border-border bg-primary/10 px-4 py-2 text-xs"
            >
              <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" />
              {missingAlt} image{missingAlt > 1 ? "s" : ""} in the body{" "}
              {missingAlt > 1 ? "have" : "has"} no alt text — write it between the brackets:
              ![describe the image](…)
            </p>
          )}
          <div className={`grid min-h-[560px] ${view === "split" ? "lg:grid-cols-2" : ""}`}>
            {view !== "preview" && (
              <>
                <label htmlFor="p-content" className="sr-only">
                  Project content (Markdown)
                </label>
                <textarea
                  id="p-content"
                  value={d.content}
                  onChange={(e) => set("content", e.target.value)}
                  placeholder="Write about your project in markdown…"
                  maxLength={100000}
                  className="min-h-[560px] w-full resize-none bg-transparent p-4 font-mono text-sm leading-relaxed"
                />
              </>
            )}
            {view !== "write" && (
              <div
                className={`overflow-y-auto p-5 ${view === "split" ? "border-t border-border lg:border-l lg:border-t-0" : ""}`}
                aria-label="Preview"
              >
                <Markdown fallbackAlt={`Illustration from ${d.title || "project"}`}>
                  {d.content || "*Nothing to preview yet.*"}
                </Markdown>
              </div>
            )}
          </div>
          <pre className="whitespace-pre-wrap border-t border-border px-4 py-3 font-mono text-[11px] text-muted-foreground">
            {CHEATSHEET}
          </pre>
        </div>

        <div className="min-w-0 space-y-6">
          <Panel title="Details">
            <Field label="Slug" hint={`/projects/${d.slug || "…"}`}>
              <Input
                value={d.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  set("slug", e.target.value);
                }}
              />
            </Field>
            <div className="flex items-center justify-between">
              <span id="pub" className="text-sm">
                Published
              </span>
              <Switch
                aria-labelledby="pub"
                checked={d.published}
                onCheckedChange={(v) => set("published", v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <span id="feat" className="text-sm">
                Featured on home
              </span>
              <Switch
                aria-labelledby="feat"
                checked={d.featured}
                onCheckedChange={(v) => set("featured", v)}
              />
            </div>
            <Field label="Status">
              <Select value={d.status} onValueChange={(v) => set("status", v as Draft["status"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in-progress">In progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Start">
                <Input
                  type="date"
                  value={d.startDate ?? ""}
                  onChange={(e) => set("startDate", e.target.value || null)}
                />
              </Field>
              <Field label="End">
                <Input
                  type="date"
                  value={d.endDate ?? ""}
                  onChange={(e) => set("endDate", e.target.value || null)}
                />
              </Field>
            </div>
            <Field label="Cover image">
              <ImageField
                url={d.coverUrl}
                alt={d.coverAlt}
                onChange={(n) => {
                  setD((p) => ({ ...p, coverUrl: n.url, coverAlt: n.alt ?? "" }));
                  setDirty(true);
                }}
              />
            </Field>
          </Panel>
          <Panel title="Links & tags">
            <Field label="Source code URL">
              <Input
                value={d.repoUrl ?? ""}
                onChange={(e) => set("repoUrl", e.target.value || null)}
                placeholder="https://github.com/…"
              />
            </Field>
            <Field label="Live URL">
              <Input
                value={d.liveUrl ?? ""}
                onChange={(e) => set("liveUrl", e.target.value || null)}
                placeholder="https://"
              />
            </Field>
            <Field label="Tags">
              <TagInput value={d.tags} onChange={(v) => set("tags", v)} />
            </Field>
            <Field label="Tech stack">
              <TagInput
                value={d.tech}
                onChange={(v) => set("tech", v)}
                placeholder="React, Postgres"
              />
            </Field>
          </Panel>
          <Panel title="SEO">
            <Field label="SEO title" hint={`${(d.seoTitle ?? "").length}/60`}>
              <Input
                value={d.seoTitle ?? ""}
                onChange={(e) => set("seoTitle", e.target.value || null)}
                placeholder={d.title}
              />
            </Field>
            <Field label="SEO description" hint={`${(d.seoDescription ?? "").length}/160`}>
              <Textarea
                rows={3}
                value={d.seoDescription ?? ""}
                onChange={(e) => set("seoDescription", e.target.value || null)}
                placeholder={d.summary}
              />
            </Field>
            <Field label="Share image">
              <AssetPicker noSvg value={d.seoImage} onChange={(v) => set("seoImage", v)} />
            </Field>
          </Panel>
        </div>
      </div>
      <SaveBar dirty={dirty} saving={saving} onSave={save} label="Save project" />
    </div>
  );
}
