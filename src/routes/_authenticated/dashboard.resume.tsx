import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  ExternalLink,
  FolderKanban,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { reorderIds, run } from "@/components/dash/api";
import { ConfirmButton } from "@/components/dash/ConfirmButton";
import {
  Field,
  GhostButton,
  IconButton,
  PageHeader,
  Panel,
  PrimaryButton,
  PrivacySelect,
  SaveBar,
  TagInput,
  useUnsavedWarning,
} from "@/components/dash/ui";
import { ResumeView } from "@/components/site/ResumeView";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  adminDeleteEntry,
  adminDeleteSection,
  adminGetResume,
  adminImportProjects,
  adminListProjects,
  adminReorderEntries,
  adminReorderSections,
  adminSaveEntry,
  adminSaveResumeProfile,
  adminSaveSection,
  adminSetSectionVisible,
} from "@/lib/admin.functions";
import type { ResumeEntry, ResumeProfile, ResumeSection, Social } from "@/lib/public.functions";
import { RESUME_KINDS } from "@/lib/validators";

export const Route = createFileRoute("/_authenticated/dashboard/resume")({
  component: ResumeBuilder,
});

const KIND_LABEL: Record<(typeof RESUME_KINDS)[number], string> = {
  experience: "Experience",
  education: "Education",
  projects: "Projects",
  skills: "Skills (grouped tags)",
  certifications: "Certifications",
  awards: "Awards",
  languages: "Languages",
  volunteering: "Volunteering",
  publications: "Publications",
  custom: "Custom",
};
type Kind = (typeof RESUME_KINDS)[number];
type EntryDraft = Partial<ResumeEntry> & { sectionId: string };
type SectionDraft = { id?: string; title: string; kind: Kind };

