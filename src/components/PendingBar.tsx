/** Shown by the router when a navigation takes longer than ~200 ms. */
export function PendingBar() {
  return (
    <div role="status" aria-live="polite" className="mx-auto max-w-5xl px-5 py-16">
      <span className="sr-only">Loading…</span>
      <div aria-hidden className="animate-pulse space-y-4">
        <div className="h-3 w-24 rounded bg-muted" />
        <div className="h-12 w-2/3 rounded bg-muted" />
        <div className="h-4 w-1/2 rounded bg-muted" />
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          <div className="h-56 rounded-2xl bg-muted" />
          <div className="h-56 rounded-2xl bg-muted" />
        </div>
      </div>
    </div>
  );
}
