import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertTriangle,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  Save,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Img } from "@/components/Img";
import { errMsg, run } from "@/components/dash/api";
import {
  absoluteUrl,
  assetUrl,
  assetsQuery,
  formatBytes,
  uploadFile,
} from "@/components/dash/assets";
import { ConfirmButton } from "@/components/dash/ConfirmButton";
import { IconButton, PageHeader } from "@/components/dash/ui";
import { Input } from "@/components/ui/input";
import { adminDeleteAsset, adminPatchAsset } from "@/lib/admin.functions";
import type { Asset } from "@/db/schema";

export const Route = createFileRoute("/_authenticated/dashboard/assets")({ component: AssetsPage });

function AssetsPage() {
  const qc = useQueryClient();
  const { data: assets = [] } = useQuery(assetsQuery);
  const [busy, setBusy] = useState(0);
  const [drag, setDrag] = useState(false);
  const [q, setQ] = useState("");

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const arr = Array.from(files);
    setBusy(arr.length);
    let ok = 0;
    for (const f of arr) {
      try {
        await uploadFile(f);
        ok++;
      } catch (e) {
        toast.error(`${f.name}: ${errMsg(e)}`);
      }
      setBusy((b) => b - 1);
    }
    qc.invalidateQueries({ queryKey: ["dash"] });
    if (ok) toast.success(`${ok} file(s) uploaded — remember to add alt text to images.`);
  };

  const remove = async (a: Asset, force = false) => {
    const res = await run(() => adminDeleteAsset({ data: { id: a.id, force } }));
    if (!res) return;
    if (!res.deleted) {
      toast.warning(`“${a.name}” is used in: ${res.usedIn.join(", ")}. Delete again to confirm.`, {
        action: { label: "Delete anyway", onClick: () => remove(a, true) },
        duration: 10000,
      });
      return;
    }
    toast.success("Asset deleted");
    qc.invalidateQueries({ queryKey: ["dash"] });
  };

  const copy = async (a: Asset) => {
    try {
      await navigator.clipboard.writeText(absoluteUrl(assetUrl(a)));
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't access the clipboard");
    }
  };

  const list = assets.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Assets"
        description="Files live in Cloudflare R2. Images are resized and converted to AVIF/WebP automatically when shown on the site."
        actions={
          <div className="relative">
            <label htmlFor="asset-search" className="sr-only">
              Search files
            </label>
            <Search
              aria-hidden
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="asset-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search files"
              className="w-56 pl-9"
            />
          </div>
        }
      />
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          upload(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center transition-colors focus-within:border-primary ${drag ? "border-primary bg-primary/5" : "border-input hover:border-primary/60"}`}
      >
        {busy ? (
          <Loader2 aria-hidden className="h-6 w-6 animate-spin text-primary" />
        ) : (
          <Upload aria-hidden className="h-6 w-6 text-muted-foreground" />
        )}
        <span className="font-medium" role="status">
          {busy ? `Uploading ${busy} file(s)…` : "Drop files here or click to upload"}
        </span>
        <span className="text-xs text-muted-foreground">
          PNG, JPEG, WebP, AVIF, GIF, ICO or PDF · up to 10 MB each
        </span>
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/avif,image/gif,image/x-icon,application/pdf"
          className="sr-only"
          onChange={(e) => {
            upload(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {list.map((a) => (
          <AssetCard key={a.id} a={a} onCopy={() => copy(a)} onDelete={() => remove(a)} />
        ))}
      </ul>
      {list.length === 0 && (
        <p className="mt-10 text-center text-sm text-muted-foreground">No files yet.</p>
      )}
    </div>
  );
}

function AssetCard({
  a,
  onCopy,
  onDelete,
}: {
  a: Asset;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const [alt, setAlt] = useState(a.alt);
  const isImage = a.mime.startsWith("image/");
  const saveAlt = async () => {
    if (alt === a.alt) return;
    const ok = await run(() => adminPatchAsset({ data: { id: a.id, alt } }), "Alt text saved");
    if (ok) qc.invalidateQueries({ queryKey: ["dash", "assets"] });
  };
  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex aspect-square items-center justify-center bg-muted">
        {isImage ? (
          <Img
            src={assetUrl(a)}
            alt={a.alt || a.name}
            maxWidth={480}
            sizes="(min-width: 1024px) 240px, 45vw"
            className="h-full w-full object-cover"
          />
        ) : (
          <FileText aria-hidden className="h-10 w-10 text-muted-foreground" />
        )}
      </div>
      <div className="space-y-2 p-2.5">
        <p className="truncate text-sm font-medium" title={a.name}>
          {a.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(a.size)}
          {a.width && a.height ? ` · ${a.width}×${a.height}` : ""}
        </p>
        {isImage && (
          <div>
            <label htmlFor={`alt-${a.id}`} className="sr-only">
              Alt text for {a.name}
            </label>
            <div className="flex gap-1">
              <Input
                id={`alt-${a.id}`}
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
                onBlur={saveAlt}
                placeholder="Alt text"
                maxLength={300}
                aria-invalid={!alt.trim()}
                className="h-9 text-xs"
              />
              <IconButton aria-label={`Save alt text for ${a.name}`} onClick={saveAlt}>
                <Save aria-hidden className="h-4 w-4" />
              </IconButton>
            </div>
            {!alt.trim() && (
              <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                <AlertTriangle aria-hidden className="h-3 w-3" /> Missing alt text
              </p>
            )}
          </div>
        )}
        <div className="flex gap-1">
          <IconButton onClick={onCopy} aria-label={`Copy link to ${a.name}`}>
            <Copy aria-hidden className="h-4 w-4" />
          </IconButton>
          <a
            href={assetUrl(a)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            aria-label={`Open ${a.name} in a new tab`}
            title="Open"
          >
            <ExternalLink aria-hidden className="h-4 w-4" />
          </a>
          <ConfirmButton
            title={`Delete ${a.name}?`}
            description="The file is removed from R2. Pages still using it will show a placeholder."
            onConfirm={onDelete}
          >
            <IconButton aria-label={`Delete ${a.name}`} className="ml-auto hover:text-destructive">
              <Trash2 aria-hidden className="h-4 w-4" />
            </IconButton>
          </ConfirmButton>
        </div>
      </div>
    </li>
  );
}