function ResumeBuilder() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["dash", "resume"], queryFn: () => adminGetResume() });
  const sections = data?.sections ?? [];
  const entries = data?.entries ?? [];
  const refresh = () => qc.invalidateQueries();
  const [entry, setEntry] = useState<EntryDraft | null>(null);
  const [sectionDraft, setSectionDraft] = useState<SectionDraft | null>(null);
  const [preview, setPreview] = useState(false);
  // "Choose from my projects" dialog
  const [pickFor, setPickFor] = useState<{ sectionId: string; title: string } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const { data: projects } = useQuery({
    queryKey: ["dash", "projects"],
    queryFn: () => adminListProjects(),
    enabled: !!pickFor,
  });
  const alreadyAdded = new Set(
    (data?.entries ?? [])
      .filter((e) => e.sectionId === pickFor?.sectionId && e.projectId)
      .map((e) => e.projectId as string),
  );
  const togglePicked = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const importPicked = async () => {
    if (!pickFor || picked.length === 0) return;
    const res = await run(() =>
      adminImportProjects({ data: { sectionId: pickFor.sectionId, projectIds: picked } }),
    );
    if (res) {
      toast.success(`${res.added} project${res.added === 1 ? "" : "s"} added`);
      setPickFor(null);
      setPicked([]);
      refresh();
    }
  };

  const saveSection = async () => {
    if (!sectionDraft?.title.trim()) return toast.error("Section title is required");
    const ok = await run(() =>
      adminSaveSection({
        data: {
          id: sectionDraft.id ?? null,
          data: { title: sectionDraft.title, kind: sectionDraft.kind },
        },
      }),
    );
    if (ok) {
      setSectionDraft(null);
      refresh();
    }
  };
  const saveEntry = async () => {
    if (!entry) return;
    const { id, createdAt: _c, sortOrder: _s, ...rest } = entry;
    const ok = await run(() =>
      adminSaveEntry({
        data: {
          id: id ?? null,
          data: {
            sectionId: rest.sectionId,
            title: rest.title ?? "",
            subtitle: rest.subtitle ?? "",
            organization: rest.organization ?? "",
            location: rest.location ?? "",
            startDate: rest.startDate ?? "",
            endDate: rest.endDate ?? "",
            description: rest.description ?? "",
            link: rest.link || null,
            tags: rest.tags ?? [],
          },
        },
      }),
    );
    if (ok) {
      setEntry(null);
      refresh();
    }
  };
  const kindOf = (id: string) => sections.find((s) => s.id === id)?.kind;

  return (
    <div>
      <PageHeader
        title="Resume builder"
        description="Build the resume shown on your Resume page. Upload the downloadable PDF in Site config."
        actions={
          <>
            <GhostButton aria-pressed={preview} onClick={() => setPreview(!preview)}>
              {preview ? (
                <EyeOff aria-hidden className="h-4 w-4" />
              ) : (
                <Eye aria-hidden className="h-4 w-4" />
              )}{" "}
              {preview ? "Hide" : "Show"} preview
            </GhostButton>
            <a href="/resume" target="_blank" rel="noopener noreferrer" className="btn-ghost">
              <ExternalLink aria-hidden className="h-4 w-4" /> Open page
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </>
        }
      />
      <div className={`grid gap-6 ${preview ? "2xl:grid-cols-2" : ""}`}>
        <div className="min-w-0 space-y-6">
          {data && <ProfileEditor profile={data.profile} />}

          {sections.map((s, si) => {
            const list = entries.filter((e) => e.sectionId === s.id);
            return (
              <Panel key={s.id}>
                <div className="flex items-center gap-1">
                  <div className="flex-1">
                    <h2
                      className={`font-display text-xl ${s.visible ? "" : "text-muted-foreground line-through"}`}
                    >
                      {s.title}
                      {!s.visible && <span className="sr-only"> (hidden)</span>}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {KIND_LABEL[s.kind as Kind] ?? s.kind} · {list.length} entries
                    </p>
                  </div>
                  <IconButton
                    disabled={si === 0}
                    onClick={async () => {
                      const ids = reorderIds(sections, si, -1);
                      if (ids) {
                        await run(() => adminReorderSections({ data: { ids } }));
                        refresh();
                      }
                    }}
                    aria-label={`Move ${s.title} up`}
                  >
                    <ArrowUp aria-hidden className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    disabled={si === sections.length - 1}
                    onClick={async () => {
                      const ids = reorderIds(sections, si, 1);
                      if (ids) {
                        await run(() => adminReorderSections({ data: { ids } }));
                        refresh();
                      }
                    }}
                    aria-label={`Move ${s.title} down`}
                  >
                    <ArrowDown aria-hidden className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    onClick={async () => {
                      await run(() =>
                        adminSetSectionVisible({ data: { id: s.id, visible: !s.visible } }),
                      );
                      refresh();
                    }}
                    aria-label={s.visible ? `Hide ${s.title}` : `Show ${s.title}`}
                  >
                    {s.visible ? (
                      <Eye aria-hidden className="h-4 w-4" />
                    ) : (
                      <EyeOff aria-hidden className="h-4 w-4" />
                    )}
                  </IconButton>
                  <IconButton
                    onClick={() =>
                      setSectionDraft({ id: s.id, title: s.title, kind: s.kind as Kind })
                    }
                    aria-label={`Edit section ${s.title}`}
                  >
                    <Pencil aria-hidden className="h-4 w-4" />
                  </IconButton>
                  <ConfirmButton
                    title={`Delete section “${s.title}”?`}
                    description="All entries in this section are deleted too."
                    onConfirm={async () => {
                      await run(() => adminDeleteSection({ data: { id: s.id } }));
                      refresh();
                    }}
                  >
                    <IconButton aria-label={`Delete section ${s.title}`}>
                      <Trash2 aria-hidden className="h-4 w-4" />
                    </IconButton>
                  </ConfirmButton>
                </div>
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {list.map((e, ei) => (
                    <li key={e.id} className="flex items-center gap-2 p-3">
                      <div className="flex flex-col">
                        <IconButton
                          disabled={ei === 0}
                          onClick={async () => {
                            const ids = reorderIds(list, ei, -1);
                            if (ids) {
                              await run(() => adminReorderEntries({ data: { ids } }));
                              refresh();
                            }
                          }}
                          className="!h-7 !w-7"
                          aria-label={`Move ${e.title || "entry"} up`}
                        >
                          <ArrowUp aria-hidden className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton
                          disabled={ei === list.length - 1}
                          onClick={async () => {
                            const ids = reorderIds(list, ei, 1);
                            if (ids) {
                              await run(() => adminReorderEntries({ data: { ids } }));
                              refresh();
                            }
                          }}
                          className="!h-7 !w-7"
                          aria-label={`Move ${e.title || "entry"} down`}
                        >
                          <ArrowDown aria-hidden className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {e.title || "Untitled"}
                          {e.projectId && (
                            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-normal text-muted-foreground">
                              from project
                            </span>
                          )}
                          {e.organization && (
                            <span className="font-normal text-muted-foreground">
                              {" "}
                              · {e.organization}
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {s.kind === "skills"
                            ? e.tags.join(", ")
                            : [e.startDate, e.endDate].filter(Boolean).join(" — ")}
                        </p>
                      </div>
                      <IconButton
                        onClick={() => setEntry(e)}
                        aria-label={`Edit ${e.title || "entry"}`}
                      >
                        <Pencil aria-hidden className="h-4 w-4" />
                      </IconButton>
                      <ConfirmButton
                        title={`Delete “${e.title || "this entry"}”?`}
                        onConfirm={async () => {
                          await run(() => adminDeleteEntry({ data: { id: e.id } }));
                          refresh();
                        }}
                      >
                        <IconButton aria-label={`Delete ${e.title || "entry"}`}>
                          <Trash2 aria-hidden className="h-4 w-4" />
                        </IconButton>
                      </ConfirmButton>
                    </li>
                  ))}
                  <li className="flex">
                    <button
                      type="button"
                      onClick={() => setEntry({ sectionId: s.id, tags: [] })}
                      className="flex flex-1 items-center justify-center gap-1.5 p-3 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <Plus aria-hidden className="h-4 w-4" /> Add entry
                      <span className="sr-only"> to {s.title}</span>
                    </button>
                    {(s.kind === "projects" || s.kind === "custom") && (
                      <button
                        type="button"
                        onClick={() => {
                          setPicked([]);
                          setPickFor({ sectionId: s.id, title: s.title });
                        }}
                        className="flex flex-1 items-center justify-center gap-1.5 border-l border-border p-3 text-sm text-primary hover:text-foreground"
                      >
                        <FolderKanban aria-hidden className="h-4 w-4" /> Choose from my projects
                        <span className="sr-only"> for {s.title}</span>
                      </button>
                    )}
                  </li>
                </ul>
              </Panel>
            );
          })}
          <button
            type="button"
            onClick={() => setSectionDraft({ kind: "custom", title: "" })}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-input py-5 text-sm text-muted-foreground hover:border-primary hover:text-foreground"
          >
            <Plus aria-hidden className="h-4 w-4" /> Add section
          </button>
        </div>
        {preview && data && (
          <div
            className="2xl:sticky 2xl:top-6 2xl:max-h-[calc(100vh-3rem)] 2xl:overflow-y-auto"
            aria-label="Resume preview"
          >
            <ResumeView
              profile={data.profile}
              sections={sections.filter((s) => s.visible)}
              entries={entries}
            />
          </div>
        )}
      </div>

      <Dialog open={!!sectionDraft} onOpenChange={(o) => !o && setSectionDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{sectionDraft?.id ? "Edit section" : "New section"}</DialogTitle>
            <DialogDescription className="sr-only">Section type and title</DialogDescription>
          </DialogHeader>
          {sectionDraft && (
            <div className="space-y-4">
              <Field label="Type">
                <Select
                  value={sectionDraft.kind}
                  onValueChange={(v) =>
                    setSectionDraft({
                      ...sectionDraft,
                      kind: v as Kind,
                      title: sectionDraft.title || KIND_LABEL[v as Kind].split(" (")[0]!,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RESUME_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {KIND_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Title">
                <Input
                  value={sectionDraft.title}
                  onChange={(e) => setSectionDraft({ ...sectionDraft, title: e.target.value })}
                  maxLength={80}
                />
              </Field>
              <div className="flex justify-end">
                <PrimaryButton onClick={saveSection}>Save section</PrimaryButton>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!entry} onOpenChange={(o) => !o && setEntry(null)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{entry?.id ? "Edit entry" : "New entry"}</DialogTitle>
            <DialogDescription className="sr-only">Resume entry details</DialogDescription>
          </DialogHeader>
          {entry && (
            <div className="space-y-4">
              {kindOf(entry.sectionId) === "skills" ? (
                <>
                  <Field label="Group name">
                    <Input
                      value={entry.title ?? ""}
                      onChange={(e) => setEntry({ ...entry, title: e.target.value })}
                      placeholder="Languages"
                    />
                  </Field>
                  <Field label="Skills">
                    <TagInput
                      value={entry.tags ?? []}
                      onChange={(v) => setEntry({ ...entry, tags: v })}
                      placeholder="TypeScript, Python"
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Title / role / degree">
                    <Input
                      value={entry.title ?? ""}
                      onChange={(e) => setEntry({ ...entry, title: e.target.value })}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Organization">
                      <Input
                        value={entry.organization ?? ""}
                        onChange={(e) => setEntry({ ...entry, organization: e.target.value })}
                      />
                    </Field>
                    <Field label="Location">
                      <Input
                        value={entry.location ?? ""}
                        onChange={(e) => setEntry({ ...entry, location: e.target.value })}
                      />
                    </Field>
                    <Field label="Start">
                      <Input
                        value={entry.startDate ?? ""}
                        onChange={(e) => setEntry({ ...entry, startDate: e.target.value })}
                        placeholder="Jan 2024"
                      />
                    </Field>
                    <Field label="End">
                      <Input
                        value={entry.endDate ?? ""}
                        onChange={(e) => setEntry({ ...entry, endDate: e.target.value })}
                        placeholder="Present"
                      />
                    </Field>
                  </div>
                  <Field label="Subtitle (optional)">
                    <Input
                      value={entry.subtitle ?? ""}
                      onChange={(e) => setEntry({ ...entry, subtitle: e.target.value })}
                      placeholder="e.g. GPA, credential ID"
                    />
                  </Field>
                  <Field label="Description" hint="Markdown — use - for bullets">
                    <Textarea
                      rows={6}
                      value={entry.description ?? ""}
                      onChange={(e) => setEntry({ ...entry, description: e.target.value })}
                      className="font-mono text-sm"
                    />
                  </Field>
                  <Field label="Link (optional)">
                    <Input
                      value={entry.link ?? ""}
                      onChange={(e) => setEntry({ ...entry, link: e.target.value })}
                      placeholder="https://"
                    />
                  </Field>
                  <Field label="Tags (optional)">
                    <TagInput
                      value={entry.tags ?? []}
                      onChange={(v) => setEntry({ ...entry, tags: v })}
                    />
                  </Field>
                </>
              )}
              <div className="flex justify-end">
                <PrimaryButton onClick={saveEntry}>Save entry</PrimaryButton>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!pickFor}
        onOpenChange={(o) => {
          if (!o) {
            setPickFor(null);
            setPicked([]);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Choose projects for “{pickFor?.title}”</DialogTitle>
            <DialogDescription>
              Tick the projects to include. They&apos;re copied in as normal entries you can edit
              afterwards, and each project can be added to a section once.
            </DialogDescription>
          </DialogHeader>
          {!projects ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading projects…</p>
          ) : projects.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              You haven&apos;t added any projects yet.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {projects.map((p) => {
                const added = alreadyAdded.has(p.id);
                return (
                  <li key={p.id}>
                    <label
                      className={`flex items-start gap-3 p-3 ${added ? "opacity-60" : "cursor-pointer hover:bg-muted/50"}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-[var(--primary)]"
                        disabled={added}
                        checked={added || picked.includes(p.id)}
                        onChange={() => togglePicked(p.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {p.title}
                          {!p.published && (
                            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-normal">
                              Draft
                            </span>
                          )}
                          {added && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              Already added
                            </span>
                          )}
                        </span>
                        {p.tags.length > 0 && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {p.tags.join(", ")}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex justify-end">
            <PrimaryButton onClick={importPicked} disabled={picked.length === 0}>
              Add {picked.length || ""} project{picked.length === 1 ? "" : "s"}
            </PrimaryButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProfileEditor({ profile }: { profile: ResumeProfile | null }) {
  const qc = useQueryClient();
  const blank = {
    fullName: "",
    headline: "",
    email: "",
    emailPrivacy: "reveal" as string,
    phone: "",
    phonePrivacy: "reveal" as string,
    location: "",
    website: "",
    summary: "",
    links: [] as Social[],
  };
  const [p, setP] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  useEffect(() => {
    if (profile) {
      const { id: _i, updatedAt: _u, ...rest } = profile;
      setP(rest);
      setSaved(JSON.stringify(rest));
    }
  }, [profile]);
  const dirty = saved !== "" && JSON.stringify(p) !== saved;
  const { markSaved } = useUnsavedWarning(dirty);
  const links = p.links ?? [];
  const setLinks = (l: Social[]) => setP({ ...p, links: l });
  const save = async () => {
    setSaving(true);
    const ok = await run(() => adminSaveResumeProfile({ data: p }), "Personal details saved");
    setSaving(false);
    if (ok) {
      markSaved();
      setSaved(JSON.stringify(p));
      qc.invalidateQueries();
    }
  };
  return (
    <Panel
      title="Personal details & summary"
      actions={
        <PrimaryButton onClick={save} disabled={saving}>
          {saving ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <Save aria-hidden className="h-4 w-4" />
          )}{" "}
          Save
        </PrimaryButton>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name">
          <Input value={p.fullName} onChange={(e) => setP({ ...p, fullName: e.target.value })} />
        </Field>
        <Field label="Headline">
          <Input value={p.headline} onChange={(e) => setP({ ...p, headline: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={p.email}
            onChange={(e) => setP({ ...p, email: e.target.value })}
          />
        </Field>
        <Field label="Phone">
          <Input
            type="tel"
            value={p.phone}
            onChange={(e) => setP({ ...p, phone: e.target.value })}
          />
        </Field>
        <Field label="Location">
          <Input value={p.location} onChange={(e) => setP({ ...p, location: e.target.value })} />
        </Field>
        <Field label="Website">
          <Input
            value={p.website}
            onChange={(e) => setP({ ...p, website: e.target.value })}
            placeholder="https://"
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <PrivacySelect
          label="Email on the public resume"
          value={p.emailPrivacy}
          onChange={(v) => setP({ ...p, emailPrivacy: v })}
        />
        <PrivacySelect
          label="Phone on the public resume"
          value={p.phonePrivacy}
          onChange={(v) => setP({ ...p, phonePrivacy: v })}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        The preview below always shows everything; visitors only see what you allow here.
      </p>
      <Field label="Professional summary" hint="Markdown">
        <Textarea
          rows={4}
          value={p.summary}
          onChange={(e) => setP({ ...p, summary: e.target.value })}
        />
      </Field>
      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-sm font-medium">Profile links</legend>
        {links.map((l, i) => (
          <div key={i} className="flex gap-2">
            <Input
              className="w-36"
              aria-label={`Link ${i + 1} label`}
              placeholder="Label"
              value={l.label}
              onChange={(e) =>
                setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
              }
            />
            <Input
              aria-label={`Link ${i + 1} URL`}
              placeholder="https://"
              value={l.url}
              onChange={(e) =>
                setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
              }
            />
            <IconButton
              onClick={() => setLinks(links.filter((_, j) => j !== i))}
              aria-label={`Remove link ${i + 1}`}
            >
              <Trash2 aria-hidden className="h-4 w-4" />
            </IconButton>
          </div>
        ))}
        <GhostButton onClick={() => setLinks([...links, { label: "", url: "" }])}>
          <Plus aria-hidden className="h-4 w-4" /> Add link
        </GhostButton>
      </fieldset>
      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={save}
        label="Save details"
        className="-mx-5 -mb-5 rounded-b-2xl md:-mx-6 md:-mb-6 md:px-6!"
      />
    </Panel>
  );
}
