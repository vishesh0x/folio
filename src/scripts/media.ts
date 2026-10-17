// Browser code shared by every place in the dashboard that picks or uploads a file:
// the project cover and share image, portrait, favicon, resume PDF, and the Markdown "Image" button.
//
//   • library()      the files you have already uploaded (read once from <script id="media-data">)
//   • uploadFile()   sends one file to /api/admin/assets/upload and reports progress
//   • openPicker()   one modal that lets you choose an existing file OR upload a new one on the spot
import type { AssetView } from '../lib/assets';

export type Item = AssetView;
export type Kind = 'image' | 'pdf' | 'any';
export type PickOpts = {
  kind: Kind;
  title: string;
  current?: string | null;       // id that is selected right now
  none?: string;                 // label for a "no file" tile (for example "No cover"); omit to hide the tile
  raster?: boolean;              // only PNG, JPEG, WebP, AVIF (link previews cannot show SVG or GIF)
  exclude?: string[];            // file types that make no sense for this field, for example ['image/gif']
  file?: File;                   // a file the person already dropped; goes straight to the "describe it" step
  uploadOnly?: boolean;          // hide the list of existing files (used on the Files page, which is the list)
  onPick: (item: Item | null) => void;
};

const MAX_IMAGE = 10 * 1024 * 1024, MAX_PDF = 15 * 1024 * 1024;
const RASTER = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];

/* ───────── library ───────── */
let items: Item[] | null = null;
export function library(): Item[] {
  if (!items) {
    try { items = JSON.parse(document.getElementById('media-data')?.textContent || '[]') as Item[]; } catch { items = []; }
  }
  return items;
}
export const addItem = (it: Item) => { items = [it, ...library().filter((x) => x.id !== it.id)]; };
export const findItem = (id: string | null | undefined) => (id ? library().find((x) => x.id === id) ?? null : null);

export const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const accepts = (kind: Kind, raster = false) =>
  kind === 'pdf' ? '.pdf,application/pdf' : raster ? '.png,.jpg,.jpeg,.webp,.avif' : kind === 'image' ? 'image/*,.svg' : 'image/*,.svg,.pdf,application/pdf';
const hintFor = (kind: Kind, raster: boolean) =>
  kind === 'pdf' ? 'A PDF, up to 15 MB.' : raster ? 'PNG, JPEG, WebP or AVIF, up to 10 MB.' : kind === 'image' ? 'PNG, JPEG, WebP, AVIF, GIF or SVG, up to 10 MB.' : 'Images up to 10 MB, PDFs up to 15 MB.';

/** Returns a reason this file cannot be used here, or null. Only a quick check: the server checks the real bytes again. */
const NEVER = ['image/x-icon', 'image/vnd.microsoft.icon']; // .ico files are never used by a picker
export function problemWith(file: File, kind: Kind, raster = false, exclude: string[] = []): string | null {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImg = file.type.startsWith('image/') || /\.(png|jpe?g|webp|avif|gif|svg|ico)$/i.test(file.name);
  if (kind === 'pdf' && !isPdf) return 'This needs a PDF.';
  if (kind === 'image' && !isImg) return 'This needs an image.';
  if ([...NEVER, ...exclude].includes(file.type) || (/\.ico$/i.test(file.name))) return `${file.type.replace('image/', '').toUpperCase() || 'That'} files cannot be used here.`;
  if (raster && !RASTER.includes(file.type) && !/\.(png|jpe?g|webp|avif)$/i.test(file.name)) return 'Link previews need a PNG, JPEG, WebP or AVIF image.';
  if (!isPdf && !isImg) return 'Use an image or a PDF.';
  if (isPdf ? file.size > MAX_PDF : file.size > MAX_IMAGE) return `That file is ${bytes(file.size)}. The limit is ${isPdf ? '15' : '10'} MB.`;
  return null;
}

/* ───────── upload ───────── */
export function uploadFile(file: File, o: { alt: string; decorative: boolean; expect?: Kind }, onProgress: (fraction: number) => void): Promise<Item> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file); fd.append('alt', o.alt);
    if (o.decorative) fd.append('decorative', 'on');
    if (o.expect && o.expect !== 'any') fd.append('expect', o.expect);
    const x = new XMLHttpRequest();
    x.open('POST', '/api/admin/assets/upload'); x.responseType = 'json';
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => {
      const r = x.response as { ok?: boolean; asset?: Item; error?: string } | null;
      if (x.status === 200 && r?.ok && r.asset) { addItem(r.asset); resolve(r.asset); }
      else reject(new Error(r?.error || (x.status === 413 ? 'That file is too large.' : x.status === 401 || x.status === 403 ? 'You were signed out or the page is out of date. Reload and try again.' : 'The upload failed. Try again.')));
    };
    x.onerror = () => reject(new Error('The upload could not reach the server. Check your connection and try again.'));
    x.send(fd);
  });
}

