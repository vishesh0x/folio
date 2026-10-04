import { getEnv } from "./env.server";

/** Canonical origin: SITE_URL if configured, else the request's own origin. */
export function siteOrigin(request: Request): string {
  const configured = getEnv().SITE_URL?.trim().replace(/\/+$/, "");
  return configured || new URL(request.url).origin;
}
