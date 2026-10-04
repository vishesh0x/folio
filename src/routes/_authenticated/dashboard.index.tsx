import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, parseISO } from "date-fns";
import {
  AlertTriangle,
  FileText,
  FolderKanban,
  Image as ImageIcon,
  Inbox,
  Plus,
  Sparkles,
} from "lucide-react";
import { PageHeader, Panel } from "@/components/dash/ui";
import { overviewQuery } from "@/components/dash/queries";

export const Route = createFileRoute("/_authenticated/dashboard/")({ component: Overview });

function Overview() {
  const { data } = useQuery(overviewQuery);
  const stats = [
    {
      label: "Projects",
      value: data?.projects,
      sub: `${data?.published ?? 0} published`,
      icon: FolderKanban,
      to: "/dashboard/projects",
    },
    {
      label: "Doing now",
      value: data?.nowDoing,
      sub: "active items",
      icon: Sparkles,
      to: "/dashboard/now",
    },
    { label: "Unread", value: data?.unread, sub: "messages", icon: Inbox, to: "/dashboard/inbox" },
    {
      label: "Assets",
      value: data?.assets,
      sub: "files",
      icon: ImageIcon,
      to: "/dashboard/assets",
    },
    {
      label: "Resume",
      value: data?.entries,
      sub: "entries",
      icon: FileText,
      to: "/dashboard/resume",
    },
  ] as const;

  const warnings: { text: string; to?: string }[] = [];
  if (data?.missingAlt)
    warnings.push({
      text: `${data.missingAlt} uploaded image(s) have no alt text.`,
      to: "/dashboard/assets",
    });
  if (data?.setupWarnings.noSiteUrl)
    warnings.push({
      text: "SITE_URL isn't set in wrangler.jsonc, so canonical/OG URLs use the request origin.",
    });
  if (data?.setupWarnings.emailPublic)
    warnings.push({
      text: "Your email is shown as plain text on the site, so scrapers can harvest it. Switch it to “click to reveal” in Site config.",
      to: "/dashboard/site",
    });
  if (data?.setupWarnings.noTurnstile)
    warnings.push({
      text: "Turnstile isn't configured; the contact form relies on the honeypot + rate limit only.",
    });

  return (
    <div>
      <PageHeader
        title={`Hello${data?.name ? `, ${data.name.split(" ")[0]}` : ""}`}
        description="Here's what's happening across your site."
        actions={
          <Link to="/dashboard/projects/$id" params={{ id: "new" }} className="btn-primary">
            <Plus aria-hidden className="h-4 w-4" /> New project
          </Link>
        }
      />
      <ul className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {stats.map((s) => (
          <li key={s.label}>
            <Link
              to={s.to}
              className="group block rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
            >
              <s.icon
                aria-hidden
                className="h-5 w-5 text-muted-foreground group-hover:text-primary"
              />
              <p className="mt-4 font-display text-4xl">{s.value ?? "–"}</p>
              <p className="mt-1 text-sm font-medium">{s.label}</p>
              <p className="text-xs text-muted-foreground">{s.sub}</p>
            </Link>
          </li>
        ))}
      </ul>

      {warnings.length > 0 && (
        <section
          aria-label="Suggestions"
          className="mt-8 rounded-2xl border border-border bg-card p-5"
        >
          <h2 className="flex items-center gap-2 font-display text-lg">
            <AlertTriangle aria-hidden className="h-4 w-4 text-primary" /> Worth a look
          </h2>
          <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
            {warnings.map((w) => (
              <li key={w.text}>
                {w.to ? (
                  <Link to={w.to} className="underline hover:text-foreground">
                    {w.text}
                  </Link>
                ) : (
                  w.text
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Panel
          title="Recent messages"
          actions={
            <Link to="/dashboard/inbox" className="py-1 text-sm text-primary">
              Open inbox →
            </Link>
          }
        >
          {data?.recent.length === 0 && (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          )}
          <ul className="divide-y divide-border">
            {data?.recent.map((m) => (
              <li key={m.id} className="flex items-start gap-3 py-3">
                <span
                  aria-hidden
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${m.read ? "bg-transparent" : "bg-primary"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2">
                    <p className="truncate text-sm font-medium">
                      {m.name}
                      {!m.read && <span className="sr-only"> (unread)</span>}
                    </p>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDistanceToNow(parseISO(m.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{m.subject || m.message}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Quick links">
          <ul className="grid gap-2 text-sm">
            {(
              [
                ["/dashboard/site", "Update name, email & socials"],
                ["/dashboard/seo", "Edit page titles & descriptions"],
                ["/dashboard/now", "Update what you're doing now"],
                ["/dashboard/resume", "Edit your resume"],
                ["/dashboard/assets", "Upload images & files"],
              ] as const
            ).map(([to, label]) => (
              <li key={to}>
                <Link
                  to={to}
                  className="block rounded-lg border border-border px-3 py-2.5 hover:bg-muted"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
