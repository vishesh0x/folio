import { describe, expect, it } from "vitest";
import { contactSchema, projectSchema, setupSchema, siteConfigSchema } from "@/lib/validators";
import { preprocess, countImagesMissingAlt } from "@/components/Markdown";
import { formatDate } from "@/lib/dates";

describe("validators", () => {
  it("rejects javascript: / data: URLs in every URL field", () => {
    const base = { title: "T", slug: "t", tags: [], tech: [] };
    expect(projectSchema.safeParse({ ...base, repoUrl: "javascript:alert(1)" }).success).toBe(
      false,
    );
    expect(projectSchema.safeParse({ ...base, liveUrl: "data:text/html,x" }).success).toBe(false);
    expect(
      projectSchema.safeParse({ ...base, coverUrl: "http://insecure.example/a.png" }).success,
    ).toBe(false);
    expect(
      projectSchema.safeParse({
        ...base,
        repoUrl: "https://github.com/a/b",
        coverUrl: "/media/a.png",
      }).success,
    ).toBe(true);
    expect(projectSchema.parse({ ...base, repoUrl: "" }).repoUrl).toBeNull();
  });
  it("validates slugs", () => {
    const ok = (slug: string) =>
      projectSchema.safeParse({ title: "T", slug, tags: [], tech: [] }).success;
    expect(ok("my-project-2")).toBe(true);
    expect(ok("My Project")).toBe(false); // spaces are never allowed
    expect(ok("a/b")).toBe(false);
    expect(ok("../x")).toBe(false);
  });
  it("contact form: strict email + length limits, honeypot passes through", () => {
    const good = { name: "Ann", email: "ann@example.com", message: "Hello there" };
    expect(contactSchema.safeParse(good).success).toBe(true);
    expect(contactSchema.safeParse({ ...good, email: "nope" }).success).toBe(false);
    expect(contactSchema.safeParse({ ...good, message: "x".repeat(5001) }).success).toBe(false);
    expect(contactSchema.parse({ ...good, website: "http://spam" }).website).toBe("http://spam");
  });
  it("setup requires a 12+ char password", () => {
    expect(
      setupSchema.safeParse({ email: "a@b.co", password: "short", setupToken: "t" }).success,
    ).toBe(false);
    expect(
      setupSchema.safeParse({ email: "a@b.co", password: "long-enough-pass", setupToken: "t" })
        .success,
    ).toBe(true);
  });
  it("site config rejects unsafe social URLs", () => {
    const cfg = {
      name: "N",
      role: "",
      tagline: "",
      bio: "",
      email: "",
      location: "",
      avatarAlt: "",
      metaTitle: "",
      metaDescription: "",
      available: true,
    };
    expect(
      siteConfigSchema.safeParse({ ...cfg, socials: [{ label: "x", url: "javascript:1" }] })
        .success,
    ).toBe(false);
    expect(
      siteConfigSchema.safeParse({ ...cfg, socials: [{ label: "x", url: "https://x.com/me" }] })
        .success,
    ).toBe(true);
  });
});

describe("markdown helpers", () => {
  it("converts wikilinks and embeds, strips comments", () => {
    expect(preprocess("see [[My Project|here]]")).toBe("see [here](/projects/my-project)");
    expect(preprocess("![[pic.png|A cat]]")).toBe("![A cat](pic.png)");
    expect(preprocess("a %%hidden%% b")).toBe("a  b");
  });
  it("counts images without alt text", () => {
    expect(countImagesMissingAlt("![](a.png) ![ok](b.png) ![ ](c.png) ![[d.png]]")).toBe(3);
  });
});

describe("formatDate", () => {
  it("does not shift date-only strings across timezones", () => {
    expect(formatDate("2026-09-01")).toBe("Sep 2026");
    expect(formatDate("2026-01-01")).toBe("Jan 2026");
    expect(formatDate("garbage")).toBeNull();
    expect(formatDate(null)).toBeNull();
  });
});
