import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { DefaultCatchBoundary } from "./components/DefaultCatchBoundary";
import { NotFound } from "./components/NotFound";
import { PendingBar } from "./components/PendingBar";
import { routeTree } from "./routeTree.gen";

/** CSP nonce for this request (set by src/server.ts); undefined in the browser. */
const getNonce = createIsomorphicFn()
  .server(() => {
    try {
      return getRequest().headers.get("x-csp-nonce") ?? undefined;
    } catch {
      return undefined;
    }
  })
  .client(() => undefined);

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultPendingMs: 200,
    defaultPendingMinMs: 300,
    defaultPendingComponent: PendingBar,
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: NotFound,
    ssr: { nonce: getNonce() },
  });

  setupRouterSsrQueryIntegration({ router, queryClient, wrapQueryClient: false });
  return router;
};
