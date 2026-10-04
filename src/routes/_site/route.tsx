import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Menu } from "lucide-react";
import { useState } from "react";
import { SafeLink } from "@/components/SafeLink";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { siteQuery } from "@/lib/queries";
import { ThemeToggle } from "@/lib/theme";

export const Route = createFileRoute("/_site")({ component: SiteLayout });

const nav = [
  { to: "/projects", label: "Projects" },
  { to: "/now", label: "Now" },
  { to: "/resume", label: "Resume" },
  { to: "/contact", label: "Contact" },
] as const;

const navLink =
  "rounded-full px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground";
const navActive = "bg-muted text-foreground";

function SiteLayout() {
  const { data } = useQuery(siteQuery);
  const cfg = data?.config;
  const socials = cfg?.socials ?? [];
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="no-print sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-5">
          <Link
            to="/"
            className="font-display text-xl font-medium tracking-tight"
            aria-label={`${cfg?.name ?? "Home"} — home`}
          >
            {cfg?.name?.split(" ")[0] ?? "Home"}
            <span className="text-primary" aria-hidden>
              .
            </span>
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={navLink}
                activeProps={{ className: `${navLink} ${navActive}` }}
              >
                {n.label}
              </Link>
            ))}
            <div className="ml-2">
              <ThemeToggle />
            </div>
          </nav>

          <div className="flex items-center gap-2 md:hidden">
            <ThemeToggle />
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger
                aria-label="Open menu"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border hover:bg-muted"
              >
                <Menu className="h-5 w-5" aria-hidden />
              </SheetTrigger>
              <SheetContent side="right" className="w-72">
                <SheetTitle className="font-display text-xl">Menu</SheetTitle>
                <SheetDescription className="sr-only">Site navigation</SheetDescription>
                <nav aria-label="Mobile" className="mt-6 flex flex-col gap-1">
                  {nav.map((n) => (
                    <Link
                      key={n.to}
                      to={n.to}
                      onClick={() => setOpen(false)}
                      className="rounded-lg px-3 py-3 text-base text-muted-foreground hover:bg-muted hover:text-foreground"
                      activeProps={{
                        className: "rounded-lg px-3 py-3 text-base bg-muted text-foreground",
                      }}
                    >
                      {n.label}
                    </Link>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1">
        <Outlet />
      </main>

      <footer className="no-print border-t border-border/60">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-10 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <p>
            © {new Date().getFullYear()} {cfg?.name ?? ""}.{" "}
            {cfg?.location ? `Made in ${cfg.location}.` : ""}
          </p>
          {socials.length > 0 && (
            <ul className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Social links">
              {socials.map((s) => (
                <li key={s.url + s.label}>
                  <SafeLink href={s.url} className="link-underline py-1 hover:text-foreground">
                    {s.label}
                  </SafeLink>
                </li>
              ))}
            </ul>
          )}
        </div>
      </footer>
    </div>
  );
}
