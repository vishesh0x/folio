/**
 * Strict SVG validation for uploads (pure, no Workers APIs → unit-testable).
 *
 * Policy: **reject, never "clean up"**. The file we store is exactly the bytes the owner uploaded,
 * so the validator is an allowlist parser — anything it doesn't positively recognise is refused.
 * That avoids the classic failure mode of sanitizers (the browser's parser reading a file
 * differently from the sanitizer's).
 *
 * What is refused: scripts, event handlers, `foreignObject`, animation elements (they can rewrite
 * `href` to `javascript:`), `<a>`, any external reference (`href`, `url(...)`, `@import`,
 * `<feImage>`), DOCTYPE internal subsets / entities, processing instructions other than the XML
 * declaration, namespaced (Inkscape/Sodipodi/RDF) elements and attributes, unquoted attributes,
 * non-UTF-8 text, stray `<`, trailing content, and absurd size/depth.
 *
 * Defence in depth (outside this file): /media serves every non-PDF asset with
 * `Content-Security-Policy: default-src 'none'; sandbox` and `nosniff`, so even a file that slipped
 * through could not run script or load anything when opened directly; and SVGs are only ever used
 * via <img>/icon links, where browsers never run script.
 */

export const MAX_SVG_BYTES = 1024 * 1024;
const MAX_ELEMENTS = 20_000;
const MAX_DEPTH = 64;

const ELEMENTS = new Set([
  "svg", "g", "defs", "symbol", "use", "title", "desc", "style",
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "textPath", "image",
  "clipPath", "mask", "pattern", "marker", "linearGradient", "radialGradient", "stop",
  "filter", "feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix",
  "feDiffuseLighting", "feDisplacementMap", "feDistantLight", "feDropShadow", "feFlood",
  "feFuncA", "feFuncB", "feFuncG", "feFuncR", "feGaussianBlur", "feMerge", "feMergeNode",
  "feMorphology", "feOffset", "fePointLight", "feSpecularLighting", "feSpotLight", "feTile",
  "feTurbulence",
]); // prettier-ignore

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
/** Namespaced attributes we accept (exact name → required value, if any). */
const NS_ATTRS: Record<string, string | null> = {
  xmlns: SVG_NS,
  "xmlns:xlink": XLINK_NS,
  "xlink:href": null,
  "xml:space": null,
  "xml:lang": null,
};

export type SvgResult =
  { ok: true; width: number | null; height: number | null } | { ok: false; reason: string };

const fail = (reason: string): SvgResult => ({ ok: false, reason });

