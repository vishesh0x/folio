import { Globe, Mail, MapPin, Phone } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { RevealContact } from "@/components/RevealContact";
import { SafeLink } from "@/components/SafeLink";
import type { ResumeEntry, ResumeProfile, ResumeSection } from "@/lib/public.functions";

const item = "inline-flex items-center gap-1.5";
const icon = "h-3.5 w-3.5 shrink-0";
const linkCls = "py-0.5 hover:text-foreground hover:underline";
// Same look as the other items, but clearly clickable (dotted underline).
const revealCls =
  "py-0.5 text-foreground/80 underline decoration-dotted underline-offset-4 hover:text-foreground hover:decoration-solid";

export function ResumeView({
  profile,
  sections,
  entries,
  reveal,
  siteKey = null,
}: {
  profile: ResumeProfile | null;
  sections: ResumeSection[];
  entries: ResumeEntry[];
  /** Details that are fetched on click instead of being in the page (public resume only). */
  reveal?: { email: boolean; phone: boolean };
  siteKey?: string | null;
}) {
  const links = profile?.links ?? [];
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm md:p-12 print:border-0 print:p-0 print:shadow-none">
      <header className="border-b border-border pb-6">
        {/* The page supplies the <h1>; the resume name is a level-2 heading. */}
        <h2 className="font-display text-4xl font-normal md:text-5xl">{profile?.fullName}</h2>
        {profile?.headline && <p className="mt-1 text-lg text-primary">{profile.headline}</p>}
        {/* One consistent row: icon + value, in a fixed order (email, phone, location, website, links). */}
        <ul className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
          {profile?.email ? (
            <li className={item}>
              <Mail aria-hidden className={icon} />
              <a href={`mailto:${profile.email}`} className={linkCls}>
                {profile.email}
              </a>
            </li>
          ) : (
            reveal?.email && (
              <li>
                <RevealContact
                  field="resumeEmail"
                  kind="email"
                  siteKey={siteKey}
                  icon={<Mail aria-hidden className={icon} />}
                  buttonClassName={revealCls}
                />
              </li>
            )
          )}
          {profile?.phone ? (
            <li className={item}>
              <Phone aria-hidden className={icon} />
              <a href={`tel:${profile.phone.replace(/[^\d+]/g, "")}`} className={linkCls}>
                {profile.phone}
              </a>
            </li>
          ) : (
            reveal?.phone && (
              <li>
                <RevealContact
                  field="resumePhone"
                  kind="phone"
                  siteKey={siteKey}
                  icon={<Phone aria-hidden className={icon} />}
                  buttonClassName={revealCls}
                />
              </li>
            )
          )}
          {profile?.location && (
            <li className={item}>
              <MapPin aria-hidden className={icon} />
              {profile.location}
            </li>
          )}
          {profile?.website && (
            <li className={item}>
              <Globe aria-hidden className={icon} />
              <SafeLink href={profile.website} className={linkCls}>
                {profile.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </SafeLink>
            </li>
          )}
          {links.map((l) => (
            <li key={l.url}>
              <SafeLink href={l.url} className="hover:text-foreground hover:underline">
                {l.label}
              </SafeLink>
            </li>
          ))}
        </ul>
      </header>
      {profile?.summary && (
        <section className="mt-6" aria-labelledby="r-summary">
          <SectionTitle id="r-summary">Summary</SectionTitle>
          <Markdown className="!text-[0.95rem]">{profile.summary}</Markdown>
        </section>
      )}
      {sections.map((s) => {
        const list = entries.filter((e) => e.sectionId === s.id);
        if (!list.length) return null;
        return (
          <section key={s.id} className="mt-8" aria-labelledby={`r-${s.id}`}>
            <SectionTitle id={`r-${s.id}`}>{s.title}</SectionTitle>
            {s.kind === "skills" ? (
              <div className="space-y-2">
                {list.map((e) => (
                  <div key={e.id} className="grid gap-2 text-sm sm:grid-cols-[160px_1fr]">
                    <span className="font-medium">{e.title}</span>
                    <ul className="flex flex-wrap gap-1.5">
                      {e.tags.map((t) => (
                        <li key={t} className="rounded-md bg-muted px-2 py-0.5 text-xs">
                          {t}
                        </li>
                      ))}
                      {e.description && (
                        <li className="list-none text-muted-foreground">{e.description}</li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-5">
                {list.map((e) => (
                  <article key={e.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <h3 className="font-semibold">
                        {e.link ? (
                          <SafeLink href={e.link} className="hover:text-primary hover:underline">
                            {e.title}
                          </SafeLink>
                        ) : (
                          e.title
                        )}
                        {e.organization && (
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            · {e.organization}
                          </span>
                        )}
                      </h3>
                      {(e.startDate || e.endDate) && (
                        <span className="font-mono text-xs text-muted-foreground">
                          {[e.startDate, e.endDate].filter(Boolean).join(" — ")}
                        </span>
                      )}
                    </div>
                    {(e.subtitle || e.location) && (
                      <p className="text-sm text-muted-foreground">
                        {[e.subtitle, e.location].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    {e.description && (
                      <Markdown className="mt-1.5 !text-[0.92rem] !leading-relaxed">
                        {e.description}
                      </Markdown>
                    )}
                    {e.tags.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {e.tags.map((t) => (
                          <li key={t} className="rounded-md bg-muted px-2 py-0.5 text-xs">
                            {t}
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function SectionTitle({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <h2
      id={id}
      className="mb-3 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.25em] text-primary"
    >
      {children}
      <span aria-hidden className="h-px flex-1 bg-border" />
    </h2>
  );
}
