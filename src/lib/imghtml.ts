// One implementation of "show an uploaded image", used by <Img> and by the Markdown renderer.
import { WIDTHS } from './media';

export type ImgAsset = { id: string; filename: string; mime: string; width: number | null; height: number | null; alt: string; decorative: number };
export type ImgOpts = { alt?: string; sizes?: string; eager?: boolean; class?: string; fit?: 'contain' | 'cover'; ratio?: string; natural?: boolean };

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const RESIZABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

export function imgHtml(a: ImgAsset, o: ImgOpts = {}): string {
  const { sizes = '(min-width: 72rem) 72rem, 100vw', eager = false, fit = 'contain' } = o;
  const text = (o.alt ?? a.alt ?? '').trim();
  const decorative = !text && !!a.decorative;
  if (!text && !decorative) console.warn(`[img] asset ${a.id} has no alt text and is not marked decorative`);

  const base = `/media/${a.id}/${encodeURIComponent(a.filename)}`;
  const common =
    ` alt="${decorative ? '' : esc(text)}"${decorative ? ' role="presentation"' : ''}` +
    (a.width ? ` width="${a.width}"` : '') + (a.height ? ` height="${a.height}"` : '') +
    ` loading="${eager ? 'eager' : 'lazy'}" decoding="${eager ? 'sync' : 'async'}"` +
    (eager ? ' fetchpriority="high"' : '') + (o.class ? ` class="${esc(o.class)}"` : '') +
    (fit === 'cover' ? ` style="object-fit:cover;${o.ratio ? `aspect-ratio:${esc(o.ratio)};width:100%;` : ''}"`
      // `natural`: hands the file's own size to the CSS (--nw/--nh) so the stylesheet can give the image a DEFINITE width before it
      // has loaded. Without one, a not-yet-loaded <img> is 0 x 0 and everything below it jumps when it arrives.
      : o.natural && a.width && a.height ? ` style="--nw:${a.width};--nh:${a.height};max-width:min(100%,${a.width}px)"` : '');

  if (!RESIZABLE.includes(a.mime)) return `<img src="${base}"${common}>`;

  const maxW = a.width ?? 2000;
  const widths = WIDTHS.filter((w) => w <= maxW);
  if (!widths.length || widths[widths.length - 1] < maxW) widths.push(WIDTHS.find((w) => w >= maxW) ?? WIDTHS[WIDTHS.length - 1]);
  const url = (w: number, f: string) => `${base}?w=${w}&amp;f=${f}`;
  const set = (f: string) => widths.map((w) => `${url(w, f)} ${w}w`).join(', ');
  const fb = a.mime === 'image/png' ? 'png' : a.mime === 'image/webp' ? 'webp' : 'jpeg';
  const sz = esc(sizes);
  return `<picture><source type="image/avif" srcset="${set('avif')}" sizes="${sz}"><source type="image/webp" srcset="${set('webp')}" sizes="${sz}">` +
    `<img src="${url(widths[Math.min(3, widths.length - 1)], fb)}" srcset="${set(fb)}" sizes="${sz}"${common}></picture>`;
}
