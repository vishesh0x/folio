import { Markdown } from "@/components/Markdown";
import { SafeLink } from "@/components/SafeLink";
import type { ResumeEntry, ResumeProfile, ResumeSection } from "@/lib/public.functions";

export function ResumeView({
  profile,
  sections,
  entries,
}: {
  profile: ResumeProfile | null;
  sections: ResumeSection[];
  entries: ResumeEntry[];
}) {
  const links = profile?.links ?? [];
  const contact = [profile?.email, profile?.phone, profile?.location].filter(Boolean) as string[];
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm md:p-12 print:border-0 print:p-0 print:shadow-none">
      <header className="border-b border-border pb-6">
        {/* The page supplies the <h1>; the resume name is a level-2 heading. */}
        <h2 className="font-display text-4xl font-normal md:text-5xl">{profile?.fullName}</h2>
        {profile?.headline && <p className="mt-1 text-lg text-primary">{profile.headline}</p>}
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {contact.map((c) => (
            <li key={c}>{c}</li>
          ))}
          {profile?.website && (
            <li>
              <SafeLink href={profile.website} className="hover:text-foreground hover:underline">
                {profile.website.replace(/^https?:\/\//, "")}
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
