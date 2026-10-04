import { describe, expect, it } from "vitest";
import { responsiveImage } from "@/lib/images";
import { iconLinks, manifestIcons } from "@/lib/favicon";
import { shareImage } from "@/lib/share-image";
import { decodeSvgBytes, looksLikeSvg, validateSvg } from "@/lib/svg-safety";
import { optionalShareImage } from "@/lib/validators";

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svg = (inner: string, attrs = "") => `<svg ${NS} viewBox="0 0 24 12" ${attrs}>${inner}</svg>`;
const ok = (s: string) => validateSvg(s);
const bad = (s: string, re?: RegExp) => {
  const r = validateSvg(s);
  expect(r.ok).toBe(false);
  if (re && !r.ok) expect(r.reason).toMatch(re);
};
const bytes = (s: string) => new TextEncoder().encode(s);

describe("validateSvg — accepts normal design-tool output", () => {
  it("simple logo, reports size from viewBox", () => {
    const r = ok(svg('<path d="M0 0h24v12z" fill="#123"/>'));
    expect(r).toEqual({ ok: true, width: 24, height: 12 });
  });
  it("width/height attributes win over viewBox", () => {
    expect(ok(svg("<g/>", 'width="100px" height="50"'))).toMatchObject({ width: 100, height: 50 });
  });
  it("Figma-style: defs, clipPath, gradients, filters, local url() refs", () => {
    expect(
      ok(
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          svg(
            `<g clip-path="url(#clip0)" filter="url(#f0)"><rect width="10" height="10" fill="url(#g0)"/></g>` +
              `<defs><clipPath id="clip0"><rect width="24" height="12"/></clipPath>` +
              `<linearGradient id="g0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>` +
              `<filter id="f0"><feGaussianBlur stdDeviation="2"/></filter></defs>`,
          ),
      ).ok,
    ).toBe(true);
  });
  it("Illustrator-style: <style> with CDATA and classes, title, data-name", () => {
    expect(
      ok(
        svg(
          `<defs><style><![CDATA[.cls-1{fill:#f00;stroke:#000}.a>.b{opacity:.5}]]></style></defs>` +
            `<title>Logo</title><path class="cls-1" data-name="Layer 1" d="M0 0"/>`,
        ),
      ).ok,
    ).toBe(true);
  });
  it("dark-mode favicon via @media in <style>", () => {
    expect(
      ok(svg("<style>@media (prefers-color-scheme: dark){path{fill:#fff}}</style><path d='M0 0'/>"))
        .ok,
    ).toBe(true);
  });
  it("local <use href=#id>, comments, harmless DOCTYPE, BOM", () => {
    expect(
      ok(
        `\uFEFF<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<!-- hi -->` +
          svg(
            '<defs><path id="p" d="M0 0"/></defs><use xlink:href="#p"/>',
            'xmlns:xlink="http://www.w3.org/1999/xlink"',
          ),
      ).ok,
    ).toBe(true);
  });
  it("embedded raster via base64 data URI on <image>", () => {
    expect(ok(svg('<image href="data:image/png;base64,iVBORw0KGgo="/>')).ok).toBe(true);
  });
});

