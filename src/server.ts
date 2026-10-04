import { renderErrorPage } from "./lib/error-page";
import { handleMedia } from "./server/media.server";
import type { AppEnv } from "./server/env.server";
import { applySecurityHeaders, randomNonce } from "./server/security.server";

/**
 * Worker entry point.
 *
 *  /media/*  → R2 + Cloudflare Images pipeline (bypasses the React app)
 *  anything else → TanStack Start (SSR, server functions, server routes)
 *
 * Every response gets security headers; HTML gets a nonce-based CSP.
 */
type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;
function getServerEntry(): Promise<ServerEntry> {
  serverEntryPromise ??= import("@tanstack/react-start/server-entry").then(
    (m) => (m.default ?? m) as ServerEntry,
  );
  return serverEntryPromise;
}

const errorResponse = () =>
  new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

// h3 swallows in-handler throws into a JSON 500 ({"unhandled":true,...}); catch
// that shape so visitors see the friendly page instead of raw JSON.
async function normalizeSwallowedError(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) return response;
  const body = await response.clone().text();
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    if (payload.unhandled === true && payload.message === "HTTPError") {
      console.error(`SSR error swallowed by h3: ${body}`);
      return errorResponse();
    }
  } catch {
    /* not the h3 shape */
  }
  return response;
}

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    const prod = import.meta.env.PROD;
    const url = new URL(request.url);

    if (url.pathname.startsWith("/media/")) {
      const res = await handleMedia(request, env, ctx).catch((err) => {
        console.error("media error", err);
        return new Response("Server error", { status: 500 });
      });
      return applySecurityHeaders(res, { request, prod });
    }

    // The nonce travels to SSR in a request header (always overwritten, so a
    // client can't choose its own) and is read back in `getRouter()`.
    const nonce = randomNonce();
    const headers = new Headers(request.headers);
    headers.set("x-csp-nonce", nonce);
    const inner = new Request(request, { headers });

    let response: Response;
    try {
      const handler = await getServerEntry();
      response = await normalizeSwallowedError(await handler.fetch(inner, env, ctx));
    } catch (error) {
      console.error(error);
      response = errorResponse();
    }
    return applySecurityHeaders(response, {
      request,
      nonce,
      turnstile: !!env.TURNSTILE_SITE_KEY,
      prod,
    });
  },
};