/** Cheap pre-check on the first bytes: does this *look* like an SVG document? */
export function looksLikeSvg(head: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8").decode(head);
  } catch {
    return false;
  }
  text = text.replace(/^\uFEFF/, "").trimStart();
  return /^(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE\s+svg[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(
    text,
  );
}

// ── tokenizer ───────────────────────────────────────────────────────────────────────────────
const ATTR = String.raw`\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>\x60]+))?`;
const TOKEN = new RegExp(
  [
    String.raw`<!--[\s\S]*?-->`, //                 1 comment
    String.raw`<!\[CDATA\[[\s\S]*?\]\]>`, //        2 cdata
    String.raw`<\?[\s\S]*?\?>`, //                  3 processing instruction
    String.raw`<!DOCTYPE[^>]*>`, //                 4 doctype
    String.raw`<\/[A-Za-z][\w:.-]*\s*>`, //         5 closing tag
    String.raw`<[A-Za-z][\w:.-]*(?:${ATTR})*\s*\/?>`, // 6 opening / self-closing tag
    String.raw`[^<]+`, //                           7 text
  ].join("|"),
  "gi",
);
const ATTR_RE = new RegExp(
  String.raw`\s+([^\s"'<>\/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>\x60]+))?`,
  "g",
);

const CSS_BAD =
  /@import|expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|url\s*\(\s*(?!['"]?\s*#)|\\|&#|<|data:(?!image\/(png|jpeg|webp|gif);base64,)/i;

/** Decode the five predefined XML entities only (a DOCTYPE with entities is refused anyway). */
const decode = (v: string) =>
  v
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

function checkAttr(el: string, name: string, raw: string | undefined): string | null {
  const lname = name.toLowerCase();
  if (lname.startsWith("on")) return `event handler attribute “${name}”`;
  if (name.includes(":")) {
    if (!(name in NS_ATTRS)) return `unsupported namespaced attribute “${name}”`;
  } else if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(name)) {
    return `invalid attribute name “${name}”`;
  }
  if (raw === undefined) return `attribute “${name}” has no value`;
  if (!/^["']/.test(raw)) return `attribute “${name}” must be quoted`;
  const value = decode(raw.slice(1, -1));

  if (name in NS_ATTRS) {
    const must = NS_ATTRS[name];
    if (must && value !== must) return `unexpected value for “${name}”`;
  }
  if (lname === "href" || lname === "xlink:href") {
    const v = value.trim();
    if (v.startsWith("#")) return null;
    if (el === "image" && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(v))
      return null;
    return `external or unsafe reference in “${name}”`;
  }
  if (lname === "style" || /url\s*\(|javascript:|vbscript:|data:|&#|\\/i.test(value)) {
    if (CSS_BAD.test(value)) return `unsafe value in “${name}”`;
  }
  return null;
}

/** Best-effort intrinsic size from width/height or viewBox (for layout; null if unknown). */
function intrinsicSize(attrs: Map<string, string>): {
  width: number | null;
  height: number | null;
} {
  const num = (v: string | undefined) => {
    const m = /^\s*([\d.]+)\s*(px)?\s*$/i.exec(v ?? "");
    const n = m ? Number.parseFloat(m[1]!) : Number.NaN;
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  let width = num(attrs.get("width"));
  let height = num(attrs.get("height"));
  if (!width || !height) {
    const vb = (attrs.get("viewBox") ?? "")
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0) {
      width ??= Math.round(vb[2]!);
      height ??= Math.round(vb[3]!);
    }
  }
  return { width, height };
}

/** Validate an SVG document. Pass the decoded text (see `decodeSvgBytes`). */
export function validateSvg(input: string): SvgResult {
  const text = input.replace(/^\uFEFF/, "");
  if (text.length === 0) return fail("the file is empty");
  if (text.length > MAX_SVG_BYTES) return fail("the file is larger than 1 MB");
  if (text.includes("\0")) return fail("the file contains binary data");

  TOKEN.lastIndex = 0;
  const stack: string[] = [];
  let pos = 0;
  let elements = 0;
  let sawRoot = false;
  let rootDone = false;
  let size: { width: number | null; height: number | null } = { width: null, height: null };
  let first = true;

  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
    if (m.index !== pos) return fail("malformed markup (unexpected “<”)");
    pos = TOKEN.lastIndex;
    const tok = m[0];
    const wasFirst = first;
    first = false;

    if (tok.startsWith("<!--")) continue;

    if (tok.startsWith("<![CDATA[")) {
      if (stack[stack.length - 1] !== "style") return fail("CDATA is only allowed inside <style>");
      if (CSS_BAD.test(tok.slice(9, -3))) return fail("unsafe CSS in <style>");
      continue;
    }
    if (tok.startsWith("<?")) {
      if (!(wasFirst && /^<\?xml\s[^?]*\?>$/i.test(tok))) {
        return fail("processing instructions (other than the XML declaration) aren’t allowed");
      }
      if (/encoding\s*=\s*["'](?!utf-8["'])/i.test(tok)) return fail("save the file as UTF-8");
      continue;
    }
    if (/^<!DOCTYPE/i.test(tok)) {
      if (sawRoot || /\[|ENTITY/i.test(tok)) return fail("DOCTYPE with entities isn’t allowed");
      continue;
    }

    if (tok.startsWith("</")) {
      const name = tok.slice(2, -1).trim();
      if (stack.pop() !== name) return fail("mismatched closing tag");
      if (stack.length === 0) rootDone = true;
      continue;
    }

    if (tok.startsWith("<")) {
      if (rootDone) return fail("content after the closing </svg>");
      const nameMatch = /^<([A-Za-z][\w:.-]*)/.exec(tok)!;
      const name = nameMatch[1]!;
      if (!sawRoot && name !== "svg") return fail("the root element must be <svg>");
      if (!ELEMENTS.has(name)) {
        return fail(
          name.includes(":")
            ? `namespaced element <${name}> (export as “plain” / “optimized” SVG)`
            : `element <${name}> isn’t allowed`,
        );
      }
      if (++elements > MAX_ELEMENTS) return fail("too many elements");

      const attrs = new Map<string, string>();
      const attrText = tok.slice(nameMatch[0].length);
      ATTR_RE.lastIndex = 0;
      for (let a = ATTR_RE.exec(attrText); a; a = ATTR_RE.exec(attrText)) {
        const [, an, av] = a;
        if (attrs.has(an!)) return fail(`duplicate attribute “${an}”`);
        const problem = checkAttr(name, an!, av);
        if (problem) return fail(problem);
        attrs.set(an!, decode((av ?? "").slice(1, -1)));
      }

      if (!sawRoot) {
        sawRoot = true;
        if (attrs.get("xmlns") !== SVG_NS)
          return fail('the root <svg> needs xmlns="http://www.w3.org/2000/svg"');
        size = intrinsicSize(attrs);
      }
      if (!/\/\s*>$/.test(tok)) {
        stack.push(name);
        if (stack.length > MAX_DEPTH) return fail("nested too deeply");
      } else if (stack.length === 0) {
        rootDone = true;
      }
      continue;
    }

    // Text node.
    if (stack[stack.length - 1] === "style") {
      if (CSS_BAD.test(tok)) return fail("unsafe CSS in <style>");
    } else if (stack.length === 0 && tok.trim() !== "") {
      return fail("text outside the <svg> element");
    }
  }

  if (pos !== text.length) return fail("malformed markup (unexpected “<”)");
  if (!sawRoot || stack.length !== 0) return fail("the file isn’t a complete SVG document");
  return { ok: true, ...size };
}

/** Strict UTF-8 decode (no UTF-16, no replacement characters). */
export function decodeSvgBytes(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
  ) {
    return null; // UTF-16
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
