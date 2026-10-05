import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { Archive, ArchiveRestore, Mail, MailOpen, Reply, Trash2 } from "lucide-react";
import { run } from "@/components/dash/api";
import { ConfirmButton } from "@/components/dash/ConfirmButton";
import { GhostButton, PageHeader } from "@/components/dash/ui";
import { adminDeleteMessage, adminListMessages, adminPatchMessage } from "@/lib/admin.functions";
import type { ContactMessage } from "@/lib/public.functions";

export const Route = createFileRoute("/_authenticated/dashboard/inbox")({ component: InboxPage });

function InboxPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"inbox" | "unread" | "archived">("inbox");
  const [selected, setSelected] = useState<string | null>(null);
  const { data: msgs = [] } = useQuery({
    queryKey: ["dash", "inbox"],
    queryFn: () => adminListMessages(),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["dash"] });
  const list = msgs.filter((m) =>
    tab === "archived" ? m.archived : !m.archived && (tab === "inbox" || !m.read),
  );
  const current = msgs.find((m) => m.id === selected);
  const unreadCount = msgs.filter((m) => !m.read && !m.archived).length;

  const update = async (m: ContactMessage, patch: { read?: boolean; archived?: boolean }) => {
    await run(() => adminPatchMessage({ data: { id: m.id, ...patch } }));
    refresh();
  };
  const open = (m: ContactMessage) => {
    setSelected(m.id);
    if (!m.read) update(m, { read: true });
  };
  const remove = async (m: ContactMessage) => {
    await run(() => adminDeleteMessage({ data: { id: m.id } }), "Message deleted");
    setSelected(null);
    refresh();
  };

  return (
    <div>
      <PageHeader title="Inbox" description="Messages sent through your contact form." />
      <div role="group" aria-label="Filter messages" className="mb-4 flex gap-1">
        {(["inbox", "unread", "archived"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-2 text-sm capitalize ${tab === t ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
          >
            {t}
            {t === "unread" && ` (${unreadCount})`}
          </button>
        ))}
      </div>
      <div className="grid overflow-hidden rounded-2xl border border-border bg-card lg:h-[calc(100vh-16rem)] lg:grid-cols-[360px_1fr]">
        <ul
          aria-label="Messages"
          className="divide-y divide-border overflow-y-auto border-b border-border lg:border-b-0 lg:border-r"
        >
          {list.length === 0 && (
            <li className="p-10 text-center text-sm text-muted-foreground">Nothing here.</li>
          )}
          {list.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => open(m)}
                aria-current={selected === m.id ? "true" : undefined}
                className={`w-full p-4 text-left transition-colors hover:bg-muted ${selected === m.id ? "bg-muted" : ""}`}
              >
                <div className="flex items-center gap-2">
                  {!m.read && (
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                  )}
                  <span className={`flex-1 truncate text-sm ${m.read ? "" : "font-semibold"}`}>
                    {m.name}
                    {!m.read && <span className="sr-only"> (unread)</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatDistanceToNow(parseISO(m.createdAt), { addSuffix: true })}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-sm">{m.subject || "(no subject)"}</p>
                <p className="truncate text-sm text-muted-foreground">{m.message}</p>
              </button>
            </li>
          ))}
        </ul>
        <div className="overflow-y-auto p-6" aria-live="polite">
          {current ? (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl">{current.subject || "(no subject)"}</h2>
                  <p className="mt-1 text-sm">
                    {current.name} ·{" "}
                    <a href={`mailto:${current.email}`} className="text-primary hover:underline">
                      {current.email}
                    </a>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format(parseISO(current.createdAt), "PPpp")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`mailto:${current.email}?subject=${encodeURIComponent("Re: " + (current.subject || "your message"))}`}
                    className="btn-primary"
                  >
                    <Reply aria-hidden className="h-4 w-4" /> Reply
                  </a>
                  <GhostButton onClick={() => update(current, { read: !current.read })}>
                    {current.read ? (
                      <Mail aria-hidden className="h-4 w-4" />
                    ) : (
                      <MailOpen aria-hidden className="h-4 w-4" />
                    )}
                    {current.read ? "Mark unread" : "Mark read"}
                  </GhostButton>
                  <GhostButton onClick={() => update(current, { archived: !current.archived })}>
                    {current.archived ? (
                      <ArchiveRestore aria-hidden className="h-4 w-4" />
                    ) : (
                      <Archive aria-hidden className="h-4 w-4" />
                    )}
                    {current.archived ? "Unarchive" : "Archive"}
                  </GhostButton>
                  <ConfirmButton title="Delete this message?" onConfirm={() => remove(current)}>
                    <GhostButton aria-label="Delete message">
                      <Trash2 aria-hidden className="h-4 w-4" />
                    </GhostButton>
                  </ConfirmButton>
                </div>
              </div>
              <p className="mt-6 whitespace-pre-wrap break-words leading-relaxed">
                {current.message}
              </p>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a message to read it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
