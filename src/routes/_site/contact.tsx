import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ArrowUpRight, CheckCircle2, Loader2, Mail, MapPin, Send } from "lucide-react";
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
  "block w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground shadow-xs transition placeholder:text-muted-foreground/70 hover:border-foreground/40 focus-visible:border-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-foreground/10 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-4 aria-[invalid=true]:ring-destructive/15";
const label = "mb-1.5 flex items-baseline justify-between gap-3 text-sm font-medium";
const optional = "text-xs font-normal text-muted-foreground";
const iconChip =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground";
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
      // First issue per field wins (e.g. "enter your email", not "doesn't look right", when empty).
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
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
    <>
      {/* Outside the grid: the toast region renders an element and would otherwise claim a grid cell. */}
      <ThemedToaster />
      <div className="mx-auto grid max-w-5xl items-start gap-x-16 gap-y-10 px-5 py-14 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] md:grid-rows-[auto_1fr] md:py-20">
        <div className="md:col-start-1 md:row-start-1">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Contact</p>
          <h1 className="mt-3 font-display text-5xl font-light leading-tight md:text-6xl">
            Let's <em className="text-primary">talk</em>.
          </h1>
          <p className="mt-4 max-w-md text-muted-foreground">
            Have a project in mind, a question, or just want to share a good book? My inbox is open.
          </p>
          {(cfg?.email || site.emailReveal || cfg?.location) && (
            <ul className="mt-8 space-y-3 text-sm">
              {(cfg?.email || site.emailReveal) && (
                <li className="flex items-center gap-3">
                  <span aria-hidden className={iconChip}>
                    <Mail className="h-4 w-4" />
                  </span>
                  {cfg?.email ? (
                    <a href={`mailto:${cfg.email}`} className="py-1 hover:text-primary">
                      {cfg.email}
                    </a>
                  ) : (
                    <RevealContact field="siteEmail" kind="email" siteKey={site.turnstileSiteKey} />
                  )}
                </li>
              )}
              {cfg?.location && (
                <li className="flex items-center gap-3">
                  <span aria-hidden className={iconChip}>
                    <MapPin className="h-4 w-4" />
                  </span>
                  {cfg.location}
                </li>
              )}
            </ul>
          )}
        </div>

        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm md:col-start-2 md:row-span-2 md:row-start-1 md:p-9">
          {sent ? (
            <div
              role="status"
              className="flex min-h-[22rem] flex-col items-center justify-center text-center"
            >
              <div
                aria-hidden
                className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary"
              >
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h2 ref={heading} tabIndex={-1} className="mt-6 font-display text-3xl outline-none">
                Message sent!
              </h2>
              <p className="mt-2 max-w-xs text-muted-foreground">
                Thanks for reaching out. I'll get back to you by email.
              </p>
              <button
                type="button"
                onClick={() => {
                  // The old widget lived inside the form that just unmounted; start clean.
                  turnstile.dispose();
                  setStarted(false);
                  setSent(false);
                }}
                className="btn-ghost mt-6 px-5 py-2.5 text-sm"
              >
                Send another message
              </button>
            </div>
          ) : (
            <form
              onSubmit={submit}
              className="relative space-y-5"
              noValidate
              aria-labelledby="contact-form-title"
            >
              <div>
                <h2 id="contact-form-title" className="font-display text-2xl">
                  Send a message
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Fill this in and I'll reply to the email address you give.
                </p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="name" className={label}>
                    Name
                  </label>
                  <input
                    id="name"
                    name="name"
                    autoComplete="name"
                    placeholder="Jane Doe"
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
                    placeholder="you@example.com"
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
                  Subject <span className={optional}>Optional</span>
                </label>
                <input
                  id="subject"
                  name="subject"
                  placeholder="What's this about?"
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
                  placeholder="Tell me a little about your project, timeline or question…"
                  className={`${field} min-h-44 resize-y leading-relaxed`}
                  value={form.message}
                  onChange={set("message")}
                  maxLength={5000}
                  {...err("message")}
                />
                <div className="mt-1 flex justify-between gap-3">
                  <span>{msg("message")}</span>
                  {form.message.length >= 4000 && (
                    <span className="text-xs text-muted-foreground" aria-hidden>
                      {form.message.length}/5000
                    </span>
                  )}
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
              {turnstile.failed && (
                <p
                  role="alert"
                  className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                  The spam check couldn't load, so the form can't be sent yet. Check your connection
                  or any content blockers, then reload the page.
                </p>
              )}
              <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
                <button type="submit" disabled={sending} className="btn-primary px-7 py-3.5">
                  {sending ? (
                    <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send aria-hidden className="h-4 w-4" />
                  )}
                  {sending ? "Sending…" : "Send message"}
                </button>
                <p className="text-xs text-muted-foreground">
                  Your details are only used to reply.
                </p>
              </div>
            </form>
          )}
        </div>
        {socials.length > 0 && (
          <div className="md:col-start-1 md:row-start-2 md:border-t md:border-border md:pt-6">
            <h2 className="mb-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
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
    </>
  );
}
