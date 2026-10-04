import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ArrowUpRight, Loader2, Mail, MapPin, Send } from "lucide-react";
import { toast } from "sonner";
import { RevealContact } from "@/components/RevealContact";
import { SafeLink } from "@/components/SafeLink";
import { ThemedToaster } from "@/components/ThemedToaster";
import { sendMessage } from "@/lib/contact.functions";
import { pageSeo, seoMeta, siteQuery } from "@/lib/queries";
import { useTurnstile } from "@/lib/turnstile";
import { contactSchema } from "@/lib/validators";

export const Route = createFileRoute("/_site/contact")({
  loader: async ({ context }) => {
    const site = await context.queryClient.ensureQueryData(siteQuery);
    return { seo: site.seo.contact, origin: site.origin, name: site.config?.name };
  },
  head: ({ loaderData }) =>
    seoMeta({
      seo: pageSeo(loaderData?.seo),
      fallback: { title: "Contact", description: "Get in touch." },
      origin: loaderData?.origin ?? "",
      path: "/contact",
      siteName: loaderData?.name,
    }),
  component: ContactPage,
});

const field =
  "w-full border-0 border-b border-input bg-transparent px-0 py-3 text-lg transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus-visible:outline-none focus-visible:ring-0";
const label = "mb-1 block font-mono text-xs uppercase tracking-wider text-muted-foreground";
const empty = { name: "", email: "", subject: "", message: "", website: "" };

