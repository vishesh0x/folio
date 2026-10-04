import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <div className="relative flex min-h-[70vh] items-center justify-center overflow-hidden bg-background px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex select-none items-center justify-center font-display text-[38vw] font-light italic leading-none text-muted/70"
      >
        404
      </div>
      <div className="relative max-w-md text-center">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Error 404</p>
        <h1 className="mt-4 font-display text-5xl font-normal text-foreground md:text-6xl">
          Lost in the <em className="text-primary">margins</em>.
        </h1>
        <p className="mt-4 text-muted-foreground">
          This page wandered off, or maybe it never existed. Let's get you somewhere real.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/" className="btn-primary">
            Back home
          </Link>
          <Link to="/projects" className="btn-ghost">
            See projects
          </Link>
        </div>
      </div>
    </div>
  );
}
