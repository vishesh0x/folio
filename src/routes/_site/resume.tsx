import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Download, Printer } from "lucide-react";
import { SafeLink } from "@/components/SafeLink";
import { ResumeView } from "@/components/site/ResumeView";
import { pageSeo, resumeQuery, seoMeta, siteQuery } from "@/lib/queries";

export const Route = createFileRoute("/_site/resume")({
  loader: async ({ context }) => {
    const [site] = await Promise.all([
      context.queryClient.ensureQueryData(siteQuery),
      context.queryClient.ensureQueryData(resumeQuery),
    ]);
    return { seo: site.seo.resume, origin: site.origin, name: site.config?.name };
  },
  head: ({ loaderData }) =>
    seoMeta({
      seo: pageSeo(loaderData?.seo),
      fallback: { title: "Resume", description: "Experience, skills and education." },
      origin: loaderData?.origin ?? "",
      path: "/resume",
      siteName: loaderData?.name,
    }),
  component: ResumePage,
});

function ResumePage() {
  const { data } = useSuspenseQuery(resumeQuery);
  const { data: site } = useSuspenseQuery(siteQuery);
  const file = site.config?.resumeUrl;
  return (
    <div className="mx-auto max-w-4xl px-5 py-16">
      <div className="no-print mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">
            Curriculum vitae
          </p>
          <h1 className="mt-3 font-display text-5xl font-light md:text-6xl">Resume</h1>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => window.print()} className="btn-ghost">
            <Printer aria-hidden className="h-4 w-4" /> Print
          </button>
          {file && (
            <SafeLink href={file} download="resume.pdf" className="btn-primary">
              <Download aria-hidden className="h-4 w-4" /> Download PDF
            </SafeLink>
          )}
        </div>
      </div>
      <ResumeView profile={data.profile} sections={data.sections} entries={data.entries} />
    </div>
  );
}