/* ───────── tiny DOM helper ───────── */
type Attrs = Record<string, string | boolean | undefined>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === undefined || v === false) continue; if (k === 'class') el.className = String(v); else el.setAttribute(k, v === true ? '' : String(v)); }
  for (const kid of kids) if (kid !== null) el.append(kid);
  return el;
}
const ICON_UPLOAD = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';
const ICON_FILE = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
const ICON_CHECK = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.8"/></svg>';
const withIcon = (svg: string) => { const s = document.createElement('span'); s.className = 'mpick-ico'; s.innerHTML = svg; return s; };
export const icons = { upload: ICON_UPLOAD, file: ICON_FILE, check: ICON_CHECK };

/* ───────── the picker dialog ───────── */
let dlg: HTMLDialogElement | null = null;
export function openPicker(o: PickOpts) {
  dlg?.remove();
  const kindLabel = o.kind === 'pdf' ? 'PDF' : o.kind === 'image' ? 'image' : 'file';
  const withArticle = o.kind === 'pdf' ? 'a PDF' : o.kind === 'image' ? 'an image' : 'a file';
  const d = (dlg = h('dialog', { class: 'mpick', 'aria-labelledby': 'mpick-title' }));
  const close = () => { if (d.open) d.close(); };

  // header
  const closeBtn = h('button', { type: 'button', class: 'mpick-x', 'aria-label': 'Close' }, '×');
  closeBtn.addEventListener('click', close);
  const head = h('header', { class: 'mpick-head' }, h('h2', { id: 'mpick-title' }, o.title), closeBtn);

  // upload area: a drop zone, then (after a file is chosen) a small form
  const fileInput = h('input', { type: 'file', class: 'visually-hidden', accept: accepts(o.kind, o.raster), tabindex: '-1', 'aria-hidden': 'true' });
  const browse = h('button', { type: 'button', class: 'mpick-link' }, 'browse');
  const dropMsg = h('p', { class: 'mpick-drop-t' }, h('strong', {}, `Drop ${withArticle} here`), ' or ', browse);
  const dropHint = h('p', { class: 'hint' }, hintFor(o.kind, !!o.raster));
  const drop = h('div', { class: 'mpick-drop' }, withIcon(ICON_UPLOAD), h('div', {}, dropMsg, dropHint));
  const dropErr = h('p', { class: 'mpick-err', role: 'alert' });

  const prev = h('img', { class: 'mpick-prev', alt: '' });
  const nameEl = h('strong', {}), sizeEl = h('span', { class: 'hint' });
  const altId = 'mpick-alt';
  const altInput = h('input', { id: altId, type: 'text', maxlength: '300', placeholder: 'For example: Red circle on a pink background', autocomplete: 'off' });
  const decor = h('input', { type: 'checkbox', id: 'mpick-decor' });
  const altField = h('div', { class: 'field' }, h('label', { for: altId }, 'Describe the image'), altInput,
    h('label', { class: 'check', for: 'mpick-decor' }, decor, ' It is decorative (screen readers should skip it)'));
  const bar = h('progress', { max: '1', value: '0', class: 'mpick-bar', hidden: true, 'aria-label': 'Upload progress' });
  const err = h('p', { class: 'mpick-err', role: 'alert' });
  const go = h('button', { type: 'button', class: 'btn sm' }, 'Upload and use');
  const cancel = h('button', { type: 'button', class: 'btn ghost sm' }, 'Choose another');
  const form = h('div', { class: 'mpick-new', hidden: true },
    h('div', { class: 'mpick-new-top' }, prev, h('div', { class: 'mpick-new-meta' }, nameEl, sizeEl)),
    altField, bar, err, h('div', { class: 'row-gap' }, go, cancel));
  const upload = h('div', { class: 'mpick-upload' }, drop, dropErr, form, fileInput);

  // library
  const search = h('input', { type: 'search', class: 'mpick-search', placeholder: 'Search your files', 'aria-label': 'Search your files' });
  const count = h('span', { class: 'hint', role: 'status' });
  const grid = h('ul', { class: 'mpick-grid' });
  const libHead = h('div', { class: 'mpick-bar-row' }, h('h3', {}, 'Your files'), search, count);
  d.append(h('div', { class: 'mpick-box' }, head, upload, ...(o.uploadOnly ? [] : [libHead, grid])));

  const usable = (it: Item) => (o.kind === 'any' ? true : it.kind === o.kind) && (!o.raster || RASTER.includes(it.mime)) && ![...NEVER, ...(o.exclude ?? [])].includes(it.mime);
  const pick = (it: Item | null) => { o.onPick(it); close(); };
  const tile = (it: Item | null) => {
    const sel = (it?.id ?? '') === (o.current ?? '');
    const thumb = it === null ? h('span', { class: 'mpick-none-box' }, '∅')
      : it.kind === 'image' ? h('img', { src: it.thumb, alt: '', loading: 'lazy', width: it.width ? String(it.width) : undefined, height: it.height ? String(it.height) : undefined })
      : h('span', { class: 'mpick-doc' }, withIcon(ICON_FILE), 'PDF');
    const b = h('button', { type: 'button', class: 'mpick-item', 'aria-pressed': String(sel), title: it ? (it.alt || it.filename) : o.none }, h('span', { class: 'mpick-thumb' }, thumb),
      h('span', { class: 'mpick-name' }, it ? it.filename : o.none ?? 'None'),
      h('span', { class: 'mpick-sub hint' }, it ? [it.width && it.height ? `${it.width}×${it.height}` : null, bytes(it.size)].filter(Boolean).join(' · ') : 'Nothing selected'));
    if (sel) b.append(withIcon(ICON_CHECK));
    b.addEventListener('click', () => pick(it));
    return h('li', {}, b);
  };
  const renderGrid = () => {
    const q = search.value.trim().toLowerCase();
    const list = library().filter(usable).filter((it) => !q || it.filename.toLowerCase().includes(q) || it.alt.toLowerCase().includes(q));
    grid.replaceChildren(...(o.none !== undefined && !q ? [tile(null)] : []), ...list.map((it) => tile(it)));
    const total = library().filter(usable).length;
    count.textContent = total === 0 ? '' : q ? `${list.length} of ${total}` : `${total} ${total === 1 ? 'file' : 'files'}`;
    if (list.length === 0) grid.append(h('li', { class: 'mpick-empty' }, total === 0 ? `No ${kindLabel === "PDF" ? "PDFs" : kindLabel + "s"} uploaded yet. Add the first one above.` : 'Nothing matches that search.'));
  };
  search.addEventListener('input', renderGrid);

  // upload flow
  let chosen: File | null = null, busy = false;
  const stage = (file: File) => {
    dropErr.textContent = '';
    const why = problemWith(file, o.kind, o.raster, o.exclude);
    if (why) { dropErr.textContent = why; return; }
    chosen = file;
    const isImg = file.type.startsWith('image/') || /\.(png|jpe?g|webp|avif|gif|svg|ico)$/i.test(file.name);
    nameEl.textContent = file.name; sizeEl.textContent = bytes(file.size);
    prev.hidden = !isImg; if (isImg) prev.src = URL.createObjectURL(file);
    altField.hidden = !isImg; altInput.value = ''; decor.checked = false; altInput.disabled = false; err.textContent = '';
    drop.hidden = true; form.hidden = false;
    (isImg ? altInput : go).focus();
  };
  const reset = () => { chosen = null; fileInput.value = ''; form.hidden = true; drop.hidden = false; err.textContent = ''; bar.hidden = true; };
  decor.addEventListener('change', () => { altInput.disabled = decor.checked; if (decor.checked) altInput.value = ''; });
  browse.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) stage(f); });
  cancel.addEventListener('click', () => { if (!busy) reset(); });
  for (const t of [drop, form]) {
    t.addEventListener('dragover', (e) => { e.preventDefault(); upload.classList.add('is-over'); });
    t.addEventListener('dragleave', () => upload.classList.remove('is-over'));
    t.addEventListener('drop', (e) => { e.preventDefault(); upload.classList.remove('is-over'); const f = e.dataTransfer?.files?.[0]; if (f && !busy) stage(f); });
  }
  drop.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('button')) fileInput.click(); }); // the "browse" button handles its own click
  const doUpload = async () => {
    if (!chosen || busy) return;
    const isImg = !altField.hidden;
    if (isImg && !decor.checked && !altInput.value.trim()) { err.textContent = 'Describe the image in a few words, or tick “decorative”.'; altInput.focus(); return; }
    busy = true; err.textContent = ''; go.disabled = cancel.disabled = true; go.textContent = 'Uploading…'; bar.hidden = false; bar.value = 0;
    try {
      const it = await uploadFile(chosen, { alt: altInput.value.trim(), decorative: decor.checked, expect: o.kind }, (f) => (bar.value = f));
      pick(it);
    } catch (e) {
      err.textContent = (e as Error).message; bar.hidden = true;
    } finally { busy = false; go.disabled = cancel.disabled = false; go.textContent = 'Upload and use'; }
  };
  go.addEventListener('click', doUpload);
  altInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doUpload(); } });

  d.addEventListener('click', (e) => { if (e.target === d) close(); }); // a click on the dimmed backdrop
  d.addEventListener('cancel', (e) => { if (busy) e.preventDefault(); });
  d.addEventListener('close', () => { d.remove(); if (dlg === d) dlg = null; });

  // inside the dashboard shell, so its colour variables and form styles apply to the dialog too
  (document.querySelector('.dash-shell') ?? document.body).append(d);
  renderGrid();
  d.showModal();
  if (o.file) stage(o.file); else (grid.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? browse).focus();
}
