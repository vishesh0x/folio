import { Link, Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  FolderKanban,
  Globe,
  Image as ImageIcon,
  Inbox,
  LayoutDashboard,
  LogOut,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import { ThemedToaster } from "@/components/ThemedToaster";
import { logout } from "@/lib/auth.functions";
import { overviewQuery } from "@/components/dash/queries";
import { ThemeToggle } from "@/lib/theme";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [{ title: "Dashboard · Folio" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: DashLayout,
});

const nav = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/dashboard/site", label: "Site config", icon: Settings },
  { to: "/dashboard/seo", label: "SEO", icon: Search },
  { to: "/dashboard/projects", label: "Projects", icon: FolderKanban },
  { to: "/dashboard/now", label: "Now board", icon: Sparkles },
  { to: "/dashboard/resume", label: "Resume builder", icon: FileText },
  { to: "/dashboard/inbox", label: "Inbox", icon: Inbox },
  { to: "/dashboard/assets", label: "Assets", icon: ImageIcon },
] as const;

function DashLayout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery(overviewQuery);
  const unread = data?.unread ?? 0;

  const signOut = async () => {
    await qc.cancelQueries();
    await logout();
    qc.clear();
    await navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="flex min-h-screen bg-background">
      <ThemedToaster />
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <Link to="/" className="mb-6 px-2 font-display text-xl">
          Folio
          <span className="text-primary" aria-hidden>
            .
          </span>
        </Link>
        <nav aria-label="Dashboard" className="flex-1 space-y-0.5">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: "exact" in n }}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              activeProps={{ className: "!bg-sidebar-accent !text-sidebar-foreground font-medium" }}
            >
              <n.icon aria-hidden className="h-4 w-4" />
              <span className="flex-1">{n.label}</span>
              {n.to === "/dashboard/inbox" && unread > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                  {unread}
                  <span className="sr-only"> unread</span>
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="space-y-1 border-t border-sidebar-border pt-3">
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"
          >
            <Globe aria-hidden className="h-4 w-4" /> View site{" "}
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <div className="flex items-center justify-between px-1">
            <button
              type="button"
              onClick={signOut}
              className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"
            >
              <LogOut aria-hidden className="h-4 w-4" /> Sign out
            </button>
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <nav
          aria-label="Dashboard"
          className="sticky top-0 z-30 flex items-center gap-1 overflow-x-auto border-b border-border bg-background/95 p-2 backdrop-blur md:hidden"
        >
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: "exact" in n }}
              className="shrink-0 rounded-full px-3 py-2 text-sm text-muted-foreground"
              activeProps={{ className: "!bg-muted !text-foreground" }}
            >
              {n.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={signOut}
            className="shrink-0 rounded-full px-3 py-2 text-sm text-muted-foreground"
          >
            Sign out
          </button>
          <ThemeToggle />
        </nav>
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl p-5 md:p-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
