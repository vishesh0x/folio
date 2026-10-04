import { describe, expect, it } from "vitest";
import { absoluteUrl, mediaKeyFromUrl, safeHref, safeImageSrc } from "@/lib/url";

describe("safeHref", () => {
  it.each([
    ["https://example.com/a?b=1", "https://example.com/a?b=1"],
    ["http://example.com", "http://example.com/"],
    ["mailto:me@example.com", "mailto:me@example.com"],
    ["/media/x.png", "/media/x.png"],
  ])("allows %s", (input, out) => expect(safeHref(input)).toBe(out));

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "//evil.example/path",
    "file:///etc/passwd",
    "",
    "not a url",
  ])("blocks %j", (input) => expect(safeHref(input)).toBeUndefined());

  it("handles null/undefined", () => {
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});

describe("safeImageSrc", () => {
  it("allows https and same-site only", () => {
    expect(safeImageSrc("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(safeImageSrc("/media/a.png")).toBe("/media/a.png");
    expect(safeImageSrc("http://example.com/a.png")).toBeUndefined();
    expect(safeImageSrc("data:image/svg+xml,<svg onload=alert(1)>")).toBeUndefined();
    expect(safeImageSrc("javascript:alert(1)")).toBeUndefined();
  });
});

describe("absoluteUrl / mediaKeyFromUrl", () => {
  it("makes local paths absolute", () => {
    expect(absoluteUrl("/media/a.png", "https://x.dev/")).toBe("https://x.dev/media/a.png");
    expect(absoluteUrl("https://o.com/a.png", "https://x.dev")).toBe("https://o.com/a.png");
    expect(absoluteUrl("javascript:1", "https://x.dev")).toBeUndefined();
  });
  it("extracts media keys", () => {
    expect(mediaKeyFromUrl("/media/abc-def.png?w=320")).toBe("abc-def.png");
    expect(mediaKeyFromUrl("https://x.dev/media/a.png")).toBeUndefined();
    expect(mediaKeyFromUrl(null)).toBeUndefined();
  });
});
