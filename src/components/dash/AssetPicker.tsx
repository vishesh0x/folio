import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, ImageIcon, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Img } from "@/components/Img";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Asset } from "@/db/schema";
import { assetUrl, assetsQuery, uploadFile } from "./assets";
import { errMsg } from "./api";

type PickerProps = {
  id?: string;
  value: string | null | undefined;
  onChange: (url: string | null, asset?: Asset) => void;
  accept?: string;
  placeholder?: string;
  /** Social-share image: SVG is hidden/refused (platforms can't render it). */
  noSvg?: boolean;
};

/** URL box + "Choose" dialog backed by the R2 asset library. */
export function AssetPicker({
  id,
  value,
  onChange,
  accept = "image/*",
  placeholder = "Paste an https URL or choose a file",
  noSvg = false,
}: PickerProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alt, setAlt] = useState("");
  const altId = useId();
  const qc = useQueryClient();
  const { data: assets = [] } = useQuery({ ...assetsQuery, enabled: open });
  const isImage = accept.startsWith("image");
  const list = assets.filter(
    (a) =>
      (isImage ? a.mime.startsWith("image") : a.mime === accept || accept === "*") &&
      !(noSvg && a.mime === "image/svg+xml"),
  );
  const imageTypes = `image/png,image/jpeg,image/webp,image/avif,image/gif,image/x-icon${noSvg ? "" : ",image/svg+xml"}`;

  const onUpload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const a = await uploadFile(f, alt);
      qc.invalidateQueries({ queryKey: ["dash", "assets"] });
      onChange(assetUrl(a), a);
      setAlt("");
      setOpen(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {value && isImage && (
        <Img
          src={value}
          alt=""
          maxWidth={160}
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 rounded-md border border-border object-cover"
        />
      )}
      <Input
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        placeholder={placeholder}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          aria-label="Clear file"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-ghost shrink-0 !rounded-md !px-3 !py-2"
      >
        Choose
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Choose a file</DialogTitle>
            <DialogDescription>
              Pick from your library or upload a new file to R2.
            </DialogDescription>
          </DialogHeader>
          {isImage && (
            <div className="space-y-1.5">
              <Label htmlFor={altId}>Alt text for a new upload</Label>
              <Input
                id={altId}
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
                placeholder="Describe what the image shows"
                maxLength={300}
              />
            </div>
          )}
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-input p-6 text-sm text-muted-foreground focus-within:border-primary hover:border-primary hover:text-foreground">
            {busy ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            ) : (
              <Upload aria-hidden className="h-4 w-4" />
            )}
            {busy ? "Uploading…" : "Upload new file"}
            <input
              type="file"
              accept={accept === "image/*" ? imageTypes : accept}
              className="sr-only"
              disabled={busy}
              onChange={(e) => onUpload(e.target.files?.[0])}
            />
          </label>
          <ul className="grid max-h-80 grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4">
            {list.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(assetUrl(a), a);
                    setOpen(false);
                  }}
                  className="group w-full overflow-hidden rounded-lg border border-border text-left hover:border-primary"
                >
                  <div className="flex aspect-square items-center justify-center bg-muted">
                    {a.mime.startsWith("image") ? (
                      <Img
                        src={assetUrl(a)}
                        alt={a.alt || a.name}
                        maxWidth={320}
                        sizes="160px"
                        className="h-full w-full object-cover"
                      />
                    ) : a.mime.includes("pdf") ? (
                      <FileText aria-hidden className="h-8 w-8 text-muted-foreground" />
                    ) : (
                      <ImageIcon aria-hidden className="h-8 w-8 text-muted-foreground" />
                    )}
                  </div>
                  <span className="block truncate px-2 py-1 text-xs">{a.name}</span>
                </button>
              </li>
            ))}
            {list.length === 0 && (
              <li className="col-span-full py-6 text-center text-sm text-muted-foreground">
                No files yet.
              </li>
            )}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Image picker + alt text in one control. Alt text is prefilled from the asset
 * library and flagged when missing, so no image ships without a description.
 */
export function ImageField({
  id,
  url,
  alt,
  onChange,
}: {
  id?: string;
  url: string | null | undefined;
  alt?: string;
  onChange: (next: { url: string | null; alt?: string }) => void;
}) {
  const altId = useId();
  const hasAlt = alt !== undefined;
  return (
    <div className="space-y-2">
      <AssetPicker
        id={id}
        value={url}
        onChange={(u, asset) =>
          onChange({ url: u, alt: hasAlt ? alt || asset?.alt || "" : undefined })
        }
      />
      {hasAlt && url && (
        <div className="space-y-1">
          <Label htmlFor={altId} className="text-xs text-muted-foreground">
            Alt text (describes the image for screen readers)
          </Label>
          <Input
            id={altId}
            value={alt}
            maxLength={300}
            aria-invalid={!alt.trim()}
            onChange={(e) => onChange({ url, alt: e.target.value })}
            placeholder="e.g. Portrait of me smiling in front of a bookshelf"
          />
          {!alt.trim() && (
            <p className="text-xs text-destructive">
              Add alt text — a fallback will be used until you do.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
