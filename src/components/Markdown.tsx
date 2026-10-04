import { useEffect, useState, type ComponentProps } from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import { Img } from "@/components/Img";
import { SafeLink } from "@/components/SafeLink";
import { safeHref, safeImageSrc } from "@/lib/url";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Obsidian-style callouts: `> [!note] Title` */
function remarkCallouts() {
  return (tree: any) => {
    visit(tree, "blockquote", (node: any) => {
      const p = node.children?.[0];
      if (p?.type !== "paragraph") return;
      const t = p.children?.[0];
      if (t?.type !== "text") return;
      const m = t.value.match(/^\[!(\w+)\][+-]?[ \t]*([^\n]*)\n?/);
      if (!m) return;
      const type = m[1].toLowerCase();
      const title = m[2]?.trim() || type[0].toUpperCase() + type.slice(1);
      t.value = t.value.slice(m[0].length);
      if (!t.value) {
        p.children.shift();
        if (p.children[0]?.type === "break") p.children.shift();
        if (p.children.length === 0) node.children.shift();
      }
      // A <div role="note"> — not <aside>, which would create a landmark per callout.
      node.data = {
        hName: "div",
        hProperties: { className: ["callout", `callout-${type}`], role: "note" },
      };
      node.children.unshift({
        type: "paragraph",
        data: { hProperties: { className: ["callout-title"] } },
        children: [{ type: "text", value: title }],
      });
    });
  };
}

/** Obsidian `![[img]]`, `[[wikilink]]` and `%%comments%%`. */
export function preprocess(md: string) {
  return md
    .replace(
      /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_m, src, alt) => `![${alt ?? ""}](${src.trim()})`,
    )
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, label) => {
      const slug = target
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      return `[${(label ?? target).trim()}](/projects/${slug})`;
    })
    .replace(/%%[\s\S]*?%%/g, "");
}

/** Count markdown images with no alt text (used by the editor's accessibility check). */
export function countImagesMissingAlt(md: string): number {
  const pre = preprocess(md);
  return [...pre.matchAll(/!\[([^\]]*)\]\(/g)].filter((m) => !m[1]?.trim()).length;
}

type Plugin = NonNullable<Options["rehypePlugins"]>[number];

/**
 * Syntax highlighting pulls in highlight.js (~100 kB). Only pages that actually
 * contain a fenced code block load it, and only after hydration.
 */
function useHighlighter(source: string): Plugin[] {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const hasFence = /^\s*(```|~~~)/m.test(source);
  useEffect(() => {
    if (!hasFence || plugins.length) return;
    let live = true;
    import("rehype-highlight").then((m) => {
      if (live) setPlugins([[m.default, { detect: false, ignoreMissing: true }]]);
    });
    return () => {
      live = false;
    };
  }, [hasFence, plugins.length]);
  return plugins;
}

export function Markdown({
  children,
  className = "",
  fallbackAlt = "Image",
}: {
  children: string;
  className?: string;
  /** Used when a markdown image has no alt text of its own. */
  fallbackAlt?: string;
}) {
  const source = preprocess(children || "");
  const rehypePlugins = useHighlighter(source);
  return (
    <div className={`prose-md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCallouts]}
        rehypePlugins={rehypePlugins}
        // Raw HTML in markdown is never rendered; URLs are allow-listed.
        urlTransform={(url, key) => (key === "src" ? safeImageSrc(url) : safeHref(url)) ?? ""}
        components={{
          a: ({
            href,
            children: c,
            node: _n,
            ...rest
          }: ComponentProps<"a"> & { node?: unknown }) => (
            <SafeLink {...rest} href={href}>
              {c}
            </SafeLink>
          ),
          img: ({ src, alt }: ComponentProps<"img">) => (
            <Img
              src={typeof src === "string" ? src : undefined}
              alt={alt?.trim() || fallbackAlt}
              maxWidth={1280}
              sizes="(min-width: 768px) 768px, 100vw"
            />
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
