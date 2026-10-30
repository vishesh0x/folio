// Draws ```mermaid fences (the same diagrams you write in Obsidian).
//
// The Markdown renderer outputs each diagram as <figure data-diagram> holding its source in a normal code block. That block
// is what you see without JavaScript, while the diagram loads, and if the diagram has a mistake in it.
//
// Cost control: Mermaid is large, so it is a separate file that is only downloaded when a page actually has a diagram, and
// (on the public site) only once that diagram is within about a screen of being visible. Pages without diagrams ship none of it.
// It is served from this site (CSP: script-src 'self'), never from a CDN.
type Mermaid = typeof import('mermaid').default;

const SELECTOR = 'figure[data-diagram]';
const MAX_SOURCE = 30_000; // characters; a safety limit, far above any real diagram
let loading: Promise<Mermaid> | null = null;
let queue: Promise<void> = Promise.resolve();
let watching = false;
let seq = 0;

const load = () => (loading ??= import('mermaid').then((m) => m.default));

/** Resolve a CSS colour variable (light-dark() and all) to #rrggbb, which is what Mermaid's theme wants. */
function colour(cssVar: string, fallback: string): string {
  const el = document.createElement('span');
  el.style.cssText = `position:absolute;visibility:hidden;color:var(${cssVar})`;
  document.documentElement.appendChild(el);
  const c = getComputedStyle(el).color;
  el.remove();
  const n = c.match(/[\d.]+/g)?.map(Number);
  if (!n || n.length < 3) return fallback;
  const scale = c.startsWith('color(') ? 255 : 1; // color(srgb 0.1 0.2 0.3) uses 0..1
  return '#' + n.slice(0, 3).map((x) => Math.round(x * scale).toString(16).padStart(2, '0')).join('');
}

function themeVariables() {
  const bg = colour('--bg', '#f7f7f4'), card = colour('--card', '#ffffff'), surface = colour('--surface', '#ebe9e1');
  const ink = colour('--ink', '#1b1a1f'), line = colour('--outline', '#1b1a1f'), tint = colour('--tint', '#ffe0e7'), gold = colour('--gold', '#efb11d');
  const lum = (h: string) => { const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  return {
    darkMode: lum(bg) < 0.5,
    background: bg, fontFamily: getComputedStyle(document.body).fontFamily, fontSize: '15px',
    textColor: ink, titleColor: ink, lineColor: line,
    primaryColor: card, primaryTextColor: ink, primaryBorderColor: line,
    secondaryColor: surface, secondaryTextColor: ink, secondaryBorderColor: line,
    tertiaryColor: tint, tertiaryTextColor: ink, tertiaryBorderColor: line,
    clusterBkg: surface, clusterBorder: line, edgeLabelBackground: bg,
    noteBkgColor: gold, noteTextColor: '#1b1a1f', noteBorderColor: line,
    actorBkg: card, actorBorder: line, actorTextColor: ink, actorLineColor: line,
    signalColor: ink, signalTextColor: ink, labelBoxBkgColor: card, labelBoxBorderColor: line, labelTextColor: ink, loopTextColor: ink,
    activationBkgColor: surface, activationBorderColor: line, sequenceNumberColor: bg,
  };
}

async function drawOne(fig: HTMLElement) {
  const source = (fig.dataset.source ??= fig.querySelector('code')?.textContent ?? '');
  const problem = (msg: string) => {
    fig.dataset.state = 'error';
    fig.querySelector('.diagram-error')?.remove();
    const p = document.createElement('p');
    p.className = 'diagram-error'; p.setAttribute('role', 'note');
    p.textContent = `This diagram could not be drawn (${msg}). Its source is shown instead.`;
    fig.append(p);
  };
  if (source.length > MAX_SOURCE) return problem('it is too large');
  try {
    const mm = await load();
    mm.initialize({ startOnLoad: false, securityLevel: 'strict', layout: 'dagre', theme: 'base', themeVariables: themeVariables(), fontFamily: getComputedStyle(document.body).fontFamily });
    await mm.parse(source);                         // throws on a mistake, without leaving debris on the page
    const id = `diagram-${++seq}`;
    const { svg } = await mm.render(id, source);
    document.getElementById('d' + id)?.remove();
    let view = fig.querySelector<HTMLElement>('.diagram-view');
    if (!view) {                                    // first draw: keep the source, tucked into a "Diagram source" disclosure
      const pre = fig.querySelector('pre')!;
      const details = document.createElement('details'); details.className = 'diagram-src';
      const summary = document.createElement('summary'); summary.textContent = 'Diagram source';
      details.append(summary, pre);
      view = document.createElement('div'); view.className = 'diagram-view';
      fig.replaceChildren(view, details);
    }
    view.setAttribute('role', 'img');
    view.setAttribute('aria-label', /^\s*accTitle\s*:\s*(.+)$/m.exec(source)?.[1].trim() || 'Diagram');
    view.innerHTML = svg;                           // Mermaid's strict mode has already sanitised labels
    const el = view.querySelector('svg');
    if (el) {                                       // natural size, but allowed to shrink to half size (still legible on a retina phone); wider than that scrolls inside its box
      const w = el.viewBox?.baseVal?.width || el.getBoundingClientRect().width;
      el.removeAttribute('height');
      el.style.cssText = `width:${w}px;max-width:100%;min-width:${Math.round(Math.max(240, Math.min(w, w * 0.5)))}px;height:auto`;
    }
    // A box that scrolls sideways must be reachable by keyboard (WCAG 2.1.1): it joins the Tab order only while its drawing is wider than the box,
    // and a visible ring shows where it is. Arrow keys then scroll it.
    const fit = () => { if (view!.scrollWidth > view!.clientWidth + 1) view!.tabIndex = 0; else view!.removeAttribute('tabindex'); };
    fit(); new ResizeObserver(fit).observe(view);
    fig.querySelector('.diagram-error')?.remove();
    fig.dataset.state = 'ready';
  } catch (e) {
    document.querySelectorAll('[id^="ddiagram-"]').forEach((n) => n.remove()); // Mermaid can leave its error drawing behind
    if (fig.dataset.state !== 'ready') problem(String((e as Error)?.message ?? e).split('\n')[0].slice(0, 140));
  }
}

const draw = (fig: HTMLElement) => (queue = queue.then(() => drawOne(fig)));

/** Redraw finished diagrams when the light/dark choice changes, so their colours follow the page. */
function watchTheme() {
  if (watching) return;
  watching = true;
  const redraw = () => document.querySelectorAll<HTMLElement>(`${SELECTOR}[data-state="ready"]`).forEach((f) => void draw(f));
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
}

/** Draw every diagram under `root`. `immediate` skips the "only when near the screen" wait (used by the editor preview). */
export function renderDiagrams(root: ParentNode = document, opts: { immediate?: boolean } = {}) {
  const figures = Array.from(root.querySelectorAll<HTMLElement>(SELECTOR)).filter((f) => !f.dataset.state);
  if (!figures.length) return;
  watchTheme();
  if (opts.immediate || !('IntersectionObserver' in window)) { figures.forEach((f) => { f.dataset.state = 'loading'; void draw(f); }); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); (e.target as HTMLElement).dataset.state = 'loading'; void draw(e.target as HTMLElement); }
  }, { rootMargin: '1200px 0px' });
  figures.forEach((f) => { f.dataset.state = 'waiting'; io.observe(f); });
}
