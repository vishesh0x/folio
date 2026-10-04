import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { siteQuery } from "@/lib/queries";
import { ThemeProvider, themeScript, useTheme } from "@/lib/theme";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: async ({ context }) => {
    try {
      const d = await context.queryClient.ensureQueryData(siteQuery);
      return {
        favicon: d.config?.faviconUrl ?? null,
        name: d.config?.name ?? "",
        origin: d.origin,
      };
    } catch (e) {
      console.error("root loader failed", e);
      return { favicon: null, name: "", origin: "" };
    }
  },
  head: ({ loaderData }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      // One tag only: TanStack de-duplicates <meta name>, so media variants would collapse.
      { name: "theme-color", content: "#9a4526" },
      { name: "color-scheme", content: "light dark" },
      ...(loaderData?.name ? [{ property: "og:site_name", content: loaderData.name }] : []),
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      loaderData?.favicon
        ? { rel: "icon", href: loaderData.favicon }
        : { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  const nonce = useRouter().options.ssr?.nonce;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Theme is applied before paint to avoid a flash; allowed by the CSP nonce. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
        <HeadContent />
      </head>
      <body>
        <a
          href="#main-content"
          className="sr-only-focusable fixed left-3 top-3 z-[100] rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Skip to content
        </a>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/** After a client-side navigation, move focus to <main> so keyboard/screen-reader users land on the new page. */
function RouteFocus() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [path]);
  return null;
}

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} />;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Outlet />
        <RouteFocus />
        <ThemedToaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
