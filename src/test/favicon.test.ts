import { describe, expect, it } from "vitest";
import { DEFAULT_ICON_LINKS, iconLinks, manifestIcons } from "@/lib/favicon";
import { snapIconSize } from "@/lib/images";

describe("iconLinks", () => {
  it("uses the built-in icons when nothing is uploaded", () => {
    expect(iconLinks(null)).toEqual(DEFAULT_ICON_LINKS);
    expect(iconLinks("")).toEqual(DEFAULT_ICON_LINKS);
    expect(iconLinks("javascript:alert(1)")).toEqual(DEFAULT_ICON_LINKS);
  });

  it("serves an uploaded raster as small PNGs and drops the built-in icons", () => {
    const links = iconLinks("/media/abc-logo.png");
    expect(links.map((l) => l.href)).toEqual([
      "/media/abc-logo.png?w=32&f=png",
      "/media/abc-logo.png?w=192&f=png",
      "/media/abc-logo.png?w=180&f=png",
    ]);
    expect(links.some((l) => l.href.includes("/favicon."))).toBe(false);
    expect(links.filter((l) => l.rel === "icon").every((l) => l.type === "image/png")).toBe(true);
    expect(links[2]!.rel).toBe("apple-touch-icon");
  });

  it("uses .ico uploads as-is with a truthful type", () => {
    expect(iconLinks("/media/k.ico")).toEqual([
      { rel: "icon", href: "/media/k.ico", type: "image/x-icon" },
    ]);
  });

  it("passes external https icons through", () => {
    expect(iconLinks("https://example.com/i.png")).toEqual([
      { rel: "icon", href: "https://example.com/i.png", type: "image/png" },
    ]);
  });
});

describe("manifestIcons / snapIconSize", () => {
  it("falls back to the defaults, or uses 192/512 PNGs", () => {
    expect(manifestIcons(null).length).toBe(3);
    expect(manifestIcons("/media/a.webp").map((i) => i.sizes)).toEqual(["192x192", "512x512"]);
  });
  it("snaps to the nearest allowed size up, capped at 512", () => {
    expect(snapIconSize(16)).toBe(32);
    expect(snapIconSize(33)).toBe(48);
    expect(snapIconSize(9999)).toBe(512);
    expect(snapIconSize(Number.NaN)).toBe(32);
  });
});
