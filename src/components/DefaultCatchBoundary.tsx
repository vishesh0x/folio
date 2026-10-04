import { Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";

/**
 * Generic error UI. The raw error is logged for the developer but never shown
 * to visitors (it can contain internals).
 */
export function DefaultCatchBoundary({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  console.error(error);
  return (
    <div role="alert" className="flex min-h-[60vh] items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-3xl text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try again or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="btn-primary"
          >
            Try again
          </button>
          <Link to="/" className="btn-ghost">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
