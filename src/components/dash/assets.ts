import { queryOptions } from "@tanstack/react-query";
import { adminListAssets } from "@/lib/admin.functions";
import { mediaUrl } from "@/lib/images";
import type { Asset } from "@/db/schema";

export const assetsQuery = queryOptions({
  queryKey: ["dash", "assets"],
  queryFn: () => adminListAssets(),
});

export const assetUrl = (a: Pick<Asset, "key">) => mediaUrl(a.key).replace(/%2F/g, "/");

/** Upload to R2 via the Worker. Throws with a readable message on failure. */
export async function uploadFile(file: File, alt = ""): Promise<Asset> {
  const body = new FormData();
  body.set("file", file);
  body.set("alt", alt);
  const res = await fetch("/api/admin/upload", {
    method: "POST",
    body,
    credentials: "same-origin",
  });
  const json = (await res.json().catch(() => ({}))) as { asset?: Asset; error?: string };
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok || !json.asset) throw new Error(json.error ?? "Upload failed");
  return json.asset;
}

export const absoluteUrl = (u: string) =>
  u.startsWith("/") && typeof window !== "undefined" ? window.location.origin + u : u;

export const formatBytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;
