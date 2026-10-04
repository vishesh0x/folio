import { toast } from "sonner";

/** Turn server-function errors (including zod issue arrays) into one readable line. */
export function errMsg(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (raw === "UNAUTHORIZED") return "Your session expired. Please sign in again.";
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      const issues = JSON.parse(raw) as { message?: string; path?: (string | number)[] }[];
      if (Array.isArray(issues)) {
        return issues
          .map((i) => `${i.path?.length ? i.path.join(".") + ": " : ""}${i.message}`)
          .join("; ");
      }
    } catch {
      /* fall through */
    }
  }
  return raw.length > 200 ? "Something went wrong. Please try again." : raw;
}

/** Run an admin action: toast failures, bounce to /auth when the session is gone. */
export async function run<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const out = await fn();
    if (success) toast.success(success);
    return out;
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") {
      window.location.assign("/auth");
      return undefined;
    }
    toast.error(errMsg(e));
    return undefined;
  }
}

/** Swap two neighbours and return the new id order. */
export function reorderIds<T extends { id: string }>(
  list: T[],
  i: number,
  dir: -1 | 1,
): string[] | null {
  if (!list[i + dir]) return null;
  const l = [...list];
  [l[i], l[i + dir]] = [l[i + dir]!, l[i]!];
  return l.map((x) => x.id);
}
