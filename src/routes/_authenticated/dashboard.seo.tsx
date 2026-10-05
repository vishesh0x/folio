import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { AssetPicker } from "@/components/dash/AssetPicker";
import { run } from "@/components/dash/api";
import { Field, PageHeader, Panel, PrimaryButton, useUnsavedWarning } from "@/components/dash/ui";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { adminGetSeo, adminSaveSeo } from "@/lib/admin.functions";
import type { PageSeo } from "@/lib/public.functions";

export const Route = createFileRoute("/_authenticated/dashboard/seo")({ component: SeoPage });

const PAGES = [
  { page: "home", label: "Home", path: "/" },
  { page: "projects", label: "Projects", path: "/projects" },
  { page: "now", label: "Now", path: "/now" },
  { page: "resume", label: "Resume", path: "/resume" },
  { page: "contact", label: "Contact", path: "/contact" },
] as const;

function SeoPage() {
  const { data } = useQuery({ queryKey: ["dash", "page_seo"], queryFn: () => adminGetSeo() });
  return (
    <div>
      <PageHeader
        title="SEO"
        description="How each main page appears in search results and when shared. Individual project SEO lives in the project editor."
      />
      <div className="space-y-6">
        {PAGES.map((p) => (
          <SeoCard key={p.page} meta={p} row={data?.find((r) => r.page === p.page)} />
        ))}
      </div>
    </div>
  );
}

function SeoCard({ meta, row }: { meta: (typeof PAGES)[number]; row?: PageSeo }) {
  const qc = useQueryClient();
  const [s, setS] = useState({ title: "", description: "", ogImage: null as string | null });
  const [saving, setSaving] = useState(false);
  // Snapshot of the last loaded/saved values, to know when there are unsaved edits.
  const [saved, setSaved] = useState("");
  useEffect(() => {
    if (row) {
      const next = { title: row.title, description: row.description, ogImage: row.ogImage };
      setS(next);
      setSaved(JSON.stringify(next));
    }
  }, [row]);
  const dirty = saved !== "" && JSON.stringify(s) !== saved;
  const { markSaved } = useUnsavedWarning(dirty);

  const save = async () => {
    setSaving(true);
    const ok = await run(
      () => adminSaveSeo({ data: { page: meta.page, ...s } }),
      `${meta.label} SEO saved`,
    );
    setSaving(false);
    if (ok) {
      markSaved();
      setSaved(JSON.stringify(s));
      qc.invalidateQueries();
    }
  };
  const host = typeof window !== "undefined" ? window.location.host : "yoursite.com";

  return (
    <Panel
      title={meta.label}
      actions={
        <PrimaryButton onClick={save} disabled={saving} aria-label={`Save ${meta.label} SEO`}>
          {saving ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <Save aria-hidden className="h-4 w-4" />
          )}{" "}
          Save
        </PrimaryButton>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Field
            label="Title"
            hint={
              <span className={s.title.length > 60 ? "text-destructive" : ""}>
                {s.title.length}/60
              </span>
            }
          >
            <Input value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} />
          </Field>
          <Field
            label="Description"
            hint={
              <span className={s.description.length > 160 ? "text-destructive" : ""}>
                {s.description.length}/160
              </span>
            }
          >
            <Textarea
              rows={3}
              value={s.description}
              onChange={(e) => setS({ ...s, description: e.target.value })}
            />
          </Field>
          <Field label="Share image" hint="1200×630 works best">
            <AssetPicker noSvg value={s.ogImage} onChange={(v) => setS({ ...s, ogImage: v })} />
          </Field>
        </div>
        <div className="rounded-xl bg-muted p-4" aria-label="Search preview">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Search preview
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {host}
            {meta.path}
          </p>
          <p className="mt-0.5 truncate text-lg text-primary">{s.title || "Untitled"}</p>
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {s.description || "No description"}
          </p>
        </div>
      </div>
    </Panel>
  );
}
