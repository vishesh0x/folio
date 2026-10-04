import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ImageField, AssetPicker } from "@/components/dash/AssetPicker";
import { run } from "@/components/dash/api";
import {
  Field,
  GhostButton,
  IconButton,
  PageHeader,
  Panel,
  PrimaryButton,
  PrivacySelect,
  useUnsavedWarning,
} from "@/components/dash/ui";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { adminGetSite, adminSaveSite } from "@/lib/admin.functions";
import { changePassword } from "@/lib/auth.functions";
import { MIN_PASSWORD } from "@/lib/constants";
import type { SiteConfig, Social } from "@/lib/public.functions";

export const Route = createFileRoute("/_authenticated/dashboard/site")({ component: SitePage });

function SitePage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data } = useQuery({ queryKey: ["dash", "site_config"], queryFn: () => adminGetSite() });
  const [c, setC] = useState<SiteConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedWarning(dirty);
  useEffect(() => {
    if (data) setC(data);
  }, [data]);
  if (!c) return <Loader2 aria-label="Loading" className="h-5 w-5 animate-spin" />;

  const set = <K extends keyof SiteConfig>(k: K, v: SiteConfig[K]) => {
    setC({ ...c, [k]: v });
    setDirty(true);
  };
  const socials = c.socials ?? [];
  const setSocials = (s: Social[]) => set("socials", s);

  const save = async () => {
    setSaving(true);
    const { id: _id, updatedAt: _u, ...rest } = c;
    const ok = await run(() => adminSaveSite({ data: rest }), "Site settings saved");
    setSaving(false);
    if (ok) {
      setDirty(false);
      qc.invalidateQueries();
      // The favicon lives in the root route's <head>; re-run loaders so it updates right away.
      router.invalidate();
    }
  };

  return (
    <div>
      <PageHeader
        title="Site config"
        description="Details shown on your home page and shared across the site."
        actions={
          <PrimaryButton onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            ) : (
              <Save aria-hidden className="h-4 w-4" />
            )}{" "}
            Save changes
          </PrimaryButton>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Identity">
          <Field label="Name">
            <Input value={c.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Role / title">
            <Input value={c.role} onChange={(e) => set("role", e.target.value)} />
          </Field>
          <Field label="Tagline" hint="Big line on the home page">
            <Input value={c.tagline} onChange={(e) => set("tagline", e.target.value)} />
          </Field>
          <Field label="Short bio" hint="Markdown supported">
            <Textarea rows={5} value={c.bio} onChange={(e) => set("bio", e.target.value)} />
          </Field>
          <Field label="Profile photo">
            <ImageField
              url={c.avatarUrl}
              alt={c.avatarAlt}
              onChange={(n) => {
                setC({ ...c, avatarUrl: n.url, avatarAlt: n.alt ?? "" });
                setDirty(true);
              }}
            />
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p id="avail-label" className="text-sm font-medium">
                Open to opportunities
              </p>
              <p className="text-xs text-muted-foreground">Shows a green badge on the home page</p>
            </div>
            <Switch
              aria-labelledby="avail-label"
              checked={c.available}
              onCheckedChange={(v) => set("available", v)}
            />
          </div>
        </Panel>
        <div className="space-y-6">
          <Panel title="Contact">
            <Field label="Email">
              <Input type="email" value={c.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
            <PrivacySelect
              label="Email on the public site"
              value={c.emailPrivacy}
              onChange={(v) => set("emailPrivacy", v)}
            />
            <Field label="Location">
              <Input value={c.location} onChange={(e) => set("location", e.target.value)} />
            </Field>
          </Panel>
          <Panel title="Files">
            <Field label="Resume (PDF)" hint="Used by the Download button">
              <AssetPicker
                accept="application/pdf"
                value={c.resumeUrl}
                onChange={(v) => set("resumeUrl", v)}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Anything inside this PDF is public and can be scraped. If your email or phone is set
                to “click to reveal”, upload a version of the PDF without them.
              </p>
            </Field>
            <Field label="Favicon" hint="Optional — Folio's icon is the default">
              <AssetPicker
                value={c.faviconUrl}
                onChange={(v, a) => {
                  set("faviconUrl", v);
                  if (
                    a?.width &&
                    a.height &&
                    Math.abs(a.width - a.height) / Math.max(a.width, a.height) > 0.05
                  ) {
                    toast.warning(
                      `That image is ${a.width}×${a.height}. Favicons look best when square — otherwise browsers will squash it.`,
                    );
                  }
                }}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Use a simple, square PNG (512×512 or larger) or an SVG. PNGs are resized
                automatically for the browser tab, home-screen and app icons; an SVG is used as-is
                for the tab (no iOS home-screen icon). The default Folio icon is no longer sent once
                you upload one.
              </p>
            </Field>
          </Panel>
          <Panel title="Default meta">
            <Field label="Meta title">
              <Input value={c.metaTitle} onChange={(e) => set("metaTitle", e.target.value)} />
            </Field>
            <Field label="Meta description">
              <Textarea
                rows={3}
                value={c.metaDescription}
                onChange={(e) => set("metaDescription", e.target.value)}
              />
            </Field>
            <Field label="Default share image">
              <AssetPicker noSvg value={c.ogImage} onChange={(v) => set("ogImage", v)} />
            </Field>
          </Panel>
        </div>
        <div className="lg:col-span-2">
          <Panel
            title="Social links"
            actions={
              <GhostButton onClick={() => setSocials([...socials, { label: "", url: "" }])}>
                <Plus aria-hidden className="h-4 w-4" /> Add link
              </GhostButton>
            }
          >
            {socials.length === 0 && <p className="text-sm text-muted-foreground">No links yet.</p>}
            {socials.map((s, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  className="w-40"
                  aria-label={`Link ${i + 1} label`}
                  placeholder="Label"
                  value={s.label}
                  onChange={(e) =>
                    setSocials(
                      socials.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                    )
                  }
                />
                <Input
                  aria-label={`Link ${i + 1} URL`}
                  placeholder="https://"
                  value={s.url}
                  onChange={(e) =>
                    setSocials(socials.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                  }
                />
                <IconButton
                  onClick={() => setSocials(socials.filter((_, j) => j !== i))}
                  aria-label={`Remove link ${i + 1}`}
                >
                  <Trash2 aria-hidden className="h-4 w-4" />
                </IconButton>
              </div>
            ))}
          </Panel>
        </div>
        <div className="lg:col-span-2">
          <PasswordPanel />
        </div>
      </div>
    </div>
  );
}

function PasswordPanel() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await run(
      () => changePassword({ data: { current, next } }),
      "Password changed. Other devices were signed out.",
    );
    setBusy(false);
    if (ok) {
      setCurrent("");
      setNext("");
    }
  };
  return (
    <Panel title="Change password">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Current password">
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field label="New password" hint={`min ${MIN_PASSWORD} chars`}>
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <PrimaryButton type="submit" disabled={busy}>
          {busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />} Update
        </PrimaryButton>
      </form>
    </Panel>
  );
}
