// Obsidian-flavoured Markdown -> safe HTML.
//
// Supported: headings (with anchors + table of contents), GFM tables / task lists / strikethrough,
// fenced code with syntax highlighting, ==highlights==, %%comments%%, YAML front matter (ignored),
// callouts (> [!note] Title), [[wiki links]] to other projects, ![[image embeds]] of uploaded assets.
// Not supported: footnotes, math, mermaid, transclusion of other notes, external images (see below).
//
// Safety: raw HTML in the source is shown as text, never run. Links must be http(s), mailto, or
// on-site. Images must be uploaded assets (the site's CSP blocks third-party images anyway), so
// an external image becomes a plain link instead.
import { env } from 'cloudflare:workers';
import { Marked, Lexer, type Token, type Tokens, type TokenizerAndRendererExtension } from 'marked';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import yaml from 'highlight.js/lib/languages/yaml';
import diff from 'highlight.js/lib/languages/diff';
import { esc, imgHtml, type ImgAsset } from './imghtml';

for (const [n, l] of Object.entries({ javascript, typescript, python, bash, json, css, xml, sql, rust, go, yaml, diff })) hljs.registerLanguage(n, l);
const ALIAS: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', html: 'xml', svg: 'xml', yml: 'yaml', jsx: 'javascript', tsx: 'typescript' };

export type TocItem = { depth: number; text: string; id: string };
export type Rendered = { html: string; toc: TocItem[] };

const ID = '[A-Za-z0-9_-]{12}';
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-') || 'section';

/** Apply `fn` only to text that is outside fenced code blocks. */
const outsideCode = (md: string, fn: (s: string) => string) =>
  md.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g).map((part, i) => (i % 2 ? part : fn(part))).join('');

function prepare(md: string): string {
  md = md.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n?/, '');
  return outsideCode(md, (s) => s.replace(/%%[\s\S]*?%%/g, ''));
}

type Ctx = { assets: Map<string, ImgAsset>; byName: Map<string, ImgAsset>; slugs: Map<string, string> };

