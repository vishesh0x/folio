import { describe, expect, it } from "vitest";
import { isPrivacyMode } from "@/lib/constants";
import { projectToEntry } from "@/lib/resume-projects";

const base = {
  id: "p1",
  slug: "demo",
  title: "Demo",
  summary: "A demo project.",
  tech: ["TypeScript", "Workers"],
  repoUrl: null,
  liveUrl: null,
  startDate: "2025-03-01",
  endDate: null,
  status: "completed",
  published: true,
} as Parameters<typeof projectToEntry>[0];

describe("projectToEntry", () => {
  it("maps core fields and links the project id", () => {
    const e = projectToEntry(base, "s1");
    expect(e).toMatchObject({
      sectionId: "s1",
      projectId: "p1",
      title: "Demo",
      description: "A demo project.",
      tags: ["TypeScript", "Workers"],
      link: "/projects/demo",
      endDate: "",
    });
    expect(e.startDate).toMatch(/2025/);
  });
  it("prefers live site, then repo, and skips the case-study link for drafts", () => {
    expect(
      projectToEntry({ ...base, liveUrl: "https://a.dev", repoUrl: "https://g.com/x" }, "s").link,
    ).toBe("https://a.dev");
    expect(projectToEntry({ ...base, repoUrl: "https://g.com/x" }, "s").link).toBe(
      "https://g.com/x",
    );
    expect(projectToEntry({ ...base, published: false }, "s").link).toBeNull();
  });
  it("marks in-progress projects as ongoing", () => {
    expect(projectToEntry({ ...base, status: "in-progress" }, "s").endDate).toBe("Present");
  });
});

describe("isPrivacyMode", () => {
  it("accepts only the three modes", () => {
    expect(["public", "reveal", "hidden"].every(isPrivacyMode)).toBe(true);
    expect(isPrivacyMode("PUBLIC")).toBe(false);
    expect(isPrivacyMode(undefined)).toBe(false);
  });
});
