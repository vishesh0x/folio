import { useCallback, useEffect, useState, type ReactNode } from "react";
import { revealContact, type RevealField } from "@/lib/reveal.functions";
import { useTurnstile } from "@/lib/turnstile";

/**
 * A contact detail that isn't in the page source. The visitor clicks to show it; the value is
 * then fetched from the server (rate-limited, and checked with Turnstile when configured).
 */
export function RevealContact({
  field,
  kind,
  siteKey,
  className = "",
  buttonClassName = "link-underline py-1 font-medium",
  icon,
}: {
  field: RevealField;
  kind: "email" | "phone";
  /** Turnstile site key (null when Turnstile isn't configured). */
  siteKey: string | null;
  className?: string;
  buttonClassName?: string;
  /** Rendered before the value; hidden together with the button when printing. */
  icon?: ReactNode;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");

  const fetchValue = useCallback(
    async (token: string) => {
      try {
        const r = await revealContact({ data: { field, turnstileToken: token } });
        setValue(r.value);
      } catch (e) {
        const m = e instanceof Error ? e.message : "";
        setError(m && m.length < 160 ? m : "Couldn't load that. Please try again.");
      } finally {
        setBusy(false);
        setActive(false);
      }
    },
    [field],
  );

  // `interaction-only`: the widget stays invisible unless Cloudflare needs a human check.
  const ts = useTurnstile(
    siteKey,
    active,
    (t) => {
      if (t) void fetchValue(t);
    },
    { appearance: "interaction-only" },
  );

  // Don't hang on "Checking…" if the spam-check script is blocked or never answers.
  useEffect(() => {
    if (!busy || !active) return;
    const stop = (msg: string) => {
      setBusy(false);
      setActive(false);
      setError(msg);
    };
    if (ts.failed) {
      stop(
        "The spam check couldn't load. Check your connection or content blockers and try again.",
      );
      return;
    }
    const t = setTimeout(() => stop("That took too long. Please try again."), 20_000);
    return () => clearTimeout(t);
  }, [busy, active, ts.failed]);

  const onClick = () => {
    setError("");
    setBusy(true);
    if (siteKey) {
      ts.dispose(); // fresh widget (and token) every time
      setActive(true);
    } else void fetchValue("");
  };

  const label = kind === "email" ? "Show email address" : "Show phone number";
  return (
    <span
      className={`inline-flex max-w-full flex-wrap items-center gap-x-1.5 ${value ? "" : "print:hidden"} ${className}`}
      aria-live="polite"
    >
      {icon}
      {value ? (
        kind === "email" ? (
          <a href={`mailto:${value}`} className="link-underline py-0.5 font-medium">
            {value}
          </a>
        ) : (
          <a href={`tel:${value.replace(/[^\d+]/g, "")}`} className="py-0.5 hover:underline">
            {value}
          </a>
        )
      ) : (
        <>
          <button
            type="button"
            onClick={onClick}
            disabled={busy}
            className={`${buttonClassName} whitespace-nowrap print:hidden disabled:opacity-60`}
          >
            {busy ? "Checking…" : label}
          </button>
          {siteKey && <span ref={ts.host} className="inline-block align-middle" />}
          {error && (
            <span role="alert" className="w-full text-sm text-destructive">
              {error}
            </span>
          )}
        </>
      )}
    </span>
  );
}