async function buildContext(md: string): Promise<Ctx> {
  const ids = new Set<string>(), names = new Set<string>(), targets = new Set<string>();
  for (const m of md.matchAll(new RegExp(`/media/(${ID})/`, 'g'))) ids.add(m[1]);
  for (const m of md.matchAll(/!\[\[([^\]|]+)/g)) (new RegExp(`^${ID}$`).test(m[1].trim()) ? ids : names).add(m[1].trim());
  for (const m of md.matchAll(/(?<!!)\[\[([^\]|#]+)/g)) targets.add(m[1].trim());

  const assets = new Map<string, ImgAsset>(), byName = new Map<string, ImgAsset>(), slugs = new Map<string, string>();
  const cols = 'id, filename, mime, width, height, alt, decorative';
  if (ids.size) {
    const list = [...ids].slice(0, 50);
    const r = await env.DB.prepare(`SELECT ${cols} FROM assets WHERE id IN (${list.map(() => '?').join(',')})`).bind(...list).all<ImgAsset>();
    r.results.forEach((a) => assets.set(a.id, a));
  }
  if (names.size) {
    const list = [...names].slice(0, 50).map((n) => n.toLowerCase());
    const r = await env.DB.prepare(`SELECT ${cols} FROM assets WHERE lower(filename) IN (${list.map(() => '?').join(',')}) ORDER BY created_at ASC, rowid ASC`).bind(...list).all<ImgAsset>();
    r.results.forEach((a) => byName.set(a.filename.toLowerCase(), a)); // newest wins
  }
  if (targets.size) {
    const r = await env.DB.prepare("SELECT slug, title FROM projects WHERE status = 'published'").all<{ slug: string; title: string }>();
    r.results.forEach((p) => { slugs.set(p.slug.toLowerCase(), p.slug); slugs.set(p.title.toLowerCase(), p.slug); });
  }
  return { assets, byName, slugs };
}

const safeHref = (h: string) => /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(h.trim()) ? h.trim() : null;
const CONTENT_SIZES = '(min-width: 48rem) 40rem, 100vw';

export async function renderMarkdown(source: string): Promise<Rendered> {
  const md = prepare(source);
  const ctx = await buildContext(md);
  const toc: TocItem[] = [];
  const used = new Map<string, number>();
  // The page title is the h1. Body headings are levelled relative to the shallowest one in the text (so a note that starts at
  // `##` still begins at h2), and no heading may skip a level below its predecessor (screen-reader users navigate by level).
  let minDepth = 6;
  const scan = (tokens: Token[]) => { for (const t of tokens) { if (t.type === 'heading') minDepth = Math.min(minDepth, (t as Tokens.Heading).depth); } };
  scan(new Lexer({ gfm: true }).lex(md));
  let prevLevel = 1;

  const wikiEmbed: TokenizerAndRendererExtension = {
    name: 'wikiEmbed', level: 'inline',
    start: (src) => src.indexOf('![['),
    tokenizer(src) {
      const m = /^!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/.exec(src);
      return m ? { type: 'wikiEmbed', raw: m[0], target: m[1].trim(), label: (m[2] ?? '').trim() } : undefined;
    },
    renderer(t) {
      const a = ctx.assets.get(t.target as string) ?? ctx.byName.get((t.target as string).toLowerCase());
      if (!a) return `<span class="md-missing">[missing image: ${esc(t.target as string)}]</span>`;
      const label = (t.label as string);
      // Obsidian uses "|300" for a size. That is not alt text, so ignore pure numbers.
      return imgHtml(a, { alt: /^\d+(x\d+)?$/.test(label) ? undefined : label || undefined, sizes: CONTENT_SIZES, class: 'md-img' });
    },
  };
  const wikiLink: TokenizerAndRendererExtension = {
    name: 'wikiLink', level: 'inline',
    start: (src) => src.indexOf('[['),
    tokenizer(src) {
      const m = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/.exec(src);
      return m ? { type: 'wikiLink', raw: m[0], target: m[1].trim(), label: (m[2] ?? '').trim() } : undefined;
    },
    renderer(t) {
      const target = t.target as string, text = esc((t.label as string) || target);
      const slug = ctx.slugs.get(target.toLowerCase()) ?? ctx.slugs.get(slugify(target));
      return slug ? `<a href="/projects/${encodeURIComponent(slug)}">${text}</a>` : `<span class="md-missing" title="No published project with this name">${text}</span>`;
    },
  };
  const highlight: TokenizerAndRendererExtension = {
    name: 'highlight', level: 'inline',
    start: (src) => src.indexOf('=='),
    tokenizer(src) {
      const m = /^==(?!\s)([^=\n]+?)==/.exec(src);
      return m ? { type: 'highlight', raw: m[0], text: m[1] } : undefined;
    },
    renderer: (t) => `<mark>${esc(t.text as string)}</mark>`,
  };

  const marked = new Marked({
    gfm: true,
    extensions: [wikiEmbed, wikiLink, highlight],
    renderer: {
      html: (t: Tokens.HTML | Tokens.Tag) => esc(t.text), // raw HTML is shown as text
      // Task-list boxes have no label text of their own, so give each one a spoken name.
      checkbox: (t: Tokens.Checkbox) => `<input type="checkbox" disabled${t.checked ? ' checked' : ''} aria-label="${t.checked ? 'Completed' : 'Not completed'}"> `,
      heading(t: Tokens.Heading) {
        const text = t.text.replace(/<[^>]*>/g, '');
        let id = slugify(text); const n = used.get(id) ?? 0; used.set(id, n + 1); if (n) id += `-${n}`;
        if (t.depth <= 3) toc.push({ depth: t.depth, text, id });
        const d = Math.max(2, Math.min(2 + (t.depth - minDepth), prevLevel + 1, 6));
        prevLevel = d;
        return `<h${d} id="${id}">${this.parser.parseInline(t.tokens)}</h${d}>\n`;
      },
      link(t: Tokens.Link) {
        const inner = this.parser.parseInline(t.tokens);
        const href = safeHref(t.href);
        if (!href) return inner;
        const ext = /^https?:/i.test(href);
        return `<a href="${esc(href)}"${t.title ? ` title="${esc(t.title)}"` : ''}${ext ? ' rel="noopener noreferrer" target="_blank"' : ''}>${inner}</a>`;
      },
      image(t: Tokens.Image) {
        const m = new RegExp(`^/media/(${ID})/`).exec(t.href.replace(/^https?:\/\/[^/]+/i, ''));
        const a = m && ctx.assets.get(m[1]);
        if (a) return imgHtml(a, { alt: t.text || undefined, sizes: CONTENT_SIZES, class: 'md-img' });
        const href = safeHref(t.href);
        return href ? `<a href="${esc(href)}" rel="noopener noreferrer" target="_blank">View image${t.text ? `: ${esc(t.text)}` : ''}</a>` : esc(t.text);
      },
      code(t: Tokens.Code) {
        const raw = (t.lang ?? '').trim().split(/\s/)[0].toLowerCase();
        const lang = ALIAS[raw] ?? raw;
        const body = lang && hljs.getLanguage(lang) ? hljs.highlight(t.text, { language: lang, ignoreIllegals: true }).value : esc(t.text);
        const label = /^[\w+#-]{1,20}$/.test(raw) ? ` data-lang="${raw}"` : '';
        return `<pre class="code"${label} tabindex="0"><code class="hljs">${body}</code></pre>\n`;
      },
      blockquote(t: Tokens.Blockquote) {
        const first = t.tokens[0];
        const m = first?.type === 'paragraph' ? /^\[!([A-Za-z-]+)\][+-]?[ \t]*([^\n]*)\n?/.exec(first.text) : null;
        if (!m) return `<blockquote>${this.parser.parse(t.tokens)}</blockquote>\n`;
        const type = m[1].toLowerCase();
        const title = m[2].trim() || type[0].toUpperCase() + type.slice(1);
        const rest = (first as Tokens.Paragraph).text.slice(m[0].length);
        const lead = rest ? `<p>${this.parser.parseInline(new Lexer(this.parser.options).inlineTokens(rest))}</p>` : '';
        return `<aside class="callout" data-type="${type}" role="note"><p class="callout-title">${esc(title)}</p>${lead}${this.parser.parse(t.tokens.slice(1))}</aside>\n`;
      },
    },
  });

  let html = (await marked.parse(md)) as string;
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  return { html, toc };
}

/** Plain-text summary for meta descriptions when a project has none. */
export function excerpt(source: string, max = 160): string {
  const t = prepare(source).replace(/```[\s\S]*?```/g, ' ').replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || a)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^>\s*\[![^\]]+\][+-]?/gm, '').replace(/[#>*_`~=|-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}