describe("validateSvg — rejects attack patterns", () => {
  it("script element", () => bad(svg("<script>alert(1)</script>"), /<script>/));
  it("script with CDATA / odd casing", () => bad(svg("<ScRiPt>x</ScRiPt>")));
  it("event handlers", () => {
    bad(svg("<g/>", 'onload="alert(1)"'), /event handler/);
    bad(svg('<rect width="1" height="1" onclick="x()"/>'), /event handler/);
    bad(svg('<rect OnMouseOver="x()"/>'), /event handler/);
  });
  it("foreignObject / animate / set / a / feImage", () => {
    for (const el of [
      "foreignObject",
      "animate",
      "set",
      "animateTransform",
      "a",
      "feImage",
      "iframe",
      "audio",
      "video",
      "cursor",
      "switch",
      "view",
    ]) {
      bad(svg(`<${el}/>`), /isn.t allowed/);
    }
  });
  it("javascript: / data:text / external hrefs", () => {
    bad(svg('<use href="javascript:alert(1)"/>'), /unsafe reference/);
    bad(svg('<use xlink:href="https://evil.example/x.svg#a"/>'), /unsafe reference/);
    bad(svg('<image href="data:text/html;base64,PHNjcmlwdD4="/>'), /unsafe reference/);
    bad(svg('<image href="data:image/svg+xml;base64,AAAA"/>'), /unsafe reference/);
    bad(svg('<image href="//evil.example/p.png"/>'), /unsafe reference/);
  });
  it("entity-obfuscated javascript: in href", () => {
    bad(svg('<use href="jav&#x61;script:alert(1)"/>'));
    bad(svg('<use href="&#106;avascript:alert(1)"/>'));
  });
  it("external url() in attributes, style attributes and <style>", () => {
    bad(svg('<rect fill="url(https://evil.example/t.png)"/>'), /unsafe value/);
    bad(svg('<rect style="fill:url(//evil.example/x)"/>'), /unsafe value/);
    bad(svg("<style>@import url(https://evil.example/x.css);</style>"), /unsafe CSS/);
    bad(svg("<style>path{background:url(https://evil.example/x)}</style>"), /unsafe CSS/);
    bad(svg("<style>path{width:expression(alert(1))}</style>"), /unsafe CSS/);
    bad(svg("<style>@font-face{src:url(data:font/woff2;base64,AAAA)}</style>"), /unsafe CSS/);
  });
  it("CSS escape obfuscation", () =>
    bad(svg("<style>path{fill:\\75rl(https://e.x)}</style>"), /unsafe CSS/));
  it("CDATA outside <style>", () => bad(svg("<![CDATA[<script>x</script>]]>"), /CDATA/));
  it("DOCTYPE with internal subset / entities (XXE, billion laughs)", () => {
    bad(`<!DOCTYPE svg [<!ENTITY a "x">]>${svg("<text>&a;</text>")}`, /DOCTYPE/);
    bad(`<!DOCTYPE svg SYSTEM "x" [ ]>${svg("")}`, /DOCTYPE/);
  });
  it("processing instructions / xml-stylesheet", () => {
    bad(`<?xml-stylesheet href="https://evil.example/x.css"?>${svg("")}`, /processing instruction/);
    bad(`${svg("")}<?php echo 1 ?>`, /processing instruction/);
  });
  it("namespaced elements and attributes (inkscape/rdf/xhtml)", () => {
    bad(svg("<metadata><rdf:RDF/></metadata>"));
    bad(svg("<sodipodi:namedview/>"), /namespaced/);
    bad(svg("<g/>", 'inkscape:label="x"'), /namespaced attribute/);
    bad(`<svg ${NS} xmlns:h="http://www.w3.org/1999/xhtml"><h:script>x</h:script></svg>`);
    bad(`<svg ${NS} xmlns:xlink="https://evil.example/"/>`, /unexpected value/);
  });
  it("root checks", () => {
    bad("<html><body/></html>", /root element/);
    bad('<svg viewBox="0 0 1 1"/>', /xmlns/);
    bad(`<svg xmlns="http://example.com/ns"/>`, /xmlns/);
    bad(svg("") + "<svg " + NS + "/>", /after the closing/);
    bad(svg("") + "trailing text", /outside/);
  });
  it("malformed markup & parser-differential tricks", () => {
    bad(svg("<g><</g>"), /malformed/);
    bad(svg("<g a=b/>"), /quoted/);
    bad(svg('<g a="1" a="2"/>'), /duplicate/);
    bad(svg("<g></path>"), /mismatched/);
    bad(`<svg ${NS}><g>`, /complete/);
    bad(svg('<g title=">"/><script>x</script>'), /<script>/);
    bad(svg("<!-- <script>x</script> --><script>y</script>"), /<script>/);
  });
  it("empty / binary / oversize / too deep", () => {
    bad("", /empty/);
    bad(svg("") + "\0", /binary/);
    bad(svg("<g>".repeat(100) + "</g>".repeat(100)), /deeply/);
    bad(svg(" ".repeat(1024 * 1024)), /1 MB/);
  });
  it("no catastrophic backtracking on adversarial input", () => {
    const t = Date.now();
    validateSvg(`<svg ${NS}><g ${"a ".repeat(50_000)}`);
    validateSvg(`<svg ${NS}>${"<g a='x".repeat(30_000)}`);
    validateSvg(`<svg ${NS}>${"<!--".repeat(100_000)}`);
    validateSvg(`<svg ${NS}><style>${"@".repeat(500_000)}</style></svg>`);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe("looksLikeSvg / decodeSvgBytes", () => {
  it("detects svg heads (with xml decl, BOM, doctype, comments)", () => {
    expect(looksLikeSvg(bytes(svg("")))).toBe(true);
    expect(looksLikeSvg(bytes(`\uFEFF<?xml version="1.0"?>\n<!-- c -->\n<svg ${NS}/>`))).toBe(true);
    expect(looksLikeSvg(bytes(`<!DOCTYPE svg PUBLIC "a" "b"><svg ${NS}/>`))).toBe(true);
  });
  it("does not treat html/text/binary as svg", () => {
    expect(looksLikeSvg(bytes("<html><svg></svg></html>"))).toBe(false);
    expect(looksLikeSvg(bytes("hello world"))).toBe(false);
    expect(looksLikeSvg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe(false);
  });
  it("rejects UTF-16 and invalid UTF-8", () => {
    expect(decodeSvgBytes(new Uint8Array([0xff, 0xfe, 0x3c, 0x00]))).toBeNull();
    expect(decodeSvgBytes(new Uint8Array([0x3c, 0xc3, 0x28]))).toBeNull();
    expect(decodeSvgBytes(bytes("<svg/>"))).toBe("<svg/>");
  });
});

describe("SVG across the site", () => {
  it("no responsive variants (served as-is)", () => {
    expect(responsiveImage("/media/abc-logo.svg", { maxWidth: 640 })).toEqual({
      src: "/media/abc-logo.svg",
    });
    expect(responsiveImage("/media/abc-photo.png", { maxWidth: 640 }).srcSet).toBeTruthy();
  });
  it("favicon: SVG is used directly; no apple icon; manifest uses it", () => {
    expect(iconLinks("/media/abc-icon.svg")).toEqual([
      { rel: "icon", href: "/media/abc-icon.svg", type: "image/svg+xml", sizes: "any" },
    ]);
    expect(manifestIcons("/media/abc-icon.svg")).toEqual([
      { src: "/media/abc-icon.svg", sizes: "any", type: "image/svg+xml" },
    ]);
  });
  it("share images never use SVG (falls through to the next candidate)", () => {
    expect(shareImage("/media/abc-cover.svg", "https://x.dev")).toBeUndefined();
    expect(shareImage("https://cdn.example/x.svg?v=1", "https://x.dev")).toBeUndefined();
    expect(shareImage("/media/abc-cover.png", "https://x.dev")).toMatch(
      /^https:\/\/x\.dev\/media\//,
    );
  });
  it("share-image fields refuse SVG at save time", () => {
    expect(optionalShareImage.safeParse("/media/a-b.svg").success).toBe(false);
    expect(optionalShareImage.safeParse("/media/a-b.png").success).toBe(true);
    expect(optionalShareImage.safeParse("").success).toBe(true);
  });
});