function ContactPage() {
  const { data: site } = useSuspenseQuery(siteQuery);
  const cfg = site.config;
  const socials = cfg?.socials ?? [];
  const [form, setForm] = useState(empty);
  const [token, setToken] = useState("");
  const [started, setStarted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const turnstile = useTurnstile(site.turnstileSiteKey, started, setToken);
  const heading = useRef<HTMLHeadingElement>(null);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => {
    setStarted(true);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = contactSchema.safeParse({ ...form, turnstileToken: token });
    if (!parsed.success) {
      const errs = Object.fromEntries(
        parsed.error.issues.map((i) => [String(i.path[0]), i.message]),
      );
      setErrors(errs);
      // Move focus to the first invalid field so keyboard + screen-reader users find it.
      const firstKey = ["name", "email", "message"].find((k) => errs[k]);
      if (firstKey) (e.currentTarget.elements.namedItem(firstKey) as HTMLElement | null)?.focus();
      return;
    }
    if (site.turnstileSiteKey && !token) {
      toast.error("Please complete the spam check.");
      return;
    }
    setErrors({});
    setSending(true);
    try {
      await sendMessage({ data: parsed.data });
      setSent(true);
      setForm(empty);
      turnstile.reset();
      setTimeout(() => heading.current?.focus(), 50);
    } catch (err) {
      // A Turnstile token is single-use: get a fresh one so the visitor can simply retry.
      turnstile.reset();
      toast.error(
        err instanceof Error && err.message.length < 200
          ? err.message
          : "Couldn't send your message. Please try again.",
      );
    } finally {
      setSending(false);
    }
  };

  const err = (k: string) =>
    errors[k] ? { "aria-invalid": true, "aria-describedby": `${k}-err` } : {};
  const msg = (k: string) =>
    errors[k] && (
      <p id={`${k}-err`} role="alert" className="mt-1 text-sm text-destructive">
        {errors[k]}
      </p>
    );

  return (
    <div className="mx-auto grid max-w-5xl gap-16 px-5 py-16 md:grid-cols-[1fr_1.3fr]">
      <ThemedToaster />
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Contact</p>
        <h1 className="mt-3 font-display text-5xl font-light leading-tight md:text-6xl">
          Let's <em className="text-primary">talk</em>.
        </h1>
        <p className="mt-4 text-muted-foreground">
          Have a project in mind, a question, or just want to share a good book? My inbox is open.
        </p>
        <div className="mt-10 space-y-4 text-sm">
          {cfg?.email ? (
            <a
              href={`mailto:${cfg.email}`}
              className="flex items-center gap-3 py-1 hover:text-primary"
            >
              <Mail aria-hidden className="h-4 w-4 text-muted-foreground" /> {cfg.email}
            </a>
          ) : (
            site.emailReveal && (
              <p className="flex items-center gap-3">
                <Mail aria-hidden className="h-4 w-4 text-muted-foreground" />
                <RevealContact field="siteEmail" kind="email" siteKey={site.turnstileSiteKey} />
              </p>
            )
          )}
          {cfg?.location && (
            <p className="flex items-center gap-3">
              <MapPin aria-hidden className="h-4 w-4 text-muted-foreground" /> {cfg.location}
            </p>
          )}
        </div>
        {socials.length > 0 && (
          <div className="mt-10 border-t border-border pt-6">
            <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Elsewhere
            </h2>
            <ul className="flex flex-col">
              {socials.map((s) => (
                <li key={s.url + s.label}>
                  <SafeLink
                    href={s.url}
                    className="group flex items-center justify-between border-b border-border py-3 hover:text-primary"
                  >
                    {s.label}
                    <ArrowUpRight
                      aria-hidden
                      className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    />
                  </SafeLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-border bg-card p-6 md:p-10">
        {sent ? (
          <div
            role="status"
            className="flex h-full flex-col items-center justify-center py-16 text-center"
          >
            <div
              aria-hidden
              className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary"
            >
              <Send className="h-6 w-6" />
            </div>
            <h2 ref={heading} tabIndex={-1} className="mt-6 font-display text-3xl outline-none">
              Message sent!
            </h2>
            <p className="mt-2 text-muted-foreground">
              Thanks for reaching out. I'll get back to you soon.
            </p>
            <button
              type="button"
              onClick={() => {
                // The old widget lived inside the form that just unmounted; start clean.
                turnstile.dispose();
                setStarted(false);
                setSent(false);
              }}
              className="mt-6 py-2 text-sm text-primary underline"
            >
              Send another
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-6" noValidate aria-label="Contact form">
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor="name" className={label}>
                  Name
                </label>
                <input
                  id="name"
                  name="name"
                  autoComplete="name"
                  required
                  className={field}
                  value={form.name}
                  onChange={set("name")}
                  maxLength={120}
                  {...err("name")}
                />
                {msg("name")}
              </div>
              <div>
                <label htmlFor="email" className={label}>
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className={field}
                  value={form.email}
                  onChange={set("email")}
                  maxLength={255}
                  {...err("email")}
                />
                {msg("email")}
              </div>
            </div>
            <div>
              <label htmlFor="subject" className={label}>
                Subject <span className="normal-case">(optional)</span>
              </label>
              <input
                id="subject"
                name="subject"
                className={field}
                value={form.subject}
                onChange={set("subject")}
                maxLength={200}
              />
            </div>
            <div>
              <label htmlFor="message" className={label}>
                Message
              </label>
              <textarea
                id="message"
                name="message"
                required
                className={`${field} min-h-40 resize-y`}
                value={form.message}
                onChange={set("message")}
                maxLength={5000}
                {...err("message")}
              />
              <div className="flex justify-between">
                <span>{msg("message")}</span>
                <span className="mt-1 text-xs text-muted-foreground" aria-hidden>
                  {form.message.length}/5000
                </span>
              </div>
            </div>
            {/* Honeypot: hidden from people and assistive tech, irresistible to bots. */}
            <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label htmlFor="website">Leave this empty</label>
              <input
                id="website"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={form.website}
                onChange={set("website")}
              />
            </div>
            <div ref={turnstile.host} />
            <button type="submit" disabled={sending} className="btn-primary w-full px-6 py-3.5">
              {sending ? (
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              ) : (
                <Send aria-hidden className="h-4 w-4" />
              )}
              {sending ? "Sending…" : "Send message"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
