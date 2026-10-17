// SVG sanitiser (allow-list). Runs on Workers using the built-in HTMLRewriter.
// Anything not on the list is removed, including all scripts, event handlers,
// external references, animation (can rewrite hrefs) and <foreignObject>.
// Output is only ever stored if it passes the final checks at the bottom.

const ELEMENTS = new Set((
  'svg g defs symbol use path rect circle ellipse line polyline polygon text tspan textpath title desc ' +
  'lineargradient radialgradient stop pattern clippath mask marker filter image style ' +
  'fegaussianblur feoffset feblend fecolormatrix fecomposite feflood femerge femergenode femorphology ' +
  'fedropshadow fecomponenttransfer fefunca fefuncb fefuncg fefuncr feturbulence fetile ' +
  'fediffuselighting fespecularlighting fedistantlight fepointlight fespotlight feconvolvematrix fedisplacementmap'
).split(' '));

const DROP_ATTRS = new Set(['src', 'srcset', 'action', 'formaction', 'xml:base', 'target', 'xlink:actuate', 'xlink:show']);
const SAFE_LOCAL_REF = /^#[\w.:-]+$/;
const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;
const BAD_VALUE = /javascript:|vbscript:|data:text|data:application|data:image\/svg/i;
const EXTERNAL_URL = /url\(\s*['"]?\s*(?!#)/i;
const BAD_CSS = /@import|expression\s*\(|behavior\s*:|-moz-binding|javascript:|url\(\s*['"]?\s*(?!#|data:image\/(png|jpe?g|gif|webp);base64)/i;

function cleanCss(css: string): string {
  return css.replace(/</g, '').split(/(?<=\})/).filter((rule) => !BAD_CSS.test(rule)).join('');
}

export async function sanitizeSvg(input: string): Promise<string | null> {
  if (input.length > 1_000_000) return null;
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(input)) return null; // entity-expansion attacks

  const prepared = input
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c: string) => c.replace(/&/g, '&amp;').replace(/</g, '&lt;'));

  let cssBuf = '';
  const rewriter = new HTMLRewriter()
    .on('*', {
      element(el) {
        const tag = el.tagName.toLowerCase();
        if (!ELEMENTS.has(tag)) { el.remove(); return; }
        for (const [name, value] of [...el.attributes]) {
          const n = name.toLowerCase();
          let drop = false;
          if (!/^[a-z_:][a-z0-9_:.-]*$/i.test(n)) drop = true;
          else if (n.startsWith('on') || DROP_ATTRS.has(n)) drop = true;
          else if (n === 'href' || n === 'xlink:href') {
            const v = value.trim();
            drop = !(SAFE_LOCAL_REF.test(v) || (tag === 'image' && SAFE_DATA_IMAGE.test(v)));
          } else if (n === 'style') drop = BAD_CSS.test(value);
          else if (BAD_VALUE.test(value) || EXTERNAL_URL.test(value)) drop = true;
          if (drop) el.removeAttribute(name);
        }
        if (tag === 'svg' && !el.hasAttribute('xmlns')) el.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      },
    })
    .on('style', {
      text(t) {
        cssBuf += t.text;
        t.remove();
        if (t.lastInTextNode) { t.replace(cleanCss(cssBuf), { html: true }); cssBuf = ''; }
      },
    });

  let out = (await rewriter.transform(new Response(prepared)).text()).trim();
  // Final belt-and-braces checks. If anything slipped through, refuse the file.
  if (!/^<svg[\s>]/i.test(out) || !/<\/svg>\s*$/i.test(out)) return null;
  if (/<script|<foreignobject|<iframe|<object|<embed|javascript:|\son[a-z]+\s*=/i.test(out)) return null;
  return out;
}

export function svgSize(svg: string): { width: number | null; height: number | null } {
  const vb = svg.match(/<svg[^>]*\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (vb) return { width: Math.round(+vb[1]) || null, height: Math.round(+vb[2]) || null };
  const w = svg.match(/<svg[^>]*\swidth\s*=\s*["']([\d.]+)(px)?["']/i);
  const h = svg.match(/<svg[^>]*\sheight\s*=\s*["']([\d.]+)(px)?["']/i);
  return { width: w ? Math.round(+w[1]) : null, height: h ? Math.round(+h[1]) : null };
}
