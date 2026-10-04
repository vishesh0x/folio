import { useCallback, useEffect, useRef } from "react";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<void> | undefined;

/** Load the Turnstile script once per page (shared by the contact form and reveal buttons). */
export function loadTurnstile(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = undefined; // allow a retry
      reject(new Error("Couldn't load the spam check"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Renders a Turnstile widget into `host` once `active` is true.
 *  - `reset()` after a *failed* submit (tokens are single-use, so a retry needs a fresh one).
 *  - `dispose()` when the host element is about to unmount, so the widget is re-created the next
 *    time the form is shown (previously "Send another" left a widget attached to a dead node).
 */
export function useTurnstile(
  siteKey: string | null,
  active: boolean,
  onToken: (t: string) => void,
  opts: Record<string, unknown> = {},
) {
  const host = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (!siteKey || !active || widget.current) return;
    let live = true;
    loadTurnstile()
      .then(() => {
        if (!live || widget.current || !host.current || !window.turnstile) return;
        widget.current = window.turnstile.render(host.current, {
          sitekey: siteKey,
          callback: (t: string) => onTokenRef.current(t),
          "expired-callback": () => onTokenRef.current(""),
          "error-callback": () => onTokenRef.current(""),
          ...optsRef.current,
        });
      })
      .catch(() => onTokenRef.current(""));
    return () => {
      live = false;
    };
  }, [siteKey, active]);

  const dispose = useCallback(() => {
    if (widget.current) window.turnstile?.remove(widget.current);
    widget.current = undefined;
    onTokenRef.current("");
  }, []);
  const reset = useCallback(() => {
    if (widget.current) window.turnstile?.reset(widget.current);
    onTokenRef.current("");
  }, []);

  // Remove the widget if the component itself unmounts.
  useEffect(() => dispose, [dispose]);

  return { host, reset, dispose };
}
