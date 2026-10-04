import { describe, expect, it } from "vitest";
import { IMAGE_WIDTHS, responsiveImage, snapWidth } from "@/lib/images";
import {
  buildKey,
  isValidKey,
  pickOutputFormat,
  sanitizeBaseName,
  sniffFileType,
} from "@/lib/media-core";

const bytes = (...b: number[]) =>
  new Uint8Array([...b, ...new Array(Math.max(0, 16 - b.length)).fill(0)]);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe("sniffFileType (magic bytes, never the client's claim)", () => {
  it("recognises allowed formats", () => {
    expect(sniffFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))?.mime).toBe(
      "image/png",
    );
    expect(sniffFileType(bytes(0xff, 0xd8, 0xff, 0xe0))?.mime).toBe("image/jpeg");
    expect(sniffFileType(bytes(...ascii("GIF89a")))?.mime).toBe("image/gif");
    expect(sniffFileType(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")))?.mime).toBe(
      "image/webp",
    );
    expect(sniffFileType(bytes(0, 0, 0, 0x1c, ...ascii("ftypavif")))?.mime).toBe("image/avif");
    expect(sniffFileType(bytes(...ascii("%PDF-1.7")))?.mime).toBe("application/pdf");
    expect(sniffFileType(bytes(0, 0, 1, 0, 1, 0))?.mime).toBe("image/x-icon");
  });
  it("rejects SVG, HTML, scripts and short input", () => {
    expect(sniffFileType(bytes(...ascii("<svg xmlns=")))).toBeNull();
    expect(sniffFileType(bytes(...ascii("<!doctype html>")))).toBeNull();
    expect(sniffFileType(bytes(...ascii("<script>alert1")))).toBeNull();
    expect(sniffFileType(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it("only raster formats are transformable", () => {
    expect(sniffFileType(bytes(0xff, 0xd8, 0xff))?.transformable).toBe(true);
    expect(sniffFileType(bytes(...ascii("%PDF-1.7")))?.transformable).toBe(false);
  });
});

describe("pickOutputFormat", () => {
  it("prefers AVIF, then WebP, then the original", () => {
    expect(pickOutputFormat("image/avif,image/webp,*/*", "image/png")).toBe("image/avif");
    expect(pickOutputFormat("image/webp,*/*", "image/jpeg")).toBe("image/webp");
    expect(pickOutputFormat("image/png,*/*", "image/png")).toBe("image/png");
    expect(pickOutputFormat(null, "image/jpeg")).toBe("image/jpeg");
  });
});

describe("keys", () => {
  it("accepts generated keys, rejects traversal and odd characters", () => {
    expect(isValidKey(buildKey("My Photo!!.PNG", "png", "AbC_-123"))).toBe(true);
    for (const bad of [
      "../x.png",
      "a/b.png",
      "A.png",
      ".hidden",
      "a..b.png",
      "a b.png",
      "",
      "x".repeat(300),
    ]) {
      expect(isValidKey(bad)).toBe(false);
    }
  });
  it("sanitises file names", () => {
    expect(sanitizeBaseName("Café Menü (final).JPG")).toBe("cafe-menu-final");
    expect(sanitizeBaseName("../../etc/passwd")).toBe("etc-passwd");
    expect(sanitizeBaseName("???")).toBe("file");
  });
});

describe("responsive widths", () => {
  it("snaps to the allow-list (bounds transform cost)", () => {
    expect(snapWidth(1)).toBe(IMAGE_WIDTHS[0]);
    expect(snapWidth(321)).toBe(480);
    expect(snapWidth(99999)).toBe(IMAGE_WIDTHS.at(-1));
    expect(snapWidth(Number.NaN)).toBe(IMAGE_WIDTHS[0]);
  });
  it("builds srcset only for local media", () => {
    const r = responsiveImage("/media/a.png", { maxWidth: 640 });
    expect(r.srcSet).toContain("/media/a.png?w=160 160w");
    expect(r.srcSet).toContain("?w=640 640w");
    expect(r.srcSet).not.toContain("?w=768");
    expect(responsiveImage("https://cdn.example.com/a.png").srcSet).toBeUndefined();
  });
});
