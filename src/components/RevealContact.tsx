import { useCallback, useState } from "react";
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
}: {
  field: RevealField;
  kind: "email" | "phone";
  /** Turnstile site key (null when Turnstile isn't configured). */
  siteKey: string | null;
  className?: string;
  buttonClassName?: string;
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
    <span className={className} aria-live="polite">
      {value ? (
        kind === "email" ? (
          <a href={`mailto:${value}`} className="link-underline py-1 font-medium">
            {value}
          </a>
        ) : (
          <a href={`tel:${value.replace(/[^\d+]/g, "")}`} className="py-1 hover:underline">
            {value}
          </a>
        )
      ) : (
        <>
          <button
            type="button"
            onClick={onClick}
            disabled={busy}
            className={`${buttonClassName} print:hidden disabled:opacity-60`}
          >
            {busy ? "Checking…" : label}
          </button>
          {siteKey && <span ref={ts.host} className="ml-2 inline-block align-middle" />}
          {error && (
            <span role="alert" className="ml-2 text-sm text-destructive">
              {error}
            </span>
          )}
        </>
      )}
    </span>
  );
}
